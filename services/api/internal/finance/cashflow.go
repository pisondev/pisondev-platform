package finance

import (
	"sort"
	"time"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
)

type CashflowPoint struct {
	Label   string `json:"label"`
	Start   string `json:"start"`
	End     string `json:"end"`
	Income  Money  `json:"income"`
	Outcome Money  `json:"outcome"`
	Net     Money  `json:"net"`
}

type Cashflow struct {
	Granularity string          `json:"granularity"` // monthly, weekly or billing
	Points      []CashflowPoint `json:"points"`
}

// ComputeCashflow totals income and expenses of the tracked account per calendar month,
// per Weekly Recap week, or per billing cycle, from the opening balance up to today.
//
// A billing cycle ends on the day of the month's last subscription bill (a Langganan
// expense) and starts the day after the previous one, or at the opening balance. Its
// label is that end date; the cycle still running after the last bill is "Now".
func ComputeCashflow(s Snapshot, r Rules, granularity string, now time.Time) Cashflow {
	today := clock.Day(now)
	cf := Cashflow{Granularity: granularity, Points: []CashflowPoint{}}
	type bucket struct{ from, to time.Time }
	var buckets []bucket
	var labels []string

	first, ok := openingDate(s.Transactions)
	if !ok {
		first = today
		for _, t := range s.Transactions {
			if t.Date.Valid() && t.Date.Day().Before(first) {
				first = t.Date.Day()
			}
		}
	}

	switch granularity {
	case "weekly":
		starts := weekStarts(s.Weeks, today)
		for i, st := range starts {
			to := today.AddDate(0, 0, 1)
			if i+1 < len(starts) {
				to = starts[i+1]
			}
			buckets = append(buckets, bucket{st, to})
			labels = append(labels, st.Format("Jan 2"))
		}
	case "billing":
		from := first
		for _, cut := range billingCutoffs(s.Transactions, r, first, today) {
			buckets = append(buckets, bucket{from, cut.AddDate(0, 0, 1)})
			labels = append(labels, cut.Format("Jan 2"))
			from = cut.AddDate(0, 0, 1)
		}
		if !from.After(today) {
			buckets = append(buckets, bucket{from, today.AddDate(0, 0, 1)})
			labels = append(labels, "Now")
		}
	default:
		cf.Granularity = "monthly"
		for m := time.Date(first.Year(), first.Month(), 1, 0, 0, 0, 0, clock.WIB); !m.After(today); m = m.AddDate(0, 1, 0) {
			buckets = append(buckets, bucket{m, m.AddDate(0, 1, 0)})
			labels = append(labels, m.Format("Jan"))
		}
	}

	for i, b := range buckets {
		p := CashflowPoint{Label: labels[i], Start: b.from.Format(dateLayout), End: b.to.AddDate(0, 0, -1).Format(dateLayout)}
		for _, t := range s.Transactions {
			if t.Account != r.Account || !t.Date.Valid() {
				continue
			}
			d := t.Date.Day()
			if d.Before(b.from) || !d.Before(b.to) {
				continue
			}
			switch t.Type {
			case TypeIncome:
				p.Income += t.AmountValue()
			case TypeExpense:
				p.Outcome += t.AmountValue()
			}
		}
		p.Net = p.Income - p.Outcome
		cf.Points = append(cf.Points, p)
	}
	return cf
}

// billingCutoffs returns, per month, the day of the last subscription bill on the
// tracked account, from first up to today, ascending.
func billingCutoffs(txs []Transaction, r Rules, first, today time.Time) []time.Time {
	last := map[time.Time]time.Time{} // month -> latest bill day
	for _, t := range txs {
		if t.Type != TypeExpense || t.Category != CategorySubscription || t.Account != r.Account || !t.Date.Valid() {
			continue
		}
		d := t.Date.Day()
		if d.Before(first) || d.After(today) {
			continue
		}
		m := time.Date(d.Year(), d.Month(), 1, 0, 0, 0, 0, clock.WIB)
		if d.After(last[m]) {
			last[m] = d
		}
	}
	out := make([]time.Time, 0, len(last))
	for _, d := range last {
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Before(out[j]) })
	return out
}

// TransactionFilter selects rows for the list under the cash flow chart.
type TransactionFilter struct {
	Kind  string // all, income, outcome
	Limit int
}

// FilterTransactions returns rows newest first. Opening balance rows are left out.
func FilterTransactions(txs []Transaction, f TransactionFilter) []Transaction {
	out := []Transaction{}
	for _, t := range txs {
		switch {
		case t.Type == TypeOpening:
			continue
		case f.Kind == "income" && t.Type != TypeIncome:
			continue
		case f.Kind == "outcome" && t.Type != TypeExpense:
			continue
		}
		out = append(out, t)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[j].Date.Before(out[i].Date) })
	if f.Limit > 0 && len(out) > f.Limit {
		out = out[:f.Limit]
	}
	return out
}
