package finance

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
)

// LocalDate is a WIB date with an optional time of day, the shape Notion and the sheet
// use. Its canonical text is "2006-01-02" or "2006-01-02T15:04"; a time of exactly 00:00
// collapses to the date alone, matching the sheet sync.
type LocalDate struct {
	t       time.Time
	hasTime bool
	valid   bool
}

const (
	dateLayout     = "2006-01-02"
	dateTimeLayout = "2006-01-02T15:04"
)

// DateOf returns a date-only value for the WIB day of t.
func DateOf(t time.Time) LocalDate {
	return LocalDate{t: clock.Day(t), valid: true}
}

// DateTimeOf keeps the WIB wall clock of t, to the minute.
func DateTimeOf(t time.Time) LocalDate {
	t = t.In(clock.WIB).Truncate(time.Minute)
	d := LocalDate{t: t, hasTime: true, valid: true}
	return d.normalize()
}

// ParseLocalDate accepts "", "2006-01-02", "2006-01-02T15:04" and "2006-01-02 15:04".
func ParseLocalDate(s string) (LocalDate, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return LocalDate{}, nil
	}
	if t, err := time.ParseInLocation(dateLayout, s, clock.WIB); err == nil {
		return LocalDate{t: t, valid: true}, nil
	}
	s = strings.Replace(s, " ", "T", 1)
	if len(s) > len(dateTimeLayout) {
		s = s[:len(dateTimeLayout)] // drop seconds
	}
	t, err := time.ParseInLocation(dateTimeLayout, s, clock.WIB)
	if err != nil {
		return LocalDate{}, fmt.Errorf("invalid date %q, want YYYY-MM-DD or YYYY-MM-DD HH:MM", s)
	}
	return LocalDate{t: t, hasTime: true, valid: true}.normalize(), nil
}

func (d LocalDate) normalize() LocalDate {
	if d.hasTime && d.t.Hour() == 0 && d.t.Minute() == 0 {
		d.hasTime = false
	}
	return d
}

func (d LocalDate) Valid() bool             { return d.valid }
func (d LocalDate) HasTime() bool           { return d.valid && d.hasTime }
func (d LocalDate) Time() time.Time         { return d.t }
func (d LocalDate) Day() time.Time          { return clock.Day(d.t) }
func (d LocalDate) Before(o LocalDate) bool { return d.t.Before(o.t) }

// String is the canonical text, "" when empty.
func (d LocalDate) String() string {
	if !d.valid {
		return ""
	}
	if d.hasTime {
		return d.t.Format(dateTimeLayout)
	}
	return d.t.Format(dateLayout)
}

func (d LocalDate) MarshalJSON() ([]byte, error) {
	if !d.valid {
		return []byte("null"), nil
	}
	return json.Marshal(d.String())
}

func (d *LocalDate) UnmarshalJSON(b []byte) error {
	var s *string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	if s == nil {
		*d = LocalDate{}
		return nil
	}
	parsed, err := ParseLocalDate(*s)
	if err != nil {
		return err
	}
	*d = parsed
	return nil
}

// sql returns the column pair (instant, has_time).
func (d LocalDate) sql() (*time.Time, bool) {
	if !d.valid {
		return nil, false
	}
	t := d.t
	return &t, d.hasTime
}

func fromSQL(t *time.Time, hasTime bool) LocalDate {
	if t == nil {
		return LocalDate{}
	}
	return LocalDate{t: t.In(clock.WIB), hasTime: hasTime, valid: true}.normalize()
}
