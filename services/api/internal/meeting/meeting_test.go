package meeting

import (
	"errors"
	"testing"
	"time"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

func fixtureConfig() Config {
	return Config{Title: "Team planning", Timezone: "Asia/Jakarta", Dates: []string{"2026-11-02", "2026-11-03"}, StartHour: 9, EndHour: 17, Duration: 60}
}

var testNow = time.Date(2026, 10, 27, 0, 0, 0, 0, time.UTC)

func errorCode(err error) string {
	var typed *httpx.Error
	if errors.As(err, &typed) {
		return typed.Code
	}
	return ""
}

func TestValidation(t *testing.T) {
	tests := []struct {
		name   string
		change func(*Config)
	}{
		{"blank title", func(c *Config) { c.Title = " \t" }},
		{"bad zone", func(c *Config) { c.Timezone = "Local" }},
		{"missing zone", func(c *Config) { c.Timezone = "" }},
		{"invalid zone", func(c *Config) { c.Timezone = "Mars/Olympus" }},
		{"no dates", func(c *Config) { c.Dates = nil }},
		{"duplicate date", func(c *Config) { c.Dates = []string{"2026-11-02", "2026-11-02"} }},
		{"invalid date", func(c *Config) { c.Dates = []string{"2026-11-31"} }},
		{"past date", func(c *Config) { c.Dates = []string{"2026-10-26"} }},
		{"past hours today", func(c *Config) { c.Timezone = "America/New_York"; c.Dates = []string{"2026-10-26"} }},
		{"distant date", func(c *Config) { c.Dates = []string{"2027-12-01"} }},
		{"reverse hours", func(c *Config) { c.StartHour = 18 }},
		{"outside day", func(c *Config) { c.EndHour = 25 }},
		{"negative hour", func(c *Config) { c.StartHour = -1 }},
		{"invalid duration", func(c *Config) { c.Duration = 20 }},
		{"too long", func(c *Config) { c.EndHour = 10; c.Duration = 90 }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c := fixtureConfig()
			tc.change(&c)
			if c.Validate(testNow) == nil {
				t.Fatal("accepted invalid config")
			}
		})
	}
	c := fixtureConfig()
	c.Title = "  Planning  "
	if err := c.Validate(testNow); err != nil {
		t.Fatal(err)
	}
	if c.Title != "Planning" {
		t.Fatal("title not trimmed")
	}
}

func TestTimezoneSlots(t *testing.T) {
	c := fixtureConfig()
	slots := c.Slots()
	if len(slots) != 64 || slots[0] != "2026-11-02T02:00:00Z" || slots[31] != "2026-11-02T09:45:00Z" {
		t.Fatalf("incorrect WIB slots: %v", slots)
	}
	c.Timezone = "Asia/Kathmandu"
	c.Dates = []string{"2026-11-02"}
	c.EndHour = 10
	if got := c.Slots(); len(got) != 4 || got[0] != "2026-11-02T03:15:00Z" {
		t.Fatalf("quarter-hour zone: %v", got)
	}
	c.Timezone = "America/New_York"
	c.Dates = []string{"2026-11-01"}
	c.StartHour = 0
	c.EndHour = 4
	if got := c.Slots(); len(got) != 20 || got[0] != "2026-11-01T04:00:00Z" {
		t.Fatalf("fall-back slots: %v", got)
	}
	c.Dates = []string{"2026-03-08"}
	if got := c.Slots(); len(got) != 12 {
		t.Fatalf("spring-forward: got %d slots", len(got))
	}
}

func TestRankRequiresSamePeopleThroughout(t *testing.T) {
	slots := fixtureConfig().Slots()[:4]
	people := []Participant{{ID: "a", Slots: slots[:2]}, {ID: "b", Slots: slots[2:]}}
	if got := Rank(slots, people, 60); len(got) != 0 {
		t.Fatalf("counted alternating people as a complete hour: %v", got)
	}
	people = append(people, Participant{ID: "c", Slots: slots})
	got := Rank(slots, people, 60)
	if len(got) != 1 || got[0].Count != 1 || got[0].ParticipantIDs[0] != "c" {
		t.Fatalf("wrong full-window intersection: %v", got)
	}
	// A missing interval and separate dates must not be joined into a meeting.
	gap := append([]string{slots[0]}, slots[2:]...)
	if got := Rank(gap, []Participant{{ID: "all", Slots: gap}}, 60); len(got) != 0 {
		t.Fatalf("ranked a gap: %v", got)
	}
	c := fixtureConfig()
	c.StartHour = 16
	c.EndHour = 17
	if got := Rank(c.Slots(), []Participant{{ID: "all", Slots: c.Slots()}}, 90); len(got) != 0 {
		t.Fatalf("joined dates: %v", got)
	}
}

func TestRankSortsByAttendanceThenTime(t *testing.T) {
	slots := fixtureConfig().Slots()[:8]
	people := []Participant{{ID: "a", Slots: slots}, {ID: "b", Slots: slots[4:]}}
	got := Rank(slots, people, 30)
	if len(got) != 7 || got[0].Start != slots[4] || got[0].Count != 2 || got[1].Start != slots[5] {
		t.Fatalf("ranking: %v", got)
	}
}

func TestValidateResponse(t *testing.T) {
	slots := fixtureConfig().Slots()
	for _, in := range []ResponseInput{{Name: ""}, {Name: "Sam", Slots: []string{slots[0], slots[0]}}, {Name: "Sam", Slots: []string{"2026-11-02T02:01:00Z"}}, {Name: "Sam", Slots: []string{"2026-11-02T02:00:00+00:00"}}} {
		if validateResponse(&in, slots) == nil {
			t.Fatalf("accepted invalid response: %v", in)
		}
	}
	in := ResponseInput{Name: " No time available "}
	if err := validateResponse(&in, slots); err != nil {
		t.Fatal(err)
	}
	if in.Slots == nil || in.Name != "No time available" {
		t.Fatal("empty response was not normalized")
	}
}
