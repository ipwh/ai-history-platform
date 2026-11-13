import { QuestionManager } from "@/components/QuestionManager";
import { SITE_NAME } from "@/lib/site";
import { guardTeacherPage } from "@/server/auth/guards";

export const metadata = { title: `題目生成與審核 ｜ ${SITE_NAME}` };

/** 題目生成與審核：沿用題目管理介面，預設展開生成區塊 */
export default async function TeacherQuestionGeneratePage() {
  await guardTeacherPage("/teacher/questions/generate");
  return <QuestionManager focusGenerate />;
}
