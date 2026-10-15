# Notion sync

The Finance Assistant already keeps a Google Sheet and three Notion databases in sync
through an Apps Script and a Cloudflare relay (outside this repository). This platform
joins that system without changing it, with Notion as the hub:

```
PostgreSQL ◀── this service ──▶ Notion ◀── Apps Script ──▶ Google Sheet
```

| Database | Table | Notes |
|---|---|---|
| Transactions | `finance.transactions` | |
| Subscriptions | `finance.subscriptions` | |
| Weekly Recap | `finance.weeks` | `Week`, `Income`, `Spent` are computed by the sheet |

## Integration

The service uses its own Notion integration, `pisondev-platform`, not the sheet's
`Finance API`. The relay ignores changes authored by `Finance API` (they are the sheet's
own echoes); changes by `pisondev-platform` are forwarded, so edits made in the web app
reach the sheet within about a minute.

## When it runs

- On start, then every `SYNC_INTERVAL` (default 60 s).
- About 1.5 s after a write in the web app.
- On a Notion webhook, once the API is reachable from the internet (see below).

A Postgres advisory lock keeps one sync running across instances.

## Modes

| `SYNC_MODE` | Notion to Postgres | Postgres to Notion | Web edits |
|---|---|---|---|
| `off` | no | no | allowed, local only |
| `pull` | yes, Notion wins every field | never | refused (503) |
| `full` | yes | yes | allowed |

Start with `pull` on a new machine, check `api sync --dry-run`, then switch to `full`.

## Merge rules

Each row stores `sync_base`: its field values at the last sync. Per field:

- changed on one side only: copied to the other;
- changed on both sides: Postgres wins (same rule as the sheet, where the faster writer wins);
- `Week`, `Income`, `Spent`: Notion always wins and they are never pushed, except the
  `Week` title when the web app creates a week;
- a row without base takes Notion's values.

Rows and pages:

| Situation | Result |
|---|---|
| Page only in Notion | inserted locally |
| Row only locally | page created |
| Row deleted locally | page archived, row purged; if the page was edited after the last sync, the row comes back instead |
| Page archived in Notion, row unchanged | row purged, after confirming with a direct page read |
| Page archived in Notion, row edited | page restored with the local values |

A run that would delete more than 3 rows or 20% of a table stops without changing
anything. Run `api sync --force` when the deletion is intended.

Writes carry the row version: a sync never overwrites an edit made during the run.

## Webhook (after deployment)

1. In Notion, integration `pisondev-platform` > Webhooks, subscribe
   `https://assistant.pisondev.com/api/v1/webhooks/notion` to page created, properties
   updated, deleted, undeleted, moved, and database schema updated.
2. Notion sends a verification token; the API stores it. Print it with
   `api webhook-token`, paste it into Notion, click Verify.
3. From then on every event is checked against `X-Notion-Signature`. Events authored by
   this integration are ignored. The payload is never trusted: it only triggers a sync.

## Checking

```bash
go run ./cmd/api sync --dry-run   # what would change, writes nothing
go run ./cmd/api sync             # one run now
```

`GET /api/v1/sync` shows the last success and last error per table.
