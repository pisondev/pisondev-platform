# Architecture

## Layout

```
apps/
  assistant-web/          private web app, assistant.pisondev.com
services/
  api/
    cmd/api/              entry point and CLI commands
    internal/auth/        Google sign-in, allowlist, sessions
    internal/finance/     entities, rules, repository, HTTP handlers
    internal/links/       link shortener: redirect listener, visits, management API
    internal/notionsync/  Notion client, merge, sync loop, webhook
    internal/platform/    config-free helpers: clock, database, httpx
    internal/config/      environment
    migrations/           SQL, applied on startup
```

One API binary serves every module (a modular monolith). A new assistant, e.g. meeting,
adds `internal/meeting`, a `meeting` database schema, routes under `/api/v1/meeting`, and
pages under `apps/assistant-web/src/app/meeting`. A public site becomes `apps/web`.

## Requests

The browser only talks to the web origin. `/api/*` is forwarded to the Go API: by
`next.config.ts` rewrites in development, by the reverse proxy in production. Cookies are
therefore first-party and CORS is not needed.

| Route | Access |
|---|---|
| `GET /healthz` | public |
| `GET /api/v1/auth/config`, `/auth/google/login`, `/auth/google/callback` | public |
| `POST /api/v1/webhooks/notion` | Notion signature (HMAC-SHA256) |
| `/api/v1/auth/me`, `/auth/logout`, `/api/v1/finance/*`, `/api/v1/links/*`, `/api/v1/sync` | session |
| `GET /<slug>` on the short host (`LINKS_ADDR`, own listener) | public, redirects only ([links.md](links.md)) |

Finance routes:

| Method and path | Purpose |
|---|---|
| `GET /finance/summary` | Balance of the tracked account |
| `GET /finance/cashflow?granularity=monthly\|weekly` | Income, outcome and net per period |
| `GET /finance/transactions?kind=all\|income\|outcome&limit=` | Newest first |
| `POST /finance/transactions` | Add; `weeklyAllowance: true` also starts a Weekly Recap week |
| `PATCH /finance/transactions/:id`, `DELETE /finance/transactions/:id` | Edit, delete |
| `GET /finance/subscriptions` | Monthly and yearly groups, current roster |
| `POST /finance/subscriptions/:id/advance` | Shift Next Billing one cycle; `from` makes it idempotent |
| `GET /finance/quota` | Weekly quota, recent expenses, savings |
| `GET /finance/options` | Select options read from Notion |

Responses are `{"data": ...}` or `{"error": {"code", "message", "details"}}`.

## Access

- Sign-in is Google OpenID Connect with PKCE and a nonce. Scopes: `openid email`.
- `AUTH_ALLOWED_EMAILS` lists who may sign in. The first address is `main`, the rest are
  `backup`; both have full access. Anyone else is refused before a session exists.
- A session is a random 256-bit token in an `HttpOnly`, `SameSite=Lax` cookie (`Secure`
  in production). Only its SHA-256 is stored. Every request re-checks the allowlist, so
  removing an address locks it out at once.
- Writes must come from the app's own origin (`Origin` / `Sec-Fetch-Site` check).
- The Google OAuth app stays in "Testing" with the two accounts as test users: Google
  itself refuses everyone else, a second gate in front of the allowlist.
- Optional third gate after deployment: Cloudflare Access in front of the subdomain.
- For sign-in shared across subdomains later, set `COOKIE_DOMAIN=.pisondev.com`.

## Data

PostgreSQL schemas: `auth` (sessions), `finance` (transactions, subscriptions, weeks,
audit log), `sync` (select options, sync state, settings), `links` (short links, visits).
Every finance write records the signed-in account in `created_by`/`updated_by` and in
`finance.audit_log`.

Dates keep the WIB wall clock: an instant plus a `has_time` flag, so "2026-10-01" and
"2026-10-01 12:30" both survive the round trip through Notion and the sheet.
