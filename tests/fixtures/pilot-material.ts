/**
 * 測試用的「試點教材」合成 DOCX（不依賴受版權保護的 materials/）。
 *
 * ── 為甚麼需要 ────────────────────────────────────────────────────────
 * `materials/` 依版權政策不納入版本控制（只有 README 例外），因此乾淨 checkout 的 CI
 * 沒有任何課題5 教材檔案。以往 15 個測試檔直接呼叫
 * `materialService.importPilotMaterialFromDisk()`，在 CI 一律於 beforeAll 拋出
 * 「找不到課題5的教材檔案」，整個 suite 失敗（GitHub Actions run 39885612625）。
 *
 * 這些測試驗證的是**平台行為**（練習組裝、AI 用量上限、發行權、生成流程…），
 * 不是課本內容本身，因此不應依賴真實教材。這裡改為在暫存目錄建立一份**自行撰寫的
 * 合成教材**（課題5 四個主題各數段），再照正常匯入流程寫入資料庫。
 *
 * ── 契約 ─────────────────────────────────────────────────────────────
 *   - 只寫入作業系統暫存目錄（`hist-test-materials-<pid>`），不碰專案的 materials/；
 *   - 合成內容為原創文字，不含任何課本或試題內容；
 *   - 匯入失敗（檔案建立失敗、解析失敗、沒有段落）時**拋出錯誤**（fail-closed），
 *     不會靜默通過，令測試不會在「沒有教材」的情況下變成空轉；
 *   - 需要**真實**教材內容的測試（例如解析器測試、瀏覽器測試）不使用此檔案，
 *     仍以明確的授權 fixture 機制執行（見 tests/materials-parsers.test.ts）。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import JSZip from "jszip";

/** 本套件使用的暫存教材資料夾名稱（供清理工具辨識） */
export const TEST_MATERIALS_DIR_PREFIX = "hist-test-materials-";

/** 合成教材在 materials 目錄內的路徑（與課程種子的 topic-5 materialFile 一致） */
const PILOT_RELATIVE_PATH = "課題5 近代歐洲的興起/課題5 近代歐洲的興起_筆記.docx";

/**
 * 合成教材內容：課題5 四個整合主題各數段（原創文字，只為觸發分節對應）。
 * 每段都以該分節的標題或關鍵詞開頭，令 section-mapper 能按既有規則對應。
 */
const PILOT_PARAGRAPHS: Array<{ style: "Heading1" | "Heading2" | null; text: string }> = [
  { style: "Heading1", text: "課題5 近代歐洲的興起" },
  { style: "Heading2", text: "文藝復興（十四至十七世紀）" },
  { style: null, text: "自十四世紀開始，意大利半島的城市逐漸重視「人文主義」，強調人的價值與現世生活。" },
  { style: null, text: "人文主義：一種以人的價值、理性與現世生活為重點的思想取向，常見於文藝復興時期的文學與藝術。" },
  { style: null, text: "當時的學者重新研讀古典作品，加上城市經濟及贊助文化，令文學、藝術與自然科學均有發展。" },
  { style: null, text: "畫家運用「透視法」及解剖知識，令宗教題材以外的人物與風景成為常見主題。" },
  { style: null, text: "文學作品多用本土語言書寫，作者借此表達對人性、政治及社會的觀察。" },
  { style: null, text: "長遠的影響包括教育內容的改變、個人才能的重視，以及日後宗教改革的思想基礎。" },
  { style: null, text: "這股風氣在1450年前後由意大利半島逐步傳到阿爾卑斯山以北，並與各地的政治及宗教情況結合。" },
  { style: "Heading2", text: "宗教改革（十六至十七世紀）" },
  { style: null, text: "十五世紀末，教會面對財政爭議及教士紀律問題，印刷術則令批評迅速傳播。" },
  { style: null, text: "信徒對出售「贖罪券」及神職人員的生活態度已有不滿，成為改革的導火線。" },
  { style: null, text: "馬丁路德在1517年發表「九十五條論證」，批評出售贖罪券，其主張形成新教教派。" },
  { style: null, text: "因信稱義：主張人因信靠上帝而得救，不必依靠購買贖罪券或特定儀式。" },
  { style: null, text: "不同地區出現的改革者對教義及禮儀的理解並不一致，令運動分成多個派別。" },
  { style: null, text: "結果包括教會分裂、君主權力擴張，以及「反宗教改革」運動的出現。" },
  { style: null, text: "識字與教育的普及程度亦隨之改變，因為信徒需要自行閱讀譯成本土語言的聖經。" },
  { style: "Heading2", text: "文藝復興與宗教改革：綜合與比較" },
  { style: null, text: "兩場運動同樣重視個人判斷，但前者側重文化與學術，後者直接挑戰教會的教義與制度。" },
  { style: null, text: "兩者都借助「印刷術」傳播主張，令新的想法在短時間內跨越地區。" },
  { style: null, text: "它們對教育的影響不同：前者擴充古典學問，後者強調閱讀經典原文。" },
  { style: null, text: "把兩者並列比較，可以看到文化革新與宗教衝突可以同時發生，並互相影響。" },
  { style: null, text: "期間的藝術題材由宗教逐步擴展至日常生活與人物肖像。" },
  { style: null, text: "兩者亦影響日後的政治思想，特別是對權力來源與個人良心的討論。" },
  { style: null, text: "共同背景是中古後期城市成長、商業發展及識字率上升。" },
  { style: "Heading2", text: "科學革命與啟蒙運動" },
  { style: null, text: "十六至十八世紀期間，古典學問的重新研讀、航海與觀測工具的改良，以及學者之間的通信網絡，推動了自然研究。" },
  { style: null, text: "哥白尼在1543年提出「日心說」，主張地球繞太陽運行，改變了當時的世界觀。" },
  { style: null, text: "主要發展包括實驗方法的建立，以及數學在自然研究中的應用。" },
  { style: null, text: "研究者開始以可重複的觀察及量度取代單靠權威的解釋，科學機構與期刊亦逐步形成。" },
  { style: null, text: "這個過程並非一夜之間完成，新舊解釋在十七世紀長期並存並互相辯論。" },
  { style: null, text: "其後的思想家相信理性可以改善制度與社會，提出「權力分立」及「社會契約」等主張。" },
  { style: null, text: "這些主張經沙龍、期刊及百科全書傳播，形成跨越國界的討論網絡，並引起對專制統治的批評。" },
  { style: "Heading2", text: "工業革命" },
  { style: null, text: "工業發展令城市人口快速增加。工廠周邊形成新的市鎮，住屋與衛生設施卻追不上人口增長。" },
  { style: null, text: "十八世紀中葉起，生產以機器代替手工，工廠制度興起，能源與交通技術亦出現革新。" },
  { style: null, text: "英國具備煤鐵資源、資金、殖民地市場及農業改良帶來的勞動力，因此率先展開。" },
  { style: null, text: "蒸汽機：以燃燒煤炭產生動力推動機械的裝置，令工廠可以脫離河流的限制。" },
  { style: null, text: "主要發展包括紡織機械及鐵路的應用，令生產與運輸成本下降。" },
  { style: null, text: "影響包括城市化、工人階級的出現、生活水平的分化及環境污染。" },
  { style: null, text: "工廠工時長、童工普遍，引起日後的勞工立法及工會運動。" },
  { style: null, text: "這套生產方式在1760年前後由英國擴展到歐洲大陸及北美，各地因資源與制度差異而有不同的發展速度。" },
  { style: "Heading2", text: "法國大革命" },
  { style: null, text: "十八世紀末，法國面對財政危機、等級制度的不平等，以及啟蒙思想的傳播。" },
  { style: null, text: "「三級會議」在1789年召開，國民議會隨後成立，巴士底監獄事件亦在同一年發生。" },
  { style: null, text: "《人權宣言》於1789年8月通過，宣布自由、平等及主權在民的原則。" },
  { style: null, text: "君主制度：以世襲君主為國家元首的政治制度，法國在1792年廢除君主制度並成立共和政府。" },
  { style: null, text: "拿破崙上台後建立帝國，推行法典及行政改革，並透過戰爭把部分制度傳到歐洲其他地區。" },
  { style: null, text: "拿破崙時代的軍事擴張引起各國結盟對抗，最終以帝國崩潰結束。" },
  { style: null, text: "長遠影響包括「自由主義」及「民族主義」的傳播，以及日後歐洲政治的重組。" },
];

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function buildDocx(
  paragraphs: Array<{ style: "Heading1" | "Heading2" | null; text: string }>,
): Promise<Buffer> {
  const body = paragraphs.map((paragraph) => {
    const style = paragraph.style
      ? `<w:pPr><w:pStyle w:val="${paragraph.style}"/></w:pPr>`
      : "";
    return `<w:p>${style}<w:r><w:t xml:space="preserve">${escapeXml(paragraph.text)}</w:t></w:r></w:p>`;
  }).join("");

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
  );
  zip.file(
    "word/styles.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/></w:style>
</w:styles>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr/></w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

let materialsDir: string | null = null;
const prepared = new Map<string, Promise<string>>();

/**
 * 建立（或重用）本測試程序專用的暫存 materials 資料夾，並把合成教材寫進去。
 *
 * `extraParagraphs` 讓個別測試加入它需要的段落（例如示範題庫的原文節錄，
 * 用於驗證「匯入教材後重新定位依據」）。相同內容會重用同一個資料夾。
 */
function prepareMaterialsDir(extraParagraphs: string[] = []): Promise<string> {
  const key = JSON.stringify(extraParagraphs);
  const existing = prepared.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const dir = path.join(os.tmpdir(), `${TEST_MATERIALS_DIR_PREFIX}${process.pid}`);
    // 防線：路徑必須留在作業系統暫存目錄內
    if (path.resolve(path.dirname(dir)) !== path.resolve(os.tmpdir())) {
      throw new Error(`測試教材目錄不在暫存目錄內：${dir}`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    const target = path.join(dir, PILOT_RELATIVE_PATH.split("/").join(path.sep));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const paragraphs: Array<{ style: "Heading1" | "Heading2" | null; text: string }> = [
      ...PILOT_PARAGRAPHS,
      ...extraParagraphs
        .filter((text) => text.trim().length > 0)
        .map((text) => ({ style: null, text })),
    ];
    fs.writeFileSync(target, await buildDocx(paragraphs));
    materialsDir = dir;
    process.env.APP_MATERIALS_DIR = dir;
    return dir;
  })();
  prepared.set(key, pending);
  return pending;
}

/** 這個資料夾名是否屬於本套件的暫存教材資料夾 */
export function isTestMaterialsDir(dirName: string): boolean {
  return new RegExp(`^${TEST_MATERIALS_DIR_PREFIX}\\d+$`).test(dirName);
}

/** 刪除本程序的暫存教材資料夾（測試檔結束時使用；失敗不拋出） */
export function removeTestMaterialsDir(dir: string | null = materialsDir): void {
  if (!dir) return;
  const resolved = path.resolve(dir);
  if (path.resolve(path.dirname(resolved)) !== path.resolve(os.tmpdir())) return;
  if (!isTestMaterialsDir(path.basename(resolved))) return;
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch {
    // 清理失敗不應令測試失敗
  }
}

/**
 * 匯入合成試點教材並回傳與 `importPilotMaterialFromDisk` 相同的結果。
 *
 * `excerptsFromTopic`：把該課題既有題目（通常是在教材匯入前建立的示範題庫）的原文節錄
 * 加入合成教材，令「匯入教材後重新定位教材依據」的路徑有可逐字比對的段落。這些節錄
 * 本來就隨示範題庫提交在版本控制內，不涉及額外的受版權內容。
 *
 * 任何一步失敗都拋出錯誤（fail-closed），令依賴教材的測試不會靜默變成空轉。
 */
export async function importTestPilotMaterial(
  options: { runOcr?: boolean; excerptsFromTopic?: string } = {},
) {
  let extras: string[] = [];
  if (options.excerptsFromTopic) {
    const questions = await import("@/server/repositories/questions");
    extras = questions
      .listQuestions({ topicId: options.excerptsFromTopic })
      .map((question) => question.sourceExcerpt)
      .filter((excerpt) => excerpt.trim().length > 0);
  }
  await prepareMaterialsDir(extras);
  const materialService = await import("@/server/services/material-service");
  const result = await materialService.importPilotMaterialFromDisk({
    runOcr: options.runOcr ?? false,
  });
  if (!result) throw new Error("找不到合成試點教材（測試 fixture 建立失敗）");
  if (result.outcome.document.status !== "ready") {
    throw new Error(
      `合成試點教材擷取失敗（status=${result.outcome.document.status}）：${
        result.outcome.document.errorMessage ?? "沒有錯誤訊息"
      }`,
    );
  }
  if (result.outcome.blocks.length === 0) {
    throw new Error("合成試點教材擷取成功但沒有段落");
  }
  return result;
}
