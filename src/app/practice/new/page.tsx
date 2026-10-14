import { Suspense } from "react";

import { PracticeSetupForm } from "@/components/PracticeSetupForm";
import { Loading } from "@/components/ui";
import { guardStudentPage } from "@/server/auth/guards";

export default async function PracticeSetupPage() {
  await guardStudentPage("/practice/new");
  return (
    <Suspense fallback={<Loading label="正在載入練習設定…" />}>
      <PracticeSetupForm />
    </Suspense>
  );
}
