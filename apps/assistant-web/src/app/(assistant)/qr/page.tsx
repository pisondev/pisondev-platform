import type { Metadata } from "next";
import { QrScreen } from "@/components/screens/QrScreen";

export const metadata: Metadata = { title: "Link to QR" };

export default function Page() {
  return <QrScreen />;
}
