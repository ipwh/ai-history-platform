import { ReviewWorkbench } from "@/components/ReviewWorkbench";
import { guardTeacherPage } from "@/server/auth/guards";

export const metadata = { title: "教師審核工作台 ｜ 歷史科自學網站" };

export default async function TeacherReviewPage() {
  await guardTeacherPage("/teacher/review");
  return <ReviewWorkbench />;
}
