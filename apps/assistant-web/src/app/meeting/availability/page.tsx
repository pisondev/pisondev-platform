import { CreatePoll } from "@/components/meeting/CreatePoll";
// Default dates must be computed per request rather than frozen at build time.
export const dynamic = "force-dynamic";
export default function AvailabilityPage() {
  return <CreatePoll />;
}
