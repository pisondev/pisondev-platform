# Assistant motion and loading specification

Proposed on 20 Oct 2026 for `assistant.pisondev.com`. The shipped scope below updates
that plan; the remaining sections describe future work. Use the
[design system](assistant-design-system.md) for existing geometry and the
[audit](assistant-uiux-audit.md) for prerequisites.

## Shipped motion (30 Oct 2026)

- `Motion.tsx`: 480 ms whole-rupiah counters for Balance, Remaining and subscription
  totals. Final accessible text is stable and reserves the final width; animation frames
  update only a decorative text node. Updates start from the current amount and cancel
  obsolete frames. Hidden tabs and reduced-motion changes settle immediately.
- SVG data marks reveal once when visible, using 420 ms baseline-anchored bar growth,
  at most 150 ms stagger, normalized line drawing and fading points/guides. Filters
  replace only the data marks; labels, axes and controls stay fixed. Zero and negative
  bar values use zero height; negative amounts remain explicit in labels.
- Quota fill width and white-label clipping share one registered percentage property,
  including initial entry and updates. Unsupported CSS falls back to final geometry.
- Existing sections and new rows fade/rise briefly. Ready tiles lift 2 px on fine-pointer
  hover; buttons press slightly. Keyboard focus remains visible. Measured filter pills
  slide with resize-aware bounds; their buttons use `aria-pressed` filter semantics.
- Transaction sheets fade/slide in and out, retain modality through the exit, contain
  focus, make the background inert, lock scrolling and restore the opener on cleanup.
  Saving holds dismissal, disables fields and blocks repeated requests. Success closes
  through the same exit timing. Timers clean up on route unmount; preference changes
  finish an active exit immediately.
- Link details, new link rows and visit bars share the motion primitives. Skeletons,
  row removal/layout interpolation and richer chart tooltips remain future work.
- 31 Oct 2026: the custom `Select` (section 6) replaces all native selects. Its list
  slides out of the trigger in 200 ms (clip-path reveal, 6 px shift, fade from 0.4) and
  back in 150 ms on close, mirrored when it opens above. Input is blocked while it
  closes. Reduced motion opens and closes it at once.
- CSS motion runs only with `prefers-reduced-motion: no-preference`; changing the
  preference immediately restores final shapes. No motion package or permanent
  `will-change` layer is used.

Local browser checks use synthetic API responses only. Install the optional runner
with `npm install --prefix services/api/tmp/motion-browser playwright`, start the app
on port 3100, then run `node scripts/assistant-motion-smoke.mjs`. The test covers final
values, interrupted motion, filters, quota clipping, sheet focus/save/exit lifecycle,
reduced motion, viewport widths, and link details. No production writes are performed.

## 1. Motion principles

Motion should explain a changed value, a selection, an action, or a spatial relationship.
Preserve the calm serif interface. Use short fades, small translations, and restrained
press feedback. Default surfaces remain flat. Every animation must have a trigger, a
clear final state, an interruption policy, and a reduced-motion alternative.

Content, focus, and controls must remain available while decorative motion runs.
Do not make users wait for a reveal before reading an amount or acting. Do not use fake
loading timers, looping chart entrances, bouncing balances, confetti on transactions,
parallax, cursor-following effects, or perpetual glow on financial warnings.

The durations below are design choices for this product, not measurements of existing
behavior or requirements from a library.

## 2. Shared motion tokens

Add these to `globals.css` only when implementing the shared motion layer. Use CSS px
for physical movement so motion does not become tiny under the scaled spacing system.

| Proposed token | Value | Purpose |
|---|---|---|
| `--motion-instant` | `80ms` | Press-down response |
| `--motion-fast` | `120ms` | Hover, focus color, small exit |
| `--motion-base` | `180ms` | Selection, dropdown, content fade |
| `--motion-panel` | `240ms` | Sheet entrance or short page reveal |
| `--motion-chart` | `420ms` | Initial data visualization |
| `--motion-chart-update` | `300ms` | Existing data changes |
| `--motion-ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Enter and settle |
| `--motion-ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | Exit |
| `--motion-ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | Selection/data changes |
| `--motion-distance-small` | `6px` | Content entry |
| `--motion-distance-page` | `10px` | Route-level entry |
| `--motion-stagger` | `35ms` | Small initial groups only |

Do not start a cascade with unbounded `index * delay`. Limit chart staggering to the
first six marks and 175 ms of added delay; finish a chart entrance within about 600 ms.
Reveal remaining marks together. Keep the page header and controls immediately visible.

Proposed CSS pattern for an interactive tile, after adding a visible focus treatment:

```css
@media (hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) {
  .interactive-tile {
    transition: transform var(--motion-fast) var(--motion-ease-out);
  }
  .interactive-tile:hover { transform: translateY(-2px); }
}

@media (prefers-reduced-motion: no-preference) {
  .interactive-tile:active { transform: scale(0.985); }
}

@media (prefers-reduced-motion: reduce) {
  .interactive-tile { transform: none; transition: none; }
}
```

Keep the link's focus ring independent of the moving child when possible. Disabled or
Coming soon tiles get neither lift nor press. Hover is an extra cue; the default style
and keyboard focus still communicate the action.

## 3. Interaction and entrance inventory

Durations are enter/update unless an exit duration is explicitly given. Reduced-motion
users receive the same final content/selection immediately, with movement removed.

| Surface and trigger | Proposed behavior | Timing / easing | Reduced motion and interruption |
|---|---|---|---|
| Hub/Finance tile pointer hover | Lift 2 px; chevron moves 2 px right; optional subtle color emphasis | 120 ms / out | Color/focus cue only; pointer leave reverses from current state |
| Tile/button press | Scale visual content to 0.985; release to 1; keep label readable | 80 ms down, 120 ms release / out | No scale; immediate active treatment; disabled/busy has no press |
| Back and text link hover | Text becomes ink/stronger existing link color; underline emphasis for text actions | 120 ms / standard | Instant; do not shift text or link geometry |
| Circular Add button | Small press; optional 45-degree icon rotation only while opening the sheet | 120 ms / out | Immediate; retain named button, no perpetual icon spin |
| Input focus | Border and focus-ring color strengthen | 120 ms / standard | Focus ring appears immediately; never rely on motion for focus |
| Checkbox change | Native control initially; if custom later, checkmark fades/scales from 0.9 | 120 ms / out | Immediate check; retain native input semantics and hit area |
| Toggle selection | One background pill translates between measured option bounds; text colors update | 180 ms / standard | Pill jumps; rapid input targets latest selection |
| Content under toggle | Crossfade changed content; preserve section size and control focus | 120 ms out, 180 ms in | Immediate swap; latest selection wins |
| Dropdown open/close | Popover fades and moves 4 px from trigger; chevron rotates 180 degrees | 180 ms in, 120 ms out / out-in | Immediate open/close; focus follows combobox contract |
| First route content | Optional opacity 0→1 and 10 px up; header stays visible | 180–240 ms / out | No entrance; navigation and focus never wait |
| Forward/back navigation | Optional 10 px directional content slide with fade, only if direction is known | 180 ms / out | Instant; unknown history uses a simple fade |
| Initial panel group | Fade and 6 px rise, at most three groups staggered | 180 ms + 35 ms/group / out | No movement; do not animate every nested card too |
| Ready data after skeleton | Skeleton fades out as real content replaces it in the reserved area | 120–180 ms / standard | Immediate; no extra delay on cached/fast responses |
| Skeleton while pending | Subtle shared shimmer, one direction, clipped inside bones | 1400 ms loop / linear | Static bones; retain loading status text |
| Sheet open | Backdrop fades to 30%; sheet translates from below the viewport to bottom edge | Backdrop 180 ms, sheet 240 ms / out | Immediate modal; focus and inertness applied on open |
| Sheet close | Sheet slides down and backdrop fades; keep mounted until exit completes | Sheet 180 ms, backdrop 120 ms / in | Immediate unmount; cleanup must not depend solely on animation events |
| Expense/Income form switch | Conditional block fades/slides 4 px; other fields settle once | 180 ms / out | Immediate layout; keep stable field values and focus |
| Save pending | Preserve button width; change label to Saving and show a small progress indicator | 120 ms label fade; 900 ms spinner loop | Static Saving text; a single mutation remains in flight |
| Field error appears | Inline message fades in; border becomes maroon; focus first invalid field | 120 ms / out | Immediate; announce once, no shaking form |
| Duplicate warning | Expand inline warning region with a short fade; preserve entered values | 180 ms / out | Immediate; explicit confirmation remains separate |
| Saved confirmation | Inline success note fades in; new expense row receives a brief panel/mint tint | 180 ms in; tint settles within 700 ms | Static confirmation; no flashing or automatic focus theft |
| Retry / refresh | Small local status near section title; existing data stays readable | 120 ms indicator fade | Static Refreshing label; do not replace known data with skeletons |
| Empty state | Text appears with the same section fade; action offered if applicable | 180 ms / out | Immediate; no animated fake data |
| Newly added table row | Fade and 4 px settle; brief nonessential tint | 180 ms / out | Immediate; only the affected row, not entire table |
| Future delete/detail actions | Collapse or reveal the affected region after server acceptance | 180 ms / out | Immediate; future feature, currently absent |
| Sign-in/sign-out navigation | Busy label on activation, visible route result/error | Immediate feedback | Same; prevent accidental repeats and do not mask failure |

Do not animate inert table rows on hover as if they open a detail page. Chart points can
gain subtle emphasis only if they expose actual details through focus/touch as well.
Reserve tooltip fade of 120 ms for an accessible future detail interaction; tooltips must
not be the only place where important values can be read.

## 4. Chart animation contracts

### Shared rules

Animate data marks separately from axes, text labels, controls, and empty/error copy.
The accessible name and numeric text expose final values throughout an animation;
interpolated shapes are a visual transition, not intermediate financial records.
Use stable entity/period keys. Keep old and new scales coherent during an update.
Prevent visually duplicated accessible charts during a crossfade.

The current charts use SVG paths and independently positioned HTML labels. Scaling an
entire chart would scale the text, axes, and touch targets too. Keep label containers
outside the animated marks and preserve their final positions.

### Subscription bars

On first successful load, reveal bars upward from the baseline with `scaleY(0→1)` over
420 ms and up to 35 ms stagger. Use an explicitly configured SVG transform reference box
and the chart's baseline as the origin. SVG default transform origins must not be assumed.
An SVG group translated to the baseline, then scaled, then translated back is an
alternative. Fade labels over 180 ms without scaling them.

On Monthly/Yearly changes, prefer a 180 ms crossfade between complete mark sets because
the categories and bar widths can change. Preserve axes/card geometry and switch the
table, heading, total, and palette to the same selected cycle. For updates with the same
IDs and scale, interpolate bar geometry over 300 ms; use a crossfade when membership or
scale changes make interpolation misleading. Stabilize the ID-to-color mapping first.

For zero or invalid prices, show the true state instead of animating a 40-unit minimum
bar as a positive amount. Dense lists need a label-density/overflow policy before motion.

### Cash flow line and period changes

On first load with at least two points, reveal the line with a stroke-dash animation
over 420 ms; normalize the line's `pathLength` if used. Fade point markers and drop lines
as a group. Restrict dash changes to the main line; existing dashed guides must retain
their appearance. A single point fades in without drawing an imaginary line.

All/Income/Outcome switches may interpolate values only when the period keys and point
count match. If the number of commands in the SVG path differs, do not morph the `d`
attribute blindly: crossfade the marks over 180 ms. Monthly/Weekly usually changes
periods, count, and scale, so crossfade after the new response arrives. Refresh text and
table filters together while indicating which part is pending. Negative data keeps the
zero guide; include all-negative and mixed-sign fixtures before shipping.

### Savings Target/Now

Reveal the two bars from their shared baseline over 420 ms, with a 35 ms offset for Now.
Fade the gap annotation once the bar reveal has begun, without delaying the final values.
On new values, update both bar heights, guide lines, gap line, and label positions in the
same 300 ms transition. Preserve the existing collision-spreading logic for near-equal
labels. Equal values show no gap line. Negative Save needs a clear negative representation
or an explicit textual state before animation; it must not look like positive savings.

### Weekly quota fill

On first ready data, animate the fill from 0 to its clamped final width over 420 ms.
On refresh, animate from the currently drawn width to the new width over 300 ms. Drive
the fill and duplicate-label clip from a single progress value so white text never extends
beyond the fill. Leave the final spent/max amounts and true percentage readable.

Choose the final API level immediately; a temporary visual width must not imply that an
over-quota state is safe. A level change can crossfade two fill layers over 180 ms;
CSS gradients do not interpolate reliably as a simple background-color transition.
For a width at or above 100%, stop at the track end and keep the true percentage visible.
Test empty, 69/70/89/90/100/over-100%, negative remaining, and nonpositive maximum.
Under reduced motion, render final width, clip, tone, and labels synchronously.

### Numeric values

Prefer a short value crossfade over counting through fake balances. If a future counter
is approved, retain a static accessible final value, reserve enough width, respect signs
and missing values, and never announce every animation frame. Do not mix a new remaining
amount with an old spent/max pair during refresh.

## 5. Accurate skeletons

Skeletons must match the destination component's actual geometry, not a generic stack of
rectangles. Build reusable `Skeleton`, `FigureSkeleton`, `ChartSkeleton`, and
`TableSkeleton` primitives after implementing a reliable request lifecycle.
These names are proposed components; they do not exist yet.

### State and timing

Use the following states per data region:

| State | Visible content | Motion / announcement |
|---|---|---|
| Initial pending, no data | Stable header/controls; reserved region; skeleton after 120 ms if still pending | One concise loading status; bones hidden from accessibility tree |
| Ready | Real values and content | Optional one-time entrance |
| Successful empty result | Specific empty message and relevant action | No skeleton or fabricated zero series |
| Refreshing with prior data | Previous content plus local Refreshing cue | Keep scroll/focus; no full skeleton replacement |
| Error without data | Clear error and retry in reserved section | Stop shimmer; do not render default zero totals as successful data |
| Error with prior data | Prior data marked as stale with retry | Stop refresh indicator; keep filter/data relationship explicit |
| Unauthorized | Existing API login redirect | No indefinite spinner or misleading saved state |
| Mutation submitting | Form values retained, one request, Save disabled | Local Saving indicator, not full-page loading |
| Mutation failed/saved | Error with inputs retained, or accepted result plus refresh | Announce the result once |

The 120 ms threshold suppresses skeleton flashes for fast requests. Cancel its timer if
the request settles; never delay a successful response to meet a minimum skeleton dwell.
Use `aria-busy` on the updating region, `aria-hidden` on decorative bones, and a concise
polite status outside the busy content if it needs to be announced while pending.
Keep labels and retry controls available. Avoid one live region per bone or row.

### Geometry by surface

| Destination | Required placeholder shape |
|---|---|
| Page header | Render the real title, Back, and divider immediately. For Quota's unknown period, reserve one heading line under the title. |
| Balance / Remaining | Same `Figure` gutters, 34% label column, colon, gap, baseline, and heading line-height; skeleton only the value. |
| Cash Flow | Same `Card` width and `aspect-ratio: 847 / 546`; keep selector/toggle area present. Neutral plot-area bones, no fake financial trend. |
| Subscriptions | Same `aspect-ratio: 866 / 529`; preserve toggle space and chart padding. Use neutral plot placeholders without plausible prices/names. |
| Savings | Same `aspect-ratio: 847 / 496`; reserve left value-label area, two bar slots, gap label region, and bottom labels. Hide fake amounts. |
| Quota | Track `mx-85 h-67 rounded-card`, matching text slots and next-week helper line; no green fill before data. |
| Transaction table | Real header and existing column `fr` ratios; four small rows at 28 px minimum; same gaps, rules, `px-18`, `pr-12`, and bottom inset. |
| Subscriptions / expenses table | Real four-column header and the matching column ratios; three body rows at 32 px minimum. |
| Savings table | Real four-column header and four small rows at 28 px minimum; preserve Period/Date/Amount/Description proportions. |
| Options inside sheet | Keep field labels and field-size select shells; indicate options are loading and disable dependent selection/submit until valid. |
| Hub account footer | One small line reserved if loading is shown; tile navigation itself does not depend on the user-label fetch. |
| Login configuration | Keep action footprint; expose checking/config-error/available/unavailable states so a broken config request cannot look ready. |

The chart aspect ratios apply to the full wrapper, including HTML label space. Reuse
the exact table and figure geometry rather than approximating it in a route-level
`loading.tsx`. A route fallback alone will not cover these client-side `useApi` requests.

When the final row count is unknown, skeletons cannot predict it. Reserve the configured
visible row area across pending and ready states if avoiding a height change is required;
apply that policy to both real and skeleton tables. If changing that baseline density is
undesirable, accept and document a single resize for short/empty results. Do not promise
zero layout shift from placeholder matching alone.

Bones use the existing panel/track palette and shared radius, with lower contrast than
real text. Use one shimmer phase for a section. Stop animation when hidden or settled;
under reduced motion, keep static bones. Errors replace bones with readable messages.

## 6. Custom dropdown specification

Shipped on 31 Oct 2026 as `components/Select.tsx` for Group by, Category, Account and
the Meeting hour, duration and time-zone pickers. The contract below is the reference;
the shipped slide is a clip-path reveal rather than only a 4 px move.

Start with Group by as a short select-only combobox. Use an existing proven accessible
primitive if the project later adopts one, or implement and test the full
[WAI-ARIA combobox pattern](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/).
Keep native selects as the fallback until that contract is complete.

Proposed visual contract:

- Trigger: existing card background, serif small/body label, shared radius; a larger
  pointer target independent of the design-unit scale; visible green focus ring.
- Popup: card surface, line border, card radius, modest overlay shadow; at least trigger
  width; 6 CSS px offset; maximum height `min(240px, 40dvh)` with thin internal scrolling.
- Options: 36–44 CSS px rows; active option has panel tint; selected option has green text
  and a check; distinguish hover, keyboard-active, selected, disabled, and loading states.
- Popover anchor: prefer below; flip above near the viewport edge; stay inside the 480 px
  column and viewport with an 8 CSS px safety inset. Use a portal if clipping demands it.
- Layering proposal: current sheet/backdrop remains z-50; a select opened inside it may
  use z-60, owned by that modal. A page select must never sit above a later modal.

Keyboard/focus behavior: a visible accessible label; expanded state and popup association;
arrow navigation; Home/End; typeahead; Enter/Space selection; Escape cancellation; Tab
leaves without a trap. Keep selected value separate from the currently explored option
until commitment. Announce selection without reading every animation frame. A click
outside closes and follows the expected focus destination. When inside a sheet, the
popover's focus behavior must cooperate with the modal's focus boundary.

The 180 ms fade/4 px slide is decorative. Open state and keyboard handling take effect
immediately. Exit content stays mounted only for its 120 ms fade and must stop accepting
input. For touch, use the same accessible control or retain native selection where tested
better; do not require hover, precision scrolling, or drag gestures. Searchable Category
or Account is a separate future editable-combobox variant, not a free text field that
silently submits an unknown option.

## 7. Overlay and asynchronous lifecycle

The current `{adding ? <AddTransactionSheet ... /> : null}` unmounts immediately. Exit
motion needs explicit presence states: closed → opening → open → closing → closed.
Keep the modal mounted until closing finishes; apply inertness, scroll lock, and focus
containment for its entire visible lifetime, then restore focus to the Add trigger.
Provide an immediate cleanup path when motion is disabled or the component unmounts.
Do not rely solely on `transitionend` to restore the page.

Rapid close/reopen must cancel an old exit, not remove a newly opened sheet. Escape,
Cancel, backdrop, route change, and success must use the same close lifecycle. A shorter
Income form should not unexpectedly scroll the title out of view. Handle the software
keyboard and safe-area bottom inset before adding drag-to-dismiss; the handle currently
does not implement dragging.

While saving, prevent repeat submissions, including the duplicate-override action. Decide
one consistent dismissal policy. Recommended here: hold Cancel, Escape, and backdrop
close while the save is pending, show Saving, and release them on failure. Do not add an
unrequested browser confirmation. Always distinguish API acceptance, refresh completion,
and external synchronization. A chart animation is never evidence that sync completed.

Implement the GET lifecycle before visual refresh: reset pending state when a request
starts; retain prior data deliberately; expose initial loading versus refreshing;
associate results with their request/filter key; cancel or ignore obsolete responses;
and expose retry. On a failed new filter request, identify old content as stale instead
of presenting it as the newly selected filter's result.

## 8. Reduced motion, performance, and dependencies

Respect [`prefers-reduced-motion`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion)
in CSS and in any JavaScript/SVG animation code. React to preference changes during the
session. Set final content, progress, and overlay state immediately; disable movement,
shimmer, path drawing, and decorative spins. Do not hide content by making the default
opacity zero outside the no-preference branch.

Use CSS transitions/keyframes first for opacity/transform/color and small indicators;
the current app has no motion dependency. Use a small shared presence helper for sheets
and fading regions. Introduce a library only when tested lifecycle/layout requirements
justify it; document its dependency cost and reduced-motion behavior then.

Prefer transform and opacity. Do not use `transition: all`, broad SVG path transitions,
large blur/backdrop filters, or permanent `will-change` on every card. Chart geometry,
clip paths, width, and measured-height transitions need profiling because they can cost
more than compositor-only effects. Avoid per-frame React state updates across an entire
page; isolate animation state and cancel timers/frames on unmount, replacement, and
preference change. Pause nonessential loops in hidden pages/regions.

Validate on a throttled mobile profile. The design target is responsive input during
motion and no repeating layout work from hover/skeletons. Profile actual frames before
claiming a frame-rate or layout-shift improvement. Keep chart value labels readable and
controls operable even when animation falls back or JavaScript is delayed.

## 9. Implementation order and acceptance

| Phase | Proposed scope | Files/components affected | Exit criteria |
|---|---|---|---|
| P0: state and access | Request lifecycle, retry/stale states, focus targets, toggle semantics, modal focus/busy policy, truthful chart edge cases | `useApi.ts`, `ui.tsx`, `DataTable.tsx`, `AddTransactionSheet.tsx`, screens, `Charts.tsx` | Keyboard and data-state contracts work with motion disabled |
| P1: feedback and loading | Shared motion tokens, buttons/tiles, layout-matched skeletons, save/error/confirmation feedback | `globals.css`, proposed button/skeleton primitives, screens | Fast requests avoid flashing; failures stop loading; targets/focus remain stable |
| P2: charts and sheet | Controlled entrance/update, synchronized quota clipping, sheet presence/scroll/focus lifecycle | `Charts.tsx`, `ProgressBar.tsx`, sheet primitive | Zero/negative/mixed values and rapid interruptions remain correct |
| P3: richer controls | Accessible custom dropdown, optional page entry and selected-pill movement | Proposed Select, `Toggle`, route/screen wrapper | Full keyboard/touch contract; no duplicate page/card cascades |
| Later, if useful | Detail tooltips, row transitions for edit/delete, optional swipe sheet | Future feature components | Real actions and accessible alternatives exist first |

Recommended checks for implementation changes:

1. Resolve initial, delayed, empty, failed, stale, unauthorized, and retry states with
   synthetic responses; no API writes are needed for visual verification.
2. Toggle quickly during slow requests; close/reopen overlays during exit; navigate away
   during pending work. Confirm the latest request/intent wins and cleanup completes.
3. Verify complete keyboard flows, focus restoration, error associations, and screen-reader
   announcements. Include combobox escape/selection behavior inside the sheet.
4. Check reduced motion at startup and after changing the preference; no invisible content,
   stuck overlays, endless skeletons, or progress labels misaligned with fill.
5. Review 320/390/480/1440 px, text zoom, touch, short viewport, and software keyboard;
   use long names, large/negative money, many subscriptions, one point, and empty lists.
6. Profile chart updates/skeletons and verify final DOM/data state in focused tests. Test
   meaningful lifecycle failures rather than asserting every CSS timing constant.
7. Run the repository checks and follow commit/push/CI workflow in `CLAUDE.md`.
