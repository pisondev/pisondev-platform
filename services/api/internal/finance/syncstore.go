package finance

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// SyncRow is one local row in canonical form, as the Notion sync sees it.
type SyncRow struct {
	ID      string
	PageID  string
	Values  []string
	Base    []string // values at the last sync, nil when never synced
	Version int64
	Deleted bool
}

// SyncStore gives the Notion sync access to one table. Writes that carry a version
// apply only if the row was not edited since it was loaded, so a sync never overwrites
// an edit made during the cycle; the next cycle picks that edit up.
type SyncStore interface {
	Key() string
	Fields() []Field
	Load(ctx context.Context) ([]SyncRow, error)
	// InsertRemote adds a row that exists only in Notion.
	InsertRemote(ctx context.Context, pageID string, values []string) error
	// Apply writes merged values, records them as the new base, links pageID, and clears
	// a tombstone.
	Apply(ctx context.Context, id string, version int64, pageID string, values []string) (bool, error)
	// Link records the page created for a row and the values sent with it. It ignores
	// the version on purpose: an edit made while the page was being created must keep
	// its link, and stays detectable because it differs from base.
	Link(ctx context.Context, id, pageID string, base []string) error
	// Purge removes a row for good.
	Purge(ctx context.Context, id string) error
}

type syncStore[T any] struct {
	key string
	db  *pgxpool.Pool
	c   codec[T]
}

// SyncStores returns the stores for transactions, subscriptions and weeks.
func (r *Repository) SyncStores() (transactions, subscriptions, weeks SyncStore) {
	return &syncStore[Transaction]{"transactions", r.db, transactionCodec},
		&syncStore[Subscription]{"subscriptions", r.db, subscriptionCodec},
		&syncStore[Week]{"weeks", r.db, weekCodec}
}

func (s *syncStore[T]) Key() string     { return s.key }
func (s *syncStore[T]) Fields() []Field { return s.c.fields }

func (s *syncStore[T]) Load(ctx context.Context) ([]SyncRow, error) {
	sql := fmt.Sprintf(`SELECT id, coalesce(notion_page_id, ''), sync_base, version, deleted_at IS NOT NULL, %s FROM %s ORDER BY created_at`,
		strings.Join(s.c.cols, ", "), s.c.table)
	rows, err := s.db.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SyncRow
	for rows.Next() {
		var v T
		var r SyncRow
		dests, finish := s.c.dest(&v)
		if err := rows.Scan(append([]any{&r.ID, &r.PageID, &r.Base, &r.Version, &r.Deleted}, dests...)...); err != nil {
			return nil, err
		}
		finish()
		r.Values = s.c.canon(v)
		if r.Base != nil && len(r.Base) != len(r.Values) {
			r.Base = nil // field list changed since the last sync
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (s *syncStore[T]) InsertRemote(ctx context.Context, pageID string, values []string) error {
	v, err := s.c.parse(values)
	if err != nil {
		return err
	}
	args := s.c.args(&v)
	n := len(s.c.cols)
	sql := fmt.Sprintf(`INSERT INTO %s (%s, notion_page_id, sync_base, synced_at, created_by, updated_by)
		VALUES (%s, $%d, $%d, now(), 'notion', 'notion')
		ON CONFLICT (notion_page_id) DO NOTHING`,
		s.c.table, strings.Join(s.c.cols, ", "), placeholders(1, n), n+1, n+2)
	_, err = s.db.Exec(ctx, sql, append(args, pageID, values)...)
	return err
}

func (s *syncStore[T]) Apply(ctx context.Context, id string, version int64, pageID string, values []string) (bool, error) {
	v, err := s.c.parse(values)
	if err != nil {
		return false, err
	}
	args := s.c.args(&v)
	n := len(s.c.cols)
	sql := fmt.Sprintf(`UPDATE %s SET %s, notion_page_id = $%d, sync_base = $%d, synced_at = now(),
		deleted_at = NULL, version = version + 1, updated_at = now()
		WHERE id = $%d AND version = $%d`,
		s.c.table, assignments(s.c.cols, 1), n+1, n+2, n+3, n+4)
	tag, err := s.db.Exec(ctx, sql, append(args, nullable(pageID), values, id, version)...)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

func (s *syncStore[T]) Link(ctx context.Context, id, pageID string, base []string) error {
	_, err := s.db.Exec(ctx, fmt.Sprintf(`UPDATE %s SET notion_page_id = $1, sync_base = $2, synced_at = now() WHERE id = $3`, s.c.table),
		pageID, base, id)
	return err
}

func (s *syncStore[T]) Purge(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, fmt.Sprintf("DELETE FROM %s WHERE id = $1", s.c.table), id)
	return err
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
