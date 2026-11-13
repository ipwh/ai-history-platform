import { AdminDashboard } from "@/components/AdminDashboard";
import { SITE_NAME } from "@/lib/site";
import { guardAdminPage } from "@/server/auth/guards";

export const metadata = { title: `管理員儀表板 ｜ ${SITE_NAME}` };

/** 管理員端：平台概況、系統狀態、AI 用量及全部功能的入口 */
export default async function AdminDashboardPage() {
  const user = await guardAdminPage("/admin");
  return <AdminDashboard adminEmail={user?.email ?? null} />;
}
