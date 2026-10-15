package finance

import (
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
)

// Rules are the tunable assumptions of the quota. Defaults match the sheet.
type Rules struct {
	Account            string // only this account counts toward balance and quota
	AnchorSubscription string // its Next Billing is the quota deadline
	WeeklyAllowance    int64
	MinBalance         int64
	ExcludeMarker      string // Notes phrase that keeps an expense out of the quota
}

const day = 24 * time.Hour

// Balance = opening balance + income - expenses, on the tracked account only.
func Balance(txs []Transaction, r Rules) int64 {
	var b int64
	for _, t := range txs {
		if t.Account != r.Account {
			continue
		}
		switch t.Type {
		case TypeOpening, TypeIncome:
			b += t.AmountValue()
		case TypeExpense:
			b -= t.AmountValue()
		}
	}
	return b
}

// countsTowardQuota: an expense on the tracked account that is neither a subscription
// nor marked as paid back by someone else.
func countsTowardQuota(t Transaction, r Rules) bool {
	return t.Type == TypeExpense && t.Account == r.Account && t.Category != CategorySubscription &&
		!(r.ExcludeMarker != "" && strings.Contains(strings.ToLower(t.Notes), strings.ToLower(r.ExcludeMarker)))
}

// openingDate is the date of the earliest Saldo Awal row.
func openingDate(txs []Transaction) (time.Time, bool) {
	for _, t := range txs {
		if t.Type == TypeOpening && t.Date.Valid() {
			return t.Date.Day(), true
		}
	}
	return time.Time{}, false
}

// weekStarts returns the distinct Weekly Recap start days up to today, ascending.
func weekStarts(weeks []Week, today time.Time) []time.Time {
	var out []time.Time
	seen := map[time.Time]bool{}
	for _, w := range weeks {
		if !w.Start.Valid() {
			continue
		}
		d := w.Start.Day()
		if d.After(today) || seen[d] {
			continue
		}
		seen[d] = true
		out = append(out, d)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Before(out[j]) })
	return out
}

// nextBillingAfter moves a billing date one cycle forward. A billing day that does not
// exist in the target month falls on its last day, and returns to the billing day after.
func nextBillingAfter(s Subscription, from time.Time) time.Time {
	billingDay := from.Day()
	if s.BillingDay != nil && *s.BillingDay >= 1 && *s.BillingDay <= 31 {
		billingDay = int(*s.BillingDay)
	}
	year, month := from.Year(), from.Month()
	if s.Cycle == CycleYearly {
		year++
	} else {
		month++
		if month > 12 {
			month, year = 1, year+1
		}
	}
	last := time.Date(year, month+1, 0, 0, 0, 0, 0, clock.WIB).Day()
	if billingDay > last {
		billingDay = last
	}
	return time.Date(year, month, billingDay, 0, 0, 0, 0, clock.WIB)
}

// dueBy sums every unpaid occurrence of active subscriptions up to and including
// deadline, projecting each forward by its cycle.
func dueBy(subs []Subscription, deadline time.Time) int64 {
	var total int64
	for _, s := range subs {
		if s.Status != SubActive || !s.NextBilling.Valid() || s.PriceValue() <= 0 {
			continue
		}
		for d, guard := s.NextBilling.Day(), 0; !d.After(deadline) && guard < 120; d, guard = nextBillingAfter(s, d), guard+1 {
			total += s.PriceValue()
		}
	}
	return total
}

func floorThousands(x float64) int64 {
	return int64(math.Floor(x/1000) * 1000)
}

func daysBetween(a, b time.Time) int {
	return int(math.Round(b.Sub(a).Hours() / 24))
}

// firstSundayAfter returns the first Sunday strictly after d.
func firstSundayAfter(d time.Time) time.Time {
	offset := (7 - int(d.Weekday())) % 7
	if offset == 0 {
		offset = 7
	}
	return d.AddDate(0, 0, offset)
}

// ---------------------------------------------------------------------------------------
// Weekly spending quota

type Period struct {
	Start string `json:"start"`
	End   string `json:"end"`
}

type QuotaBreakdown struct {
	Deadline         string `json:"deadline"`
	DeadlineSource   string `json:"deadlineSource"` // anchor name, or "fallback"
	WeeksToDeadline  int    `json:"weeksToDeadline"`
	DepositsExpected int    `json:"depositsExpected"`
	SubscriptionsDue int64  `json:"subscriptionsDue"`
	FreeFunds        int64  `json:"freeFunds"`
	WeeklyAllowance  int64  `json:"weeklyAllowance"`
	MinBalance       int64  `json:"minBalance"`
}

type ExpenseItem struct {
	ID     string    `json:"id"`
	Date   LocalDate `json:"date"`
	Name   string    `json:"name"`
	Amount int64     `json:"amount"`
	Notes  string    `json:"notes"`
}

type SavingsRow struct {
	Label     string `json:"label"` // W0, W1, ...
	Start     string `json:"start,omitempty"`
	End       string `json:"end,omitempty"` // empty while the week is running
	Amount    *int64 `json:"amount"`        // nil for estimated weeks
	Notes     string `json:"notes"`
	Estimated bool   `json:"estimated"`
	Genesis   bool   `json:"genesis"`
}

type Savings struct {
	Save       int64        `json:"save"`   // always Balance - MinBalance
	Target     int64        `json:"target"` // total of this month's subscription roster
	Gap        int64        `json:"gap"`    // Target - Save; positive means short
	Status     string       `json:"status"` // safe or short
	CycleStart string       `json:"cycleStart"`
	Rows       []SavingsRow `json:"rows"`
}

type Quota struct {
	Today       string         `json:"today"`
	Period      Period         `json:"period"`
	Balance     int64          `json:"balance"`
	Max         int64          `json:"max"`
	Spent       int64          `json:"spent"`
	Remaining   int64          `json:"remaining"`
	Percent     int            `json:"percent"`
	Level       string         `json:"level"` // empty, green, yellow, red
	NextWeekMax int64          `json:"nextWeekMax"`
	Breakdown   QuotaBreakdown `json:"breakdown"`
	Expenses    []ExpenseItem  `json:"expenses"`
	Savings     Savings        `json:"savings"`
}

type quotaInputs struct {
	balance   int64
	weekStart time.Time
	deadline  time.Time
	subs      []Subscription
	r         Rules
}

type quotaCore struct {
	weeks, deposits int
	due, free, max  int64
}

func computeCore(in quotaInputs) quotaCore {
	weeks := daysBetween(in.weekStart, in.deadline) / 7
	if weeks < 1 {
		weeks = 1
	}
	c := quotaCore{weeks: weeks, deposits: weeks - 1, due: dueBy(in.subs, in.deadline)}
	c.free = in.balance + int64(c.deposits)*in.r.WeeklyAllowance - c.due - in.r.MinBalance
	c.max = floorThousands(float64(c.free) / float64(weeks))
	return c
}

// deadline returns the anchor subscription's Next Billing, or a one-week fallback.
func deadlineFor(subs []Subscription, weekStart time.Time, r Rules) (time.Time, *Subscription) {
	for i, s := range subs {
		if strings.EqualFold(s.Name, r.AnchorSubscription) && s.NextBilling.Valid() {
			return s.NextBilling.Day(), &subs[i]
		}
	}
	return weekStart.AddDate(0, 0, 7), nil
}

// ComputeQuota reproduces the Overview tab of the Finance Assistant sheet.
func ComputeQuota(s Snapshot, r Rules, now time.Time) Quota {
	today := clock.Day(now)
	balance := Balance(s.Transactions, r)

	starts := weekStarts(s.Weeks, today)
	weekStart, ok := time.Time{}, false
	if len(starts) > 0 {
		weekStart, ok = starts[len(starts)-1], true
	}
	if !ok {
		if weekStart, ok = openingDate(s.Transactions); !ok {
			weekStart = today
		}
	}
	deadline, anchor := deadlineFor(s.Subscriptions, weekStart, r)

	core := computeCore(quotaInputs{balance, weekStart, deadline, s.Subscriptions, r})
	q := Quota{
		Today:   today.Format(dateLayout),
		Balance: balance,
		Max:     core.max,
		Breakdown: QuotaBreakdown{
			Deadline: deadline.Format(dateLayout), DeadlineSource: "fallback",
			WeeksToDeadline: core.weeks, DepositsExpected: core.deposits,
			SubscriptionsDue: core.due, FreeFunds: core.free,
			WeeklyAllowance: r.WeeklyAllowance, MinBalance: r.MinBalance,
		},
	}
	if anchor != nil {
		q.Breakdown.DeadlineSource = anchor.Name
	}

	end := firstSundayAfter(weekStart)
	if today.After(end) {
		end = today
	}
	q.Period = Period{Start: weekStart.Format(dateLayout), End: end.Format(dateLayout)}

	var expenses []ExpenseItem
	for _, t := range s.Transactions {
		if !countsTowardQuota(t, r) || !t.Date.Valid() {
			continue
		}
		if !t.Date.Day().Before(weekStart) {
			q.Spent += t.AmountValue()
		}
		expenses = append(expenses, ExpenseItem{ID: t.ID, Date: t.Date, Name: t.Name, Amount: t.AmountValue(), Notes: t.Notes})
	}
	sort.SliceStable(expenses, func(i, j int) bool { return expenses[j].Date.Before(expenses[i].Date) })
	if len(expenses) > 10 {
		expenses = expenses[:10]
	}
	q.Expenses = expenses
	q.Remaining = q.Max - q.Spent

	q.Percent, q.Level = quotaLevel(q.Spent, q.Max)

	q.NextWeekMax = projectNextWeek(quotaInputs{balance, weekStart, deadline, s.Subscriptions, r}, anchor, q.Remaining)
	q.Savings = computeSavings(s, r, balance, starts, weekStart, end, deadline, today)
	return q
}

// quotaLevel returns the used percentage and its colour: green below 70%, yellow below
// 90%, red from 90%. "empty" means nothing spent yet. A Max of zero or less is red.
func quotaLevel(spent, max int64) (int, string) {
	if max <= 0 {
		return 100, "red"
	}
	pct := int(math.Round(float64(spent) * 100 / float64(max)))
	switch {
	case spent <= 0:
		return 0, "empty"
	case pct < 70:
		return pct, "green"
	case pct < 90:
		return pct, "yellow"
	default:
		return pct, "red"
	}
}

// projectNextWeek estimates next week's Max, assuming the rest of this week's quota is
// spent and the next allowance arrives. If the deadline falls before next week ends, the
// bills due by it are taken as paid and the deadline moves one anchor cycle on, which is
// the state the sheet shows once the anchor bill is paid and its Next Billing shifted.
func projectNextWeek(in quotaInputs, anchor *Subscription, remaining int64) int64 {
	next := in
	next.weekStart = in.weekStart.AddDate(0, 0, 7)
	next.balance = in.balance - max(remaining, 0) + in.r.WeeklyAllowance
	var paid int64
	if next.weekStart.AddDate(0, 0, 7).After(in.deadline) {
		paid = dueBy(in.subs, in.deadline)
		next.balance -= paid
		if anchor != nil {
			next.deadline = nextBillingAfter(*anchor, in.deadline)
		} else {
			next.deadline = next.weekStart.AddDate(0, 0, 7)
		}
	}
	core := computeCore(next)
	core.due -= paid
	core.free = next.balance + int64(core.deposits)*in.r.WeeklyAllowance - core.due - in.r.MinBalance
	return floorThousands(float64(core.free) / float64(core.weeks))
}

// weekNet is income minus expenses on the tracked account in [from, to).
func weekNet(txs []Transaction, r Rules, from, to time.Time) int64 {
	var net int64
	for _, t := range txs {
		if t.Account != r.Account || !t.Date.Valid() {
			continue
		}
		d := t.Date.Day()
		if d.Before(from) || !d.Before(to) {
			continue
		}
		switch t.Type {
		case TypeIncome:
			net += t.AmountValue()
		case TypeExpense:
			net -= t.AmountValue()
		}
	}
	return net
}

func computeSavings(s Snapshot, r Rules, balance int64, starts []time.Time, weekStart, periodEnd, deadline, today time.Time) Savings {
	sv := Savings{Save: balance - r.MinBalance}
	cycleStart := deadline.AddDate(0, -1, 0)
	sv.CycleStart = cycleStart.Format(dateLayout)

	notes := map[time.Time]string{}
	labels := map[time.Time]string{}
	for _, w := range s.Weeks {
		if w.Start.Valid() {
			notes[w.Start.Day()] = w.Notes
			if w.Week != "" {
				labels[w.Start.Day()] = w.Week
			}
		}
	}

	var inCycle []SavingsRow
	var cycleSum int64
	for i, st := range starts {
		if st.Before(cycleStart) {
			continue
		}
		to := today.AddDate(0, 0, 1)
		end := ""
		if i+1 < len(starts) {
			to = starts[i+1]
			end = to.AddDate(0, 0, -1).Format(dateLayout)
		}
		net := weekNet(s.Transactions, r, st, to)
		cycleSum += net
		label := labels[st]
		if label == "" {
			label = "W" + strconv.Itoa(i+1)
		}
		inCycle = append(inCycle, SavingsRow{Label: label, Start: st.Format(dateLayout), End: end, Amount: ptr(net), Notes: notes[st]})
	}
	// W0 carries everything before the cycle, so the rows always add up to Save.
	w0 := sv.Save - cycleSum
	sv.Rows = append([]SavingsRow{{Label: "W0", Amount: ptr(w0), Genesis: true, Notes: "Before this cycle"}}, inCycle...)

	// Estimated weeks still to come before the deadline.
	n := len(starts)
	for st := periodEnd.AddDate(0, 0, 1); st.Before(deadline) && len(sv.Rows) < 12; st = st.AddDate(0, 0, 7) {
		n++
		sv.Rows = append(sv.Rows, SavingsRow{
			Label: "W" + strconv.Itoa(n), Start: st.Format(dateLayout), End: st.AddDate(0, 0, 6).Format(dateLayout), Estimated: true,
		})
	}

	roster := ComputeRoster(s.Subscriptions)
	sv.Target = roster.Total
	sv.Gap = sv.Target - sv.Save
	sv.Status = "safe"
	if sv.Save < sv.Target {
		sv.Status = "short"
	}
	return sv
}
