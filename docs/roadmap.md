# Roadmap

Status as of 24 Oct 2026.

## Done

- Private assistant workspace: Google sign-in for the two allowed accounts, Finance
  dashboard, Subscriptions, Weekly Spending Quota, add transaction.
- PostgreSQL in two-way sync with Notion (and through it the Google Sheet).
- Guards against AI attribution and leaked secrets, CI, secret scanning and push protection.
- Deployment: `pisondev.com` on Cloudflare, `assistant.pisondev.com` on the VPS behind
  HestiaCP nginx with Let's Encrypt, continuous deployment from `main` with backups and
  rollback ([deployment.md](deployment.md)).

## Next

- Link shortener at `go.pisondev.com`: the API side is built ([links.md](links.md));
  still to do are the `/links` page in the assistant app (list, create, edit, stats, QR
  code) and the go-live steps (DNS, HestiaCP domain, server `.env` and compose).
- Notion webhook for instant Notion to app updates (the 60 s poll covers it meanwhile).
  Set `NOTION_WEBHOOK_TOKEN`, or verify right after creating the subscription: until a
  token exists, the first verification request to arrive is the one stored.
- Optional: Cloudflare Access in front of `assistant.pisondev.com`.
- Assistant UI foundations: request loading/refresh/error states, modal and filter
  keyboard behavior, text contrast, and narrow navigation tiles. Follow the
  [UI/UX audit](../design/assistant-uiux-audit.md); these improvements are planned.

## Later

- Shared loading skeletons and interaction feedback, then chart/sheet animation and
  accessible custom dropdowns, following the [motion spec](../design/assistant-motion.md).
- Finance UI for what the API already supports: edit and delete transactions, mark a
  subscription paid (shift Next Billing), sync status page.
- Meeting assistant at `/meeting` (rules in the automation folder's Meeting Assistant).
- Public site `pisondev.com` as `apps/web`.
- Sign-in shared across subdomains with `COOKIE_DOMAIN=.pisondev.com`.
- Remove the Hostinger parking records for `pisondev.com` and `www` when the public site ships.
