import { AdminSettings } from "@/components/AdminSettings";
import { SITE_NAME } from "@/lib/site";
import { guardAdminPage } from "@/server/auth/guards";

export const metadata = { title: `課題與系統狀態 ｜ ${SITE_NAME}` };

/** 管理員端：課題發布狀態、分節關鍵詞及系統狀態（版本、資料庫、LLM、OCR、登入、部署提示） */
export default async function AdminSettingsPage() {
  await guardAdminPage("/admin/settings");
  return <AdminSettings />;
}
