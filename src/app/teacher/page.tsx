import { TeacherDashboard } from "@/components/TeacherDashboard";
import { guardTeacherPage } from "@/server/auth/guards";

export const metadata = { title: "教師端 ｜ 歷史自學互動網站" };

export default async function TeacherDashboardPage() {
  const user = await guardTeacherPage("/teacher");
  return <TeacherDashboard teacherEmail={user?.email ?? null} />;
}
