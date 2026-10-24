package links

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	errNotFound  = errors.New("not found")
	errSlugTaken = errors.New("slug taken")
)

// Store is the Postgres access for links.
type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store { return &Store{db: db} }

const linkCols = `id, slug, target, title, notes, enabled, expires_at, clicks, last_clicked_at, created_at, updated_at, created_by`

func scanLink(row pgx.Row) (Link, error) {
	var l Link
	err := row.Scan(&l.ID, &l.Slug, &l.Target, &l.Title, &l.Notes, &l.Enabled, &l.ExpiresAt, &l.Clicks,
		&l.LastClickedAt, &l.CreatedAt, &l.UpdatedAt, &l.CreatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return l, errNotFound
	}
	return l, err
}

// List returns live links, newest first. q filters on slug, target and title.
func (s *Store) List(ctx context.Context, q string, limit int) ([]Link, error) {
	rows, err := s.db.Query(ctx, `SELECT `+linkCols+` FROM links.links
		WHERE deleted_at IS NULL AND ($1 = '' OR slug ILIKE '%' || $1 || '%' OR target ILIKE '%' || $1 || '%' OR title ILIKE '%' || $1 || '%')
		ORDER BY created_at DESC LIMIT $2`, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Link{}
	for rows.Next() {
		l, err := scanLink(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *Store) Get(ctx context.Context, id string) (Link, error) {
	return scanLink(s.db.QueryRow(ctx, `SELECT `+linkCols+` FROM links.links WHERE id = $1 AND deleted_at IS NULL`, id))
}

// BySlug returns the live or disabled link behind a slug; deleted links are not found.
func (s *Store) BySlug(ctx context.Context, slug string) (Link, error) {
	return scanLink(s.db.QueryRow(ctx, `SELECT `+linkCols+` FROM links.links WHERE slug = $1 AND deleted_at IS NULL`, slug))
}

func (s *Store) Insert(ctx context.Context, l *Link, actor string) error {
	err := s.db.QueryRow(ctx, `INSERT INTO links.links (slug, target, title, notes, enabled, expires_at, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING `+linkCols,
		l.Slug, l.Target, l.Title, l.Notes, l.Enabled, l.ExpiresAt, actor).
		Scan(&l.ID, &l.Slug, &l.Target, &l.Title, &l.Notes, &l.Enabled, &l.ExpiresAt, &l.Clicks,
			&l.LastClickedAt, &l.CreatedAt, &l.UpdatedAt, &l.CreatedBy)
	return slugError(err)
}

func (s *Store) Update(ctx context.Context, l *Link, actor string) error {
	tag, err := s.db.Exec(ctx, `UPDATE links.links SET slug = $1, target = $2, title = $3, notes = $4, enabled = $5,
		expires_at = $6, updated_at = now(), updated_by = $7 WHERE id = $8 AND deleted_at IS NULL`,
		l.Slug, l.Target, l.Title, l.Notes, l.Enabled, l.ExpiresAt, actor, l.ID)
	if err != nil {
		return slugError(err)
	}
	if tag.RowsAffected() == 0 {
		return errNotFound
	}
	return nil
}

// Delete hides a link for good. The row stays, so its slug is never given out again.
func (s *Store) Delete(ctx context.Context, id, actor string) error {
	tag, err := s.db.Exec(ctx, `UPDATE links.links SET deleted_at = now(), enabled = false, updated_at = now(), updated_by = $1
		WHERE id = $2 AND deleted_at IS NULL`, actor, id)
	if err == nil && tag.RowsAffected() == 0 {
		return errNotFound
	}
	return err
}

func slugError(err error) error {
	var pg *pgconn.PgError
	if errors.As(err, &pg) && pg.Code == "23505" {
		return errSlugTaken
	}
	return err
}

// click is one recorded visit.
type click struct {
	linkID   string
	at       time.Time
	referrer string
	country  string
	device   string
	bot      bool
}

// SaveClicks writes a batch of visits and bumps the counters of human ones.
func (s *Store) SaveClicks(ctx context.Context, batch []click) error {
	return pgx.BeginFunc(ctx, s.db, func(tx pgx.Tx) error {
		rows := make([][]any, len(batch))
		human := map[string]int64{}
		last := map[string]time.Time{}
		for i, c := range batch {
			rows[i] = []any{c.linkID, c.at, c.referrer, c.country, c.device, c.bot}
			if !c.bot {
				human[c.linkID]++
				if c.at.After(last[c.linkID]) {
					last[c.linkID] = c.at
				}
			}
		}
		if _, err := tx.CopyFrom(ctx, pgx.Identifier{"links", "clicks"},
			[]string{"link_id", "at", "referrer_host", "country", "device", "bot"}, pgx.CopyFromRows(rows)); err != nil {
			return err
		}
		for id, n := range human {
			if _, err := tx.Exec(ctx, `UPDATE links.links SET clicks = clicks + $1,
				last_clicked_at = greatest(coalesce(last_clicked_at, $2), $2) WHERE id = $3`, n, last[id], id); err != nil {
				return err
			}
		}
		return nil
	})
}

// Count is one bucket of a breakdown.
type Count struct {
	Key   string `json:"key"`
	Count int64  `json:"count"`
}

// Stats are the visits of one link over a number of days, bots left out.
type Stats struct {
	Days      int     `json:"days"`
	Total     int64   `json:"total"`
	Bots      int64   `json:"bots"`
	Daily     []Count `json:"daily"` // key: YYYY-MM-DD in WIB, every day present
	Referrers []Count `json:"referrers"`
	Countries []Count `json:"countries"`
	Devices   []Count `json:"devices"`
}

func (s *Store) Stats(ctx context.Context, id string, days int) (Stats, error) {
	st := Stats{Days: days}
	since := `at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta' - make_interval(days => $2 - 1)`
	if err := s.db.QueryRow(ctx, `SELECT count(*) FILTER (WHERE NOT bot), count(*) FILTER (WHERE bot)
		FROM links.clicks WHERE link_id = $1 AND `+since, id, days).Scan(&st.Total, &st.Bots); err != nil {
		return st, err
	}
	var err error
	if st.Daily, err = s.counts(ctx, `SELECT to_char(d, 'YYYY-MM-DD'), count(c.id)
		FROM generate_series((now() AT TIME ZONE 'Asia/Jakarta')::date - ($2 - 1), (now() AT TIME ZONE 'Asia/Jakarta')::date, interval '1 day') d
		LEFT JOIN links.clicks c ON c.link_id = $1 AND NOT c.bot AND (c.at AT TIME ZONE 'Asia/Jakarta')::date = d::date
		GROUP BY d ORDER BY d`, id, days); err != nil {
		return st, err
	}
	breakdown := func(col string) ([]Count, error) {
		return s.counts(ctx, `SELECT `+col+`, count(*) FROM links.clicks WHERE link_id = $1 AND NOT bot AND `+since+`
			GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 10`, id, days)
	}
	if st.Referrers, err = breakdown("referrer_host"); err != nil {
		return st, err
	}
	if st.Countries, err = breakdown("country"); err != nil {
		return st, err
	}
	if st.Devices, err = breakdown("device"); err != nil {
		return st, err
	}
	return st, nil
}

func (s *Store) counts(ctx context.Context, sql string, args ...any) ([]Count, error) {
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Count{}
	for rows.Next() {
		var c Count
		if err := rows.Scan(&c.Key, &c.Count); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
