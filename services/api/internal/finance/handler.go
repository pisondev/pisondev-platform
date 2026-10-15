package finance

import (
	"net/http"
	"regexp"
	"strconv"

	"github.com/gin-gonic/gin"

	"github.com/pisondev/pisondev-platform/services/api/internal/auth"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

// Register mounts the finance routes on a session-protected group.
func (h *Handler) Register(g *gin.RouterGroup) {
	f := g.Group("/finance")
	f.GET("/summary", h.summary)
	f.GET("/cashflow", h.cashflow)
	f.GET("/transactions", h.transactions)
	f.POST("/transactions", h.addTransaction)
	f.PATCH("/transactions/:id", h.updateTransaction)
	f.DELETE("/transactions/:id", h.deleteTransaction)
	f.GET("/subscriptions", h.subscriptions)
	f.POST("/subscriptions/:id/advance", h.advanceSubscription)
	f.GET("/quota", h.quota)
	f.GET("/options", h.options)
}

func (h *Handler) summary(c *gin.Context) {
	snap, err := h.svc.Snapshot(c.Request.Context())
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	r := h.svc.Rules()
	httpx.OK(c, http.StatusOK, gin.H{
		"balance": Balance(snap.Transactions, r),
		"account": r.Account,
		"asOf":    h.svc.now().Format("2006-01-02T15:04"),
	})
}

func (h *Handler) cashflow(c *gin.Context) {
	snap, err := h.svc.Snapshot(c.Request.Context())
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, ComputeCashflow(snap, h.svc.Rules(), c.DefaultQuery("granularity", "monthly"), h.svc.now()))
}

func (h *Handler) transactions(c *gin.Context) {
	kind := c.DefaultQuery("kind", "all")
	if kind != "all" && kind != "income" && kind != "outcome" {
		httpx.Fail(c, httpx.BadRequest("invalid_kind", "kind must be all, income or outcome.", nil))
		return
	}
	limit, err := strconv.Atoi(c.DefaultQuery("limit", "50"))
	if err != nil || limit < 1 || limit > 500 {
		httpx.Fail(c, httpx.BadRequest("invalid_limit", "limit must be 1 to 500.", nil))
		return
	}
	snap, err := h.svc.Snapshot(c.Request.Context())
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, FilterTransactions(snap.Transactions, TransactionFilter{Kind: kind, Limit: limit}))
}

func (h *Handler) addTransaction(c *gin.Context) {
	var in AddInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Fail(c, httpx.BadRequest("invalid_body", "Request body is not valid JSON.", nil))
		return
	}
	t, err := h.svc.AddTransaction(c.Request.Context(), auth.CurrentUser(c).Email, in)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusCreated, t)
}

func (h *Handler) updateTransaction(c *gin.Context) {
	id, ok := validID(c)
	if !ok {
		return
	}
	var in PatchInput
	if err := c.ShouldBindJSON(&in); err != nil {
		httpx.Fail(c, httpx.BadRequest("invalid_body", "Request body is not valid JSON.", nil))
		return
	}
	t, err := h.svc.UpdateTransaction(c.Request.Context(), auth.CurrentUser(c).Email, id, in)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, t)
}

func (h *Handler) deleteTransaction(c *gin.Context) {
	id, ok := validID(c)
	if !ok {
		return
	}
	if err := h.svc.DeleteTransaction(c.Request.Context(), auth.CurrentUser(c).Email, id); err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, gin.H{"deleted": true})
}

func (h *Handler) subscriptions(c *gin.Context) {
	snap, err := h.svc.Snapshot(c.Request.Context())
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, ComputeSubscriptions(snap, h.svc.Rules()))
}

func (h *Handler) advanceSubscription(c *gin.Context) {
	id, ok := validID(c)
	if !ok {
		return
	}
	var in struct {
		From string `json:"from"`
	}
	_ = c.ShouldBindJSON(&in)
	s, err := h.svc.AdvanceSubscription(c.Request.Context(), auth.CurrentUser(c).Email, id, in.From)
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, s)
}

func (h *Handler) quota(c *gin.Context) {
	snap, err := h.svc.Snapshot(c.Request.Context())
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, ComputeQuota(snap, h.svc.Rules(), h.svc.now()))
}

func (h *Handler) options(c *gin.Context) {
	opts, err := h.svc.Options(c.Request.Context())
	if err != nil {
		httpx.Fail(c, err)
		return
	}
	httpx.OK(c, http.StatusOK, opts)
}

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// validID rejects malformed ids before they reach Postgres.
func validID(c *gin.Context) (string, bool) {
	id := c.Param("id")
	if !uuidPattern.MatchString(id) {
		httpx.Fail(c, httpx.NotFound("Not found."))
		return "", false
	}
	return id, true
}
