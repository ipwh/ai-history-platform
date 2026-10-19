/**
 * 教師裁決套件（唯讀、可重複執行）。
 *
 * 目的：把 `repair-provenance` 報告中「自動修復改變了被考核答案」的題目，整理成
 * 一份**可供教師逐題裁決**的檔案，同時如實記錄可得的版本來源與證據限制。
 *
 * 重要界線：
 *   - 這個腳本**不會**寫入資料庫、不會修改題目、不會建立覆核紀錄。
 *   - 輸出的 `decision` 欄位一律為 `unset`，是給教師填寫的**欄位模板**，不是決定。
 *   - 不會自行提出歷史解釋或代替教師選定答案；只有在能確定推出的情況下才會給出
 *     `proposedCorrection`，其餘一律 `null` 並說明原因。
 *   - 「擁有者確認上載前已核對史實」屬於批次授權紀錄，與本套件的逐題裁決是兩件事。
 *
 * 用法：
 *   npx tsx scripts/build-teacher-adjudication.ts
 *   npx tsx scripts/build-teacher-adjudication.ts --database "C:\\temp\\snapshot.db"
 *   npx tsx scripts/build-teacher-adjudication.ts --report docs/teacher-review/repair-provenance-2026-10-19.json
 *
 * 輸出（預設）：
 *   docs/teacher-review/repair-adjudication-2026-10-19.json
 *   docs/teacher-review/repair-adjudication-2026-10-19.md
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

type AffectedItem = {
  id: string;
  topicId: string;
  questionType: string;
  revision: number;
  status: string;
  teacherConfirmationRequired: boolean;
  originalStem: string;
  currentStem: string;
  blankCountOriginal: number;
  blankCountCurrent: number;
  assessedBlankIndexOriginal: number | null;
  assessedBlankIndexCurrent: number | null;
  originalCorrectAnswer: string;
  currentCorrectAnswer: string;
  originalOptions: string[];
  currentOptions: string[];
  currentExplanation: string | null;
  classifications: string[];
  notes: string[];
};

type ProvenanceReport = {
  generatedAt: string;
  method: string;
  limitations: string[];
  counts: Record<string, number>;
  affected: AffectedItem[];
};

type QuestionRow = {
  id: string;
  topic_id: string;
  section_id: string | null;
  question_type: string;
  difficulty: string | null;
  skill: string | null;
  question: string;
  options_json: string | null;
  correct_answer: string;
  accepted_answers_json: string | null;
  explanation: string | null;
  knowledge_point: string | null;
  source_excerpt: string | null;
  source_location: string | null;
  grading_points_json: string | null;
  origin: string;
  status: string;
  created_at: string;
  quality_warnings_json: string | null;
  revision: number;
  teacher_confirmation_required: number;
};

type ReviewRow = {
  revision: number;
  decision: string;
  reason: string | null;
  reviewer_email: string;
  reviewer_role: string;
  question_fingerprint: string;
  created_at: string;
};

type TopicRow = { id: string; title: string; level: string | null; topic_number: number | null };
type SectionRow = { id: string; title: string };

/** 找出題幹中的空格位置（全形底線 U+FF3F 及半形底線），按出現次序編號。 */
function extractBlanks(stem: string): { index: number; offset: number; length: number }[] {
  const matches = [...stem.matchAll(/[＿_]{2,}/g)];
  return matches.map((match, index) => ({
    index: index + 1,
    offset: match.index ?? 0,
    length: match[0].length,
  }));
}

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function escapeCell(value: string | null | undefined): string {
  return (value ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

async function main() {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const reportPath = path.resolve(
    readArg(argv, "--report") ??
      path.join(repo, "docs", "teacher-review", "repair-provenance-2026-10-19.json"),
  );
  const databasePath = path.resolve(
    readArg(argv, "--database") ?? path.join(repo, "data", "app.db"),
  );
  const outJson = path.resolve(
    readArg(argv, "--out-json") ??
      path.join(repo, "docs", "teacher-review", "repair-adjudication-2026-10-19.json"),
  );
  const outMd = path.resolve(
    readArg(argv, "--out-md") ??
      path.join(repo, "docs", "teacher-review", "repair-adjudication-2026-10-19.md"),
  );

  if (!fs.existsSync(reportPath)) {
    throw new Error(`找不到修復來源報告：${reportPath}`);
  }
  if (!fs.existsSync(databasePath)) {
    throw new Error(`找不到資料庫：${databasePath}`);
  }

  const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as ProvenanceReport;
  const db = new DatabaseSync(databasePath, { readOnly: true });

  const questionStatement = db.prepare("SELECT * FROM questions WHERE id = ?");
  const reviewStatement = db.prepare(
    "SELECT revision, decision, reason, reviewer_email, reviewer_role, question_fingerprint, created_at FROM question_reviews WHERE question_id = ? ORDER BY created_at DESC, id DESC",
  );
  const topicStatement = db.prepare("SELECT id, title, level, topic_number FROM topics WHERE id = ?");
  const sectionStatement = db.prepare("SELECT id, title FROM sections WHERE id = ?");
  const { blankAnswersFromExplanation } = await import("../src/server/materials/question-bank");

  const items = report.affected.map((item) => {
    const row = questionStatement.get(item.id) as QuestionRow | undefined;
    const reviews = (reviewStatement.all(item.id) as ReviewRow[]) ?? [];
    const topic = row
      ? (topicStatement.get(row.topic_id) as TopicRow | undefined)
      : (topicStatement.get(item.topicId) as TopicRow | undefined);
    const section =
      row?.section_id ? (sectionStatement.get(row.section_id) as SectionRow | undefined) : undefined;

    const missingFromBank = !row;
    const currentAnswer = row?.correct_answer ?? item.currentCorrectAnswer;
    const currentOptions = parseJsonArray(row?.options_json ?? JSON.stringify(item.currentOptions));
    const acceptedAnswers = parseJsonArray(row?.accepted_answers_json ?? null);
    const qualityWarnings = parseJsonArray(row?.quality_warnings_json ?? null);
    const currentStem = row?.question ?? item.currentStem;
    const currentBlanks = extractBlanks(currentStem);
    const currentBlankAnswers = blankAnswersFromExplanation(row?.explanation ?? "");

    return {
      questionId: item.id,
      topic: {
        id: row?.topic_id ?? item.topicId,
        title: topic?.title ?? null,
        level: topic?.level ?? null,
        sectionId: row?.section_id ?? null,
        sectionTitle: section?.title ?? null,
      },
      questionType: row?.question_type ?? item.questionType,
      difficulty: row?.difficulty ?? null,
      skill: row?.skill ?? null,
      knowledgePoint: row?.knowledge_point ?? null,
      current: {
        presentInBank: !missingFromBank,
        status: row?.status ?? item.status,
        revision: row?.revision ?? item.revision,
        teacherConfirmationRequired:
          row !== undefined
            ? row.teacher_confirmation_required !== 0
            : item.teacherConfirmationRequired,
        stem: currentStem,
        blanks: currentBlanks,
        // 現行解釋若以「(1) …(2) …」列出答案，可還原每個空格對應的答案及次序。
        blankAnswers: currentBlankAnswers,
        blankAnswersNote:
          currentBlankAnswers.length > 0 && currentBlankAnswers.length !== currentBlanks.length
            ? "解釋列出的答案數目與題幹空格數目不一致，需人工核對。"
            : null,
        correctAnswer: currentAnswer,
        acceptedAnswers,
        options: currentOptions,
        explanation: row?.explanation ?? item.currentExplanation,
        gradingPoints: parseJsonArray(row?.grading_points_json ?? null),
        sourceExcerpt: row?.source_excerpt ?? null,
        sourceLocation: row?.source_location ?? null,
        qualityWarnings,
        origin: row?.origin ?? null,
        createdAt: row?.created_at ?? null,
      },
      original: {
        // 原始題目沒有獨立版本紀錄，只能由 materials/ 內的來源檔重建（見 method）。
        reconstructedFrom: "materials/（以 parseQuestionBank 重建，未經多空格正規化）",
        stem: item.originalStem,
        blanks: extractBlanks(item.originalStem),
        // 原始解釋未留存；只知道匯入時的第 1 個空格答案（`correctAnswer = answers[0]`）。
        blankAnswers: Array.from({ length: item.blankCountOriginal }, (_unused, index) =>
          index === 0 ? item.originalCorrectAnswer : null,
        ),
        correctAnswer: item.originalCorrectAnswer,
        options: item.originalOptions,
        blankCount: item.blankCountOriginal,
        assessedBlankIndex: item.assessedBlankIndexOriginal,
        currentBlankCount: item.blankCountCurrent,
        currentAssessedBlankIndex: item.assessedBlankIndexCurrent,
        explanation: null,
      },
      flag: {
        reason: item.notes,
        classifications: item.classifications,
        detectedAt: report.generatedAt,
        report: path.relative(repo, reportPath).replace(/\\/g, "/"),
      },
      proposedCorrection: null,
      proposedCorrectionBasis:
        "NOT_DETERMINISTIC：保留原本被考核的空格會令答案在題幹其他地方出現（洩題），改考另一個空格則改變了考核重點；兩者都需要教師按教學意圖決定，不能由程式代為選擇。",
      provenance: {
        method: report.method,
        reviews: reviews.map((review) => ({
          revision: review.revision,
          decision: review.decision,
          reviewerEmail: review.reviewer_email,
          reviewerRole: review.reviewer_role,
          reason: review.reason,
          fingerprint: review.question_fingerprint,
          createdAt: review.created_at,
          sameRevisionAsCurrent: row !== undefined ? review.revision === row.revision : null,
          // 歷史紀錄問題：早期自動修復以 admin 身分寫入覆核（理由含「自動修復」），
          // reviewer_role 因此不能單獨用來判斷是否人工覆核。此處只如實標示，不改寫紀錄。
          looksAutomated:
            review.reviewer_role === "automation" ||
            /自動修復|平台自動檢查/.test(review.reason ?? ""),
        })),
        automatedRepairApplied: reviews.some(
          (review) =>
            review.reviewer_role === "automation" ||
            /自動修復|平台自動檢查/.test(review.reason ?? ""),
        ),
        // 早期自動修復以 admin 身分寫入覆核紀錄：可從理由辨識，但不能改寫歷史。
        automationRecordedAsHuman: reviews.some(
          (review) =>
            review.reviewer_role !== "automation" && /自動修復/.test(review.reason ?? ""),
        ),
        ownerBatchAuthorisationReference:
          "docs/teacher-review/owner-publication-overrides.json（2026-10-15 批次授權；非逐題裁決）",
      },
      decision: {
        state: "unset",
        reviewedRevision: null,
        reviewedFingerprint: null,
        allowed: ["approved", "rejected", "returned"],
        approvedBy: null,
        decidedAt: null,
        note: null,
      },
      recordPath:
        "教師於「題目管理」(/teacher/questions) 逐題覆核；系統以登入身分及伺服器時間寫入 question_reviews（綁定 revision 及內容指紋），核准後才會解除「待教師確認」並發布。",
      evidenceLimitations: [
        "資料庫沒有保存題目的歷史版本內容；「原始」版本是由 materials/ 來源檔重建，並非當時寫入資料庫的副本。",
        "原始題目的解釋、知識點及難度沒有獨立留存，只能顯示現行版本。",
        "自動修復紀錄（reviewer_role=automation）不是教師覆核；它只表示程式在某一版本做過格式化或安全修復。",
        "擁有者於 2026-10-15 的批次授權涵蓋 143 題，屬科組整體審閱聲明，不能當作這 18 題的逐題裁決。",
      ],
    };
  });

  const payload = {
    generatedAt: new Date().toISOString(),
    status: "AWAITING_TEACHER_ADJUDICATION",
    notice:
      "本檔案是裁決表單與證據摘要，不是覆核紀錄。所有 decision 欄位均為 unset，須由教師在平台上逐題決定。",
    sourceReport: {
      path: path.relative(repo, reportPath).replace(/\\/g, "/"),
      generatedAt: report.generatedAt,
      method: report.method,
      limitations: report.limitations,
      counts: report.counts,
    },
    totals: {
      questions: items.length,
      presentInBank: items.filter((item) => item.current.presentInBank).length,
      missingFromBank: items.filter((item) => !item.current.presentInBank).length,
      currentlyQuarantined: items.filter((item) => item.current.teacherConfirmationRequired).length,
      withAutomationReviewRecord: items.filter((item) => item.provenance.automatedRepairApplied)
        .length,
      automationRecordedAsHuman: items.filter(
        (item) => item.provenance.automationRecordedAsHuman,
      ).length,
    },
    items,
  };

  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  const lines: string[] = [];
  lines.push("# 教師裁決套件：自動修復改變答案對應的 18 題");
  lines.push("");
  lines.push(
    "> **這不是覆核紀錄。** 本文件只整理證據、版本差異及需要教師決定的欄位；`decision` 一律未設定。",
  );
  lines.push(
    "> 在教師逐題決定之前，這些題目必須保持隔離（`teacherConfirmationRequired = true`），不得派給學生。",
  );
  lines.push("");
  lines.push(`- 產生時間：${payload.generatedAt}`);
  lines.push(
    `- 來源報告：[${payload.sourceReport.path}](./${path.basename(payload.sourceReport.path)})（產生於 ${report.generatedAt}）`,
  );
  lines.push(`- 題目數：${payload.totals.questions}`);
  lines.push(`- 仍在題庫：${payload.totals.presentInBank}；已不在題庫：${payload.totals.missingFromBank}`);
  lines.push(`- 目前已隔離：${payload.totals.currentlyQuarantined}`);
  lines.push(`- 帶有自動修復紀錄：${payload.totals.withAutomationReviewRecord}`);
  lines.push(
    `- 其中以非 automation 角色寫入（理由顯示為自動修復）：${payload.totals.automationRecordedAsHuman}`,
  );
  lines.push("");
  lines.push("## 如何記錄裁決");
  lines.push("");
  lines.push(
    "在平台的「題目管理」(/teacher/questions) 逐題覆核並選擇「核准」「退回」或「拒絕」。系統會以登入教師的身分及伺服器時間寫入覆核紀錄，並綁定當時的題目版本（revision + 內容指紋）。",
  );
  lines.push("");
  lines.push("| 裁決 | 系統對應 | 效果 |");
  lines.push("| --- | --- | --- |");
  lines.push("| 核准（approved） | 教師確認這一版內容及答案正確 | 解除「待教師確認」，題目可發布 |");
  lines.push("| 退回（returned） | 需要修正（needs correction） | 題目留在草稿，維持隔離 |");
  lines.push("| 拒絕（rejected） | 內容不可用 | 題目不可發布 |");
  lines.push("| 未裁決（unresolved） | 不寫入任何紀錄 | 維持隔離 |");
  lines.push("");
  lines.push(
    "核准只對**當時覆核的版本**有效。題目內容一旦再修改，版本會遞增，舊核准即失效，必須重新覆核。",
  );
  lines.push("");
  lines.push("## 快速總覽");
  lines.push("");
  lines.push("| # | 題目 ID | 課題／分節 | 原本考核 | 現時考核 | 狀態 |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  items.forEach((item, index) => {
    const place = `${item.topic.id}${item.topic.sectionTitle ? ` / ${item.topic.sectionTitle}` : ""}`;
    const before = `${item.original.correctAnswer}（第 ${item.original.assessedBlankIndex ?? "?"} 空格）`;
    const after = `${item.current.correctAnswer}（第 ${item.original.currentAssessedBlankIndex ?? "?"} 空格）`;
    lines.push(
      `| ${index + 1} | ${item.questionId} | ${escapeCell(place)} | ${escapeCell(before)} | ${escapeCell(after)} | ${item.current.status} / rev ${item.current.revision}${item.current.teacherConfirmationRequired ? " / 已隔離" : ""} |`,
    );
  });
  lines.push("");

  items.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${item.questionId}`);
    lines.push("");
    lines.push(
      `- 課題：${item.topic.title ?? item.topic.id}（${item.topic.id}${item.topic.level ? `，${item.topic.level}` : ""}）`,
    );
    lines.push(
      `- 分節：${item.topic.sectionTitle ?? "（未知）"}${item.topic.sectionId ? `（${item.topic.sectionId}）` : ""}`,
    );
    lines.push(
      `- 題型／難度／技能：${item.questionType} / ${item.difficulty ?? "（未設定）"} / ${item.skill ?? "（未設定）"}`,
    );
    lines.push(`- 知識點：${item.knowledgePoint ?? "（未設定）"}`);
    lines.push(
      `- 現況：${item.current.status}，第 ${item.current.revision} 版，${item.current.teacherConfirmationRequired ? "**已隔離（待教師確認）**" : "未隔離"}`,
    );
    lines.push(`- 標記原因：${item.flag.reason.join("；")}`);
    lines.push("");
    lines.push("| 項目 | 匯入時（重建） | 現時 |");
    lines.push("| --- | --- | --- |");
    lines.push(`| 題幹 | ${escapeCell(item.original.stem)} | ${escapeCell(item.current.stem)} |`);
    lines.push(
      `| 空格位置（次序：字元位置） | ${escapeCell(item.original.blanks.map((blank) => `第 ${blank.index} 個：${blank.offset}`).join("、") || "（無）")} | ${escapeCell(item.current.blanks.map((blank) => `第 ${blank.index} 個：${blank.offset}`).join("、") || "（無）")} |`,
    );
    lines.push(
      `| 各空格答案（依次序） | ${escapeCell(item.original.blankAnswers.map((answer, blankIndex) => `(${blankIndex + 1}) ${answer ?? "未留存"}`).join("、") || "（無）")} | ${escapeCell(item.current.blankAnswers.map((answer, blankIndex) => `(${blankIndex + 1}) ${answer}`).join("、") || "（無）")} |`,
    );
    lines.push(
      `| 空格數 | ${item.original.blankCount} | ${item.original.currentBlankCount} |`,
    );
    lines.push(
      `| 被考核的空格 | 第 ${item.original.assessedBlankIndex ?? "?"} 個 | 第 ${item.original.currentAssessedBlankIndex ?? "?"} 個 |`,
    );
    lines.push(
      `| 正確答案 | ${escapeCell(item.original.correctAnswer)} | ${escapeCell(item.current.correctAnswer)} |`,
    );
    lines.push(
      `| 可接受答案 | （未留存） | ${escapeCell(item.current.acceptedAnswers.join("、") || "（無）")} |`,
    );
    lines.push(
      `| 選項 | ${escapeCell(item.original.options.join(" / ") || "（填充題，無選項）")} | ${escapeCell(item.current.options.join(" / ") || "（填充題，無選項）")} |`,
    );
    lines.push(`| 解釋 | （未留存） | ${escapeCell(item.current.explanation ?? "（無）")} |`);
    lines.push("");
    if (item.current.qualityWarnings.length > 0) {
      lines.push("品質警告：");
      lines.push("");
      for (const warning of item.current.qualityWarnings) lines.push(`- ${warning}`);
      lines.push("");
    }
    if (item.current.blankAnswersNote) {
      lines.push(`> 注意：${item.current.blankAnswersNote}`);
      lines.push("");
    }
    lines.push(`### 建議修正`);
    lines.push("");
    lines.push(`無法由程式確定：${item.proposedCorrectionBasis}`);
    lines.push("");
    lines.push("### 版本與紀錄來源");
    lines.push("");
    if (item.provenance.reviews.length === 0) {
      lines.push("- 沒有覆核紀錄。");
    } else {
      for (const review of item.provenance.reviews) {
        const annotation =
          review.looksAutomated && review.reviewerRole !== "automation"
            ? "（理由顯示為自動修復，但紀錄角色不是 automation；不可視為教師覆核）"
            : "";
        lines.push(
          `- ${review.createdAt}：${review.decision}（第 ${review.revision} 版，${review.reviewerRole}，${review.reviewerEmail}）${review.reason ? ` — ${review.reason}` : ""}${annotation}`,
        );
      }
    }
    lines.push(
      `- 自動修復紀錄：${item.provenance.automatedRepairApplied ? "有（僅代表程式動作，不是教師覆核）" : "沒有"}`,
    );
    lines.push("");
    lines.push("### 教師裁決（未填寫）");
    lines.push("");
    lines.push("- [ ] 核准（approved）— 這一版內容及答案正確，可解除隔離");
    lines.push("- [ ] 退回（returned）— 需要修正，題目保持隔離");
    lines.push("- [ ] 拒絕（rejected）— 內容不可用");
    lines.push("- [ ] 未能裁決（unresolved）— 維持隔離，稍後再議");
    lines.push("");
    lines.push("裁決備註：______________________　裁決教師：__________　時間（由系統填寫）：__________");
    lines.push("");
    lines.push("### 證據限制");
    lines.push("");
    for (const limitation of item.evidenceLimitations) lines.push(`- ${limitation}`);
    lines.push("");
  });

  lines.push("## 全域證據限制");
  lines.push("");
  lines.push(
    "- 早期自動修復紀錄以 `admin` 身分寫入（理由含「自動修復」），`reviewer_role` 不能單獨證明是否人工覆核；本套件已在紀錄旁標示，但不改寫歷史。",
  );
  if (payload.totals.currentlyQuarantined < payload.totals.questions) {
    lines.push(
      `- **現時資料庫仍有 ${payload.totals.questions - payload.totals.currentlyQuarantined} 題未隔離**：在套用隔離前，這些題目仍可能經既有路徑派給學生。`,
    );
  }
  for (const limitation of report.limitations) lines.push(`- ${limitation}`);
  lines.push("");

  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.writeFileSync(outMd, `${lines.join("\n")}\n`, "utf8");

  console.log(`已讀取修復報告：${path.relative(repo, reportPath)}`);
  console.log(`已讀取資料庫（唯讀）：${path.relative(repo, databasePath)}`);
  console.log(`題目數：${payload.totals.questions}`);
  console.log(`已寫入：${path.relative(repo, outJson)}`);
  console.log(`已寫入：${path.relative(repo, outMd)}`);
  console.log("提醒：本腳本沒有修改資料庫，也沒有建立任何覆核紀錄。");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
