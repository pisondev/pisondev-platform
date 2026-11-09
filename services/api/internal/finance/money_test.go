package finance

import (
	"encoding/json"
	"math/big"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestMoneyText(t *testing.T) {
	cases := map[string]Money{
		"0":         0,
		"65000":     Rupiah(65000),
		"416551.65": 41655165,
		"181165.95": 18116595,
		"181165.9":  18116590,
		"0.05":      5,
		"-1.5":      -150,
	}
	for want, m := range cases {
		if got := m.String(); got != want {
			t.Errorf("%d.String() = %q, want %q", int64(m), got, want)
		}
		back, err := ParseMoney(want)
		if err != nil || back != m {
			t.Errorf("ParseMoney(%q) = %d, %v; want %d", want, int64(back), err, int64(m))
		}
	}
}

// The canonical text must equal what notionsync makes of a Notion number, or every
// decimal amount would look changed on each sync.
func TestMoneyMatchesNotionNumberText(t *testing.T) {
	for _, s := range []string{"416551.65", "181165.95", "181165.9", "65000", "0.01", "1234567.89"} {
		f, _ := strconv.ParseFloat(s, 64)
		notion := strconv.FormatFloat(f, 'f', -1, 64)
		m, err := ParseMoney(notion)
		if err != nil || m.String() != notion {
			t.Errorf("%s: Money %q, Notion %q", s, m.String(), notion)
		}
	}
}

func TestParseMoneyRoundsAndRejects(t *testing.T) {
	if m, err := ParseMoney("1.005"); err != nil || m != 101 && m != 100 {
		t.Errorf("1.005 = %d, %v", int64(m), err)
	}
	if m, err := ParseMoney("4.1655165e5"); err != nil || m != 41655165 {
		t.Errorf("exponent = %d, %v", int64(m), err)
	}
	for _, bad := range []string{"", "abc", "NaN", "1e20"} {
		if _, err := ParseMoney(bad); err == nil {
			t.Errorf("ParseMoney(%q) should fail", bad)
		}
	}
}

func TestMoneyJSON(t *testing.T) {
	var in struct {
		Amount Money `json:"amount"`
	}
	if err := json.Unmarshal([]byte(`{"amount":416551.65}`), &in); err != nil || in.Amount != 41655165 {
		t.Fatalf("unmarshal = %d, %v", int64(in.Amount), err)
	}
	b, _ := json.Marshal(in)
	if string(b) != `{"amount":416551.65}` {
		t.Errorf("marshal = %s", b)
	}
}

func TestMoneyNumeric(t *testing.T) {
	n, _ := Money(18116595).NumericValue()
	var m Money
	if err := m.ScanNumeric(n); err != nil || m != 18116595 {
		t.Fatalf("round trip = %d, %v", int64(m), err)
	}
	// Postgres may send 65000.00 as 6500000e-2 or 65e3.
	for _, n := range []pgtype.Numeric{
		{Int: big.NewInt(6500000), Exp: -2, Valid: true},
		{Int: big.NewInt(65), Exp: 3, Valid: true},
	} {
		if err := m.ScanNumeric(n); err != nil || m != Rupiah(65000) {
			t.Errorf("scan %v = %d, %v", n, int64(m), err)
		}
	}
}

func TestQuotaKeepsSen(t *testing.T) {
	s := snapshotOct1()
	s.Transactions = append(s.Transactions, Transaction{
		ID: "sen", Date: d("2026-10-01T13:00"), Name: "Snack", Type: TypeExpense, Category: "Makan",
		Account: "Mandiri Debit", Amount: ptr(Money(150)),
	})
	q := ComputeQuota(s, testRules, at("2026-10-01T20:00"))
	if q.Spent != Rupiah(47500)+150 || q.Balance != Rupiah(470877)-150 {
		t.Errorf("spent %s, balance %s", q.Spent, q.Balance)
	}
	if q.Max%Rupiah(1000) != 0 {
		t.Errorf("Max %s is not whole thousands", q.Max)
	}
}
