/**
 * 開放教材給學生（**擁有者授權的批次開放**）。
 *
 * 背景與界線（重要）：
 *   - 平台的教材版權閘門要求**逐份文件**由管理員確認兩件事：版權／發行權
 *     （一律必要），以及教師版文件（檔名標示 `_TE` 等）的內容安全覆核
 *     （見 README「教材版權與學生可用範圍」）。這個關卡同時保護**學生自行觸發的
 *     AI 出題**及**題目來源節錄**（教材內容及其衍生的題目、節錄都不會外流）。
 *   - 本腳本讓擁有者一次過為所選文件作出這兩項確認，只應在擁有者／校方明確指示時
 *     使用（例如校方已確認課本可在校內平台向學生發布）。
 *   - 腳本**不會**判斷版權狀態，也不會代任何人判斷：`rights_confirmed_by` 記錄的是
 *     下達指示的擁有者電郵，理由（`--reason`）寫入授權紀錄檔，令日後仍可回答
 *     「這份文件為何可以給學生看」。
 *   - 教師版文件的內容覆核亦會一併記錄，但**不是**逐段人工核對：`content_reviewed_by`
 *     會如實標明「未逐段人工核對」。段落層的教師專用內容仍由
 *     `isTeacherOnlyBlockText` 在**讀取時**過濾（見 src/server/materials/teacher-content.ts）——
 *     該判斷是模式比對、不是內容理解，可能漏掉以其他方式書寫的答案。
 *
 * 用法：
 *   npm run open:materials -- --owner-email you@school.edu.hk \
 *     --reason "校方已確認課本可在校內平台向學生發布" --apply
 *
 *   預設為**模擬模式**（只列出將開放的文件，不會改動資料）。
 *   加 `--apply` 才會寫入，並同時寫出授權紀錄檔（`--record`，預設
 *   docs/teacher-review/owner-material-openings.json）。
 *
 * 其他參數：
 *   --topics topic-1,topic-3   只開放指定課題的教材（預設：全部非校內試題文件）
 *   --label local|production-snapshot   授權紀錄中的目標標籤（預設 local）
 *
 * 拒絕執行的情況：正式環境（Cloud Run 或 NODE_ENV=production）、缺少 --owner-email
 * 或 --reason。正式環境的資料更新應以「備份快照 + 還原」方式進行（見 README 第十節）。
 *
 * 撤回開放：不需要任何確認且立即生效，請在 `/admin/materials` 逐份關閉
 * （相關欄位為 `student_distribution`，稽核記錄見 `distribution_audit`）。
 */
import fs from "node:fs";
import path from "node:path";

import { getDb } from "../src/server/db/connection";
import { getServerConfig, isProductionRuntime } from "../src/server/config";
import {
  documentIsStudentVisible,
  getDocument,
  listBlocksByDocument,
  listDocuments,
  recordDistributionChange,
  recordDocumentGovernance,
  setDocumentStudentDistribution,
  studentMaterialBlockCounts,
} from "../src/server/repositories/materials";
import { listSections, listTopics } from "../src/server/repositories/topics";
import { isTeacherOnlyBlockText, looksLikeTeacherEdition } from "../src/server/materials/teacher-content";
import { warnIfNpmSwallowedApply } from "./lifecycle-hints";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

const apply = process.argv.includes("--apply");
warnIfNpmSwallowedApply(apply);
const ownerEmail = (readArg("--owner-email") ?? "").trim();
const reason = (readArg("--reason") ?? "").trim();
const label = readArg("--label") ?? "local";
const recordPath = readArg("--record") ?? "docs/teacher-review/owner-material-openings.json";
const topicFilter = (readArg("--topics") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => value.length > 0);

function fail(message: string): never {
  console.error(`\n無法執行：${message}\n`);
  process.exit(1);
}

/** 每份文件被判定為教師專用而不會顯示給學生的段落數（與管理端顯示的數字一致） */
function teacherOnlyBlockCount(documentId: string): number {
  return listBlocksByDocument(documentId).filter((block) =>
    isTeacherOnlyBlockText(
      [block.text, ...(block.table ?? []).flat().map((cell) => cell.text)].join("\n"),
    ),
  ).length;
}

/** 學生實際可用教材的分節數（開放後能否用 AI 出題的直接指標） */
function printAvailability(title: string): void {
  console.log(`\n${title}`);
  for (const topic of listTopics()) {
    const counts = studentMaterialBlockCounts(topic.id);
    const sections = listSections(topic.id);
    const usable = sections.filter((section) => (counts.get(section.id) ?? 0) > 0).length;
    console.log(`  ${topic.id}：有學生可用教材的分節 ${usable}/${sections.length}`);
  }
}

function main(): void {
  if (isProductionRuntime()) {
    fail(
      "偵測到正式環境（Cloud Run／NODE_ENV=production）。批次開放只可在本機執行，\n" +
        "  再把資料庫快照上載到備份 bucket（見 README 第十節「把本機內容帶到正式環境」）。",
    );
  }
  if (ownerEmail.length === 0) {
    fail("缺少 --owner-email：批次開放必須指明授權的擁有者電郵，令紀錄可追溯至真人。");
  }
  if (reason.length < 10) {
    fail("缺少 --reason（至少 10 個字）：請說明為何可開放這些教材給學生，以便日後追查。");
  }

  getDb();
  const targetDatabase = getServerConfig().databasePath;

  const documents = listDocuments();
  const questionBank = documents.filter((document) => document.kind === "question-bank");
  const candidates = documents
    .filter((document) => document.kind !== "question-bank")
    .filter(
      (document) =>
        topicFilter.length === 0 ||
        (document.topicId !== null && topicFilter.includes(document.topicId)),
    );

  const targets = candidates.filter((document) => !documentIsStudentVisible(document));

  console.log(`資料庫：${targetDatabase}`);
  console.log(
    `教材文件：${documents.length} 份（校內試題 ${questionBank.length} 份**永不**列為學生讀物，一律略過）`,
  );
  if (topicFilter.length > 0) {
    console.log(`課題篩選：${topicFilter.join(", ")}`);
  }
  if (targets.length === 0) {
    console.log("\n所有符合條件的教材都已經開放給學生，未作任何改動。");
    printAvailability("現況：");
    return;
  }

  console.log(`\n將開放 ${targets.length} 份教材（學生 AI 出題及題目來源節錄都會使用）：`);
  for (const document of targets) {
    const teacherEdition = looksLikeTeacherEdition(document.fileName);
    console.log(
      `  - ${document.id}｜${document.topicId ?? "（未指定課題）"}｜${document.fileName}` +
        `｜${teacherEdition ? "教師版（需內容覆核）" : "非教師版"}` +
        `｜判定為教師專用而不顯示的段落：${teacherOnlyBlockCount(document.id)} 段`,
    );
  }

  if (!apply) {
    console.log(
      "\n（模擬模式）以上教材**未**開放。要真正開放請加上 --apply，並會同時寫出授權紀錄檔。",
    );
    printAvailability("現況：");
    return;
  }

  const openedAt = new Date().toISOString();
  let distributionChanges = 0;
  for (const document of targets) {
    recordDocumentGovernance({
      documentId: document.id,
      rights: { confirmedBy: ownerEmail, at: openedAt },
      // 教師版文件另需內容安全覆核：如實標明這是擁有者授權的批次開放，不是逐段人工核對
      ...(looksLikeTeacherEdition(document.fileName)
        ? {
            contentSafety: {
              reviewedBy: `${ownerEmail}（擁有者授權批次開放，未逐段人工核對）`,
              at: openedAt,
            },
          }
        : {}),
    });
    if (!document.studentDistribution) {
      setDocumentStudentDistribution(document.id, true);
      recordDistributionChange({
        documentId: document.id,
        allowed: true,
        actorEmail: ownerEmail,
        actorRole: "owner",
      });
      distributionChanges += 1;
    }

    const updated = getDocument(document.id);
    if (!updated || !documentIsStudentVisible(updated)) {
      fail(`文件 ${document.id} 已寫入但仍未對學生可見，請檢查治理紀錄（未繼續處理其餘文件）。`);
    }
  }

  const record = {
    decision: "owner-authorized-student-distribution",
    label,
    target: targetDatabase,
    ownerEmail,
    reason,
    decidedAt: openedAt,
    openedCount: targets.length,
    distributionChanges,
    openedDocuments: targets.map((document) => ({
      id: document.id,
      topicId: document.topicId,
      fileName: document.fileName,
      teacherEdition: looksLikeTeacherEdition(document.fileName),
      teacherOnlyBlocksHiddenFromStudents: teacherOnlyBlockCount(document.id),
    })),
    note:
      "這些教材由擁有者授權批次開放：`rights_confirmed_by` 記錄下達指示的擁有者；" +
      "教師版文件的 `content_reviewed_by` 亦已記錄，但**不是**逐段人工核對（值內已如實標明）。" +
      "AI 出題及題目來源節錄仍會過濾判定為教師專用的段落（答案、評分參考），" +
      "但該判斷是模式比對、不是內容理解，可能漏掉以其他方式書寫的答案。" +
      "撤回開放不需要任何確認且立即生效（管理端 /admin/materials）。",
  };

  const absoluteRecordPath = path.resolve(recordPath);
  fs.mkdirSync(path.dirname(absoluteRecordPath), { recursive: true });
  const existing = fs.existsSync(absoluteRecordPath)
    ? (JSON.parse(fs.readFileSync(absoluteRecordPath, "utf8")) as { decisions?: unknown[] })
    : { decisions: [] };
  const decisions = Array.isArray(existing.decisions) ? existing.decisions : [];
  decisions.push(record);
  fs.writeFileSync(absoluteRecordPath, `${JSON.stringify({ decisions }, null, 2)}\n`, "utf8");

  console.log(
    `\n✓ 已開放 ${targets.length} 份教材（其中 ${distributionChanges} 份的發行權狀態有變更）。`,
  );
  console.log(`  授權紀錄：${recordPath}（第 ${decisions.length} 筆）`);
  printAvailability("開放後：");
  console.log(
    "\n提醒：如需撤回，於 /admin/materials 逐份關閉即可（立即生效，不需確認）；" +
      "正式環境請以離線修改快照的方式進行（見 README 第十節）。",
  );
}

try {
  main();
} catch (error) {
  console.error("批次開放教材失敗：", error);
  process.exit(1);
}
