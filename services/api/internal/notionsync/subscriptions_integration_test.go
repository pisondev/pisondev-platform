package notionsync

import (
	"context"
	"errors"
	"testing"

	"github.com/pisondev/pisondev-platform/services/api/internal/finance"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

func errCode(err error) string {
	var e *httpx.Error
	if errors.As(err, &e) {
		return e.Code
	}
	return ""
}

func subByName(t *testing.T, h *harness, name string) finance.Subscription {
	t.Helper()
	snap, err := h.svc.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, s := range snap.Subscriptions {
		if s.Name == name {
			return s
		}
	}
	t.Fatalf("subscription %q not found", name)
	return finance.Subscription{}
}

// Subscriptions made and edited in the web app reach Notion, sen included.
func TestSubscriptionsFromTheWeb(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	price := finance.Money(41655165)
	in := finance.SubscriptionInput{Name: strp("Claude"), Price: &price, Cycle: strp("Bulanan"), NextBilling: strp(today(3))}
	sub, err := h.svc.AddSubscription(ctx, "test", in)
	if err != nil {
		t.Fatal(err)
	}
	if sub.Status != finance.SubActive || sub.BillingDay == nil || sub.NextBilling.String() != today(3) {
		t.Errorf("created = %+v", sub)
	}
	if _, err := h.svc.AddSubscription(ctx, "test", in); errCode(err) != "invalid_input" {
		t.Errorf("duplicate name: %v", err)
	}
	bad := in
	bad.Name, bad.Cycle = strp("Other"), strp("Mingguan")
	if _, err := h.svc.AddSubscription(ctx, "test", bad); errCode(err) != "invalid_input" {
		t.Errorf("unknown cycle: %v", err)
	}

	h.sync(Options{})
	pages := h.fake.livePages(dbSub)
	if len(pages) != 1 || h.fake.value(t, pages[0].id, "Price") != "416551.65" || h.fake.value(t, pages[0].id, "Status") != "Aktif" {
		t.Fatalf("Notion subscription = %+v", pages)
	}

	if _, err := h.svc.UpdateSubscription(ctx, "test", sub.ID, finance.SubscriptionInput{Status: strp("Dijeda"), Notes: strp("libur")}); err != nil {
		t.Fatal(err)
	}
	h.sync(Options{})
	if got := h.fake.value(t, pages[0].id, "Status"); got != "Dijeda" {
		t.Errorf("Notion status = %s", got)
	}
	if got := h.fake.value(t, pages[0].id, "Price"); got != "416551.65" {
		t.Errorf("untouched price changed to %s", got)
	}
}

// Paying from the web records the expense and moves Next Billing in one step; a stale
// Next Billing saves neither.
func TestPaySubscription(t *testing.T) {
	h := newHarness(t)
	ctx := context.Background()
	price := finance.Rupiah(59900)
	due := today(0)
	sub, err := h.svc.AddSubscription(ctx, "test", finance.SubscriptionInput{Name: strp("Spotify"), Price: &price, Cycle: strp("Bulanan"), NextBilling: &due})
	if err != nil {
		t.Fatal(err)
	}
	pay := finance.AddInput{Type: "Keluar", Name: "Tagihan Spotify", Amount: price, Category: "Langganan", Date: due, PaysSubscription: sub.ID, PaysFrom: due}
	if _, err := h.svc.AddTransaction(ctx, "test", pay); err != nil {
		t.Fatal(err)
	}
	got := subByName(t, h, "Spotify")
	if got.NextBilling.String() == due {
		t.Error("Next Billing did not move")
	}

	pay.Name, pay.AllowDuplicate = "Tagihan Spotify lagi", true
	if _, err := h.svc.AddTransaction(ctx, "test", pay); errCode(err) != "stale" {
		t.Fatalf("stale pay: %v", err)
	}
	snap, _ := h.svc.Snapshot(ctx)
	if len(snap.Transactions) != 1 {
		t.Errorf("a stale pay must not save its transaction, have %d", len(snap.Transactions))
	}
	if subByName(t, h, "Spotify").NextBilling != got.NextBilling {
		t.Error("a stale pay moved Next Billing")
	}
}
