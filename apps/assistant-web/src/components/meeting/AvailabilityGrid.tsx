"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import {
  dayLabel,
  makeGrid,
  slotLabel,
  zoneLabel,
  type Participant,
  type Poll,
} from "@/lib/meeting";
import { Icon } from "./Icon";

type Point = { day: number; row: number };
type Drag = {
  from: Point;
  last: Point | null;
  base: Set<string>;
  add: boolean;
};

export function AvailabilityGrid({
  poll,
  timezone,
  mode,
  draft,
  onDraft,
  onInspect,
  focused,
  filter,
  disabled,
}: {
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
  const grid = useMemo(
    () => makeGrid(poll.slots, timezone),
    [poll.slots, timezone],
  );
  const people = useMemo(() => {
    const bySlot = new Map<string, Participant[]>(
      poll.slots.map((slot) => [slot, []]),
    );
    for (const person of poll.participants) {
      for (const slot of person.slots) bySlot.get(slot)?.push(person);
    }
    return bySlot;
  }, [poll.slots, poll.participants]);
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const pointerType = useRef("");
  const [active, setActive] = useState("");
  const filtered = poll.participants.find((p) => p.id === filter);

  useEffect(() => {
    const container = viewport.current;
    const cell = focused
      ? container?.querySelector<HTMLButtonElement>(`[data-slot="${focused}"]`)
      : null;
    if (!cell || !container) return;
    const bounds = cell.getBoundingClientRect(),
      parent = container.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + bounds.top - parent.top - 84,
      left:
        container.scrollLeft +
        bounds.left -
        parent.left -
        container.clientWidth / 2 +
        bounds.width / 2,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  }, [focused, timezone]);

  function paint(to: Point) {
    if (!drag.current) return;
    if (drag.current.last?.day === to.day && drag.current.last?.row === to.row)
      return;
    drag.current.last = to;
    const { from, base, add } = drag.current,
      next = new Set(base);
    for (
      let day = Math.min(from.day, to.day);
      day <= Math.max(from.day, to.day);
      day++
    ) {
      for (
        let row = Math.min(from.row, to.row);
        row <= Math.max(from.row, to.row);
        row++
      ) {
        const slot = grid.days[day]?.cells.get(grid.rows[row]);
        if (slot) {
          if (add) next.add(slot);
          else next.delete(slot);
        }
      }
    }
    onDraft(next);
  }
  function begin(
    event: PointerEvent<HTMLButtonElement>,
    point: Point,
    slot: string,
  ) {
    pointerType.current = event.pointerType;
    if (
      mode !== "mine" ||
      disabled ||
      event.button !== 0 ||
      event.pointerType === "touch"
    )
      return;
    event.preventDefault();
    event.currentTarget.focus();
    drag.current = {
      from: point,
      last: null,
      base: new Set(draft),
      add: !draft.has(slot),
    };
    viewport.current?.setPointerCapture(event.pointerId);
    paint(point);
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    const cell = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-slot]");
    if (cell && viewport.current?.contains(cell))
      paint({ day: Number(cell.dataset.day), row: Number(cell.dataset.row) });
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    const direction = {
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }[event.key];
    if (
      !direction ||
      !(event.target instanceof HTMLElement) ||
      !event.target.dataset.slot
    )
      return;
    event.preventDefault();
    let row = Number(event.target.dataset.row),
      day = Number(event.target.dataset.day);
    while (true) {
      row += direction[0];
      day += direction[1];
      if (
        row < 0 ||
        day < 0 ||
        row >= grid.rows.length ||
        day >= grid.days.length
      )
        return;
      const target = viewport.current?.querySelector<HTMLButtonElement>(
        `button[data-row="${row}"][data-day="${day}"]`,
      );
      if (target) {
        target.focus();
        return;
      }
    }
  }
  const firstSlot = grid.days[0]?.cells.values().next().value;
  const activeSlot = active && poll.slots.includes(active) ? active : firstSlot;

  return (
    <div
      className="m-grid-viewport"
      ref={viewport}
      onPointerMove={move}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onKeyDown={keyboard}
    >
      <table
        className={`m-availability-grid ${mode === "mine" ? "m-grid-editable" : ""}`}
        aria-label={
          mode === "mine"
            ? "Your availability; use arrow keys to navigate and Space to select"
            : "Group availability; use arrow keys to explore"
        }
      >
        <thead>
          <tr>
            <th className="m-time-heading">
              <Icon name="clock" size={15} />
              <span>{zoneLabel(poll.slots[0], timezone)}</span>
            </th>
            {grid.days.map((day) => (
              <th scope="col" key={day.key}>
                <span>
                  {dayLabel(day.key, {
                    day: undefined,
                    month: undefined,
                    weekday: "short",
                  })}
                </span>
                <strong>{dayLabel(day.key)}</strong>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map((row, rowIndex) => (
            <tr key={row} className={row.endsWith(":00") ? "m-hour-row" : ""}>
              <th scope="row" className="m-time-label">
                {row.includes("~")
                  ? `${row.slice(0, 5)} ↺`
                  : row.endsWith(":00") || row.endsWith(":30")
                    ? row
                    : ""}
              </th>
              {grid.days.map((day, dayIndex) => {
                const slot = day.cells.get(row);
                if (!slot)
                  return (
                    <td className="m-missing-cell" key={day.key}>
                      <span aria-label="Time outside the poll window" />
                    </td>
                  );
                const available = people.get(slot) ?? [],
                  selected = draft.has(slot);
                const count = filtered
                  ? Number(available.some((p) => p.id === filter))
                  : available.length;
                const total = filtered ? 1 : poll.participants.length;
                const level =
                  count === 0
                    ? 0
                    : Math.max(1, Math.ceil((count / Math.max(total, 1)) * 5));
                const highlighted =
                  focused &&
                  Date.parse(slot) >= Date.parse(focused) &&
                  Date.parse(slot) <
                    Date.parse(focused) + poll.duration * 60000;
                return (
                  <td key={day.key}>
                    <button
                      type="button"
                      data-slot={slot}
                      data-row={rowIndex}
                      data-day={dayIndex}
                      className={`m-slot ${mode === "mine" ? (selected ? "m-slot-selected" : "m-slot-empty") : `m-heat-${level}`} ${highlighted && mode === "group" ? "m-slot-highlighted" : ""}`}
                      aria-label={`${slotLabel(slot, timezone)}, ${zoneLabel(slot, timezone)}, ${mode === "mine" ? (selected ? "available" : "not selected") : `${count} of ${total} available`}`}
                      aria-pressed={mode === "mine" ? selected : undefined}
                      aria-disabled={
                        mode === "mine" && disabled ? true : undefined
                      }
                      tabIndex={slot === activeSlot ? 0 : -1}
                      onFocus={() => {
                        setActive(slot);
                        onInspect(slot);
                      }}
                      onPointerEnter={() => {
                        if (!drag.current) onInspect(slot);
                      }}
                      onPointerDown={(event) =>
                        begin(event, { day: dayIndex, row: rowIndex }, slot)
                      }
                      onClick={(event) => {
                        if (mode === "group") {
                          onInspect(slot);
                          return;
                        }
                        if (
                          !disabled &&
                          (event.detail === 0 ||
                            pointerType.current === "touch")
                        ) {
                          const next = new Set(draft);
                          if (next.has(slot)) next.delete(slot);
                          else next.add(slot);
                          onDraft(next);
                        }
                      }}
                    >
                      {mode === "mine" ? (
                        selected ? (
                          <Icon name="check" size={13} />
                        ) : null
                      ) : count > 0 ? (
                        <span>{count}</span>
                      ) : null}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
