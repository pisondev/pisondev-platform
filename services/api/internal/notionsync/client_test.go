package notionsync

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

// countingServer answers each request with the next status in order, then 200.
func countingServer(t *testing.T, statuses ...int) (*Client, *atomic.Int32) {
	t.Helper()
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := int(calls.Add(1))
		if n <= len(statuses) {
			w.Header().Set("Retry-After", "1")
			w.WriteHeader(statuses[n-1])
			_, _ = w.Write([]byte(`{"code":"x","message":"x"}`))
			return
		}
		_, _ = w.Write([]byte(`{"id":"page1"}`))
	}))
	t.Cleanup(srv.Close)
	return NewClient("test").WithBaseURL(srv.URL), &calls
}

// A server error after a create may hide a page that was made: never send it twice.
func TestCreatePageNotRetriedOnServerError(t *testing.T) {
	for _, status := range []int{409, 502} {
		c, calls := countingServer(t, status)
		if _, err := c.CreatePage(context.Background(), "db", nil); err == nil {
			t.Errorf("%d: want an error", status)
		}
		if n := calls.Load(); n != 1 {
			t.Errorf("%d: CreatePage sent %d times, want 1", status, n)
		}
	}
}

// A rate limit means Notion did nothing, so a create may be repeated.
func TestCreatePageRetriedOnRateLimit(t *testing.T) {
	c, calls := countingServer(t, 429)
	if _, err := c.CreatePage(context.Background(), "db", nil); err != nil {
		t.Fatal(err)
	}
	if n := calls.Load(); n != 2 {
		t.Errorf("sent %d times, want 2", n)
	}
}

func TestIdempotentRequestRetriedOnServerError(t *testing.T) {
	c, calls := countingServer(t, 502)
	if _, err := c.GetPage(context.Background(), "page1"); err != nil {
		t.Fatal(err)
	}
	if n := calls.Load(); n != 2 {
		t.Errorf("sent %d times, want 2", n)
	}
}

func TestCreatePageRetriedWhenNotConnected(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close() // nothing listens: the dial fails, so nothing was sent
	_, err := NewClient("test").WithBaseURL(url).CreatePage(context.Background(), "db", nil)
	if err == nil || !notSent(err) {
		t.Errorf("want a dial error after retries, got %v", err)
	}
}
