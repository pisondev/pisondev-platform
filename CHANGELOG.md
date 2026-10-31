# Changelog

All notable changes are listed here, newest first. Dates are in WIB (UTC+7).
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- 2026-10-31: Cash Flow detail page at `/finance/cashflow`, opened from a new detail icon
  (window with arrow) in the top-right corner of the Finance transaction table. It keeps
  the table's Monthly/Weekly and All/Income/Outcome view and shows the chart, a table of
  income, outcome and net per period, period totals, and up to 500 transactions with
  category, filterable by period. `DetailLink` and the `DataTable` header `action` slot
  make the icon reusable for other detail pages.

- 2026-10-31: Cash Flow points show their amount in the series color on hover or keyboard
  focus. A click (or Enter/Space) pins the amount with a larger dot; a second click
  removes it. Pins clear when the filter or period changes.

- 2026-10-31: Custom `Select` dropdown in place of every native select (Finance Group by,
  transaction Category and Account, Meeting hours, duration and time zones). The list
  slides open and closed, flips above near the screen edge, stays above the sheet, and
  supports the full keyboard combobox pattern. Reduced motion skips the slide.

- 2026-10-30: Released Meeting availability on the assistant host with public demo and
  invitations, owner sign-in, response persistence, and calendar export.

- 2026-10-30: Assistant motion without a layout redesign: fast currency counters,
  viewport-triggered chart bars and line drawing, synchronized quota fill/text clipping,
  sliding filter pills, section/row entrances, navigation hover and button press feedback,
  animated link details, and transaction sheet entrance/exit. Reduced motion shows final
  values and shapes immediately. No animation dependency added.
- 2026-10-27: Meeting availability at `/meeting/availability`: guided creation, public
  invitations, 15-minute availability painting, touch and keyboard selection, group
  heatmap, participant filters, duration-aware recommendations, time-zone display,
  owner confirmation/reopen, and calendar export. Includes a synthetic interactive demo.
- 2026-10-27: Go Meeting module and PostgreSQL schema with owner-protected management,
  hashed response keys, idempotent guest creation, optimistic versions, transactional
  confirmation, and public reads. Domain, database, and browser lifecycle tests.
  Analysis and rollout notes are in `docs/meeting.md`.

- 2026-10-20: Assistant design-system guide with implemented tokens, responsive unit calculations,
  component contracts, data states, and a recipe/checklist for matching new pages.
- 2026-10-20: UI/UX audit of all assistant routes with synthetic screenshots, viewport measurements,
  contrast checks, and prioritized usability and accessibility findings.
- 2026-10-20: Proposed motion and loading specification covering buttons, hover, charts, quota,
  skeleton geometry, custom dropdowns, sheets, interruption, and reduced motion.

- 2026-10-24: Link shortener API (`internal/links`, schema `links`): short links on their
  own listener (`LINKS_ADDR`) that only redirects, case-insensitive slugs that are never
  reused, random slugs without look-alike characters, expiry and disable, visits recorded
  in batches without IP addresses (bots logged, not counted), and stats per day, referrer,
  country and device. Management under `/api/v1/links`. See `docs/links.md`.
- 2026-10-24: Server compose publishes the short-link listener on `127.0.0.1:3042`
  (`LINKS_PORT`); `go.pisondev.com` is live behind Cloudflare and HestiaCP nginx.

- 2026-10-24: `/links` page and Hub tile: create links (custom or random slug), copy,
  QR code with PNG download, 30-day visits by day, referrer, country and device, edit,
  pause and delete with an inline confirmation. `GET /api/v1/links/config` gives the
  short-link origin. Uses `qrcode-generator` 2.0.4 (MIT, no dependencies).
- 2026-10-24: Shared `Button` in the assistant app (primary, secondary, danger, text) with
  visible keyboard focus, a 44 px touch target and a busy state.

### Changed

- 2026-10-31: The Savings chart on `/finance/quota` fills its card: the Target and Now
  bars widen to share the space up to the gap marker instead of two thin bars on the left.

- 2026-10-31: Finance Cash Flow "All" now draws income (green) and outcome (red) as two
  lines with a legend below the chart, instead of one net line. The Outcome view is red too.

- 2026-10-27: Enabled the Meeting Hub tile. Existing Assistant pages share a route-group
  layout without URL changes; Meeting has a separate wide responsive visual system.

- 2026-10-24: `useApi` reports `refreshing` while a reload or new path is pending with
  earlier data shown, and `loading` only while nothing has arrived yet.

### Fixed

- 2026-10-31: Cash flow axis dots: the single gray dot that sat 2 units left of the y-axis
  is replaced by one dot per point on each axis, centered on the axis lines. Savings and
  Subscription axis dots are centered on their axes too.

- 2026-10-30: Display repeated daylight-saving hours in chronological order, with their
  distinct offsets retained in accessible labels.

- 2026-10-30: Transaction sheet traps/restores keyboard focus, locks background scrolling,
  blocks dismissal and repeat submissions while saving, and cleans up interrupted exits.
  Segmented filters expose pressed-button semantics. Zero chart values have no fake bar.

- 2026-10-24: Migrations run under a Postgres advisory lock, so two processes (or test
  packages in parallel) never apply the same migration at once.
- 2026-10-24: Notion sync no longer makes a duplicate page (and so a duplicate
  transaction in the app and the sheet) when a page create times out or gets a server
  error after Notion already made it. Creates are retried only on rate limits and refused
  connections, and the next run links the page that a lost create made.

## [0.2.0] - 2026-10-20

### Added

- Production at `https://assistant.pisondev.com`: `pisondev.com` moved to Cloudflare
  (proxied, SSL Full strict), HestiaCP domain with Let's Encrypt, nginx template proxying
  to `127.0.0.1:3040`.
- Continuous deployment: the `deploy` CI job builds a release (static Go binary and
  Next.js standalone server) and ships it over SSH to `bin/receive`, which backs up the
  database, switches releases, health-checks the new commit and rolls back on failure.
  The deploy key is bound to that command and cannot open a shell.
- `deploy/`: release build, server compose (web on loopback, API and Postgres on the
  Docker network only), receiver, backup script (daily cron and before every deploy),
  and `install.sh` for the server side.
- `GET /api/v1/health` with the build version.
- `docs/deployment.md`.

### Changed

- Local PostgreSQL moved to port 5448; 5442 is now used by another project.
- The quick start no longer overwrites an existing `.env`.
- The API trusts private-network proxies for client IPs (it sits behind the web server).

## [0.1.2] - 2026-10-15

### Added

- `CLAUDE.md`, the working guide for coding sessions: rules, map, checks, conventions and
  gotchas.
- `docs/roadmap.md` with the current status and the deployment plan for after 20 Oct 2026.

### Changed

- The guards now allow the shared `CLAUDE.md`; AI tool state (`.claude/`,
  `CLAUDE.local.md`, `.mcp.json` and similar) stays blocked.

## [0.1.1] - 2026-10-15

### Changed

- CI actions moved to their Node 24 releases (`actions/checkout` v7.0.1,
  `actions/setup-go` v7.0.0, `actions/setup-node` v7.0.0, `pnpm/action-setup` v6.1.0),
  removing the Node 20 deprecation warnings.
- CI runners pinned to `ubuntu-24.04`, since `ubuntu-latest` moves to Ubuntu 26.04 from
  19 Oct 2026.
- Local sync runs in `full` mode. The setup guide describes the switch from `pull`.

### Verified

- Two-way sync on live data: a Rp1 test transaction added in the web app reached Notion
  within 6 s and the Google Sheet within a minute; deleting it removed it from both, and
  the sheet's recomputed Weekly Recap values flowed back to Postgres.

## [0.1.0] - 2026-10-15

First version of the private assistant workspace, Finance Assistant only, running locally.

### Added

- Monorepo layout: `apps/assistant-web` (Next.js 16), `services/api` (Go, Gin,
  PostgreSQL), `docs`, `design`, shared `scripts`.
- Access limited to an allowlist of Google accounts (main and backup), with server-side
  sessions in PostgreSQL, PKCE and nonce checks, an origin check on writes, and a
  development-only sign-in that the config refuses in production.
- Finance API: balance, cash flow (monthly or by allowance week), transactions with add,
  edit and delete, subscriptions with the monthly roster and billing shift, weekly quota
  with next-week projection, and savings by week. Writes are audited per account.
- Two-way Notion sync for Transactions, Subscriptions and Weekly Recap through a new
  integration, with 3-way field merges, tombstones for deletes, a mass-delete guard, an
  advisory lock, signed webhooks, and `off`, `pull` and `full` modes.
- Web screens from the Figma design: home, Finance dashboard, Subscriptions, Weekly
  Spending Quota, and a form to add a transaction.
- Guards against AI attribution and leaked secrets in a commit hook, a pre-commit hook and
  CI, plus gitleaks over the full history. GitHub secret scanning and push protection are
  enabled on the repository.
- CI for Go (gofmt, vet, race tests with PostgreSQL) and the web app (lint, types, build).
- Local PostgreSQL through Docker Compose on port 5442, with a separate test database.

### Verified

- Quota, savings and roster reproduce the reference values recorded on 1 Oct 2026, and
  weekly Remaining matches the sheet's Weekly Recap for W1 to W4 on live data.
