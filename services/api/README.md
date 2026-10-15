# api

Go API for the platform: auth, finance rules, Notion sync. Gin, pgx, goose migrations
(applied on startup).

```bash
cp .env.example .env
go run ./cmd/api                      # serve on :8100 and run the sync loop
go run ./cmd/api sync --dry-run       # preview one sync
go run ./cmd/api report               # quota and savings as JSON
TEST_DATABASE_URL=postgres://pisondev:pisondev@localhost:5442/pisondev_test?sslmode=disable go test ./...
```

Environment variables are documented in [`.env.example`](.env.example). Design notes:
[architecture](../../docs/architecture.md), [Notion sync](../../docs/notion-sync.md),
[finance rules](../../docs/finance-rules.md).
