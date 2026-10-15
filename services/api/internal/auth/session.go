// Package auth restricts the platform to an allowlist of Google accounts.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// User is the signed-in account.
type User struct {
	Email string `json:"email"`
	Role  string `json:"role"` // main or backup
}

// Allowlist maps an email to its role. The first address is the main account.
type Allowlist []string

func (a Allowlist) Role(email string) (string, bool) {
	email = strings.ToLower(strings.TrimSpace(email))
	for i, allowed := range a {
		if email == allowed {
			if i == 0 {
				return "main", true
			}
			return "backup", true
		}
	}
	return "", false
}

var errNoSession = errors.New("no session")

// Sessions stores opaque session tokens. The database keeps only their SHA-256.
type Sessions struct {
	db  *pgxpool.Pool
	ttl time.Duration
}

func NewSessions(db *pgxpool.Pool, ttl time.Duration) *Sessions {
	return &Sessions{db: db, ttl: ttl}
}

func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

func randomToken(n int) string {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand never fails on supported platforms
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

// Create starts a session and returns its token and expiry.
func (s *Sessions) Create(ctx context.Context, email, userAgent, ip string) (string, time.Time, error) {
	token := randomToken(32)
	expires := time.Now().Add(s.ttl)
	if len(userAgent) > 300 {
		userAgent = userAgent[:300]
	}
	_, err := s.db.Exec(ctx, `
		INSERT INTO auth.sessions (token_hash, email, expires_at, user_agent, ip)
		VALUES ($1, $2, $3, $4, $5)`, hashToken(token), email, expires, userAgent, ip)
	return token, expires, err
}

// Lookup returns the email behind a live token, and refreshes last_seen_at at most
// every five minutes.
func (s *Sessions) Lookup(ctx context.Context, token string) (string, error) {
	if token == "" {
		return "", errNoSession
	}
	var email string
	var lastSeen time.Time
	err := s.db.QueryRow(ctx, `
		SELECT email, last_seen_at FROM auth.sessions
		WHERE token_hash = $1 AND expires_at > now()`, hashToken(token)).Scan(&email, &lastSeen)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", errNoSession
	}
	if err != nil {
		return "", err
	}
	if time.Since(lastSeen) > 5*time.Minute {
		_, _ = s.db.Exec(ctx, `UPDATE auth.sessions SET last_seen_at = now() WHERE token_hash = $1`, hashToken(token))
	}
	return email, nil
}

func (s *Sessions) Delete(ctx context.Context, token string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM auth.sessions WHERE token_hash = $1`, hashToken(token))
	return err
}

// PurgeExpired removes dead sessions and sessions of emails no longer allowed.
func (s *Sessions) PurgeExpired(ctx context.Context, allowed Allowlist) error {
	_, err := s.db.Exec(ctx, `DELETE FROM auth.sessions WHERE expires_at <= now() OR NOT (email = ANY($1))`, []string(allowed))
	return err
}
