import type { Metadata } from "next";
import { CashflowScreen } from "@/components/screens/CashflowScreen";

export const metadata: Metadata = { title: "Cash Flow" };

// The Finance table's detail link carries its view: ?group=monthly|weekly&kind=all|income|outcome.
export default async function Page({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const { group, kind } = await searchParams;
  return (
    <CashflowScreen
      initialGroup={group === "weekly" ? "weekly" : "monthly"}
      initialKind={kind === "income" || kind === "outcome" ? kind : "all"}
    />
  );
}
