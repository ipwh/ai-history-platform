import { AdminSettings } from "@/components/AdminSettings";
import { guardAdminPage } from "@/server/auth/guards";

export const metadata = { title: "課題與系統狀態 ｜ 歷史自學互動網站" };

/** 管理員端：課題發布狀態、分節關鍵詞及系統狀態（版本、資料庫、LLM、OCR、登入、部署提示） */
export default async function AdminSettingsPage() {
  await guardAdminPage("/admin/settings");
  return <AdminSettings />;
}
