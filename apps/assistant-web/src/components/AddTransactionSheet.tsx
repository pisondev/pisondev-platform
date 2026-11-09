"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, del, patch, post } from "@/lib/api";
import { nowWIB, rupiah, rupiahDigits, shortDate } from "@/lib/format";
import type { Options, SubItem, Transaction } from "@/lib/types";
import { AmountInput, formatAmount, parseAmount } from "./AmountInput";
import { Select } from "./Select";
import { Check, DeleteButton, Field, FieldError, SheetActions, SheetError, SheetFrame, inputClass, useSheet } from "./Sheet";
import { Toggle } from "./ui";

// Must match FINANCE_EXCLUDE_MARKER on the API and the sheet formula.
const EXCLUDE_MARKER = "dikecualikan dari kuota";

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

// Names and notes follow the rows already in Notion, so the sheet groups them the same way.
// Subscriptions follow the allowance, soonest bill first.
function templates(weeklyAllowance: number, subscriptions: SubItem[]): Template[] {
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
    ...bills,
  ];
}

const markerPattern = /(,\s*)?dikecualikan dari kuota(\s*,)?/gi;

/** Adds or removes the exclusion phrase in the notes text itself, so edits stay visible. */
function withMarker(notes: string, on: boolean): string {
  const has = notes.toLowerCase().includes(EXCLUDE_MARKER);
  if (on && !has) return notes.trim() ? `${notes.trim()}, ${EXCLUDE_MARKER}` : EXCLUDE_MARKER;
  if (!on && has) return notes.replace(markerPattern, (_, a, b) => (a && b ? ", " : "")).trim();
  return notes;
}

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
  editing,
  payFor,
}: {
  onClose: () => void;
  onSaved: (t: Transaction) => void;
  onDeleted?: (t: Transaction) => void;
  options: Options | undefined;
  weeklyAllowance?: number;
  subscriptions?: SubItem[];
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
  const [excluded, setExcluded] = useState(false);
  const [allowance, setAllowance] = useState(false);
  const [pays, setPays] = useState<Template["pays"]>();
  const [markPaid, setMarkPaid] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fields?: Record<string, unknown>; duplicate?: boolean }>();
  const [template, setTemplate] = useState<string>();
  const first = useRef<HTMLInputElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const { formRef, savingRef, mountedRef, dismissingRef, closing, close, finish } = useSheet(onClose, payFor ? amountInput : first);
  const titleId = useId();
  const list = templates(weeklyAllowance, subscriptions);
  const excludedNow = editing ? notes.toLowerCase().includes(EXCLUDE_MARKER) : excluded;

  function apply(t: Template) {
    setKind(t.kind);
    setName(t.name);
    setAmount(formatAmount(rupiahDigits(t.amount)));
    if (t.category) setCategory(t.category);
    setAccount(t.account);
    setDate(t.date ?? nowWIB());
    setNotes(t.notes);
    setExcluded(false);
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
        notes: kind === "Keluar" ? withMarker(notes, excluded) : notes.trim(),
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
      title={editing ? "Edit transaction" : "New transaction"}
      busy={busy}
      onSubmit={submit}
      aside={
        <Toggle<Kind>
          options={[
            { value: "Keluar", label: "Expense" },
            { value: "Masuk", label: "Income" },
          ]}
          value={kind}
          onChange={setKind}
        />
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
                  {t.kind === "Masuk" ? "Income" : "Expense"} · {rupiah(t.amount)}
                  {t.date ? ` · ${shortDate(t.date)}` : ""}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-32 grid gap-28 text-body">
        <Field label="Name">
          <input ref={first} required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} placeholder="Roti O" className={inputClass} />
          <FieldError fields={error?.fields} name="name" />
        </Field>
        <Field label="Amount">
          <AmountInput ref={amountInput} required value={amount} onChange={setAmount} placeholder="25.000 or 25rb" className={inputClass} />
          <FieldError fields={error?.fields} name="amount" />
        </Field>
        {kind === "Keluar" ? (
          <Field label="Category" animated>
            <Select aria-label="Category" value={category} onChange={setCategory} options={categories.map((c) => ({ value: c, label: c }))} className={inputClass} />
            <FieldError fields={error?.fields} name="category" />
          </Field>
        ) : null}
        <Field label="Account">
          <Select aria-label="Account" value={account} onChange={setAccount} options={accounts.map((a) => ({ value: a, label: a }))} className={inputClass} />
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
          <Check checked={excludedNow} onChange={(on) => (editing ? setNotes(withMarker(notes, on)) : setExcluded(on))}>
            Paid back by someone else (left out of the quota)
          </Check>
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
      </div>

      {error ? (
        <SheetError message={error.message}>
          {error.duplicate ? (
            <button type="button" onClick={() => submit(null, true)} className="mt-12 block text-blue underline">
              Save it again as a separate transaction
            </button>
          ) : null}
        </SheetError>
      ) : null}

      <SheetActions closing={closing} onCancel={close} busy={busy} disabled={!options} extra={editing ? <DeleteButton busy={busy} onDelete={remove} /> : undefined} />
    </SheetFrame>
  );
}
