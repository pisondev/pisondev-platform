package links

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

// Redirector serves the short host: /<slug> redirects, nothing else is there. It runs
// on its own listener, so the short host can never reach the private API.
type Redirector struct {
	store   *Store
	clicks  *Recorder
	homeURL string // where / goes; empty means a not-found page
	now     clock.Clock
	log     *slog.Logger
}

func NewRedirector(store *Store, clicks *Recorder, homeURL string, now clock.Clock, log *slog.Logger) *Redirector {
	return &Redirector{store: store, clicks: clicks, homeURL: homeURL, now: now, log: log}
}

// Handler returns the HTTP handler of the short host. health answers /healthz.
func (rd *Redirector) Handler(health gin.HandlerFunc) http.Handler {
	r := gin.New()
	r.Use(httpx.Recover(rd.log), httpx.Logger(rd.log))
	r.GET("/healthz", health)
	r.GET("/robots.txt", func(c *gin.Context) {
		// Allowed, so link previews (X, LinkedIn) can follow; pages say noindex.
		c.String(http.StatusOK, "User-agent: *\nAllow: /\n")
	})
	r.GET("/", rd.home)
	r.HEAD("/", rd.home)
	r.GET("/:slug", rd.follow)
	r.HEAD("/:slug", rd.follow)
	r.NoRoute(func(c *gin.Context) { page(c, http.StatusNotFound, "Link not found") })
	return r
}

func (rd *Redirector) home(c *gin.Context) {
	if rd.homeURL == "" {
		page(c, http.StatusNotFound, "Link not found")
		return
	}
	redirect(c, rd.homeURL)
}

func (rd *Redirector) follow(c *gin.Context) {
	slug := strings.ToLower(c.Param("slug"))
	if !slugPattern.MatchString(slug) || len(slug) > maxSlug {
		page(c, http.StatusNotFound, "Link not found")
		return
	}
	l, err := rd.store.BySlug(c.Request.Context(), slug)
	if errors.Is(err, errNotFound) || (err == nil && !l.Enabled) {
		page(c, http.StatusNotFound, "Link not found")
		return
	}
	if err != nil {
		rd.log.Error("link lookup", "err", err, "slug", slug)
		page(c, http.StatusServiceUnavailable, "Try again in a moment")
		return
	}
	now := rd.now()
	if !l.Live(now) {
		page(c, http.StatusGone, "This link has expired")
		return
	}
	dev, bot := device(c.Request.UserAgent(), c.Request.Method)
	country := strings.ToUpper(c.GetHeader("CF-IPCountry"))
	if len(country) != 2 {
		country = ""
	}
	rd.clicks.Add(click{linkID: l.ID, at: now, referrer: referrerHost(c.Request.Referer()), country: country, device: dev, bot: bot})
	redirect(c, withQuery(l.Target, c.Request.URL.Query()))
}

// redirect answers 302, never cached: the target may change and every visit counts.
func redirect(c *gin.Context, to string) {
	h := c.Writer.Header()
	h.Set("Cache-Control", "private, no-store")
	h.Set("X-Robots-Tag", "noindex")
	h.Set("Referrer-Policy", "strict-origin-when-cross-origin")
	c.Redirect(http.StatusFound, to)
}

func page(c *gin.Context, status int, title string) {
	h := c.Writer.Header()
	h.Set("Cache-Control", "no-store")
	h.Set("X-Robots-Tag", "noindex")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'")
	c.Data(status, "text/html; charset=utf-8", []byte(`<!doctype html><html lang="en"><head><meta charset="utf-8">`+
		`<meta name="viewport" content="width=device-width,initial-scale=1"><title>`+title+`</title></head>`+
		`<body style="font:16px/1.5 system-ui,sans-serif;display:grid;place-items:center;min-height:90vh;margin:0;color:#333">`+
		`<p>`+title+`.</p></body></html>`))
}
