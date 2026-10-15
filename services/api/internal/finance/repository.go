package finance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrNotFound is returned when a row does not exist or is deleted.
var ErrNotFound = errors.New("not found")

// codec maps one entity to its table. cols lists the data columns; args and dest must
// follow the same order.
type codec[T any] struct {
	table  string
	fields []Field
	cols   []string
	args   func(*T) []any
	dest   func(*T) (dests []any, finish func())
	id     func(*T) *string
	canon  func(T) []string
	parse  func([]string) (T, error)
}

var transactionCodec = codec[Transaction]{
	table:  "finance.transactions",
	fields: TransactionFields,
	cols: []string{"occurred_at", "occurred_has_time", "name", "type", "category", "account", "amount",
		"reported_amount", "reported_at", "reported_has_time", "status", "notes"},
	args: func(t *Transaction) []any {
		at, atTime := t.Date.sql()
		rep, repTime := t.ReportedDate.sql()
		return []any{at, atTime, t.Name, t.Type, t.Category, t.Account, t.Amount, t.ReportedAmount, rep, repTime, t.Status, t.Notes}
	},
	dest: func(t *Transaction) ([]any, func()) {
		var at, rep *time.Time
		var atTime, repTime bool
		return []any{&at, &atTime, &t.Name, &t.Type, &t.Category, &t.Account, &t.Amount, &t.ReportedAmount, &rep, &repTime, &t.Status, &t.Notes},
			func() { t.Date = fromSQL(at, atTime); t.ReportedDate = fromSQL(rep, repTime) }
	},
	id:    func(t *Transaction) *string { return &t.ID },
	canon: Transaction.canonical,
	parse: parseTransaction,
}

var subscriptionCodec = codec[Subscription]{
	table:  "finance.subscriptions",
	fields: SubscriptionFields,
	cols:   []string{"name", "price", "cycle", "status", "billing_day", "next_billing_at", "next_billing_has_time", "notes"},
	args: func(s *Subscription) []any {
		nb, nbTime := s.NextBilling.sql()
		return []any{s.Name, s.Price, s.Cycle, s.Status, s.BillingDay, nb, nbTime, s.Notes}
	},
	dest: func(s *Subscription) ([]any, func()) {
		var nb *time.Time
		var nbTime bool
		return []any{&s.Name, &s.Price, &s.Cycle, &s.Status, &s.BillingDay, &nb, &nbTime, &s.Notes},
			func() { s.NextBilling = fromSQL(nb, nbTime) }
	},
	id:    func(s *Subscription) *string { return &s.ID },
	canon: Subscription.canonical,
	parse: parseSubscription,
}

var weekCodec = codec[Week]{
	table:  "finance.weeks",
	fields: WeekFields,
	cols:   []string{"week", "start_at", "start_has_time", "income", "spent", "notes"},
	args: func(w *Week) []any {
		st, stTime := w.Start.sql()
		return []any{w.Week, st, stTime, w.Income, w.Spent, w.Notes}
	},
	dest: func(w *Week) ([]any, func()) {
		var st *time.Time
		var stTime bool
		return []any{&w.Week, &st, &stTime, &w.Income, &w.Spent, &w.Notes},
			func() { w.Start = fromSQL(st, stTime) }
	},
	id:    func(w *Week) *string { return &w.ID },
	canon: Week.canonical,
	parse: parseWeek,
}

// Repository is the Postgres access for the finance module.
type Repository struct {
	db *pgxpool.Pool
}

func NewRepository(db *pgxpool.Pool) *Repository { return &Repository{db: db} }

func placeholders(from, n int) string {
	p := make([]string, n)
	for i := range p {
		p[i] = fmt.Sprintf("$%d", from+i)
	}
	return strings.Join(p, ", ")
}

func assignments(cols []string, from int) string {
	p := make([]string, len(cols))
	for i, c := range cols {
		p[i] = fmt.Sprintf("%s = $%d", c, from+i)
	}
	return strings.Join(p, ", ")
}

// list returns live rows, oldest first.
func list[T any](ctx context.Context, db *pgxpool.Pool, c codec[T], order string) ([]T, error) {
	sql := fmt.Sprintf("SELECT id, %s FROM %s WHERE deleted_at IS NULL ORDER BY %s",
		strings.Join(c.cols, ", "), c.table, order)
	rows, err := db.Query(ctx, sql)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []T
	for rows.Next() {
		var v T
		dests, finish := c.dest(&v)
		if err := rows.Scan(append([]any{c.id(&v)}, dests...)...); err != nil {
			return nil, err
		}
		finish()
		out = append(out, v)
	}
	return out, rows.Err()
}

func get[T any](ctx context.Context, db pgx.Tx, c codec[T], id string) (T, int64, error) {
	var v T
	var version int64
	sql := fmt.Sprintf("SELECT id, version, %s FROM %s WHERE id = $1 AND deleted_at IS NULL FOR UPDATE",
		strings.Join(c.cols, ", "), c.table)
	dests, finish := c.dest(&v)
	err := db.QueryRow(ctx, sql, id).Scan(append([]any{c.id(&v), &version}, dests...)...)
	if errors.Is(err, pgx.ErrNoRows) {
		return v, 0, ErrNotFound
	}
	if err != nil {
		return v, 0, err
	}
	finish()
	return v, version, nil
}

func insert[T any](ctx context.Context, db pgx.Tx, c codec[T], v *T, actor string) error {
	args := c.args(v)
	sql := fmt.Sprintf("INSERT INTO %s (%s, created_by, updated_by) VALUES (%s, $%d, $%d) RETURNING id",
		c.table, strings.Join(c.cols, ", "), placeholders(1, len(c.cols)), len(c.cols)+1, len(c.cols)+1)
	return db.QueryRow(ctx, sql, append(args, actor)...).Scan(c.id(v))
}

func update[T any](ctx context.Context, db pgx.Tx, c codec[T], v *T, actor string) error {
	args := c.args(v)
	n := len(c.cols)
	sql := fmt.Sprintf("UPDATE %s SET %s, version = version + 1, updated_at = now(), updated_by = $%d WHERE id = $%d",
		c.table, assignments(c.cols, 1), n+1, n+2)
	_, err := db.Exec(ctx, sql, append(args, actor, *c.id(v))...)
	return err
}

func softDelete[T any](ctx context.Context, db pgx.Tx, c codec[T], id, actor string) error {
	sql := fmt.Sprintf("UPDATE %s SET deleted_at = now(), version = version + 1, updated_at = now(), updated_by = $1 WHERE id = $2 AND deleted_at IS NULL", c.table)
	tag, err := db.Exec(ctx, sql, actor, id)
	if err == nil && tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return err
}

func audit(ctx context.Context, db pgx.Tx, actor, action, entity, id string, before, after any) error {
	enc := func(v any) []byte {
		if v == nil {
			return nil
		}
		b, _ := json.Marshal(v)
		return b
	}
	_, err := db.Exec(ctx, `INSERT INTO finance.audit_log (actor, action, entity, entity_id, before, after)
		VALUES ($1, $2, $3, $4, $5, $6)`, actor, action, entity, id, enc(before), enc(after))
	return err
}

// Snapshot is everything the calculations need, read in one go.
type Snapshot struct {
	Transactions  []Transaction
	Subscriptions []Subscription
	Weeks         []Week
}

func (r *Repository) Snapshot(ctx context.Context) (Snapshot, error) {
	var s Snapshot
	var err error
	if s.Transactions, err = list(ctx, r.db, transactionCodec, "occurred_at NULLS FIRST, created_at"); err != nil {
		return s, err
	}
	if s.Subscriptions, err = list(ctx, r.db, subscriptionCodec, "name"); err != nil {
		return s, err
	}
	if s.Weeks, err = list(ctx, r.db, weekCodec, "start_at NULLS FIRST, created_at"); err != nil {
		return s, err
	}
	return s, nil
}

// inTx runs fn in a transaction.
func (r *Repository) inTx(ctx context.Context, fn func(pgx.Tx) error) error {
	return pgx.BeginFunc(ctx, r.db, fn)
}

// Options returns the select options per property name, for one table.
func (r *Repository) Options(ctx context.Context, table string) (map[string][]string, error) {
	rows, err := r.db.Query(ctx, `SELECT property, options FROM sync.select_options WHERE database = $1`, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]string{}
	for rows.Next() {
		var prop string
		var opts []string
		if err := rows.Scan(&prop, &opts); err != nil {
			return nil, err
		}
		out[prop] = opts
	}
	return out, rows.Err()
}

// SaveOptions replaces the select options of one property.
func (r *Repository) SaveOptions(ctx context.Context, table, property string, options []string) error {
	_, err := r.db.Exec(ctx, `
		INSERT INTO sync.select_options (database, property, options, updated_at) VALUES ($1, $2, $3, now())
		ON CONFLICT (database, property) DO UPDATE SET options = EXCLUDED.options, updated_at = now()`,
		table, property, options)
	return err
}
