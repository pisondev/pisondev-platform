# Meeting availability

Implemented on 27 Oct 2026 and released on the existing assistant host on 30 Oct 2026.
This first Meeting feature collects availability, compares responses, and confirms a
meeting time. It uses the existing Next.js app, Go API, and PostgreSQL. It does not
create video meeting rooms.

## Reference and product decisions

The reference is [When2meet](https://www.when2meet.com/), reviewed on 27 Oct 2026.
Its creation screen asks for an event name, possible dates, a time window, and a time
zone. Dates can be painted by dragging. It offers specific-date and weekday modes;
the site explicitly expects a shared time zone for the weekday mode.

The useful product model is a shared availability matrix: a person marks time they
can attend; the group compares overlapping responses. Our implementation uses this
model with its own interface and storage. This is a workflow analysis, not an audit
of When2meet's internal code or database.

The first release uses **specific dates only**, so every selected interval has a real
UTC instant. Weekly recurrence, calendar account connections, reminders, and automatic
Google Meet creation are outside this feature.

| Concern | Decision in Pison Meet |
|---|---|
| Planning | Guided form with a month calendar, removable date chips, duration, and preview |
| Sharing | One unguessable invitation URL; guests do not need an account |
| Editing | An opaque browser edit key identifies a response; display names do not grant access |
| Availability | Binary available/unselected intervals; an empty response means no suitable time |
| Comparison | Group heatmap, actual counts, participant filters, and a named slot inspector |
| Recommendations | Rank complete windows by the same people available throughout |
| Completion | Owner confirms a time; responses close; anyone can download the calendar file |
| Recovery | Explicit save feedback, retry states, response versions, and reopen |

## URLs and access

| URL | Access and purpose |
|---|---|
| `/meeting` | Private workspace entry, redirects to the availability feature |
| `/meeting/availability` | Public form; creating and listing polls require an allowed account |
| `/meeting/availability/demo` | Public synthetic example; changes last until page reload |
| `/meeting/availability/<id>` | Public invitation: link holders can see names and availability and add a response |

The Hub's Meeting tile is enabled. Only the availability path is exempted from the
Next.js session gate; Finance, Links, and the workspace remain private. Go authenticates
every management request. Another allowed account cannot manage someone else's poll.

The creation page renders per request so the current month and default dates are not
frozen into a build. Existing Assistant pages moved into the `(assistant)` route group
without URL changes; its 480 px serif layout remains there. Meeting has a separate
responsive layout and scoped styles.

## Scheduling rules

- Title: 1–100 characters; optional description: up to 1,000 characters.
- Select 1–14 distinct dates, from today through 90 days ahead in the poll's time zone.
- One daily window, from an integer hour through a later hour, up to 24:00.
- Fixed 15-minute intervals; duration is 15–240 minutes in 15-minute steps and must fit
  the daily window. At least one complete future window must exist at creation.
- Up to 100 participants. Names are 1–60 characters; duplicate display names are
  allowed and never grant editing rights to another response.
- Dates, duration, and the original time window are fixed after creation. Create a
  new poll if those need changing. An owner can reopen a confirmed poll.
- The owner is not added implicitly and submits availability like everyone else.

The server generates canonical RFC 3339 UTC slot keys from an IANA time zone. It walks
actual instants: skipped DST hours are absent and repeated hours remain distinct. The
client displays these instants in the viewer's selected zone. Repeated local times have
separate cells and offset labels; changing the zone never changes saved availability.
Go embeds tzdata for minimal production images.

For a 60-minute meeting, a candidate needs four consecutive 15-minute intervals. Its
attendee set is the intersection of those response sets. Counts from different people
cannot combine into a false match. Open polls exclude past starts. Candidates sort by
attendance, then start time; the UI shows up to four non-overlapping choices. Partial
attendance is explicit, including unavailable names in the confirmation dialog.
The owner chooses the time; no slot is confirmed automatically.

## Persistence and editing

Migration `00003_meeting.sql` creates the independent `meeting` schema:

- `meeting.polls`: opaque ID, validated JSON configuration, owner email, confirmation,
  and creation timestamp.
- `meeting.responses`: opaque ID, poll reference, name, canonical slot array,
  SHA-256 edit-key hash, version, and update timestamp.

Poll IDs and server-generated edit keys use 192 bits of cryptographic randomness. The
browser generates a 256-bit retry/edit key and persists it **before** sending a new
response. The unique `(poll_id, edit_hash)` index and poll-row lock make a repeated
submission return the existing response, covering a lost network reply. A retry returns
the saved answer without overwriting it; later edits use PATCH.

The browser stores `{id, key}` under `meeting:identity:<poll-id>` in local storage.
Editing requires `X-Participant-Key` and the saved version. A stale tab gets
`409 response_changed`; the UI preserves its draft and offers an explicit reload of
the saved answer. New response creation is refused locally when storage is unavailable.

Writes and finalization lock the poll row in a transaction, so an edit cannot race
through a successful confirmation. Reads use a repeatable-read snapshot. Owner lists
return summaries without recomputing every historical poll's recommendations. Public
JSON contains no owner email, edit hash, or edit key. Management checks address the
individual poll, independently of the 50-item recent list.

The invitation link is the read-access boundary. Participant names and responses are
visible to its holders. Losing local storage or switching browsers loses the editing
credential; display names cannot recover it. Cross-device recovery is not implemented.

## API

Routes use the existing `{data: ...}` / `{error: ...}` envelope under `/api/v1`.
Existing body-size, security-header, and same-origin protections apply here.

| Method and path | Access | Result |
|---|---|---|
| `GET /meeting/polls` | Signed in | Up to 50 recent summaries owned by that account |
| `POST /meeting/polls` | Signed in | Validate and create a poll |
| `GET /meeting/polls/:id` | Link holder | Configuration, slots, responses, recommendations, confirmed time |
| `GET /meeting/polls/:id/access` | Signed in | Whether that account owns the poll |
| `POST /meeting/polls/:id/responses` | Link holder | New response, or recovery with its retry key |
| `PATCH /meeting/polls/:id/responses/:participant` | Edit-key holder | Update name/slots with the expected version |
| `POST /meeting/polls/:id/finalize` | Poll owner | `{ "start": "<slot UTC key>" }` confirms; `{ "start": null }` reopens |

Real invitations never fall back to synthetic data. API failure shows an error and
retry. Responses refresh every 20 seconds while visible and on returning to the tab.
Updates preserve unsaved drafts; background requests started before a mutation are
ignored. Offline state disables save. This is periodic synchronization, not WebSockets.

Calendar export is UTF-8 `.ics` with a stable event UID, UTC start/end, escaped text,
CRLF separators, and 75-octet line folding. Downloading does not send invitations or
create events in a connected account.

## Interface and accessibility

Meeting uses warm off-white surfaces, forest actions, lime heatmap levels, system
sans-serif type, and a separate wide desktop layout. It becomes a single column on
small screens; only the calendar scrolls in two dimensions. Date headings and the time
column stay visible while scrolling.

Mouse/pen users paint rectangular ranges; starting on a selected cell erases. Touch
users tap cells while retaining calendar scrolling. The calendar has one tab stop,
arrow-key navigation, Space/Enter selection, and labels with local time and offset.
Select all and Clear selection offer shortcuts. The draft remains until Save; switching
views preserves it. Unsaved changes activate the browser unload guard.

The native modal supports Escape, focus restoration, scroll lock, and disabled dismissal
while saving. Feedback uses live regions. Motion respects reduced-motion preferences.
No additional runtime UI or date dependency was added. See [Meeting UI](../design/meeting-ui.md)
for synthetic visual references.

## Run and verify

Use the normal [local setup](setup.md). Open
`http://localhost:3100/meeting/availability/demo` to try the UI without login.
Real local polls need the API and an allowed account.

For the browser smoke test:

1. Run the API with `DATABASE_URL` pointing to `pisondev_test`, `SYNC_MODE=off`,
   `AUTH_ALLOWED_EMAILS=scheduling@example.test`, `AUTH_DEV_LOGIN=true`,
   `PUBLIC_BASE_URL=http://localhost:3100`, and `HTTP_ADDR=127.0.0.1:8100`.
   Never enable development login in production.
2. Run the web app on 3100. If Turbopack cannot start its child processes on Windows,
   use `pnpm exec next dev --webpack -p 3100`.
3. From the repository root, install the optional browser dependency:
   `npm install --prefix services/api/tmp/meeting-browser --no-save playwright`.
   Install Chromium with that package's CLI if needed, or set
   `PLAYWRIGHT_BROWSERS_PATH` / `MEETING_CHROMIUM_PATH` for an existing installation.
4. Run `node scripts/meeting-smoke.mjs`. It refuses non-local origins and requires
   development login. It retains one synthetic poll in the test database for inspection.
   Screenshots and calendar exports stay in ignored `services/api/tmp/meeting-qa`.

Verification for this implementation:

- Go unit and PostgreSQL integration suites with `TEST_DATABASE_URL` set: validation,
  IANA offsets, DST, complete duration intersections, retry keys, stale versions,
  owner/public permissions, CSRF rejection, and concurrent edit/finalization.
- TypeScript and production build with `pnpm build --webpack`.
- Chromium at 320/390/480/1440 px without page overflow; drag, keyboard, touch,
  separate guests, persistence, empty responses, time zones, stale-tab recovery,
  dialog focus, repeated DST-hour ordering and offset labels, owner confirmation, closed-poll rejection, calendar download, reopen,
  errors/retry, blocked browser storage, offline recovery, and preservation of the
  existing private Finance gate. Calendar text escaping and UTF-8 line folding are checked.

Browser verification used local Chromium after the in-app browser connection failed.
Full screen-reader, Safari, physical-device, and live OAuth testing remain unverified.

## Future domain integration

The released path is `/meeting/availability` on `assistant.pisondev.com`; it uses the
existing Google sign-in and host-only session for owner actions. Public invitations
and the demo need no sign-in. No separate Meeting DNS entry is required. For the future
`meeting.pisondev.com`, retain that path or expose `/availability` with an ingress rewrite.
The public-route gate must recognize any alias too.

Before enabling writes on a separate host, explicitly configure that origin in the
API's same-origin policy. Plan the Google callback and cross-subdomain session cookie
as part of rollout. Do not open the management API or remove the Finance gate to make
invitations work. Relative API requests and origin-derived share URLs follow the host.
