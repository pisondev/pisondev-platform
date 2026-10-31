# Assistant design system

Baseline: 20 Oct 2026, commit `bda2a62`. Scope: `assistant.pisondev.com`, implemented in
`apps/assistant-web`. This guide records the current visual language and the rules for
extending it. Proposed changes are marked **proposed**; they are not shipped features.

Meeting availability added on 27 Oct 2026 has a separate responsive visual system at
`/meeting/availability`; see [Meeting UI](meeting-ui.md). Assistant screens retain the
baseline described here. Their shared layout now lives in `app/(assistant)/layout.tsx`.

Read the [UI/UX audit](assistant-uiux-audit.md) for known gaps and the
[motion specification](assistant-motion.md) for animation and loading behavior.

Motion added on 30 Oct 2026 keeps this visual baseline. Currency counters, SVG marks,
quota fills, filter pills, interactions and transaction sheets now animate, with
reduced-motion support. Filters use pressed buttons; transaction sheets now contain
and restore focus, lock scrolling, and hold dismissal during saves. The baseline
descriptions below predate those changes; see the shipped scope in the motion guide.

## 1. Product and visual direction

Assistant is a private workspace for quick personal tasks. Finance is the first module.
The interface should help the owner read a balance, compare values, inspect recent rows,
and complete a small action without navigating a large dashboard.

Preserve these characteristics when adding pages:

- A centered, narrow reading column, including on desktop.
- Kaisei Opti serif text for headings, numbers, controls, forms, and tables.
- Forest-to-gold title text, quiet gray surfaces, and restrained green/red status colors.
- A clear hierarchy: page header, summary, grouped content, detail, action.
- Flat nested surfaces and small rounded corners; charts carry most of the color.
- Plain English interface copy, whole rupiah, and WIB dates where relevant.

A wide sidebar, sans-serif dashboard, saturated page background, large card shadows,
and a different header on each route would change this language. Treat such changes as
an explicit redesign and update this guide together with the shared components.

## 2. Source of truth

All paths below are relative to `apps/assistant-web/src/`.

| Source | Owns |
|---|---|
| [`app/globals.css`](../apps/assistant-web/src/app/globals.css) | Colors, spacing, text sizes, radii, gradient text, scrollbars |
| [`app/layout.tsx`](../apps/assistant-web/src/app/layout.tsx) | Fonts, language, viewport, main column, bottom space |
| [`components/ui.tsx`](../apps/assistant-web/src/components/ui.tsx) | Header, panel, card, figure, toggle, note, chevron |
| [`components/Charts.tsx`](../apps/assistant-web/src/components/Charts.tsx) | SVG charts, HTML labels, subscription swatches |
| [`components/DataTable.tsx`](../apps/assistant-web/src/components/DataTable.tsx) | Column ratios, row size, scrolling, truncation |
| [`components/ProgressBar.tsx`](../apps/assistant-web/src/components/ProgressBar.tsx) | Quota fill and clipped amount labels |
| [`components/AddTransactionSheet.tsx`](../apps/assistant-web/src/components/AddTransactionSheet.tsx) | Bottom sheet and current form patterns |
| [`components/screens/`](../apps/assistant-web/src/components/screens/) | Screen composition and local data/control state |
| [`lib/format.ts`](../apps/assistant-web/src/lib/format.ts) | Currency and date presentation |
| [`lib/useApi.ts`](../apps/assistant-web/src/lib/useApi.ts), [`lib/api.ts`](../apps/assistant-web/src/lib/api.ts) | GET lifecycle, API envelope, session redirects |

The Figma source is described in [Design](README.md). Its original mobile frames are
1080 units wide. Local raw exports contain personal financial data and stay ignored.
The implemented code is the baseline here; this guide does not claim exact parity with
every Figma case. Never publish the exports as documentation examples.

## 3. Layout and units

### The scaled spacing contract

```css
--spacing: calc(min(100vw, 480px) / 1080);
```

One Tailwind spacing unit is one scaled design unit, **not** Tailwind's usual 4 px.
For viewport width `W`, let `s = min(W, 480) / 1080` CSS px. Then `px-85` means
`85s`, `gap-24` means `24s`, and `h-292` means `292s`.
Arbitrary pixel values such as `max-w-[480px]` remain CSS pixels.

| Token or class | Purpose | At 390 px | At 480 px or wider |
|---|---|---:|---:|
| `max-w-[480px]` | Main column cap | 390 px | 480 px |
| `px-85` / `mx-85` | Standard page gutter | 30.69 px | 37.78 px |
| `pt-50` | Header top space | 18.06 px | 22.22 px |
| `p-22` | Panel inset | 7.94 px | 9.78 px |
| `p-28` | Finance navigation card inset | 10.11 px | 12.44 px |
| `p-32` | Hub card inset | 11.56 px | 14.22 px |
| `gap-60` | Navigation card gap | 21.67 px | 26.67 px |
| `mt-24` / `mt-28` | Nearby elements/cards | 8.67 / 10.11 px | 10.67 / 12.44 px |
| `mt-56` / `mt-58` / `mt-60` | Section/navigation gap | 20.22 / 20.94 / 21.67 px | 24.89 / 25.78 / 26.67 px |
| `pb-120` | Main bottom space | 43.33 px | 53.33 px |
| `h-292` | Navigation tile height | 105.44 px | 129.78 px |
| `h-67` | Quota track height | 24.19 px | 29.78 px |

The main layout already owns `mx-auto`, full width, minimum viewport height, and
bottom padding. A screen returns a fragment; it does not add another `<main>`, column
cap, or full-page horizontal padding. `PageHeader`, `Figure`, `Note`, and `Panel` already
apply their own gutters. Padding a wrapper again narrows the content twice.

A standard panel is `910s` wide and its content is `866s` wide after its two `22s`
insets. Chart coordinate systems can differ from these dimensions: `viewBox` determines
their ratio, while `w-full` determines their rendered width.

### Responsive behavior

There are no desktop layout breakpoints in the current screens. Desktop shows the same
480 px column centered in a larger page. At small widths, spacing keeps shrinking but
text reaches fixed minimums. This makes narrow-screen wrapping a required review step.

Check 320, 390, 480, and 1440 CSS px; also check text zoom, long names, large currency
values, and a short viewport with a software keyboard. Do not shrink fonts below the
tokens to force content to fit. Prefer wrapping labels, adjusting column priorities, or
providing an accessible detail view. Widening the application requires a shared layout
decision, not a one-page `lg:` exception.

## 4. Typography

`layout.tsx` loads Kaisei Opti at weights 500 and 700 with `next/font/google`.
Body weight is 500; values and primary actions often use 700. The serif fallback is
Times New Roman. Bruno Ace SC at weight 400 is reserved for the decorative `>` chevron;
it is not a second body font. There is no separate icon library.

| Utility | Definition | Line height | 390 px | 480 px |
|---|---|---|---:|---:|
| `text-display` | `max(24px, 64s)` | 1.35 | 24 px | 28.44 px |
| `text-heading` | `max(16px, 39.5s)` | 1.4 | 16 px | 17.56 px |
| `text-body` | `max(13px, 32s)` | 1.4 | 13 px | 14.22 px |
| `text-small` | `max(11px, 24.4s)` | 1.4 | 11 px | 11 px |

Use one `h1` in `PageHeader`; use `h2.text-heading` for major content sections. Table
headings and helper text use muted text, not a new type scale. Avoid arbitrary text sizes
except existing decorative chevrons. The fixed 11 px labels need particular attention at
zoom and in crowded charts; small text is part of the baseline, not proof of accessibility.

## 5. Color and surfaces

| Token | Value | Current role |
|---|---|---|
| `page` | `#FAFAFA` | Body and main background |
| `panel` | `#F0F0F0` | Group container, inactive toggle track, secondary actions |
| `card` | `#FAFAFA` | Chart/table surface, selected toggle, input background |
| `track` | `#E9E9E9` | Unfilled quota track |
| `ink` | `#1A1A1A` | Default text and heading gradient start |
| `muted` | `#787878` | Supporting text, axes, separators |
| `line` | `#C0C0C0` | Input borders and row rules |
| `green` | `#165D23` | Positive amounts and Finance navigation |
| `leaf` | `#298352` | Cash flow income line/points and chart gradient endpoint |
| `blue` | `#2A5FC2` | Subscriptions navigation, target, projection, links |
| `gold` | `#866633` | Warning text and title gradient endpoint |
| `maroon` | `#810F0F` | Expenses (incl. cash flow outcome line), errors, negative remaining |
| `wine` | `#5D1616` | Red heading endpoint and over-quota text |
| `pink` | `#DB4B6F` | Subscription series label |
| `forest` | `#03310A` | Title gradient start |
| `sky` | `#DEEBF2` | Blue navigation tile background |
| `mint` | `#DEF2E2` | Green navigation tile background |

Reuse semantic utilities such as `bg-panel` and `text-maroon`. Do not add a close hex
variant for a new page. Existing chart gradients and a few button gradients are inline;
if reused beyond their current roles, give them shared tokens first.

### Gradients and elevation

| Treatment | Current definition/use |
|---|---|
| `.text-title-gradient` | Horizontal forest to gold; title and subtitle |
| `.text-label-gradient` | Black to `#666666`; figure label |
| `.text-heading-green` | Ink to green; Cash Flow and Savings headings |
| `.text-heading-red` | Ink to wine; expenses and subscription headings |
| Login action | Background forest to gold |
| Save action | Background green to gold |
| Quota green | `#59CEBA` to `#5CD38A` |
| Quota yellow | `#CEA159` to `#D3C95C` |
| Quota red | `#CE5959` to `#D37C5C` |
| Savings target | `#5982CE` to `#5CAFD3` |
| Savings now | Quota green gradient |

`rounded-card` is `18s`: 6.5 px at 390 px and 8 px at 480 px. It is not an 18 CSS px
radius. `--radius-bar: 25s` exists but is not used by the current quota track; that uses
`rounded-card`. SVG bars use a radius of 25 in their own coordinate system.
The sheet has a separate top radius `max(16px, 40s)` and `shadow-2xl`; its backdrop is
black at 30% opacity. Normal cards are flat. The active toggle has only a faint 1 px
shadow. `.text-glow` is reserved for the quota label.

Only the light color scheme is implemented. A dark theme needs a full token and chart
contrast pass before being introduced.

## 6. Shared component contracts

### `PageHeader`, `Panel`, and `Card`

`PageHeader({ title, subtitle?, back? })` renders the back link, title, optional subtitle,
and muted divider. Without `back`, a `h-57` spacer keeps the header position. The back
link uses `-ml-14`, heading size, muted text, and an ink hover state.
The divider uses `max(2px, 5s)` thickness and `mt-24`.

`Panel({ children, className? })` is a `section` with `mx-85 rounded-card bg-panel p-22`.
Give it a heading in its content. `Card` is a relative `div` with a card background and
the shared radius. It has no built-in padding: charts and tables own their inner geometry.
Stack cards with the existing `mt-28` pattern where appropriate.

### `Figure`, `Note`, and `Chevron`

`Figure` aligns a label, colon, and bold value on their baselines with `gap-24` and page
gutters. Its label occupies 34% and does not shrink. The default tone is green; maroon
handles a negative Remaining value. Preserve the explicit sign and test large amounts.

`Note` displays muted or maroon body text with page gutters and vertical padding. It
currently has no live-region semantics or retry action. Use it for honest empty/error
copy; the proposed skeleton system belongs in separate reusable components.

`Chevron` is decorative and `aria-hidden`. Keep the navigation name on the link itself.
The large tile chevron is `max(36px, 100s)`.

### `Toggle<T>`

The current segmented selector uses a panel track with `p-8`; each option has `min-w-143`,
`px-18`, `py-8`, small text, and card radius. The active option uses a card background,
ink text, and faint shadow. Inactive options are muted with an ink hover state.
Only colors transition; the active pill does not slide.

It currently exposes `tablist`, `tab`, and `aria-selected`, but has no roving tab index,
arrow-key handling, or associated `tabpanel`. Before reusing it for new interactions,
choose proper filter semantics or complete the tab contract described in the audit.
The visual treatment can remain the same.

### `Select<T>`

`Select({ value, options, onChange, aria-label, className, tone, disabled })` in
`Select.tsx` (added 31 Oct 2026) replaces every native select. It is a select-only
combobox: focus stays on the trigger, which takes its look from `className` and adds a
chevron that turns on open. The list renders in a body portal at z-60 (above sheets),
6 px from the trigger, at least as wide, at most `min(240px, 40vh)` tall, and flips
above when there is more room there. Rows are 40 px; the active row has a panel tint and
the chosen value is green with a check. `tone="meeting"` swaps in the Meeting palette.
The list copies the trigger's font. Keyboard: arrows, Home/End, PageUp/PageDown,
typeahead, Enter/Space to choose, Escape to cancel (without closing an enclosing sheet),
Tab to leave. Pass `aria-label` even inside a `<label>`.

### Navigation tiles and buttons

Hub uses a two-column grid with `px-85 gap-60 mt-60`, tile `p-32`, and `h-292`.
Finance uses `NavTile` (31 Oct 2026) in a `px-85 gap-40 mt-58` grid that stacks into one
column below 360 CSS px. `NavTile({ href, title, icon, tone, children })` keeps the
sky/mint identity as a light gradient from the token toward white, a hairline tinted
edge, a soft colored shadow, and a glow with a thin ring in the bottom-right corner
behind the content. An icon badge (white, tinted edge) sits above the heading-size
title; `children` is a small live summary (Subscriptions: monthly total and counts;
Quota: amount left, a mini bar in the quota fill gradient, percent used). Height is a
292-unit minimum that grows with content, so the chevron never leaves the tile.
Subscriptions and Links use sky/blue; Finance and Quota use mint/green. A ready module is
a `Link`; Meeting is currently an `aria-disabled` noninteractive `div` at 60% opacity.

`Button({ variant, busy, ...button props })` in `ui.tsx` (added 24 Oct 2026, used by
Links) holds the action families: `primary` (green-to-gold gradient, bold white),
`secondary` (panel), `danger` (panel, maroon text), and `text` (blue underlined). Every
variant has a 44 CSS px minimum height, a visible `focus-visible` green outline, and
disabled styling; `busy` disables it and sets `aria-busy`, so a pending action cannot be
repeated. It defaults to `type="button"`. Older screens still use inline buttons and the
circular add button `max(34px, 68s)`; move them to `Button` when they are next changed.

### `DataTable<T>`

- Columns use a CSS grid; `width` means an `fr` ratio, not CSS pixels or scaled units.
- Header text is muted with a darker bottom rule `max(1.5px, 3s)`.
- Rows have light 1 CSS px rules; the last row has no rule.
- Default body rows have minimum height `max(64s, 32px)` and show up to three rows.
- `size="small"` rows have minimum height `max(61s, 28px)`; Finance and Savings show four.
- At the supported widths these minimums resolve to 32 and 28 CSS px respectively.
- The body scrolls independently; the header stays outside that scroll region.
- Cells truncate with ellipses. Some descriptions have native `title` hints; these do
  not provide a reliable touch or keyboard detail view.
- `rowKey` must remain stable. `rowStyle` colors subscriptions; cell classes color signs.
- The implementation uses `div`/`span`, without native table semantics.
- `action` places one control at the right end of the header, vertically centered and
  outside the grid, so the header height does not change. Keep the last label short.
  Finance uses it for the `DetailLink` to `/finance/cashflow`.

### `DetailLink`

`DetailLink({ href, label })` in `ui.tsx` (added 31 Oct 2026) is the standard way to open
a detail page: a window glyph with an arrow leaving its top-right corner, 17 CSS px inside
a 32 CSS px target, muted until hover. `label` is its accessible name and tooltip. The
arrow nudges 1.5 px on fine-pointer hover. It opens in the same tab; the detail page's
`PageHeader` back link returns. Carry the current view in the query string when the
detail page can start from it (Finance passes `group` and `kind`).

Example subscription widths are `86:180:228:320`; expense widths are `86:170:228:330`.
Preserve the component's header/row geometry when adding columns or loading placeholders.
Do not make a static row look clickable. A row with a future detail action needs an
explicit accessible link/button and visible focus.

### Charts

Charts are custom SVG, with HTML labels positioned as percentages of the view box.
There is no chart or animation package dependency.

| Chart | View box | Behavior to preserve |
|---|---|---|
| Subscription | `866 × 529` | Rounded bars; one color per row/bar; price and name labels; toggle upper right |
| Savings | `847 × 496` | Target/Now bars sharing the width between the axis (x 168) and the gap marker (x 640), 48 units apart; gap annotation; value labels separate when close |
| Cash flow | `847 × 546` | Income (leaf) and outcome (maroon) lines with dots, legend below the axis; dashed drop lines to the higher value; hover/focus shows the amount, click pins it with a larger dot (higher series labels above, lower below); zero guide for negative data; every point also marks its value on the y-axis (series color) and its period on the x-axis (gray), centered on the axis lines; a hovered or pinned point adds a dashed guide to the y-axis; labels sampled to about six |

Subscription bar height has a 40-unit minimum. Savings also clamps negative values to
zero before applying a 40-unit minimum. These are visual compromises, not proportional
representations of zero/negative values; review them before adding animation.
Subscription colors are assigned by array index, so sorting can change identity.

Monthly series swatches (`label / gradient from / gradient to`) are:

| Index | Text | From | To |
|---:|---|---|---|
| 0 | `#866633` | `#CE6359` | `#D3AD5C` |
| 1 | `#2A5FC2` | `#59CEBA` | `#5C90D3` |
| 2 | `#810F0F` | `#CE5959` | `#D35CC3` |
| 3 | `#165D23` | `#70CE59` | `#298352` |
| 4 | `#DB4B6F` | `#E25FB2` | `#CE863D` |
| 5 | `#5D1616` | `#95BC3C` | `#298352` |

Yearly starts with green `#95BC3C → #298352` and pink `#E25FB2 → #CE863D`, then appends
the monthly set. Always take chart and table colors from the same mapping.

### Quota progress

The API supplies `percent` and `level`. Do not reproduce quota calculations in a screen.
For positive maximums: zero spending is empty; below 70% is green; 70% to below 90% is
yellow; 90% and above is red. A nonpositive maximum is red at 100%.
See [finance rules](../docs/finance-rules.md) and the backend `quotaLevel` function.

The visual fill clamps to 0–100%; the visible percentage can exceed 100. A colored
amount label is drawn over the track and a second white label is clipped over the fill.
Over-quota amount text uses wine. The duplicate label is hidden from assistive technology.
Preserve this alignment when animating; fill width and clipping must move together.

## 7. Forms and overlays

The transaction sheet is currently mounted only while open. It is fixed to the bottom,
capped at 480 px wide and 92 dynamic viewport height, and scrolls internally. Insets are
`px-60 pt-40 pb-60`. A small top handle is decorative; dragging is not implemented.

Fields use small muted labels, body-size inputs, card backgrounds, line borders,
`px-24 py-16`, green focus borders, and a green 20% focus ring. Textareas do not resize.
Category and Account use the shared `Select`; the date-time picker is native. Date is labeled WIB and initialized
with `nowWIB()`. Amount accepts digits, dot grouping, `Rp`, and `rb`/`k` shorthand.
Client native validation and API field errors both exist.

Expense exposes Category and the exclusion checkbox; Income exposes the weekly allowance
checkbox. Save uses a green-to-gold gradient, bold white text, and twice Cancel's flex
share. Busy disables Save and changes its label to `Saving...`; other dismissal paths
remain available today. Duplicate detection has an explicit save-again action.

Initial focus, Escape close, backdrop close, and a named modal dialog are implemented.
Focus trapping, background inertness, scroll locking, focus restoration, field-error
associations, and dismissal behavior during an outstanding save still need work. New
sheets should use one corrected shared primitive rather than copying those gaps.

## 8. Data, copy, and state contracts

Use `rupiah()` for whole rupiah (`Rp25.000`, `-Rp25.000`, `-` for missing amounts) and
`signedRupiah()` for signed transaction/savings values (`+Rp25.000`). Use `shortDate()`
and `dateRange()` for the existing English month labels. Distinguish missing, zero,
negative, estimated, and failed values; never turn a failed request into a believable zero.
Keep Indonesian storage values such as `Masuk`, `Keluar`, and the exclusion marker
inside the existing data contract while displaying English control labels.

`useApi` retains previous data during reload/path changes. Since 24 Oct 2026 it reports
`loading` (nothing has arrived for the current request yet) and `refreshing` (a newer
request is pending while earlier data is shown), both derived from the request the data
belongs to. An error stays until a request succeeds. It has no cancellation or cache;
screens offer retry by calling `reload`. The `alive` guard suppresses stale results.
Links shows the pattern: `Loading...` without data, `Refreshing...` beside the heading
with data, and an inline error with Try again.

Every new data section must define: initial loading, ready, empty, refreshing with prior
data, error without data, error with prior data, and unauthorized redirect. Mutations
also need idle, submitting, field error, duplicate/conflict if relevant, and saved states.
Mark a save successful only after the API accepts it. Local acceptance and external sync
completion are separate events; current quota save copy states the expected sync delay.

## 9. Recipe for a matching new page

1. Read this guide, the audit, and the motion spec; identify the closest existing screen.
2. Add a thin `src/app/<module>/page.tsx` with metadata and a screen import. Put the
   screen in `src/components/screens/`; add `"use client"` only when it needs hooks.
3. Use `PageHeader` with a real parent `back` destination. Add the key `Figure` before
   the first `Panel` if a summary matters. Reuse `Panel`, `Card`, and `DataTable`.
4. Keep module API types in `lib/types.ts`, formatters in `lib/format.ts`, and data
   fetching through the existing API envelope. Implement the API route before using it.
5. Define every data/control state before applying motion. Reuse corrected accessible
   control primitives as they become available.
6. Add the route to the app README. Add a Hub tile only when the module works; preserve
   the disabled Coming soon state until then.
7. Verify the responsive and accessibility checklist, run repository checks, and update
   the changelog and this guide if a shared contract changes.

This composition example is a proposed page shape, not a working Meeting module:

```tsx
import { DataTable } from "@/components/DataTable";
import { Card, PageHeader, Panel } from "@/components/ui";

type Agenda = { id: string; title: string; dateLabel: string };

export function MeetingScreen({ agenda }: { agenda: Agenda[] }) {
  return (
    <>
      <PageHeader title="Meeting Assistant" subtitle="Your meeting workspace" back="/" />
      <Panel className="mt-38">
        <h2 className="text-heading-green px-10 pb-16 text-heading">Upcoming meetings</h2>
        <Card>
          <DataTable<Agenda>
            rows={agenda}
            rowKey={(row) => row.id}
            empty="No upcoming meetings."
            columns={[
              { key: "date", label: "Date", width: 240, cell: (row) => row.dateLabel },
              { key: "title", label: "Title", width: 574, cell: (row) => row.title },
            ]}
          />
        </Card>
      </Panel>
    </>
  );
}
```

Loading/error states belong around the data section; an empty array here must mean a
successful empty result. The table's semantic gap remains a prerequisite for new usage.

## 10. Page review checklist

- [ ] Header, surfaces, type, gutters, radii, and colors reuse shared contracts.
- [ ] No horizontal document overflow at 320/390/480/1440 px; long text remains reachable.
- [ ] At 200% zoom, content/actions remain usable; at 320 CSS px, important text reflows.
- [ ] Buttons, inputs, filters, and close actions have visible keyboard focus and names.
- [ ] Pointer targets aim for 44 CSS px, independently of scaled design units; do not
  describe 44 px as the WCAG AA minimum. See the audit for the 24 px criterion/exceptions.
- [ ] Dialog focus, scroll, Escape, restore, and busy dismissal behavior are verified.
- [ ] Every data state is intentional; skeletons share the actual destination geometry.
- [ ] Money, date, quota level, signs, and estimated labels preserve backend meaning.
- [ ] Motion respects reduced motion and never blocks an action or hides final values.
- [ ] Synthetic fixtures cover zero/one/many rows, long labels, failures, and rapid toggles.
- [ ] Repository checks pass; docs and dated changelog explain any shared changes.
