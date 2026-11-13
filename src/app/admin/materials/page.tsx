import { MaterialManager } from "@/components/MaterialManager";
import { SITE_NAME } from "@/lib/site";
import { guardAdminPage } from "@/server/auth/guards";

export const metadata = { title: `教材管理 ｜ ${SITE_NAME}` };

/** 管理員端：教材匯入、OCR、段落分節對應 */
export default async function AdminMaterialsPage() {
  await guardAdminPage("/admin/materials");
  return <MaterialManager />;
}
