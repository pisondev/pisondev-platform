package meeting

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/pisondev/pisondev-platform/services/api/internal/auth"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

type Handler struct{ store *Store }

func NewHandler(store *Store) *Handler { return &Handler{store: store} }

func (h *Handler) Register(public, private *gin.RouterGroup) {
	public.GET("/meeting/polls/:id", h.get)
	public.POST("/meeting/polls/:id/responses", h.respond)
	public.PATCH("/meeting/polls/:id/responses/:participant", h.respond)
	private.GET("/meeting/polls", h.list)
	private.POST("/meeting/polls", h.create)
	private.GET("/meeting/polls/:id/access", h.access)
	private.POST("/meeting/polls/:id/finalize", h.finalize)
}

func bind(c *gin.Context, in any) bool {
	if err := c.ShouldBindJSON(in); err != nil {
		httpx.Fail(c, invalid("Request body is not valid JSON."))
		return false
	}
	return true
}
func reply(c *gin.Context, status int, out any, err error) {
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, status, out)
}
func (h *Handler) get(c *gin.Context) {
	out, err := h.store.Get(c.Request.Context(), c.Param("id"))
	reply(c, 200, out, err)
}
func (h *Handler) list(c *gin.Context) {
	out, err := h.store.List(c.Request.Context(), auth.CurrentUser(c).Email)
	reply(c, 200, out, err)
}
func (h *Handler) access(c *gin.Context) {
	out, err := h.store.CanManage(c.Request.Context(), c.Param("id"), auth.CurrentUser(c).Email)
	reply(c, 200, gin.H{"canManage": out}, err)
}
func (h *Handler) create(c *gin.Context) {
	var in Config
	if !bind(c, &in) {
		return
	}
	out, err := h.store.Create(c.Request.Context(), auth.CurrentUser(c).Email, in)
	reply(c, http.StatusCreated, out, err)
}
func (h *Handler) respond(c *gin.Context) {
	var in ResponseInput
	if !bind(c, &in) {
		return
	}
	out, err := h.store.Respond(c.Request.Context(), c.Param("id"), c.Param("participant"), c.GetHeader("X-Participant-Key"), in)
	status := http.StatusOK
	if c.Param("participant") == "" {
		status = http.StatusCreated
	}
	reply(c, status, out, err)
}
func (h *Handler) finalize(c *gin.Context) {
	var in struct {
		Start *string `json:"start"`
	}
	if !bind(c, &in) {
		return
	}
	out, err := h.store.Finalize(c.Request.Context(), c.Param("id"), auth.CurrentUser(c).Email, in.Start)
	reply(c, 200, out, err)
}
