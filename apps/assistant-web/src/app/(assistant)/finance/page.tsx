import type { Metadata } from "next";
import { FinanceDashboard } from "@/components/screens/FinanceDashboard";

export const metadata: Metadata = { title: "Finance" };

export default function Page() {
  return <FinanceDashboard />;
}
