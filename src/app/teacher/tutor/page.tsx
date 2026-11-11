import { TutorUsagePanel } from "@/components/TutorUsagePanel";
import { guardTeacherPage } from "@/server/auth/guards";

export const metadata = { title: "學伴使用概況 ｜ 歷史科自學平台" };

/**
 * 教師／管理員的學伴使用概況。
 *
 * 只顯示聚合統計（成功回答、離題、澄清、正規化改寫、外部參考狀態），
 * **不提供**對話全文檢視：抽樣檢視需要另設權限及保留期限，屬 P1，本輪未實作。
 */
export default async function TeacherTutorUsagePage() {
  await guardTeacherPage("/teacher/tutor");
  return <TutorUsagePanel />;
}
