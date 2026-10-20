import { QuestionManager } from "@/components/QuestionManager";
import { guardTeacherPage } from "@/server/auth/guards";

export const metadata = { title: "題目管理 ｜ 歷史科自學網站" };

/**
 * 題目管理。
 *
 * 支援 `?question=<id>` 深層連結：由教師審核工作台「需核對課本依據的題目」直接跳入
 * 該題的編輯表單，令教師不需要在清單中自行尋找。未提供時行為不變。
 */
export default async function TeacherQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ question?: string }>;
}) {
  await guardTeacherPage("/teacher/questions");
  const params = await searchParams;
  const focusQuestionId = typeof params.question === "string" ? params.question : null;
  return <QuestionManager focusQuestionId={focusQuestionId} />;
}
