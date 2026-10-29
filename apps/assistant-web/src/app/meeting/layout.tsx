import type { Metadata } from "next";
import { MeetingShell } from "@/components/meeting/MeetingShell";
import "./meeting.css";

export const metadata: Metadata = {
  title: { default: "Pison Meet", template: "%s | Pison Meet" },
  description:
    "Find time together. Share your availability and choose a meeting time that works.",
  referrer: "no-referrer",
};
export default function MeetingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <MeetingShell>{children}</MeetingShell>;
}
