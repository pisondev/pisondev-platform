"use client";

import type { ChangeEvent, ComponentProps } from "react";

const MAX_DIGITS = 12;

/**
 * Keeps the digits of a typed amount and groups them with dots: "25000" -> "25.000".
 * A leading "Rp" is ignored, a trailing "k" or "rb" multiplies by 1000, and a lone
 * trailing "r" is kept while "rb" is being typed. Leading zeros stay while editing, so
 * replacing the first digit of "1.000" does not collapse it, and go on blur.
 */
export function formatAmount(raw: string, editing = false): string {
  const s = raw.toLowerCase().replace(/^\s*rp\.?\s*/, "");
  const thousand = /(k|rb)\s*$/.test(s);
  const pending = !thousand && /\dr\s*$/.test(s);
  let digits = s.replace(/\D/g, "");
  if (!editing) digits = digits.replace(/^0+(?=\d)/, "");
  if (thousand && digits && digits !== "0") digits += "000";
  digits = digits.slice(0, MAX_DIGITS);
  if (!digits) return "";
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (pending ? "r" : "");
}

/** Position right after the n-th digit of a formatted value. */
function afterDigits(value: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < value.length; i++) {
    if (/\d/.test(value[i]) && ++seen === n) return i + 1;
  }
  return value.length;
}

const digitCount = (s: string) => s.replace(/\D/g, "").length;

/**
 * Amount field whose thousand dots are display only: they appear and disappear as
 * digits change, the caret skips them, and deleting a dot deletes the digit beside it.
 */
export function AmountInput({
  value,
  onChange,
  onBlur,
  ...rest
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & { value: string; onChange: (value: string) => void }) {
  function change(e: ChangeEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    let raw = el.value;
    let caret = el.selectionStart ?? raw.length;
    const kind = (e.nativeEvent as InputEvent).inputType ?? "";

    // Only a dot went away: remove the digit next to it instead.
    if (kind.startsWith("delete") && raw.length < value.length && digitCount(raw) === digitCount(value)) {
      if (kind === "deleteContentForward") {
        const i = raw.slice(caret).search(/\d/);
        if (i >= 0) raw = raw.slice(0, caret + i) + raw.slice(caret + i + 1);
      } else {
        const i = raw.slice(0, caret).search(/\d(?=\D*$)/);
        if (i >= 0) {
          raw = raw.slice(0, i) + raw.slice(i + 1);
          caret = i;
        }
      }
    }

    const next = formatAmount(raw, true);
    // Typing at the end (or a "k"/"rb" that adds zeros) keeps the caret at the end.
    const atEnd = caret >= raw.length || digitCount(next) > digitCount(raw);
    const pos = atEnd ? next.length : afterDigits(next, digitCount(raw.slice(0, caret)));
    el.value = next;
    el.setSelectionRange(pos, pos);
    onChange(next);
  }

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      onChange={change}
      onBlur={(e) => {
        const tidy = formatAmount(value);
        if (tidy !== value) onChange(tidy);
        onBlur?.(e);
      }}
    />
  );
}
