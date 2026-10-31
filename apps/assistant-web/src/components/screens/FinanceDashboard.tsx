"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { shortDate, signedRupiah } from "@/lib/format";
import type { Cashflow, CashflowKind as Kind, Granularity, Summary, Transaction } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { CashflowChart, cashflowSeries } from "../Charts";
import { DataTable } from "../DataTable";
import { Select } from "../Select";
import { Card, Chevron, DetailLink, Figure, Note, PageHeader, Panel, Toggle } from "../ui";

export function FinanceDashboard() {
  const [kind, setKind] = useState<Kind>("all");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const summary = useApi<Summary>("/finance/summary");
  const cashflow = useApi<Cashflow>(`/finance/cashflow?granularity=${granularity}`);
  const txs = useApi<Transaction[]>(`/finance/transactions?kind=${kind}&limit=100`);

  const { labels, series } = useMemo(() => cashflowSeries(cashflow.data?.points ?? [], kind), [cashflow.data, kind]);

  return (
    <>
      <PageHeader title="Finance Assistant" subtitle="My personal finance tracker" back="/" />

      <div className="mt-28">
        {summary.error ? <Note tone="error">{summary.error.message}</Note> : <Figure label="Balance" value={summary.data ? summary.data.balance : "..."} />}
      </div>

      <Panel className="mt-24">
        <div className="flex items-center justify-between px-6 pb-16">
          <h2 className="text-heading-green text-heading">Cash Flow</h2>
          <Select<Granularity>
            aria-label="Group by"
            value={granularity}
            onChange={setGranularity}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "weekly", label: "Weekly" },
            ]}
            className="min-h-[36px] min-w-260 rounded-card bg-card py-10 pr-28 pl-28 text-small text-ink"
          />
        </div>

        <Card>
          <CashflowChart
            labels={labels}
            series={series}
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
            action={<DetailLink href={`/finance/cashflow?group=${granularity}&kind=${kind}`} label="Open cash flow details" />}
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
