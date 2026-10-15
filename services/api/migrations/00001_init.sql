-- +goose Up
-- One schema per module, so new modules (meeting, portfolio) add schemas, not prefixes.
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS sync;

-- Sessions. Only the SHA-256 of the cookie token is stored.
CREATE TABLE auth.sessions (
    token_hash   bytea PRIMARY KEY,
    email        text        NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    user_agent   text        NOT NULL DEFAULT '',
    ip           text        NOT NULL DEFAULT ''
);
CREATE INDEX sessions_expires_at_idx ON auth.sessions (expires_at);

-- Shared columns of every table mirrored with a Notion database:
--   notion_page_id  the linked page, null until the row exists in Notion
--   sync_base       canonical field values at the last sync, used for 3-way merges
--   version         bumped on every write, guards sync against concurrent edits
--   deleted_at      tombstone; the sync archives the page, then purges the row
-- Dates keep the WIB wall clock: *_at holds the instant, *_has_time says whether a time
-- of day was given (false means a date only, stored at 00:00 WIB).

CREATE TABLE finance.transactions (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    occurred_at           timestamptz,
    occurred_has_time     boolean     NOT NULL DEFAULT false,
    name                  text        NOT NULL DEFAULT '',
    type                  text        NOT NULL DEFAULT '',
    category              text        NOT NULL DEFAULT '',
    account               text        NOT NULL DEFAULT '',
    amount                bigint,
    reported_amount       bigint,
    reported_at           timestamptz,
    reported_has_time     boolean     NOT NULL DEFAULT false,
    status                text        NOT NULL DEFAULT '',
    notes                 text        NOT NULL DEFAULT '',
    notion_page_id        text UNIQUE,
    sync_base             jsonb,
    synced_at             timestamptz,
    version               bigint      NOT NULL DEFAULT 1,
    deleted_at            timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    created_by            text        NOT NULL DEFAULT '',
    updated_by            text        NOT NULL DEFAULT ''
);
CREATE INDEX transactions_occurred_at_idx ON finance.transactions (occurred_at) WHERE deleted_at IS NULL;

CREATE TABLE finance.subscriptions (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                  text        NOT NULL DEFAULT '',
    price                 bigint,
    cycle                 text        NOT NULL DEFAULT '',
    status                text        NOT NULL DEFAULT '',
    billing_day           integer,
    next_billing_at       timestamptz,
    next_billing_has_time boolean     NOT NULL DEFAULT false,
    notes                 text        NOT NULL DEFAULT '',
    notion_page_id        text UNIQUE,
    sync_base             jsonb,
    synced_at             timestamptz,
    version               bigint      NOT NULL DEFAULT 1,
    deleted_at            timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    created_by            text        NOT NULL DEFAULT '',
    updated_by            text        NOT NULL DEFAULT ''
);

-- Weekly Recap. week, income and spent are computed by the Google Sheet and only read here.
CREATE TABLE finance.weeks (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    week                  text        NOT NULL DEFAULT '',
    start_at              timestamptz,
    start_has_time        boolean     NOT NULL DEFAULT false,
    income                bigint,
    spent                 bigint,
    notes                 text        NOT NULL DEFAULT '',
    notion_page_id        text UNIQUE,
    sync_base             jsonb,
    synced_at             timestamptz,
    version               bigint      NOT NULL DEFAULT 1,
    deleted_at            timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now(),
    created_by            text        NOT NULL DEFAULT '',
    updated_by            text        NOT NULL DEFAULT ''
);

-- Change log: who changed what from the web app.
CREATE TABLE finance.audit_log (
    id          bigserial PRIMARY KEY,
    at          timestamptz NOT NULL DEFAULT now(),
    actor       text        NOT NULL,
    action      text        NOT NULL,
    entity      text        NOT NULL,
    entity_id   uuid,
    before      jsonb,
    after       jsonb
);
CREATE INDEX audit_log_at_idx ON finance.audit_log (at DESC);

-- Select options as defined in Notion, refreshed on every sync.
CREATE TABLE sync.select_options (
    database   text        NOT NULL,
    property   text        NOT NULL,
    options    jsonb       NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (database, property)
);

-- Outcome of the latest sync per table.
CREATE TABLE sync.state (
    table_key       text PRIMARY KEY,
    last_success_at timestamptz,
    last_changes    integer     NOT NULL DEFAULT 0,
    last_error      text        NOT NULL DEFAULT '',
    last_error_at   timestamptz
);

-- Small key/value settings, e.g. the Notion webhook verification token.
CREATE TABLE sync.settings (
    key        text PRIMARY KEY,
    value      text        NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
DROP SCHEMA sync CASCADE;
DROP SCHEMA finance CASCADE;
DROP SCHEMA auth CASCADE;
