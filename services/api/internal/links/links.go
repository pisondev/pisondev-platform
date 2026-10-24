// Package links is the link shortener: short slugs on their own host that redirect to a
// target URL, managed from the assistant app and counted per visit.
package links

import (
	"crypto/rand"
	"errors"
	"math/big"
	"net/url"
	"regexp"
	"strings"
	"time"
)

// Link is one short link.
type Link struct {
	ID            string     `json:"id"`
	Slug          string     `json:"slug"`
	ShortURL      string     `json:"shortUrl"`
	Target        string     `json:"target"`
	Title         string     `json:"title"`
	Notes         string     `json:"notes"`
	Enabled       bool       `json:"enabled"`
	ExpiresAt     *time.Time `json:"expiresAt"`
	Clicks        int64      `json:"clicks"`
	LastClickedAt *time.Time `json:"lastClickedAt"`
	CreatedAt     time.Time  `json:"createdAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	CreatedBy     string     `json:"createdBy"`
}

// Live reports whether the link redirects at time now.
func (l Link) Live(now time.Time) bool {
	return l.Enabled && (l.ExpiresAt == nil || now.Before(*l.ExpiresAt))
}

const (
	maxSlug   = 64
	maxTarget = 2048
	maxTitle  = 120
	maxNotes  = 500

	// Random slugs leave out look-alike characters (0/o, 1/l/i) so they can be read out
	// and typed. 31^6 is about 887 million.
	slugAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"
	randomLength = 6
)

var slugPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]*$`)

// reserved are paths the redirect host serves itself, or may later.
var reserved = map[string]bool{
	"api": true, "healthz": true, "robots.txt": true, "favicon.ico": true,
	"admin": true, "login": true, "static": true, "_next": true, "www": true,
}

// NormalizeSlug lowercases and checks a custom slug. Slugs are case-insensitive, so
// go.example/CV and go.example/cv are the same link.
func NormalizeSlug(raw string) (string, error) {
	s := strings.ToLower(strings.Trim(strings.TrimSpace(raw), "/"))
	switch {
	case s == "":
		return "", errors.New("Slug is empty.")
	case len(s) > maxSlug:
		return "", errors.New("Slug is longer than 64 characters.")
	case !slugPattern.MatchString(s):
		return "", errors.New("Use letters, digits, - and _ only, starting with a letter or digit.")
	case reserved[s]:
		return "", errors.New("This slug is reserved.")
	}
	return s, nil
}

// RandomSlug returns a new random slug.
func RandomSlug() string {
	b := make([]byte, randomLength)
	max := big.NewInt(int64(len(slugAlphabet)))
	for i := range b {
		n, err := rand.Int(rand.Reader, max)
		if err != nil {
			panic(err) // crypto/rand never fails on supported platforms
		}
		b[i] = slugAlphabet[n.Int64()]
	}
	return string(b)
}

// NormalizeTarget checks a target URL: absolute http or https, no credentials, and not
// a link back to the short host itself (that would loop).
func NormalizeTarget(raw, shortHost string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", errors.New("Target URL is empty.")
	}
	if len(s) > maxTarget {
		return "", errors.New("Target URL is longer than 2048 characters.")
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("Target must be a full http:// or https:// URL.")
	}
	if u.User != nil {
		return "", errors.New("Target must not contain a user name or password.")
	}
	if shortHost != "" && strings.EqualFold(u.Hostname(), shortHost) {
		return "", errors.New("Target cannot be another short link.")
	}
	return u.String(), nil
}

// withQuery adds the visit's query parameters to the target, without replacing the
// target's own, so go.example/cv?ref=ig reaches the target with ref=ig.
func withQuery(target string, visit url.Values) string {
	if len(visit) == 0 {
		return target
	}
	u, err := url.Parse(target)
	if err != nil {
		return target
	}
	q := u.Query()
	for k, vs := range visit {
		if _, ok := q[k]; !ok {
			q[k] = vs
		}
	}
	u.RawQuery = q.Encode()
	return u.String()
}

var botPattern = regexp.MustCompile(`(?i)bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|embedly|curl|wget|python|go-http-client|okhttp|headless|lighthouse`)

var mobilePattern = regexp.MustCompile(`(?i)mobile|android|iphone|ipad|ipod`)

// device classifies a visit by its user agent. HEAD requests are link checkers.
func device(userAgent, method string) (string, bool) {
	if method == "HEAD" || userAgent == "" || botPattern.MatchString(userAgent) {
		return "bot", true
	}
	if mobilePattern.MatchString(userAgent) {
		return "mobile", false
	}
	return "desktop", false
}

// referrerHost keeps only the host of a Referer header.
func referrerHost(ref string) string {
	u, err := url.Parse(ref)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimPrefix(u.Hostname(), "www."))
}
