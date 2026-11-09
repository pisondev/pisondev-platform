package finance

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
)

var testRules = Rules{
	Account:            "Mandiri Debit",
	AnchorSubscription: "Claude",
	WeeklyAllowance:    Rupiah(250000),
	MinBalance:         Rupiah(50000),
	ExcludeMarker:      "dikecualikan dari kuota",
}

func d(s string) LocalDate {
	v, err := ParseLocalDate(s)
	if err != nil {
		panic(err)
	}
	return v
}

func tx(date, name, typ, cat string, amount int64, notes string) Transaction {
	return Transaction{ID: name, Date: d(date), Name: name, Type: typ, Category: cat, Account: "Mandiri Debit", Amount: ptr(Rupiah(amount)), Notes: notes}
}

func sub(name string, price int64, cycle string, day int64, next string) Subscription {
	return Subscription{ID: name, Name: name, Price: ptr(Rupiah(price)), Cycle: cycle, Status: SubActive, BillingDay: ptr(day), NextBilling: d(next)}
}

// snapshotOct1 reproduces the reference figures written down on 1 Oct 2026:
// Balance 470.877, Max 151.000, spent 47.500, W0 103.471, W1 54.109, W2 263.297,
// subscriptions due by 20 Oct 466.998, October roster 591.898.
func snapshotOct1() Snapshot {
	const ex = "paid back by family, dikecualikan dari kuota"
	return Snapshot{
		Transactions: []Transaction{
			tx("2026-09-20T15:07", "Opening balance", TypeOpening, "", 153471, ""),
			tx("2026-09-22", "Shared bill", TypeIncome, "", 100000, ""),
			tx("2026-09-23T12:00", "Lunch", TypeExpense, "Makan", 45891, ""),
			tx("2026-09-29T08:00", "Allowance", TypeIncome, "", 250000, ""),
			tx("2026-09-29T19:00", "Errand item 1", TypeExpense, "Shopping", 241979, ex),
			tx("2026-09-29T19:01", "Errand item 2", TypeExpense, "Shopping", 56824, ex),
			tx("2026-09-29T19:02", "Own item covered by family", TypeExpense, "Shopping", 125400, "Dikecualikan dari kuota, covered by family"),
			tx("2026-09-30T10:00", "Family transfer", TypeIncome, "", 450000, ""),
			tx("2026-09-30T12:00", "Shared plan refund", TypeIncome, "", 35000, ""),
			tx("2026-09-30T13:00", "Bakery", TypeExpense, "Makan", 15000, ""),
			tx("2026-10-01T12:30", "Lunch", TypeExpense, "Makan", 32500, ""),
			{ID: "gopay", Date: d("2026-10-01"), Name: "Wallet snack", Type: TypeExpense, Category: "Makan", Account: "GoPay", Amount: ptr(Rupiah(9000))},
		},
		Subscriptions: []Subscription{
			sub("Claude", 401998, CycleMonthly, 20, "2026-10-20"),
			sub("Disney+", 65000, CycleMonthly, 20, "2026-10-20"),
			sub("Spotify", 59900, CycleMonthly, 26, "2026-10-26"),
			sub("Paket Data HP Telkomsel", 65000, CycleMonthly, 29, "2026-10-29"),
			sub("Domain tierratie.com", 209900, CycleYearly, 15, "2026-12-15"),
			sub("Duolingo Family", 664890, CycleYearly, 25, "2027-09-25"),
		},
		Weeks: []Week{
			{ID: "w1", Week: "W1", Start: d("2026-09-20")},
			{ID: "w2", Week: "W2", Start: d("2026-09-29")},
		},
	}
}

func at(s string) time.Time {
	t, err := time.ParseInLocation("2006-01-02T15:04", s, clock.WIB)
	if err != nil {
		panic(err)
	}
	return t
}

func TestQuotaMatchesSheetOct1(t *testing.T) {
	q := ComputeQuota(snapshotOct1(), testRules, at("2026-10-01T20:00"))

	check := func(name string, got Money, want int64) {
		t.Helper()
		if got != Rupiah(want) {
			t.Errorf("%s = %s, want %d", name, got, want)
		}
	}
	check("Balance", q.Balance, 470877)
	check("SubscriptionsDue", q.Breakdown.SubscriptionsDue, 466998)
	check("FreeFunds", q.Breakdown.FreeFunds, 453879)
	check("Max", q.Max, 151000)
	check("Spent", q.Spent, 47500)
	check("Remaining", q.Remaining, 103500)
	check("Save", q.Savings.Save, 420877)
	check("Target", q.Savings.Target, 591898)
	if q.Breakdown.WeeksToDeadline != 3 || q.Breakdown.DepositsExpected != 2 {
		t.Errorf("weeks/deposits = %d/%d, want 3/2", q.Breakdown.WeeksToDeadline, q.Breakdown.DepositsExpected)
	}
	if q.Period != (Period{Start: "2026-09-29", End: "2026-10-04"}) {
		t.Errorf("Period = %+v", q.Period)
	}
	if q.Level != "green" || q.Percent != 31 {
		t.Errorf("Level/Percent = %s/%d, want green/31", q.Level, q.Percent)
	}
	if q.Savings.Status != "short" {
		t.Errorf("Savings.Status = %s, want short", q.Savings.Status)
	}

	rows := q.Savings.Rows
	if len(rows) < 3 {
		t.Fatalf("savings rows = %d, want at least 3", len(rows))
	}
	for i, want := range []struct {
		label  string
		amount int64
	}{{"W0", 103471}, {"W1", 54109}, {"W2", 263297}} {
		if rows[i].Label != want.label || rows[i].Amount == nil || *rows[i].Amount != Rupiah(want.amount) {
			t.Errorf("row %d = %s %v, want %s %d", i, rows[i].Label, rows[i].Amount, want.label, want.amount)
		}
	}
	// Two estimated weeks remain before the 20 Oct deadline: 5-11 and 12-18 Oct.
	var est []string
	for _, r := range rows {
		if r.Estimated {
			est = append(est, r.Start+".."+r.End)
		}
	}
	if len(est) != 3 || est[0] != "2026-10-05..2026-10-11" {
		t.Errorf("estimated weeks = %v", est)
	}

	if len(q.Expenses) == 0 || q.Expenses[0].Name != "Lunch" || q.Expenses[0].Amount != Rupiah(32500) {
		t.Errorf("latest expense = %+v", q.Expenses)
	}
	for _, e := range q.Expenses {
		if e.Name == "Own item covered by family" || e.Name == "Wallet snack" {
			t.Errorf("excluded expense listed: %s", e.Name)
		}
	}
	// Next week: 470.877 - 103.500 + 250.000 = 617.377; 2 weeks, 1 deposit;
	// free = 617.377 + 250.000 - 466.998 - 50.000 = 350.379; /2 -> 175.000.
	check("NextWeekMax", q.NextWeekMax, 175000)
}

func TestNextWeekRollsOverDeadline(t *testing.T) {
	s := snapshotOct1()
	s.Weeks = append(s.Weeks, Week{ID: "w4", Week: "W4", Start: d("2026-10-13")})
	q := ComputeQuota(s, testRules, at("2026-10-15T09:00"))
	if q.Breakdown.WeeksToDeadline != 1 {
		t.Fatalf("weeks = %d, want 1", q.Breakdown.WeeksToDeadline)
	}
	// Next week (20-26 Oct) contains the deadline: bills due by 20 Oct count as paid and
	// the deadline moves to 20 Nov.
	// balance 420.877 - remaining + 250.000 - 466.998 paid; 4 weeks to 20 Nov, 3 deposits;
	// due by 20 Nov minus paid = Claude, Disney+ (Nov) + Spotify + Telkomsel = 591.898.
	rem := q.Remaining
	if rem < 0 {
		rem = 0
	}
	balance := q.Balance - rem + Rupiah(250000) - Rupiah(466998)
	free := balance + 3*Rupiah(250000) - Rupiah(591898) - Rupiah(50000)
	if want := floorThousands(float64(free) / 4); q.NextWeekMax != want {
		t.Errorf("NextWeekMax = %s, want %s", q.NextWeekMax, want)
	}
	if q.Period.End != "2026-10-18" {
		t.Errorf("Period.End = %s, want 2026-10-18", q.Period.End)
	}
}

func TestPeriodExtendsUntilNextAllowance(t *testing.T) {
	q := ComputeQuota(snapshotOct1(), testRules, at("2026-10-06T10:00"))
	if q.Period != (Period{Start: "2026-09-29", End: "2026-10-06"}) {
		t.Errorf("Period = %+v, want 29 Sep to today", q.Period)
	}
}

func TestQuotaWithoutExpensesListsNone(t *testing.T) {
	q := ComputeQuota(Snapshot{}, testRules, at("2026-11-09T09:00"))
	b, err := json.Marshal(q)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), `"expenses":[]`) {
		t.Errorf("expenses should be an empty list, got %s", b)
	}
}

func TestQuotaLevel(t *testing.T) {
	cases := []struct {
		spent, max int64
		pct        int
		level      string
	}{
		{0, 87000, 0, "empty"},
		{30500, 87000, 35, "green"},
		{61000, 87000, 70, "yellow"},
		{79000, 87000, 91, "red"},
		{104500, 87000, 120, "red"},
		{1000, 0, 100, "red"},
	}
	for _, tc := range cases {
		pct, level := quotaLevel(Rupiah(tc.spent), Rupiah(tc.max))
		if pct != tc.pct || level != tc.level {
			t.Errorf("quotaLevel(%d, %d) = %d %s, want %d %s", tc.spent, tc.max, pct, level, tc.pct, tc.level)
		}
	}
}

func TestRosterRule(t *testing.T) {
	s := snapshotOct1()
	r := ComputeRoster(s.Subscriptions)
	if r.Month != "2026-10" || r.Total != Rupiah(591898) || len(r.Items) != 4 {
		t.Fatalf("roster = %s %s %d", r.Month, r.Total, len(r.Items))
	}
	if r.Items[0].Name != "Claude" || r.Items[len(r.Items)-1].Name != "Spotify" {
		t.Errorf("order = %v", r.Items)
	}
	// Paying Claude moves its Next Billing to November: it shows as paid in October.
	s.Subscriptions[0].NextBilling = d("2026-11-20")
	r = ComputeRoster(s.Subscriptions)
	if r.Month != "2026-10" || !r.Items[0].Paid || r.Items[1].Paid {
		t.Errorf("after paying Claude: %+v", r.Items)
	}
}

func TestAdvanceBilling(t *testing.T) {
	cases := []struct {
		s    Subscription
		want string
	}{
		{sub("a", 1, CycleMonthly, 20, "2026-10-20"), "2026-11-20"},
		{sub("b", 1, CycleMonthly, 31, "2027-01-31"), "2027-02-28"},
		{sub("c", 1, CycleMonthly, 31, "2027-02-28"), "2027-03-31"},
		{sub("d", 1, CycleMonthly, 26, "2026-12-26"), "2027-01-26"},
		{sub("e", 1, CycleYearly, 25, "2026-09-25"), "2027-09-25"},
	}
	for _, tc := range cases {
		got, ok := AdvanceBilling(tc.s)
		if !ok || got.String() != tc.want {
			t.Errorf("%s: got %s, want %s", tc.s.Name, got, tc.want)
		}
	}
}

func TestCashflowMonthly(t *testing.T) {
	cf := ComputeCashflow(snapshotOct1(), testRules, "monthly", at("2026-10-01T20:00"))
	if len(cf.Points) != 2 || cf.Points[0].Label != "Sep" || cf.Points[1].Label != "Oct" {
		t.Fatalf("points = %+v", cf.Points)
	}
	if cf.Points[1].Outcome != Rupiah(32500) {
		t.Errorf("Oct outcome = %s, want 32500 (GoPay excluded)", cf.Points[1].Outcome)
	}
}

func TestLocalDateCanonical(t *testing.T) {
	cases := map[string]string{
		"2026-10-01":          "2026-10-01",
		"2026-10-01 12:30":    "2026-10-01T12:30",
		"2026-10-01T12:30":    "2026-10-01T12:30",
		"2026-10-01T00:00":    "2026-10-01",
		"2026-10-01T12:30:59": "2026-10-01T12:30",
		"":                    "",
	}
	for in, want := range cases {
		got, err := ParseLocalDate(in)
		if err != nil || got.String() != want {
			t.Errorf("ParseLocalDate(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	if _, err := ParseLocalDate("01/10/2026"); err == nil {
		t.Error("expected an error for a foreign format")
	}
}

func TestCanonicalRoundTrip(t *testing.T) {
	for _, tr := range snapshotOct1().Transactions {
		tr.ID = ""
		back, err := parseTransaction(tr.canonical())
		if err != nil {
			t.Fatal(err)
		}
		if got, want := back.canonical(), tr.canonical(); !equalStrings(got, want) {
			t.Errorf("round trip %v != %v", got, want)
		}
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func TestCashflowBillingCycles(t *testing.T) {
	sub := func(date string, amount int64) Transaction {
		return tx(date, "Bill "+date, TypeExpense, CategorySubscription, amount, "")
	}
	s := Snapshot{Transactions: []Transaction{
		tx("2026-09-20T15:07", "Opening balance", TypeOpening, "", 153471, ""),
		sub("2026-09-25", 664890),
		sub("2026-09-29", 65000),
		tx("2026-09-30", "Transfer", TypeIncome, "", 450000, ""),
		sub("2026-10-01", 100750),
		tx("2026-10-20T10:00", "Claude", TypeExpense, CategorySubscription, 0, ""),
		sub("2026-10-27", 65000),
		tx("2026-10-27T16:00", "Coffee", TypeExpense, "Makan", 25000, ""),
		tx("2026-10-28", "Snack", TypeExpense, "Makan", 3000, ""),
		tx("2026-11-02", "Allowance", TypeIncome, "", 350000, ""),
	}}
	s.Transactions[5].Amount = ptr(Money(41655165)) // 416.551,65
	cf := ComputeCashflow(s, testRules, "billing", at("2026-11-09T09:00"))
	want := []struct {
		label, start, end string
		income, outcome   Money
	}{
		{"Sep 29", "2026-09-20", "2026-09-29", 0, Rupiah(664890 + 65000)},
		{"Oct 27", "2026-09-30", "2026-10-27", Rupiah(450000), Rupiah(100750+65000+25000) + 41655165},
		{"Now", "2026-10-28", "2026-11-09", Rupiah(350000), Rupiah(3000)},
	}
	if cf.Granularity != "billing" || len(cf.Points) != len(want) {
		t.Fatalf("cycles = %s %+v", cf.Granularity, cf.Points)
	}
	for i, w := range want {
		p := cf.Points[i]
		if p.Label != w.label || p.Start != w.start || p.End != w.end || p.Income != w.income || p.Outcome != w.outcome {
			t.Errorf("cycle %d = %+v, want %+v", i, p, w)
		}
	}
}

// Each closed bill cycle could save its own surplus (the first also its opening balance
// above the minimum), so cycles add up; moves to savings fill the oldest cycle first and
// are neither spending nor outcome. The running cycle has no figures.
func TestCashflowSavings(t *testing.T) {
	s := Snapshot{Transactions: []Transaction{
		tx("2026-09-20T15:07", "Opening balance", TypeOpening, "", 153471, ""),
		tx("2026-09-22", "Allowance", TypeIncome, "", 400000, ""),
		tx("2026-09-29", "Bill", TypeExpense, CategorySubscription, 410000, ""),
		tx("2026-09-30", "Allowance", TypeIncome, "", 500000, ""),
		tx("2026-10-27", "Bill", TypeExpense, CategorySubscription, 200000, ""),
		tx("2026-10-28", "Pindah ke tabungan", TypeExpense, "Lainnya", 150000, "Sisihkan, dipindah ke tabungan, dikecualikan dari kuota"),
		tx("2026-11-01", "Snack", TypeExpense, "Makan", 20000, ""),
	}}
	cf := ComputeCashflow(s, testRules, "billing", at("2026-11-02T09:00"))
	if len(cf.Points) != 3 {
		t.Fatalf("points = %+v", cf.Points)
	}
	sep, oct, now := cf.Points[0], cf.Points[1], cf.Points[2]
	// Sep: opening 153.471 - 50.000 + (400.000 - 410.000) = 93.471, all moved by the
	// first 150.000; Oct: 300.000, of which 56.529 moved.
	check := func(name string, p CashflowPoint, could, saved, left int64) {
		t.Helper()
		if p.CouldSave == nil || *p.CouldSave != Rupiah(could) || *p.SavedFor != Rupiah(saved) || *p.Left != Rupiah(left) {
			t.Errorf("%s = could %v saved %v left %v", name, p.CouldSave, p.SavedFor, p.Left)
		}
	}
	check("Sep", sep, 93471, 93471, 0)
	check("Oct", oct, 300000, 56529, 243471)
	if !now.Running || now.CouldSave != nil || now.Saved != Rupiah(150000) || now.Outcome != Rupiah(20000) {
		t.Errorf("running cycle = %+v", now)
	}
	if cf.Unsaved != Rupiah(243471) {
		t.Errorf("Unsaved = %s, want 243471", cf.Unsaved)
	}
	// Balance today: 153.471 + 900.000 - 610.000 - 150.000 - 20.000 = 273.471.
	if cf.Available != Rupiah(223471) {
		t.Errorf("Available = %s, want 223471", cf.Available)
	}
	q := ComputeQuota(s, testRules, at("2026-11-02T09:00"))
	for _, e := range q.Expenses {
		if e.Name == "Pindah ke tabungan" {
			t.Error("a move to savings counts as spending")
		}
	}
}
