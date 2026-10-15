package finance

import (
	"sort"
	"time"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
)

type SubItem struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Price       int64     `json:"price"`
	Cycle       string    `json:"cycle"`
	BillingDay  *int64    `json:"billingDay"`
	NextBilling LocalDate `json:"nextBilling"`
	Notes       string    `json:"notes"`
}

type SubGroup struct {
	Items []SubItem `json:"items"`
	Total int64     `json:"total"`
}

type RosterItem struct {
	SubItem
	Paid bool `json:"paid"`
}

// Roster is the `langganan` list: the subscriptions billed in the target month.
type Roster struct {
	Month string       `json:"month"` // YYYY-MM
	Items []RosterItem `json:"items"`
	Total int64        `json:"total"`
}

type SubscriptionsView struct {
	Monthly SubGroup `json:"monthly"`
	Yearly  SubGroup `json:"yearly"`
	Roster  Roster   `json:"roster"`
	Savings int64    `json:"savings"`
	Status  string   `json:"status"` // safe or short
}

func itemOf(s Subscription) SubItem {
	return SubItem{ID: s.ID, Name: s.Name, Price: s.PriceValue(), Cycle: s.Cycle, BillingDay: s.BillingDay, NextBilling: s.NextBilling, Notes: s.Notes}
}

func byPriceDesc(items []SubItem) {
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].Price != items[j].Price {
			return items[i].Price > items[j].Price
		}
		return items[i].Name < items[j].Name
	})
}

// ComputeRoster applies the `langganan` rule:
//  1. target month = month of the earliest Next Billing among active subscriptions;
//  2. roster = every active monthly one, plus yearly ones billed in that month;
//  3. a row is paid once its Next Billing has moved past the target month;
//  4. rows are ordered by price, highest first.
func ComputeRoster(subs []Subscription) Roster {
	var active []Subscription
	var earliest time.Time
	for _, s := range subs {
		if s.Status != SubActive || !s.NextBilling.Valid() {
			continue
		}
		active = append(active, s)
		if d := s.NextBilling.Day(); earliest.IsZero() || d.Before(earliest) {
			earliest = d
		}
	}
	if earliest.IsZero() {
		return Roster{Items: []RosterItem{}}
	}
	target := time.Date(earliest.Year(), earliest.Month(), 1, 0, 0, 0, 0, clock.WIB)
	r := Roster{Month: target.Format("2006-01"), Items: []RosterItem{}}
	var items []SubItem
	paid := map[string]bool{}
	for _, s := range active {
		nb := s.NextBilling.Day()
		if s.Cycle == CycleYearly && nb.Month() != target.Month() {
			continue
		}
		items = append(items, itemOf(s))
		paid[s.ID] = nb.After(target.AddDate(0, 1, -1))
	}
	byPriceDesc(items)
	for _, it := range items {
		r.Items = append(r.Items, RosterItem{SubItem: it, Paid: paid[it.ID]})
		r.Total += it.Price
	}
	return r
}

// ComputeSubscriptions builds the Subscriptions page.
func ComputeSubscriptions(s Snapshot, r Rules) SubscriptionsView {
	v := SubscriptionsView{Monthly: SubGroup{Items: []SubItem{}}, Yearly: SubGroup{Items: []SubItem{}}}
	for _, sub := range s.Subscriptions {
		if sub.Status != SubActive {
			continue
		}
		switch sub.Cycle {
		case CycleMonthly:
			v.Monthly.Items = append(v.Monthly.Items, itemOf(sub))
			v.Monthly.Total += sub.PriceValue()
		case CycleYearly:
			v.Yearly.Items = append(v.Yearly.Items, itemOf(sub))
			v.Yearly.Total += sub.PriceValue()
		}
	}
	byPriceDesc(v.Monthly.Items)
	byPriceDesc(v.Yearly.Items)
	v.Roster = ComputeRoster(s.Subscriptions)
	v.Savings = Balance(s.Transactions, r) - r.MinBalance
	v.Status = "safe"
	if v.Savings < v.Roster.Total {
		v.Status = "short"
	}
	return v
}

// AdvanceBilling returns the Next Billing one cycle after the current one.
func AdvanceBilling(s Subscription) (LocalDate, bool) {
	if !s.NextBilling.Valid() {
		return LocalDate{}, false
	}
	return DateOf(nextBillingAfter(s, s.NextBilling.Day())), true
}
