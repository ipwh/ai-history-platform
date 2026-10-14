import { TeacherRecords } from "@/components/TeacherRecords";
import { guardTeacherPage } from "@/server/auth/guards";

export const metadata = { title: "學生練習記錄 ｜ 歷史科自學網站" };

export default async function TeacherRecordsPage() {
  await guardTeacherPage("/teacher/records");
  return <TeacherRecords />;
}
