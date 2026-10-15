// Command api runs the pisondev platform API.
//
//	api                 serve HTTP (default)
//	api serve           same
//	api migrate         apply database migrations and exit
//	api sync [--dry-run] [--force]
//	                    run one Notion sync and print the changes
//	api report          print balance, quota and savings from the local database
//	api webhook-token   print the stored Notion webhook verification token
package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pisondev/pisondev-platform/services/api/internal/auth"
	"github.com/pisondev/pisondev-platform/services/api/internal/config"
	"github.com/pisondev/pisondev-platform/services/api/internal/finance"
	"github.com/pisondev/pisondev-platform/services/api/internal/notionsync"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/database"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

func main() {
	cmd := "serve"
	args := os.Args[1:]
	if len(args) > 0 && args[0] != "" && args[0][0] != '-' {
		cmd, args = args[0], args[1:]
	}
	if err := run(cmd, args); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(cmd string, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("config: %w", err)
	}
	log := newLogger(cfg)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := database.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := database.Migrate(ctx, pool, log); err != nil {
		return err
	}

	app := wire(cfg, pool, log)
	switch cmd {
	case "serve":
		return serve(ctx, cfg, app, log)
	case "migrate":
		return nil
	case "sync":
		fs := flag.NewFlagSet("sync", flag.ContinueOnError)
		dry := fs.Bool("dry-run", false, "plan only, write nothing")
		force := fs.Bool("force", false, "allow mass deletes")
		if err := fs.Parse(args); err != nil {
			return err
		}
		if app.syncer == nil {
			return errors.New("SYNC_MODE is off")
		}
		changes, err := app.syncer.RunOnce(ctx, notionsync.Options{DryRun: *dry, Force: *force})
		for _, c := range changes {
			fmt.Printf("%-13s %-16s %s %v\n", c.Table, c.Action, c.Label, c.Fields)
		}
		fmt.Printf("%d change(s), mode=%s, dry-run=%v\n", len(changes), app.syncer.Mode(), *dry)
		return err
	case "report":
		return report(ctx, app)
	case "webhook-token":
		if app.webhook == nil {
			return errors.New("SYNC_MODE is off")
		}
		token, err := app.webhook.Token(ctx)
		if err != nil {
			return err
		}
		if token == "" {
			return errors.New("no token yet: create the webhook subscription in Notion first")
		}
		fmt.Println(token)
		return nil
	}
	return fmt.Errorf("unknown command %q", cmd)
}

type app struct {
	auth     *auth.Handler
	sessions *auth.Sessions
	allowed  auth.Allowlist
	finance  *finance.Service
	syncer   *notionsync.Syncer
	webhook  *notionsync.Webhook
	pool     *pgxpool.Pool
}

func wire(cfg config.Config, pool *pgxpool.Pool, log *slog.Logger) app {
	a := app{pool: pool, allowed: auth.Allowlist(cfg.Auth.AllowedEmails)}
	a.sessions = auth.NewSessions(pool, cfg.Auth.SessionTTL)
	a.auth = auth.NewHandler(auth.Options{
		Allowed:            a.allowed,
		GoogleClientID:     cfg.Auth.GoogleClientID,
		GoogleClientSecret: cfg.Auth.GoogleClientSecret,
		PublicBaseURL:      cfg.PublicBaseURL,
		CookieSecure:       cfg.Auth.CookieSecure,
		CookieDomain:       cfg.Auth.CookieDomain,
		DevLogin:           cfg.Auth.DevLogin,
	}, a.sessions, log)

	repo := finance.NewRepository(pool)
	var notifier finance.Notifier
	var writable func() error
	if cfg.Sync.Mode != notionsync.ModeOff {
		client := notionsync.NewClient(cfg.Notion.Token)
		trx, subs, weeks := repo.SyncStores()
		a.syncer = notionsync.NewSyncer(client, pool, []notionsync.Table{
			{Store: trx, DBID: cfg.Notion.TransactionsDB},
			{Store: subs, DBID: cfg.Notion.SubscriptionsDB},
			{Store: weeks, DBID: cfg.Notion.WeeksDB},
		}, repo.SaveOptions, cfg.Sync.Mode, cfg.Sync.Interval, log)
		a.webhook = notionsync.NewWebhook(pool, a.syncer, client, cfg.Notion.WebhookToken, log)
		notifier, writable = a.syncer, a.syncer.Writable
	}
	a.finance = finance.NewService(repo, finance.Rules{
		Account:            cfg.Finance.Account,
		AnchorSubscription: cfg.Finance.AnchorSubscription,
		WeeklyAllowance:    cfg.Finance.WeeklyAllowance,
		MinBalance:         cfg.Finance.MinBalance,
		ExcludeMarker:      cfg.Finance.ExcludeMarker,
	}, clock.System, notifier, writable)
	return a
}

func serve(ctx context.Context, cfg config.Config, a app, log *slog.Logger) error {
	if cfg.IsProduction() {
		gin.SetMode(gin.ReleaseMode)
	}
	if cfg.Auth.DevLogin {
		log.Warn("AUTH_DEV_LOGIN is on: any allowed email can sign in without Google (development only)")
	}
	r := gin.New()
	r.Use(httpx.Recover(log), httpx.Logger(log), httpx.SecurityHeaders(), httpx.BodyLimit(1<<20))
	_ = r.SetTrustedProxies([]string{"127.0.0.1", "::1"})

	r.GET("/healthz", func(c *gin.Context) {
		if err := a.pool.Ping(c.Request.Context()); err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"status": "db down"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"status": "ok"})
	})

	v1 := r.Group("/api/v1")
	if a.webhook != nil {
		v1.POST("/webhooks/notion", a.webhook.Handle) // signed by Notion, no session
	}
	public := v1.Group("", httpx.SameOrigin(cfg.PublicBaseURL))
	private := v1.Group("", httpx.SameOrigin(cfg.PublicBaseURL), a.auth.Require())
	a.auth.Register(public, private)
	finance.NewHandler(a.finance).Register(private)
	private.GET("/sync", notionsync.StatusHandler(a.pool, a.syncer))
	private.POST("/sync", notionsync.TriggerHandler(a.syncer))
	r.NoRoute(func(c *gin.Context) { httpx.Fail(c, httpx.NotFound("No such route.")) })

	srv := &http.Server{Addr: cfg.HTTPAddr, Handler: r, ReadHeaderTimeout: 10 * time.Second}
	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()
	if a.syncer != nil {
		go a.syncer.Run(ctx)
	}
	go purgeSessions(ctx, a, log)
	log.Info("api listening", "addr", cfg.HTTPAddr, "env", cfg.Env, "sync", cfg.Sync.Mode)

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	log.Info("shutting down")
	return srv.Shutdown(shutdown)
}

func purgeSessions(ctx context.Context, a app, log *slog.Logger) {
	t := time.NewTicker(time.Hour)
	defer t.Stop()
	for {
		if err := a.sessions.PurgeExpired(ctx, a.allowed); err != nil && ctx.Err() == nil {
			log.Error("purge sessions", "err", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

func report(ctx context.Context, a app) error {
	snap, err := a.finance.Snapshot(ctx)
	if err != nil {
		return err
	}
	q := finance.ComputeQuota(snap, a.finance.Rules(), clock.System())
	out, _ := json.MarshalIndent(q, "", "  ")
	fmt.Println(string(out))
	return nil
}

func newLogger(cfg config.Config) *slog.Logger {
	var h slog.Handler
	if cfg.IsProduction() {
		h = slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})
	} else {
		h = slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelDebug})
	}
	l := slog.New(h)
	slog.SetDefault(l)
	return l
}
