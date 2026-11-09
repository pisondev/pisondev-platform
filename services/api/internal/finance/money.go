package finance

import (
	"fmt"
	"math"
	"math/big"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgtype"
)

// Money is an amount of rupiah counted in sen (1/100), so bank amounts such as
// Rp416.551,65 stay exact. In JSON, Notion and the canonical text it is plain rupiah with
// up to two decimals ("416551.65"); in Postgres it is numeric(16,2).
type Money int64

// Rupiah converts whole rupiah to Money.
func Rupiah(n int64) Money { return Money(n * 100) }

// String is the canonical text: no trailing zeros, the same as Notion's number text.
func (m Money) String() string {
	sign, v := "", int64(m)
	if v < 0 {
		sign, v = "-", -v
	}
	whole, sen := v/100, v%100
	if sen == 0 {
		return sign + strconv.FormatInt(whole, 10)
	}
	return strings.TrimRight(fmt.Sprintf("%s%d.%02d", sign, whole, sen), "0")
}

// ParseMoney reads rupiah text such as "65000", "416551.65" or "-1.5". Anything past
// two decimals is rounded to the nearest sen.
func ParseMoney(s string) (Money, error) {
	s = strings.TrimSpace(s)
	f, err := strconv.ParseFloat(s, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) || math.Abs(f) > 9e13 {
		return 0, fmt.Errorf("invalid amount %q", s)
	}
	if i := strings.IndexByte(s, '.'); i < 0 || len(s)-i-1 <= 2 {
		// Short decimals: read digits directly, free of float rounding.
		neg := strings.HasPrefix(s, "-")
		digits := strings.TrimLeft(s, "+-")
		whole, frac, _ := strings.Cut(digits, ".")
		frac = (frac + "00")[:2]
		if w, err1 := strconv.ParseInt(whole+frac, 10, 64); err1 == nil && !strings.ContainsAny(digits, "eE") {
			if neg {
				w = -w
			}
			return Money(w), nil
		}
	}
	return Money(math.Round(f * 100)), nil
}

func (m Money) MarshalJSON() ([]byte, error) { return []byte(m.String()), nil }

func (m *Money) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	v, err := ParseMoney(s)
	if err != nil {
		return err
	}
	*m = v
	return nil
}

// NumericValue and ScanNumeric map Money to a Postgres numeric column.
func (m Money) NumericValue() (pgtype.Numeric, error) {
	return pgtype.Numeric{Int: big.NewInt(int64(m)), Exp: -2, Valid: true}, nil
}

func (m *Money) ScanNumeric(n pgtype.Numeric) error {
	if !n.Valid {
		return fmt.Errorf("cannot scan NULL into Money")
	}
	if n.NaN || n.InfinityModifier != pgtype.Finite {
		return fmt.Errorf("cannot scan %v into Money", n)
	}
	v := new(big.Int).Set(n.Int)
	switch exp := int64(n.Exp) + 2; {
	case exp > 0:
		v.Mul(v, new(big.Int).Exp(big.NewInt(10), big.NewInt(exp), nil))
	case exp < 0:
		r := new(big.Rat).SetFrac(v, new(big.Int).Exp(big.NewInt(10), big.NewInt(-exp), nil))
		f, _ := r.Float64()
		v = big.NewInt(int64(math.Round(f)))
	}
	if !v.IsInt64() {
		return fmt.Errorf("amount out of range")
	}
	*m = Money(v.Int64())
	return nil
}

func moneyText(m *Money) string {
	if m == nil {
		return ""
	}
	return m.String()
}

func parseMoneyPtr(s string) (*Money, error) {
	if strings.TrimSpace(s) == "" {
		return nil, nil
	}
	m, err := ParseMoney(s)
	if err != nil {
		return nil, err
	}
	return &m, nil
}
