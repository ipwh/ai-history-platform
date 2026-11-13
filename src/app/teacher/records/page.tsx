import { TeacherRecords } from "@/components/TeacherRecords";
import { SITE_NAME } from "@/lib/site";
import { guardTeacherPage } from "@/server/auth/guards";

export const metadata = { title: `學生練習記錄 ｜ ${SITE_NAME}` };

export default async function TeacherRecordsPage() {
  await guardTeacherPage("/teacher/records");
  return <TeacherRecords />;
}
