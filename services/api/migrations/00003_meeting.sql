-- +goose Up
CREATE SCHEMA meeting;

CREATE TABLE meeting.polls (
    id text PRIMARY KEY,
    config jsonb NOT NULL,
    created_by text NOT NULL,
    finalized_start timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_polls_owner_idx ON meeting.polls (created_by, created_at DESC);

CREATE TABLE meeting.responses (
    id text PRIMARY KEY,
    poll_id text NOT NULL REFERENCES meeting.polls(id) ON DELETE CASCADE,
    name text NOT NULL,
    slots text[] NOT NULL DEFAULT '{}',
    edit_hash bytea NOT NULL,
    version integer NOT NULL DEFAULT 1,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX meeting_responses_poll_idx ON meeting.responses (poll_id);
CREATE UNIQUE INDEX meeting_responses_key_idx ON meeting.responses (poll_id, edit_hash);

-- +goose Down
DROP SCHEMA meeting CASCADE;
