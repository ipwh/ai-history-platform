import { ReviewWorkbench } from "@/components/ReviewWorkbench";
import { SITE_NAME } from "@/lib/site";
import { guardTeacherPage } from "@/server/auth/guards";

export const metadata = { title: `教師審核工作台 ｜ ${SITE_NAME}` };

export default async function TeacherReviewPage() {
  await guardTeacherPage("/teacher/review");
  return <ReviewWorkbench />;
}
