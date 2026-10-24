package links

import (
	"net/url"
	"strings"
	"testing"
)

func TestNormalizeSlug(t *testing.T) {
	ok := map[string]string{"CV": "cv", " /portfolio/ ": "portfolio", "a_b-2": "a_b-2", "9": "9"}
	for in, want := range ok {
		if got, err := NormalizeSlug(in); err != nil || got != want {
			t.Errorf("NormalizeSlug(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, in := range []string{"", "-cv", "a b", "a/b", "émoji", "api", "Healthz", strings.Repeat("a", 65)} {
		if got, err := NormalizeSlug(in); err == nil {
			t.Errorf("NormalizeSlug(%q) = %q, want an error", in, got)
		}
	}
}

func TestRandomSlug(t *testing.T) {
	seen := map[string]bool{}
	for range 200 {
		s := RandomSlug()
		if len(s) != randomLength || strings.Trim(s, slugAlphabet) != "" {
			t.Fatalf("bad random slug %q", s)
		}
		if _, err := NormalizeSlug(s); err != nil {
			t.Fatalf("random slug %q does not validate: %v", s, err)
		}
		seen[s] = true
	}
	if len(seen) < 195 {
		t.Errorf("only %d distinct slugs out of 200", len(seen))
	}
}

func TestNormalizeTarget(t *testing.T) {
	for _, in := range []string{"https://example.com", "http://example.com/a?b=c#d", " https://example.com/path "} {
		if _, err := NormalizeTarget(in, "go.pisondev.com"); err != nil {
			t.Errorf("NormalizeTarget(%q): %v", in, err)
		}
	}
	for _, in := range []string{"", "example.com", "javascript:alert(1)", "data:text/html,x", "ftp://example.com",
		"https://user@example.com", "https://GO.pisondev.com/cv", "//example.com", "https://" + strings.Repeat("a", 2050)} {
		if got, err := NormalizeTarget(in, "go.pisondev.com"); err == nil {
			t.Errorf("NormalizeTarget(%q) = %q, want an error", in, got)
		}
	}
}

func TestWithQuery(t *testing.T) {
	cases := []struct{ target, query, want string }{
		{"https://example.com/a", "", "https://example.com/a"},
		{"https://example.com/a", "ref=ig", "https://example.com/a?ref=ig"},
		{"https://example.com/a?ref=site", "ref=ig&x=1", "https://example.com/a?ref=site&x=1"},
	}
	for _, tc := range cases {
		q, _ := url.ParseQuery(tc.query)
		if got := withQuery(tc.target, q); got != tc.want {
			t.Errorf("withQuery(%q, %q) = %q, want %q", tc.target, tc.query, got, tc.want)
		}
	}
}

func TestDevice(t *testing.T) {
	cases := []struct {
		ua, method, want string
		bot              bool
	}{
		{"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148", "GET", "mobile", false},
		{"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36", "GET", "desktop", false},
		{"WhatsApp/2.24.1 A", "GET", "bot", true},
		{"TelegramBot (like TwitterBot)", "GET", "bot", true},
		{"curl/8.5.0", "GET", "bot", true},
		{"", "GET", "bot", true},
		{"Mozilla/5.0 (Windows NT 10.0) Chrome/140.0", "HEAD", "bot", true},
	}
	for _, tc := range cases {
		if got, bot := device(tc.ua, tc.method); got != tc.want || bot != tc.bot {
			t.Errorf("device(%q, %s) = %s, %v; want %s, %v", tc.ua, tc.method, got, bot, tc.want, tc.bot)
		}
	}
}

func TestReferrerHost(t *testing.T) {
	cases := map[string]string{"": "", "https://www.Instagram.com/p/x": "instagram.com", "android-app://com.slack/": "com.slack", "::bad": ""}
	for in, want := range cases {
		if got := referrerHost(in); got != want {
			t.Errorf("referrerHost(%q) = %q, want %q", in, got, want)
		}
	}
}
