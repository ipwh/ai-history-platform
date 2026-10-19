/**
 * 623 題 provenance 風險的覆核優先次序 manifest（Sprint 15，唯讀）。
 *
 * 目的：把「只有自動修復證據」的題目轉成**可執行的人類覆核清單**，每題附上
 * 明確的證據契約（要核對甚麼、缺甚麼、需要誰決定），並避免把 124 題重疊
 * （provenance × 來源待核實）當成額外的獨立組別。
 *
 * 資料來源（全部唯讀）：
 *   - docs/quality/provenance-risk-2026-10-19.json（623 題分級及 diff 摘要）
 *   - docs/quality/content-audit-2026-10-19.json（來源狀態）
 *   - docs/quality/review-provenance-2026-10-19.json（目前版本的審核證據來源）
 *   - docs/quality/servability-remediation-2026-10-19.json（目前可作答性）
 *   - docs/quality/source-provenance-crosswalk-2026-10-19.json（重疊清單）
 *   - SQLite（`openReadOnlyDatabase`）：revision、答案、可接受答案、grading points
 *
 * 輸出：docs/quality/review-priority-manifest-2026-10-19.{json,md}
 *
 * 這份 manifest 只是工作排序與證據契約，**不是**核准；P3 也不代表已批准。
 */
import fs from "node:fs";
import path from "node:path";

import { openReadOnlyDatabase } from "../src/server/db/connection";
import { questionFingerprint } from "../src/server/quality/question-fingerprint";
import type { Question } from "../src/lib/types";

interface ProvenanceRow {
  questionId: string;
  revision: number | null;
  tier: string;
  riskClass: string;
  basis: string;
  classifications: string[];
  notes: string[];
  originalStem: string | null;
  currentStem: string | null;
  originalCorrectAnswer: string | null;
  currentCorrectAnswer: string | null;
}

interface AuditQuestion {
  id: string;
  revision: number;
  sourceStatus: "traceable" | "partial" | "unknown" | "pending_verification";
}

interface ReviewEvidenceRow {
  questionId: string;
  automationOnly: boolean;
  hasCurrentTeacherAdjudication: boolean;
}

interface ServabilityItem {
  id: string;
  issueCode: string;
  reason: string;
}

function readJson<T>(relativePath: string): T {
  const full = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(full)) throw new Error(`找不到輸入報告：${relativePath}（請先執行對應 audit）`);
  return JSON.parse(fs.readFileSync(full, "utf8")) as T;
}

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

interface ManifestRow {
  questionId: string;
  revision: number | null;
  fingerprint: string | null;
  priority: string;
  repairCategory: string;
  repairBasis: string;
  classification: string[];
  changedFields: {
    stem: boolean;
    correctAnswer: boolean;
    options: boolean | null;
    blankCount: boolean | null;
    assessedBlankIndex: boolean | null;
  };
  sourceStatus: string;
  sourceMissingEvidence: string[];
  servability: { servable: boolean; issueCode: string | null; reason: string | null };
  reviewEvidence: { automationOnly: boolean; hasTeacherAdjudication: boolean };
  requiresVerification: {
    answer: boolean;
    acceptedAnswers: boolean;
    blankPositions: boolean;
    gradingPoints: boolean;
    gradingSemantics: boolean;
  };
  requiredReviewerRole: "history_reviewer";
  requiredDecision: string;
  overlapsSourcePending: boolean;
  evidenceContract: string[];
}

const P1_CHECKLIST = [
  "空格數量與位置（原卷 vs 現時題幹）",
  "考核哪一個空格（assessedBlankIndex）",
  "答案與空格映射、次序",
  "可接受答案集合及正規化規則",
  "grading points 與計分語義",
  "前端呈現與後端評分是否一致",
  "修復前後 fingerprint 及 provenance 記錄",
];

const P3_CHECKLIST = [
  "題幹文字未變",
  "選項文字及次序未變",
  "標準答案未變",
  "只移除選項開頭殘留項目符號（FORMATTING_CHANGE_ONLY）",
];

function main(): void {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const databasePath = path.resolve(readArg(argv, "--database") ?? path.join(repo, "data", "app.db"));
  const outBase = path.resolve(
    repo,
    readArg(argv, "--out") ?? "docs/quality/review-priority-manifest-2026-10-19",
  );

  const provenance = readJson<{ generatedAt: string; rows: ProvenanceRow[] }>(
    "docs/quality/provenance-risk-2026-10-19.json",
  );
  const audit = readJson<{ generatedAt: string; questions: AuditQuestion[] }>(
    "docs/quality/content-audit-2026-10-19.json",
  );
  const review = readJson<{ questionEvidence: ReviewEvidenceRow[] }>(
    "docs/quality/review-provenance-2026-10-19.json",
  );
  const servability = readJson<{ items: ServabilityItem[] }>(
    "docs/quality/servability-remediation-2026-10-19.json",
  );
  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  const auditById = new Map(audit.questions.map((question) => [question.id, question]));
  const reviewById = new Map(review.questionEvidence.map((row) => [row.questionId, row]));
  const servabilityById = new Map(servability.items.map((item) => [item.id, item]));

  const db = openReadOnlyDatabase(databasePath);
  const rows: ManifestRow[] = [];
  try {
    for (const row of provenance.rows) {
      const question = db
        .prepare(
          `SELECT id, topic_id, section_id, question_type, difficulty, question, options_json,
                  correct_answer, accepted_answers_json, explanation, knowledge_point,
                  grading_points_json, skill, revision
           FROM questions WHERE id = ?`,
        )
        .get(row.questionId) as
        | {
            id: string;
            topic_id: string;
            section_id: string | null;
            question_type: "mc" | "fill";
            difficulty: string;
            question: string;
            options_json: string | null;
            correct_answer: string;
            accepted_answers_json: string | null;
            explanation: string;
            knowledge_point: string;
            grading_points_json: string | null;
            skill: string | null;
            revision: number;
          }
        | undefined;

      const auditRow = auditById.get(row.questionId);
      const servabilityRow = servabilityById.get(row.questionId);
      const reviewRow = reviewById.get(row.questionId);
      const currentStem = question?.question ?? row.currentStem;
      const options = question?.options_json ? (JSON.parse(question.options_json) as string[]) : null;

      const fingerprint = question
        ? questionFingerprint({
            id: question.id,
            topicId: question.topic_id,
            sectionId: question.section_id ?? "",
            questionType: question.question_type,
            difficulty: question.difficulty,
            question: question.question,
            options: options ?? [],
            correctAnswer: question.correct_answer,
            acceptedAnswers: question.accepted_answers_json
              ? (JSON.parse(question.accepted_answers_json) as string[])
              : [],
            explanation: question.explanation,
            knowledgePoint: question.knowledge_point,
            gradingPoints: question.grading_points_json
              ? (JSON.parse(question.grading_points_json) as string[])
              : [],
            skill: question.skill,
          } as Question)
        : null;

      const sourceMissingEvidence: string[] = [];
      if (!auditRow) sourceMissingEvidence.push("不在內容稽核報告內");
      if (auditRow?.sourceStatus === "pending_verification")
        sourceMissingEvidence.push("來源只有檔名＋題號，未核實文件版本");
      if (auditRow?.sourceStatus === "unknown") sourceMissingEvidence.push("來源無法追溯");
      if (row.originalStem === null) sourceMissingEvidence.push("沒有可比較的修復前內容");

      const isFillMultiBlank =
        row.classifications.includes("NO_SEMANTIC_CHANGE_CONFIRMED") &&
        row.originalStem !== null &&
        currentStem !== null &&
        row.originalStem !== currentStem;

      rows.push({
        questionId: row.questionId,
        revision: question?.revision ?? row.revision,
        fingerprint,
        priority: row.tier,
        repairCategory: row.riskClass,
        repairBasis: row.basis,
        classification: row.classifications,
        changedFields: {
          stem: row.originalStem !== null && row.originalStem !== row.currentStem,
          correctAnswer:
            row.originalCorrectAnswer !== null &&
            row.originalCorrectAnswer !== row.currentCorrectAnswer,
          options: null,
          blankCount: null,
          assessedBlankIndex: null,
        },
        sourceStatus: auditRow?.sourceStatus ?? "not_in_audit",
        sourceMissingEvidence,
        servability: {
          servable: servabilityRow === undefined,
          issueCode: servabilityRow?.issueCode ?? null,
          reason: servabilityRow?.reason ?? null,
        },
        reviewEvidence: {
          automationOnly: reviewRow?.automationOnly ?? true,
          hasTeacherAdjudication: reviewRow?.hasCurrentTeacherAdjudication ?? false,
        },
        requiresVerification: {
          answer: row.riskClass === "answer_mapping_changed" || row.tier === "P0",
          acceptedAnswers: true,
          blankPositions: isFillMultiBlank || row.tier === "P1",
          gradingPoints: true,
          gradingSemantics: true,
        },
        requiredReviewerRole: "history_reviewer",
        requiredDecision:
          row.tier === "P3"
            ? "確認格式修復未改變題幹／選項／答案（仍需教師簽署，P3 不代表核准）"
            : row.tier === "P2"
              ? "補回原始來源後再決定可否審核"
              : "按原卷核對題幹、空格、答案及評分語義後核准或退回",
        overlapsSourcePending: auditRow?.sourceStatus === "pending_verification",
        evidenceContract: [
          "題目 ID、revision、fingerprint",
          "provenance 分類及修復前後差異",
          "來源狀態及可核實的文件位置",
          "答案、可接受答案、空格位置、grading points 的核對結果",
          "審核者身分（HISTORY_REVIEWER_EMAILS）、理由及時間",
        ],
      });
    }
  } finally {
    db.close();
  }

  const byTier: Record<string, number> = {};
  const bySourceStatus: Record<string, number> = {};
  for (const row of rows) {
    byTier[row.priority] = (byTier[row.priority] ?? 0) + 1;
    bySourceStatus[row.sourceStatus] = (bySourceStatus[row.sourceStatus] ?? 0) + 1;
  }
  const uniqueIds = new Set(rows.map((row) => row.questionId));

  const report = {
    generatedAt: new Date().toISOString(),
    notice:
      "唯讀覆核優先次序 manifest：不是核准。P3 只代表排序較後。重疊題目不另計為獨立組別。",
    inputs: {
      provenanceRisk: "docs/quality/provenance-risk-2026-10-19.json",
      contentAudit: "docs/quality/content-audit-2026-10-19.json",
      reviewProvenance: "docs/quality/review-provenance-2026-10-19.json",
      servability: "docs/quality/servability-remediation-2026-10-19.json",
      crosswalk: "docs/quality/source-provenance-crosswalk-2026-10-19.json",
      database: databasePath,
    },
    totals: {
      rows: rows.length,
      uniqueQuestions: uniqueIds.size,
      duplicateRows: rows.length - uniqueIds.size,
      byTier,
      bySourceStatus,
      overlappingWithSourcePending: rows.filter((row) => row.overlapsSourcePending).length,
      currentlyUnservable: rows.filter((row) => !row.servability.servable).length,
      withTeacherAdjudication: rows.filter((row) => row.reviewEvidence.hasTeacherAdjudication)
        .length,
    },
    checklists: { P1: P1_CHECKLIST, P3: P3_CHECKLIST },
    rows,
  };

  fs.mkdirSync(path.dirname(`${outBase}.json`), { recursive: true });
  fs.writeFileSync(`${outBase}.json`, `${JSON.stringify(report, null, 1)}\n`, "utf8");

  const lines: string[] = [];
  lines.push("# 623 題覆核優先次序 manifest（Sprint 15，唯讀）", "");
  lines.push(`產生時間：${report.generatedAt}`, "");
  lines.push("> 只是工作排序與證據契約，不是核准。", "");
  lines.push("## 總數", "", "| 指標 | 數量 |", "| --- | --- |");
  lines.push(`| 題目（唯一） | ${uniqueIds.size} |`);
  lines.push(`| 重複列 | ${rows.length - uniqueIds.size} |`);
  for (const [tier, count] of Object.entries(byTier)) lines.push(`| ${tier} | ${count} |`);
  lines.push(`| 與來源待核實重疊 | ${report.totals.overlappingWithSourcePending} |`);
  lines.push(`| 目前不可作答 | ${report.totals.currentlyUnservable} |`);
  lines.push(`| 已有教師逐題裁決 | ${report.totals.withTeacherAdjudication} |`);
  lines.push("");
  lines.push("## P1 核對清單（530 題）", "");
  for (const item of P1_CHECKLIST) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## P3 核對清單（93 題）", "");
  for (const item of P3_CHECKLIST) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## 每題證據契約", "");
  lines.push(
    "| 題目 | 等級 | 修復分類 | 來源狀態 | 重疊 | 需要核對 | 必要決定 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const row of rows.slice(0, 80)) {
    const needs = Object.entries(row.requiresVerification)
      .filter(([, value]) => value)
      .map(([key]) => key)
      .join("、");
    lines.push(
      `| \`${row.questionId}\` | ${row.priority} | ${row.repairCategory} | ${row.sourceStatus} | ${row.overlapsSourcePending ? "是" : "否"} | ${needs} | ${row.requiredDecision} |`,
    );
  }
  if (rows.length > 80) lines.push("", `（其餘 ${rows.length - 80} 題見 JSON。）`);
  lines.push("");
  lines.push("## 限制", "");
  lines.push("- `changedFields.options` 等欄位若為 null，表示報告沒有保存該維度的逐字比較。");
  lines.push("- 抽樣核對不等於逐題核對；本 manifest 沒有把任何題目標記為已覆核。");
  fs.writeFileSync(`${outBase}.md`, `${lines.join("\n")}\n`, "utf8");

  console.log("totals", report.totals);
  console.log(`已寫入 ${path.relative(repo, `${outBase}.json`)} 及 .md`);
  console.log("唯讀：沒有修改題目、審核紀錄或發布狀態。");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
