import { StudentRecords } from "@/components/StudentRecords";
import { SITE_NAME } from "@/lib/site";
import { guardStudentPage } from "@/server/auth/guards";

export const metadata = { title: `我的練習記錄 ｜ ${SITE_NAME}` };

/**
 * 學生端：我的練習記錄。
 *
 * 學習者身分由伺服器工作階段決定（見 `/api/records`），頁面只負責呈現及篩選，
 * 不接受任何指定其他學生的參數。
 */
export default async function MyRecordsPage() {
  await guardStudentPage("/records");
  return <StudentRecords />;
}
