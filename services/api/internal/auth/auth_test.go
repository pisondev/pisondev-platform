package auth

import "testing"

func TestAllowlistRole(t *testing.T) {
	a := Allowlist{"main@example.com", "backup@example.com"}
	cases := []struct {
		email string
		role  string
		ok    bool
	}{
		{"main@example.com", "main", true},
		{"  MAIN@Example.com ", "main", true},
		{"backup@example.com", "backup", true},
		{"other@example.com", "", false},
		{"", "", false},
	}
	for _, tc := range cases {
		role, ok := a.Role(tc.email)
		if role != tc.role || ok != tc.ok {
			t.Errorf("Role(%q) = %q, %v; want %q, %v", tc.email, role, ok, tc.role, tc.ok)
		}
	}
}

func TestSafeNext(t *testing.T) {
	cases := map[string]string{
		"":                     "/",
		"/finance":             "/finance",
		"/finance?tab=quota":   "/finance?tab=quota",
		"//evil.example":       "/",
		"https://evil.example": "/",
		`/\evil.example`:       "/",
		"finance":              "/",
	}
	for in, want := range cases {
		if got := safeNext(in); got != want {
			t.Errorf("safeNext(%q) = %q, want %q", in, got, want)
		}
	}
}
