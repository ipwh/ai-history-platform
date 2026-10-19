/**
 * 97 題待裁決工作清單（Sprint 14，唯讀）。
 *
 * 只讀取既有報告與資料庫（`readOnly`，不 migration），輸出一份教師可直接使用的工作清單：
 * 每題的版本／指紋、結構問題、原文證據狀態、答案與評分方式、provenance 記錄、
 * 既有審核紀錄、缺少的證據、建議下一步，以及「是否仍必須隔離」。
 *
 * 這份清單**不會**作任何裁決，也不會改變題目狀態。分類只反映可核對的證據：
 *   1. original_available        原卷可取得且可以核對（原文標示齊全）
 *   2. original_inconsistent     原卷存在但題目／選項陳述不一致
 *   3. original_missing          原卷缺失
 *   4. locator_missing           原文段落無法定位
 *   5. machine_undecidable       其他無法由機器可靠判斷
 *
 * 用法：
 *   npx tsx scripts/audit-adjudication-worklist.ts
 *   npx tsx scripts/audit-adjudication-worklist.ts --database "C:\\temp\\copy.db" --out docs/quality/adjudication-worklist-2026-10-19
 */
import fs from "node:fs";
import path from "node:path";

import { openReadOnlyDatabase } from "../src/server/db/connection";

const SERVABILITY = "docs/quality/servability-remediation-2026-10-19.json";
const EVIDENCE = "docs/quality/servability-evidence-2026-10-19.json";
const PROVENANCE_RISK = "docs/quality/provenance-risk-2026-10-19.json";

interface ServabilityItem {
  id: string;
  revision: number;
  fingerprint: string;
  questionType: string;
  status: string;
  teacherConfirmationRequired: boolean;
  issueCode: string;
  category: string;
  reason: string;
  hasSourceDocument: boolean;
  attempts: number;
  snapshots: number;
  reviewRecords: number;
  currentHumanReview: boolean;
  recommendation: string;
  needsHumanDecision: boolean;
}

interface EvidenceItem {
  id: string;
  sourceLocation: string;
  referencedLabels: string[];
  status: string;
  evidence: string[];
  statementLines: string[];
  proposedStem: string | null;
  note: string;
}

interface ProvenanceRow {
  questionId: string;
  tier: string;
  riskClass: string;
  basis: string;
}

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function readJson<T>(relativePath: string): T {
  const full = path.resolve(process.cwd(), relativePath);
  if (!fs.existsSync(full)) throw new Error(`找不到輸入報告：${relativePath}`);
  return JSON.parse(fs.readFileSync(full, "utf8")) as T;
}

type EvidenceCategory =
  | "original_available"
  | "original_inconsistent"
  | "original_missing"
  | "locator_missing"
  | "machine_undecidable";

interface WorkItem {
  questionId: string;
  revision: number;
  fingerprint: string;
  status: string;
  teacherConfirmationRequired: boolean;
  issueCode: string;
  issueCategory: string;
  structuralReason: string;
  questionType: string;
  correctAnswer: string | null;
  acceptedAnswers: string[];
  gradingPoints: string[];
  gradingMethod: string;
  sourceLocation: string | null;
  sourceBlockIds: string[];
  hasOriginalFile: boolean;
  evidenceStatus: EvidenceItem["status"] | null;
  evidenceCategory: EvidenceCategory;
  evidenceCategoryLabel: string;
  evidenceLines: string[];
  missingEvidence: string[];
  provenance: { tier: string; riskClass: string; basis: string } | null;
  review: {
    records: number;
    currentHumanReview: boolean;
    latestDecision: string | null;
    latestReviewer: string | null;
    latestReviewedAt: string | null;
  };
  suggestedNextStep: string;
  mustStayQuarantined: boolean;
  lastAuditedAt: string;
  dataSources: string[];
}

const CATEGORY_LABEL: Record<EvidenceCategory, string> = {
  original_available: "原卷可取得且可以核對",
  original_inconsistent: "原卷存在但題目／選項陳述不一致",
  original_missing: "原卷缺失",
  locator_missing: "原文段落無法定位",
  machine_undecidable: "其他無法由機器可靠判斷",
};

function categorise(status: EvidenceItem["status"] | null): EvidenceCategory {
  switch (status) {
    case "labels_present_in_source":
      return "original_available";
    case "statement_count_mismatch":
      return "original_inconsistent";
    case "source_file_missing":
      return "original_missing";
    case "source_block_not_found":
      return "locator_missing";
    case "labels_missing_in_source":
      // 原文存在但標示不齊全：屬「可以核對，但需要教師按原卷補回」
      return "original_available";
    default:
      return "machine_undecidable";
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const repo = process.cwd();
  const databasePath = path.resolve(readArg(argv, "--database") ?? path.join(repo, "data", "app.db"));
  const outBase = path.resolve(
    repo,
    readArg(argv, "--out") ?? "docs/quality/adjudication-worklist-2026-10-19",
  );

  const servability = readJson<{ generatedAt: string; items: ServabilityItem[] }>(SERVABILITY);
  const evidence = readJson<{ generatedAt: string; items: EvidenceItem[] }>(EVIDENCE);
  const provenance = fs.existsSync(path.resolve(repo, PROVENANCE_RISK))
    ? readJson<{ generatedAt: string; rows: ProvenanceRow[] }>(PROVENANCE_RISK)
    : null;

  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  // 唯讀連線（不建立檔案、不執行 migration）
  const db = openReadOnlyDatabase(databasePath);
  const evidenceById = new Map(evidence.items.map((item) => [item.id, item]));
  const provenanceById = new Map((provenance?.rows ?? []).map((row) => [row.questionId, row]));

  const items: WorkItem[] = [];
  try {
    for (const item of servability.items) {
      const row = db
        .prepare(
          `SELECT question, correct_answer, accepted_answers_json, grading_points_json,
                  source_location, source_block_ids_json
           FROM questions WHERE id = ?`,
        )
        .get(item.id) as
        | {
            question: string;
            correct_answer: string;
            accepted_answers_json: string | null;
            grading_points_json: string | null;
            source_location: string | null;
            source_block_ids_json: string | null;
          }
        | undefined;
      const latest = db
        .prepare(
          `SELECT decision, reviewer_email, created_at FROM question_reviews
           WHERE question_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`,
        )
        .get(item.id) as
        | { decision: string; reviewer_email: string; created_at: string }
        | undefined;

      const ev = evidenceById.get(item.id) ?? null;
      const prov = provenanceById.get(item.id) ?? null;
      const category = categorise(ev?.status ?? null);
      const sourceBlockIds = row?.source_block_ids_json
        ? (JSON.parse(row.source_block_ids_json) as string[])
        : [];

      const missingEvidence: string[] = [];
      if (!ev) missingEvidence.push("沒有原文核對紀錄");
      if (ev?.status === "source_file_missing") missingEvidence.push("找不到原始試題檔");
      if (ev?.status === "source_block_not_found") missingEvidence.push("無法在原始檔定位題幹段落");
      if (category === "original_inconsistent")
        missingEvidence.push("原文陳述數與選項指涉不符，需要教師按原卷核對");
      if (category === "original_available" && ev?.status === "labels_missing_in_source")
        missingEvidence.push("原文標示不齊全，需要原卷或教師確認 i／ii／iii 的對應");
      if (item.issueCode === "FILL_ANSWER_LEAKS")
        missingEvidence.push("題幹與答案重疊；需要教師決定改寫題幹或維持不派發");

      items.push({
        questionId: item.id,
        revision: item.revision,
        fingerprint: item.fingerprint,
        status: item.status,
        teacherConfirmationRequired: item.teacherConfirmationRequired,
        issueCode: item.issueCode,
        issueCategory: item.category,
        structuralReason: item.reason,
        questionType: item.questionType,
        correctAnswer: row?.correct_answer ?? null,
        acceptedAnswers: row?.accepted_answers_json
          ? (JSON.parse(row.accepted_answers_json) as string[])
          : [],
        gradingPoints: row?.grading_points_json
          ? (JSON.parse(row.grading_points_json) as string[])
          : [],
        gradingMethod:
          item.questionType === "fill"
            ? "填充題：字面對比 + 可接受答案；必要時 AI 語意批改"
            : "選擇題：選項完全比對",
        sourceLocation: ev?.sourceLocation ?? row?.source_location ?? null,
        sourceBlockIds,
        hasOriginalFile: item.hasSourceDocument,
        evidenceStatus: ev?.status ?? null,
        evidenceCategory: category,
        evidenceCategoryLabel: CATEGORY_LABEL[category],
        evidenceLines: ev?.evidence ?? [],
        missingEvidence,
        provenance: prov
          ? { tier: prov.tier, riskClass: prov.riskClass, basis: prov.basis }
          : null,
        review: {
          records: item.reviewRecords,
          currentHumanReview: item.currentHumanReview,
          latestDecision: latest?.decision ?? null,
          latestReviewer: latest?.reviewer_email ?? null,
          latestReviewedAt: latest?.created_at ?? null,
        },
        suggestedNextStep:
          category === "original_missing"
            ? "取得原卷掃描；未能取得前維持隔離，或由科組決定永久不派發"
            : category === "locator_missing"
              ? "重新定位原卷題幹段落；定位前維持隔離"
              : category === "original_inconsistent"
                ? "教師按原卷核對陳述與選項；確認後才可提交 approve_after_verified_repair"
                : "教師按原卷核對後決定：補回標示並核准、退回草稿、或永久不派發",
        mustStayQuarantined: true,
        lastAuditedAt: servability.generatedAt,
        dataSources: [
          SERVABILITY,
          EVIDENCE,
          ...(prov ? [PROVENANCE_RISK] : []),
          "questions（readOnly）",
          "question_reviews（readOnly）",
        ],
      });
    }
  } finally {
    db.close();
  }

  const byCategory: Record<string, number> = {};
  for (const item of items) {
    byCategory[item.evidenceCategory] = (byCategory[item.evidenceCategory] ?? 0) + 1;
  }
  const roman = items.filter((item) => item.issueCode === "MCQ_ROMAN_LABEL_MISSING");
  const romanByCategory: Record<string, number> = {};
  for (const item of roman) {
    romanByCategory[item.evidenceCategory] = (romanByCategory[item.evidenceCategory] ?? 0) + 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    notice:
      "唯讀工作清單：不含裁決、不改變題目狀態。所有題目維持不可派發，直至教師按原卷作出決定。",
    totals: {
      questions: items.length,
      romanLabelMissing: roman.length,
      answerLeak: items.length - roman.length,
      autoRepairCandidates: 0,
      mustStayQuarantined: items.filter((item) => item.mustStayQuarantined).length,
    },
    byEvidenceCategory: byCategory,
    romanByEvidenceCategory: romanByCategory,
    items,
  };

  fs.mkdirSync(path.dirname(`${outBase}.json`), { recursive: true });
  fs.writeFileSync(`${outBase}.json`, `${JSON.stringify(report, null, 1)}\n`, "utf8");

  const lines: string[] = [];
  lines.push("# 97 題待裁決工作清單（Sprint 14，唯讀）", "");
  lines.push(`產生時間：${report.generatedAt}`, "");
  lines.push("> 只提出建議，不代表裁決。所有題目維持不可派發。", "");
  lines.push("## 統計", "");
  lines.push("| 項目 | 數量 |", "| --- | --- |");
  lines.push(`| 待裁決題目 | ${items.length} |`);
  lines.push(`| Roman numeral 標示缺失 | ${roman.length} |`);
  lines.push(`| 答案外洩 | ${items.length - roman.length} |`);
  lines.push(`| **可自動補標示** | **0** |`);
  lines.push("");
  lines.push("## 96 題 Roman numeral：證據分類", "");
  lines.push("| 分類 | 題數 |", "| --- | --- |");
  for (const [key, count] of Object.entries(romanByCategory)) {
    lines.push(`| ${CATEGORY_LABEL[key as EvidenceCategory]}（${key}） | ${count} |`);
  }
  lines.push("");
  lines.push("## 逐題清單", "");
  lines.push(
    "| 題目 | 版本 | 結構問題 | 證據分類 | 原文位置 | 缺甚麼 | 建議下一步 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const item of items) {
    lines.push(
      `| \`${item.questionId}\` | ${item.revision} | ${item.issueCode} | ${item.evidenceCategoryLabel} | ${item.sourceLocation ?? "（無）"} | ${item.missingEvidence.join("；") || "—"} | ${item.suggestedNextStep} |`,
    );
  }
  lines.push("");
  lines.push("## 限制", "");
  lines.push("- 分類依 `audit:servability-evidence` 的機器比對結果；原文標示齊全≠歷史內容正確。");
  lines.push("- 沒有原文檔案時，本清單不會推測正確題幹或答案。");
  lines.push("- `provenance` 欄位只表示該題是否同時出現在 provenance 風險報告；P3 不代表核准。");
  fs.writeFileSync(`${outBase}.md`, `${lines.join("\n")}\n`, "utf8");

  console.log("totals", report.totals);
  console.log("romanByEvidenceCategory", romanByCategory);
  console.log(`已寫入 ${path.relative(repo, `${outBase}.json`)} 及 .md`);
  console.log("唯讀：沒有修改題目、審核紀錄或發布狀態。");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
