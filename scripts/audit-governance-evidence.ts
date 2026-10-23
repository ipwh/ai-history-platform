/**
 * 內容治理證據盤點（Sprint 26，唯讀）。
 *
 * 用法：
 *   npx tsx scripts/audit-governance-evidence.ts [--database <path>] [--json] [--out <dir>]
 *
 * 只以 `readOnly: true` 開啟資料庫；**不會**修改題目、覆核、診斷或發布狀態，也不會
 * 生成任何教師決策。輸出的是「證據缺口清單」，供歷史科教師逐項處理。
 *
 * 為甚麼需要這個工具：已發布題目要通過發布關卡，必須有**現行 revision** 的
 *   1. `question_reviews` 的 `approved` 紀錄（教師覆核），或
 *   2. `auto_validated_revision = revision` 的自動品質驗證紀錄（機器檢查，**不等於**教師批准）
 * 兩者都沒有時，題目雖然仍是 published（歷史狀態），但沒有可追溯的目前版本證據。
 * 本工具把這種情況明確列出來，而不是把它當成「已批准」或「已侵權」。
 *
 * 重要限制（不可由本工具推斷）：
 *   - 「有 approved 覆核」不代表史實正確、版權已清或課程適用；
 *   - 「沒有證據」不代表內容錯誤或侵權，只代表**證據缺口**；
 *   - 本工具不連接正式資料庫；正式環境狀態須另行以可追溯方式核對。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

interface QuestionRow {
  id: string;
  topic_id: string;
  section_id: string | null;
  question_type: string;
  origin: string;
  status: string;
  revision: number;
  auto_validated_at: string | null;
  auto_validated_revision: number | null;
  teacher_confirmation_required: number;
  source_block_ids_json: string | null;
  source_excerpt: string | null;
  source_verified: number;
  quality_warnings_json: string | null;
  created_at: string;
}

interface ReviewRow {
  id: string;
  question_id: string;
  revision: number;
  decision: string;
  reviewer_email: string;
  reviewer_role: string;
  question_fingerprint: string;
  created_at: string;
}

type EvidenceState =
  | "approved-at-current-revision"
  | "auto-validated-at-current-revision"
  | "held-for-teacher-confirmation"
  | "stale-approval-only"
  | "no-current-evidence";

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function parseArray(raw: string | null): string[] {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((value) => typeof value === "string") : [];
  } catch {
    return [];
  }
}

export interface GovernanceRow {
  id: string;
  origin: string;
  status: string;
  revision: number;
  state: EvidenceState;
  teacherConfirmationRequired: boolean;
  /** 第一項品質警告（只用於顯示暫緩原因，不含題目內容） */
  primaryReason: string;
  approvedReviewAtCurrentRevision: string | null;
  staleApprovedRevisions: number[];
  autoValidatedRevision: number | null;
  hasSourceBlocks: boolean;
  hasSourceExcerpt: boolean;
  sourceVerified: boolean;
  createdAt: string;
}

function classify(
  question: QuestionRow,
  approvedAtCurrent: ReviewRow | undefined,
  staleApprovedRevisions: number[],
  autoCurrent: boolean,
): EvidenceState {
  if (Number(question.teacher_confirmation_required) === 1) return "held-for-teacher-confirmation";
  if (approvedAtCurrent !== undefined) return "approved-at-current-revision";
  if (autoCurrent) return "auto-validated-at-current-revision";
  if (staleApprovedRevisions.length > 0) return "stale-approval-only";
  return "no-current-evidence";
}

export function buildGovernanceRows(
  questions: readonly QuestionRow[],
  reviews: readonly ReviewRow[],
): GovernanceRow[] {
  const approvedByQuestion = new Map<string, ReviewRow[]>();
  for (const review of reviews) {
    if (review.decision !== "approved") continue;
    const list = approvedByQuestion.get(review.question_id) ?? [];
    list.push(review);
    approvedByQuestion.set(review.question_id, list);
  }

  return questions.map((question) => {
    const approved = approvedByQuestion.get(question.id) ?? [];
    const approvedAtCurrent = approved.find((review) => review.revision === question.revision);
    const staleApprovedRevisions = [
      ...new Set(
        approved
          .filter((review) => review.revision !== question.revision)
          .map((review) => review.revision),
      ),
    ].sort((a, b) => a - b);
    const autoCurrent = question.auto_validated_revision === question.revision;
    const sourceBlocks = parseArray(question.source_block_ids_json);
    const warnings = parseArray(question.quality_warnings_json);
    return {
      id: question.id,
      origin: question.origin,
      status: question.status,
      revision: question.revision,
      state: classify(question, approvedAtCurrent, staleApprovedRevisions, autoCurrent),
      teacherConfirmationRequired: Number(question.teacher_confirmation_required) === 1,
      primaryReason: warnings[0] ?? "（沒有品質警告記錄）",
      approvedReviewAtCurrentRevision: approvedAtCurrent
        ? `${approvedAtCurrent.created_at} ${approvedAtCurrent.reviewer_email}`
        : null,
      staleApprovedRevisions,
      autoValidatedRevision: question.auto_validated_revision,
      hasSourceBlocks: sourceBlocks.length > 0,
      hasSourceExcerpt: (question.source_excerpt ?? "").trim().length > 0,
      sourceVerified: Number(question.source_verified) === 1,
      createdAt: question.created_at,
    };
  });
}

function percent(value: number, total: number): string {
  if (total === 0) return "—";
  return `${((value / total) * 100).toFixed(1)}%`;
}

function main(): void {
  const argv = process.argv.slice(2);
  const repo = process.cwd();
  const databasePath = path.resolve(
    readArg(argv, "--database") ?? path.join(repo, "data", "app.db"),
  );
  const outDir = readArg(argv, "--out");
  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  const db = new DatabaseSync(databasePath, { readOnly: true });
  let questions: QuestionRow[];
  let reviews: ReviewRow[];
  let schemaState: { id: string; applied_at: string }[];
  try {
    questions = db
      .prepare(
        `SELECT id, topic_id, section_id, question_type, origin, status, revision,
                auto_validated_at, auto_validated_revision, teacher_confirmation_required,
                source_block_ids_json, source_excerpt, source_verified, quality_warnings_json,
                created_at
           FROM questions`,
      )
      .all() as unknown as QuestionRow[];
    reviews = db
      .prepare(
        `SELECT id, question_id, revision, decision, reviewer_email, reviewer_role,
                question_fingerprint, created_at
           FROM question_reviews ORDER BY created_at ASC, rowid ASC`,
      )
      .all() as unknown as ReviewRow[];
    schemaState = db
      .prepare("SELECT id, applied_at FROM schema_migrations ORDER BY id")
      .all() as unknown as { id: string; applied_at: string }[];
  } finally {
    db.close();
  }

  const rows = buildGovernanceRows(questions, reviews);
  const published = rows.filter((row) => row.status === "published");
  const held = rows.filter((row) => row.teacherConfirmationRequired);

  const byState = (list: readonly GovernanceRow[]) => {
    const counts = new Map<string, number>();
    for (const row of list) counts.set(row.state, (counts.get(row.state) ?? 0) + 1);
    return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1]));
  };

  const gaps = published.filter(
    (row) =>
      row.state === "no-current-evidence" || row.state === "stale-approval-only",
  );
  const gapsByOrigin = new Map<string, number>();
  for (const row of gaps) gapsByOrigin.set(row.origin, (gapsByOrigin.get(row.origin) ?? 0) + 1);

  const summary = {
    database: databasePath,
    schemaMigrations: schemaState.map((row) => row.id),
    totals: {
      questions: rows.length,
      published: published.length,
      drafts: rows.filter((row) => row.status === "draft").length,
      disabled: rows.filter((row) => row.status === "disabled").length,
      teacherConfirmationRequired: held.length,
      reviews: reviews.length,
      approvedReviews: reviews.filter((review) => review.decision === "approved").length,
    },
    publishedEvidence: byState(published),
    evidenceGaps: {
      total: gaps.length,
      byOrigin: Object.fromEntries([...gapsByOrigin.entries()].sort((a, b) => b[1] - a[1])),
      byOriginAndState: Object.fromEntries(
        [...new Set(gaps.map((row) => row.origin))]
          .sort()
          .map((origin) => [
            origin,
            byState(gaps.filter((row) => row.origin === origin)),
          ]),
      ),
    },
    provenanceFlags: {
      publishedWithoutSourceBlocks: published.filter((row) => !row.hasSourceBlocks).length,
      publishedWithoutSourceExcerpt: published.filter((row) => !row.hasSourceExcerpt).length,
      publishedSourceNotVerified: published.filter((row) => !row.sourceVerified).length,
    },
  };

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ summary, rows: argv.includes("--all") ? rows : undefined }, null, 2));
  } else {
    console.log(`資料庫：${databasePath}（唯讀）`);
    console.log(`已套用 migration：${schemaState.map((row) => row.id).slice(-2).join("、")}`);
    console.log("");
    console.log("題目總覽：");
    console.log(
      `  全部 ${summary.totals.questions}；已發布 ${summary.totals.published}；草稿 ${summary.totals.drafts}；` +
        `停用 ${summary.totals.disabled}；待教師確認 ${summary.totals.teacherConfirmationRequired}`,
    );
    console.log(
      `  覆核紀錄 ${summary.totals.reviews} 列（approved ${summary.totals.approvedReviews} 列）`,
    );
    console.log("");
    console.log("已發布題目的現行版本證據：");
    for (const [state, count] of Object.entries(summary.publishedEvidence)) {
      console.log(`  ${state.padEnd(34)}${String(count).padStart(6)}  ${percent(count as number, published.length)}`);
    }
    console.log("");
    console.log(
      `證據缺口（無現行版本證據或有舊 revision 批准）：${summary.evidenceGaps.total} 題（分母 ${published.length}）`,
    );
    for (const [origin, count] of Object.entries(summary.evidenceGaps.byOrigin)) {
      console.log(`  ${origin.padEnd(16)}${String(count).padStart(6)}  ${percent(count as number, published.length)}`);
      const detail = summary.evidenceGaps.byOriginAndState[origin] ?? {};
      console.log(`    └ ${JSON.stringify(detail)}`);
    }
    console.log("");
    console.log("來源追溯指標（已發布題目）：");
    console.log(`  沒有教材段落 ID：${summary.provenanceFlags.publishedWithoutSourceBlocks}`);
    console.log(`  沒有來源節錄：${summary.provenanceFlags.publishedWithoutSourceExcerpt}`);
    console.log(`  未經來源核對（source_verified=0）：${summary.provenanceFlags.publishedSourceNotVerified}`);
    console.log("");
    console.log("注意：本工具只指出**證據缺口**，不代表內容錯誤、侵權或已獲批准。");
    console.log("      「有 approved 覆核」亦不代表史實正確或版權已清。");
  }

  if (outDir !== null) {
    const directory = path.resolve(outDir);
    fs.mkdirSync(directory, { recursive: true });

    const lines: string[] = [];
    lines.push("# 內容治理證據缺口清單（Sprint 26 稽核輸出）");
    lines.push("");
    lines.push(`產生時間：${new Date().toISOString()}`);
    lines.push(`資料來源：本機唯讀快照（${path.basename(databasePath)}），**不代表正式環境現況**。`);
    lines.push("");
    lines.push("## 使用方式");
    lines.push("");
    lines.push("此清單列出「已發布但沒有現行 revision 證據」的題目，供歷史科教師逐項處理。");
    lines.push("每題需要其中一項：");
    lines.push("");
    lines.push("1. 教師在本網站「教師審核」對**目前版本**作出覆核決定（會寫入 `question_reviews`）；或");
    lines.push("2. 教師先修正題目（會遞增 revision），再重新驗證或覆核。");
    lines.push("");
    lines.push("**請勿**以批次腳本代替逐題覆核：本清單不提供、亦不建議任何自動批准的捷徑。");
    lines.push("");
    lines.push("## 統計");
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(summary, null, 2));
    lines.push("```");
    lines.push("");
    lines.push("## 待處理題目");
    lines.push("");
    lines.push("| 題目 ID | 來源 | 目前版本 | 狀態 | 舊版批准 | 自動驗證版本 | 有教材段落 | 有來源節錄 |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const row of gaps) {
      lines.push(
        `| \`${row.id}\` | ${row.origin} | ${row.revision} | ${row.state} | ${
          row.staleApprovedRevisions.length > 0 ? row.staleApprovedRevisions.join("、") : "—"
        } | ${row.autoValidatedRevision ?? "—"} | ${row.hasSourceBlocks ? "是" : "否"} | ${
          row.hasSourceExcerpt ? "是" : "否"
        } |`,
      );
    }
    lines.push("");
    lines.push("## 待教師確認題目");
    lines.push("");
    lines.push("這些題目因品質閘門有**未確定**項目而暫緩自動發布（`teacher_confirmation_required = 1`），");
    lines.push("只有教師的人工覆核可以清除標記。`原因` 欄只列出第一項判定的開頭，完整內容請在題目管理介面查看。");
    lines.push("");
    lines.push("| 題目 ID | 來源 | 目前版本 | 狀態 | 原因（節錄） |");
    lines.push("| --- | --- | --- | --- | --- |");
    for (const row of held) {
      const reason = row.primaryReason.replace(/\|/g, "／").slice(0, 60);
      lines.push(`| \`${row.id}\` | ${row.origin} | ${row.revision} | ${row.status} | ${reason} |`);
    }
    lines.push("");
    fs.writeFileSync(path.join(directory, "governance-evidence-gaps.md"), lines.join("\n"), "utf8");
    fs.writeFileSync(
      path.join(directory, "governance-evidence-gaps.json"),
      JSON.stringify({ generatedAt: new Date().toISOString(), summary, gaps, held }, null, 2),
      "utf8",
    );
    console.log(`\n已寫出清單：${path.join(directory, "governance-evidence-gaps.md")}`);
  }
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]).includes("audit-governance-evidence")) {
  main();
}
