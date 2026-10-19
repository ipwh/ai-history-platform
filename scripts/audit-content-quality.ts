/**
 * 唯讀內容稽核 CLI。
 *
 * 用法：
 *   npx tsx scripts/audit-content-quality.ts
 *   npx tsx scripts/audit-content-quality.ts --database "C:\\temp\\snapshot.db" --out-json docs/quality/x.json
 *
 * 只讀取資料庫；不寫入題目、覆核或發布狀態，也不輸出學生資料或秘密。
 */
import fs from "node:fs";
import path from "node:path";

import { loadContentAudit } from "../src/server/quality/content-audit";
import type { AuditedQuestion } from "../src/server/quality/content-audit";

const READ_ONLY_NOTICE =
  "唯讀稽核：只讀取資料庫，沒有修改題目、覆核或發布狀態；輸出不含學生資料或秘密。";

const RECOMMENDATIONS: Record<string, string> = {
  SOURCE_LOCATION_UNVERIFIED: "建立校內試題文件紀錄（檔名、題號、雜湊）及匯入批次，或由教師確認來源",
  SOURCE_DOCUMENT_RECORD_MISSING: "為來源文件建立 material_documents 紀錄",
  SOURCE_HASH_MISSING: "記錄來源檔案的 SHA-256 或既有內容指紋",
  SOURCE_BLOCK_MISSING: "來源段落已不存在，重新連結或由教師確認",
  SOURCE_LOCATION_INCOMPLETE: "補上檔名、題號或頁碼",
  SOURCE_MISSING: "由教師提供來源",
  EXPLANATION_PLACEHOLDER: "由教師補寫解釋（產品政策決定是否暫緩派發）",
  EXPLANATION_ANSWER_ONLY: "補寫理由，說明答案如何由史料或概念支持",
  EXPLANATION_ANSWER_CONFLICT: "教師核對解釋與標準答案是否矛盾",
  EXPLANATION_SHORT_WITHOUT_REASONING: "教師判斷是否需要補寫解釋",
  KNOWLEDGE_POINT_LAYOUT_RESIDUE: "重新標示知識點",
  KNOWLEDGE_POINT_GENERIC: "重新標示為所屬分節",
  KNOWLEDGE_POINT_UNMAPPED: "教師確認知識點是否屬本節",
  KNOWLEDGE_POINT_EMPTY: "補上知識點",
  SKILL_MISSING: "教師提供歷史技能標籤",
  TOPIC_MISSING: "修正課題關聯",
  SECTION_MISSING: "修正分節關聯",
  SECTION_TOPIC_MISMATCH: "修正分節與課題的對應",
  DIFFICULTY_INVALID: "修正難度值",
};

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function recommendationsFor(question: AuditedQuestion): string[] {
  const codes = new Set<string>([
    ...question.source.codes,
    ...question.explanation.codes,
    ...question.metadata.issues.map((issue) => issue.code),
    ...question.policy.findings.map((finding) => finding.code),
  ]);
  return [...new Set([...codes].map((code) => RECOMMENDATIONS[code]).filter(Boolean))];
}

function main(): void {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const databasePath = path.resolve(
    readArg(argv, "--database") ?? path.join(repo, "data", "app.db"),
  );
  const outJson = path.resolve(
    readArg(argv, "--out-json") ??
      path.join(repo, "docs", "quality", "content-audit-2026-10-19.json"),
  );
  const outMd = path.resolve(
    readArg(argv, "--out-md") ??
      path.join(repo, "docs", "quality", "content-audit-2026-10-19.md"),
  );

  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  const audit = loadContentAudit(databasePath);
  const questions = audit.questions.map((question) => ({
    id: question.id,
    revision: question.revision,
    status: question.status,
    sourceStatus: question.source.status,
    sourceCodes: question.source.codes,
    explanationClass: question.explanation.class,
    explanationCodes: question.explanation.codes,
    metadataIssues: question.metadata.issues,
    policyFindings: question.policy.findings,
    canServe: question.policy.canServe,
    releasable: question.policy.releasable,
    recommendedActions: recommendationsFor(question),
  }));

  const payload = {
    generatedAt: audit.generatedAt,
    notice: READ_ONLY_NOTICE,
    scope: { database: path.relative(repo, databasePath).replace(/\\/g, "/") },
    inputFingerprint: audit.inputFingerprint,
    totals: audit.totals,
    source: audit.source,
    explanation: audit.explanation,
    metadata: audit.metadata,
    policy: audit.policy,
    questions,
  };

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const lines: string[] = [];
  lines.push("# 題目內容稽核（來源／解釋／元數據）");
  lines.push("");
  lines.push(`> ${READ_ONLY_NOTICE}`);
  lines.push("");
  lines.push(`- 產生時間：${audit.generatedAt}`);
  lines.push(`- 資料庫（唯讀）：${payload.scope.database}`);
  lines.push(`- 內容指紋：\`${audit.inputFingerprint}\``);
  lines.push(`- 題目：${audit.totals.questions}（已發布 ${audit.totals.published}）`);
  lines.push("");
  lines.push("## 來源可追溯性");
  lines.push("");
  lines.push("| 狀態 | 題數 |");
  lines.push("| --- | --- |");
  for (const [status, count] of Object.entries(audit.source.counts)) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push("");
  lines.push(
    `缺少文件紀錄：${audit.source.missingDocumentRecord}；缺少題號：${audit.source.missingQuestionNumber}；缺少來源雜湊：${audit.source.missingSourceHash}；失效段落引用：${audit.source.staleBlockReferences}；匯入批次表：不存在（schema 缺口）`,
  );
  lines.push("");
  lines.push("**來源可追溯 ≠ 歷史正確 ≠ 版權許可。**");
  lines.push("");
  lines.push("## 解釋品質");
  lines.push("");
  lines.push("| 分類 | 題數 |");
  lines.push("| --- | --- |");
  for (const [name, count] of Object.entries(audit.explanation.counts)) {
    lines.push(`| ${name} | ${count} |`);
  }
  lines.push("");
  lines.push(
    `有人工覆核但仍屬低品質：${audit.explanation.reviewedButLowQuality}；以非 automation 角色寫入的自動修復紀錄：${audit.explanation.automationApprovalsRecordedAsHuman}；來源不明的審核紀錄：${audit.explanation.unknownReviewOrigin}`,
  );
  lines.push("");
  lines.push("## 元數據");
  lines.push("");
  lines.push("| 代碼 | 數量 |");
  lines.push("| --- | --- |");
  for (const [code, count] of Object.entries(audit.metadata.byCode)) {
    lines.push(`| ${code} | ${count} |`);
  }
  lines.push("");
  lines.push(
    `嚴重程度：阻擋 ${audit.metadata.bySeverity.blocking}、需覆核 ${audit.metadata.bySeverity.needs_review}、警告 ${audit.metadata.bySeverity.warning}；技能空白 ${audit.metadata.skillMissing}；難度值：${Object.keys(audit.metadata.difficulty).join("／") || "（無）"}`,
  );
  lines.push("");
  lines.push("## 政策分類");
  lines.push("");
  lines.push("| 類別 | 發現數 |");
  lines.push("| --- | --- |");
  for (const [category, count] of Object.entries(audit.policy.byCategory)) {
    lines.push(`| ${category} | ${count} |`);
  }
  lines.push("");
  lines.push(
    `可派發：${audit.totals.canServe}／${audit.totals.questions}；硬性阻擋：${audit.totals.notServable}；具發布資格（無待決政策）：${audit.totals.releasable}`,
  );
  lines.push("");
  lines.push("## 問題題目（節錄）");
  lines.push("");
  lines.push("完整逐題清單（問題代碼、嚴重程度、建議）見 JSON。以下為每個來源狀態及解釋分類的首 3 題：");
  lines.push("");
  const examples: AuditedQuestion[] = [];
  for (const status of Object.keys(audit.source.counts) as (keyof typeof audit.source.counts)[]) {
    examples.push(...audit.questions.filter((question) => question.source.status === status).slice(0, 3));
  }
  for (const name of Object.keys(audit.explanation.counts) as (keyof typeof audit.explanation.counts)[]) {
    examples.push(
      ...audit.questions.filter((question) => question.explanation.class === name).slice(0, 2),
    );
  }
  lines.push("| 題目 | 來源 | 解釋 | 元數據 | 政策 | 建議 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const question of examples) {
    lines.push(
      `| ${question.id} | ${question.source.status} | ${question.explanation.class} | ${question.metadata.issues.map((issue) => issue.code).join("、") || "—"} | ${question.policy.findings.map((finding) => finding.code).join("、") || "—"} | ${recommendationsFor(question).join("；") || "—"} |`,
    );
  }
  lines.push("");

  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(outMd, `${lines.join("\n")}\n`, "utf8");

  console.log(READ_ONLY_NOTICE);
  console.log(`題目：${audit.totals.questions}`);
  console.log(`來源：${JSON.stringify(audit.source.counts)}`);
  console.log(`解釋：${JSON.stringify(audit.explanation.counts)}`);
  console.log(`元數據：技能空白 ${audit.metadata.skillMissing}，阻擋級 ${audit.metadata.blockingReferences}`);
  console.log(`政策：${JSON.stringify(audit.policy.byCategory)}`);
  console.log(`指紋：${audit.inputFingerprint}`);
  console.log(`已寫入：${path.relative(repo, outJson)}`);
  console.log(`已寫入：${path.relative(repo, outMd)}`);
}

main();
