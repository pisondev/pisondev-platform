import type { Metadata } from "next";
import { QuotaScreen } from "@/components/screens/QuotaScreen";

export const metadata: Metadata = { title: "Weekly Spending Quota" };

export default function Page() {
  return <QuotaScreen />;
}
