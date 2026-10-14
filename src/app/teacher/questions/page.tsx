import { QuestionManager } from "@/components/QuestionManager";
import { guardTeacherPage } from "@/server/auth/guards";

export const metadata = { title: "題目管理 ｜ 歷史科自學網站" };

export default async function TeacherQuestionsPage() {
  await guardTeacherPage("/teacher/questions");
  return <QuestionManager />;
}
