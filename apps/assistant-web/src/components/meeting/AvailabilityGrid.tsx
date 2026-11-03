"use client";

import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { dayLabel, makeGrid, slotLabel, timeLabel, zoneLabel, type Participant, type Poll } from "@/lib/meeting";
import { Icon } from "./Icon";

const PAGE_SIZE = 16;

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
  const [view, setView] = useState({ day: "", page: 0, focused, timezone });
  const [active, setActive] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ from: number; base: Set<string>; add: boolean } | null>(null);
  const pointerType = useRef("");
  const currentView = view.focused === focused && view.timezone === timezone;
  const day = (currentView ? grid.days.find((day) => day.key === view.day) : undefined)
    ?? grid.days.find((day) => [...day.cells.values()].includes(focused)) ?? grid.days[0];
  // Sort by instant so repeated DST hours remain distinct and chronological.
  const slots = day ? [...day.cells.values()].sort() : [];
  const timeLabels = new Map(day ? [...day.cells].map(([row, slot]) => [slot, row.slice(0, 5)]) : []);
  const repeatedTimes = new Set(day ? [...day.cells.keys()].filter((row) => row.includes("~")).map((row) => row.slice(0, 5)) : []);
  const pageCount = Math.ceil(slots.length / PAGE_SIZE);
  const page = currentView && view.day === day?.key
    ? Math.min(view.page, Math.max(0, pageCount - 1))
    : Math.max(0, Math.floor(slots.indexOf(focused) / PAGE_SIZE));
  const visible = slots.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const activeSlot = visible.includes(active) ? active : visible[0];
  const filtered = poll.participants.find((person) => person.id === filter);
  const total = filtered ? 1 : poll.participants.length;
  const countFor = (slot: string) => filtered
    ? Number(people.get(slot)?.some((person) => person.id === filter))
    : (people.get(slot)?.length ?? 0);
  const choose = (key: string, nextPage: number) => {
    drag.current = null;
    setView({ day: key, page: nextPage, focused, timezone });
    onInspect("");
  };

  function toggle(slot: string) {
    if (disabled) return;
    const next = new Set(draft);
    if (next.has(slot)) next.delete(slot);
    else next.add(slot);
    onDraft(next);
  }
  function paint(index: number) {
    if (!drag.current) return;
    const { from, base, add } = drag.current;
    const next = new Set(base);
    for (let i = Math.min(from, index); i <= Math.max(from, index); i++) {
      if (add) next.add(visible[i]);
      else next.delete(visible[i]);
    }
    onDraft(next);
  }
  function begin(event: PointerEvent<HTMLButtonElement>, index: number, slot: string) {
    pointerType.current = event.pointerType;
    if (mode !== "mine" || disabled || event.button !== 0 || event.pointerType === "touch") return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    drag.current = { from: index, base: new Set(draft), add: !draft.has(slot) };
    viewport.current?.setPointerCapture(event.pointerId);
    paint(index);
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLElement) || !event.target.dataset.slot) return;
    const index = visible.indexOf(event.target.dataset.slot);
    const step = { ArrowDown: 4, ArrowUp: -4, ArrowLeft: -1, ArrowRight: 1 }[event.key];
    const next = event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1
      : step === undefined ? undefined : index + step;
    if (next === undefined) return;
    event.preventDefault();
    if (next >= 0 && next < visible.length) {
      viewport.current?.querySelector<HTMLButtonElement>(`[data-index="${next}"]`)?.focus({ preventScroll: true });
    }
  }

  return (
    <div className="m-picker">
      <div className="m-picker-label"><strong>Pilih tanggal</strong><span>{grid.days.length} pilihan</span></div>
      <div className="m-day-options" role="group" aria-label="Pilihan tanggal">
        {grid.days.map((option) => {
          const selectedCount = [...option.cells.values()].filter((slot) => draft.has(slot)).length;
          return (
            <button type="button" key={option.key} aria-pressed={option.key === day?.key}
              aria-label={`${dayLabel(option.key, { weekday: "long", month: "long" })}${mode === "mine" ? `, ${selectedCount} slot dipilih` : ""}`}
              onClick={() => choose(option.key, 0)}>
              <span>{dayLabel(option.key, { weekday: "short", month: undefined, day: undefined })}</span>
              <strong>{dayLabel(option.key, { day: "numeric", month: undefined })}</strong>
              <span>{dayLabel(option.key, { month: "short", day: undefined })}</span>
              {mode === "mine" && selectedCount > 0 && <i aria-hidden="true" />}
            </button>
          );
        })}
      </div>
      <div className="m-picker-label m-time-options-heading">
        <strong>{day ? dayLabel(day.key, { weekday: "long", month: "short" }) : "Pilih jam"}</strong>
        <span>Per 15 menit</span>
      </div>
      {pageCount > 1 && (
        <div className="m-time-pages" role="group" aria-label="Rentang jam">
          {Array.from({ length: pageCount }, (_, index) => {
            const start = slots[index * PAGE_SIZE];
            const end = slots[Math.min((index + 1) * PAGE_SIZE, slots.length) - 1];
            return <button type="button" key={start} aria-pressed={page === index}
              onClick={() => choose(day.key, index)}>
              {timeLabel(start, timezone)}–{timeLabel(new Date(Date.parse(end) + 900000).toISOString(), timezone)}
            </button>;
          })}
        </div>
      )}
      <div className="m-time-options" ref={viewport} role="group"
        aria-label={mode === "mine" ? "Pilih waktu luang; tombol panah untuk berpindah, Spasi untuk memilih" : "Ketersediaan peserta per jam"}
        onKeyDown={keyboard}
        onPointerMove={(event) => {
          if (!drag.current) return;
          const cell = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-index]");
          if (cell && viewport.current?.contains(cell)) paint(Number(cell.dataset.index));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onLostPointerCapture={() => { drag.current = null; }}>
        {visible.map((slot, index) => {
          const selected = draft.has(slot), count = countFor(slot);
          const level = count === 0 ? 0 : Math.max(1, Math.ceil(count / Math.max(total, 1) * 5));
          const highlighted = focused && Date.parse(slot) >= Date.parse(focused)
            && Date.parse(slot) < Date.parse(focused) + poll.duration * 60000;
          const repeated = repeatedTimes.has(timeLabels.get(slot) ?? "");
          return (
            <button type="button" key={slot} data-slot={slot} data-index={index} data-day={grid.days.indexOf(day)} data-row={page * PAGE_SIZE + index}
              className={`m-time-option ${mode === "mine" ? selected ? "m-slot-selected" : "m-slot-empty" : `m-heat-${level}`} ${highlighted && mode === "group" ? "m-slot-highlighted" : ""}`}
              aria-label={`${slotLabel(slot, timezone)}, ${zoneLabel(slot, timezone)}, ${mode === "mine" ? selected ? "available" : "not selected" : `${count} of ${total} available`}`}
              aria-pressed={mode === "mine" ? selected : undefined}
              aria-disabled={mode === "mine" && disabled ? true : undefined}
              tabIndex={slot === activeSlot ? 0 : -1}
              onFocus={() => { setActive(slot); onInspect(slot); }}
              onPointerEnter={() => { if (!drag.current) onInspect(slot); }}
              onPointerDown={(event) => begin(event, index, slot)}
              onClick={(event) => {
                if (mode === "group") onInspect(slot);
                else if (event.detail === 0 || pointerType.current === "touch") toggle(slot);
              }}>
              <span>{timeLabels.get(slot)}</span>
              {mode === "mine" ? <span className="m-time-check" aria-hidden="true">{selected && <Icon name="check" size={13} />}</span>
                : <small>{count}/{total}</small>}
              {repeated && <small className="m-time-offset">{zoneLabel(slot, timezone)}</small>}
            </button>
          );
        })}
      </div>
      {mode === "mine" && <div className="m-day-tools">
        <span>{slots.filter((slot) => draft.has(slot)).length} dari {slots.length} slot dipilih</span>
        <button type="button" disabled={disabled} onClick={() => {
          const all = slots.every((slot) => draft.has(slot));
          const next = new Set(draft);
          for (const slot of slots) { if (all) next.delete(slot); else next.add(slot); }
          onDraft(next);
        }}>{slots.every((slot) => draft.has(slot)) ? "Kosongkan tanggal ini" : "Pilih semua jam hari ini"}</button>
      </div>}
    </div>
  );
}
