"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, patch, post } from "@/lib/api";
import { nowWIB, rupiahDigits, shortDate } from "@/lib/format";
import type { SubItem } from "@/lib/types";
import { AmountInput, formatAmount, parseAmount } from "./AmountInput";
import { Select } from "./Select";
import { Check, Field, FieldError, SheetActions, SheetError, SheetFrame, SheetReadActions, inputClass, useSheet } from "./Sheet";
import { Toggle } from "./ui";

type Cycle = "Bulanan" | "Tahunan";

const STATUSES = [
  { value: "Aktif", label: "Active" },
  { value: "Dijeda", label: "Paused" },
  { value: "Berhenti", label: "Stopped" },
];

// Must match PRICE_MAY_CHANGE on the Subscriptions page.
const PRICE_MAY_CHANGE = "harga bisa berubah";

function withPriceNote(notes: string, on: boolean): string {
  const has = notes.toLowerCase().includes(PRICE_MAY_CHANGE);
  if (on && !has) return notes.trim() ? `${notes.trim()} Harga bisa berubah.` : "Harga bisa berubah.";
  if (!on && has) return notes.replace(/\s*harga bisa berubah[.,]?/gi, "").trim();
  return notes;
}

/**
 * New or edited subscription. Saving writes to the app first; the sync carries it to
 * Notion. `onPay` closes the sheet and opens the bill in the transaction sheet.
 */
export function SubscriptionSheet({
  editing,
  onClose,
  onSaved,
  onPay,
}: {
  editing?: SubItem;
  onClose: () => void;
  onSaved: (s: SubItem) => void;
  onPay?: (s: SubItem) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [price, setPrice] = useState(editing ? formatAmount(rupiahDigits(editing.price)) : "");
  const [cycle, setCycle] = useState<Cycle>(editing?.cycle === "Tahunan" ? "Tahunan" : "Bulanan");
  const [nextBilling, setNextBilling] = useState(editing?.nextBilling?.slice(0, 10) ?? nowWIB().slice(0, 10));
  const [status, setStatus] = useState(editing?.status || "Aktif");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fields?: Record<string, unknown> }>();
  const first = useRef<HTMLInputElement>(null);
  // An existing subscription opens read-only; Edit unlocks it. Mark as paid works either way.
  const [locked, setLocked] = useState(!!editing);
  const editButton = useRef<HTMLButtonElement>(null);
  const { formRef, savingRef, mountedRef, dismissingRef, closing, close, finish } = useSheet(onClose, editing ? editButton : first);
  const unlock = () => setLocked(false);
  // Edit disappears as the fields unlock, so focus moves on to the first field.
  const wasLocked = useRef(locked);
  useEffect(() => {
    if (wasLocked.current && !locked) first.current?.focus();
    wasLocked.current = locked;
  }, [locked]);
  const titleId = useId();

  function submit(e: FormEvent) {
    e.preventDefault();
    if (locked) return;
    if (savingRef.current || dismissingRef.current) return;
    const all = { name: name.trim(), price: parseAmount(price), cycle, nextBilling, status, notes: notes.trim() };
    // An edit sends only what changed, so a field edited in Notion meanwhile is kept.
    const body = editing
      ? Object.fromEntries(
          Object.entries(all).filter(([k, v]) => {
            const was = { ...editing, nextBilling: editing.nextBilling?.slice(0, 10) ?? "" }[k as keyof SubItem];
            return v !== was;
          }),
        )
      : all;
    if (editing && Object.keys(body).length === 0) return close();
    savingRef.current = true;
    setBusy(true);
    setError(undefined);
    (editing ? patch<SubItem>(`/finance/subscriptions/${editing.id}`, body) : post<SubItem>("/finance/subscriptions", body))
      .then((s) => {
        if (mountedRef.current) finish(() => onSaved(s));
      })
      .catch((err: ApiError) => {
        if (mountedRef.current) setError({ message: err.message, fields: err.details });
      })
      .finally(() => {
        savingRef.current = false;
        if (mountedRef.current) setBusy(false);
      });
  }

  const canPay = editing && onPay && editing.status === "Aktif" && editing.nextBilling;

  return (
    <SheetFrame
      formRef={formRef}
      closing={closing}
      onDismiss={close}
      titleId={titleId}
      title={editing ? (locked ? editing.name : "Edit subscription") : "New subscription"}
      busy={busy}
      onSubmit={submit}
      aside={
        <fieldset disabled={locked} className="contents">
          <Toggle<Cycle>
            options={[
              { value: "Bulanan", label: "Monthly" },
              { value: "Tahunan", label: "Yearly" },
            ]}
            value={cycle}
            onChange={setCycle}
          />
        </fieldset>
      }
    >
      {canPay ? (
        <button
          type="button"
          onClick={() => finish(() => onPay(editing))}
          className="mt-32 w-full rounded-card border border-green bg-card px-24 py-20 text-left text-body text-green hover:bg-panel"
        >
          <b>Mark as paid</b>
          <span className="block text-small text-muted">
            Records the {shortDate(editing.nextBilling)} bill and moves Next Billing on. You can edit the amount first.
          </span>
        </button>
      ) : null}

      <fieldset disabled={locked} className="mt-32 grid min-w-0 gap-28 text-body">
        <Field label="Name">
          <input ref={first} required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Spotify" className={inputClass} />
          <FieldError fields={error?.fields} name="name" />
        </Field>
        <Field label="Price">
          <AmountInput required value={price} onChange={setPrice} placeholder="59.900" className={inputClass} />
          <FieldError fields={error?.fields} name="price" />
        </Field>
        <Field label="Next Billing">
          <input type="date" required value={nextBilling} onChange={(e) => setNextBilling(e.target.value)} className={inputClass} />
          <FieldError fields={error?.fields} name="nextBilling" />
        </Field>
        <Field label="Status">
          <Select aria-label="Status" disabled={locked} value={status} onChange={setStatus} options={STATUSES} className={inputClass} />
          <FieldError fields={error?.fields} name="status" />
        </Field>
        <Field label="Notes">
          <textarea maxLength={1000} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} resize-none`} />
          <FieldError fields={error?.fields} name="notes" />
        </Field>
        <Check checked={notes.toLowerCase().includes(PRICE_MAY_CHANGE)} onChange={(on) => setNotes(withPriceNote(notes, on))}>
          The price may change at the next renewal (shows a reminder)
        </Check>
      </fieldset>

      {error ? <SheetError message={error.message} /> : null}

      {locked ? <SheetReadActions onClose={close} onEdit={unlock} editRef={editButton} /> : <SheetActions closing={closing} onCancel={close} busy={busy} />}
    </SheetFrame>
  );
}
