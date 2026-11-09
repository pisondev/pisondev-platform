"use client";

import { useState } from "react";
import { rupiah, shortDate } from "@/lib/format";
import type { SubItem, Subscriptions } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { MONTHLY_SWATCHES, SubscriptionChart, swatchFor, YEARLY_SWATCHES } from "../Charts";
import { DataTable } from "../DataTable";
import { AnimatedMoney } from "../Motion";
import { Card, Note, PageHeader, Panel, Toggle } from "../ui";

type Cycle = "monthly" | "yearly";

// Put this phrase in a subscription's Notes in Notion while its next price is unknown;
// remove it once the new price is in.
const PRICE_MAY_CHANGE = "harga bisa berubah";
const mayChange = (s: SubItem) => s.notes.toLowerCase().includes(PRICE_MAY_CHANGE);

export function SubscriptionsScreen() {
  const [cycle, setCycle] = useState<Cycle>("monthly");
  const { data, error, loading } = useApi<Subscriptions>("/finance/subscriptions");
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
          <span className="rounded-card bg-card px-20 py-6 text-body font-bold text-maroon">{data ? <>-<AnimatedMoney value={group.total} /></> : loading ? "..." : "-"}</span>
        </div>
        <Card>
          <DataTable<SubItem>
            rows={group.items}
            rowKey={(s) => s.id}
            empty={loading ? "Loading..." : "No subscriptions."}
            columns={[
              { key: "no", label: "No.", width: 86, align: "center", cell: (_, i) => i + 1 },
              {
                key: "date",
                label: "Date",
                width: 180,
                align: "center",
                cell: (s) => (cycle === "monthly" ? s.billingDay ?? shortDate(s.nextBilling).split(" ")[1] : shortDate(s.nextBilling)),
              },
              { key: "amount", label: "Amount", width: 228, cell: (s) => `-${rupiah(s.price)}${mayChange(s) ? "*" : ""}` },
              { key: "name", label: "Name", width: 320, cell: (s) => s.name },
            ]}
            rowStyle={color}
          />
        </Card>
        {changing.length ? (
          <div role="note" className="motion-feedback mt-28 rounded-card bg-card px-24 py-16 text-small text-gold">
            {changing.map((s) => (
              <p key={s.id}>
                * {s.name}: the price may change at the next renewal{s.nextBilling ? ` (${shortDate(s.nextBilling)}, ${s.nextBilling.slice(0, 4)})` : ""}.
                Update it in Notion once the new price is known.
              </p>
            ))}
          </div>
        ) : null}
      </Panel>
    </>
  );
}
