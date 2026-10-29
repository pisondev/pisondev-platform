import { PollScreen } from "@/components/meeting/PollScreen";
export default async function PollPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <PollScreen key={id} id={id} />;
}
