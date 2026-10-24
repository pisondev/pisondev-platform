# Link shortener

Short links on their own host, `go.pisondev.com/<slug>`, managed from the assistant app.
Only the allowed accounts create links; anyone can follow one.

## Why a subdomain

- **Separation**: the short host only redirects. It runs on its own listener in the API,
  so neither the assistant pages nor the private API can be reached through it, and the
  assistant's session cookie (host-only on `assistant.pisondev.com`) is never sent to it.
  Should sign-in later be shared with `COOKIE_DOMAIN=.pisondev.com`, the redirect listener
  still never reads cookies.
- **Room for the public site**: `pisondev.com/<anything>` stays free for the public site
  later, with no clash between page paths and slugs.
- **Cost**: `go.pisondev.com/cv` is three characters longer than `pisondev.com/cv`.

## How it works

```
visitor ─▶ Cloudflare ─▶ nginx (go.pisondev.com) ─▶ 127.0.0.1:3042 ─▶ api :8101 (redirects only)
                                                                         │ lookup, 302
                                                                         └─▶ links.clicks (batched)
owner ─▶ assistant.pisondev.com/links ─▶ /api/v1/links/* (session) ─▶ links.links
```

- `GET /<slug>` answers `302` to the target, with `Cache-Control: private, no-store`, so
  Cloudflare and browsers never cache it: a changed target applies at once and every visit
  reaches the server. Query parameters of the visit are added to the target unless it
  has them already (`/cv?ref=ig`).
- Slugs are case-insensitive (stored lowercase): letters, digits, `-` and `_`, up to 64.
  Without a custom slug, a random 6-character one is drawn from an alphabet without
  look-alikes (`0/o`, `1/l/i`).
- A slug is never reused. Deleting a link keeps its row, so a slug that was printed or
  shared can never start pointing elsewhere. Once a link has visits its slug is fixed;
  make a new link instead.
- Disabled or deleted: `404`. Expired: `410`. `/` goes to `LINKS_HOME_URL`, or shows a
  not-found page when it is empty. `robots.txt` allows all, so link previews work;
  responses carry `X-Robots-Tag: noindex`.
- Targets must be full `http(s)` URLs without a user name or password, and cannot point
  at the short host itself.

## Visits

Each visit is queued in memory and written in batches every 2 seconds, so a redirect never
waits for the database; a full queue drops the visit, never the redirect. A visit keeps
the referrer host, the country from Cloudflare's `CF-IPCountry`, and the device class
(mobile, desktop, bot). No IP address and no full user agent are stored.

Link previews and checkers (WhatsApp, Telegram, Slack, curl, `HEAD` requests, ...) are
logged as bots and left out of the counter and the stats.

## API

Session-protected, under `/api/v1/links`:

| Method and path | Purpose |
|---|---|
| `GET /links?q=&limit=` | Live links, newest first; `q` searches slug, target and title |
| `POST /links` | `{target, slug?, title?, notes?, expiresAt?}`; `409 slug_taken` if used |
| `GET /links/:id` | One link |
| `PATCH /links/:id` | Any of `target`, `slug`, `title`, `notes`, `enabled`, `expiresAt` (`""` clears) |
| `DELETE /links/:id` | Delete; the slug stays reserved |
| `GET /links/:id/stats?days=30` | Daily visits (WIB), top referrers, countries, devices |

Every link in a response carries `shortUrl`, built from `LINKS_BASE_URL`.

## Settings

| Variable | Default | Meaning |
|---|---|---|
| `LINKS_ADDR` | empty (off) | Listener of the short host; `:8101` in the server compose |
| `LINKS_BASE_URL` | `http://localhost:8101` | Public origin of the short host |
| `LINKS_HOME_URL` | empty | Where the bare short host redirects |
| `LINKS_PORT` | `3042` | Server only: loopback port nginx proxies the short host to |

## Going live

The code ships with the normal deploy and does nothing until these are done:

1. **Cloudflare**: `A go → 103.87.67.77`, DNS only at first (for the certificate), then
   proxied.
2. **HestiaCP** (as root through `prinx`): copy the `pisondev-assistant` templates to
   `pisondev-links` with `127.0.0.1:3042`, then
   `v-add-web-domain user_pison go.pisondev.com 103.87.67.77 no none`,
   `v-change-web-domain-tpl user_pison go.pisondev.com pisondev-links no`,
   `v-add-letsencrypt-domain user_pison go.pisondev.com`,
   `v-add-web-domain-ssl-force user_pison go.pisondev.com`, and
   `nginx -t && systemctl reload nginx`.
3. **Server**: add `LINKS_BASE_URL`, `LINKS_HOME_URL` and `LINKS_PORT` to `.env`
   ([template](../deploy/server.env.example)), run `deploy/install.sh` to copy the new
   `compose.yaml`, then `docker compose up -d --force-recreate api web`.
4. Check: `curl -I https://go.pisondev.com/healthz` and a test link.
