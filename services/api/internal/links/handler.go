package links

import (
	"net/http"
	"regexp"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/pisondev/pisondev-platform/services/api/internal/auth"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

// Handler serves the management API, on a session-protected group.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Register(g *gin.RouterGroup) {
	l := g.Group("/links")
	l.GET("", h.list)
	l.GET("/config", h.config)
	l.POST("", h.create)
	l.GET("/:id", h.get)
	l.PATCH("/:id", h.update)
	l.DELETE("/:id", h.delete)
	l.GET("/:id/stats", h.stats)
}

func (h *Handler) list(c *gin.Context) {
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "100"))
	if err != nil || limit < 1 || limit > 500 {
		httpx.Fail(c, httpx.BadRequest("invalid_limit", "limit must be 1 to 500.", nil))
		return
	}
	out, err := h.svc.List(c.Request.Context(), c.Query("q"), limit)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, out)
}

// config tells the app where short links live, for previews before any link exists.
func (h *Handler) config(c *gin.Context) {
	httpx.OK(c, http.StatusOK, gin.H{"baseUrl": h.svc.baseURL})
}

func (h *Handler) create(c *gin.Context) {
	var in CreateInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Fail(c, httpx.BadRequest("invalid_body", "Request body is not valid JSON.", nil))
		return
	}
	l, err := h.svc.Create(c.Request.Context(), auth.CurrentUser(c).Email, in)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusCreated, l)
}

func (h *Handler) get(c *gin.Context) {
	id, ok := validID(c)
	if !ok {
		return
	}
	l, err := h.svc.Get(c.Request.Context(), id)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, l)
}

func (h *Handler) update(c *gin.Context) {
	id, ok := validID(c)
	if !ok {
		return
	}
	var in PatchInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Fail(c, httpx.BadRequest("invalid_body", "Request body is not valid JSON.", nil))
		return
	}
	l, err := h.svc.Update(c.Request.Context(), auth.CurrentUser(c).Email, id, in)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, l)
}

func (h *Handler) delete(c *gin.Context) {
	id, ok := validID(c)
	if !ok {
		return
	}
	if err := h.svc.Delete(c.Request.Context(), auth.CurrentUser(c).Email, id); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, gin.H{"deleted": true})
}

func (h *Handler) stats(c *gin.Context) {
	id, ok := validID(c)
	if !ok {
		return
	}
	days, err := strconv.Atoi(c.DefaultQuery("days", "30"))
	if err != nil || days < 1 || days > 366 {
		httpx.Fail(c, httpx.BadRequest("invalid_days", "days must be 1 to 366.", nil))
		return
	}
	st, err := h.svc.Stats(c.Request.Context(), id, days)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, st)
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func validID(c *gin.Context) (string, bool) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		httpx.Fail(c, httpx.NotFound("Not found."))
		return "", false
	}
	return id, true
}
