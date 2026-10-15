"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ApiError, post } from "@/lib/api";
import { nowWIB } from "@/lib/format";
import type { Options, Transaction } from "@/lib/types";
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
  const titleId = useId();

  useEffect(() => {
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: FormEvent | null, allowDuplicate = false) {
    e?.preventDefault();
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
      setName("");
      setAmount("");
      setNotes("");
      setExcluded(false);
      setAllowance(false);
      onSaved(t);
    } catch (err) {
      const a = err as ApiError;
      setError({ message: a.message, fields: a.details, duplicate: a.code === "duplicate" });
    } finally {
      setBusy(false);
    }
  }

  const fieldError = (key: string) => (error?.fields?.[key] ? <span className="text-small text-maroon">{String(error.fields[key])}</span> : null);
  const categories = options?.Category ?? [];
  const accounts = options?.Account ?? ["Mandiri Debit"];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="scroll-thin max-h-[92dvh] w-full max-w-[480px] overflow-y-auto rounded-t-[max(16px,calc(var(--spacing)*40))] bg-page px-60 pt-40 pb-60 shadow-2xl"
      >
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
            <Field label="Category">
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={input}>
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              {fieldError("category")}
            </Field>
          ) : null}
          <Field label="Account">
            <select value={account} onChange={(e) => setAccount(e.target.value)} className={input}>
              {accounts.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
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
          <div className="mt-28 rounded-card bg-panel p-24 text-body text-maroon">
            {error.message}
            {error.duplicate ? (
              <button type="button" onClick={() => submit(null, true)} className="mt-12 block text-blue underline">
                Save it again as a separate transaction
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-40 flex gap-24">
          <button type="button" onClick={onClose} className="flex-1 rounded-card bg-panel py-24 text-body text-muted">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex-[2] rounded-card py-24 text-body font-bold text-white disabled:opacity-60"
            style={{ background: "linear-gradient(90deg, #165d23, #866633)" }}
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

const input =
  "w-full rounded-card border border-line bg-card px-24 py-16 text-body text-ink outline-none focus:border-green focus:ring-2 focus:ring-green/20";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-8">
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
