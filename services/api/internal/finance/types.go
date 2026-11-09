// Package finance implements the Finance Assistant: transactions, subscriptions, the
// weekly spending quota, and savings, mirrored with the Notion databases.
package finance

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Select values are stored as Notion has them, in Indonesian.
const (
	TypeIncome  = "Masuk"
	TypeExpense = "Keluar"
	TypeOpening = "Saldo Awal"

	CategorySubscription = "Langganan"
	// SavingsMarker in an expense's Notes marks money moved to a savings account: it
	// leaves the balance but is neither spending nor outcome.
	SavingsMarker  = "dipindah ke tabungan"
	StatusEstimate = "Estimasi"

	CycleMonthly = "Bulanan"
	CycleYearly  = "Tahunan"
	SubActive    = "Aktif"
	SubPaused    = "Dijeda"
	SubStopped   = "Berhenti"
)

type Transaction struct {
	ID             string    `json:"id"`
	Date           LocalDate `json:"date"`
	Name           string    `json:"name"`
	Type           string    `json:"type"`
	Category       string    `json:"category"`
	Account        string    `json:"account"`
	Amount         *Money    `json:"amount"`
	ReportedAmount *Money    `json:"reportedAmount"`
	ReportedDate   LocalDate `json:"reportedDate"`
	Status         string    `json:"status"`
	Notes          string    `json:"notes"`
}

func (t Transaction) AmountValue() Money { return deref(t.Amount) }

type Subscription struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Price       *Money    `json:"price"`
	Cycle       string    `json:"cycle"`
	Status      string    `json:"status"`
	BillingDay  *int64    `json:"billingDay"`
	NextBilling LocalDate `json:"nextBilling"`
	Notes       string    `json:"notes"`
}

func (s Subscription) PriceValue() Money { return deref(s.Price) }

// Week is one row of Weekly Recap. Week, Income and Spent are computed by the sheet.
type Week struct {
	ID     string    `json:"id"`
	Week   string    `json:"week"`
	Start  LocalDate `json:"start"`
	Income *Money    `json:"income"`
	Spent  *Money    `json:"spent"`
	Notes  string    `json:"notes"`
}

// Field describes one Notion property, in the canonical order of its table.
type Field struct {
	Name string // Notion property name, equal to the sheet column name
	Kind string // title, rich_text, select, number, date
	// External fields are computed by the Google Sheet. Notion is their source; they are
	// read into Postgres and never written back, except once when a page is created.
	External bool
}

var TransactionFields = []Field{
	{Name: "Date", Kind: "date"}, {Name: "Name", Kind: "title"}, {Name: "Type", Kind: "select"},
	{Name: "Category", Kind: "select"}, {Name: "Account", Kind: "select"}, {Name: "Amount", Kind: "number"},
	{Name: "Reported Amount", Kind: "number"}, {Name: "Reported Date", Kind: "date"},
	{Name: "Status", Kind: "select"}, {Name: "Notes", Kind: "rich_text"},
}

var SubscriptionFields = []Field{
	{Name: "Name", Kind: "title"}, {Name: "Price", Kind: "number"}, {Name: "Cycle", Kind: "select"},
	{Name: "Status", Kind: "select"}, {Name: "Billing Day", Kind: "number"},
	{Name: "Next Billing", Kind: "date"}, {Name: "Notes", Kind: "rich_text"},
}

var WeekFields = []Field{
	{Name: "Week", Kind: "title", External: true}, {Name: "Start", Kind: "date"},
	{Name: "Income", Kind: "number", External: true}, {Name: "Spent", Kind: "number", External: true},
	{Name: "Notes", Kind: "rich_text"},
}

// Canonical encodings, aligned with the field lists above.

func (t Transaction) canonical() []string {
	return []string{t.Date.String(), t.Name, t.Type, t.Category, t.Account, moneyText(t.Amount),
		moneyText(t.ReportedAmount), t.ReportedDate.String(), t.Status, t.Notes}
}

func parseTransaction(v []string) (Transaction, error) {
	var t Transaction
	var err error
	if err = expectLen(v, TransactionFields); err != nil {
		return t, err
	}
	if t.Date, err = ParseLocalDate(v[0]); err != nil {
		return t, err
	}
	t.Name, t.Type, t.Category, t.Account = v[1], v[2], v[3], v[4]
	if t.Amount, err = parseMoneyPtr(v[5]); err != nil {
		return t, err
	}
	if t.ReportedAmount, err = parseMoneyPtr(v[6]); err != nil {
		return t, err
	}
	if t.ReportedDate, err = ParseLocalDate(v[7]); err != nil {
		return t, err
	}
	t.Status, t.Notes = v[8], v[9]
	return t, nil
}

func (s Subscription) canonical() []string {
	return []string{s.Name, moneyText(s.Price), s.Cycle, s.Status, numText(s.BillingDay), s.NextBilling.String(), s.Notes}
}

func parseSubscription(v []string) (Subscription, error) {
	var s Subscription
	var err error
	if err = expectLen(v, SubscriptionFields); err != nil {
		return s, err
	}
	s.Name = v[0]
	if s.Price, err = parseMoneyPtr(v[1]); err != nil {
		return s, err
	}
	s.Cycle, s.Status = v[2], v[3]
	if s.BillingDay, err = parseNum(v[4]); err != nil {
		return s, err
	}
	if s.NextBilling, err = ParseLocalDate(v[5]); err != nil {
		return s, err
	}
	s.Notes = v[6]
	return s, nil
}

func (w Week) canonical() []string {
	return []string{w.Week, w.Start.String(), moneyText(w.Income), moneyText(w.Spent), w.Notes}
}

func parseWeek(v []string) (Week, error) {
	var w Week
	var err error
	if err = expectLen(v, WeekFields); err != nil {
		return w, err
	}
	w.Week = v[0]
	if w.Start, err = ParseLocalDate(v[1]); err != nil {
		return w, err
	}
	if w.Income, err = parseMoneyPtr(v[2]); err != nil {
		return w, err
	}
	if w.Spent, err = parseMoneyPtr(v[3]); err != nil {
		return w, err
	}
	w.Notes = v[4]
	return w, nil
}

func expectLen(v []string, fields []Field) error {
	if len(v) != len(fields) {
		return fmt.Errorf("got %d values, want %d", len(v), len(fields))
	}
	return nil
}

func numText(n *int64) string {
	if n == nil {
		return ""
	}
	return strconv.FormatInt(*n, 10)
}

// parseNum reads a canonical whole number such as a billing day. Fractions are rounded.
func parseNum(s string) (*int64, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, nil
	}
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		return &n, nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return nil, fmt.Errorf("invalid number %q", s)
	}
	n := int64(math.Round(f))
	return &n, nil
}

func deref[T ~int64](n *T) T {
	if n == nil {
		return 0
	}
	return *n
}

func ptr[T any](v T) *T { return &v }
