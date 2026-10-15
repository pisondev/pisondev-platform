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
	Income  int64  `json:"income"`
	Outcome int64  `json:"outcome"`
	Net     int64  `json:"net"`
}

type Cashflow struct {
	Granularity string          `json:"granularity"` // monthly or weekly
	Points      []CashflowPoint `json:"points"`
}

// ComputeCashflow totals income and expenses of the tracked account per calendar month,
// or per Weekly Recap week, from the opening balance up to today.
func ComputeCashflow(s Snapshot, r Rules, granularity string, now time.Time) Cashflow {
	today := clock.Day(now)
	cf := Cashflow{Granularity: granularity, Points: []CashflowPoint{}}
	type bucket struct{ from, to time.Time }
	var buckets []bucket
	var labels []string

	if granularity == "weekly" {
		starts := weekStarts(s.Weeks, today)
		for i, st := range starts {
			to := today.AddDate(0, 0, 1)
			if i+1 < len(starts) {
				to = starts[i+1]
			}
			buckets = append(buckets, bucket{st, to})
			labels = append(labels, st.Format("Jan 2"))
		}
	} else {
		cf.Granularity = "monthly"
		first, ok := openingDate(s.Transactions)
		if !ok {
			first = today
			for _, t := range s.Transactions {
				if t.Date.Valid() && t.Date.Day().Before(first) {
					first = t.Date.Day()
				}
			}
		}
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
