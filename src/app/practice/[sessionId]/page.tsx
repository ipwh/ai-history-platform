import { PracticeRunner } from "@/components/PracticeRunner";
import { guardStudentPage } from "@/server/auth/guards";

export default async function PracticeSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  await guardStudentPage(`/practice/${sessionId}`);
  return <PracticeRunner sessionId={sessionId} />;
}
