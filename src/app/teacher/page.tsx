import { TeacherDashboard } from "@/components/TeacherDashboard";
import { guardTeacherPage } from "@/server/auth/guards";

export const metadata = { title: "教師端 ｜ 歷史科自學平台" };

export default async function TeacherDashboardPage() {
  const user = await guardTeacherPage("/teacher");
  return <TeacherDashboard teacherEmail={user?.email ?? null} />;
}
