"use client";

import { useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { dayLabel, makeGrid, slotLabel, timeLabel, zoneLabel, type Participant, type Poll } from "@/lib/meeting";
import { Icon } from "./Icon";

const ROWS_PER_PAGE = 32;
const PHONE_QUERY = "(max-width: 600px)";
function subscribeSize(update: () => void) {
  const media = window.matchMedia(PHONE_QUERY);
  media.addEventListener("change", update);
  return () => media.removeEventListener("change", update);
}
const phoneSnapshot = () => window.matchMedia(PHONE_QUERY).matches;
const serverSnapshot = () => false;
type Point = { day: number; row: number };

export function AvailabilityGrid({ poll, timezone, mode, draft, onDraft, onInspect, focused, filter, disabled }: {
  poll: Poll;
  timezone: string;
  mode: "group" | "mine";
  draft: Set<string>;
  onDraft: (slots: Set<string>) => void;
  onInspect: (slot: string) => void;
  focused: string;
  filter: string;
  disabled: boolean;
}) {
  const grid = useMemo(() => makeGrid(poll.slots, timezone), [poll.slots, timezone]);
  const people = useMemo(() => {
    const bySlot = new Map<string, Participant[]>(poll.slots.map((slot) => [slot, []]));
    for (const person of poll.participants) {
      for (const slot of person.slots) bySlot.get(slot)?.push(person);
    }
    return bySlot;
  }, [poll.slots, poll.participants]);
  const columns = useSyncExternalStore(subscribeSize, phoneSnapshot, serverSnapshot) ? 3 : 7;
  const [view, setView] = useState({ day: "", row: "", focused, timezone });
  const [active, setActive] = useState("");
  const surface = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: Point; last: Point | null; base: Set<string>; add: boolean } | null>(null);
  const currentView = view.focused === focused && view.timezone === timezone;
  const focusedDay = grid.days.findIndex((day) => [...day.cells.values()].includes(focused));
  const focusedRow = focusedDay < 0 ? "" : [...grid.days[focusedDay].cells].find(([, slot]) => slot === focused)?.[0];
  const chosenDay = currentView ? grid.days.findIndex((day) => day.key === view.day) : -1;
  const chosenRow = currentView ? grid.rows.indexOf(view.row) : -1;
  const dayStart = Math.floor(Math.max(0, chosenDay < 0 ? focusedDay : chosenDay) / columns) * columns;
  const rowStart = Math.floor(Math.max(0, chosenRow < 0 ? grid.rows.indexOf(focusedRow ?? "") : chosenRow) / ROWS_PER_PAGE) * ROWS_PER_PAGE;
  const days = grid.days.slice(dayStart, dayStart + columns);
  const rows = grid.rows.slice(rowStart, rowStart + ROWS_PER_PAGE);
  const labels = useMemo(() => {
    const result = new Map<string, string>();
    for (const day of grid.days.slice(dayStart, dayStart + columns)) {
      for (const row of grid.rows.slice(rowStart, rowStart + ROWS_PER_PAGE)) {
        const slot = day.cells.get(row);
        if (slot) result.set(slot, `${slotLabel(slot, timezone)}, ${zoneLabel(slot, timezone)}`);
      }
    }
    return result;
  }, [grid, dayStart, rowStart, columns, timezone]);
  const visibleSlots = days.flatMap((day) => rows.flatMap((row) => day.cells.get(row) ?? []));
  const activeSlot = visibleSlots.includes(active) ? active : visibleSlots[0];
  const filtered = poll.participants.find((person) => person.id === filter);
  const total = filtered ? 1 : poll.participants.length;
  const countFor = (slot: string) => filtered
    ? Number(people.get(slot)?.some((person) => person.id === filter))
    : (people.get(slot)?.length ?? 0);

  function choose(day: number, row: number) {
    drag.current = null;
    setView({ day: grid.days[day]?.key ?? "", row: grid.rows[row] ?? "", focused, timezone });
    onInspect("");
  }
  function toggle(slot: string) {
    if (disabled) return;
    const next = new Set(draft);
    if (next.has(slot)) next.delete(slot);
    else next.add(slot);
    onDraft(next);
  }
  function paint(to: Point) {
    if (!drag.current) return;
    const { from, base, add, last } = drag.current;
    if (last?.day === to.day && last?.row === to.row) return;
    drag.current.last = to;
    const next = new Set(base);
    for (let day = Math.min(from.day, to.day); day <= Math.max(from.day, to.day); day++) {
      for (let row = Math.min(from.row, to.row); row <= Math.max(from.row, to.row); row++) {
        const slot = grid.days[day]?.cells.get(grid.rows[row]);
        if (slot) { if (add) next.add(slot); else next.delete(slot); }
      }
    }
    onDraft(next);
  }
  function begin(event: PointerEvent<HTMLButtonElement>, point: Point, slot: string) {
    if (mode !== "mine" || disabled || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { from: point, last: null, base: new Set(draft), add: !draft.has(slot) };
    surface.current?.setPointerCapture(event.pointerId);
    paint(point);
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || !event.target.dataset.slot) return;
    let day = Number(event.target.dataset.day), row = Number(event.target.dataset.row);
    const step = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
    if (!step && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    if (event.key === "Home") row = rowStart - 1;
    if (event.key === "End") row = rowStart + rows.length;
    const direction = step ?? [0, event.key === "Home" ? 1 : -1];
    while (true) {
      day += direction[0]; row += direction[1];
      if (day < dayStart || day >= dayStart + days.length || row < rowStart || row >= rowStart + rows.length) return;
      const target = surface.current?.querySelector<HTMLButtonElement>(`[data-day="${day}"][data-row="${row}"]`);
      if (target) { target.focus({ preventScroll: true }); return; }
    }
  }
  const rangeLabel = (start: number) => {
    const first = grid.rows[start], last = grid.rows[Math.min(start + ROWS_PER_PAGE, grid.rows.length) - 1];
    const lastSlot = grid.days.map((day) => day.cells.get(last)).find(Boolean);
    return `${first.slice(0, 5)}\u2013${lastSlot ? timeLabel(new Date(Date.parse(lastSlot) + 900000).toISOString(), timezone) : last.slice(0, 5)}`;
  };

  return (
    <div className="m-picker">
      {grid.days.length > columns && <div className="m-date-pages" role="group" aria-label="Pilihan tanggal">
        <button type="button" aria-label="Tanggal sebelumnya" disabled={dayStart === 0}
          onClick={() => choose(Math.max(0, dayStart - columns), rowStart)}><Icon name="back" size={16} /></button>
        <span><strong>{dayLabel(days[0].key)} – {dayLabel(days[days.length - 1].key)}</strong><small>{Math.floor(dayStart / columns) + 1}/{Math.ceil(grid.days.length / columns)}</small></span>
        <button type="button" aria-label="Tanggal berikutnya" disabled={dayStart + columns >= grid.days.length}
          onClick={() => choose(dayStart + columns, rowStart)}><Icon name="back" size={16} style={{ transform: "rotate(180deg)" }} /></button>
      </div>}
      {grid.rows.length > ROWS_PER_PAGE && <div className="m-time-pages" role="group" aria-label="Rentang jam">
        {Array.from({ length: Math.ceil(grid.rows.length / ROWS_PER_PAGE) }, (_, page) =>
          <button type="button" key={page} aria-pressed={rowStart === page * ROWS_PER_PAGE}
            onClick={() => choose(dayStart, page * ROWS_PER_PAGE)}>{rangeLabel(page * ROWS_PER_PAGE)}</button>
        )}
      </div>}
      <p className="m-grid-instruction">{mode === "mine" ? "Drag untuk memilih. Ulangi untuk menghapus." : "Ketuk blok waktu untuk melihat peserta yang bisa."}</p>
      <div className={`m-grid-surface ${mode === "mine" && !disabled ? "m-grid-editable" : ""}`} ref={surface}
        onKeyDown={keyboard}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-slot]");
          if (cell && surface.current?.contains(cell)) paint({ day: Number(cell.dataset.day), row: Number(cell.dataset.row) });
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}>
        <table className="m-availability-grid" aria-label={mode === "mine" ? "Pilih waktu luang; panah untuk berpindah, Spasi untuk memilih" : "Ketersediaan peserta"}>
          <thead><tr>
            <th className="m-time-heading" scope="col"><Icon name="clock" size={14} /><span>Jam</span></th>
            {days.map((day) => {
              const selected = [...day.cells.values()].filter((slot) => draft.has(slot)).length;
              const label = dayLabel(day.key, { weekday: "long", month: "long" });
              const heading = <><span>{dayLabel(day.key, { weekday: "short", month: undefined, day: undefined })}</span><strong>{dayLabel(day.key)}</strong>{mode === "mine" && <small>{selected ? `${selected} slot` : "Pilih sehari"}</small>}</>;
              return <th scope="col" key={day.key}>
                {mode === "mine" ? <button type="button" className="m-grid-day" aria-label={`Pilih semua jam ${label}`}
                  aria-pressed={selected === day.cells.size} disabled={disabled}
                  onClick={() => {
                    const next = new Set(draft), all = selected === day.cells.size;
                    for (const slot of day.cells.values()) { if (all) next.delete(slot); else next.add(slot); }
                    onDraft(next);
                  }}>{heading}</button> : <div className="m-grid-day">{heading}</div>}
              </th>;
            })}
          </tr></thead>
          <tbody>{rows.map((row, localRow) => <tr key={row} className={row.endsWith(":00") ? "m-hour-row" : ""}>
            <th scope="row" className="m-time-label"><span>{row.endsWith(":00") || localRow === 0 || row.includes("~") ? row.slice(0, 5) : ""}{row.includes("~") ? " ↺" : ""}</span></th>
            {days.map((day, localDay) => {
              const slot = day.cells.get(row);
              if (!slot) return <td className="m-missing-cell" key={day.key}><span aria-label="Di luar rentang meeting" /></td>;
              const selected = draft.has(slot), count = countFor(slot);
              const level = count === 0 ? 0 : Math.max(1, Math.ceil(count / Math.max(total, 1) * 5));
              const highlighted = focused && Date.parse(slot) >= Date.parse(focused) && Date.parse(slot) < Date.parse(focused) + poll.duration * 60000;
              return <td key={day.key}>
                <button type="button" data-slot={slot} data-row={rowStart + localRow} data-day={dayStart + localDay}
                  className={`m-slot ${mode === "mine" ? selected ? "m-slot-selected" : "m-slot-empty" : `m-heat-${level}`} ${highlighted && mode === "group" ? "m-slot-highlighted" : ""}`}
                  aria-label={`${labels.get(slot)}, ${mode === "mine" ? selected ? "tersedia" : "belum dipilih" : `${count} dari ${total} peserta bisa`}`}
                  aria-pressed={mode === "mine" ? selected : undefined} aria-disabled={mode === "mine" && disabled ? true : undefined}
                  tabIndex={slot === activeSlot ? 0 : -1}
                  onFocus={() => { setActive(slot); onInspect(slot); }}
                  onPointerEnter={() => { if (!drag.current) onInspect(slot); }}
                  onPointerDown={(event) => begin(event, { day: dayStart + localDay, row: rowStart + localRow }, slot)}
                  onClick={(event) => { if (mode === "group") onInspect(slot); else if (event.detail === 0) toggle(slot); }}>
                  {row.endsWith(":00") && (mode === "mine" ? selected && <Icon name="check" size={10} /> : count > 0 && <span>{count}</span>)}
                </button>
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <div className="m-grid-range-note"><span>{rangeLabel(rowStart)} · per 15 menit</span><span>{mode === "mine" ? "Ketuk nama hari untuk memilih sehari penuh." : "Warna lebih pekat = lebih banyak peserta."}</span></div>
    </div>
  );
}
