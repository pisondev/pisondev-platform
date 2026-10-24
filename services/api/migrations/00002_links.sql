-- +goose Up
-- Link shortener. Slugs are lowercase and never reused: a deleted link keeps its slug,
-- so a printed or shared short link can never start pointing somewhere else.
CREATE SCHEMA IF NOT EXISTS links;

CREATE TABLE links.links (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug            text        NOT NULL UNIQUE,
    target          text        NOT NULL,
    title           text        NOT NULL DEFAULT '',
    notes           text        NOT NULL DEFAULT '',
    enabled         boolean     NOT NULL DEFAULT true,
    expires_at      timestamptz,
    clicks          bigint      NOT NULL DEFAULT 0,  -- human visits; bots are logged, not counted
    last_clicked_at timestamptz,
    deleted_at      timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    created_by      text        NOT NULL DEFAULT '',
    updated_by      text        NOT NULL DEFAULT ''
);

-- One row per visit. No IP address and no full user agent: only what the stats show.
CREATE TABLE links.clicks (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    link_id       uuid        NOT NULL REFERENCES links.links (id) ON DELETE CASCADE,
    at            timestamptz NOT NULL DEFAULT now(),
    referrer_host text        NOT NULL DEFAULT '',
    country       text        NOT NULL DEFAULT '',  -- CF-IPCountry from Cloudflare
    device        text        NOT NULL DEFAULT '',  -- mobile, desktop, bot
    bot           boolean     NOT NULL DEFAULT false
);
CREATE INDEX clicks_link_at_idx ON links.clicks (link_id, at);

-- +goose Down
DROP SCHEMA links CASCADE;
