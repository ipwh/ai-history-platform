import { TeacherDashboard } from "@/components/TeacherDashboard";
import { SITE_NAME } from "@/lib/site";
import { guardTeacherPage } from "@/server/auth/guards";

export const metadata = { title: `教師端 ｜ ${SITE_NAME}` };

export default async function TeacherDashboardPage() {
  const user = await guardTeacherPage("/teacher");
  return <TeacherDashboard teacherEmail={user?.email ?? null} />;
}
