package links

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/database"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

type harness struct {
	pool   *pgxpool.Pool
	svc    *Service
	clicks *Recorder
	srv    *httptest.Server
	stop   context.CancelFunc
}

func newHarness(t *testing.T) *harness {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := database.Migrate(ctx, pool, log); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE links.links CASCADE`); err != nil {
		t.Fatal(err)
	}
	gin.SetMode(gin.TestMode)
	store := NewStore(pool)
	clicks := NewRecorder(store, log)
	rctx, stop := context.WithCancel(context.Background())
	go clicks.Run(rctx)
	rd := NewRedirector(store, clicks, "https://pisondev.com", clock.System, log)
	srv := httptest.NewServer(rd.Handler(func(c *gin.Context) { c.String(200, "ok") }))
	t.Cleanup(srv.Close)
	return &harness{pool: pool, svc: NewService(store, "https://go.pisondev.com", clock.System), clicks: clicks, srv: srv, stop: stop}
}

// visit follows nothing and returns the status and Location.
func (h *harness) visit(t *testing.T, method, path, ua string) (int, string) {
	t.Helper()
	req, _ := http.NewRequest(method, h.srv.URL+path, nil)
	req.Header.Set("User-Agent", ua)
	req.Header.Set("Referer", "https://www.instagram.com/")
	req.Header.Set("CF-IPCountry", "id")
	client := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	return res.StatusCode, res.Header.Get("Location")
}

// flush stops the recorder so every queued visit is written.
func (h *harness) flush() {
	h.stop()
	h.clicks.Wait()
}

const browser = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148"

func TestRedirectAndCount(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()

	l, err := h.svc.Create(ctx, "test", CreateInput{Target: "https://example.com/cv?src=go", Slug: "CV", Title: "CV"})
	if err != nil {
		t.Fatal(err)
	}
	if l.Slug != "cv" || l.ShortURL != "https://go.pisondev.com/cv" {
		t.Fatalf("created %+v", l)
	}
	if _, err := h.svc.Create(ctx, "test", CreateInput{Target: "https://example.com", Slug: "cv"}); !isCode(err, "slug_taken") {
		t.Fatalf("duplicate slug: %v", err)
	}
	random, err := h.svc.Create(ctx, "test", CreateInput{Target: "https://example.com/other"})
	if err != nil || len(random.Slug) != randomLength {
		t.Fatalf("random slug link: %+v, %v", random, err)
	}

	if code, loc := h.visit(t, "GET", "/CV?ref=ig", browser); code != 302 || loc != "https://example.com/cv?ref=ig&src=go" {
		t.Errorf("visit = %d %q", code, loc)
	}
	h.visit(t, "GET", "/cv", browser)
	h.visit(t, "GET", "/cv", "WhatsApp/2.24.1 A")
	h.visit(t, "HEAD", "/cv", browser)
	if code, loc := h.visit(t, "GET", "/", browser); code != 302 || loc != "https://pisondev.com" {
		t.Errorf("home = %d %q", code, loc)
	}
	if code, _ := h.visit(t, "GET", "/nope", browser); code != 404 {
		t.Errorf("unknown slug = %d, want 404", code)
	}
	if code, _ := h.visit(t, "GET", "/robots.txt", browser); code != 200 {
		t.Errorf("robots.txt = %d", code)
	}
	h.flush()

	got, _ := h.svc.Get(ctx, l.ID)
	if got.Clicks != 2 || got.LastClickedAt == nil {
		t.Errorf("clicks = %d (last %v), want 2 human visits", got.Clicks, got.LastClickedAt)
	}
	st, err := h.svc.Stats(ctx, l.ID, 7)
	if err != nil {
		t.Fatal(err)
	}
	if st.Total != 2 || st.Bots != 2 || len(st.Daily) != 7 || st.Daily[6].Count != 2 {
		t.Errorf("stats = %+v", st)
	}
	if len(st.Referrers) != 1 || st.Referrers[0].Key != "instagram.com" || st.Countries[0].Key != "ID" || st.Devices[0].Key != "mobile" {
		t.Errorf("breakdowns = %+v %+v %+v", st.Referrers, st.Countries, st.Devices)
	}

	// Visited, so the slug is fixed; other fields still change.
	if _, err := h.svc.Update(ctx, "test", l.ID, PatchInput{Slug: strp("resume")}); !isCode(err, "invalid_input") {
		t.Errorf("slug change after visits: %v", err)
	}
	if _, err := h.svc.Update(ctx, "test", random.ID, PatchInput{Slug: strp("other")}); err != nil {
		t.Errorf("slug change before visits: %v", err)
	}
}

func TestDisabledExpiredDeleted(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	defer h.flush()

	l, err := h.svc.Create(ctx, "test", CreateInput{Target: "https://example.com", Slug: "promo"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := h.svc.Update(ctx, "test", l.ID, PatchInput{Enabled: boolp(false)}); err != nil {
		t.Fatal(err)
	}
	if code, _ := h.visit(t, "GET", "/promo", browser); code != 404 {
		t.Errorf("disabled = %d, want 404", code)
	}

	past := time.Now().Add(-time.Hour).Format(time.RFC3339)
	if _, err := h.svc.Update(ctx, "test", l.ID, PatchInput{Enabled: boolp(true), ExpiresAt: &past}); err != nil {
		t.Fatal(err)
	}
	if code, _ := h.visit(t, "GET", "/promo", browser); code != 410 {
		t.Errorf("expired = %d, want 410", code)
	}
	if _, err := h.svc.Update(ctx, "test", l.ID, PatchInput{ExpiresAt: strp("")}); err != nil {
		t.Fatal(err)
	}
	if code, _ := h.visit(t, "GET", "/promo", browser); code != 302 {
		t.Errorf("expiry cleared = %d, want 302", code)
	}

	if err := h.svc.Delete(ctx, "test", l.ID); err != nil {
		t.Fatal(err)
	}
	if code, _ := h.visit(t, "GET", "/promo", browser); code != 404 {
		t.Errorf("deleted = %d, want 404", code)
	}
	// A deleted link keeps its slug, so an old shared link never changes destination.
	if _, err := h.svc.Create(ctx, "test", CreateInput{Target: "https://evil.example", Slug: "promo"}); !isCode(err, "slug_taken") {
		t.Errorf("reusing a deleted slug: %v", err)
	}
}

func isCode(err error, code string) bool {
	e, ok := err.(*httpx.Error)
	return ok && e.Code == code
}

func strp(v string) *string { return &v }
func boolp(v bool) *bool    { return &v }
