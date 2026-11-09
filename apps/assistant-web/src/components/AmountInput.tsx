"use client";

import type { ChangeEvent, ComponentProps } from "react";

const MAX_DIGITS = 12;
const MAX_SEN = 2;

/**
 * Keeps the digits of a typed amount and groups them with dots: "25000" -> "25.000".
 * A comma starts the sen, up to two digits: "416551,65" -> "416.551,65". A leading "Rp"
 * is ignored, a trailing "k" or "rb" multiplies by 1000 ("2,5rb" -> "2.500"), and a lone
 * trailing "r" is kept while "rb" is being typed. Leading zeros and a bare comma stay
 * while editing, so replacing the first digit of "1.000" does not collapse it; on blur
 * they go and sen are written with two digits.
 */
export function formatAmount(raw: string, editing = false): string {
  const s = raw.toLowerCase().replace(/^\s*rp\.?\s*/, "");
  const thousand = /(k|rb)\s*$/.test(s);
  const pending = !thousand && /[\d,]r\s*$/.test(s);
  const comma = s.indexOf(",");
  let whole = (comma < 0 ? s : s.slice(0, comma)).replace(/\D/g, "");
  let sen = comma < 0 ? "" : s.slice(comma + 1).replace(/\D/g, "").slice(0, MAX_SEN);
  let hasComma = comma >= 0;
  if (thousand && (whole || sen)) {
    whole = (whole || "0") + (sen + "000").slice(0, 3);
    sen = "";
    hasComma = false;
  }
  if (!editing) {
    whole = whole.replace(/^0+(?=\d)/, "");
    sen = /[1-9]/.test(sen) ? sen.padEnd(MAX_SEN, "0") : "";
    hasComma = sen !== "";
  }
  whole = whole.slice(0, MAX_DIGITS);
  if (!whole && !hasComma) return "";
  const grouped = (whole || "0").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return grouped + (hasComma ? `,${sen}` : "") + (pending ? "r" : "");
}

/** The amount in rupiah: "416.551,65" -> 416551.65. */
export function parseAmount(formatted: string): number {
  const [whole, sen = ""] = formatted.split(",");
  return Number(`${whole.replace(/\D/g, "") || "0"}.${sen.replace(/\D/g, "") || "0"}`) || 0;
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
const commaCount = (s: string) => s.split(",").length - 1;

/**
 * Amount field whose thousand dots are display only: they appear and disappear as
 * digits change, the caret skips them, and deleting a dot deletes the digit beside it.
 * The comma is real: it separates the sen, and a typed "." (the decimal key on many
 * phone keyboards) becomes one.
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
    const input = e.nativeEvent as InputEvent;
    const kind = input.inputType ?? "";
    let typedComma = false;

    if (kind === "insertText" && (input.data === "." || input.data === ",") && caret > 0) {
      // One decimal separator only; a second one is ignored.
      raw = raw.slice(0, caret - 1) + raw.slice(caret);
      caret -= 1;
      if (!raw.includes(",")) {
        raw = `${raw.slice(0, caret)},${raw.slice(caret)}`;
        caret += 1;
        typedComma = true;
      }
    } else if (kind === "insertFromPaste" && !raw.includes(",")) {
      // A pasted "416551.65" uses a decimal point; "25.000" groups thousands.
      raw = raw.replace(/\.(\d{1,2})(\D*)$/, ",$1$2");
    } else if (
      kind.startsWith("delete") && raw.length < value.length &&
      digitCount(raw) === digitCount(value) && commaCount(raw) === commaCount(value)
    ) {
      // Only a dot went away: remove the digit next to it instead.
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
    const pos = atEnd
      ? next.length
      : typedComma
        ? next.indexOf(",") + 1
        : afterDigits(next, digitCount(raw.slice(0, caret)));
    el.value = next;
    el.setSelectionRange(pos, pos);
    onChange(next);
  }

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
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
