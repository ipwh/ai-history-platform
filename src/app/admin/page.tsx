import { AdminDashboard } from "@/components/AdminDashboard";
import { guardAdminPage } from "@/server/auth/guards";

export const metadata = { title: "管理員儀表板 ｜ 歷史自學互動網站" };

/** 管理員端：平台概況、系統狀態、AI 用量及全部功能的入口 */
export default async function AdminDashboardPage() {
  const user = await guardAdminPage("/admin");
  return <AdminDashboard adminEmail={user?.email ?? null} />;
}
