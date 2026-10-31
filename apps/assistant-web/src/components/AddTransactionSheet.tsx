"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ApiError, post } from "@/lib/api";
import { nowWIB } from "@/lib/format";
import type { Options, Transaction } from "@/lib/types";
import { Select } from "./Select";
import { Toggle } from "./ui";

// Must match FINANCE_EXCLUDE_MARKER on the API and the sheet formula.
const EXCLUDE_MARKER = "dikecualikan dari kuota";

type Kind = "Keluar" | "Masuk";

/** Parses "25000", "25.000", "Rp25.000" or "25rb" into rupiah. */
function parseAmount(raw: string): number {
  const s = raw.trim().toLowerCase().replace(/^rp/, "");
  const k = /^(\d+(?:[.,]\d+)?)\s*(rb|k)$/.exec(s);
  if (k) return Math.round(parseFloat(k[1].replace(",", ".")) * 1000);
  return Number(s.replace(/[.,\s]/g, "")) || 0;
}

/** Mounted only while open, so every opening starts from a fresh form. */
export function AddTransactionSheet({
  onClose,
  onSaved,
  options,
}: {
  onClose: () => void;
  onSaved: (t: Transaction) => void;
  options: Options | undefined;
}) {
  const [kind, setKind] = useState<Kind>("Keluar");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("Makan");
  const [account, setAccount] = useState("Mandiri Debit");
  const [date, setDate] = useState(nowWIB);
  const [notes, setNotes] = useState("");
  const [excluded, setExcluded] = useState(false);
  const [allowance, setAllowance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fields?: Record<string, unknown>; duplicate?: boolean }>();
  const first = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const saving = useRef(false);
  const mounted = useRef(false);
  const dismissing = useRef(false);
  const exitTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const afterExit = useRef(onClose);
  const [closing, setClosing] = useState(false);
  const titleId = useId();

  const close = useCallback(() => {
    if (saving.current || dismissing.current) return;
    dismissing.current = true;
    afterExit.current = onClose;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return onClose();
    setClosing(true);
    exitTimer.current = setTimeout(onClose, 180);
  }, [onClose]);

  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = document.querySelector("main");
    const wasInert = background?.inert ?? false;
    const overflow = document.body.style.overflow;
    if (background) background.inert = true;
    document.body.style.overflow = "hidden";
    first.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); close(); }
      if (e.key !== "Tab") return;
      const controls = Array.from(form.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
      ) ?? []).filter((node) => node.getClientRects().length > 0);
      const start = controls[0], end = controls[controls.length - 1];
      if (!start) { e.preventDefault(); form.current?.focus(); return; }
      if (e.shiftKey && (document.activeElement === start || document.activeElement === form.current)) {
        e.preventDefault(); end.focus();
      } else if (!e.shiftKey && (document.activeElement === end || !form.current?.contains(document.activeElement))) {
        e.preventDefault(); start.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      mounted.current = false;
      clearTimeout(exitTimer.current);
      window.removeEventListener("keydown", onKey);
      if (background) background.inert = wasInert;
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [close]);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finish = () => {
      if (preference.matches && dismissing.current) {
        clearTimeout(exitTimer.current);
        afterExit.current();
      }
    };
    preference.addEventListener("change", finish);
    return () => preference.removeEventListener("change", finish);
  }, [onClose]);

  async function submit(e: FormEvent | null, allowDuplicate = false) {
    e?.preventDefault();
    if (saving.current || dismissing.current || !options) return;
    saving.current = true;
    setBusy(true);
    setError(undefined);
    let finalNotes = notes.trim();
    if (kind === "Keluar" && excluded && !finalNotes.toLowerCase().includes(EXCLUDE_MARKER)) {
      finalNotes = finalNotes ? `${finalNotes}, ${EXCLUDE_MARKER}` : EXCLUDE_MARKER;
    }
    try {
      const t = await post<Transaction>("/finance/transactions", {
        type: kind,
        name,
        amount: parseAmount(amount),
        category: kind === "Keluar" ? category : "",
        account,
        date,
        notes: finalNotes,
        weeklyAllowance: kind === "Masuk" && allowance,
        allowDuplicate,
      });
      if (!mounted.current) return;
      setName("");
      setAmount("");
      setNotes("");
      setExcluded(false);
      setAllowance(false);
      dismissing.current = true;
      afterExit.current = () => onSaved(t);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        onSaved(t);
      } else {
        setClosing(true);
        exitTimer.current = setTimeout(() => afterExit.current(), 180);
      }
    } catch (err) {
      if (!mounted.current) return;
      const a = err as ApiError;
      setError({ message: a.message, fields: a.details, duplicate: a.code === "duplicate" });
    } finally {
      saving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const fieldError = (key: string) => (error?.fields?.[key] ? <span className="text-small text-maroon">{String(error.fields[key])}</span> : null);
  const categories = options?.Category ?? [];
  const accounts = options?.Account ?? ["Mandiri Debit"];

  return createPortal(
    <div data-closing={closing} className="transaction-overlay fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={close}>
      <form
        ref={form}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="transaction-sheet scroll-thin max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-[max(16px,calc(var(--spacing)*40))] bg-page px-60 pt-40 pb-60 shadow-2xl"
      >
        <fieldset disabled={busy || closing} className="contents">
        <div className="mx-auto mb-24 h-10 w-120 rounded-full bg-line" />
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-heading-red text-heading">
            New transaction
          </h2>
          <Toggle<Kind>
            options={[
              { value: "Keluar", label: "Expense" },
              { value: "Masuk", label: "Income" },
            ]}
            value={kind}
            onChange={setKind}
          />
        </div>

        <div className="mt-32 grid gap-28 text-body">
          <Field label="Name">
            <input ref={first} required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Roti O" className={input} />
            {fieldError("name")}
          </Field>
          <Field label="Amount">
            <input required inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.000 or 25rb" className={input} />
            {fieldError("amount")}
          </Field>
          {kind === "Keluar" ? (
            <Field label="Category" animated>
              <Select aria-label="Category" value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c }))} className={input} />
              {fieldError("category")}
            </Field>
          ) : null}
          <Field label="Account">
            <Select aria-label="Account" value={account} onChange={setAccount} options={accounts.map((a) => ({ value: a, label: a }))} className={input} />
            {fieldError("account")}
          </Field>
          <Field label="Date (WIB)">
            <input type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} className={input} />
            {fieldError("date")}
          </Field>
          <Field label="Notes">
            <textarea maxLength={500} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${input} resize-none`} />
            {fieldError("notes")}
          </Field>
          {kind === "Keluar" ? (
            <Check checked={excluded} onChange={setExcluded}>
              Paid back by someone else (left out of the quota)
            </Check>
          ) : (
            <Check checked={allowance} onChange={setAllowance}>
              Weekly allowance (starts a new week)
            </Check>
          )}
        </div>

        {error ? (
          <div role="alert" className="motion-feedback mt-28 rounded-card bg-panel p-24 text-body text-maroon">
            {error.message}
            {error.duplicate ? (
              <button type="button" onClick={() => submit(null, true)} className="mt-12 block text-blue underline">
                Save it again as a separate transaction
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-40 flex gap-24">
          <button type="button" onClick={close} disabled={busy || closing} className="flex-1 rounded-card bg-panel py-24 text-body text-muted disabled:opacity-60">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || closing || !options}
            aria-busy={busy || undefined}
            className="flex-[2] rounded-card py-24 text-body font-bold text-white disabled:opacity-60"
            style={{ background: "linear-gradient(90deg, #165d23, #866633)" }}
          >
            <span className={busy ? "motion-busy" : undefined}>{busy ? "Saving..." : "Save"}</span>
          </button>
        </div>
        </fieldset>
      </form>
    </div>,
    document.body,
  );
}

const input =
  "w-full rounded-card border border-line bg-card px-24 py-16 text-body text-ink outline-none focus:border-green focus:ring-2 focus:ring-green/20";

function Field({ label, children, animated = false }: { label: string; children: ReactNode; animated?: boolean }) {
  return (
    <label className={`grid gap-8 ${animated ? "motion-feedback" : ""}`}>
      <span className="text-small text-muted">{label}</span>
      {children}
    </label>
  );
}

function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-16 text-small text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-[max(16px,calc(var(--spacing)*40))] accent-green" />
      {children}
    </label>
  );
}
