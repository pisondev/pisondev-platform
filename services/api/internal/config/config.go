// Package config reads all runtime settings from the environment.
package config

import (
	"bufio"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Env           string // development or production
	HTTPAddr      string
	PublicBaseURL string // origin the browser uses, e.g. https://assistant.pisondev.com
	DatabaseURL   string

	Auth    Auth
	Notion  Notion
	Sync    Sync
	Finance Finance
}

type Auth struct {
	AllowedEmails      []string // first entry is the main account, the rest are backups
	GoogleClientID     string
	GoogleClientSecret string
	SessionTTL         time.Duration
	CookieSecure       bool
	CookieDomain       string // empty: host-only cookie
	DevLogin           bool   // development shortcut, refused in production
}

type Notion struct {
	Token           string
	TransactionsDB  string
	SubscriptionsDB string
	WeeksDB         string
	WebhookToken    string
}

type Sync struct {
	Mode     string // off, pull, full
	Interval time.Duration
}

type Finance struct {
	Account            string // the tracked bank account
	AnchorSubscription string // its Next Billing is the quota deadline
	WeeklyAllowance    int64
	MinBalance         int64
	ExcludeMarker      string // Notes phrase that keeps a row out of the quota
}

func (c Config) IsProduction() bool { return c.Env == "production" }

// Load reads the environment, after loading an optional .env file in the working
// directory. Variables already set in the environment win over the file.
func Load() (Config, error) {
	if err := loadDotEnv(".env"); err != nil {
		return Config{}, err
	}
	env := get("APP_ENV", "development")
	c := Config{
		Env:           env,
		HTTPAddr:      get("HTTP_ADDR", ":8100"),
		PublicBaseURL: strings.TrimRight(get("PUBLIC_BASE_URL", "http://localhost:3100"), "/"),
		DatabaseURL:   get("DATABASE_URL", ""),
		Auth: Auth{
			AllowedEmails:      emails(get("AUTH_ALLOWED_EMAILS", "")),
			GoogleClientID:     get("GOOGLE_CLIENT_ID", ""),
			GoogleClientSecret: get("GOOGLE_CLIENT_SECRET", ""),
			CookieDomain:       get("COOKIE_DOMAIN", ""),
		},
		Notion: Notion{
			Token:           get("NOTION_TOKEN", ""),
			TransactionsDB:  bareID(get("NOTION_TRANSACTIONS_DB", "")),
			SubscriptionsDB: bareID(get("NOTION_SUBSCRIPTIONS_DB", "")),
			WeeksDB:         bareID(get("NOTION_WEEKS_DB", "")),
			WebhookToken:    get("NOTION_WEBHOOK_TOKEN", ""),
		},
		Sync: Sync{Mode: get("SYNC_MODE", "pull")},
		Finance: Finance{
			Account:            get("FINANCE_ACCOUNT", "Mandiri Debit"),
			AnchorSubscription: get("FINANCE_ANCHOR_SUBSCRIPTION", "Claude"),
			ExcludeMarker:      get("FINANCE_EXCLUDE_MARKER", "dikecualikan dari kuota"),
		},
	}

	var err error
	var errs []error
	if c.Auth.SessionTTL, err = duration("SESSION_TTL", "720h"); err != nil {
		errs = append(errs, err)
	}
	if c.Sync.Interval, err = duration("SYNC_INTERVAL", "60s"); err != nil {
		errs = append(errs, err)
	}
	if c.Auth.CookieSecure, err = boolean("COOKIE_SECURE", c.Env == "production"); err != nil {
		errs = append(errs, err)
	}
	if c.Auth.DevLogin, err = boolean("AUTH_DEV_LOGIN", false); err != nil {
		errs = append(errs, err)
	}
	if c.Finance.WeeklyAllowance, err = integer("FINANCE_WEEKLY_ALLOWANCE", 250000); err != nil {
		errs = append(errs, err)
	}
	if c.Finance.MinBalance, err = integer("FINANCE_MIN_BALANCE", 50000); err != nil {
		errs = append(errs, err)
	}
	errs = append(errs, c.validate()...)
	return c, errors.Join(errs...)
}

func (c Config) validate() []error {
	var errs []error
	if c.Env != "development" && c.Env != "production" {
		errs = append(errs, fmt.Errorf("APP_ENV must be development or production, got %q", c.Env))
	}
	if c.DatabaseURL == "" {
		errs = append(errs, errors.New("DATABASE_URL is required"))
	}
	if len(c.Auth.AllowedEmails) == 0 {
		errs = append(errs, errors.New("AUTH_ALLOWED_EMAILS needs at least one address"))
	}
	if u, err := url.Parse(c.PublicBaseURL); err != nil || u.Scheme == "" || u.Host == "" {
		errs = append(errs, fmt.Errorf("PUBLIC_BASE_URL must be an absolute URL, got %q", c.PublicBaseURL))
	}
	if c.IsProduction() {
		if c.Auth.DevLogin {
			errs = append(errs, errors.New("AUTH_DEV_LOGIN cannot be enabled in production"))
		}
		if !c.Auth.CookieSecure {
			errs = append(errs, errors.New("COOKIE_SECURE must be true in production"))
		}
		if c.Auth.GoogleClientID == "" || c.Auth.GoogleClientSecret == "" {
			errs = append(errs, errors.New("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required in production"))
		}
	}
	switch c.Sync.Mode {
	case "off":
	case "pull", "full":
		if c.Notion.Token == "" || c.Notion.TransactionsDB == "" || c.Notion.SubscriptionsDB == "" || c.Notion.WeeksDB == "" {
			errs = append(errs, fmt.Errorf("SYNC_MODE=%s needs NOTION_TOKEN and the three NOTION_*_DB ids", c.Sync.Mode))
		}
	default:
		errs = append(errs, fmt.Errorf("SYNC_MODE must be off, pull or full, got %q", c.Sync.Mode))
	}
	if c.Sync.Interval < 10*time.Second {
		errs = append(errs, errors.New("SYNC_INTERVAL must be at least 10s"))
	}
	return errs
}

func get(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	return fallback
}

func duration(key, fallback string) (time.Duration, error) {
	d, err := time.ParseDuration(get(key, fallback))
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return d, nil
}

func boolean(key string, fallback bool) (bool, error) {
	v := get(key, strconv.FormatBool(fallback))
	b, err := strconv.ParseBool(v)
	if err != nil {
		return false, fmt.Errorf("%s: %w", key, err)
	}
	return b, nil
}

func integer(key string, fallback int64) (int64, error) {
	n, err := strconv.ParseInt(get(key, strconv.FormatInt(fallback, 10)), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	return n, nil
}

func emails(raw string) []string {
	var out []string
	seen := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		e := strings.ToLower(strings.TrimSpace(part))
		if e != "" && !seen[e] {
			seen[e] = true
			out = append(out, e)
		}
	}
	return out
}

// bareID strips dashes so Notion ids compare equal in either form.
func bareID(id string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(id), "-", ""))
}

// loadDotEnv sets KEY=VALUE pairs from path for keys not already in the environment.
func loadDotEnv(path string) error {
	f, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(strings.TrimPrefix(key, "export "))
		if _, set := os.LookupEnv(key); !set {
			os.Setenv(key, dotEnvValue(value))
		}
	}
	return sc.Err()
}

// dotEnvValue unquotes a value, or drops a trailing " # comment" from an unquoted one.
func dotEnvValue(raw string) string {
	v := strings.TrimSpace(raw)
	if len(v) >= 2 && (v[0] == '"' || v[0] == '\'') {
		if end := strings.IndexByte(v[1:], v[0]); end >= 0 {
			return v[1 : end+1]
		}
	}
	for i := 1; i < len(v); i++ {
		if v[i] == '#' && (v[i-1] == ' ' || v[i-1] == '\t') {
			return strings.TrimSpace(v[:i])
		}
	}
	return v
}
