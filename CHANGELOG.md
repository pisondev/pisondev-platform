# Changelog

All notable changes are listed here, newest first. Dates are in WIB (UTC+7).
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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
