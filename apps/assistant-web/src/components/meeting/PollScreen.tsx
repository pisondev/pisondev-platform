"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  bestTimes,
  calendarFile,
  dateKey,
  dayLabel,
  demoPoll,
  durationLabel,
  initials,
  MEETING_PATH,
  meetingApi,
  MeetingError,
  rankSlots,
  readIdentity,
  saveIdentity,
  slotLabel,
  timeLabel,
  zoneLabel,
  ZONES,
  type Identity,
  type Participant,
  type Poll,
  type Recommendation,
  type SavedResponse,
} from "@/lib/meeting";
import { AvailabilityGrid } from "./AvailabilityGrid";
import { ConfirmTime } from "./ConfirmTime";
import { Icon } from "./Icon";

function subscribeOnline(update: () => void) {
  window.addEventListener("online", update);
  window.addEventListener("offline", update);
  return () => {
    window.removeEventListener("online", update);
    window.removeEventListener("offline", update);
  };
}
function onlineSnapshot() {
  return navigator.onLine;
}
function serverOnlineSnapshot() {
  return true;
}

export function PollScreen({ id }: { id: string }) {
  const isDemo = id === "demo";
  const [poll, setPoll] = useState<Poll | null>(() =>
    isDemo ? demoPoll() : null,
  );
  const [loading, setLoading] = useState(!isDemo);
  const [loadError, setLoadError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [owner, setOwner] = useState(isDemo);
  const [timezone, setTimezone] = useState("Asia/Jakarta");
  const [mode, setMode] = useState<"group" | "mine">("group");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [baseline, setBaseline] = useState<Participant | null>(null);
  const [name, setName] = useState("");
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hovered, setHovered] = useState("");
  const [focused, setFocused] = useState("");
  const [filter, setFilter] = useState("");
  const [confirm, setConfirm] = useState<Recommendation | null>(null);
  const [copyFallback, setCopyFallback] = useState("");
  const [retry, setRetry] = useState(0);
  const online = useSyncExternalStore(
    subscribeOnline,
    onlineSnapshot,
    serverOnlineSnapshot,
  );
  const generation = useRef(0);
  const mutation = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (isDemo) return;
    let active = true,
      fetching = false,
      first = true;
    const controller = new AbortController();
    async function fetchPoll() {
      if (fetching || mutation.current) return;
      fetching = true;
      const version = generation.current;
      try {
        const data = await meetingApi<Poll>(
          `/meeting/polls/${encodeURIComponent(id)}`,
          { signal: controller.signal },
        );
        if (!active || version !== generation.current) return;
        setPoll(data);
        setLoadError("");
        setSyncError("");
        if (first) {
          const saved = readIdentity(id),
            mine = data.participants.find((p) => p.id === saved?.id);
          setIdentity(saved);
          if (mine) {
            setBaseline(mine);
            setName(mine.name);
            setDraft(new Set(mine.slots));
          }
          const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
          setTimezone(detected || data.timezone);
          first = false;
        }
      } catch (err) {
        if (!active || controller.signal.aborted) return;
        if (first)
          setLoadError(
            err instanceof MeetingError && err.status === 404
              ? "Link poll ini tidak ditemukan. Periksa kembali tautan dari penyelenggara."
              : "Poll belum bisa dimuat. Periksa koneksi dan coba lagi.",
          );
        else
          setSyncError(
            "Pembaruan belum berhasil. Jadwal terakhir tetap ditampilkan; mencoba lagi secara berkala.",
          );
      } finally {
        fetching = false;
        if (active) setLoading(false);
      }
    }
    void fetchPoll();
    void meetingApi<{ canManage: boolean }>(
      `/meeting/polls/${encodeURIComponent(id)}/access`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (active) setOwner(data.canManage);
      })
      .catch(() => undefined);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void fetchPoll();
    }, 20000);
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchPoll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [id, isDemo, retry]);

  const dirty =
    name !== (baseline?.name ?? "") ||
    draft.size !== (baseline?.slots.length ?? 0) ||
    [...draft].some((slot) => !baseline?.slots.includes(slot));
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const recommendations = useMemo(
    () => bestTimes(poll?.recommendations ?? [], poll?.duration ?? 60),
    [poll?.recommendations, poll?.duration],
  );
  const savedRemote = poll?.participants.find((p) => p.id === identity?.id);
  const changedElsewhere =
    !!baseline && !!savedRemote && savedRemote.version !== baseline.version;
  const inspected = hovered || focused;
  const inspectedPeople =
    poll?.participants.filter((p) => p.slots.includes(inspected)) ?? [];

  function startEditing() {
    setMode("mine");
    setNotice("");
    setTimeout(() => nameInput.current?.focus(), 0);
  }
  function restoreSaved() {
    if (savedRemote) {
      setBaseline(savedRemote);
      setName(savedRemote.name);
      setDraft(new Set(savedRemote.slots));
      setError("");
      setNotice("Jawaban tersimpan sudah dimuat kembali.");
    }
  }

  async function save() {
    if (!poll || mutation.current || poll.finalizedStart) return;
    if (!name.trim()) {
      setError("Isi namamu agar teman-teman tahu jadwal siapa ini.");
      nameInput.current?.focus();
      return;
    }
    mutation.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let saved: SavedResponse;
      let currentIdentity = identity;
      if (isDemo) {
        saved = {
          participant: {
            id: "demo-you",
            name: name.trim(),
            slots: [...draft].sort(),
            version: (baseline?.version ?? 0) + 1,
          },
        };
        currentIdentity = { id: "demo-you", key: "demo" };
      } else {
        if (!currentIdentity) {
          const key = Array.from(
            crypto.getRandomValues(new Uint8Array(32)),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("");
          currentIdentity = { id: "", key };
        }
        // Store the retry key before the network request so a lost reply cannot duplicate a guest.
        try {
          saveIdentity(id, currentIdentity);
        } catch {
          throw new Error(
            "Aktifkan penyimpanan browser untuk menyimpan kunci edit jawabanmu, lalu coba lagi.",
          );
        }
        setIdentity(currentIdentity);
        saved = await meetingApi<SavedResponse>(
          `/meeting/polls/${encodeURIComponent(id)}/responses${currentIdentity.id ? `/${currentIdentity.id}` : ""}`,
          {
            method: currentIdentity.id ? "PATCH" : "POST",
            headers: { "X-Participant-Key": currentIdentity.key },
            body: JSON.stringify({
              name: name.trim(),
              slots: [...draft].sort(),
              version: baseline?.version ?? 0,
            }),
          },
        );
        currentIdentity = {
          id: saved.participant.id,
          key: saved.editToken ?? currentIdentity.key,
        };
        try {
          saveIdentity(id, currentIdentity);
        } catch {
          /* The preflight key remains available to recover an interrupted save. */
        }
      }
      if (!alive.current) return;
      generation.current++;
      setIdentity(currentIdentity);
      setBaseline(saved.participant);
      setName(saved.participant.name);
      setDraft(new Set(saved.participant.slots));
      const participants = [
        ...poll.participants.filter((p) => p.id !== saved.participant.id),
        saved.participant,
      ];
      setPoll({
        ...poll,
        participants,
        recommendations: rankSlots(poll.slots, participants, poll.duration),
      });
      setMode("group");
      setNotice(
        isDemo
          ? "Jawaban demo ditambahkan. Coba lihat bagaimana heatmap berubah."
          : "Jawaban tersimpan. Kamu bisa kembali lewat link yang sama di browser ini.",
      );
    } catch (err) {
      if (err instanceof MeetingError && err.code === "response_changed") {
        try {
          const latest = await meetingApi<Poll>(
            `/meeting/polls/${encodeURIComponent(id)}`,
          );
          if (alive.current) setPoll(latest);
        } catch {
          /* Keep the current draft for a later retry. */
        }
      }
      if (alive.current)
        setError(
          err instanceof Error
            ? err.message
            : "Jawaban belum tersimpan. Coba lagi.",
        );
    } finally {
      mutation.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function finalize(start: string | null) {
    if (!poll || mutation.current) return;
    mutation.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    try {
      const data = isDemo
        ? { ...poll, finalizedStart: start }
        : await meetingApi<Poll>(
            `/meeting/polls/${encodeURIComponent(id)}/finalize`,
            { method: "POST", body: JSON.stringify({ start }) },
          );
      if (!alive.current) return;
      generation.current++;
      setPoll(data);
      setConfirm(null);
      setMode("group");
      setNotice(
        start
          ? "Waktunya sudah ditetapkan. Sampai bertemu!"
          : "Poll dibuka kembali. Peserta bisa memperbarui jawaban.",
      );
    } catch (err) {
      if (alive.current)
        setError(
          err instanceof Error
            ? err.message
            : "Jadwal belum berhasil diperbarui.",
        );
    } finally {
      mutation.current = false;
      if (alive.current) setBusy(false);
    }
  }

  async function share() {
    try {
      await navigator.clipboard.writeText(
        window.location.origin + MEETING_PATH + "/" + id,
      );
      setNotice("Link disalin. Kirim ke orang-orang yang ingin kamu ajak.");
    } catch {
      setCopyFallback(window.location.origin + MEETING_PATH + "/" + id);
    }
  }

  if (loading && !poll)
    return (
      <div className="m-loading-state" role="status">
        <span className="m-icon-tile">
          <Icon name="calendar" size={26} />
        </span>
        <h1>Making room for everyone…</h1>
        <p>Menyiapkan jadwal bersama.</p>
        <div className="m-skeleton-grid" aria-hidden="true" />
      </div>
    );
  if (!poll)
    return (
      <div className="m-error-state">
        <span className="m-icon-tile">
          <Icon name="link" size={26} />
        </span>
        <h1>We couldn’t find your plans.</h1>
        <p role="alert">{loadError}</p>
        <div className="m-inline-actions">
          <button
            type="button"
            className="m-button m-button-primary"
            onClick={() => {
              setLoading(true);
              setRetry((n) => n + 1);
            }}
          >
            Try again <Icon name="refresh" size={16} />
          </button>
          <Link href={MEETING_PATH} className="m-button m-button-secondary">
            Back to planning
          </Link>
        </div>
      </div>
    );

  return (
    <>
      {isDemo && (
        <div className="m-demo-banner">
          <span>
            <Icon name="sparkle" size={17} />
            <strong>A little test drive.</strong> Data contoh; perubahan hanya
            berlaku selama sesi halaman ini.
          </span>
          <Link href={MEETING_PATH}>
            Create your own <Icon name="arrow" size={15} />
          </Link>
        </div>
      )}
      <div className="m-breadcrumb">
        <Link href={MEETING_PATH}>
          <Icon name="back" size={15} /> All polls
        </Link>
        <span>/</span>
        <span>Availability poll</span>
      </div>
      <section className="m-event-header">
        <div>
          <span
            className={`m-badge ${poll.finalizedStart ? "m-badge-green" : "m-badge-open"}`}
          >
            <span className="m-live-dot" />
            {poll.finalizedStart ? "TIME CONFIRMED" : "FINDING OUR TIME"}
          </span>
          <h1>{poll.title}</h1>
          {poll.description && (
            <p className="m-event-description">{poll.description}</p>
          )}
          <div className="m-event-meta">
            <span>
              <Icon name="calendar" size={16} />
              {dayLabel(poll.dates[0])}
              {poll.dates.length > 1
                ? ` – ${dayLabel(poll.dates[poll.dates.length - 1])}`
                : ""}
            </span>
            <span>
              <Icon name="clock" size={16} />
              {poll.duration} minutes
            </span>
            <span>
              <Icon name="users" size={16} />
              {poll.participants.length} responses
            </span>
          </div>
        </div>
        <div className="m-event-actions">
          <button
            className="m-button m-button-secondary"
            type="button"
            onClick={share}
          >
            <Icon name="link" size={16} /> Share poll
          </button>
          {!poll.finalizedStart && (
            <button
              className="m-button m-button-primary"
              type="button"
              onClick={startEditing}
            >
              {baseline ? "Edit your availability" : "Add your availability"}
              <Icon name="plus" size={17} />
            </button>
          )}
        </div>
      </section>

      {!online && (
        <p className="m-alert m-alert-warning" role="status">
          Kamu sedang offline. Pilihanmu tetap di halaman ini; sambungkan
          internet sebelum menyimpan.
        </p>
      )}
      {syncError && (
        <p className="m-alert m-alert-warning" role="status">
          {syncError}
        </p>
      )}
      {notice && (
        <p className="m-alert m-alert-success" role="status">
          <Icon name="check" size={17} />
          {notice}
          <button
            type="button"
            className="m-icon-button"
            aria-label="Dismiss message"
            onClick={() => setNotice("")}
          >
            <Icon name="close" size={15} />
          </button>
        </p>
      )}
      {copyFallback && (
        <div className="m-alert">
          <label htmlFor="share-url">Salin tautan ini:</label>
          <input
            id="share-url"
            className="m-input"
            value={copyFallback}
            readOnly
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}
      {error && !confirm && (
        <p className="m-alert m-alert-error" role="alert">
          {error}
        </p>
      )}

      {poll.finalizedStart && (
        <section className="m-final-banner">
          <span className="m-final-icon">
            <Icon name="check" size={26} />
          </span>
          <div>
            <span className="m-eyebrow">IT’S A DATE</span>
            <h2>{slotLabel(poll.finalizedStart, timezone, poll.duration)}</h2>
            <p>
              {zoneLabel(poll.finalizedStart, timezone)} · Pengisian ditutup.
              Tambahkan ke kalender agar tidak terlewat.
            </p>
          </div>
          <div className="m-inline-actions">
            <button
              className="m-button m-button-primary"
              type="button"
              onClick={() => calendarFile(poll)}
            >
              <Icon name="download" size={16} /> Add to calendar
            </button>
            {owner && (
              <button
                className="m-button m-button-secondary"
                type="button"
                onClick={() => void finalize(null)}
                disabled={busy}
              >
                Reopen poll
              </button>
            )}
          </div>
        </section>
      )}

      <div className="m-board-layout">
        <section className="m-card m-board" aria-label="Availability calendar">
          <div className="m-board-heading">
            <div
              className="m-segmented"
              role="group"
              aria-label="Availability view"
            >
              <button
                type="button"
                aria-pressed={mode === "group"}
                onClick={() => setMode("group")}
              >
                <Icon name="users" size={16} /> Group availability
              </button>
              <button
                type="button"
                aria-pressed={mode === "mine"}
                onClick={() => setMode("mine")}
              >
                <Icon name="calendar" size={16} /> Your availability
                {dirty && <span className="m-unsaved-dot" />}
              </button>
            </div>
            <span className="m-live-label">
              <span className="m-live-dot" />
              {isDemo
                ? "Interactive demo"
                : online && !syncError
                  ? "Updates every 20s"
                  : "Updates paused"}
            </span>
          </div>
          <div className="m-grid-toolbar">
            <div>
              <h2>
                {mode === "group"
                  ? "A little overlap. A lot of possibility."
                  : "Make room for what matters."}
              </h2>
              <p>
                {mode === "group"
                  ? "Warna lebih pekat berarti lebih banyak yang tersedia."
                  : "Klik atau sapu kotak untuk memilih. Di ponsel, ketuk setiap slot."}
              </p>
            </div>
            <label className="m-display-zone">
              <Icon name="globe" size={15} />
              <select
                aria-label="Display time zone"
                value={timezone}
                onChange={(e) => {
                  setTimezone(e.target.value);
                  setHovered("");
                }}
              >
                {!ZONES.some(([zone]) => zone === poll.timezone) && (
                  <option value={poll.timezone}>{poll.timezone}</option>
                )}
                {timezone !== poll.timezone &&
                  !ZONES.some(([zone]) => zone === timezone) && (
                    <option value={timezone}>
                      {timezone.replaceAll("_", " ")}
                    </option>
                  )}
                {ZONES.map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {mode === "mine" && (
            <div className="m-editor">
              <div className="m-editor-name">
                <span className="m-avatar m-avatar-you">
                  {name.trim() ? (
                    initials(name)
                  ) : (
                    <Icon name="plus" size={16} />
                  )}
                </span>
                <div>
                  <label htmlFor="participant-name">Your name</label>
                  <input
                    id="participant-name"
                    ref={nameInput}
                    placeholder="Nama yang dikenal temanmu"
                    maxLength={60}
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      setError("");
                    }}
                    disabled={busy || !!poll.finalizedStart}
                  />
                </div>
                <span className="m-badge m-badge-neutral">YOU</span>
              </div>
              <div className="m-editor-tools">
                <button
                  type="button"
                  onClick={() => setDraft(new Set(poll.slots))}
                  disabled={busy || !!poll.finalizedStart}
                >
                  Select all
                </button>
                <span>·</span>
                <button
                  type="button"
                  onClick={() => setDraft(new Set())}
                  disabled={busy || !!poll.finalizedStart}
                >
                  Clear selection
                </button>
              </div>
            </div>
          )}
          {mode === "mine" && changedElsewhere && (
            <div className="m-inline-warning" role="status">
              Jawabanmu diperbarui dari tab lain.{" "}
              <button type="button" onClick={restoreSaved}>
                Load saved response
              </button>
            </div>
          )}
          {mode === "group" && filter && (
            <div className="m-filter-notice">
              Showing availability for{" "}
              <strong>
                {poll.participants.find((p) => p.id === filter)?.name}
              </strong>
              <button
                className="m-icon-button"
                type="button"
                aria-label="Clear participant filter"
                onClick={() => setFilter("")}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          )}
          <p className="m-mobile-grid-hint">
            Geser kalender untuk tanggal lainnya <Icon name="arrow" size={13} />
          </p>
          <AvailabilityGrid
            poll={poll}
            timezone={timezone}
            mode={mode}
            draft={draft}
            onDraft={setDraft}
            onInspect={setHovered}
            focused={focused || poll.finalizedStart || ""}
            filter={filter}
            disabled={busy || !!poll.finalizedStart}
          />
          <div className="m-grid-footer">
            {mode === "group" ? (
              <>
                <span className="m-small-muted">
                  All times in {timezone.split("/").pop()?.replaceAll("_", " ")}{" "}
                  · 15-min slots
                </span>
                <div className="m-legend">
                  <span>Fewer</span>
                  {[0, 1, 2, 3, 4, 5].map((n) => (
                    <i className={`m-heat-${n}`} key={n} />
                  ))}
                  <span>More</span>
                </div>
              </>
            ) : (
              <>
                <div>
                  <strong>
                    {draft.size
                      ? `${durationLabel(draft.size * 15)} selected`
                      : "Your schedule is a blank canvas"}
                  </strong>
                  <span>
                    {poll.finalizedStart
                      ? "Poll ditutup. Jawaban tidak bisa diubah."
                      : dirty
                        ? "Unsaved changes · simpan jika sudah selesai"
                        : baseline
                          ? "Your saved availability"
                          : "Tidak ada waktu yang cocok? Simpan tanpa memilih slot."}
                  </span>
                </div>
                <button
                  className="m-button m-button-primary"
                  type="button"
                  onClick={() => void save()}
                  disabled={
                    busy ||
                    !online ||
                    !!poll.finalizedStart ||
                    (baseline !== null && !dirty)
                  }
                  aria-busy={busy}
                >
                  {busy
                    ? "Saving…"
                    : baseline
                      ? "Save changes"
                      : "Save availability"}
                  <Icon name="check" size={16} />
                </button>
              </>
            )}
          </div>
          <div className="m-inspect-panel" aria-live="polite">
            {inspected ? (
              <>
                <div>
                  <Icon name="clock" size={16} />
                  <strong>{slotLabel(inspected, timezone)}</strong>
                  <span>
                    {inspectedPeople.length}/{poll.participants.length}{" "}
                    available for this 15-min slot
                  </span>
                </div>
                <p>
                  {inspectedPeople.length
                    ? inspectedPeople.map((p) => p.name).join(" · ")
                    : "Belum ada yang tersedia di slot ini."}
                </p>
              </>
            ) : (
              <>
                <Icon name="info" size={17} />
                <p>
                  Arahkan kursor atau gunakan tombol panah untuk melihat siapa
                  yang tersedia.
                </p>
              </>
            )}
          </div>
        </section>

        <aside className="m-results-aside">
          <section className="m-card m-best-times">
            <div className="m-section-row">
              <span className="m-icon-tile m-icon-tile-lime">
                <Icon name="sparkle" size={19} />
              </span>
              <span className="m-badge m-badge-neutral">
                {poll.duration} MIN MEETING
              </span>
            </div>
            <h2>Your best bets.</h2>
            <p className="m-aside-description">
              Waktu terbaik berdasarkan ketersediaan
              <br className="m-desktop-break" /> sepanjang durasi meeting.
            </p>
            {recommendations.length ? (
              <div className="m-recommendations">
                {recommendations.map((rec, i) => {
                  const all = rec.count === poll.participants.length,
                    selected = focused === rec.start;
                  return (
                    <div
                      key={rec.start}
                      className={`m-recommendation ${selected ? "m-recommendation-selected" : ""}`}
                    >
                      <button
                        type="button"
                        className="m-recommendation-main"
                        aria-pressed={selected}
                        onClick={() => {
                          setFocused(selected ? "" : rec.start);
                          setHovered(rec.start);
                          setMode("group");
                          setFilter("");
                        }}
                      >
                        <span className="m-rec-day">
                          {dayLabel(dateKey(new Date(rec.start), timezone), {
                            day: "2-digit",
                            month: undefined,
                          })}
                          <small>
                            {new Intl.DateTimeFormat("en", {
                              timeZone: timezone,
                              month: "short",
                            }).format(new Date(rec.start))}
                          </small>
                        </span>
                        <span className="m-rec-info">
                          <strong>
                            {timeLabel(rec.start, timezone)} –{" "}
                            {timeLabel(
                              new Date(
                                Date.parse(rec.start) + poll.duration * 60000,
                              ).toISOString(),
                              timezone,
                            )}
                          </strong>
                          <span>
                            {new Intl.DateTimeFormat("id-ID", {
                              timeZone: timezone,
                              weekday: "long",
                              day: "numeric",
                              month: "short",
                            }).format(new Date(rec.start))}
                          </span>
                          <span className={all ? "m-rec-all" : "m-rec-some"}>
                            <Icon name={all ? "check" : "users"} size={12} />
                            {all
                              ? "Everyone is available"
                              : `${rec.count} of ${poll.participants.length} available`}
                          </span>
                        </span>
                        {i === 0 && (
                          <span className="m-best-star">
                            <Icon name="sparkle" size={14} />
                          </span>
                        )}
                      </button>
                      {selected && (
                        <div className="m-rec-detail">
                          <p>
                            {poll.participants
                              .filter((p) => rec.participantIds.includes(p.id))
                              .map((p) => p.name)
                              .join(", ")}
                          </p>
                          {owner && !poll.finalizedStart && (
                            <button
                              type="button"
                              className="m-button m-button-primary m-button-full"
                              onClick={() => {
                                setError("");
                                setConfirm(rec);
                              }}
                            >
                              Confirm this time <Icon name="arrow" size={15} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="m-empty-recommendations">
                <Icon name="clock" size={25} />
                <strong>
                  {poll.participants.length
                    ? "Still looking for the overlap."
                    : "Good times are on the way."}
                </strong>
                <p>
                  {poll.participants.length
                    ? `Belum ada waktu utuh ${poll.duration} menit. Ajak peserta menambahkan pilihan.`
                    : "Bagikan link dan isi waktu luangmu. Rekomendasi akan muncul di sini."}
                </p>
              </div>
            )}
            {!owner && !poll.finalizedStart && recommendations.length > 0 && (
              <p className="m-rec-note">
                <Icon name="info" size={14} /> Penyelenggara yang akan
                mengonfirmasi waktunya.
              </p>
            )}
          </section>

          <section className="m-card m-participants">
            <div className="m-section-row">
              <h2>The people, the plans.</h2>
              <span className="m-count-bubble">{poll.participants.length}</span>
            </div>
            <p className="m-aside-description">
              {poll.participants.length
                ? "Klik nama untuk menyorot jadwalnya."
                : "Belum ada jawaban. Jadilah yang pertama."}
            </p>
            <div className="m-participant-list">
              {poll.participants.map((person, i) => (
                <button
                  type="button"
                  key={person.id}
                  aria-pressed={filter === person.id}
                  onClick={() => {
                    setFilter(filter === person.id ? "" : person.id);
                    setMode("group");
                  }}
                  className={`m-participant ${filter === person.id ? "m-participant-active" : ""}`}
                >
                  <span className={`m-avatar m-avatar-${i % 5}`}>
                    {initials(person.name)}
                  </span>
                  <span className="m-participant-name">
                    {person.name}
                    {person.id === identity?.id && <small>You</small>}
                    <span>
                      {person.slots.length
                        ? `${durationLabel(person.slots.length * 15)} available`
                        : "No available times"}
                    </span>
                  </span>
                  <span className="m-participant-check">
                    <Icon name="check" size={14} />
                  </span>
                </button>
              ))}
            </div>
            {!poll.finalizedStart && (
              <button
                className="m-add-response"
                type="button"
                onClick={startEditing}
              >
                <span className="m-avatar m-avatar-add">
                  <Icon name={baseline ? "calendar" : "plus"} size={17} />
                </span>
                {baseline ? "Edit your response" : "Add your availability"}
              </button>
            )}
          </section>
          <div className="m-privacy-note">
            <Icon name="info" size={16} />
            <p>
              Semua pemilik link bisa melihat nama dan jadwal. Kunci edit
              jawaban hanya disimpan di browser yang kamu gunakan.
            </p>
          </div>
        </aside>
      </div>
      <div className="m-bottom-note">
        <Icon name="check" size={14} />
        <span>Good plans leave room for everyone.</span>
        <span>Times adapt to your time zone.</span>
      </div>
      {confirm && (
        <ConfirmTime
          poll={poll}
          recommendation={confirm}
          timezone={timezone}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busy) {
              setConfirm(null);
              setError("");
            }
          }}
          onConfirm={() => void finalize(confirm.start)}
        />
      )}
    </>
  );
}
