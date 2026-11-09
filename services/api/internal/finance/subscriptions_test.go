package finance

import "testing"

func TestBillingDayFor(t *testing.T) {
	cases := []struct {
		date string
		old  *int64
		want int64
	}{
		{"2027-02-28", ptr(int64(31)), 31}, // clamped month end keeps the 31st
		{"2027-02-28", ptr(int64(20)), 28}, // a real move to the 28th
		{"2027-03-15", ptr(int64(31)), 15},
		{"2027-04-30", nil, 30},
	}
	for _, tc := range cases {
		if got := billingDayFor(d(tc.date).Day(), tc.old); got != tc.want {
			t.Errorf("billingDayFor(%s) = %d, want %d", tc.date, got, tc.want)
		}
	}
}
