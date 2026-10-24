package notionsync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pisondev/pisondev-platform/services/api/internal/finance"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

// Modes.
const (
	ModeOff  = "off"
	ModePull = "pull" // Notion -> Postgres only; web writes are refused
	ModeFull = "full" // two-way
)

// A single run may not delete more than this, unless forced. Same guard as the sheet.
const (
	maxDeleteMin   = 3
	maxDeleteShare = 0.2
)

// lockKey is the Postgres advisory lock that keeps one sync running across instances.
const lockKey = 7202610150

// Table pairs a local store with a Notion database.
type Table struct {
	Store finance.SyncStore
	DBID  string
}

type Options struct {
	DryRun bool // plan and log only, write nothing
	Force  bool // allow mass deletes
}

// Change is one planned or applied action, for logs and reports.
type Change struct {
	Table  string   `json:"table"`
	Action string   `json:"action"`
	Label  string   `json:"label"`
	Fields []string `json:"fields,omitempty"`
}

type Syncer struct {
	client   *Client
	db       *pgxpool.Pool
	tables   []Table
	options  func(ctx context.Context, table, property string, opts []string) error
	mode     string
	interval time.Duration
	log      *slog.Logger

	wake chan struct{}
	mu   sync.Mutex // one cycle at a time inside this process

	// creates holds, per local row id, the page creations not yet linked to the row. A
	// create whose answer was lost may still have made the page; the next cycle links
	// that page instead of making a second one. Guarded by mu.
	creates map[string][]createAttempt
}

// createAttempt is one CreatePage call: when it was sent and the values it carried.
type createAttempt struct {
	at     time.Time
	values []string
}

// A lost page matches an attempt when Notion's created_time (rounded down to the
// minute) falls in this window around the attempt.
const (
	createdBefore = 2 * time.Minute
	createdAfter  = 10 * time.Minute
	attemptMaxAge = 24 * time.Hour
)

func NewSyncer(client *Client, db *pgxpool.Pool, tables []Table, saveOptions func(ctx context.Context, table, property string, opts []string) error,
	mode string, interval time.Duration, log *slog.Logger) *Syncer {
	return &Syncer{client: client, db: db, tables: tables, options: saveOptions, mode: mode, interval: interval, log: log,
		wake: make(chan struct{}, 1), creates: map[string][]createAttempt{}}
}

func (s *Syncer) Mode() string { return s.mode }

// Notify asks for a sync soon. It never blocks.
func (s *Syncer) Notify() {
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// Writable reports whether local writes are allowed. In pull mode they would be
// overwritten by Notion, so the API refuses them.
func (s *Syncer) Writable() error {
	if s == nil || s.mode == ModeFull || s.mode == ModeOff {
		return nil
	}
	return httpx.Unavailable("read_only", "Editing is disabled while SYNC_MODE is "+s.mode+".")
}

// Run syncs on start, on every Notify (debounced), and on every interval tick.
func (s *Syncer) Run(ctx context.Context) {
	if s.mode == ModeOff {
		return
	}
	s.log.Info("notion sync started", "mode", s.mode, "interval", s.interval.String())
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()
	s.runLogged(ctx)
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		case <-s.wake:
			// Gather a burst of edits into one cycle.
			sleep(ctx, 1500*time.Millisecond)
		}
		s.runLogged(ctx)
	}
}

func (s *Syncer) runLogged(ctx context.Context) {
	changes, err := s.RunOnce(ctx, Options{})
	if err != nil && ctx.Err() == nil {
		s.log.Error("notion sync failed", "err", err)
		return
	}
	for _, c := range changes {
		s.log.Info("notion sync", "table", c.Table, "action", c.Action, "row", c.Label, "fields", c.Fields)
	}
}

// RunOnce syncs every table once. Tables are independent: one failing does not stop
// the others, and every error is recorded in sync.state.
func (s *Syncer) RunOnce(ctx context.Context, opt Options) ([]Change, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	conn, err := s.db.Acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Release()
	var locked bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock($1)`, lockKey).Scan(&locked); err != nil {
		return nil, err
	}
	if !locked {
		return nil, nil // another instance is syncing
	}
	defer conn.Exec(context.Background(), `SELECT pg_advisory_unlock($1)`, lockKey)

	for id, attempts := range s.creates {
		if time.Since(attempts[len(attempts)-1].at) > attemptMaxAge {
			delete(s.creates, id)
		}
	}

	var all []Change
	var errs []error
	for _, t := range s.tables {
		changes, err := s.syncTable(ctx, t, opt)
		all = append(all, changes...)
		if !opt.DryRun {
			s.recordState(ctx, t.Store.Key(), len(changes), err)
		}
		if err != nil {
			errs = append(errs, fmt.Errorf("%s: %w", t.Store.Key(), err))
		}
	}
	return all, errors.Join(errs...)
}

func (s *Syncer) recordState(ctx context.Context, key string, changes int, err error) {
	if err == nil {
		_, _ = s.db.Exec(ctx, `
			INSERT INTO sync.state (table_key, last_success_at, last_changes, last_error) VALUES ($1, now(), $2, '')
			ON CONFLICT (table_key) DO UPDATE SET last_success_at = now(), last_changes = $2, last_error = ''`, key, changes)
		return
	}
	_, _ = s.db.Exec(ctx, `
		INSERT INTO sync.state (table_key, last_error, last_error_at) VALUES ($1, $2, now())
		ON CONFLICT (table_key) DO UPDATE SET last_error = $2, last_error_at = now()`, key, err.Error())
}

type remote struct {
	page   Page
	values []string
}

type action struct {
	kind   string // create, link, merge, insert, archive, purge, deleteLocal, revive, recreate
	row    finance.SyncRow
	remote remote
	merge  mergeResult
	sent   []string // link: the values the lost create carried
}

func (s *Syncer) syncTable(ctx context.Context, t Table, opt Options) ([]Change, error) {
	store := t.Store
	fields := store.Fields()
	titleIdx := -1
	for i, f := range fields {
		if f.Kind == "title" {
			titleIdx = i
		}
	}
	pullOnly := s.mode == ModePull

	if err := s.checkSchema(ctx, t, opt); err != nil {
		return nil, err
	}
	pages, err := s.client.QueryAll(ctx, t.DBID)
	if err != nil {
		return nil, err
	}
	remotes := map[string]remote{}
	for _, p := range pages {
		vals, err := pageValues(p, fields)
		if err != nil {
			return nil, fmt.Errorf("page %s: %w", p.ID, err)
		}
		remotes[bare(p.ID)] = remote{page: p, values: vals}
	}
	rows, err := store.Load(ctx)
	if err != nil {
		return nil, err
	}

	linked := map[string]bool{}
	for _, row := range rows {
		if pid := bare(row.PageID); pid != "" {
			linked[pid] = true
		}
	}
	// lost finds the page made by an earlier create of row whose answer never arrived.
	lost := func(row finance.SyncRow) (action, bool) {
		for _, at := range s.creates[row.ID] {
			for pid, rem := range remotes {
				ct := rem.page.CreatedTime
				if linked[pid] || ct.Before(at.at.Add(-createdBefore)) || ct.After(at.at.Add(createdAfter)) ||
					!sameOwnFields(at.values, rem.values, fields) {
					continue
				}
				linked[pid] = true
				return action{kind: "link", row: row, remote: rem, sent: at.values}, true
			}
		}
		return action{}, false
	}

	var acts []action
	for _, row := range rows {
		pid := bare(row.PageID)
		rem, onRemote := remotes[pid]
		switch {
		case row.Deleted:
			switch {
			case pid == "":
				acts = append(acts, action{kind: "purge", row: row})
			case !onRemote:
				acts = append(acts, action{kind: "purge", row: row})
			case pullOnly:
			case row.Base != nil && !equal(rem.values, row.Base):
				// Edited in Notion after the local delete: Notion's version comes back.
				acts = append(acts, action{kind: "revive", row: row, remote: rem})
			default:
				acts = append(acts, action{kind: "archive", row: row, remote: rem})
			}
		case pid == "":
			if !pullOnly && titleIdx >= 0 && row.Values[titleIdx] != "" {
				if a, ok := lost(row); ok {
					acts = append(acts, a)
				} else {
					acts = append(acts, action{kind: "create", row: row})
				}
			}
		case onRemote:
			m := merge(row.Values, rem.values, row.Base, fields, pullOnly)
			if m.dirty || len(m.toRemote) > 0 {
				acts = append(acts, action{kind: "merge", row: row, remote: rem, merge: m})
			}
		case row.Base != nil && equal(row.Values, row.Base):
			acts = append(acts, action{kind: "deleteLocal", row: row}) // deleted in Notion
		case !pullOnly:
			if a, ok := lost(row); ok {
				acts = append(acts, a)
			} else {
				acts = append(acts, action{kind: "recreate", row: row}) // edited here, gone there
			}
		}
	}
	for pid, rem := range remotes {
		if !linked[pid] {
			acts = append(acts, action{kind: "insert", remote: rem})
		}
	}

	deletes := 0
	for _, a := range acts {
		if a.kind == "archive" || a.kind == "deleteLocal" {
			deletes++
		}
	}
	limit := max(maxDeleteMin, int(math.Ceil(maxDeleteShare*float64(max(len(rows), len(pages))))))
	if deletes > limit && !opt.Force {
		return nil, fmt.Errorf("%d deletions in one run exceed the safety limit of %d; nothing changed. Run with --force if intended", deletes, limit)
	}

	var changes []Change
	label := func(vals []string) string {
		if titleIdx >= 0 && titleIdx < len(vals) && vals[titleIdx] != "" {
			return vals[titleIdx]
		}
		return "(untitled)"
	}
	names := func(idx map[int]bool) []string {
		var out []string
		for i, f := range fields {
			if idx[i] {
				out = append(out, f.Name)
			}
		}
		return out
	}
	for _, a := range acts {
		c := Change{Table: store.Key(), Action: a.kind}
		switch a.kind {
		case "insert":
			c.Label = label(a.remote.values)
		case "merge":
			c.Label = label(a.merge.final)
			c.Fields = append(names(a.merge.toRemote), names(a.merge.toLocal)...)
			if len(a.merge.toRemote) > 0 && len(a.merge.toLocal) > 0 {
				c.Action = "merge both ways"
			} else if len(a.merge.toRemote) > 0 {
				c.Action = "push"
			} else if len(a.merge.toLocal) > 0 {
				c.Action = "pull"
			} else {
				c.Action = "rebase"
			}
		default:
			c.Label = label(a.row.Values)
		}
		changes = append(changes, c)
		if opt.DryRun {
			continue
		}
		if err := s.apply(ctx, t, a, fields); err != nil {
			return changes, fmt.Errorf("%s %q: %w", a.kind, c.Label, err)
		}
	}
	return changes, nil
}

func (s *Syncer) apply(ctx context.Context, t Table, a action, fields []finance.Field) error {
	store := t.Store
	switch a.kind {
	case "insert":
		return store.InsertRemote(ctx, bare(a.remote.page.ID), a.remote.values)

	case "merge":
		if len(a.merge.toRemote) > 0 {
			props, err := properties(a.merge.final, fields, a.merge.toRemote)
			if err != nil {
				return err
			}
			if _, err := s.client.UpdatePage(ctx, a.row.PageID, props, nil); err != nil {
				return err
			}
		}
		// A false result means the row was edited meanwhile; the next cycle merges again.
		_, err := store.Apply(ctx, a.row.ID, a.row.Version, a.row.PageID, a.merge.final)
		return err

	case "recreate":
		// Edited here while the page vanished from the query. A live page means the query
		// missed it; a trashed page is restored with the local values; otherwise create.
		page, err := s.client.GetPage(ctx, a.row.PageID)
		if err != nil && !isGone(err) {
			return err
		}
		if err == nil && bare(page.Parent.DatabaseID) == bare(t.DBID) {
			if !page.Archived && !page.InTrash {
				return nil
			}
			props, err := properties(a.row.Values, fields, nil)
			if err != nil {
				return err
			}
			restored := false
			if _, err := s.client.UpdatePage(ctx, a.row.PageID, props, &restored); err != nil {
				return err
			}
			return store.Link(ctx, a.row.ID, a.row.PageID, a.row.Values)
		}
		fallthrough

	case "create":
		props, err := properties(a.row.Values, fields, nonEmpty(a.row.Values))
		if err != nil {
			return err
		}
		// Recorded first: a failed call may still have made the page (see creates).
		s.creates[a.row.ID] = append(s.creates[a.row.ID], createAttempt{at: time.Now(), values: a.row.Values})
		page, err := s.client.CreatePage(ctx, t.DBID, props)
		if err != nil {
			return err
		}
		if err := store.Link(ctx, a.row.ID, bare(page.ID), a.row.Values); err != nil {
			return err
		}
		delete(s.creates, a.row.ID)
		return nil

	case "link":
		// An earlier create made this page but its answer was lost. The values it carried
		// become the base, so edits made since are pushed on the next cycle.
		if err := store.Link(ctx, a.row.ID, bare(a.remote.page.ID), a.sent); err != nil {
			return err
		}
		delete(s.creates, a.row.ID)
		return nil

	case "archive":
		archived := true
		if _, err := s.client.UpdatePage(ctx, a.row.PageID, nil, &archived); err != nil && !isGone(err) {
			return err
		}
		return store.Purge(ctx, a.row.ID)

	case "revive":
		_, err := store.Apply(ctx, a.row.ID, a.row.Version, a.row.PageID, a.remote.values)
		return err

	case "purge":
		return store.Purge(ctx, a.row.ID)

	case "deleteLocal":
		// Double-check before deleting: the page may only be missing from the query.
		page, err := s.client.GetPage(ctx, a.row.PageID)
		if err == nil && !page.Archived && !page.InTrash && bare(page.Parent.DatabaseID) == bare(t.DBID) {
			return nil
		}
		if err != nil && !isGone(err) {
			return err
		}
		return store.Purge(ctx, a.row.ID)
	}
	return fmt.Errorf("unknown action %q", a.kind)
}

// checkSchema verifies property names and types, and stores select options for the UI.
func (s *Syncer) checkSchema(ctx context.Context, t Table, opt Options) error {
	db, err := s.client.GetDatabase(ctx, t.DBID)
	if err != nil {
		return err
	}
	for _, f := range t.Store.Fields() {
		p, ok := db.Properties[f.Name]
		if !ok {
			return fmt.Errorf("property %q is missing in the Notion database", f.Name)
		}
		if p.Type != f.Kind {
			return fmt.Errorf("property %q is %s in Notion, expected %s", f.Name, p.Type, f.Kind)
		}
		if f.Kind == "select" && p.Select != nil && !opt.DryRun && s.options != nil {
			names := make([]string, 0, len(p.Select.Options))
			for _, o := range p.Select.Options {
				names = append(names, o.Name)
			}
			if err := s.options(ctx, t.Store.Key(), f.Name, names); err != nil {
				return err
			}
		}
	}
	return nil
}

// sameOwnFields compares the fields the app writes; external fields are the sheet's.
func sameOwnFields(a, b []string, fields []finance.Field) bool {
	if len(a) != len(fields) || len(b) != len(fields) {
		return false
	}
	for i, f := range fields {
		if !f.External && a[i] != b[i] {
			return false
		}
	}
	return true
}

func nonEmpty(vals []string) map[int]bool {
	out := map[int]bool{}
	for i, v := range vals {
		if v != "" {
			out[i] = true
		}
	}
	return out
}

func isGone(err error) bool {
	var apiErr *APIError
	return errors.As(err, &apiErr) && (apiErr.Status == 404 || apiErr.Status == 400)
}
