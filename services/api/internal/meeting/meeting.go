// Package meeting collects availability and finds uninterrupted meeting windows.
package meeting

import (
	"crypto/rand"
	"encoding/hex"
	"sort"
	"strings"
	"time"
	_ "time/tzdata"
	"unicode"
	"unicode/utf8"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

const Interval = 15

type Config struct {
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Timezone    string   `json:"timezone"`
	Dates       []string `json:"dates"`
	StartHour   int      `json:"startHour"`
	EndHour     int      `json:"endHour"`
	Duration    int      `json:"duration"`
}

type Participant struct {
	ID      string   `json:"id"`
	Name    string   `json:"name"`
	Slots   []string `json:"slots"`
	Version int      `json:"version"`
}

type Recommendation struct {
	Start          string   `json:"start"`
	Count          int      `json:"count"`
	ParticipantIDs []string `json:"participantIds"`
}

type Poll struct {
	ID string `json:"id"`
	Config
	Slots           []string         `json:"slots"`
	Participants    []Participant    `json:"participants"`
	Recommendations []Recommendation `json:"recommendations"`
	FinalizedStart  *time.Time       `json:"finalizedStart"`
	CreatedAt       time.Time        `json:"createdAt"`
}

type ResponseInput struct {
	Name    string   `json:"name"`
	Slots   []string `json:"slots"`
	Version int      `json:"version"`
}

func token() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b)
}

func invalid(message string) error { return httpx.BadRequest("invalid_poll", message, nil) }

func cleanText(s string) string {
	return strings.TrimSpace(strings.Map(func(r rune) rune {
		if unicode.IsControl(r) && r != '\n' && r != '\t' {
			return -1
		}
		return r
	}, s))
}

func (c *Config) Validate(now time.Time) error {
	c.Title, c.Description = cleanText(c.Title), cleanText(c.Description)
	if utf8.RuneCountInString(c.Title) < 1 || utf8.RuneCountInString(c.Title) > 100 {
		return invalid("Use a title of 1–100 characters.")
	}
	if utf8.RuneCountInString(c.Description) > 1000 {
		return invalid("Description must be at most 1,000 characters.")
	}
	loc, err := time.LoadLocation(c.Timezone)
	if err != nil || c.Timezone == "Local" || c.Timezone == "" {
		return invalid("Choose a valid IANA time zone.")
	}
	if c.StartHour < 0 || c.EndHour > 24 || c.EndHour <= c.StartHour {
		return invalid("End time must be later than start time, within one day.")
	}
	if c.Duration < 15 || c.Duration > 240 || c.Duration%Interval != 0 || c.Duration > (c.EndHour-c.StartHour)*60 {
		return invalid("Duration must be 15–240 minutes and fit the selected hours.")
	}
	if len(c.Dates) < 1 || len(c.Dates) > 14 {
		return invalid("Select 1–14 dates.")
	}
	today := now.In(loc).Format(time.DateOnly)
	last := now.In(loc).AddDate(0, 0, 90).Format(time.DateOnly)
	seen := map[string]bool{}
	for _, day := range c.Dates {
		parsed, err := time.Parse(time.DateOnly, day)
		if err != nil || parsed.Format(time.DateOnly) != day || day < today || day > last || seen[day] {
			return invalid("Choose distinct dates within the next 90 days.")
		}
		seen[day] = true
	}
	sort.Strings(c.Dates)
	slots := c.Slots()
	if len(slots) == 0 {
		return invalid("The selected hours do not exist in this time zone.")
	}
	for _, rec := range Rank(slots, []Participant{{ID: "validation", Slots: slots}}, c.Duration) {
		start, _ := time.Parse(time.RFC3339, rec.Start)
		if !start.Before(now) {
			return nil
		}
	}
	return invalid("Choose a future time window long enough for this meeting.")
}

// Slots walks actual instants, preserving missing and repeated hours at DST changes.
func (c Config) Slots() []string {
	loc, err := time.LoadLocation(c.Timezone)
	out := []string{}
	if err != nil {
		return out
	}
	for _, day := range c.Dates {
		date, err := time.Parse(time.DateOnly, day)
		if err != nil {
			continue
		}
		// A UTC envelope covers all offsets, including dates that were skipped locally.
		start := date.Add(-24 * time.Hour)
		for at := start; at.Before(date.Add(48 * time.Hour)); at = at.Add(15 * time.Minute) {
			wall := at.In(loc)
			if wall.Format(time.DateOnly) == day && wall.Hour() >= c.StartHour && wall.Hour() < c.EndHour && wall.Minute()%Interval == 0 {
				out = append(out, at.UTC().Format(time.RFC3339))
			}
		}
	}
	sort.Strings(out)
	return out
}

func validateResponse(in *ResponseInput, slots []string) error {
	in.Name = cleanText(in.Name)
	if utf8.RuneCountInString(in.Name) < 1 || utf8.RuneCountInString(in.Name) > 60 {
		return invalid("Use a name of 1–60 characters.")
	}
	allowed := map[string]bool{}
	for _, s := range slots {
		allowed[s] = true
	}
	if len(in.Slots) > len(slots) {
		return invalid("Too many availability slots.")
	}
	seen := map[string]bool{}
	for _, s := range in.Slots {
		if !allowed[s] || seen[s] {
			return invalid("Availability contains an invalid or duplicate slot.")
		}
		seen[s] = true
	}
	if in.Slots == nil {
		in.Slots = []string{}
	}
	sort.Strings(in.Slots)
	return nil
}

// Rank counts the same people across every interval, not independent cell totals.
func Rank(slots []string, participants []Participant, duration int) []Recommendation {
	out := []Recommendation{}
	allowed := map[string]bool{}
	for _, s := range slots {
		allowed[s] = true
	}
	availability := map[string]map[string]bool{}
	for _, p := range participants {
		availability[p.ID] = map[string]bool{}
		for _, s := range p.Slots {
			availability[p.ID][s] = true
		}
	}
	for _, s := range slots {
		start, err := time.Parse(time.RFC3339, s)
		if err != nil {
			continue
		}
		window := []string{}
		for m := 0; m < duration; m += Interval {
			window = append(window, start.Add(time.Duration(m)*time.Minute).Format(time.RFC3339))
		}
		valid := true
		for _, at := range window {
			if !allowed[at] {
				valid = false
				break
			}
		}
		if !valid {
			continue
		}
		ids := []string{}
		for _, p := range participants {
			free := true
			for _, at := range window {
				if !availability[p.ID][at] {
					free = false
					break
				}
			}
			if free {
				ids = append(ids, p.ID)
			}
		}
		if len(ids) > 0 {
			out = append(out, Recommendation{Start: s, Count: len(ids), ParticipantIDs: ids})
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Count != out[j].Count {
			return out[i].Count > out[j].Count
		}
		return out[i].Start < out[j].Start
	})
	return out
}
