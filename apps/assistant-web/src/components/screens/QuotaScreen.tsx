"use client";

import { useCallback, useState } from "react";
import { dateRange, rupiah, shortDate, signedRupiah } from "@/lib/format";
import type { ExpenseItem, Options, Quota, SavingsRow } from "@/lib/types";
import { useApi } from "@/lib/useApi";
import { AddTransactionSheet } from "../AddTransactionSheet";
import { SavingsChart } from "../Charts";
import { DataTable } from "../DataTable";
import { ProgressBar } from "../ProgressBar";
import { Card, Figure, Note, PageHeader, Panel } from "../ui";

export function QuotaScreen() {
  const quota = useApi<Quota>("/finance/quota");
  const options = useApi<Options>("/finance/options");
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState<string>();
  const q = quota.data;
  const close = useCallback(() => setAdding(false), []);

  return (
    <>
      <PageHeader
        title="Weekly Spending Quota"
        subtitle={q ? dateRange(q.period.start, q.period.end) : " "}
        back="/finance"
      />
      {quota.error ? <Note tone="error">{quota.error.message}</Note> : null}
      {!q && quota.loading ? <Note>Loading...</Note> : null}

      {q ? (
        <>
          <div className="mt-28">
            <Figure label="Remaining" value={q.remaining} tone={q.remaining < 0 ? "maroon" : "green"} />
          </div>
          <div className="mt-20">
            <ProgressBar spent={q.spent} max={q.max} percent={q.percent} level={q.level} />
          </div>
          <p className="mt-6 px-100 text-small text-blue">
            Your quota for next week<span className="mx-16">:</span>
            <b>{rupiah(q.nextWeekMax)}</b>
          </p>
          {saved ? <p role="status" className="motion-feedback mt-12 px-100 text-small text-green">{saved}</p> : null}

          <Panel className="mt-56">
            <div className="flex items-center justify-between px-10 pb-12">
              <h2 className="text-heading-red text-heading">Recent Expenses</h2>
              <button
                type="button"
                onClick={() => setAdding(true)}
                aria-label="Add a transaction"
                className="flex size-[max(34px,calc(var(--spacing)*68))] items-center justify-center rounded-full bg-card text-heading font-bold"
              >
                <span className="text-heading-red">+</span>
              </button>
            </div>
            <Card>
              <DataTable<ExpenseItem>
                rows={q.expenses}
                rowKey={(e) => e.id}
                empty="No expenses yet."
                columns={[
                  { key: "no", label: "No.", width: 86, align: "center", cell: (_, i) => i + 1 },
                  { key: "date", label: "Date", width: 170, align: "center", cell: (e) => shortDate(e.date) },
                  { key: "amount", label: "Amount", width: 228, cell: (e) => `-${rupiah(e.amount)}`, className: () => "text-maroon" },
                  { key: "desc", label: "Description", width: 330, cell: (e) => <span title={e.notes || e.name}>{e.name}</span> },
                ]}
              />
            </Card>
          </Panel>

          <hr className="mx-85 my-45 border-0 border-t-[max(2px,calc(var(--spacing)*5))] border-muted" />

          <Panel>
            <h2 className="text-heading-green px-10 pb-16 text-heading">Savings</h2>
            <Card>
              <SavingsChart target={q.savings.target} now={q.savings.save} />
            </Card>
            <Card className="mt-28">
              <DataTable<SavingsRow>
                size="small"
                visibleRows={4}
                rows={q.savings.rows}
                rowKey={(r) => r.label + (r.start ?? "")}
                rowClassName={(r) => (r.estimated ? "text-muted" : "")}
                columns={[
                  { key: "period", label: "Period", width: 96, align: "center", cell: (r) => r.label.replace(/^W/, "") },
                  {
                    key: "date",
                    label: "Date",
                    width: 240,
                    cell: (r) =>
                      r.genesis ? `Before ${shortDate(q.savings.cycleStart)}` : `${r.estimated ? "[EST] " : ""}${dateRange(r.start, r.end)}`,
                  },
                  {
                    key: "amount",
                    label: "Amount",
                    width: 170,
                    cell: (r) => (r.amount === null ? "Not yet" : signedRupiah(r.amount)),
                    className: (r) => (r.amount === null ? "" : r.amount < 0 ? "text-maroon" : "text-green"),
                  },
                  { key: "desc", label: "Description", width: 230, cell: (r) => <span title={r.notes}>{r.estimated ? "Not yet" : r.notes}</span> },
                ]}
              />
            </Card>
          </Panel>
        </>
      ) : null}

      {adding ? (
        <AddTransactionSheet
          onClose={close}
          options={options.data}
          onSaved={(t) => {
            setAdding(false);
            setSaved(`Saved: ${t.name}, ${rupiah(t.amount)}. It reaches Notion and the sheet within a minute.`);
            quota.reload();
          }}
        />
      ) : null}
    </>
  );
}
