// Package clock holds the platform time zone and a replaceable "now" for tests.
package clock

import (
	"time"
)

// WIB is Asia/Jakarta. All finance rules count days in this zone.
var WIB = loadWIB()

func loadWIB() *time.Location {
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err != nil {
		// Jakarta has no DST, so a fixed zone is exact when tzdata is missing.
		return time.FixedZone("WIB", 7*60*60)
	}
	return loc
}

// Clock returns the current time. Services take a Clock so tests can pin "now".
type Clock func() time.Time

// System is the real clock, in WIB.
func System() time.Time { return time.Now().In(WIB) }

// Fixed returns a clock frozen at t.
func Fixed(t time.Time) Clock { return func() time.Time { return t.In(WIB) } }

// Day truncates t to midnight WIB.
func Day(t time.Time) time.Time {
	t = t.In(WIB)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, WIB)
}
