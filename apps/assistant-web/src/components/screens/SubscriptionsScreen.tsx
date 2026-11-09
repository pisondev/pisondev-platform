"use client";

import { useCallback, useState } from "react";
import { rupiah, shortDate } from "@/lib/format";
import type { Options, Quota, SubItem, Subscriptions } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { AddTransactionSheet } from "../AddTransactionSheet";
import { MONTHLY_SWATCHES, SubscriptionChart, swatchFor, YEARLY_SWATCHES } from "../Charts";
import { DataTable } from "../DataTable";
import { AnimatedMoney } from "../Motion";
import { SubscriptionSheet } from "../SubscriptionSheet";
import { Card, Note, PageHeader, Panel, Toggle } from "../ui";
import { SenText } from "../SenText";

type Cycle = "monthly" | "yearly";

// This phrase in a subscription's Notes marks a price that may change at renewal. The
// edit sheet sets and clears it with a checkbox.
const PRICE_MAY_CHANGE = "harga bisa berubah";
const mayChange = (s: SubItem) => s.notes.toLowerCase().includes(PRICE_MAY_CHANGE);

export function SubscriptionsScreen() {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const { data, error, loading, reload } = useApi<Subscriptions>("/finance/subscriptions");
  const options = useApi<Options>("/finance/options");
  const quota = useApi<Quota>("/finance/quota");
  // The sheet open: a new subscription (null), one being edited, or a bill being paid.
  const [editing, setEditing] = useState<SubItem | null>();
  const [paying, setPaying] = useState<SubItem>();
  const [saved, setSaved] = useState<string>();
  const closeEdit = useCallback(() => setEditing(undefined), []);
  const closePay = useCallback(() => setPaying(undefined), []);
  const group = data?.[cycle] ?? { items: [], total: 0 };
  const swatches = cycle === "monthly" ? MONTHLY_SWATCHES : YEARLY_SWATCHES;
  // Each row and bar takes its subscription colour, as in the design.
  const color = (s: SubItem, i: number) => ({ color: swatchFor(s.name, i, swatches).text });
  const changing = data ? [...data.monthly.items, ...data.yearly.items].filter(mayChange) : [];

  return (
    <>
      <PageHeader title="Subscriptions" subtitle="Your subscription list" back="/finance" />
      {error ? <Note tone="error">{error.message}</Note> : null}

      <Panel className="mt-38">
        <Card>
          <SubscriptionChart
            items={group.items}
            swatches={swatches}
            toggle={
              <Toggle<Cycle>
                options={[
                  { value: "monthly", label: "Monthly" },
                  { value: "yearly", label: "Yearly" },
                ]}
                value={cycle}
                onChange={setCycle}
              />
            }
          />
        </Card>

        <hr className="mx-16 my-38 border-0 border-t-[max(1.5px,calc(var(--spacing)*3))] border-line" />

        <div className="flex items-center justify-between px-6 pb-16">
          <h2 className="text-heading-red text-heading">{cycle === "monthly" ? "Monthly" : "Yearly"} Subscription</h2>
          <div className="flex items-center gap-16">
            <span className="rounded-card bg-card px-20 py-6 text-body font-bold text-maroon">{data ? <>-<AnimatedMoney value={group.total} /></> : loading ? "..." : "-"}</span>
            <button
              type="button"
              onClick={() => setEditing(null)}
              aria-label="Add a subscription"
              className="flex size-[max(34px,calc(var(--spacing)*68))] items-center justify-center rounded-full bg-card text-heading font-bold"
            >
              <span className="text-heading-red">+</span>
            </button>
          </div>
        </div>
        {saved ? <p role="status" className="motion-feedback px-6 pb-12 text-small text-green">{saved}</p> : null}
        <Card>
          <DataTable<SubItem>
            rows={group.items}
            rowKey={(s) => s.id}
            empty={loading ? "Loading..." : "No subscriptions."}
            columns={[
              { key: "no", label: "No.", width: 70, align: "center", cell: (_, i) => i + 1 },
              {
                key: "date",
                label: "Date",
                width: 150,
                align: "center",
                cell: (s) => (cycle === "monthly" ? s.billingDay ?? shortDate(s.nextBilling).split(" ")[1] : shortDate(s.nextBilling)),
              },
              { key: "amount", label: "Amount", width: 300, cell: (s) => <SenText text={`-${rupiah(s.price)}${mayChange(s) ? "*" : ""}`} /> },
              { key: "name", label: "Name", width: 300, cell: (s) => s.name },
            ]}
            rowStyle={color}
            onRowClick={setEditing}
            rowLabel={(s) => `Edit ${s.name}`}
          />
        </Card>
        <p className="px-6 pt-12 text-small text-muted">Tap a subscription to edit it or mark its bill as paid.</p>
        {changing.length ? (
          <div role="note" className="motion-feedback mt-28 rounded-card bg-card px-24 py-16 text-small text-gold">
            {changing.map((s) => (
              <p key={s.id}>
                * {s.name}: the price may change at the next renewal{s.nextBilling ? ` (${shortDate(s.nextBilling)}, ${s.nextBilling.slice(0, 4)})` : ""}.
                Edit it here once the new price is known.
              </p>
            ))}
          </div>
        ) : null}
        {data?.inactive.length ? (
          <>
            <h3 className="px-6 pt-32 pb-12 text-body text-muted">Paused or stopped</h3>
            <Card>
              <DataTable<SubItem>
                size="small"
                rows={data.inactive}
                rowKey={(s) => s.id}
                columns={[
                  { key: "name", label: "Name", width: 320, cell: (s) => s.name },
                  { key: "status", label: "Status", width: 160, cell: (s) => (s.status === "Dijeda" ? "Paused" : "Stopped") },
                  { key: "amount", label: "Amount", width: 228, cell: (s) => <SenText text={rupiah(s.price)} /> },
                ]}
                rowClassName={() => "text-muted"}
                onRowClick={setEditing}
                rowLabel={(s) => `Edit ${s.name}`}
              />
            </Card>
          </>
        ) : null}
      </Panel>

      {editing !== undefined ? (
        <SubscriptionSheet
          editing={editing ?? undefined}
          onClose={closeEdit}
          onSaved={(s) => {
            setEditing(undefined);
            setSaved(`Saved ${s.name}. It reaches Notion within a minute.`);
            reload();
          }}
          onPay={(s) => {
            setEditing(undefined);
            setPaying(s);
          }}
        />
      ) : null}
      {paying ? (
        <AddTransactionSheet
          onClose={closePay}
          options={options.data}
          weeklyAllowance={quota.data?.breakdown.weeklyAllowance}
          subscriptions={data ? [...data.monthly.items, ...data.yearly.items] : []}
          payFor={paying}
          onSaved={(t) => {
            setPaying(undefined);
            setSaved(`Recorded ${t.name}, ${rupiah(t.amount)}.`);
            reload();
          }}
        />
      ) : null}
    </>
  );
}
