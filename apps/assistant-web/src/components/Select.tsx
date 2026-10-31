"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type SelectOption<T> = { value: T; label: string };

const GAP = 6; // px between trigger and list
const INSET = 8; // px kept clear of the viewport edge
const EXIT_MS = 150; // matches .select-popup[data-state="closing"]

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isChar = (e: KeyboardEvent) => e.key.length === 1 && e.key !== " " && !e.ctrlKey && !e.metaKey && !e.altKey;

/**
 * Select-only combobox (WAI-ARIA APG pattern) in place of the native select menu. Focus
 * stays on the trigger; the list sits in a body portal so sheets and scroll areas never
 * clip it, flips above when there is no room below, and slides open and closed.
 */
export function Select<T extends string | number>({
  value,
  options,
  onChange,
  disabled = false,
  className = "",
  tone = "assistant",
  "aria-label": ariaLabel,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  tone?: "assistant" | "meeting";
  "aria-label"?: string;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const typed = useRef({ text: "", at: 0 });
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const [active, setActive] = useState(0);
  const selected = options.findIndex((o) => o.value === value);
  const open = phase === "open";
  const last = options.length - 1;

  const show = (index: number) => {
    if (disabled || options.length === 0) return;
    clearTimeout(exitTimer.current);
    setActive(Math.max(0, Math.min(last, index)));
    setPhase("open");
  };

  const hide = useCallback(() => {
    clearTimeout(exitTimer.current);
    if (reducedMotion()) return setPhase("closed");
    setPhase((p) => (p === "closed" ? p : "closing"));
    exitTimer.current = setTimeout(() => setPhase("closed"), EXIT_MS);
  }, []);

  const commit = (index: number) => {
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
    hide();
    trigger.current?.focus({ preventScroll: true });
  };

  /** Anchors the list to the trigger: below if it fits, else on the roomier side. */
  const place = useCallback(() => {
    const t = trigger.current, p = popup.current, l = list.current;
    if (!t || !p || !l) return;
    const font = getComputedStyle(t);
    p.style.fontFamily = font.fontFamily;
    p.style.fontSize = font.fontSize;
    const r = t.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const below = vh - r.bottom - GAP - INSET, above = r.top - GAP - INSET;
    const cap = Math.min(240, vh * 0.4);
    const frame = p.offsetHeight - l.offsetHeight;
    const side = below >= Math.min(cap, l.scrollHeight + frame) || below >= above ? "bottom" : "top";
    l.style.maxHeight = `${Math.max(80, Math.min(cap, side === "bottom" ? below : above) - frame)}px`;
    p.dataset.side = side;
    p.style.minWidth = `${r.width}px`;
    p.style.maxWidth = `${vw - INSET * 2}px`;
    p.style.left = `${Math.max(INSET, Math.min(r.left, vw - INSET - p.offsetWidth))}px`;
    p.style.top = `${side === "bottom" ? r.bottom + GAP : r.top - GAP - p.offsetHeight}px`;
    p.dataset.placed = ""; // starts the slide from the side chosen above
  }, []);

  // Position before the first paint and start with the chosen option in the middle.
  useLayoutEffect(() => {
    if (phase !== "open") return;
    place();
    const l = list.current, item = l?.querySelector<HTMLElement>('[data-active="true"]');
    if (l && item) l.scrollTop = item.offsetTop - (l.clientHeight - item.offsetHeight) / 2;
  }, [phase, place]);

  // Keep the keyboard-active option inside the scrolled list.
  useLayoutEffect(() => {
    const l = list.current, item = l?.children[active] as HTMLElement | undefined;
    if (!open || !l || !item) return;
    if (item.offsetTop < l.scrollTop) l.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > l.scrollTop + l.clientHeight) l.scrollTop = item.offsetTop + item.offsetHeight - l.clientHeight;
  }, [active, open]);

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      const node = e.target as Node;
      if (!trigger.current?.contains(node) && !popup.current?.contains(node)) hide();
    };
    const follow = (e: Event) => { if (e.target !== list.current) place(); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
    };
  }, [open, hide, place]);

  useEffect(() => () => clearTimeout(exitTimer.current), []);

  /** Type-to-find: repeated letters cycle, a longer prefix searches from the current option. */
  function seek(char: string, from: number) {
    const now = Date.now(), t = typed.current;
    t.text = now - t.at > 500 ? char.toLowerCase() : t.text + char.toLowerCase();
    t.at = now;
    const repeat = [...t.text].every((c) => c === t.text[0]);
    const query = repeat ? t.text[0] : t.text;
    const start = repeat ? from + 1 : from;
    for (let k = 0; k < options.length; k++) {
      const i = (((start + k) % options.length) + options.length) % options.length;
      if (options[i].label.toLowerCase().startsWith(query)) return i;
    }
    return -1;
  }

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) show(selected);
      else if (e.key === "Home") show(0);
      else if (e.key === "End") show(last);
      else if (isChar(e)) show(Math.max(seek(e.key, selected), selected));
      else return;
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case "ArrowDown": setActive(Math.min(last, active + 1)); break;
      case "ArrowUp": if (e.altKey) commit(active); else setActive(Math.max(0, active - 1)); break;
      case "Home": setActive(0); break;
      case "End": setActive(last); break;
      case "PageDown": setActive(Math.min(last, active + 10)); break;
      case "PageUp": setActive(Math.max(0, active - 10)); break;
      case "Enter":
      case " ": commit(active); break;
      // Stop here so an enclosing sheet does not close as well.
      case "Escape": e.stopPropagation(); hide(); break;
      case "Tab": hide(); return;
      default: {
        if (!isChar(e)) return;
        const hit = seek(e.key, active);
        if (hit >= 0) setActive(hit);
      }
    }
    e.preventDefault();
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        disabled={disabled}
        data-tone={tone}
        className={`select-trigger ${className}`}
        onClick={() => (open ? hide() : show(selected))}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => { if (e.key === " ") e.preventDefault(); }}
      >
        <span className="select-row">
          <span className="select-value">{options[selected]?.label ?? String(value)}</span>
          <svg aria-hidden viewBox="0 0 24 24" className="select-chevron">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>
      {phase !== "closed"
        ? createPortal(
            <div ref={popup} className="select-popup" data-tone={tone} data-state={phase} onMouseDown={(e) => e.preventDefault()}>
              <ul ref={list} id={listId} role="listbox" aria-label={ariaLabel} className="select-list">
                {options.map((o, i) => (
                  <li
                    key={String(o.value)}
                    id={`${id}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    data-active={i === active}
                    data-selected={i === selected}
                    onPointerMove={() => { if (i !== active) setActive(i); }}
                    onClick={() => commit(i)}
                  >
                    <span>{o.label}</span>
                    {i === selected ? (
                      <svg aria-hidden viewBox="0 0 24 24" className="select-check">
                        <path d="m5 12 4 4L19 6" />
                      </svg>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
