# Meeting UI

Updated 3 Nov 2026 for `/meeting/availability`. API contracts and persistence remain
in [Meeting availability](../docs/meeting.md).

## Layout

Meeting uses a separate system-sans surface from the private Assistant. The shell is
1,184 px including gutters, with neutral off-white backgrounds, white panels, subtle
borders, and green primary actions. Headings and controls use direct Indonesian copy.
There are no marketing slogans, decorative mock calendars, or synthetic avatars on
the creation page.

Creation uses one form: title and optional agenda above the month calendar and time
settings. Those settings sit beside the calendar on desktop and below it on phones.
Invitations put availability first, with recommendations and participants in a desktop
sidebar. Below 820 px, results follow availability; phone recommendations use two
columns. Inputs use 16 px text on phones to avoid automatic input zoom.

## Compact availability

- Every date appears in the same wrapping grid; no horizontal date strip.
- One active date shows up to 16 actual 15-minute intervals in four columns.
- Longer windows have labeled range buttons, rather than a vertical time scroller.
- All date and range buttons remain visible. The panel has no internal scroll region.
  The surrounding document scrolls normally on smaller screens.
- Dates with personal selections show a dot. A day shortcut selects/clears every slot
  on that date. Global selection/clear actions explicitly apply to all dates.
- Group view uses six heat levels plus actual counts, participant filtering, and named
  slot inspection. Recommendations open their date/range directly without scrolling.
- Draft choices survive date, range, mode, and timezone changes. Only Save persists.
- Repeated DST hours remain chronological and include distinct UTC offsets.

Guests start in personal availability. Mouse/pen dragging selects contiguous intervals
within the visible range; touch uses taps. Arrows move through the four-column time
choices, Home/End jump within the range, and Space/Enter toggles. There is one tab stop
for the visible time buttons. All controls have focus indicators and pressed states.

Loading, missing, retry, offline, stale, unsaved, saved, confirmed, and reopened states
remain explicit. The confirmation dialog preserves its native focus boundary, Escape,
focus restoration, and busy dismissal rules. Motion remains brief and optional.

## Verification and references

`scripts/meeting-smoke.mjs` checks responsive creation/invitations, a 14-date/24-hour
poll without internal scrolling at 320/390/480/768/1024/1440 px, date/range draft
preservation, touch, range dragging, keyboard, DST, persistence, stale responses,
permissions, confirmation/reopen, and calendar export. All data is synthetic.

| Desktop poll | Desktop creation |
|---|---|
| ![Desktop demo](assets/meeting/1440-demo.png) | ![Desktop creation](assets/meeting/1440-create.png) |

| Mobile poll | Mobile creation |
|---|---|
| ![Mobile demo](assets/meeting/390-demo.png) | ![Mobile creation](assets/meeting/390-create.png) |
