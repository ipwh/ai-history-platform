/**
 * 讀取 DOCX 內圖片的「文件出現次序」。
 *
 * word/media 的檔名次序與文件中圖片的實際次序不一定相同，
 * 因此需要解析 word/document.xml 內的 r:embed（關聯 ID）並對照
 * word/_rels/document.xml.rels，才能把每個圖片段落對應到正確的媒體檔。
 * 這個對應關係對 OCR 很重要：辨識結果必須寫回正確的圖片段落及分節。
 */
import JSZip from "jszip";

export interface DocxImageReference {
  /** 關聯 ID，例如 rId7 */
  relationshipId: string;
  /** 媒體檔案路徑，例如 word/media/image12.png */
  mediaPath: string;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/** 讀取 rId → 媒體路徑的對照表（亦包含超連結以外的圖片關聯） */
async function readRelationships(zip: JSZip): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const relsFile = zip.file("word/_rels/document.xml.rels");
  if (!relsFile) return map;

  const xml = await relsFile.async("string");
  const pattern = /<Relationship\b[^>]*\/?>/g;
  for (const match of xml.matchAll(pattern)) {
    const tag = match[0];
    const id = /Id="([^"]+)"/.exec(tag)?.[1];
    const target = /Target="([^"]+)"/.exec(tag)?.[1];
    const type = /Type="([^"]+)"/.exec(tag)?.[1] ?? "";
    if (!id || !target) continue;
    if (!type.includes("image")) continue;
    const normalized = target.startsWith("/")
      ? target.slice(1)
      : `word/${target.replace(/^\.\//, "")}`;
    map.set(id, decodeXml(normalized));
  }
  return map;
}

/**
 * 依文件次序回傳圖片所對應的媒體路徑。
 * 同一張圖片在文件中出現多次時，會回傳多筆資料（次序與介面段落一致）。
 */
export async function listDocxImagesInDocumentOrder(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const relationships = await readRelationships(zip);
  const document = zip.file("word/document.xml");
  if (!document) return [];

  const xml = await document.async("string");
  const order: string[] = [];

  // 依文件次序找出所有 r:embed / r:link 參照
  for (const match of xml.matchAll(/r:(?:embed|link)="([^"]+)"/g)) {
    const mediaPath = relationships.get(match[1]);
    if (mediaPath) order.push(mediaPath);
  }

  // 若解析不到關聯（罕見），回退使用 word/media 內的檔案次序
  if (order.length === 0) {
    return Object.keys(zip.files)
      .filter((path) => path.startsWith("word/media/") && !zip.files[path].dir)
      .sort();
  }

  return order;
}
