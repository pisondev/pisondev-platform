export const MEETING_PATH = "/meeting/availability";
export const ZONES = [
  ["Asia/Jakarta", "Jakarta · WIB"],
  ["Asia/Makassar", "Makassar · WITA"],
  ["Asia/Jayapura", "Jayapura · WIT"],
  ["Asia/Singapore", "Singapore"],
  ["Asia/Tokyo", "Tokyo"],
  ["Australia/Sydney", "Sydney"],
  ["Europe/London", "London"],
  ["Europe/Berlin", "Berlin"],
  ["America/New_York", "New York"],
  ["America/Los_Angeles", "Los Angeles"],
  ["UTC", "UTC"],
];

export type PollConfig = {
  title: string;
  description: string;
  timezone: string;
  dates: string[];
  startHour: number;
  endHour: number;
  duration: number;
};
export type Participant = {
  id: string;
  name: string;
  slots: string[];
  version: number;
};
export type Recommendation = {
  start: string;
  count: number;
  participantIds: string[];
};
export type Poll = PollConfig & {
  id: string;
  slots: string[];
  participants: Participant[];
  recommendations: Recommendation[];
  finalizedStart: string | null;
  createdAt: string;
};
export type Identity = { id: string; key: string };
export type PollSummary = Pick<
  Poll,
  "id" | "title" | "dates" | "duration" | "finalizedStart" | "createdAt"
> & { participantCount: number };
export type SavedResponse = { participant: Participant; editToken?: string };

export class MeetingError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// Public invitation pages must never redirect guests to the private sign-in flow.
export async function meetingApi<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.error)
    throw new MeetingError(
      response.status,
      body?.error?.code ?? "unavailable",
      body?.error?.message ?? "Server belum merespons. Coba lagi sebentar.",
    );
  return body.data as T;
}

export function dateKey(date: Date, timezone = "Asia/Jakarta") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function addDays(day: string, count: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + count);
  return d.toISOString().slice(0, 10);
}
export function dayLabel(day: string, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    ...options,
    timeZone: "UTC",
  }).format(new Date(`${day}T12:00:00Z`));
}
export function timeLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}
export function slotLabel(iso: string, timezone: string, duration = 15) {
  const start = new Date(iso),
    end = new Date(start.getTime() + duration * 60000);
  return `${new Intl.DateTimeFormat("id-ID", { timeZone: timezone, weekday: "short", day: "numeric", month: "short" }).format(start)} · ${timeLabel(iso, timezone)}–${timeLabel(end.toISOString(), timezone)}`;
}
export function zoneLabel(iso: string, timezone: string) {
  return (
    new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      timeZoneName: "shortOffset",
    })
      .formatToParts(new Date(iso))
      .find((p) => p.type === "timeZoneName")?.value ?? timezone
  );
}
export function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => Array.from(p)[0])
    .join("")
    .toUpperCase();
}
export function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60),
    remaining = minutes % 60;
  return (
    [hours ? `${hours}h` : "", remaining ? `${remaining}m` : ""]
      .filter(Boolean)
      .join(" ") || "0m"
  );
}

export function readIdentity(id: string): Identity | null {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`meeting:identity:${id}`) ?? "null",
    );
    return typeof saved?.id === "string" && saved?.key ? saved : null;
  } catch {
    return null;
  }
}
export function saveIdentity(id: string, value: Identity) {
  // Verify persistence before a guest submits; their edit key must survive a reload.
  const key = `meeting:identity:${id}`;
  localStorage.setItem(key, JSON.stringify(value));
  if (localStorage.getItem(key) !== JSON.stringify(value))
    throw new Error(
      "Aktifkan penyimpanan browser agar jawabanmu bisa diedit kembali.",
    );
}

export type GridDay = { key: string; cells: Map<string, string> };
export function makeGrid(
  slots: string[],
  timezone: string,
): { days: GridDay[]; rows: string[] } {
  const days = new Map<string, GridDay>();
  const rows = new Set<string>();
  for (const slot of slots) {
    const key = dateKey(new Date(slot), timezone);
    if (!days.has(key)) days.set(key, { key, cells: new Map() });
    const day = days.get(key)!;
    let row = timeLabel(slot, timezone);
    // Repeated local times stay separate, with the UTC offset in the cell label.
    if (day.cells.has(row)) row += "~2";
    day.cells.set(row, slot);
    rows.add(row);
  }
  return {
    days: [...days.values()].sort((a, b) => a.key.localeCompare(b.key)),
    // On a fall-back transition, show the whole first hour before its repeat.
    rows: [...rows].sort((a, b) => {
      const order = (row: string) => {
        const [hour, minute] = row.slice(0, 5).split(":").map(Number);
        return hour * 120 + (row.endsWith("~2") ? 60 : 0) + minute;
      };
      return order(a) - order(b);
    }),
  };
}

export function bestTimes(
  recommendations: Recommendation[],
  duration: number,
  limit = 4,
) {
  const selected: Recommendation[] = [];
  for (const rec of recommendations) {
    if (
      selected.every(
        (s) =>
          Math.abs(Date.parse(s.start) - Date.parse(rec.start)) >=
          duration * 60000,
      )
    )
      selected.push(rec);
    if (selected.length === limit) break;
  }
  return selected;
}

export function rankSlots(
  slots: string[],
  participants: Participant[],
  duration: number,
): Recommendation[] {
  const allowed = new Set(slots);
  const sets = participants.map((p) => new Set(p.slots));
  return slots
    .flatMap((start) => {
      if (Date.parse(start) < Date.now()) return [];
      const window = Array.from({ length: duration / 15 }, (_, i) =>
        new Date(Date.parse(start) + i * 900000)
          .toISOString()
          .replace(".000Z", "Z"),
      );
      if (!window.every((s) => allowed.has(s))) return [];
      const participantIds = participants
        .filter((_, i) => window.every((s) => sets[i].has(s)))
        .map((p) => p.id);
      return participantIds.length
        ? [{ start, count: participantIds.length, participantIds }]
        : [];
    })
    .sort((a, b) => b.count - a.count || a.start.localeCompare(b.start));
}

export function demoPoll(): Poll {
  const today = dateKey(new Date());
  const monday = addDays(
    today,
    (8 - new Date(`${today}T12:00:00Z`).getUTCDay()) % 7 || 7,
  );
  const dates = Array.from({ length: 5 }, (_, i) => addDays(monday, i));
  const slots = dates
    .flatMap((day) =>
      Array.from(
        { length: 32 },
        (_, n) => new Date(`${day}T02:00:00Z`).getTime() + n * 900000,
      ),
    )
    .map((t) => new Date(t).toISOString().replace(".000Z", "Z"));
  const names = [
    "Nadia Putri",
    "Raka Pratama",
    "Dimas Arya",
    "Alya Safira",
    "Kevin Wijaya",
  ];
  const participants = names.map((name, person) => ({
    id: `demo-${person}`,
    name,
    version: 1,
    slots: slots.filter((_, i) => {
      const day = Math.floor(i / 32),
        hour = (i % 32) / 4 + 9;
      if (day === 1 && hour >= 10 && hour < 12) return true;
      return hour < 12
        ? (day + person) % 3 !== 0 && hour >= 9 + (person % 2)
        : hour >= 13 + ((day + person) % 3) && hour < 16.5;
    }),
  }));
  return {
    id: "demo",
    title: "Product & design catch-up",
    description:
      "Let's find a little time to share ideas, review progress, and plan what’s next.",
    timezone: "Asia/Jakarta",
    dates,
    startHour: 9,
    endHour: 17,
    duration: 60,
    slots,
    participants,
    recommendations: rankSlots(slots, participants, 60),
    finalizedStart: null,
    createdAt: new Date().toISOString(),
  };
}

function escapeICS(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}
function foldICS(line: string) {
  const lines: string[] = [];
  let current = "",
    bytes = 0;
  for (const char of line) {
    const length = new TextEncoder().encode(char).length;
    if (bytes + length > 75) {
      lines.push(current);
      current = " ";
      bytes = 1;
    }
    current += char;
    bytes += length;
  }
  lines.push(current);
  return lines.join("\r\n");
}
export function calendarFile(poll: Poll) {
  if (!poll.finalizedStart) return;
  const stamp = (date: Date) =>
    date
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//pisondev//Meeting//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${poll.id}@meeting.pisondev.com`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(new Date(poll.finalizedStart))}`,
    `DTEND:${stamp(new Date(Date.parse(poll.finalizedStart) + poll.duration * 60000))}`,
    `SUMMARY:${escapeICS(poll.title)}`,
    `DESCRIPTION:${escapeICS(poll.description)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const url = URL.createObjectURL(
    new Blob([lines.map(foldICS).join("\r\n") + "\r\n"], {
      type: "text/calendar;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "meeting.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
