package meeting

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/database"
)

func testStore(t *testing.T) *Store {
	t.Helper()
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
	if err := database.Migrate(ctx, pool, slog.New(slog.NewTextHandler(io.Discard, nil))); err != nil {
		t.Fatal(err)
	}
	return NewStore(pool, func() time.Time { return testNow })
}
func createFixture(t *testing.T, s *Store, owner string) *Poll {
	t.Helper()
	p, err := s.Create(context.Background(), owner, fixtureConfig())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := s.db.Exec(context.Background(), `DELETE FROM meeting.polls WHERE id=$1`, p.ID)
		if err != nil {
			t.Error(err)
		}
	})
	return p
}

func TestStoreLifecycle(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	p := createFixture(t, s, "meeting-test@example.test")
	key := strings.Repeat("a", 64)
	in := ResponseInput{Name: "Nadia", Slots: p.Slots[:4]}
	saved, err := s.Respond(ctx, p.ID, "", key, in)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Participant.Version != 1 {
		t.Fatal("new response has wrong version")
	}
	again, err := s.Respond(ctx, p.ID, "", key, in)
	if err != nil || again.Participant.ID != saved.Participant.ID {
		t.Fatalf("retry was not idempotent: %v", err)
	}
	_, err = s.Respond(ctx, p.ID, saved.Participant.ID, "wrong", ResponseInput{Name: "Imposter", Version: 1})
	if errorCode(err) != "forbidden" {
		t.Fatalf("accepted wrong key: %v", err)
	}
	in.Version = 1
	in.Name = "Nadia Putri"
	updated, err := s.Respond(ctx, p.ID, saved.Participant.ID, key, in)
	if err != nil || updated.Participant.Version != 2 {
		t.Fatalf("update: %v", err)
	}
	_, err = s.Respond(ctx, p.ID, saved.Participant.ID, key, in)
	if errorCode(err) != "response_changed" {
		t.Fatalf("accepted stale version: %v", err)
	}
	// Display names are not credentials; a second Nadia must not overwrite the first.
	_, err = s.Respond(ctx, p.ID, "", strings.Repeat("b", 64), ResponseInput{Name: "Nadia Putri", Slots: p.Slots[:4]})
	if err != nil {
		t.Fatal(err)
	}
	fetched, err := s.Get(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(fetched.Participants) != 2 || fetched.Recommendations[0].Count != 2 {
		t.Fatalf("wrong participants or ranking: %v", fetched)
	}
	raw, err := s.db.Query(ctx, `SELECT edit_hash FROM meeting.responses WHERE poll_id=$1`, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	for raw.Next() {
		var hash []byte
		if err := raw.Scan(&hash); err != nil {
			t.Fatal(err)
		}
		if len(hash) != 32 || string(hash) == key {
			t.Fatal("edit key stored without hashing")
		}
	}
	raw.Close()
	start := p.Slots[0]
	_, err = s.Finalize(ctx, p.ID, "other@example.test", &start)
	if errorCode(err) != "forbidden" {
		t.Fatalf("non-owner finalized: %v", err)
	}
	invalid := p.Slots[7]
	_, err = s.Finalize(ctx, p.ID, "meeting-test@example.test", &invalid)
	if errorCode(err) != "invalid_poll" {
		t.Fatalf("finalized unavailable time: %v", err)
	}
	final, err := s.Finalize(ctx, p.ID, "meeting-test@example.test", &start)
	if err != nil || final.FinalizedStart == nil {
		t.Fatalf("finalize: %v", err)
	}
	in.Version = 2
	_, err = s.Respond(ctx, p.ID, saved.Participant.ID, key, in)
	if errorCode(err) != "poll_closed" {
		t.Fatalf("accepted edit after finalization: %v", err)
	}
	_, err = s.Respond(ctx, p.ID, "", "", ResponseInput{Name: "Late guest"})
	if errorCode(err) != "poll_closed" {
		t.Fatalf("accepted new guest after finalization: %v", err)
	}
	reopened, err := s.Finalize(ctx, p.ID, "meeting-test@example.test", nil)
	if err != nil || reopened.FinalizedStart != nil {
		t.Fatalf("reopen: %v", err)
	}
	if _, err := s.Respond(ctx, p.ID, saved.Participant.ID, key, in); err != nil {
		t.Fatalf("edit after reopen: %v", err)
	}
	if allowed, err := s.CanManage(ctx, p.ID, "meeting-test@example.test"); err != nil || !allowed {
		t.Fatalf("owner access: %v", err)
	}
	list, err := s.List(ctx, "meeting-test@example.test")
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, item := range list {
		if item.ID == p.ID {
			found = true
			if item.ParticipantCount != 2 {
				t.Fatal("wrong response count")
			}
		}
	}
	if !found {
		t.Fatal("poll missing from owner list")
	}
}

func TestConcurrentResponsesAndFinalization(t *testing.T) {
	ctx := context.Background()
	s := testStore(t)
	p := createFixture(t, s, "race-test@example.test")
	saved, err := s.Respond(ctx, p.ID, "", "", ResponseInput{Name: "First guest", Slots: p.Slots[:4]})
	if err != nil {
		t.Fatal(err)
	}
	start := p.Slots[0]
	gate := make(chan struct{})
	var wait sync.WaitGroup
	wait.Add(2)
	var responseErr, finalErr error
	go func() {
		defer wait.Done()
		<-gate
		_, responseErr = s.Respond(ctx, p.ID, saved.Participant.ID, saved.EditToken, ResponseInput{Name: "First guest", Slots: []string{}, Version: 1})
	}()
	go func() {
		defer wait.Done()
		<-gate
		_, finalErr = s.Finalize(ctx, p.ID, "race-test@example.test", &start)
	}()
	close(gate)
	wait.Wait()
	current, err := s.Get(ctx, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if finalErr == nil {
		if errorCode(responseErr) != "poll_closed" || current.FinalizedStart == nil || len(current.Participants[0].Slots) != 4 {
			t.Fatalf("finalization and edit were not serialized: edit=%v final=%v", responseErr, finalErr)
		}
	} else if responseErr != nil || errorCode(finalErr) != "invalid_poll" || current.FinalizedStart != nil {
		t.Fatalf("unexpected race result: edit=%v final=%v", responseErr, finalErr)
	}
}

func TestPublicJSONHasNoCredentials(t *testing.T) {
	s := testStore(t)
	p := createFixture(t, s, "private-owner@example.test")
	saved, err := s.Respond(context.Background(), p.ID, "", "", ResponseInput{Name: "Public guest", Slots: p.Slots[:4]})
	if err != nil {
		t.Fatal(err)
	}
	public, err := s.Get(context.Background(), p.ID)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(public)
	if err != nil {
		t.Fatal(err)
	}
	for _, secret := range []string{"private-owner@example.test", saved.EditToken, "edit_hash", "editToken", "created_by"} {
		if strings.Contains(string(raw), secret) {
			t.Fatalf("public payload contains %q", secret)
		}
	}
}

func TestPastTimesCannotBeConfirmed(t *testing.T) {
	s := testStore(t)
	p := createFixture(t, s, "past-test@example.test")
	if _, err := s.Respond(context.Background(), p.ID, "", "", ResponseInput{Name: "Guest", Slots: p.Slots[:4]}); err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return time.Date(2026, 11, 4, 0, 0, 0, 0, time.UTC) }
	current, err := s.Get(context.Background(), p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(current.Recommendations) != 0 {
		t.Fatal("recommended a past meeting time")
	}
	start := p.Slots[0]
	if _, err := s.Finalize(context.Background(), p.ID, "past-test@example.test", &start); errorCode(err) != "invalid_poll" {
		t.Fatalf("confirmed past time: %v", err)
	}
}
