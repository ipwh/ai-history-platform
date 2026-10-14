import { ResultView } from "@/components/ResultView";
import { guardStudentPage } from "@/server/auth/guards";

export default async function PracticeResultPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  await guardStudentPage(`/practice/${sessionId}/result`);
  return <ResultView sessionId={sessionId} />;
}
