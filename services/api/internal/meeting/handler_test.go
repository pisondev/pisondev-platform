package meeting

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/pisondev/pisondev-platform/services/api/internal/auth"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

func TestHTTPPermissionsAndValidation(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	sessions := auth.NewSessions(s.db, time.Hour)
	session, _, err := sessions.Create(ctx, "http-test@example.test", "test", "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sessions.Delete(ctx, session) })
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	authHandler := auth.NewHandler(auth.Options{Allowed: auth.Allowlist{"http-test@example.test"}}, sessions, logger)
	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(httpx.BodyLimit(1<<20), httpx.SecurityHeaders())
	public := r.Group("/api/v1", httpx.SameOrigin("http://meeting.test"))
	private := r.Group("/api/v1", httpx.SameOrigin("http://meeting.test"), authHandler.Require())
	NewHandler(s).Register(public, private)
	call := func(method, path, body string, signed bool, origin string) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		if origin != "" {
			req.Header.Set("Origin", origin)
		}
		if signed {
			req.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: session})
		}
		out := httptest.NewRecorder()
		r.ServeHTTP(out, req)
		return out
	}
	raw, _ := json.Marshal(fixtureConfig())
	if out := call("POST", "/api/v1/meeting/polls", string(raw), false, ""); out.Code != 401 {
		t.Fatalf("guest created poll: %d", out.Code)
	}
	if out := call("GET", "/api/v1/meeting/polls", "", false, ""); out.Code != 401 {
		t.Fatalf("guest listed polls: %d", out.Code)
	}
	if out := call("POST", "/api/v1/meeting/polls", string(raw), true, "http://other.test"); out.Code != 403 {
		t.Fatalf("accepted cross-origin create: %d", out.Code)
	}
	out := call("POST", "/api/v1/meeting/polls", string(raw), true, "http://meeting.test")
	if out.Code != 201 {
		t.Fatalf("create: %d %s", out.Code, out.Body)
	}
	var envelope struct {
		Data Poll `json:"data"`
	}
	if err := json.Unmarshal(out.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	p := envelope.Data
	t.Cleanup(func() { _, _ = s.db.Exec(ctx, `DELETE FROM meeting.polls WHERE id=$1`, p.ID) })
	base := "/api/v1/meeting/polls/" + p.ID
	if out := call("GET", base, "", false, ""); out.Code != 200 {
		t.Fatalf("guest could not read invitation: %d", out.Code)
	}
	if out := call("GET", base+"/access", "", false, ""); out.Code != 401 {
		t.Fatalf("guest read private access: %d", out.Code)
	}
	if out := call("GET", base+"/access", "", true, ""); out.Code != 200 || !strings.Contains(out.Body.String(), `"canManage":true`) {
		t.Fatalf("owner access: %d %s", out.Code, out.Body)
	}
	if out := call("POST", base+"/responses", `{"name":"Guest","slots":[]}`, false, "http://other.test"); out.Code != 403 {
		t.Fatalf("accepted cross-origin guest: %d", out.Code)
	}
	if out := call("POST", base+"/responses", `{`, false, ""); out.Code != 400 {
		t.Fatalf("accepted malformed body: %d", out.Code)
	}
	if out := call("POST", base+"/responses", `{"name":"Guest","slots":["not-a-slot"]}`, false, ""); out.Code != 400 {
		t.Fatalf("accepted invalid slot: %d", out.Code)
	}
	if out := call("POST", base+"/responses", `{"name":"Guest","slots":[]}`, false, "http://meeting.test"); out.Code != 201 {
		t.Fatalf("guest could not submit: %d %s", out.Code, out.Body)
	}
	if out := call("POST", base+"/finalize", `{"start":null}`, false, ""); out.Code != 401 {
		t.Fatalf("guest reopened poll: %d", out.Code)
	}
	if out := call("GET", "/api/v1/meeting/polls/missing", "", false, ""); out.Code != 404 {
		t.Fatalf("missing invitation: %d", out.Code)
	}
}
