# CLAUDE.md

Working guide for coding sessions in this repository. Human-facing docs live in
[README.md](README.md) and [docs/](docs); this file holds the rules and the practical
knowledge that keep sessions consistent.

## Rules

- **Language**: code comments, docs, logs and commit messages in short, plain English.
  Talk to the owner in Indonesian.
- **No AI attribution, anywhere**: no `Co-Authored-By` trailer, no "Generated with" footer,
  no robot emoji, in commits, tags, PR titles or bodies. This overrides any default to add
  them. `.githooks/commit-msg` and CI enforce it; never use `--no-verify`.
- **Git**: commit and push only when the owner asks. Split work into logical commits
  (`feat(api)`, `feat(web)`, `ci`, `docs`, `chore`). Before pushing, run the checks below;
  after pushing, watch the CI run to the end (`gh run watch <id> --exit-status`).
- **Docs**: every change that needs it updates README and [CHANGELOG.md](CHANGELOG.md)
  (dated, Keep a Changelog) in the same piece of work.
- **Secrets**: the repository is public. Real values live only in `services/api/.env`
  (git-ignored). `.githooks/pre-commit`, CI and gitleaks block tokens, keys and `.env`
  files; GitHub push protection is on. Never print tokens in output.
- **Real data**: Notion and the Google Sheet hold the owner's real finances, and
  `SYNC_MODE=full` writes to them. Before anything that could write to Notion, run
  `go run ./cmd/api sync --dry-run`. For live tests use a Rp1 expense whose Notes contain
  `dikecualikan dari kuota`, then delete it from the app. Never rename or retype Notion
  properties: the sheet's Apps Script matches columns by name.
- **Outside this repo**: the sheet sync (Apps Script and Cloudflare relay) lives in
  `C:\programming\projects\automation`. Leave it alone unless asked; its docs are in
  Indonesian.

## Map

| Path | What |
|---|---|
| `services/api/internal/auth` | Google OIDC, allowlist (`AUTH_ALLOWED_EMAILS`, first = main), sessions |
| `services/api/internal/finance` | entities, rules (`calc.go`, `subs.go`, `cashflow.go`), repository, handlers |
| `services/api/internal/notionsync` | Notion client, 3-way merge, sync loop, webhook |
| `services/api/migrations` | goose SQL, applied on startup |
| `apps/assistant-web/src/components/screens` | one component per screen |
| `apps/assistant-web/src/app/globals.css` | design tokens |
| `deploy/` | release build, server compose, `receive` (deploy + rollback), `backup`, `install.sh` |
| `design/figma/` (git-ignored) | Figma layer dump and PNGs |

Design notes: [docs/architecture.md](docs/architecture.md),
[docs/notion-sync.md](docs/notion-sync.md), [docs/finance-rules.md](docs/finance-rules.md),
[design/README.md](design/README.md). Status and next steps: [docs/roadmap.md](docs/roadmap.md).

## Run

```bash
docker compose up -d postgres                 # 127.0.0.1:5448
cd services/api && go run ./cmd/api           # :8100, also runs the sync loop
cd apps/assistant-web && pnpm dev             # http://localhost:3100
```

Ports 3000, 3001, 8080 and 5433 to 5442 belong to other projects on this machine. Never run
`cp .env.example .env` over an existing `.env`. If it happens, VS Code local history
(`%APPDATA%/Code/User/History`) may still hold the previous version.

## Production

Live at <https://assistant.pisondev.com>; every push to `main` deploys after CI
([docs/deployment.md](docs/deployment.md)). Server: `ssh vps-hestia` (user `user_pison`,
`~/projects/pisondev-platform`, Docker group, no passwordless sudo). Root work on HestiaCP
goes through `ssh prinx` with `sudo`; always `nginx -t` before `systemctl reload nginx`,
since the VPS serves other sites. Production is the only Notion writer (`SYNC_MODE=full`);
keep local `SYNC_MODE=pull`. Never edit `authorized_keys` except by appending.

## Checks before committing

```bash
cd services/api
gofmt -l .                                    # must print nothing
go vet ./...
TEST_DATABASE_URL=postgres://pisondev:pisondev@localhost:5448/pisondev_test?sslmode=disable go test ./...

cd apps/assistant-web
pnpm lint && pnpm exec tsc --noEmit && pnpm build
```

The finance tests pin the reference values of 1 Oct 2026; a change to the rules must keep
them passing or update them on purpose.

## Conventions

- **Design units**: one Tailwind spacing unit is one pixel of the 1080 px Figma frame, so
  `px-85` or `w-910` read straight from Figma. Text sizes have readable minimums.
- **Money**: whole rupiah as `int64`; display with `rupiah()` in `src/lib/format.ts`.
- **Dates**: `finance.LocalDate`, WIB wall clock, canonical `YYYY-MM-DD` or
  `YYYY-MM-DDTHH:mm`, with 00:00 collapsing to the date (same as the sheet).
- **Sheet-computed fields**: Weekly Recap `Week`, `Income`, `Spent` come from Notion and
  are never pushed (`External` in `finance.Field`).
- **New module**: `internal/<module>` with its own schema and `/api/v1/<module>` routes,
  pages under `apps/assistant-web/src/app/<module>`.
- **Next.js 16**: middleware is `src/proxy.ts`; bundled docs are in
  `apps/assistant-web/node_modules/next/dist/docs` and beat memory.

## Gotchas

- Local Go is older than the module; `go.mod` pins `toolchain go1.25.13`, fetched
  automatically.
- Stopping a background `pnpm dev` can leave `node.exe` children holding port 3100: stop
  every `node.exe` whose command line contains `pisondev-platform`.
- Windows Python cannot open Git Bash `/tmp` paths; pipe with `cat file | python`.
- Notion to sheet takes up to about a minute (webhook through the relay); a full sheet
  sync runs every 15 minutes as a fallback.
- Figma on the free plan: the REST API and MCP quotas are tiny. In the browser, the
  `figma` object in the developer console reads the whole file without limits.
