"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  addDays,
  dateKey,
  dayLabel,
  MEETING_PATH,
  meetingApi,
  MeetingError,
  ZONES,
  type Poll,
  type PollConfig,
  type PollSummary,
} from "@/lib/meeting";
import { Icon } from "./Icon";

function defaults(): PollConfig {
  const today = dateKey(new Date());
  return {
    title: "",
    description: "",
    timezone: "Asia/Jakarta",
    dates: [1, 2, 3].map((n) => addDays(today, n)),
    startHour: 9,
    endHour: 17,
    duration: 60,
  };
}

export function CreatePoll() {
  const router = useRouter();
  const [form, setForm] = useState(defaults);
  const [monthOffset, setMonthOffset] = useState(0);
  const [auth, setAuth] = useState<"loading" | "guest" | "owner">("loading");
  const [polls, setPolls] = useState<PollSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [listError, setListError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      await Promise.resolve();
      if (!active) return;
      try {
        const draft = sessionStorage.getItem("meeting:create-draft");
        if (draft) {
          const saved = JSON.parse(draft);
          if (saved.title !== undefined && Array.isArray(saved.dates)) {
            const today = dateKey(new Date(), saved.timezone || "Asia/Jakarta");
            setForm({
              ...defaults(),
              ...saved,
              dates: saved.dates.filter(
                (d: string) => d >= today && d <= addDays(today, 90),
              ),
            });
          }
          sessionStorage.removeItem("meeting:create-draft");
        }
      } catch {
        /* The form remains usable when browser storage is unavailable. */
      }
      try {
        await meetingApi("/auth/me");
        if (!active) return;
        setAuth("owner");
      } catch (err) {
        if (!active) return;
        if (err instanceof MeetingError && err.status === 401) setAuth("guest");
        else {
          setAuth("guest");
          setListError(
            "Workspace belum terhubung. Kamu tetap bisa mencoba demo.",
          );
        }
        return;
      }
      try {
        const data = await meetingApi<PollSummary[]>("/meeting/polls");
        if (active) setPolls(data);
      } catch {
        if (active)
          setListError(
            "Daftar poll belum bisa dimuat. Kamu tetap bisa membuat poll baru.",
          );
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  const today = dateKey(new Date(), form.timezone);
  const first = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  first.setUTCMonth(first.getUTCMonth() + monthOffset);
  const month = first.toISOString().slice(0, 7);
  const monthName = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(first);
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  function field<K extends keyof PollConfig>(key: K, value: PollConfig[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setError("");
  }
  function toggleDate(day: string) {
    field(
      "dates",
      form.dates.includes(day)
        ? form.dates.filter((d) => d !== day)
        : [...form.dates, day].sort(),
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (form.dates.length === 0) {
      setError("Pilih minimal satu tanggal untuk meeting ini.");
      return;
    }
    if (
      form.endHour <= form.startHour ||
      form.duration > (form.endHour - form.startHour) * 60
    ) {
      setError("Rentang jam harus cukup untuk durasi meeting yang dipilih.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const poll = await meetingApi<Poll>("/meeting/polls", {
        method: "POST",
        body: JSON.stringify(form),
      });
      router.push(`${MEETING_PATH}/${poll.id}`);
    } catch (err) {
      if (err instanceof MeetingError && err.status === 401) setAuth("guest");
      setError(
        err instanceof Error ? err.message : "Poll belum berhasil dibuat.",
      );
      setBusy(false);
    }
  }
  function rememberDraft() {
    try {
      sessionStorage.setItem("meeting:create-draft", JSON.stringify(form));
    } catch {
      /* Sign-in still works without a saved draft. */
    }
  }

  return (
    <>
      <section className="m-hero">
        <div>
          <span className="m-eyebrow">
            <span className="m-live-dot" /> LESS BACK-AND-FORTH. MORE TOGETHER.
          </span>
          <h1>
            Find a time.
            <br />
            <span>Make it happen.</span>
          </h1>
          <p>
            Satu link untuk semua jadwal. Temukan waktu yang pas
            <br className="m-desktop-break" /> tanpa chat panjang, tanpa
            tebak-tebakan.
          </p>
        </div>
        <div className="m-hero-aside">
          <div className="m-avatar-stack">
            {["NP", "RP", "DA", "AS"].map((p, i) => (
              <span className={`m-avatar m-avatar-${i}`} key={p}>
                {p}
              </span>
            ))}
            <span className="m-avatar m-avatar-plus">
              <Icon name="plus" size={15} />
            </span>
          </div>
          <p>
            Different schedules.
            <br />
            <strong>One shared moment.</strong>
          </p>
          <span className="m-hero-doodle" aria-hidden="true">
            ↙
          </span>
        </div>
      </section>

      <div className="m-create-layout">
        <section
          className="m-card m-create-card"
          aria-labelledby="create-title"
        >
          <div className="m-card-heading">
            <span className="m-icon-tile">
              <Icon name="calendar" size={20} />
            </span>
            <div>
              <h2 id="create-title">Create an availability poll</h2>
              <p>Mulai dari rencana kecilmu.</p>
            </div>
            <span className="m-badge m-badge-neutral">NEW POLL</span>
          </div>
          <form onSubmit={submit}>
            <div className="m-form-section">
              <label className="m-label" htmlFor="poll-title">
                <span className="m-step">1</span> What’s the occasion?
              </label>
              <input
                id="poll-title"
                className="m-input m-title-input"
                placeholder="e.g. Product sync, coffee catch-up…"
                value={form.title}
                onChange={(e) => field("title", e.target.value)}
                required
                maxLength={100}
                disabled={busy}
              />
              <textarea
                className="m-input m-description-input"
                aria-label="Meeting description"
                placeholder="Tambahkan konteks atau agenda (opsional)"
                value={form.description}
                onChange={(e) => field("description", e.target.value)}
                maxLength={1000}
                rows={2}
                disabled={busy}
              />
            </div>
            <div className="m-form-section">
              <div className="m-section-row">
                <label className="m-label">
                  <span className="m-step">2</span> Pick a few possible dates
                </label>
                <span className="m-small-muted">
                  {form.dates.length}/14 selected
                </span>
              </div>
              <div className="m-date-picker">
                <div className="m-calendar-nav">
                  <strong>{monthName}</strong>
                  <div>
                    <button
                      type="button"
                      className="m-icon-button"
                      aria-label="Previous month"
                      disabled={monthOffset === 0 || busy}
                      onClick={() => setMonthOffset((v) => v - 1)}
                    >
                      <Icon name="back" size={17} />
                    </button>
                    <button
                      type="button"
                      className="m-icon-button"
                      aria-label="Next month"
                      disabled={month >= addDays(today, 90).slice(0, 7) || busy}
                      onClick={() => setMonthOffset((v) => v + 1)}
                    >
                      <Icon
                        name="back"
                        size={17}
                        style={{ transform: "rotate(180deg)" }}
                      />
                    </button>
                  </div>
                </div>
                <div className="m-month-grid">
                  {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
                    <span className="m-weekday" key={d}>
                      {d}
                    </span>
                  ))}
                  {Array.from({ length: offset }, (_, i) => (
                    <span key={`empty-${i}`} />
                  ))}
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = `${month}-${String(i + 1).padStart(2, "0")}`,
                      selected = form.dates.includes(day);
                    return (
                      <button
                        key={day}
                        className={`m-date ${selected ? "m-date-selected" : ""} ${day === today ? "m-date-today" : ""}`}
                        type="button"
                        aria-label={dayLabel(day, {
                          weekday: "long",
                          year: "numeric",
                          month: "long",
                        })}
                        aria-pressed={selected}
                        disabled={
                          busy ||
                          day < today ||
                          day > addDays(today, 90) ||
                          (!selected && form.dates.length >= 14)
                        }
                        onClick={() => toggleDate(day)}
                      >
                        {i + 1}
                        {selected && <span className="m-date-dot" />}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="m-selected-dates" aria-live="polite">
                {form.dates.length ? (
                  form.dates.map((day) => (
                    <button
                      type="button"
                      key={day}
                      disabled={busy}
                      onClick={() => toggleDate(day)}
                      aria-label={`Remove ${dayLabel(day)}`}
                    >
                      {dayLabel(day)}
                      <Icon name="close" size={12} />
                    </button>
                  ))
                ) : (
                  <span className="m-small-muted">
                    Pilih tanggal di kalender. Tidak harus berurutan.
                  </span>
                )}
              </div>
            </div>
            <div className="m-form-section">
              <label className="m-label">
                <span className="m-step">3</span> Set the time window
              </label>
              <div className="m-time-fields">
                <label>
                  From
                  <select
                    className="m-input"
                    value={form.startHour}
                    onChange={(e) => field("startHour", Number(e.target.value))}
                    disabled={busy}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>
                <span className="m-time-separator">—</span>
                <label>
                  To
                  <select
                    className="m-input"
                    value={form.endHour}
                    onChange={(e) => field("endHour", Number(e.target.value))}
                    disabled={busy}
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h + 1} value={h + 1}>
                        {String(h + 1).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>
                <label className="m-duration-field">
                  Meeting duration
                  <select
                    className="m-input"
                    value={form.duration}
                    onChange={(e) => field("duration", Number(e.target.value))}
                    disabled={busy}
                  >
                    {[15, 30, 45, 60, 90, 120, 180, 240].map((n) => (
                      <option key={n} value={n}>
                        {n} minutes
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="m-zone-field">
                <Icon name="globe" size={16} />
                <span>Time zone</span>
                <select
                  aria-label="Poll time zone"
                  value={form.timezone}
                  disabled={busy}
                  onChange={(e) => {
                    const zone = e.target.value,
                      now = dateKey(new Date(), zone);
                    setForm((f) => ({
                      ...f,
                      timezone: zone,
                      dates: f.dates.filter(
                        (day) => day >= now && day <= addDays(now, 90),
                      ),
                    }));
                  }}
                >
                  {ZONES.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {error && (
              <p className="m-alert m-alert-error" role="alert">
                {error}
              </p>
            )}
            <div className="m-create-action">
              {auth === "guest" ? (
                <>
                  <Link
                    className="m-button m-button-primary m-button-full"
                    href={`/login?next=${encodeURIComponent(MEETING_PATH)}`}
                    onClick={rememberDraft}
                  >
                    Sign in to create a poll <Icon name="arrow" size={17} />
                  </Link>
                  <p>
                    Hanya penyelenggara perlu masuk. Peserta cukup buka link.
                  </p>
                </>
              ) : (
                <>
                  <button
                    className="m-button m-button-primary m-button-full"
                    type="submit"
                    disabled={busy || auth === "loading"}
                    aria-busy={busy}
                  >
                    {busy
                      ? "Creating your poll…"
                      : auth === "loading"
                        ? "Connecting workspace…"
                        : "Create poll & get a link"}
                    <Icon name="arrow" size={17} />
                  </button>
                  <p>
                    <Icon name="check" size={13} /> Peserta bisa mengisi tanpa
                    akun.
                  </p>
                </>
              )}
            </div>
          </form>
        </section>

        <aside className="m-create-aside">
          <div className="m-preview-card">
            <div className="m-section-row">
              <span className="m-eyebrow">A GLIMPSE OF WHAT’S NEXT</span>
              <Icon name="sparkle" size={19} />
            </div>
            <div className="m-preview-window">
              <div className="m-preview-top">
                <span />
                <span />
                <span />
                <small>your shared availability</small>
              </div>
              <div className="m-preview-body">
                <h3>{form.title || "A good time, for everyone."}</h3>
                <p>
                  {form.dates.length || "A few"} possible dates ·{" "}
                  {form.duration} min together
                </p>
                <div className="m-mini-heatmap" aria-hidden="true">
                  <div className="m-mini-labels">
                    <span>09:00</span>
                    <span>10:00</span>
                    <span>11:00</span>
                    <span>12:00</span>
                    <span>13:00</span>
                    <span>14:00</span>
                  </div>
                  {Array.from(
                    { length: Math.min(form.dates.length || 5, 7) },
                    (_, col) => (
                      <div className="m-mini-day" key={col}>
                        <span>
                          {form.dates[col]
                            ? dayLabel(form.dates[col], {
                                month: undefined,
                                weekday: "short",
                              })
                            : ["Mon", "Tue", "Wed", "Thu", "Fri"][col]}
                        </span>
                        {Array.from({ length: 12 }, (_, row) => (
                          <i
                            key={row}
                            className={`m-heat-${col === 1 && row >= 2 && row <= 5 ? 5 : (row * 3 + col * 2 + Math.floor(row / 3)) % 5}`}
                          />
                        ))}
                      </div>
                    ),
                  )}
                </div>
                <div className="m-mini-match">
                  <span className="m-icon-tile">
                    <Icon name="check" size={17} />
                  </span>
                  <div>
                    <strong>Your best time, at a glance</strong>
                    <p>Warna makin pekat, makin banyak yang bisa.</p>
                  </div>
                </div>
              </div>
            </div>
            <p className="m-preview-caption">
              Ilustrasi heatmap. Jadwal asli muncul setelah peserta mengisi.
            </p>
          </div>
          <div className="m-how-card">
            <h3>
              Less coordinating.
              <br />
              More connecting.
            </h3>
            {[
              [
                "link",
                "One link brings everyone in",
                "Bagikan ke grup, teman, atau timmu.",
              ],
              [
                "grid",
                "A few swipes say it all",
                "Masing-masing tandai waktu luangnya.",
              ],
              [
                "sparkle",
                "The overlap does the talking",
                "Pilih waktu dengan kecocokan terbaik.",
              ],
            ].map(([icon, title, text], i) => (
              <div className="m-how-step" key={title}>
                <span className="m-how-number">0{i + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
                <Icon name={icon} size={18} />
              </div>
            ))}
            <Link href={`${MEETING_PATH}/demo`} className="m-text-link">
              Take a look around the demo <Icon name="arrow" size={16} />
            </Link>
          </div>
        </aside>
      </div>

      {listError && (
        <p className="m-alert" role="status">
          {listError}
        </p>
      )}
      {auth === "owner" && (
        <section className="m-polls-section">
          <div className="m-section-row">
            <div>
              <span className="m-eyebrow">YOUR WORKSPACE</span>
              <h2>Recently planned</h2>
            </div>
            <span className="m-small-muted">{polls.length} polls</span>
          </div>
          {polls.length ? (
            <div className="m-poll-list">
              {polls.map((poll) => (
                <Link
                  key={poll.id}
                  href={`${MEETING_PATH}/${poll.id}`}
                  className="m-poll-list-item"
                >
                  <span className="m-icon-tile">
                    <Icon name="calendar" />
                  </span>
                  <div>
                    <h3>{poll.title}</h3>
                    <p>
                      {poll.dates.length} dates · {poll.duration} min ·{" "}
                      {poll.participantCount} responses
                    </p>
                  </div>
                  <span
                    className={`m-badge ${poll.finalizedStart ? "m-badge-green" : "m-badge-neutral"}`}
                  >
                    {poll.finalizedStart ? "Confirmed" : "Collecting"}
                  </span>
                  <Icon name="arrow" size={17} />
                </Link>
              ))}
            </div>
          ) : (
            <div className="m-empty-workspace">
              <Icon name="calendar" size={25} />
              <p>
                Rencana pertamamu dimulai di atas.
                <br />
                <span>Buat poll, bagikan link, dan temukan waktunya.</span>
              </p>
            </div>
          )}
        </section>
      )}
    </>
  );
}
