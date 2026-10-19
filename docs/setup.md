# Setup

## Local development

1. `git config core.hooksPath .githooks`
2. `docker compose up -d postgres`: PostgreSQL 17 on `127.0.0.1:5448`, databases
   `pisondev` and `pisondev_test` (user and password `pisondev`, local only).
3. `services/api/.env` from `.env.example`. Never commit it.
4. `go run ./cmd/api` in `services/api` (port 8100), `pnpm dev` in `apps/assistant-web`
   (port 3100). Open <http://localhost:3100>.

Without Google configured, set `AUTH_DEV_LOGIN=true` to sign in with an allowed email on
the login page. The API refuses to start with it in production.

## Google sign-in

Google Cloud project `pisondev-platform` (owned by the backup account), in
<https://console.cloud.google.com/auth/overview?project=pisondev-platform>:

| Item | State |
|---|---|
| Consent screen | app "pisondev assistant", audience External, status Testing |
| Test users | both allowed accounts; while in Testing, Google refuses every other account |
| Web client | origin `http://localhost:3100`, redirect `http://localhost:3100/api/v1/auth/google/callback` |
| Credentials | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` in `services/api/.env` only |

On a new machine, copy the client ID and secret into `.env`; the secret can be reset from
the client page if lost. At deployment, add `https://assistant.pisondev.com` as an origin
and `https://assistant.pisondev.com/api/v1/auth/google/callback` as a redirect URI.

## Notion

Integration `pisondev-platform` exists in workspace Private Room, with access to the
Finance Assistant page and its three databases. Its token is in `services/api/.env`.

To rotate the token: Notion > Settings > Connections > Develop or manage integrations >
`pisondev-platform` > Configuration, refresh the API token, update `.env`.

Database ids for `.env`:

| Variable | Database |
|---|---|
| `NOTION_TRANSACTIONS_DB` | Transactions |
| `NOTION_SUBSCRIPTIONS_DB` | Subscriptions |
| `NOTION_WEEKS_DB` | Weekly Recap |

## Going two-way

`.env.example` starts in `SYNC_MODE=pull`, which only reads Notion and refuses edits in the
web app. On a new machine, after the first pull:

1. `SYNC_MODE=full go run ./cmd/api sync --dry-run` must report 0 changes.
2. Set `SYNC_MODE=full` in `.env` and restart.
3. Optional round trip: add a Rp1 expense with Notes containing `dikecualikan dari kuota`
   (left out of the quota), check Notion and the sheet, then delete it from the web app.

Done on 15 Oct 2026: the dry run reported 0 changes, and the Rp1 round trip reached
Notion within 6 s and the sheet within a minute, both for the new row and its deletion.

## Deployment

See [deployment.md](deployment.md). Once production runs, keep local `SYNC_MODE=pull`:
production is the only writer to Notion.
