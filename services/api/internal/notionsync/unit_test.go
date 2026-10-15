package notionsync

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"

	"github.com/pisondev/pisondev-platform/services/api/internal/finance"
)

var fields3 = []finance.Field{{Name: "A", Kind: "title"}, {Name: "B", Kind: "number"}, {Name: "C", Kind: "rich_text", External: true}}

func TestMerge(t *testing.T) {
	cases := []struct {
		name                string
		local, remote, base []string
		pull                bool
		wantFinal           []string
		toRemote, toLocal   []int
		dirty               bool
	}{
		{"in sync", s("a", "1", "x"), s("a", "1", "x"), s("a", "1", "x"), false, s("a", "1", "x"), nil, nil, false},
		{"local edit", s("a", "2", "x"), s("a", "1", "x"), s("a", "1", "x"), false, s("a", "2", "x"), []int{1}, nil, true},
		{"remote edit", s("a", "1", "x"), s("b", "1", "x"), s("a", "1", "x"), false, s("b", "1", "x"), nil, []int{0}, true},
		{"different fields", s("a", "2", "x"), s("b", "1", "x"), s("a", "1", "x"), false, s("b", "2", "x"), []int{1}, []int{0}, true},
		{"both edited, local wins", s("a", "2", "x"), s("a", "3", "x"), s("a", "1", "x"), false, s("a", "2", "x"), []int{1}, nil, true},
		{"external, remote wins", s("a", "1", "local"), s("a", "1", "sheet"), s("a", "1", "old"), false, s("a", "1", "sheet"), nil, []int{2}, true},
		{"no base, remote wins", s("a", "2", "x"), s("a", "1", "x"), nil, false, s("a", "1", "x"), nil, []int{1}, true},
		{"pull only", s("a", "2", "x"), s("a", "1", "x"), s("a", "1", "x"), true, s("a", "1", "x"), nil, []int{1}, true},
		{"stale base only", s("a", "1", "x"), s("a", "1", "x"), s("a", "0", "x"), false, s("a", "1", "x"), nil, nil, true},
	}
	for _, tc := range cases {
		m := merge(tc.local, tc.remote, tc.base, fields3, tc.pull)
		if !equal(m.final, tc.wantFinal) {
			t.Errorf("%s: final %v, want %v", tc.name, m.final, tc.wantFinal)
		}
		if !sameSet(m.toRemote, tc.toRemote) || !sameSet(m.toLocal, tc.toLocal) {
			t.Errorf("%s: toRemote %v toLocal %v, want %v %v", tc.name, m.toRemote, m.toLocal, tc.toRemote, tc.toLocal)
		}
		if m.dirty != tc.dirty {
			t.Errorf("%s: dirty %v, want %v", tc.name, m.dirty, tc.dirty)
		}
	}
}

func s(v ...string) []string { return v }

func sameSet(m map[int]bool, want []int) bool {
	if len(m) != len(want) {
		return false
	}
	for _, i := range want {
		if !m[i] {
			return false
		}
	}
	return true
}

func TestPropertyRoundTrip(t *testing.T) {
	cases := []struct {
		field finance.Field
		text  string
	}{
		{finance.Field{Name: "Name", Kind: "title"}, "Makan siang"},
		{finance.Field{Name: "Notes", Kind: "rich_text"}, "line 1\nline 2"},
		{finance.Field{Name: "Type", Kind: "select"}, "Keluar"},
		{finance.Field{Name: "Type", Kind: "select"}, ""},
		{finance.Field{Name: "Amount", Kind: "number"}, "65000"},
		{finance.Field{Name: "Amount", Kind: "number"}, ""},
		{finance.Field{Name: "Date", Kind: "date"}, "2026-10-01"},
		{finance.Field{Name: "Date", Kind: "date"}, "2026-10-01T12:30"},
	}
	for _, tc := range cases {
		payload, err := toNotion(tc.text, tc.field)
		if err != nil {
			t.Fatalf("toNotion(%q): %v", tc.text, err)
		}
		raw := responseShape(t, tc.field.Kind, payload)
		got, err := fromNotion(raw, tc.field)
		if err != nil || got != tc.text {
			t.Errorf("%s %q: round trip gave %q, %v", tc.field.Kind, tc.text, got, err)
		}
	}
}

// responseShape turns a request payload into the shape Notion returns for it.
func responseShape(t *testing.T, kind string, payload any) json.RawMessage {
	t.Helper()
	b, _ := json.Marshal(payload)
	var m map[string]any
	_ = json.Unmarshal(b, &m)
	m["type"] = kind
	if kind == "title" || kind == "rich_text" {
		parts, _ := m[kind].([]any)
		for _, p := range parts {
			pm := p.(map[string]any)
			pm["plain_text"] = pm["text"].(map[string]any)["content"]
		}
	}
	out, _ := json.Marshal(m)
	return out
}

func TestDateFromNotionWithOffset(t *testing.T) {
	raw := json.RawMessage(`{"type":"date","date":{"start":"2026-09-29T14:00:00.000+00:00"}}`)
	got, err := fromNotion(raw, finance.Field{Name: "Date", Kind: "date"})
	if err != nil || got != "2026-09-29T21:00" {
		t.Errorf("got %q, %v; want 2026-09-29T21:00 (WIB)", got, err)
	}
	raw = json.RawMessage(`{"type":"date","date":{"start":"2026-09-29T00:00:00.000+07:00"}}`)
	if got, _ := fromNotion(raw, finance.Field{Name: "Date", Kind: "date"}); got != "2026-09-29" {
		t.Errorf("midnight should collapse to the date, got %q", got)
	}
}

func TestTypeMismatchIsAnError(t *testing.T) {
	raw := json.RawMessage(`{"type":"rich_text","rich_text":[]}`)
	if _, err := fromNotion(raw, finance.Field{Name: "Amount", Kind: "number"}); err == nil {
		t.Error("expected an error when Notion changed the property type")
	}
}

func TestValidSignature(t *testing.T) {
	body := []byte(`{"type":"page.created"}`)
	mac := hmac.New(sha256.New, []byte("secret-token"))
	mac.Write(body)
	sig := "sha256=" + hex.EncodeToString(mac.Sum(nil))
	if !validSignature(body, sig, "secret-token") {
		t.Error("valid signature rejected")
	}
	if validSignature(body, sig, "other") || validSignature(body, "sha256=00", "secret-token") || validSignature(body, "", "secret-token") {
		t.Error("invalid signature accepted")
	}
}
