package notionsync

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pisondev/pisondev-platform/services/api/internal/finance"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/database"
)

// fakeNotion is an in-memory Notion API with just the endpoints the sync uses.
type fakeNotion struct {
	mu     sync.Mutex
	dbs    map[string][]finance.Field
	pages  map[string]*fakePage
	nextID int
	writes []string // "PATCH id", "POST db"
	// loseCreates makes the next creates succeed but answer 502, like a lost response.
	loseCreates int
}

type fakePage struct {
	id, db   string
	archived bool
	props    map[string]json.RawMessage
	created  time.Time
	edited   time.Time
}

func newFakeNotion() *fakeNotion {
	return &fakeNotion{dbs: map[string][]finance.Field{}, pages: map[string]*fakePage{}}
}

func (f *fakeNotion) pageJSON(p *fakePage) map[string]any {
	return map[string]any{
		"id": p.id, "archived": p.archived, "in_trash": false,
		"created_time":     p.created.Truncate(time.Minute).Format(time.RFC3339),
		"last_edited_time": p.edited.Format(time.RFC3339),
		"parent":           map[string]string{"database_id": p.db},
		"properties":       p.props,
	}
}

// shape converts a request property payload into the response shape.
func shape(kind string, payload json.RawMessage) json.RawMessage {
	var m map[string]any
	_ = json.Unmarshal(payload, &m)
	m["type"] = kind
	if kind == "title" || kind == "rich_text" {
		parts, _ := m[kind].([]any)
		for _, p := range parts {
			pm := p.(map[string]any)
			pm["plain_text"] = pm["text"].(map[string]any)["content"]
		}
	}
	out, _ := json.Marshal(m)
	return out
}

func (f *fakeNotion) setProps(p *fakePage, props map[string]json.RawMessage) {
	for _, fl := range f.dbs[p.db] {
		if raw, ok := props[fl.Name]; ok {
			p.props[fl.Name] = shape(fl.Kind, raw)
		}
	}
	p.edited = time.Now()
}

func (f *fakeNotion) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	body, _ := io.ReadAll(r.Body)
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	write := func(v any) { _ = json.NewEncoder(w).Encode(v) }
	notFound := func() {
		w.WriteHeader(404)
		write(map[string]string{"code": "object_not_found", "message": "not found"})
	}

	switch {
	case r.Method == "POST" && len(parts) == 3 && parts[0] == "databases" && parts[2] == "query":
		var results []any
		for _, p := range f.pages {
			if p.db == parts[1] && !p.archived {
				results = append(results, f.pageJSON(p))
			}
		}
		write(map[string]any{"results": results, "has_more": false})
	case r.Method == "GET" && len(parts) == 2 && parts[0] == "databases":
		props := map[string]any{}
		for _, fl := range f.dbs[parts[1]] {
			p := map[string]any{"type": fl.Kind}
			if fl.Kind == "select" {
				var opts []map[string]string
				for _, o := range fakeOptions[fl.Name] {
					opts = append(opts, map[string]string{"name": o})
				}
				p["select"] = map[string]any{"options": opts}
			}
			props[fl.Name] = p
		}
		write(map[string]any{"id": parts[1], "properties": props})
	case r.Method == "GET" && len(parts) == 2 && parts[0] == "pages":
		p, ok := f.pages[parts[1]]
		if !ok {
			notFound()
			return
		}
		write(f.pageJSON(p))
	case r.Method == "POST" && len(parts) == 1 && parts[0] == "pages":
		var req struct {
			Parent struct {
				DatabaseID string `json:"database_id"`
			} `json:"parent"`
			Properties map[string]json.RawMessage `json:"properties"`
		}
		_ = json.Unmarshal(body, &req)
		f.nextID++
		p := &fakePage{id: fmt.Sprintf("page%04d", f.nextID), db: req.Parent.DatabaseID, props: map[string]json.RawMessage{}, created: time.Now()}
		f.blank(p)
		f.setProps(p, req.Properties)
		f.pages[p.id] = p
		f.writes = append(f.writes, "POST "+p.db)
		if f.loseCreates > 0 {
			f.loseCreates--
			w.WriteHeader(502)
			write(map[string]string{"code": "bad_gateway", "message": "lost"})
			return
		}
		write(f.pageJSON(p))
	case r.Method == "PATCH" && len(parts) == 2 && parts[0] == "pages":
		p, ok := f.pages[parts[1]]
		if !ok {
			notFound()
			return
		}
		var req struct {
			Properties map[string]json.RawMessage `json:"properties"`
			Archived   *bool                      `json:"archived"`
		}
		_ = json.Unmarshal(body, &req)
		f.setProps(p, req.Properties)
		if req.Archived != nil {
			p.archived = *req.Archived
		}
		keys := []string{}
		for k := range req.Properties {
			keys = append(keys, k)
		}
		f.writes = append(f.writes, fmt.Sprintf("PATCH %s %v archived=%v", p.id, keys, req.Archived != nil && *req.Archived))
		write(f.pageJSON(p))
	default:
		notFound()
	}
}

// blank fills every property with its empty value.
func (f *fakeNotion) blank(p *fakePage) {
	for _, fl := range f.dbs[p.db] {
		v, _ := toNotion("", fl)
		raw, _ := json.Marshal(v)
		p.props[fl.Name] = shape(fl.Kind, raw)
	}
}

// seed adds a page from canonical values (called without the lock held).
func (f *fakeNotion) seed(db string, vals []string) string {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.nextID++
	p := &fakePage{id: fmt.Sprintf("page%04d", f.nextID), db: db, props: map[string]json.RawMessage{}, created: time.Now(), edited: time.Now()}
	for i, fl := range f.dbs[db] {
		v, _ := toNotion(vals[i], fl)
		raw, _ := json.Marshal(v)
		p.props[fl.Name] = shape(fl.Kind, raw)
	}
	f.pages[p.id] = p
	return p.id
}

func (f *fakeNotion) set(id, field, text string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	p := f.pages[id]
	for _, fl := range f.dbs[p.db] {
		if fl.Name == field {
			v, _ := toNotion(text, fl)
			raw, _ := json.Marshal(v)
			p.props[field] = shape(fl.Kind, raw)
		}
	}
	p.edited = time.Now()
}

func (f *fakeNotion) value(t *testing.T, id, field string) string {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	p := f.pages[id]
	for _, fl := range f.dbs[p.db] {
		if fl.Name == field {
			v, err := fromNotion(p.props[field], fl)
			if err != nil {
				t.Fatal(err)
			}
			return v
		}
	}
	t.Fatalf("no field %s", field)
	return ""
}

func (f *fakeNotion) archive(id string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pages[id].archived = true
}

func (f *fakeNotion) livePages(db string) []*fakePage {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []*fakePage
	for _, p := range f.pages {
		if p.db == db && !p.archived {
			out = append(out, p)
		}
	}
	return out
}

var fakeOptions = map[string][]string{
	"Type":     {"Masuk", "Keluar", "Saldo Awal"},
	"Category": {"Makan", "Transport", "Langganan", "Hiburan", "Lainnya", "Shopping"},
	"Account":  {"Mandiri Debit", "GoPay", "Tunai"},
	"Status":   {"Estimasi", "Sinkron", "Aktif", "Dijeda", "Berhenti"},
	"Cycle":    {"Bulanan", "Tahunan"},
}

const (
	dbTrx  = "dbtransactions"
	dbSub  = "dbsubscriptions"
	dbWeek = "dbweeks"
)

type harness struct {
	t      *testing.T
	pool   *pgxpool.Pool
	fake   *fakeNotion
	syncer *Syncer
	svc    *finance.Service
}

func newHarness(t *testing.T) *harness {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := database.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	if err := database.Migrate(ctx, pool, log); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `TRUNCATE finance.transactions, finance.subscriptions, finance.weeks, finance.audit_log, sync.state, sync.select_options, sync.settings`); err != nil {
		t.Fatal(err)
	}
	fake := newFakeNotion()
	fake.dbs[dbTrx], fake.dbs[dbSub], fake.dbs[dbWeek] = finance.TransactionFields, finance.SubscriptionFields, finance.WeekFields
	srv := httptest.NewServer(fake)
	t.Cleanup(srv.Close)

	repo := finance.NewRepository(pool)
	trx, subs, weeks := repo.SyncStores()
	syncer := NewSyncer(NewClient("test").WithBaseURL(srv.URL), pool, []Table{
		{Store: trx, DBID: dbTrx}, {Store: subs, DBID: dbSub}, {Store: weeks, DBID: dbWeek},
	}, repo.SaveOptions, ModeFull, time.Minute, log)
	svc := finance.NewService(repo, finance.Rules{Account: "Mandiri Debit", AnchorSubscription: "Claude", WeeklyAllowance: 250000, MinBalance: 50000},
		clock.System, nil, nil)
	return &harness{t: t, pool: pool, fake: fake, syncer: syncer, svc: svc}
}

func (h *harness) sync(opt Options) []Change {
	h.t.Helper()
	changes, err := h.syncer.RunOnce(context.Background(), opt)
	if err != nil {
		h.t.Fatalf("sync: %v", err)
	}
	return changes
}

func (h *harness) txByName(name string) finance.Transaction {
	h.t.Helper()
	snap, err := h.svc.Snapshot(context.Background())
	if err != nil {
		h.t.Fatal(err)
	}
	for _, tr := range snap.Transactions {
		if tr.Name == name {
			return tr
		}
	}
	h.t.Fatalf("transaction %q not found", name)
	return finance.Transaction{}
}

func today(offsetDays int) string {
	return clock.System().AddDate(0, 0, offsetDays).Format("2006-01-02")
}

func TestSyncTwoWay(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	f := h.fake

	opening := f.seed(dbTrx, []string{today(-10), "Saldo awal", "Saldo Awal", "", "Mandiri Debit", "153471", "153471", today(-10), "Sinkron", ""})
	lunch := f.seed(dbTrx, []string{today(-1) + "T12:30", "Makan siang", "Keluar", "Makan", "Mandiri Debit", "25000", "25000", today(-1) + "T12:30", "Estimasi", ""})
	f.seed(dbSub, []string{"Claude", "401998", "Bulanan", "Aktif", "20", today(10), ""})
	week := f.seed(dbWeek, []string{"W1", today(-10), "250000", "25000", ""})

	// 1. First run pulls everything; nothing is written to Notion.
	if c := h.sync(Options{}); len(c) != 4 || len(f.writes) != 0 {
		t.Fatalf("first run: %d changes, %d Notion writes; want 4 and 0", len(c), len(f.writes))
	}
	if c := h.sync(Options{}); len(c) != 0 {
		t.Fatalf("second run should be idle, got %+v", c)
	}

	// 2. A local edit is pushed, only the changed fields.
	tr := h.txByName("Makan siang")
	if _, err := h.svc.UpdateTransaction(ctx, "test", tr.ID, finance.PatchInput{Amount: ptr64(27000)}); err != nil {
		t.Fatal(err)
	}
	h.sync(Options{})
	if got := f.value(t, lunch, "Amount"); got != "27000" {
		t.Errorf("Notion Amount = %s, want 27000", got)
	}
	if got := f.value(t, lunch, "Reported Amount"); got != "27000" {
		t.Errorf("Reported Amount should follow while unreconciled, got %s", got)
	}
	last := f.writes[len(f.writes)-1]
	if !strings.Contains(last, "Amount") || strings.Contains(last, "Notes") {
		t.Errorf("patch should touch only the amounts: %s", last)
	}

	// 3. A Notion edit is pulled.
	f.set(lunch, "Notes", "with friends")
	h.sync(Options{})
	if got := h.txByName("Makan siang").Notes; got != "with friends" {
		t.Errorf("local Notes = %q", got)
	}

	// 4. Different fields edited on both sides merge.
	tr = h.txByName("Makan siang")
	if _, err := h.svc.UpdateTransaction(ctx, "test", tr.ID, finance.PatchInput{Name: strp("Makan siang kampus")}); err != nil {
		t.Fatal(err)
	}
	f.set(lunch, "Category", "Lainnya")
	h.sync(Options{})
	got := h.txByName("Makan siang kampus")
	if got.Category != "Lainnya" || f.value(t, lunch, "Name") != "Makan siang kampus" {
		t.Errorf("merge: local category %q, Notion name %q", got.Category, f.value(t, lunch, "Name"))
	}

	// 5. A new allowance from the web creates the transaction and a new week in Notion.
	if _, err := h.svc.AddTransaction(ctx, "test", finance.AddInput{Type: "Masuk", Name: "Sangu", Amount: 250000, Date: today(0), WeeklyAllowance: true}); err != nil {
		t.Fatal(err)
	}
	h.sync(Options{})
	if n := len(f.livePages(dbTrx)); n != 3 {
		t.Errorf("Notion transactions = %d, want 3", n)
	}
	var newWeek *fakePage
	for _, p := range f.livePages(dbWeek) {
		if p.id != week {
			newWeek = p
		}
	}
	if newWeek == nil || f.value(t, newWeek.id, "Week") != "W2" || f.value(t, newWeek.id, "Start") != today(0) {
		t.Fatalf("new week not created in Notion")
	}

	// 6. External fields come from Notion (the sheet) and are never pushed back.
	f.set(week, "Income", "300000")
	h.sync(Options{})
	snap, _ := h.svc.Snapshot(ctx)
	for _, w := range snap.Weeks {
		if w.Week == "W1" && (w.Income == nil || *w.Income != 300000) {
			t.Errorf("week income = %v, want 300000", w.Income)
		}
	}

	// 7. A local delete archives the page; a Notion delete removes the local row.
	tr = h.txByName("Makan siang kampus")
	if err := h.svc.DeleteTransaction(ctx, "test", tr.ID); err != nil {
		t.Fatal(err)
	}
	h.sync(Options{})
	if !f.pages[lunch].archived {
		t.Error("page should be archived after a local delete")
	}
	f.archive(opening)
	h.sync(Options{})
	snap, _ = h.svc.Snapshot(ctx)
	for _, tr := range snap.Transactions {
		if tr.Name == "Saldo awal" {
			t.Error("row should be gone after the page was archived in Notion")
		}
	}
	if c := h.sync(Options{}); len(c) != 0 {
		t.Errorf("should settle, got %+v", c)
	}
}

func TestSyncMassDeleteGuard(t *testing.T) {
	h := newHarness(t)
	var ids []string
	for i := 0; i < 6; i++ {
		ids = append(ids, h.fake.seed(dbTrx, []string{today(-1), fmt.Sprintf("Row %d", i), "Keluar", "Makan", "Mandiri Debit", "1000", "1000", today(-1), "Estimasi", ""}))
	}
	h.sync(Options{})
	for _, id := range ids[:5] {
		h.fake.archive(id)
	}
	if _, err := h.syncer.RunOnce(context.Background(), Options{}); err == nil || !strings.Contains(err.Error(), "safety limit") {
		t.Fatalf("expected the safety limit to stop the run, got %v", err)
	}
	snap, _ := h.svc.Snapshot(context.Background())
	if len(snap.Transactions) != 6 {
		t.Fatalf("nothing should be deleted, have %d rows", len(snap.Transactions))
	}
	h.sync(Options{Force: true})
	snap, _ = h.svc.Snapshot(context.Background())
	if len(snap.Transactions) != 1 {
		t.Fatalf("forced run should delete 5, have %d rows", len(snap.Transactions))
	}
}

func TestSyncPullModeNeverWrites(t *testing.T) {
	h := newHarness(t)
	h.syncer.mode = ModePull
	id := h.fake.seed(dbTrx, []string{today(-1), "Roti", "Keluar", "Makan", "Mandiri Debit", "15000", "15000", today(-1), "Estimasi", ""})
	h.sync(Options{})
	if _, err := h.pool.Exec(context.Background(), `UPDATE finance.transactions SET amount = 1, version = version + 1`); err != nil {
		t.Fatal(err)
	}
	h.sync(Options{})
	if len(h.fake.writes) != 0 {
		t.Errorf("pull mode wrote to Notion: %v", h.fake.writes)
	}
	if got := h.txByName("Roti").AmountValue(); got != 15000 {
		t.Errorf("pull mode should restore Notion's value, got %d", got)
	}
	_ = id
	if err := h.syncer.Writable(); err == nil {
		t.Error("pull mode must refuse web writes")
	}
}

func TestSyncDryRunChangesNothing(t *testing.T) {
	h := newHarness(t)
	h.fake.seed(dbTrx, []string{today(-1), "Roti", "Keluar", "Makan", "Mandiri Debit", "15000", "15000", today(-1), "Estimasi", ""})
	if c := h.sync(Options{DryRun: true}); len(c) != 1 || c[0].Action != "insert" {
		t.Fatalf("dry run plan = %+v", c)
	}
	snap, _ := h.svc.Snapshot(context.Background())
	if len(snap.Transactions) != 0 {
		t.Error("dry run wrote to Postgres")
	}
}

// A create that reached Notion but lost its answer is linked, not made twice, and an edit
// made meanwhile is still pushed.
func TestSyncLostCreateAnswerMakesNoDuplicate(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	f := h.fake
	tr, err := h.svc.AddTransaction(ctx, "test", finance.AddInput{Type: "Keluar", Name: "Kopi", Amount: 1, Category: "Makan", Date: today(0)})
	if err != nil {
		t.Fatal(err)
	}

	f.loseCreates = 1
	if _, err := h.syncer.RunOnce(ctx, Options{}); err == nil {
		t.Fatal("the lost answer should fail the run")
	}
	if n := len(f.livePages(dbTrx)); n != 1 {
		t.Fatalf("Notion transactions = %d, want 1 (one create, not retried)", n)
	}
	if _, err := h.svc.UpdateTransaction(ctx, "test", tr.ID, finance.PatchInput{Notes: strp("dikecualikan dari kuota")}); err != nil {
		t.Fatal(err)
	}

	if c := h.sync(Options{}); len(c) != 1 || c[0].Action != "link" {
		t.Fatalf("second run should link the lost page, got %+v", c)
	}
	h.sync(Options{})
	pages := f.livePages(dbTrx)
	if len(pages) != 1 {
		t.Fatalf("Notion transactions = %d, want 1", len(pages))
	}
	if got := f.value(t, pages[0].id, "Notes"); got != "dikecualikan dari kuota" {
		t.Errorf("edit made after the lost create was not pushed, Notes = %q", got)
	}
	var pageID string
	if err := h.pool.QueryRow(ctx, `SELECT notion_page_id FROM finance.transactions WHERE id = $1`, tr.ID).Scan(&pageID); err != nil {
		t.Fatal(err)
	}
	if pageID != pages[0].id {
		t.Errorf("row linked to %q, want %q", pageID, pages[0].id)
	}
	if c := h.sync(Options{}); len(c) != 0 {
		t.Errorf("should settle, got %+v", c)
	}
}

func ptr64(v int64) *int64  { return &v }
func strp(v string) *string { return &v }
