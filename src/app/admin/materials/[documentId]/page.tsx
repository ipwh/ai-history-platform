import { MaterialManager } from "@/components/MaterialManager";
import { SITE_NAME } from "@/lib/site";
import { guardAdminPage } from "@/server/auth/guards";

export const metadata = { title: `教材內容 ｜ ${SITE_NAME}` };

/**
 * 管理員端：單一教材文件（段落、OCR 狀態、分節對應及教材依據修正）。
 * 沿用教材管理介面，但自動展開指定的文件。
 */
export default async function AdminMaterialDetailPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  await guardAdminPage(`/admin/materials/${documentId}`);
  return <MaterialManager initialDocumentId={documentId} />;
}
