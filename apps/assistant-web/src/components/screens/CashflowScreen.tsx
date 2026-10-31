"use client";

import { useMemo, useState } from "react";
import { dateRange, rupiah, shortDate, signedRupiah } from "@/lib/format";
import type { Cashflow, CashflowKind as Kind, CashflowPoint, Granularity, Transaction } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { CashflowChart, cashflowSeries } from "../Charts";
import { DataTable } from "../DataTable";
import { Select } from "../Select";
import { Card, Note, PageHeader, Panel, Toggle } from "../ui";

const LIMIT = 500; // the API maximum

/** "Oct 2026" for a month, "Oct 6 - 12" for an allowance week. */
function periodName(p: CashflowPoint, granularity: Granularity) {
  return granularity === "weekly" ? dateRange(p.start, p.end) : `${p.label} ${p.start.slice(0, 4)}`;
}

/** Cash flow in detail: chart, totals and periods, and every transaction of a period. */
export function CashflowScreen({ initialGroup, initialKind }: { initialGroup: Granularity; initialKind: Kind }) {
  const [granularity, setGranularity] = useState<Granularity>(initialGroup);
  const [kind, setKind] = useState<Kind>(initialKind);
  const [period, setPeriod] = useState("all"); // a period's start date, or "all"
  const cashflow = useApi<Cashflow>(`/finance/cashflow?granularity=${granularity}`);
  const txs = useApi<Transaction[]>(`/finance/transactions?kind=${kind}&limit=${LIMIT}`);

  const points = useMemo(() => cashflow.data?.points ?? [], [cashflow.data]);
  const { labels, series } = useMemo(() => cashflowSeries(points, kind), [points, kind]);
  const newestFirst = useMemo(() => [...points].reverse(), [points]);
  // A period from the other grouping no longer exists, so it reads as "all".
  const chosen = points.find((p) => p.start === period);

  const totals = chosen ?? points.reduce((t, p) => ({ ...t, income: t.income + p.income, outcome: t.outcome + p.outcome, net: t.net + p.net }), { income: 0, outcome: 0, net: 0 });
  const rows = useMemo(() => {
    const all = txs.data ?? [];
    if (!chosen) return all;
    return all.filter((t) => t.date && t.date.slice(0, 10) >= chosen.start && t.date.slice(0, 10) <= chosen.end);
  }, [txs.data, chosen]);

  return (
    <>
      <PageHeader title="Cash Flow" subtitle="Income and outcome in detail" back="/finance" />
      {cashflow.error ? <Note tone="error">{cashflow.error.message}</Note> : null}

      <Panel className="mt-38">
        <div className="flex items-center justify-between px-6 pb-16">
          <h2 className="text-heading-green text-heading">Overview</h2>
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
          <DataTable<CashflowPoint>
            size="small"
            visibleRows={4}
            rows={newestFirst}
            rowKey={(p) => p.start}
            empty={cashflow.loading ? "Loading..." : "No periods yet."}
            rowClassName={(p) => (p.start === chosen?.start ? "bg-panel" : "")}
            columns={[
              { key: "period", label: granularity === "weekly" ? "Week" : "Month", width: 230, cell: (p) => periodName(p, granularity) },
              { key: "income", label: "Income", width: 210, cell: (p) => rupiah(p.income), className: () => "text-green" },
              { key: "outcome", label: "Outcome", width: 210, cell: (p) => rupiah(p.outcome), className: () => "text-maroon" },
              { key: "net", label: "Net", width: 210, cell: (p) => signedRupiah(p.net), className: (p) => (p.net < 0 ? "text-maroon" : "text-green") },
            ]}
          />
        </Card>
      </Panel>

      <Panel className="mt-24">
        <div className="flex items-center justify-between gap-16 px-6 pb-16">
          <h2 className="text-heading-green text-heading">Transactions</h2>
          <Select<string>
            aria-label="Period"
            value={chosen ? chosen.start : "all"}
            onChange={setPeriod}
            options={[{ value: "all", label: "All periods" }, ...newestFirst.map((p) => ({ value: p.start, label: periodName(p, granularity) }))]}
            className="min-h-[36px] min-w-300 rounded-card bg-card py-10 pr-28 pl-28 text-small text-ink"
          />
        </div>

        <Card>
          <dl className="grid grid-cols-3 gap-12 px-18 py-24 text-center">
            {[
              { label: "Income", value: `+${rupiah(totals.income)}`, tone: "text-green" },
              { label: "Outcome", value: `-${rupiah(totals.outcome)}`, tone: "text-maroon" },
              { label: "Net", value: signedRupiah(totals.net), tone: totals.net < 0 ? "text-maroon" : "text-green" },
            ].map((s) => (
              <div key={s.label} className="min-w-0">
                <dt className="text-small text-muted">{s.label}</dt>
                <dd className={`truncate text-body font-bold ${s.tone}`}>{cashflow.data ? s.value : "..."}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="mt-28">
          <DataTable<Transaction>
            size="small"
            visibleRows={10}
            rows={rows}
            rowKey={(t) => t.id}
            empty={txs.loading ? "Loading..." : txs.error ? txs.error.message : chosen ? "No transactions in this period." : "No transactions."}
            columns={[
              { key: "date", label: "Date", width: 140, align: "center", cell: (t) => shortDate(t.date) },
              {
                key: "amount",
                label: "Amount",
                width: 210,
                cell: (t) => signedRupiah(t.type === "Keluar" ? -(t.amount ?? 0) : t.amount ?? 0),
                className: (t) => (t.type === "Keluar" ? "text-maroon" : "text-green"),
              },
              { key: "name", label: "Name", width: 300, cell: (t) => t.name },
              { key: "category", label: "Category", width: 200, cell: (t) => t.category || "-", className: () => "text-muted" },
            ]}
          />
        </Card>
        <p className="px-6 pt-16 text-small text-muted">
          {rows.length} transaction{rows.length === 1 ? "" : "s"}
          {txs.data?.length === LIMIT ? ` (latest ${LIMIT} loaded)` : ""}. Totals count the tracked account only.
        </p>
      </Panel>
    </>
  );
}
