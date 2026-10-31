"use client";

import { useMemo, useState } from "react";
import { rupiah, shortDate, signedRupiah } from "@/lib/format";
import type { Cashflow, CashflowKind as Kind, Granularity, Quota, Subscriptions, Summary, Transaction } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { CashflowChart, cashflowSeries } from "../Charts";
import { DataTable } from "../DataTable";
import { Select } from "../Select";
import { QUOTA_FILL } from "../ProgressBar";
import { Card, DetailLink, Figure, NavTile, Note, PageHeader, Panel, Toggle } from "../ui";

export function FinanceDashboard() {
  const [kind, setKind] = useState<Kind>("all");
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const summary = useApi<Summary>("/finance/summary");
  const cashflow = useApi<Cashflow>(`/finance/cashflow?granularity=${granularity}`);
  const txs = useApi<Transaction[]>(`/finance/transactions?kind=${kind}&limit=100`);
  const subs = useApi<Subscriptions>("/finance/subscriptions");
  const quota = useApi<Quota>("/finance/quota");

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

      {/* Two tiles side by side; below 360 px they stack so titles keep their size. */}
      <nav className="mt-58 grid grid-cols-2 gap-40 px-85 max-[359px]:grid-cols-1">
        <NavTile href="/finance/subscriptions" title="Subscriptions" tone="blue" icon={<path d="m17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3" />}>
          {subs.data ? (
            <>
              <span>
                <b>{rupiah(subs.data.monthly.total)}</b> / month
              </span>
              <span className="text-muted">
                {subs.data.monthly.items.length} monthly · {subs.data.yearly.items.length} yearly
              </span>
            </>
          ) : subs.loading ? (
            <span className="text-muted">...</span>
          ) : null}
        </NavTile>
        <NavTile href="/finance/quota" title="Weekly Spending Quota" tone="green" icon={<path d="m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0" />}>
          {quota.data ? (
            <>
              <span className={quota.data.remaining < 0 ? "text-maroon" : undefined}>
                <b>{rupiah(quota.data.remaining)}</b> left
              </span>
              <span aria-hidden className="block h-[max(5px,calc(var(--spacing)*12))] overflow-hidden rounded-full bg-white/75">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, quota.data.percent))}%`, background: quota.data.level === "empty" ? undefined : QUOTA_FILL[quota.data.level] }}
                />
              </span>
              <span className="text-muted">{Math.round(quota.data.percent)}% used</span>
            </>
          ) : quota.loading ? (
            <span className="text-muted">...</span>
          ) : null}
        </NavTile>
      </nav>
    </>
  );
}
