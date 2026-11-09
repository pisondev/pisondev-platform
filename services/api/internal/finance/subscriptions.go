package finance

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

// SubscriptionInput creates a subscription, or changes the fields that are set.
// Billing Day follows Next Billing; a month-end date keeps a later billing day (31 stays
// 31 when Next Billing is 28 Feb).
type SubscriptionInput struct {
	Name        *string `json:"name"`
	Price       *Money  `json:"price"`
	Cycle       *string `json:"cycle"`
	Status      *string `json:"status"`
	NextBilling *string `json:"nextBilling"` // YYYY-MM-DD
	Notes       *string `json:"notes"`
}

var (
	subCycles   = []string{CycleMonthly, CycleYearly}
	subStatuses = []string{SubActive, SubPaused, SubStopped}
)

func (s *Service) AddSubscription(ctx context.Context, actor string, in SubscriptionInput) (Subscription, error) {
	if err := s.writable(); err != nil {
		return Subscription{}, err
	}
	errs := fieldErrors{}
	for key, missing := range map[string]bool{
		"name": in.Name == nil, "price": in.Price == nil, "cycle": in.Cycle == nil, "nextBilling": in.NextBilling == nil,
	} {
		if missing {
			errs[key] = "Required."
		}
	}
	if in.Status == nil {
		in.Status = ptr(SubActive)
	}
	if err := errs.err(); err != nil {
		return Subscription{}, err
	}
	var out Subscription
	err := s.repo.inTx(ctx, func(tx pgx.Tx) error {
		sub, err := s.applySubscription(ctx, tx, Subscription{}, in)
		if err != nil {
			return err
		}
		if err := insert(ctx, tx, subscriptionCodec, &sub, actor); err != nil {
			return err
		}
		out = sub
		return audit(ctx, tx, actor, "create", "subscription", sub.ID, nil, sub)
	})
	if err != nil {
		return Subscription{}, err
	}
	s.notify.Notify()
	return out, nil
}

func (s *Service) UpdateSubscription(ctx context.Context, actor, id string, in SubscriptionInput) (Subscription, error) {
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
		sub, err := s.applySubscription(ctx, tx, old, in)
		if err != nil {
			return err
		}
		if err := update(ctx, tx, subscriptionCodec, &sub, actor); err != nil {
			return err
		}
		out = sub
		return audit(ctx, tx, actor, "update", "subscription", id, old, sub)
	})
	if err != nil {
		return Subscription{}, err
	}
	s.notify.Notify()
	return out, nil
}

// applySubscription validates the input and returns base with it applied.
func (s *Service) applySubscription(ctx context.Context, tx pgx.Tx, base Subscription, in SubscriptionInput) (Subscription, error) {
	sub := base
	errs := fieldErrors{}
	if in.Name != nil {
		sub.Name = strings.TrimSpace(*in.Name)
		if sub.Name == "" || utf8.RuneCountInString(sub.Name) > 100 {
			errs["name"] = "Name must be 1 to 100 characters."
		} else if taken, err := subscriptionNameTaken(ctx, tx, sub.Name, base.ID); err != nil {
			return sub, err
		} else if taken {
			errs["name"] = "Another subscription already has this name."
		}
	}
	if in.Price != nil {
		if *in.Price <= 0 {
			errs["price"] = "Price must be more than zero."
		}
		sub.Price = ptr(*in.Price)
	}
	if in.Cycle != nil {
		if c, ok := pick(subCycles, *in.Cycle); ok {
			sub.Cycle = c
		} else {
			errs["cycle"] = "Pick one of: " + strings.Join(subCycles, ", ") + "."
		}
	}
	if in.Status != nil {
		if st, ok := pick(subStatuses, *in.Status); ok {
			sub.Status = st
		} else {
			errs["status"] = "Pick one of: " + strings.Join(subStatuses, ", ") + "."
		}
	}
	if in.NextBilling != nil {
		d, err := ParseLocalDate(*in.NextBilling)
		switch {
		case err != nil || !d.Valid():
			errs["nextBilling"] = "Next Billing must be a date (YYYY-MM-DD)."
		default:
			day := d.Day()
			if today := clock.Day(s.now()); day.Before(today.AddDate(-1, 0, 0)) || day.After(today.AddDate(5, 0, 0)) {
				errs["nextBilling"] = "Next Billing must be within a year back and five years ahead."
			}
			sub.NextBilling = DateOf(day)
			sub.BillingDay = ptr(billingDayFor(day, base.BillingDay))
		}
	}
	if in.Notes != nil {
		sub.Notes = strings.TrimSpace(*in.Notes)
		if utf8.RuneCountInString(sub.Notes) > 1000 {
			errs["notes"] = "Notes are longer than 1000 characters."
		}
	}
	return sub, errs.err()
}

// billingDayFor keeps a billing day past the end of a short month (31 on 28 Feb).
func billingDayFor(day time.Time, old *int64) int64 {
	d := int64(day.Day())
	last := int64(time.Date(day.Year(), day.Month()+1, 0, 0, 0, 0, 0, clock.WIB).Day())
	if old != nil && d == last && *old > d && *old <= 31 {
		return *old
	}
	return d
}

func subscriptionNameTaken(ctx context.Context, tx pgx.Tx, name, except string) (bool, error) {
	var taken bool
	err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM finance.subscriptions
		WHERE deleted_at IS NULL AND lower(name) = lower($1) AND id::text <> $2)`, name, except).Scan(&taken)
	return taken, err
}
