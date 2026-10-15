# Roadmap

Status as of 15 Oct 2026.

## Done

- Private assistant workspace running locally: Google sign-in for the two allowed
  accounts, Finance dashboard, Subscriptions, Weekly Spending Quota, add transaction.
- PostgreSQL in two-way sync with Notion (and through it the Google Sheet), verified with
  a live round trip.
- Guards against AI attribution and leaked secrets, CI for API and web, secret scanning
  and push protection on GitHub.

## Next: deployment (after the domain is bought on 20 Oct 2026)

1. Buy `pisondev.com`, point DNS for `assistant.pisondev.com` at the VPS (Cloudflare DNS
   recommended, it also enables Cloudflare Access).
2. VPS with Docker: PostgreSQL with daily backups, the API, the web app (Next.js
   standalone build), Caddy for TLS and routing (`/api/*` to the API, the rest to the web).
3. Dockerfiles for `services/api` and `apps/assistant-web`, and a deploy workflow gated on
   the CI jobs.
4. Production `.env`: `APP_ENV=production`, `PUBLIC_BASE_URL=https://assistant.pisondev.com`,
   `COOKIE_SECURE=true`, `AUTH_DEV_LOGIN=false`, `SYNC_MODE=full`.
5. Google client: add the production origin and redirect URI.
6. Notion webhook for `pisondev-platform`, see [notion-sync.md](notion-sync.md#webhook-after-deployment).
7. Optional: Cloudflare Access in front of the subdomain.

## Later

- Finance UI for what the API already supports: edit and delete transactions, mark a
  subscription paid (shift Next Billing), sync status page.
- Meeting assistant at `/meeting` (rules in the automation folder's Meeting Assistant).
- Public site `pisondev.com` as `apps/web`.
- Sign-in shared across subdomains with `COOKIE_DOMAIN=.pisondev.com`.
