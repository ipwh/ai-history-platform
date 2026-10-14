import { redirect } from "next/navigation";

/** 相容舊路徑：教材管理已移至管理員端（/admin/materials） */
export default function TeacherMaterialsRedirectPage() {
  redirect("/admin/materials");
}
