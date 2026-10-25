import type { Metadata } from "next";
import { LinksScreen } from "@/components/screens/LinksScreen";

export const metadata: Metadata = { title: "Links" };

export default function Page() {
  return <LinksScreen />;
}
