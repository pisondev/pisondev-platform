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
import { Select } from "../Select";
import { Icon } from "./Icon";

const HOURS = Array.from({ length: 25 }, (_, h) => ({
  value: h,
  label: `${String(h).padStart(2, "0")}:00`,
}));
const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240].map((n) => ({
  value: n,
  label: `${n} menit`,
}));

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
  const monthName = new Intl.DateTimeFormat("id-ID", {
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
          <h1>Tentukan waktu meeting.</h1>
          <p>Pilih tanggal, bagikan link, dan lihat kapan semua bisa.</p>
        </div>
        <Link href={`${MEETING_PATH}/demo`} className="m-button m-button-secondary">
          Lihat contoh <Icon name="arrow" size={16} />
        </Link>
      </section>

      <div className="m-create-layout">
        <section
          className="m-card m-create-card"
          aria-label="Buat poll meeting"
        >
          <form onSubmit={submit}>
            <div className="m-form-section">
              <label className="m-label" htmlFor="poll-title">Nama meeting</label>
              <input
                id="poll-title"
                className="m-input m-title-input"
                placeholder="Misalnya, Review desain mingguan"
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
                <div className="m-label">
                  Pilihan tanggal
                </div>
                <span className="m-small-muted">
                  {form.dates.length}/14 dipilih
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
                  {["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"].map((d) => (
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
              <div className="m-label">
                Jam dan durasi
              </div>
              <div className="m-time-fields">
                <label>
                  Mulai
                  <Select
                    tone="meeting"
                    aria-label="From"
                    className="m-input"
                    value={form.startHour}
                    onChange={(v) => field("startHour", v)}
                    disabled={busy}
                    options={HOURS.slice(0, 24)}
                  />
                </label>
                <span className="m-time-separator">—</span>
                <label>
                  Sampai
                  <Select
                    tone="meeting"
                    aria-label="To"
                    className="m-input"
                    value={form.endHour}
                    onChange={(v) => field("endHour", v)}
                    disabled={busy}
                    options={HOURS.slice(1)}
                  />
                </label>
                <label className="m-duration-field">
                  Durasi meeting
                  <Select
                    tone="meeting"
                    aria-label="Meeting duration"
                    className="m-input"
                    value={form.duration}
                    onChange={(v) => field("duration", v)}
                    disabled={busy}
                    options={DURATIONS}
                  />
                </label>
              </div>
              <label className="m-zone-field">
                <Icon name="globe" size={16} />
                <span>Zona waktu</span>
                <Select
                  tone="meeting"
                  aria-label="Poll time zone"
                  value={form.timezone}
                  disabled={busy}
                  options={ZONES.map(([value, label]) => ({ value, label }))}
                  onChange={(zone) => {
                    const now = dateKey(new Date(), zone);
                    setForm((f) => ({
                      ...f,
                      timezone: zone,
                      dates: f.dates.filter(
                        (day) => day >= now && day <= addDays(now, 90),
                      ),
                    }));
                  }}
                />
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
                    Masuk untuk membuat poll <Icon name="arrow" size={17} />
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
                      ? "Membuat poll..."
                      : auth === "loading"
                        ? "Menghubungkan..."
                        : "Buat poll & dapatkan link"}
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
              <span className="m-eyebrow">WORKSPACE</span>
              <h2>Meeting kamu</h2>
            </div>
            <span className="m-small-muted">{polls.length} poll</span>
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
                      {poll.dates.length} tanggal · {poll.duration} menit ·{" "}
                      {poll.participantCount} jawaban
                    </p>
                  </div>
                  <span
                    className={`m-badge ${poll.finalizedStart ? "m-badge-green" : "m-badge-neutral"}`}
                  >
                    {poll.finalizedStart ? "Dikonfirmasi" : "Menunggu jawaban"}
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
