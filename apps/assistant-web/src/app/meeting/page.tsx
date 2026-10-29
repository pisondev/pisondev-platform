import { redirect } from "next/navigation";
import { MEETING_PATH } from "@/lib/meeting";

export default function MeetingPage() {
  redirect(MEETING_PATH);
}
