# api

Go API for the platform: auth, finance, Notion sync, links, and meeting availability.
Gin, pgx, goose migrations
(applied on startup).

```bash
[ -f .env ] || cp .env.example .env   # first time only; never overwrite a filled .env
go run ./cmd/api                      # serve on :8100 and run the sync loop
go run ./cmd/api sync --dry-run       # preview one sync
go run ./cmd/api report               # quota and savings as JSON
TEST_DATABASE_URL=postgres://pisondev:pisondev@localhost:5448/pisondev_test?sslmode=disable go test ./...
```

Environment variables are documented in [`.env.example`](.env.example). Design notes:
[architecture](../../docs/architecture.md), [Notion sync](../../docs/notion-sync.md),
[finance rules](../../docs/finance-rules.md), [meeting availability](../../docs/meeting.md).
