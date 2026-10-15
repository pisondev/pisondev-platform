package notionsync

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

const webhookTokenKey = "notion_webhook_token"

// Events that can change a synced property or row. Body edits and comments cannot.
var forwarded = map[string]bool{
	"page.created": true, "page.properties_updated": true, "page.deleted": true,
	"page.undeleted": true, "page.moved": true,
	"database.schema_updated": true, "database.content_updated": true,
	"data_source.schema_updated": true, "data_source.content_updated": true,
}

// Webhook receives Notion webhook events and wakes the syncer. The payload is never
// trusted beyond "something changed": the sync re-reads Notion itself.
type Webhook struct {
	db       *pgxpool.Pool
	syncer   *Syncer
	envToken string
	botID    func(ctx context.Context) string
	log      *slog.Logger
}

func NewWebhook(db *pgxpool.Pool, syncer *Syncer, client *Client, envToken string, log *slog.Logger) *Webhook {
	var once sync.Once
	var id string
	return &Webhook{db: db, syncer: syncer, envToken: envToken, log: log,
		botID: func(ctx context.Context) string {
			once.Do(func() {
				c, cancel := context.WithTimeout(ctx, 10*time.Second)
				defer cancel()
				id, _ = client.BotID(c)
			})
			return id
		}}
}

// Token returns the verification token: the environment wins over the stored one.
func (w *Webhook) Token(ctx context.Context) (string, error) {
	if w.envToken != "" {
		return w.envToken, nil
	}
	var token string
	err := w.db.QueryRow(ctx, `SELECT value FROM sync.settings WHERE key = $1`, webhookTokenKey).Scan(&token)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return token, err
}

func (w *Webhook) Handle(c *gin.Context) {
	ctx := c.Request.Context()
	raw, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		httpx.Fail(c, httpx.BadRequest("invalid_body", "Unreadable body.", nil))
		return
	}
	var body struct {
		VerificationToken string `json:"verification_token"`
		Type              string `json:"type"`
		Authors           []struct {
			ID   string `json:"id"`
			Type string `json:"type"`
		} `json:"authors"`
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		httpx.Fail(c, httpx.BadRequest("invalid_body", "Body is not JSON.", nil))
		return
	}
	token, err := w.Token(ctx)
	if err != nil {
		httpx.Fail(c, err)
		return
	}

	// Sent once when the subscription is created. Stored so the owner can paste it back
	// into Notion (`api webhook-token` prints it). The token itself is never logged.
	if body.VerificationToken != "" && token == "" {
		if _, err := w.db.Exec(ctx, `INSERT INTO sync.settings (key, value) VALUES ($1, $2)
			ON CONFLICT (key) DO NOTHING`, webhookTokenKey, body.VerificationToken); err != nil {
			httpx.Fail(c, err)
			return
		}
		w.log.Warn("notion webhook verification token received; run `api webhook-token` and paste it into Notion")
		httpx.OK(c, http.StatusOK, gin.H{"stored": true})
		return
	}
	if token == "" {
		httpx.Fail(c, httpx.Unavailable("not_verified", "Webhook is not verified yet."))
		return
	}
	if !validSignature(raw, c.GetHeader("X-Notion-Signature"), token) {
		w.log.Warn("notion webhook refused: bad signature")
		httpx.Fail(c, httpx.Unauthorized("Bad signature."))
		return
	}
	if !forwarded[body.Type] {
		httpx.OK(c, http.StatusOK, gin.H{"ignored": body.Type})
		return
	}
	if own := w.botID(ctx); own != "" && len(body.Authors) > 0 {
		all := true
		for _, a := range body.Authors {
			if bare(a.ID) != own {
				all = false
			}
		}
		if all {
			httpx.OK(c, http.StatusOK, gin.H{"ignored": "own change"})
			return
		}
	}
	w.syncer.Notify()
	httpx.OK(c, http.StatusOK, gin.H{"queued": true})
}

// validSignature checks "sha256=<hex>" against HMAC-SHA256(body, token).
func validSignature(body []byte, header, token string) bool {
	sig, ok := strings.CutPrefix(strings.TrimSpace(header), "sha256=")
	if !ok {
		return false
	}
	given, err := hex.DecodeString(sig)
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, []byte(token))
	mac.Write(body)
	return hmac.Equal(given, mac.Sum(nil))
}

// StatusHandler serves the sync state for the UI.
func StatusHandler(db *pgxpool.Pool, syncer *Syncer) gin.HandlerFunc {
	return func(c *gin.Context) {
		rows, err := db.Query(c.Request.Context(), `SELECT table_key, last_success_at, last_changes, last_error, last_error_at FROM sync.state ORDER BY table_key`)
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		defer rows.Close()
		type state struct {
			Table         string     `json:"table"`
			LastSuccessAt *time.Time `json:"lastSuccessAt"`
			LastChanges   int        `json:"lastChanges"`
			LastError     string     `json:"lastError"`
			LastErrorAt   *time.Time `json:"lastErrorAt"`
		}
		out := []state{}
		for rows.Next() {
			var s state
			if err := rows.Scan(&s.Table, &s.LastSuccessAt, &s.LastChanges, &s.LastError, &s.LastErrorAt); err != nil {
				httpx.Fail(c, err)
				return
			}
			out = append(out, s)
		}
		mode := ModeOff
		if syncer != nil {
			mode = syncer.Mode()
		}
		httpx.OK(c, http.StatusOK, gin.H{"mode": mode, "tables": out})
	}
}

// TriggerHandler asks for an immediate sync.
func TriggerHandler(syncer *Syncer) gin.HandlerFunc {
	return func(c *gin.Context) {
		if syncer == nil || syncer.Mode() == ModeOff {
			httpx.Fail(c, httpx.Unavailable("sync_off", "Sync is off."))
			return
		}
		syncer.Notify()
		httpx.OK(c, http.StatusAccepted, gin.H{"queued": true})
	}
}
