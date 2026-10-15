# Setup

## Local development

1. `git config core.hooksPath .githooks`
2. `docker compose up -d postgres`: PostgreSQL 17 on `127.0.0.1:5442`, databases
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

`SYNC_MODE=pull` only reads Notion and refuses edits in the web app. When ready:

1. `go run ./cmd/api sync --dry-run` must show no unexpected pushes.
2. Set `SYNC_MODE=full` and restart.
3. Add a small test transaction in the web app; within a minute it should appear in
   Notion and in the sheet. Delete it from the web app; it disappears from both.

## Deployment (after the domain is bought)

Planned shape, to be done together:

- VPS with Docker: PostgreSQL, the API, the web app, and Caddy for TLS.
- Caddy routes `assistant.pisondev.com/api/*` to the API and everything else to the web app.
- Production `.env`: `APP_ENV=production`, `PUBLIC_BASE_URL=https://assistant.pisondev.com`,
  `COOKIE_SECURE=true`, `AUTH_DEV_LOGIN=false`.
- Add the production origin and redirect URI to the Google client.
- Subscribe the Notion webhook, see [notion-sync.md](notion-sync.md#webhook-after-deployment).
- Optional: Cloudflare Access in front of the subdomain.
