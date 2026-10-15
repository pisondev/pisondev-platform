# pisondev platform

Personal platform behind `pisondev.com`. The first part is the private assistant
workspace at `assistant.pisondev.com`, starting with the Finance Assistant.

| Path | What | Stack |
|---|---|---|
| [`apps/assistant-web`](apps/assistant-web) | Private web app: home, `/finance`, later `/meeting` | Next.js 16, React 19, Tailwind 4 |
| [`services/api`](services/api) | API, auth, finance rules, Notion sync | Go 1.25, Gin, PostgreSQL 17 |
| [`docs`](docs) | Architecture, sync, finance rules, setup | |
| [`design`](design) | How the Figma design is exported and used | |
| [`scripts`](scripts), [`.githooks`](.githooks) | Commit and secret guards, shared by hooks and CI | Bash |

Public web (`pisondev.com`) and other private modules come later as new folders under
`apps/` and new modules under `services/api/internal/`.

## How it fits together

```
browser ─▶ assistant-web (Next.js) ─/api─▶ api (Go) ─▶ PostgreSQL
                                             │
                                             ▼
                                   Notion ◀──▶ Google Sheet
                                   (hub)       (existing Apps Script sync)
```

- **Access**: Google sign-in, limited to an allowlist of two accounts (main and backup).
  See [docs/architecture.md](docs/architecture.md#access).
- **Data**: PostgreSQL is the app database. It stays in sync with the Finance Assistant's
  Notion databases, and through them with the Google Sheet. See [docs/notion-sync.md](docs/notion-sync.md).
- **Rules**: balance, weekly quota, savings and the subscription list follow the sheet
  exactly. See [docs/finance-rules.md](docs/finance-rules.md).

## Quick start

Needs Docker, Go 1.25 and pnpm 10.

```bash
git config core.hooksPath .githooks       # once per clone: commit and secret guards

docker compose up -d postgres             # PostgreSQL on 127.0.0.1:5442

cd services/api
cp .env.example .env                      # fill in, see docs/setup.md
go run ./cmd/api sync --dry-run           # preview the first Notion pull
go run ./cmd/api                          # API on :8100

cd ../../apps/assistant-web
pnpm install
pnpm dev                                  # web on http://localhost:3100
```

To stop: Ctrl+C in both terminals, then `docker compose stop` (data stays in the volume).

Full setup, including the Google OAuth client and the Notion integration:
[docs/setup.md](docs/setup.md).

## Commands

| Where | Command | Does |
|---|---|---|
| `services/api` | `go run ./cmd/api` | Serve the API and run the sync loop |
| | `go run ./cmd/api sync [--dry-run] [--force]` | One sync now, prints every change |
| | `go run ./cmd/api report` | Quota and savings from the local database, as JSON |
| | `go run ./cmd/api webhook-token` | Print the Notion webhook verification token |
| | `go test ./...` | Unit tests; set `TEST_DATABASE_URL` to also run the sync integration tests |
| `apps/assistant-web` | `pnpm dev` / `pnpm build` / `pnpm lint` | Develop, build, lint |

## Repository rules

- Comments, docs, logs and commit messages are in short, plain English.
- No AI attribution anywhere: `.githooks/commit-msg` and the CI `guards` job reject
  `Co-Authored-By` trailers and similar markers.
- No secrets in git: `.githooks/pre-commit`, the CI `guards` job and gitleaks block
  tokens, keys, `.env` files and AI tool state (`.claude/`, `CLAUDE.local.md`, ...), and
  GitHub secret scanning with push protection is on for the repository. Real values live
  only in `.env`.
- [CLAUDE.md](CLAUDE.md) is the working guide for coding sessions: rules, checks and
  gotchas. Status and next steps are in [docs/roadmap.md](docs/roadmap.md).
- Every change that needs it updates this README and [CHANGELOG.md](CHANGELOG.md), with a date.
