// Display formats used across the finance screens.

const thousands = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 });

/** 87000 -> "Rp87.000", -15000 -> "-Rp15.000". */
export function rupiah(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  const abs = thousands.format(Math.abs(n));
  return n < 0 ? `-Rp${abs}` : `Rp${abs}`;
}

/** Always shows the sign: "+Rp15.000" or "-Rp15.000". */
export function signedRupiah(n: number): string {
  return n < 0 ? rupiah(n) : `+${rupiah(n)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(date: string) {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

/** "2026-10-16" -> "Oct 16". */
export function shortDate(date: string | null | undefined): string {
  if (!date) return "";
  const { m, d } = parts(date);
  return `${MONTHS[m - 1]} ${d}`;
}

/** "Oct 12 - 18", or "Sep 29 - Oct 5" across months, or "Oct 12 -" when open. */
export function dateRange(start?: string, end?: string): string {
  if (!start) return "";
  const s = parts(start);
  if (!end) return `${MONTHS[s.m - 1]} ${s.d} -`;
  const e = parts(end);
  if (s.y === e.y && s.m === e.m) return `${MONTHS[s.m - 1]} ${s.d} - ${e.d}`;
  return `${MONTHS[s.m - 1]} ${s.d} - ${MONTHS[e.m - 1]} ${e.d}`;
}

/** Current WIB wall time as "YYYY-MM-DD HH:mm", for new transactions. */
export function nowWIB(): string {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jakarta",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}
