import { MaterialManager } from "@/components/MaterialManager";
import { guardAdminPage } from "@/server/auth/guards";

export const metadata = { title: "教材管理 ｜ 歷史科自學網站" };

/** 管理員端：教材匯入、OCR、段落分節對應 */
export default async function AdminMaterialsPage() {
  await guardAdminPage("/admin/materials");
  return <MaterialManager />;
}
