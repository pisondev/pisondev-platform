# Roadmap

Status as of 20 Oct 2026.

## Done

- Private assistant workspace: Google sign-in for the two allowed accounts, Finance
  dashboard, Subscriptions, Weekly Spending Quota, add transaction.
- PostgreSQL in two-way sync with Notion (and through it the Google Sheet).
- Guards against AI attribution and leaked secrets, CI, secret scanning and push protection.
- Deployment: `pisondev.com` on Cloudflare, `assistant.pisondev.com` on the VPS behind
  HestiaCP nginx with Let's Encrypt, continuous deployment from `main` with backups and
  rollback ([deployment.md](deployment.md)).

## Next

- Notion webhook for instant Notion to app updates (the 60 s poll covers it meanwhile).
- Optional: Cloudflare Access in front of `assistant.pisondev.com`.

## Later

- Finance UI for what the API already supports: edit and delete transactions, mark a
  subscription paid (shift Next Billing), sync status page.
- Meeting assistant at `/meeting` (rules in the automation folder's Meeting Assistant).
- Public site `pisondev.com` as `apps/web`.
- Sign-in shared across subdomains with `COOKIE_DOMAIN=.pisondev.com`.
- Remove the Hostinger parking records for `pisondev.com` and `www` when the public site ships.
