import type { Metadata } from "next";
import { Hub } from "@/components/screens/Hub";

export const metadata: Metadata = { title: "Home" };

export default function Page() {
  return <Hub />;
}
