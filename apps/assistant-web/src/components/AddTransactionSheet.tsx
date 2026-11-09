"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, del, patch, post } from "@/lib/api";
import { nowWIB, rupiah, rupiahDigits, shortDate } from "@/lib/format";
import type { Options, SubItem, Transaction } from "@/lib/types";
import { AmountInput, formatAmount, parseAmount } from "./AmountInput";
import { Select } from "./Select";
import { Check, DeleteButton, Field, FieldError, SheetActions, SheetError, SheetFrame, SheetReadActions, inputClass, useSheet } from "./Sheet";
import { Toggle } from "./ui";
import { SenText } from "./SenText";

// Must match FINANCE_EXCLUDE_MARKER on the API and the sheet formula.
const EXCLUDE_MARKER = "dikecualikan dari kuota";
// Must match finance.SavingsMarker: money moved to a savings account.
const SAVINGS_MARKER = "dipindah ke tabungan";

type Kind = "Keluar" | "Masuk";

/** A routine transaction that fills the form; nothing is saved until Save. */
type Template = {
  id: string;
  title: string;
  kind: Kind;
  name: string;
  amount: number;
  account: string;
  notes: string;
  category?: string;
  allowance?: boolean;
  date?: string; // YYYY-MM-DDTHH:mm, now when absent
  pays?: { id: string; name: string; from: string }; // the subscription bill it pays
};

// The API takes dates from 60 days ago up to tomorrow.
const DAY = 86_400_000;
function inRange(day: string, today: string): boolean {
  const diff = (Date.parse(day) - Date.parse(today)) / DAY;
  return diff >= -60 && diff <= 0;
}

/** A subscription bill: on its billing day at 10:00, or today at 10:00 before it is due. */
function subscriptionTemplate(s: SubItem, today: string): Template {
  const due = s.nextBilling?.slice(0, 10);
  return {
    id: `sub-${s.id}`,
    title: s.name,
    kind: "Keluar",
    name: /^paket\b/i.test(s.name) ? s.name : `Tagihan ${s.name}`,
    amount: s.price,
    account: "Mandiri Debit",
    category: "Langganan",
    notes: `Tagihan ${s.cycle === "Tahunan" ? "tahunan" : "bulanan"}.`,
    date: `${due && inRange(due, today) ? due : today}T10:00`,
    pays: s.nextBilling ? { id: s.id, name: s.name, from: s.nextBilling } : undefined,
  };
}

/**
 * What closed bill cycles have not moved to savings yet (from the Bill cycle cash flow),
 * and what today's balance allows above the Rp50.000 minimum.
 */
export type SavingHint = { amount: number; cycle: string; available: number };

// Names and notes follow the rows already in Notion, so the sheet groups them the same way.
// The allowance comes first, then the move to savings, then subscriptions, soonest first.
function templates(weeklyAllowance: number, subscriptions: SubItem[], saving?: SavingHint): Template[] {
  const today = nowWIB().slice(0, 10);
  const bills = [...subscriptions]
    .sort((a, b) => (a.nextBilling ?? "9999").localeCompare(b.nextBilling ?? "9999"))
    .map((s) => subscriptionTemplate(s, today));
  return [
    {
      id: "allowance",
      title: "Uang Saku Mingguan",
      kind: "Masuk",
      name: "Uang saku mingguan",
      amount: weeklyAllowance,
      account: "Mandiri Debit",
      notes: "Sangu rutin.",
      allowance: true,
    },
    ...(saving
      ? [
          {
            id: "saving",
            title: "Pindah ke Tabungan",
            kind: "Keluar" as const,
            name: "Pindah ke tabungan",
            amount: saving.amount,
            account: "Mandiri Debit",
            category: "Lainnya",
            notes: `Sisihkan siklus ${saving.cycle}, ${SAVINGS_MARKER}, ${EXCLUDE_MARKER}`,
          },
        ]
      : []),
    ...bills,
  ];
}

const markerPattern = /(,\s*)?dikecualikan dari kuota(\s*,)?/gi;

const savingsPattern = /(,\s*)?dipindah ke tabungan(\s*,)?/gi;

/** Adds or removes a phrase in the notes text itself, so the change stays visible. */
function withPhrase(notes: string, phrase: string, pattern: RegExp, on: boolean): string {
  const has = notes.toLowerCase().includes(phrase);
  if (on && !has) return notes.trim() ? `${notes.trim()}, ${phrase}` : phrase;
  if (!on && has) return notes.replace(pattern, (_, a, b) => (a && b ? ", " : "")).trim();
  return notes;
}
const withMarker = (notes: string, on: boolean) => withPhrase(notes, EXCLUDE_MARKER, markerPattern, on);
// A move to savings also carries the exclusion phrase, so the sheet's quota skips it too.
const withSavings = (notes: string, on: boolean) =>
  on ? withMarker(withPhrase(notes, SAVINGS_MARKER, savingsPattern, true), true) : withPhrase(notes, SAVINGS_MARKER, savingsPattern, false);

/** datetime-local needs a time; the API turns 00:00 back into a plain date. */
const inputDate = (d: string) => (d.length === 10 ? `${d}T00:00` : d.slice(0, 16));

/**
 * New or edited transaction. Mounted only while open, so every opening starts fresh.
 * `editing` turns it into the edit form with Delete; `payFor` opens it on that
 * subscription's bill.
 */
export function AddTransactionSheet({
  onClose,
  onSaved,
  onDeleted,
  options,
  weeklyAllowance = 250000,
  subscriptions = [],
  saving,
  editing,
  payFor,
}: {
  onClose: () => void;
  onSaved: (t: Transaction) => void;
  onDeleted?: (t: Transaction) => void;
  options: Options | undefined;
  weeklyAllowance?: number;
  subscriptions?: SubItem[];
  saving?: SavingHint;
  editing?: Transaction;
  payFor?: SubItem;
}) {
  const [kind, setKind] = useState<Kind>(editing?.type === "Masuk" ? "Masuk" : "Keluar");
  const [name, setName] = useState(editing?.name ?? "");
  const [amount, setAmount] = useState(editing?.amount != null ? formatAmount(rupiahDigits(editing.amount)) : "");
  const [category, setCategory] = useState(editing?.category || "Makan");
  const [account, setAccount] = useState(editing?.account || "Mandiri Debit");
  const [date, setDate] = useState(() => (editing?.date ? inputDate(editing.date) : nowWIB()));
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [allowance, setAllowance] = useState(false);
  const [pays, setPays] = useState<Template["pays"]>();
  const [markPaid, setMarkPaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fields?: Record<string, unknown>; duplicate?: boolean }>();
  const [template, setTemplate] = useState<string>();
  const first = useRef<HTMLInputElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  // An existing transaction opens read-only; Edit unlocks it, so a stray tap changes nothing.
  const [locked, setLocked] = useState(!!editing);
  const editButton = useRef<HTMLButtonElement>(null);
  const { formRef, savingRef, mountedRef, dismissingRef, closing, close, finish } = useSheet(
    onClose,
    payFor ? amountInput : editing ? editButton : first,
  );
  const unlock = () => setLocked(false);
  // Edit disappears as the fields unlock, so focus moves on to the first field.
  const wasLocked = useRef(locked);
  useEffect(() => {
    if (wasLocked.current && !locked) first.current?.focus();
    wasLocked.current = locked;
  }, [locked]);
  const titleId = useId();
  const list = templates(weeklyAllowance, subscriptions, saving);
  const excluded = notes.toLowerCase().includes(EXCLUDE_MARKER);
  const toSavings = notes.toLowerCase().includes(SAVINGS_MARKER);

  function apply(t: Template) {
    setKind(t.kind);
    setName(t.name);
    setAmount(formatAmount(rupiahDigits(t.amount)));
    if (t.category) setCategory(t.category);
    setAccount(t.account);
    setDate(t.date ?? nowWIB());
    setNotes(t.notes);
    setAllowance(t.allowance ?? false);
    setPays(t.pays);
    setMarkPaid(true);
    setError(undefined);
    setTemplate(t.id);
    amountInput.current?.focus();
    amountInput.current?.select();
  }

  // Opened from a subscription's "Mark as paid": start on its bill.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !payFor) return;
    opened.current = true;
    apply(subscriptionTemplate(payFor, nowWIB().slice(0, 10)));
  }, [payFor]);

  async function run(request: () => Promise<void>) {
    if (savingRef.current || dismissingRef.current || !options) return;
    savingRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await request();
    } catch (err) {
      if (!mountedRef.current) return;
      const a = err as ApiError;
      setError({ message: a.message, fields: a.details, duplicate: a.code === "duplicate" });
    } finally {
      savingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  function submit(e: FormEvent | null, allowDuplicate = false) {
    e?.preventDefault();
    if (locked) return;
    const fields = {
      type: kind,
      name,
      amount: parseAmount(amount),
      category: kind === "Keluar" ? category : "",
      account,
      date,
    };
    if (editing) {
      return run(async () => {
        const t = await patch<Transaction>(`/finance/transactions/${editing.id}`, {
          ...fields,
          category: kind === "Keluar" ? category : undefined,
          notes: notes.trim(),
        });
        if (mountedRef.current) finish(() => onSaved(t));
      });
    }
    const paying = kind === "Keluar" && markPaid ? pays : undefined;
    return run(async () => {
      const t = await post<Transaction>("/finance/transactions", {
        ...fields,
        notes: notes.trim(),
        weeklyAllowance: kind === "Masuk" && allowance,
        allowDuplicate,
        paysSubscription: paying?.id ?? "",
        paysFrom: paying?.from ?? "",
      });
      if (mountedRef.current) finish(() => onSaved(t));
    });
  }

  function remove() {
    if (!editing) return;
    return run(async () => {
      await del(`/finance/transactions/${editing.id}`);
      if (mountedRef.current) finish(() => onDeleted?.(editing));
    });
  }

  const categories = options?.Category ?? [];
  const accounts = options?.Account ?? ["Mandiri Debit"];

  return (
    <SheetFrame
      formRef={formRef}
      closing={closing}
      onDismiss={close}
      titleId={titleId}
      title={editing ? (locked ? "Transaction" : "Edit transaction") : "New transaction"}
      busy={busy}
      onSubmit={submit}
      aside={
        <fieldset disabled={locked} className="contents">
          <Toggle<Kind>
            options={[
              { value: "Keluar", label: "Expense" },
              { value: "Masuk", label: "Income" },
            ]}
            value={kind}
            onChange={setKind}
          />
        </fieldset>
      }
    >
      {editing ? null : (
        <div role="group" aria-label="Templates" className="mt-32 grid gap-8">
          <span className="text-small text-muted">Templates</span>
          <div className="scroll-thin -mx-4 flex gap-16 overflow-x-auto px-4 pt-4 pb-12">
            {list.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => apply(t)}
                aria-pressed={template === t.id}
                className={`grid shrink-0 gap-4 rounded-card border bg-card px-24 py-16 text-left transition-colors ${
                  template === t.id ? "border-green ring-2 ring-green/20" : "border-line hover:border-green"
                }`}
              >
                <span className="text-small font-bold text-ink">{t.title}</span>
                <span className={`text-small ${t.kind === "Masuk" ? "text-green" : "text-maroon"}`}>
                  {t.kind === "Masuk" ? "Income" : "Expense"} · <SenText text={rupiah(t.amount)} />
                  {t.date ? ` · ${shortDate(t.date)}` : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <fieldset disabled={locked} className="mt-32 grid min-w-0 gap-28 text-body">
        <Field label="Name">
          <input ref={first} required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Roti O" className={inputClass} />
          <FieldError fields={error?.fields} name="name" />
        </Field>
        <Field label="Amount">
          <AmountInput ref={amountInput} required value={amount} onChange={setAmount} placeholder="25.000 or 25rb" className={inputClass} />
          {saving && toSavings && parseAmount(amount) > saving.available ? (
            <span className="text-small text-gold">
              Moving this leaves less than Rp50.000 in the account: today&apos;s balance allows {rupiah(saving.available)}.
            </span>
          ) : null}
          <FieldError fields={error?.fields} name="amount" />
        </Field>
        {kind === "Keluar" ? (
          <Field label="Category" animated>
            <Select aria-label="Category" disabled={locked} value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c }))} className={inputClass} />
            <FieldError fields={error?.fields} name="category" />
          </Field>
        ) : null}
        <Field label="Account">
          <Select aria-label="Account" disabled={locked} value={account} onChange={setAccount} options={accounts.map((a) => ({ value: a, label: a }))} className={inputClass} />
          <FieldError fields={error?.fields} name="account" />
        </Field>
        <Field label="Date (WIB)">
          <input type="datetime-local" required value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          <FieldError fields={error?.fields} name="date" />
        </Field>
        <Field label="Notes">
          <textarea maxLength={500} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputClass} resize-none`} />
          <FieldError fields={error?.fields} name="notes" />
        </Field>
        {kind === "Keluar" ? (
          <>
            <Check checked={excluded} onChange={(on) => setNotes(withMarker(notes, on))}>
              Paid back by someone else (left out of the quota)
            </Check>
            <Check checked={toSavings} onChange={(on) => setNotes(withSavings(notes, on))}>
              Moved to my savings account (not spending)
            </Check>
          </>
        ) : editing ? null : (
          <Check checked={allowance} onChange={setAllowance}>
            Weekly allowance (starts a new week)
          </Check>
        )}
        {!editing && kind === "Keluar" && pays ? (
          <Check checked={markPaid} onChange={setMarkPaid}>
            Paid the {shortDate(pays.from)} bill: move {pays.name}&apos;s Next Billing on
          </Check>
        ) : null}
        <FieldError fields={error?.fields} name="paysSubscription" />
      </fieldset>

      {error ? (
        <SheetError message={error.message}>
          {error.duplicate ? (
            <button type="button" onClick={() => submit(null, true)} className="mt-12 block text-blue underline">
              Save it again as a separate transaction
            </button>
          ) : null}
        </SheetError>
      ) : null}

      {locked ? (
        <SheetReadActions onClose={close} onEdit={unlock} editRef={editButton} />
      ) : (
        <SheetActions closing={closing} onCancel={close} busy={busy} disabled={!options} extra={editing ? <DeleteButton busy={busy} onDelete={remove} /> : undefined} />
      )}
    </SheetFrame>
  );
}
