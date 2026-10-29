"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { shortDate, signedRupiah } from "@/lib/format";
import type { Cashflow, Summary, Transaction } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { CashflowChart } from "../Charts";
import { DataTable } from "../DataTable";
import { Card, Chevron, Figure, Note, PageHeader, Panel, Toggle } from "../ui";

type Kind = "all" | "income" | "outcome";
type Granularity = "monthly" | "weekly";

export function FinanceDashboard() {
  const [kind, setKind] = useState<Kind>("all");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const summary = useApi<Summary>("/finance/summary");
  const cashflow = useApi<Cashflow>(`/finance/cashflow?granularity=${granularity}`);
  const txs = useApi<Transaction[]>(`/finance/transactions?kind=${kind}&limit=100`);

  const points = useMemo(
    () =>
      (cashflow.data?.points ?? []).map((p) => ({
        label: p.label,
        value: kind === "income" ? p.income : kind === "outcome" ? p.outcome : p.net,
      })),
    [cashflow.data, kind],
  );

  return (
    <>
      <PageHeader title="Finance Assistant" subtitle="My personal finance tracker" back="/" />

      <div className="mt-28">
        {summary.error ? <Note tone="error">{summary.error.message}</Note> : <Figure label="Balance" value={summary.data ? summary.data.balance : "..."} />}
      </div>

      <Panel className="mt-24">
        <div className="flex items-center justify-between px-6 pb-16">
          <h2 className="text-heading-green text-heading">Cash Flow</h2>
          <label className="relative">
            <span className="sr-only">Group by</span>
            <select
              value={granularity}
              onChange={(e) => setGranularity(e.target.value as Granularity)}
              className="appearance-none rounded-card bg-card py-10 pr-64 pl-28 text-small text-ink outline-none"
            >
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </select>
            <Chevron className="pointer-events-none absolute top-1/2 right-24 -translate-y-1/2 rotate-90 text-small text-muted" />
          </label>
        </div>

        <Card>
          <CashflowChart
            points={points}
            toggle={
              <Toggle<Kind>
                options={[
                  { value: "all", label: "All" },
                  { value: "income", label: "Income" },
                  { value: "outcome", label: "Outcome" },
                ]}
                value={kind}
                onChange={setKind}
              />
            }
          />
        </Card>

        <Card className="mt-28">
          <DataTable<Transaction>
            size="small"
            visibleRows={4}
            rows={txs.data ?? []}
            rowKey={(t) => t.id}
            empty={txs.loading ? "Loading..." : txs.error ? txs.error.message : "No transactions."}
            columns={[
              { key: "date", label: "Date", width: 150, align: "center", cell: (t) => shortDate(t.date) },
              {
                key: "amount",
                label: "Amount",
                width: 200,
                cell: (t) => signedRupiah(t.type === "Keluar" ? -(t.amount ?? 0) : t.amount ?? 0),
                className: (t) => (t.type === "Keluar" ? "text-maroon" : "text-green"),
              },
              { key: "name", label: "Name", width: 330, cell: (t) => t.name },
            ]}
          />
        </Card>
      </Panel>

      <nav className="mt-58 grid grid-cols-2 gap-60 px-106">
        <Link href="/finance/subscriptions" className="flex h-292 flex-col justify-between rounded-card bg-sky p-28 text-blue">
          <span className="text-heading">Subscriptions</span>
          <Chevron className="self-end text-[max(36px,calc(var(--spacing)*100))]" />
        </Link>
        <Link href="/finance/quota" className="flex h-292 flex-col justify-between rounded-card bg-mint p-28 text-green">
          <span className="text-heading">Weekly Spending Quota</span>
          <Chevron className="self-end text-[max(36px,calc(var(--spacing)*100))]" />
        </Link>
      </nav>
    </>
  );
}
