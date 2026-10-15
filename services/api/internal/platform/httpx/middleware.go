package httpx

import (
	"crypto/rand"
	"encoding/hex"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const requestIDKey = "request_id"

// RequestID returns the id assigned to this request.
func RequestID(c *gin.Context) string { return c.GetString(requestIDKey) }

// Logger assigns a request id and writes one access log line per request.
func Logger(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.GetHeader("X-Request-ID")
		if id == "" || len(id) > 64 {
			b := make([]byte, 8)
			_, _ = rand.Read(b)
			id = hex.EncodeToString(b)
		}
		c.Set(requestIDKey, id)
		c.Header("X-Request-ID", id)
		start := time.Now()
		c.Next()
		if c.Request.URL.Path == "/healthz" {
			return
		}
		log.Info("http",
			"method", c.Request.Method,
			"path", c.Request.URL.Path,
			"status", c.Writer.Status(),
			"ms", time.Since(start).Milliseconds(),
			"request_id", id,
		)
	}
}

// Recover turns a panic into a 500 without leaking details.
func Recover(log *slog.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if r := recover(); r != nil {
				log.Error("panic", "recover", r, "path", c.Request.URL.Path, "request_id", RequestID(c))
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": &Error{Code: "internal", Message: "Something went wrong."}})
			}
		}()
		c.Next()
	}
}

// SecurityHeaders sets headers suitable for a JSON API.
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		h := c.Writer.Header()
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("X-Frame-Options", "DENY")
		h.Set("Referrer-Policy", "no-referrer")
		h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		h.Set("Cache-Control", "no-store")
		c.Next()
	}
}

// BodyLimit caps request bodies.
func BodyLimit(max int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, max)
		c.Next()
	}
}

// SameOrigin rejects state-changing requests whose Origin is not one of allowed.
// Session cookies are SameSite=Lax already; this is the second line against CSRF.
func SameOrigin(allowed ...string) gin.HandlerFunc {
	ok := map[string]bool{}
	for _, a := range allowed {
		ok[strings.TrimRight(a, "/")] = true
	}
	return func(c *gin.Context) {
		switch c.Request.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			c.Next()
			return
		}
		origin := c.GetHeader("Origin")
		if origin == "" {
			// Browsers always send Origin on cross-site POST. Its absence means a
			// same-origin request from an older client or a non-browser caller.
			if site := c.GetHeader("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
				Fail(c, Forbidden("Cross-site request refused."))
				return
			}
			c.Next()
			return
		}
		if !ok[origin] {
			Fail(c, Forbidden("Cross-site request refused."))
			return
		}
		c.Next()
	}
}
