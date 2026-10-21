/**
 * 逐題核對「需核對課本依據」題目，並把結果寫入可追溯的核對紀錄。
 *
 * 背景：教師工作台的「需核對課本依據的題目」佇列來自
 * `docs/quality/review-priority-manifest-2026-10-19.json`（623 題，全部是自動修復改動過題幹或選項）。
 * 擁有者指示：由 AI 依教材及歷史知識逐題核對，不需要人手核對，完成後清空該佇列。
 *
 * 用法：
 *   # 1. 匯出待核對批次（唯讀）
 *   npx tsx scripts/verify-provenance-manifest.ts --export tmp/batches --batch-size 60
 *
 *   # 2. 檢視覆蓋率（唯讀）
 *   npx tsx scripts/verify-provenance-manifest.ts --report
 *
 *   # 3. 寫入核對結果（預設模擬；要 --apply）
 *   npx tsx scripts/verify-provenance-manifest.ts --verdicts tmp/verdicts.json --apply
 *
 * 界線（與其他批次工具一致）：
 *   - 預設 dry-run，要 `--apply` 才寫入紀錄檔。
 *   - 核對紀錄綁定 revision 及 fingerprint；題目日後再改動，該題會自動回到佇列。
 *   - **不會**寫入 `question_reviews`：這是 AI 依教材及史實的核對，不是教師覆核。
 *   - `needs-teacher` 的題目不會移出佇列。
 */
import fs from "node:fs";
import path from "node:path";

import { openReadOnlyDatabase } from "../src/server/db/connection";
import { getServerConfig } from "../src/server/config";
import { questionFingerprint } from "../src/server/quality/question-fingerprint";
import {
  ledgerDigest,
  mergeVerificationEntries,
  resolveLedgerState,
  validateVerificationEntries,
  type ProvenanceVerificationEntry,
  type ProvenanceVerificationLedger,
} from "../src/server/services/provenance-verification";
import type { Question } from "../src/lib/types";

const LEDGER_PATH = "docs/quality/provenance-verification-2026-10-21.json";
const MANIFEST_PATH = "docs/quality/review-priority-manifest-2026-10-19.json";

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

interface IdentityRow {
  id: string;
  revision: number;
  question_type: "mc" | "fill";
  question: string;
  options_json: string | null;
  correct_answer: string;
  accepted_answers_json: string | null;
  explanation: string;
  topic_id: string;
  section_id: string | null;
  difficulty: string;
  knowledge_point: string;
  grading_points_json: string | null;
  skill: string | null;
  source_excerpt: string | null;
  source_location: string | null;
}

function parseArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function fingerprintOf(row: IdentityRow): string {
  return questionFingerprint({
    id: row.id,
    topicId: row.topic_id,
    sectionId: row.section_id ?? "",
    questionType: row.question_type,
    difficulty: row.difficulty,
    question: row.question,
    options: parseArray(row.options_json),
    correctAnswer: row.correct_answer,
    acceptedAnswers: parseArray(row.accepted_answers_json),
    explanation: row.explanation,
    knowledgePoint: row.knowledge_point,
    gradingPoints: parseArray(row.grading_points_json),
    skill: row.skill,
  } as Question);
}

function loadLedger(): ProvenanceVerificationLedger {
  const full = path.resolve(process.cwd(), LEDGER_PATH);
  if (!fs.existsSync(full)) {
    return {
      notice:
        "逐題課本依據核對紀錄：綁定 revision 及 fingerprint；題目再改動即自動失效並重回佇列。不是教師覆核。",
      entries: [],
    };
  }
  return JSON.parse(fs.readFileSync(full, "utf8")) as ProvenanceVerificationLedger;
}

interface ManifestRowLite {
  questionId: string;
  priority: string;
  repairCategory: string;
  notes?: string[];
  originalStem?: string | null;
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const exportDir = readArg(argv, "--export");
  const verdictsPath = readArg(argv, "--verdicts");
  const reportOnly = argv.includes("--report") || (!exportDir && !verdictsPath);
  const batchSize = Number(readArg(argv, "--batch-size") ?? "60");
  const verifiedBy = (readArg(argv, "--verified-by") ?? "ai-textbook-verification").trim();

  const databasePath = path.resolve(process.cwd(), readArg(argv, "--database") ?? "data/app.db");
  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  const ledger = loadLedger();
  const db = openReadOnlyDatabase(databasePath);
  const identityStmt = db.prepare(
    `SELECT id, revision, question_type, question, options_json, correct_answer,
            accepted_answers_json, explanation, topic_id, section_id, difficulty,
            knowledge_point, grading_points_json, skill, source_excerpt, source_location
     FROM questions WHERE id = ?`,
  );
  const getIdentity = (id: string): IdentityRow | undefined =>
    identityStmt.get(id) as IdentityRow | undefined;
  const identityOf = (id: string) => {
    const row = getIdentity(id);
    if (!row) return null;
    return { revision: row.revision, fingerprint: fingerprintOf(row) };
  };

  try {
    const provenancePath = path.resolve(process.cwd(), "docs/quality/provenance-risk-2026-10-19.json");
    const provenance = JSON.parse(fs.readFileSync(provenancePath, "utf8")) as {
      rows: {
        questionId: string;
        tier: string;
        riskClass: string;
        notes: string[];
        basis: string;
        originalStem: string | null;
        originalCorrectAnswer: string | null;
      }[];
    };
    const manifestPath = path.resolve(process.cwd(), MANIFEST_PATH);
    const manifestRows: ManifestRowLite[] = fs.existsSync(manifestPath)
      ? ((JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { rows: ManifestRowLite[] }).rows ?? [])
      : [];
    const manifestById = new Map(manifestRows.map((row) => [row.questionId, row]));

    const states = provenance.rows.map((row) => ({
      row,
      state: resolveLedgerState(row.questionId, identityOf(row.questionId), ledger),
    }));
    const cleared = states.filter((item) => item.state.status === "cleared");
    const pending = states.filter((item) => item.state.status !== "cleared");

    if (exportDir) {
      const target = path.resolve(process.cwd(), exportDir);
      fs.mkdirSync(target, { recursive: true });
      for (const file of fs.readdirSync(target)) {
        if (/^verify-batch-\d+\.json$/.test(file)) fs.unlinkSync(path.join(target, file));
      }
      const batches: { row: (typeof provenance.rows)[number]; state: (typeof pending)[number]["state"] }[][] = [];
      for (let index = 0; index < pending.length; index += batchSize) {
        batches.push(pending.slice(index, index + batchSize));
      }
      for (const [batchIndex, batch] of batches.entries()) {
        const payload = {
          batch: batchIndex + 1,
          notice:
            "逐題核對用：判斷現時題幹是否仍考核原答案、填回題幹的答案是否正確、是否有答案外洩。" +
            "結果寫入 docs/quality/provenance-verification-2026-10-21.json（不是教師覆核）。",
          entries: batch.map(({ row, state }) => {
            const identity = getIdentity(row.questionId);
            return {
              questionId: row.questionId,
              revision: identity?.revision ?? null,
              fingerprint: identity ? fingerprintOf(identity) : null,
              priority: row.tier,
              repairCategory: row.riskClass,
              repairBasis: row.basis,
              notes: row.notes,
              originalStem: row.originalStem,
              currentStem: identity?.question ?? null,
              currentCorrectAnswer: identity?.correct_answer ?? null,
              acceptedAnswers: parseArray(identity?.accepted_answers_json ?? null),
              options: parseArray(identity?.options_json ?? null),
              sourceLocation: identity?.source_location ?? null,
              sourceExcerpt: identity?.source_excerpt ?? null,
              ledgerStatus: state.status,
            };
          }),
        };
        fs.writeFileSync(
          path.join(target, `verify-batch-${String(batchIndex + 1).padStart(3, "0")}.json`),
          `${JSON.stringify(payload, null, 1)}\n`,
          "utf8",
        );
      }
      console.log(`已匯出 ${batches.length} 個批次（共 ${pending.length} 題待核對）到 ${exportDir}`);
    }

    if (verdictsPath) {
      if (!apply) {
        console.log("\n（模擬模式）未寫入核對紀錄。要真正寫入請加上 --apply。");
        return;
      }
      const full = path.resolve(process.cwd(), verdictsPath);
      const incomingRaw = JSON.parse(fs.readFileSync(full, "utf8")) as {
        entries?: {
          questionId: string;
          verdict: string;
          basis: string;
          method?: "manual-review" | "automated-diff";
          checks?: string[];
          correction?: { field: string; from: string; to: string };
        }[];
      };
      const incoming: ProvenanceVerificationEntry[] = (incomingRaw.entries ?? []).map((entry) => {
        const identity = identityOf(entry.questionId);
        if (!identity) throw new Error(`資料庫內找不到題目：${entry.questionId}`);
        return {
          questionId: entry.questionId,
          revision: identity.revision,
          fingerprint: identity.fingerprint,
          verdict: entry.verdict as ProvenanceVerificationEntry["verdict"],
          basis: entry.basis.trim(),
          verifiedBy,
          verifiedAt: new Date().toISOString(),
          ...(entry.method ? { method: entry.method } : {}),
          ...(entry.checks ? { checks: entry.checks } : {}),
          ...(entry.correction ? { correction: entry.correction } : {}),
        };
      });
      const issues = validateVerificationEntries(incoming);
      if (issues.length > 0) {
        for (const issue of issues) console.error(`✗ ${issue.questionId}：${issue.message}`);
        console.error(`\n共 ${issues.length} 個問題；整批不寫入。`);
        process.exit(1);
      }
      const merged = mergeVerificationEntries(ledger, incoming);
      const full2 = path.resolve(process.cwd(), LEDGER_PATH);
      fs.mkdirSync(path.dirname(full2), { recursive: true });
      fs.writeFileSync(full2, `${JSON.stringify(merged, null, 1)}\n`, "utf8");
      console.log(`✓ 已寫入 ${incoming.length} 筆核對結果（紀錄共 ${merged.entries.length} 筆）`);
      console.log(`  紀錄：${LEDGER_PATH}`);
      console.log(`  摘要：${ledgerDigest(merged)}`);
      return;
    }

    if (reportOnly) {
      const byStatus: Record<string, number> = {};
      for (const state of states) {
        byStatus[state.state.status] = (byStatus[state.state.status] ?? 0) + 1;
      }
      console.log(`清單題目：${provenance.rows.length}`);
      console.log(`核對紀錄：${ledger.entries.length} 筆`);
      console.log(`狀態：${JSON.stringify(byStatus)}`);
      console.log(`仍會出現在佇列：${pending.length}`);
      if (manifestById.size > 0) console.log(`現有 manifest 列數：${manifestById.size}`);
      if (cleared.length > 0) console.log(`已核對並移出：${cleared.length}`);
      console.log(`資料庫：${getServerConfig().databasePath}`);
    }
  } finally {
    db.close();
  }
}

main();
