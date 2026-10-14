import { redirect } from "next/navigation";

/** 相容舊路徑：課題與系統狀態已移至管理員端（/admin/settings） */
export default function TeacherSettingsRedirectPage() {
  redirect("/admin/settings");
}
