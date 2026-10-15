import type { Metadata } from "next";
import { SubscriptionsScreen } from "@/components/screens/SubscriptionsScreen";

export const metadata: Metadata = { title: "Subscriptions" };

export default function Page() {
  return <SubscriptionsScreen />;
}
