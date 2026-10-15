package auth

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

const (
	SessionCookie = "pd_session"
	oauthCookie   = "pd_oauth"
	oauthPath     = "/api/v1/auth/google"
	userKey       = "auth_user"
)

type Options struct {
	Allowed            Allowlist
	GoogleClientID     string
	GoogleClientSecret string
	PublicBaseURL      string
	CookieSecure       bool
	CookieDomain       string
	DevLogin           bool
}

// Handler serves sign-in, sign-out and the session middleware.
type Handler struct {
	opt      Options
	sessions *Sessions
	google   *google
	log      *slog.Logger
}

func NewHandler(opt Options, sessions *Sessions, log *slog.Logger) *Handler {
	return &Handler{
		opt:      opt,
		sessions: sessions,
		log:      log,
		google: &google{
			clientID:     opt.GoogleClientID,
			clientSecret: opt.GoogleClientSecret,
			redirectURL:  opt.PublicBaseURL + oauthPath + "/callback",
		},
	}
}

// Register mounts the auth routes on /api/v1/auth.
func (h *Handler) Register(public, private *gin.RouterGroup) {
	public.GET("/auth/google/login", h.login)
	public.GET("/auth/google/callback", h.callback)
	public.GET("/auth/config", h.config)
	if h.opt.DevLogin {
		public.POST("/auth/dev-login", h.devLogin)
	}
	private.GET("/auth/me", h.me)
	private.POST("/auth/logout", h.logout)
}

type oauthState struct {
	State    string `json:"s"`
	Nonce    string `json:"n"`
	Verifier string `json:"v"`
	Next     string `json:"x"`
}

func (h *Handler) config(c *gin.Context) {
	httpx.OK(c, http.StatusOK, gin.H{"google": h.google.configured(), "devLogin": h.opt.DevLogin})
}

func (h *Handler) login(c *gin.Context) {
	st := oauthState{
		State:    randomToken(24),
		Nonce:    randomToken(24),
		Verifier: oauth2.GenerateVerifier(),
		Next:     safeNext(c.Query("next")),
	}
	target, err := h.google.authURL(c.Request.Context(), st.State, st.Nonce, st.Verifier)
	if err != nil {
		h.log.Error("google login unavailable", "err", err)
		c.Redirect(http.StatusFound, "/login?error=unavailable")
		return
	}
	raw, _ := json.Marshal(st)
	h.setCookie(c, oauthCookie, base64.RawURLEncoding.EncodeToString(raw), oauthPath, 10*time.Minute)
	c.Redirect(http.StatusFound, target)
}

func (h *Handler) callback(c *gin.Context) {
	ctx := c.Request.Context()
	st, err := h.readState(c)
	h.setCookie(c, oauthCookie, "", oauthPath, -1)
	if err != nil || c.Query("state") != st.State {
		h.log.Warn("oauth callback rejected", "reason", "state mismatch")
		c.Redirect(http.StatusFound, "/login?error=failed")
		return
	}
	if c.Query("error") != "" || c.Query("code") == "" {
		c.Redirect(http.StatusFound, "/login?error=cancelled")
		return
	}
	id, err := h.google.exchange(ctx, c.Query("code"), st.Verifier, st.Nonce)
	if err != nil {
		h.log.Warn("oauth callback rejected", "reason", err.Error())
		c.Redirect(http.StatusFound, "/login?error=failed")
		return
	}
	if !id.EmailVerified {
		c.Redirect(http.StatusFound, "/login?error=not_allowed")
		return
	}
	if _, ok := h.opt.Allowed.Role(id.Email); !ok {
		h.log.Warn("sign-in refused, email not allowed", "email", id.Email)
		c.Redirect(http.StatusFound, "/login?error=not_allowed")
		return
	}
	if err := h.startSession(c, strings.ToLower(id.Email)); err != nil {
		h.log.Error("create session", "err", err)
		c.Redirect(http.StatusFound, "/login?error=failed")
		return
	}
	c.Redirect(http.StatusFound, st.Next)
}

// devLogin signs in an allowed email without Google. Only mounted when AUTH_DEV_LOGIN is
// on, which config refuses outside development.
func (h *Handler) devLogin(c *gin.Context) {
	var body struct {
		Email string `json:"email"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		httpx.Fail(c, httpx.BadRequest("invalid_body", "Expected {\"email\": ...}.", nil))
		return
	}
	email := strings.ToLower(strings.TrimSpace(body.Email))
	role, ok := h.opt.Allowed.Role(email)
	if !ok {
		httpx.Fail(c, httpx.Forbidden("This account is not allowed."))
		return
	}
	if err := h.startSession(c, email); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, User{Email: email, Role: role})
}

func (h *Handler) me(c *gin.Context) {
	httpx.OK(c, http.StatusOK, CurrentUser(c))
}

func (h *Handler) logout(c *gin.Context) {
	if token, err := c.Cookie(SessionCookie); err == nil {
		if err := h.sessions.Delete(c.Request.Context(), token); err != nil {
			httpx.Fail(c, err)
			return
		}
	}
	h.setCookie(c, SessionCookie, "", "/", -1)
	httpx.OK(c, http.StatusOK, gin.H{"signedOut": true})
}

// Require rejects requests without a live session of an allowed email. Removing an email
// from AUTH_ALLOWED_EMAILS locks it out on the next request.
func (h *Handler) Require() gin.HandlerFunc {
	return func(c *gin.Context) {
		token, _ := c.Cookie(SessionCookie)
		email, err := h.sessions.Lookup(c.Request.Context(), token)
		if errors.Is(err, errNoSession) {
			httpx.Fail(c, httpx.Unauthorized("Sign in first."))
			return
		}
		if err != nil {
			httpx.Fail(c, err)
			return
		}
		role, ok := h.opt.Allowed.Role(email)
		if !ok {
			_ = h.sessions.Delete(c.Request.Context(), token)
			httpx.Fail(c, httpx.Unauthorized("Sign in first."))
			return
		}
		c.Set(userKey, User{Email: email, Role: role})
		c.Next()
	}
}

// CurrentUser returns the user set by Require.
func CurrentUser(c *gin.Context) User {
	u, _ := c.Get(userKey)
	user, _ := u.(User)
	return user
}

func (h *Handler) startSession(c *gin.Context, email string) error {
	token, expires, err := h.sessions.Create(c.Request.Context(), email, c.Request.UserAgent(), c.ClientIP())
	if err != nil {
		return err
	}
	h.setCookie(c, SessionCookie, token, "/", time.Until(expires))
	h.log.Info("signed in", "email", email)
	return nil
}

func (h *Handler) readState(c *gin.Context) (oauthState, error) {
	var st oauthState
	raw, err := c.Cookie(oauthCookie)
	if err != nil {
		return st, err
	}
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return st, err
	}
	err = json.Unmarshal(b, &st)
	return st, err
}

func (h *Handler) setCookie(c *gin.Context, name, value, path string, maxAge time.Duration) {
	ck := &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		Domain:   h.opt.CookieDomain,
		HttpOnly: true,
		Secure:   h.opt.CookieSecure,
		SameSite: http.SameSiteLaxMode,
	}
	if maxAge < 0 {
		ck.MaxAge = -1
	} else {
		ck.MaxAge = int(maxAge.Seconds())
	}
	http.SetCookie(c.Writer, ck)
}

// safeNext keeps redirects on this site: a path, never a scheme or another host.
func safeNext(next string) string {
	if next == "" || !strings.HasPrefix(next, "/") || strings.HasPrefix(next, "//") || strings.Contains(next, `\`) {
		return "/"
	}
	u, err := url.Parse(next)
	if err != nil || u.IsAbs() || u.Host != "" {
		return "/"
	}
	return next
}
