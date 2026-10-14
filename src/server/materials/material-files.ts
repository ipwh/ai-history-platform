/**
 * materials 來源資料夾的檔案掃描。
 *
 * 2026 學年起 materials 以課題分資料夾存放：
 *
 *   課題5 近代歐洲的興起/
 *     課題5 近代歐洲的興起.docx     ← 書本內容（AI 出題依據）
 *     HNC2A2E_QB_T5_1.MCQ.docx     ← 校內試題（匯入題庫）
 *
 * 因此不論是教師端「批次匯入」或匯入腳本，都需要遞迴掃描，
 * 並以「所在資料夾」優先判斷課題。
 */
import fs from "node:fs";
import path from "node:path";

import { CURRICULUM_TOPICS, findTopicSeedByFile } from "../seed/curriculum";

export interface MaterialFileEntry {
  /** 相對於 materials 資料夾的路徑（例如「課題5 近代歐洲的興起/課題5 近代歐洲的興起.docx」） */
  relativePath: string;
  /** 檔案名稱（不含資料夾） */
  fileName: string;
  /** 對應的課題 ID；無法判斷時為 null */
  topicId: string | null;
}

/** 支援匯入的副檔名 */
export const MATERIAL_EXTENSIONS = [".docx", ".pdf"] as const;

/**
 * 依檔名或資料夾名稱推測課題：
 *   1. 完全符合課程種子記錄的教材檔名
 *   2. 名稱中的「課題N」或「HNC…_TN_」
 *   3. 名稱中包含課題標題（去掉「課題N」後的主題文字）
 */
export function detectTopicId(name: string): string | null {
  const seed = findTopicSeedByFile(name);
  if (seed) return seed.id;

  const numbered = /課題\s*(\d+)/.exec(name) ?? /[_-]T(\d+)[_-]/i.exec(name);
  if (numbered) {
    const topic = CURRICULUM_TOPICS.find((item) => item.topicNumber === Number(numbered[1]));
    if (topic) return topic.id;
  }

  const flattened = name.replace(/\s+/g, "");
  for (const topic of CURRICULUM_TOPICS) {
    const shortTitle = topic.title.replace(/^課題\s*\d+[：:\s]*/, "").replace(/\s+/g, "");
    if (shortTitle.length >= 2 && flattened.includes(shortTitle)) return topic.id;
  }
  return null;
}

/** 遞迴掃描 materials 資料夾內所有可匯入的檔案（略過不支援的格式） */
export function collectMaterialFiles(materialsDir: string): MaterialFileEntry[] {
  const entries: MaterialFileEntry[] = [];
  const walk = (directory: string, inheritedTopic: string | null): void => {
    let children: fs.Dirent[];
    try {
      children = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const child of children) {
      const fullPath = path.join(directory, child.name);
      if (child.isDirectory()) {
        walk(fullPath, detectTopicId(child.name) ?? inheritedTopic);
        continue;
      }
      const extension = path.extname(child.name).toLowerCase();
      if (!MATERIAL_EXTENSIONS.includes(extension as (typeof MATERIAL_EXTENSIONS)[number])) continue;
      entries.push({
        relativePath: path.relative(materialsDir, fullPath).split(path.sep).join("/"),
        fileName: child.name,
        topicId: inheritedTopic ?? detectTopicId(child.name),
      });
    }
  };
  walk(materialsDir, null);
  return entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-Hant"));
}

/**
 * 找出教材檔案的實際位置。
 * 支援相對子路徑（「課題5 …/課題5 ….docx」）及只有檔名的寫法；
 * 不接受 `..` 之類離開 materials 資料夾的路徑。
 */
export function resolveMaterialPath(materialsDir: string, fileName: string): string | null {
  const root = path.resolve(materialsDir);
  const candidate = path.resolve(root, fileName);
  const insideRoot = candidate === root || candidate.startsWith(root + path.sep);

  if (insideRoot && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;

  // 只給檔名時，在子資料夾中尋找同名的檔案
  const base = path.basename(fileName);
  const match = collectMaterialFiles(root).find((entry) => entry.fileName === base);
  return match ? path.join(root, match.relativePath.split("/").join(path.sep)) : null;
}
