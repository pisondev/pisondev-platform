package finance

import (
	"context"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

// Notifier is told after every local write, so the sync pushes it to Notion soon.
type Notifier interface{ Notify() }

type nopNotifier struct{}

func (nopNotifier) Notify() {}

// Fallback select options, used until the first sync has read them from Notion.
var defaultOptions = map[string][]string{
	"Category": {"Makan", "Transport", "Langganan", "Hiburan", "Lainnya", "Shopping"},
	"Account":  {"Mandiri Debit", "GoPay", "Tunai"},
}

type Service struct {
	repo     *Repository
	rules    Rules
	now      clock.Clock
	notify   Notifier
	writable func() error // nil error when local writes may be made
}

func NewService(repo *Repository, rules Rules, now clock.Clock, notify Notifier, writable func() error) *Service {
	if notify == nil {
		notify = nopNotifier{}
	}
	if writable == nil {
		writable = func() error { return nil }
	}
	return &Service{repo: repo, rules: rules, now: now, notify: notify, writable: writable}
}

func (s *Service) Rules() Rules { return s.rules }

func (s *Service) Snapshot(ctx context.Context) (Snapshot, error) { return s.repo.Snapshot(ctx) }

// Options returns the select options for transactions.
func (s *Service) Options(ctx context.Context) (map[string][]string, error) {
	opts, err := s.repo.Options(ctx, "transactions")
	if err != nil {
		return nil, err
	}
	for k, v := range defaultOptions {
		if len(opts[k]) == 0 {
			opts[k] = v
		}
	}
	return opts, nil
}

// AddInput is a new transaction from the web app.
type AddInput struct {
	Type            string `json:"type"`
	Name            string `json:"name"`
	Amount          int64  `json:"amount"`
	Category        string `json:"category"`
	Account         string `json:"account"`
	Date            string `json:"date"`
	Notes           string `json:"notes"`
	WeeklyAllowance bool   `json:"weeklyAllowance"` // income that starts a new week
	AllowDuplicate  bool   `json:"allowDuplicate"`
}

type fieldErrors map[string]any

func (f fieldErrors) err() error {
	if len(f) == 0 {
		return nil
	}
	return httpx.BadRequest("invalid_input", "Some fields are invalid.", f)
}

func pick(options []string, value string) (string, bool) {
	for _, o := range options {
		if strings.EqualFold(o, strings.TrimSpace(value)) {
			return o, true
		}
	}
	return "", false
}

// checkDate enforces the window used by the link-based recorder: not after tomorrow,
// not more than 60 days back. The second rule catches a mistyped month or year.
func (s *Service) checkDate(raw string, errs fieldErrors) LocalDate {
	d, err := ParseLocalDate(raw)
	switch {
	case err != nil:
		errs["date"] = err.Error()
	case !d.Valid():
		errs["date"] = "Date is required."
	default:
		today := clock.Day(s.now())
		if d.Day().After(today.AddDate(0, 0, 1)) {
			errs["date"] = "Date is in the future."
		} else if d.Day().Before(today.AddDate(0, 0, -60)) {
			errs["date"] = "Date is more than 60 days ago."
		}
	}
	return d
}

func (s *Service) AddTransaction(ctx context.Context, actor string, in AddInput) (Transaction, error) {
	if err := s.writable(); err != nil {
		return Transaction{}, err
	}
	opts, err := s.Options(ctx)
	if err != nil {
		return Transaction{}, err
	}
	errs := fieldErrors{}
	t := Transaction{Status: StatusEstimate, Notes: strings.TrimSpace(in.Notes)}

	switch strings.ToLower(strings.TrimSpace(in.Type)) {
	case "keluar", "expense", "outcome":
		t.Type = TypeExpense
	case "masuk", "income":
		t.Type = TypeIncome
	default:
		errs["type"] = "Type must be Keluar or Masuk."
	}
	t.Name = strings.TrimSpace(in.Name)
	if t.Name == "" {
		errs["name"] = "Name is required."
	} else if utf8.RuneCountInString(t.Name) > 100 {
		errs["name"] = "Name is longer than 100 characters."
	}
	if in.Amount <= 0 {
		errs["amount"] = "Amount must be a positive whole number."
	}
	t.Amount, t.ReportedAmount = ptr(in.Amount), ptr(in.Amount)
	if t.Type == TypeExpense {
		if c, ok := pick(opts["Category"], in.Category); ok {
			t.Category = c
		} else {
			errs["category"] = "Pick one of: " + strings.Join(opts["Category"], ", ") + "."
		}
	}
	account := in.Account
	if strings.TrimSpace(account) == "" {
		account = s.rules.Account
	}
	if a, ok := pick(opts["Account"], account); ok {
		t.Account = a
	} else {
		errs["account"] = "Pick one of: " + strings.Join(opts["Account"], ", ") + "."
	}
	t.Date = s.checkDate(in.Date, errs)
	t.ReportedDate = t.Date
	if utf8.RuneCountInString(t.Notes) > 500 {
		errs["notes"] = "Notes are longer than 500 characters."
	}
	if in.WeeklyAllowance && t.Type != TypeIncome {
		errs["weeklyAllowance"] = "Only income can start a new week."
	}
	if err := errs.err(); err != nil {
		return Transaction{}, err
	}

	snap, err := s.repo.Snapshot(ctx)
	if err != nil {
		return Transaction{}, err
	}
	if !in.AllowDuplicate {
		for _, o := range snap.Transactions {
			if o.Date.Valid() && o.Date.Day().Equal(t.Date.Day()) && strings.EqualFold(o.Name, t.Name) &&
				o.Type == t.Type && o.AmountValue() == in.Amount {
				return Transaction{}, httpx.Conflict("duplicate", "The same transaction is already recorded on this day.", map[string]any{"id": o.ID})
			}
		}
	}

	err = s.repo.inTx(ctx, func(tx pgx.Tx) error {
		if err := insert(ctx, tx, transactionCodec, &t, actor); err != nil {
			return err
		}
		if err := audit(ctx, tx, actor, "create", "transaction", t.ID, nil, t); err != nil {
			return err
		}
		if in.WeeklyAllowance {
			return s.startWeek(ctx, tx, actor, snap.Weeks, t.Date)
		}
		return nil
	})
	if err != nil {
		return Transaction{}, err
	}
	s.notify.Notify()
	return t, nil
}

var weekLabel = regexp.MustCompile(`^W(\d+)$`)

// startWeek adds a Weekly Recap row starting on the allowance day, unless one exists.
func (s *Service) startWeek(ctx context.Context, tx pgx.Tx, actor string, weeks []Week, date LocalDate) error {
	n := 0
	for _, w := range weeks {
		if w.Start.Valid() && w.Start.Day().Equal(date.Day()) {
			return nil
		}
		if m := weekLabel.FindStringSubmatch(strings.TrimSpace(w.Week)); m != nil {
			if v, _ := strconv.Atoi(m[1]); v > n {
				n = v
			}
		}
	}
	w := Week{Week: "W" + strconv.Itoa(n+1), Start: DateOf(date.Day())}
	if err := insert(ctx, tx, weekCodec, &w, actor); err != nil {
		return err
	}
	return audit(ctx, tx, actor, "create", "week", w.ID, nil, w)
}

// PatchInput changes some fields of a transaction. Nil means unchanged.
type PatchInput struct {
	Date           *string `json:"date"`
	Name           *string `json:"name"`
	Type           *string `json:"type"`
	Category       *string `json:"category"`
	Account        *string `json:"account"`
	Amount         *int64  `json:"amount"`
	ReportedAmount *int64  `json:"reportedAmount"`
	ReportedDate   *string `json:"reportedDate"`
	Status         *string `json:"status"`
	Notes          *string `json:"notes"`
}

func (s *Service) UpdateTransaction(ctx context.Context, actor, id string, in PatchInput) (Transaction, error) {
	if err := s.writable(); err != nil {
		return Transaction{}, err
	}
	opts, err := s.Options(ctx)
	if err != nil {
		return Transaction{}, err
	}
	var out Transaction
	err = s.repo.inTx(ctx, func(tx pgx.Tx) error {
		old, _, err := get(ctx, tx, transactionCodec, id)
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound("Transaction not found.")
		}
		if err != nil {
			return err
		}
		if old.Type == TypeOpening {
			return httpx.BadRequest("protected", "The opening balance row cannot be changed here.", nil)
		}
		t := old
		errs := fieldErrors{}
		if in.Name != nil {
			t.Name = strings.TrimSpace(*in.Name)
			if t.Name == "" || utf8.RuneCountInString(t.Name) > 100 {
				errs["name"] = "Name must be 1 to 100 characters."
			}
		}
		if in.Type != nil {
			switch *in.Type {
			case TypeIncome:
				t.Type, t.Category = TypeIncome, ""
			case TypeExpense:
				t.Type = TypeExpense
				if in.Category == nil && old.Type != TypeExpense {
					errs["category"] = "Changing to Keluar needs a category."
				}
			default:
				errs["type"] = "Type must be Keluar or Masuk."
			}
		}
		if in.Category != nil && t.Type == TypeExpense {
			if c, ok := pick(opts["Category"], *in.Category); ok {
				t.Category = c
			} else {
				errs["category"] = "Pick one of: " + strings.Join(opts["Category"], ", ") + "."
			}
		}
		if in.Account != nil {
			if a, ok := pick(opts["Account"], *in.Account); ok {
				t.Account = a
			} else {
				errs["account"] = "Pick one of: " + strings.Join(opts["Account"], ", ") + "."
			}
		}
		if in.Amount != nil {
			if *in.Amount <= 0 {
				errs["amount"] = "Amount must be a positive whole number."
			}
			// Reported values follow while they still equal the old ones, i.e. until the
			// row is matched against the bank statement.
			if deref(old.ReportedAmount) == old.AmountValue() && in.ReportedAmount == nil {
				t.ReportedAmount = ptr(*in.Amount)
			}
			t.Amount = ptr(*in.Amount)
		}
		if in.Date != nil {
			t.Date = s.checkDate(*in.Date, errs)
			if old.ReportedDate.String() == old.Date.String() && in.ReportedDate == nil {
				t.ReportedDate = t.Date
			}
		}
		if in.ReportedAmount != nil {
			t.ReportedAmount = ptr(*in.ReportedAmount)
		}
		if in.ReportedDate != nil {
			d, err := ParseLocalDate(*in.ReportedDate)
			if err != nil {
				errs["reportedDate"] = err.Error()
			}
			t.ReportedDate = d
		}
		if in.Status != nil {
			if *in.Status != "Estimasi" && *in.Status != "Sinkron" {
				errs["status"] = "Status must be Estimasi or Sinkron."
			}
			t.Status = *in.Status
		}
		if in.Notes != nil {
			t.Notes = strings.TrimSpace(*in.Notes)
			if utf8.RuneCountInString(t.Notes) > 500 {
				errs["notes"] = "Notes are longer than 500 characters."
			}
		}
		if err := errs.err(); err != nil {
			return err
		}
		if err := update(ctx, tx, transactionCodec, &t, actor); err != nil {
			return err
		}
		out = t
		return audit(ctx, tx, actor, "update", "transaction", id, old, t)
	})
	if err != nil {
		return Transaction{}, err
	}
	s.notify.Notify()
	return out, nil
}

func (s *Service) DeleteTransaction(ctx context.Context, actor, id string) error {
	if err := s.writable(); err != nil {
		return err
	}
	err := s.repo.inTx(ctx, func(tx pgx.Tx) error {
		old, _, err := get(ctx, tx, transactionCodec, id)
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound("Transaction not found.")
		}
		if err != nil {
			return err
		}
		if old.Type == TypeOpening {
			return httpx.BadRequest("protected", "The opening balance row cannot be deleted.", nil)
		}
		if err := softDelete(ctx, tx, transactionCodec, id, actor); err != nil {
			return err
		}
		return audit(ctx, tx, actor, "delete", "transaction", id, old, nil)
	})
	if err != nil {
		return err
	}
	s.notify.Notify()
	return nil
}

// AdvanceSubscription moves Next Billing one cycle on. `from` must equal the current
// Next Billing, so repeating the request never shifts twice.
func (s *Service) AdvanceSubscription(ctx context.Context, actor, id, from string) (Subscription, error) {
	if err := s.writable(); err != nil {
		return Subscription{}, err
	}
	var out Subscription
	err := s.repo.inTx(ctx, func(tx pgx.Tx) error {
		old, _, err := get(ctx, tx, subscriptionCodec, id)
		if errors.Is(err, ErrNotFound) {
			return httpx.NotFound("Subscription not found.")
		}
		if err != nil {
			return err
		}
		if from != "" && old.NextBilling.String() != from {
			return httpx.Conflict("stale", "Next Billing has already changed.", map[string]any{"nextBilling": old.NextBilling.String()})
		}
		next, ok := AdvanceBilling(old)
		if !ok {
			return httpx.BadRequest("no_next_billing", "This subscription has no Next Billing date.", nil)
		}
		sub := old
		sub.NextBilling = next
		if err := update(ctx, tx, subscriptionCodec, &sub, actor); err != nil {
			return err
		}
		out = sub
		return audit(ctx, tx, actor, "advance", "subscription", id, old, sub)
	})
	if err != nil {
		return Subscription{}, err
	}
	s.notify.Notify()
	return out, nil
}
