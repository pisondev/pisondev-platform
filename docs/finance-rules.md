# Finance rules

These reproduce the Overview and Calculation tabs of the Finance Assistant sheet (rules
as of 1 Oct 2026). Code: `services/api/internal/finance/calc.go` and `subs.go`. Values
such as types and categories stay in Indonesian, as stored in Notion.

Settings (environment, defaults match the sheet): tracked account `Mandiri Debit`,
anchor subscription `Claude`, weekly allowance Rp250.000, minimum balance Rp50.000,
exclusion phrase `dikecualikan dari kuota`.

## Balance

Opening balance (`Saldo Awal`) + income (`Masuk`) − expenses (`Keluar`), tracked account only.

## Weekly quota

| Step | Rule |
|---|---|
| Week start | latest Weekly Recap `Start` up to today |
| Deadline | `Next Billing` of the anchor subscription |
| Subscriptions due | price of every unpaid occurrence of active subscriptions up to the deadline |
| Weeks to deadline | (deadline − week start) ÷ 7, rounded down, at least 1 |
| Deposits expected | weeks − 1 |
| Free funds | balance + deposits × allowance − subscriptions due − minimum balance |
| Max per week | free funds ÷ weeks, rounded down to thousands |
| Spent | expenses on the tracked account since week start, without category `Langganan` and without the exclusion phrase in Notes |
| Remaining | max − spent |

Colour: green below 70%, yellow below 90%, red from 90%.

Period: week start to the first Sunday after it; if that Sunday has passed without a new
week, the period runs to today.

Recent expenses: the latest expenses that count toward the quota.

### Next-week estimate

Not in the sheet. Assumes the rest of this week's quota is spent and the next allowance
arrives. If the deadline falls inside next week, the bills due by it are treated as paid
and the deadline moves one anchor cycle on, which is what the sheet shows once the anchor
bill is paid.

## Savings

- Cycle start: one month before the deadline.
- One row per Weekly Recap week starting in the cycle; its amount is income − expenses on
  the tracked account from its start to the next week's start.
- `W0` carries everything before the cycle, so the rows always add up to Save.
- Save = balance − minimum balance.
- Target = total of the current subscription roster; the chart shows the gap.
- Weeks still to come before the deadline are listed as estimates.

## Subscription roster (`langganan`)

1. Target month: month of the earliest `Next Billing` among active subscriptions.
2. Roster: every active monthly subscription, plus yearly ones billed in that month.
3. Paid once `Next Billing` has moved past the target month.
4. Ordered by price, highest first.

Shifting a bill (`advance`) moves `Next Billing` to the billing day of the next month, or
next year for yearly ones. A billing day missing from a month falls on its last day.

## Reference values

Unit tests rebuild the 1 Oct 2026 state and expect: balance 470.877, subscriptions due
466.998, free funds 453.879, max 151.000, spent 47.500, remaining 103.500, W0 103.471,
W1 54.109, W2 263.297, roster 591.898 (short). On live data of 15 Oct 2026, weekly
Remaining matched the sheet for W1 to W4.
