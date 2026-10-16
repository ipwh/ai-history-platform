/**
 * 受控試點：DeepSeek 歷史題目品質評估（一次性實驗，需擁有者明確授權）
 *
 * ⚠️ 這支腳本會呼叫**真實 DeepSeek API 並產生費用**。為避免誤觸：
 *   1. 必須明確設定 PILOT_CONFIRM=yes 才會執行；
 *   2. 只在專用臨時資料庫執行，不會接觸 data/app.db 或正式環境；
 *   3. 固定 3 課題 × 3 題型 × 3 難度 = 27 格（每格 1 次 provider 請求）
 *      + 1 次學生旅程請求，逐格序列執行，不重試額外請求。
 *
 * 用法（PowerShell）：
 *   $env:PILOT_CONFIRM="yes"; npx tsx scripts/pilot-deepseek.ts
 *
 * 產出：完整結果寫入 %TEMP%/hist-pilot-report-*.json（本機檔案，非公開、
 * 不會進入學生端回應）；不使用、也不輸出任何 API key 或個人資料。
 */
import { loadEnvConfig } from "@next/env";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

if (process.env.PILOT_CONFIRM !== "yes") {
  console.error("[pilot] refused: this harness makes paid API calls. Set PILOT_CONFIRM=yes to proceed.");
  process.exit(1);
}

loadEnvConfig(process.cwd());

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const workDir = mkdtempSync(path.join(tmpdir(), "hist-pilot-"));
const dbPath = path.join(workDir, "pilot.db");
process.env.APP_DATABASE_PATH = dbPath;
process.env.LLM_PROVIDER = "deepseek";
process.env.LLM_ALLOW_MOCK_FALLBACK = "false";

const TOPIC_IDS = ["topic-2", "topic-5", "topic-9"] as const;
const TYPES = ["mc", "fill", "short"] as const;
const DIFFICULTIES = ["basic", "advanced", "challenge"] as const;
/** 成本控制：PILOT_LIMIT 可只跑前 N 格（煙霧測試用）；PILOT_JOURNEY=no 可略過學生旅程。 */
const CELL_LIMIT = Number.parseInt(process.env.PILOT_LIMIT ?? "", 10) > 0 ? Number.parseInt(process.env.PILOT_LIMIT as string, 10) : 27;
const RUN_JOURNEY = process.env.PILOT_JOURNEY !== "no";

/**
 * 第 2 輪（對抗式）指定格：第 1 輪被閘門拒絕的 9 格，用來量度修正後的實際行為。
 * 只重測有實際失敗證據的組合，不重跑整個矩陣（見 Sprint 7.9 §4）。
 */
const ROUND2_CELLS = [
  { topicId: "topic-2", questionType: "mc", difficulty: "advanced" },
  { topicId: "topic-2", questionType: "mc", difficulty: "challenge" },
  { topicId: "topic-2", questionType: "fill", difficulty: "basic" },
  { topicId: "topic-2", questionType: "fill", difficulty: "challenge" },
  { topicId: "topic-5", questionType: "mc", difficulty: "advanced" },
  { topicId: "topic-5", questionType: "mc", difficulty: "challenge" },
  { topicId: "topic-9", questionType: "mc", difficulty: "advanced" },
  { topicId: "topic-9", questionType: "mc", difficulty: "challenge" },
  { topicId: "topic-9", questionType: "fill", difficulty: "basic" },
];

interface QuestionRecord {
  id: string;
  questionType: string;
  difficulty: string;
  question: string;
  options: string[];
  correctAnswer: string;
  acceptedAnswers: string[];
  explanation: string;
  knowledgePoint: string;
  gradingPoints: string[];
  qualityWarnings: string[];
  sourceExcerpt: string;
  sourceLocation: string;
  sourceBlockIds: string[];
  status: string;
  autoValidatedAt: string | null;
  teacherConfirmationRequired: boolean;
  revision: number;
  sourceBlocks: { id: string; text: string; sourceLocation: string; sectionId: string | null }[];
}

interface CellRecord {
  id: string;
  topicId: string;
  sectionId: string | null;
  sectionTitle: string | null;
  questionType: string;
  difficulty: string;
  provider: string | null;
  providerLabel: string | null;
  usedDemoFallback: boolean | null;
  latencyMs: number | null;
  ok: boolean;
  error: string | null;
  returned: number;
  discarded: number;
  discardReasons: string[];
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  questions: QuestionRecord[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function main(): Promise<void> {
  const { getServerConfig, isProductionRuntime } = await import("../src/server/config");
  const config = getServerConfig();

  if (isProductionRuntime()) {
    console.error("[pilot] refused: production runtime detected.");
    process.exit(1);
  }
  if (!dbPath.startsWith(tmpdir())) {
    console.error("[pilot] refused: database path is not a temporary directory.");
    process.exit(1);
  }
  if (config.llm.provider !== "deepseek") {
    console.error(`[pilot] refused: provider is ${config.llm.provider}, expected deepseek.`);
    process.exit(1);
  }
  if (!config.llm.apiKey) {
    console.error("[pilot] refused: no API key configured.");
    process.exit(1);
  }

  console.log(`[pilot] provider=deepseek model=${config.llm.model} thinking=${config.llm.thinking}`);
  console.log(
    `[pilot] maxTokens=${config.llm.maxTokens} timeoutMs=${config.llm.requestTimeoutMs} emptyRetries=${config.llm.emptyContentRetries}`,
  );
  console.log(
    `[pilot] ai limits per-learner generations=${config.aiLimits.generationsPerLearner} gradings=${config.aiLimits.gradingsPerLearner} (global ${config.aiLimits.generationsGlobal}/${config.aiLimits.gradingsGlobal})`,
  );
  console.log(`[pilot] temporary database=${dbPath}`);

  const { ensureBootstrap } = await import("../src/server/seed");
  const materialService = await import("../src/server/services/material-service");
  const materialsRepo = await import("../src/server/repositories/materials");
  const questionsRepo = await import("../src/server/repositories/questions");
  const practiceRepo = await import("../src/server/repositories/practice");
  const topicsRepo = await import("../src/server/repositories/topics");
  const questionService = await import("../src/server/services/question-service");
  const practiceService = await import("../src/server/services/practice-service");
  const reportService = await import("../src/server/services/question-report-service");
  const { collectMaterialFiles } = await import("../src/server/materials/material-files");
  const { isQuestionBankFileName } = await import("../src/server/materials/question-bank");
  const { looksLikeTeacherEdition } = await import("../src/server/materials/teacher-content");
  const typesModule = await import("../src/lib/types");

  ensureBootstrap();

  // ── 教材匯入（只用本機 materials/ 檔案，寫入臨時資料庫） ──────────────
  const entries = collectMaterialFiles(config.materialsDir);
  const importedByTopic = new Map<string, { documents: number; blocks: number }>();
  for (const topicId of TOPIC_IDS) {
    const files = entries.filter(
        (entry) => entry.topicId === topicId && !isQuestionBankFileName(entry.fileName),
      );
      let documents = 0;
      for (const file of files) {
        const imported = await materialService.importMaterialFromDisk(file.relativePath, { runOcr: false });
        if (imported) documents += 1;
      }
    importedByTopic.set(topicId, { documents, blocks: materialsRepo.listGroundingBlocksByTopic(topicId).length });
    console.log(`[pilot] imported ${topicId}: files=${files.length} documents=${documents}`);
  }

  const cellSection = new Map<string, { id: string; title: string; blocks: number }>();
  for (const topicId of TOPIC_IDS) {
    const blocks = materialsRepo.listGroundingBlocksByTopic(topicId);
    const grouped = new Map<string, number>();
    for (const block of blocks) {
      if (!block.sectionId) continue;
      grouped.set(block.sectionId, (grouped.get(block.sectionId) ?? 0) + 1);
    }
    const best = [...grouped.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!best) continue;
    const section = topicsRepo.getSection(best[0]);
    if (!section) continue;
    cellSection.set(topicId, { id: section.id, title: section.title, blocks: best[1] });
    console.log(`[pilot] ${topicId} section=${section.id} blocks=${best[1]}`);
  }

  // ── 3 × 3 × 3 矩陣（第 1 輪）或指定格（第 2 輪對抗式測試）：每格 1 次 provider 請求 ──
  const cells: CellRecord[] = [];
  let caseIndex = 0;
  let providerRequests = 0;

  const round2 = process.env.PILOT_ROUND === "2";
  const cellPlans: { topicId: string; questionType: string; difficulty: string }[] = round2
    ? ROUND2_CELLS.map((cell) => ({ ...cell }))
    : TOPIC_IDS.flatMap((topicId) =>
        TYPES.flatMap((questionType) =>
          DIFFICULTIES.map((difficulty) => ({ topicId, questionType, difficulty })),
        ),
      );
  if (round2) console.log(`[pilot] round 2: ${cellPlans.length} targeted cells`);

  for (const plan of cellPlans) {
    {
      if (cells.length >= CELL_LIMIT) break;
      const topicId = plan.topicId;
      const questionType = plan.questionType as (typeof TYPES)[number];
      const difficulty = plan.difficulty as (typeof DIFFICULTIES)[number];
      const section = cellSection.get(topicId) ?? null;
      {
        caseIndex += 1;
        const id = `PILOT-${String(caseIndex).padStart(2, "0")}`;
        if (!section) {
          cells.push({
            id,
            topicId,
            sectionId: null,
            sectionTitle: null,
            questionType,
            difficulty,
            provider: null,
            providerLabel: null,
            usedDemoFallback: null,
            latencyMs: null,
            ok: false,
            error: "此課題沒有可用教材分節（無有效率片段），未執行",
            returned: 0,
            discarded: 0,
            discardReasons: [],
            usage: null,
            questions: [],
          });
          console.log(`[pilot] ${id} ${topicId} ${questionType} ${difficulty} SKIPPED (no section)`);
          continue;
        }

        const cell: CellRecord = {
          id,
          topicId,
          sectionId: section.id,
          sectionTitle: section.title,
          questionType,
          difficulty,
          provider: null,
          providerLabel: null,
          usedDemoFallback: null,
          latencyMs: null,
          ok: false,
          error: null,
          returned: 0,
          discarded: 0,
          discardReasons: [],
          usage: null,
          questions: [],
        };
        const startedAt = Date.now();
        providerRequests += 1;
        try {
          const generated = await questionService.generateQuestions({
            topicId,
            sectionIds: [section.id],
            questionTypes: [questionType],
            difficulty,
            questionCount: 1,
            persist: true,
            audience: "staff",
            allowMockFallback: false,
            requestType: "question-bank",
          });
          cell.latencyMs = Date.now() - startedAt;
          cell.provider = generated.provider;
          cell.providerLabel = generated.providerLabel;
          cell.usedDemoFallback = generated.usedDemoFallback;
          cell.ok = true;
          cell.returned = generated.questions.length;
          cell.discarded = generated.discardedCount;
          cell.discardReasons = generated.discardReasons.slice(0, 8);
          cell.questions = generated.questions.map((question) => toRecord(question));
        } catch (error) {
          cell.latencyMs = Date.now() - startedAt;
          cell.error = error instanceof Error ? error.message.slice(0, 400) : String(error);
        }
        cell.usage = readLatestUsage();
        cells.push(cell);
        const first = cell.questions[0];
        console.log(
          `[pilot] ${id} ${topicId} ${questionType} ${difficulty} -> ${
            cell.ok ? `ok returned=${cell.returned} discarded=${cell.discarded}` : `FAILED ${cell.error}`
          }`,
        );
        if (first) {
          console.log(`        stem(cut)=${first.question.replace(/\s+/g, " ").slice(0, 60)}`);
          console.log(`        key(cut)=${first.correctAnswer.slice(0, 40)} warnings=${first.qualityWarnings.length}`);
        }
        await delay(1_000);
      }
    }
  }

  // ── 學生旅程（1 次 provider 請求：即時 AI 生成，選擇題避免額外批改費用） ──
  const journeyTopicId = TOPIC_IDS[1];
  const journeySection = cellSection.get(journeyTopicId) ?? null;
  const journey: Record<string, any> = { topicId: journeyTopicId, requests: 0, notes: [] as string[] };
  const notes = journey.notes as string[];

  if (!RUN_JOURNEY) {
    notes.push("student journey skipped (PILOT_JOURNEY=no)");
  } else if (!journeySection) {
    notes.push("no section available; student journey skipped");
  } else {
    for (const block of materialsRepo.listGroundingBlocksByTopic(journeyTopicId)) {
      const document = materialsRepo.getDocument(block.documentId);
      if (!document) continue;
      const at = new Date().toISOString();
      const actor = "pilot-operator@localhost";
      materialsRepo.recordDocumentGovernance({
        documentId: block.documentId,
        rights: { confirmedBy: actor, at },
        ...(looksLikeTeacherEdition(document.fileName) ? { contentSafety: { reviewedBy: actor, at } } : {}),
      });
      materialsRepo.setDocumentStudentDistribution(block.documentId, true);
    }
    notes.push("materials opened for students in the disposable pilot database only");

    const learnerId = "pilot-learner";
    providerRequests += 1;
    journey.requests = 1;
    try {
      const assembled = await practiceService.createPractice({
        learnerId,
        topicId: journeyTopicId,
        sectionIds: [journeySection.id],
        questionTypes: ["mc"],
        difficulty: "basic",
        questionCount: 2,
        mode: "standard",
        questionSource: "ai",
        sourceSessionId: null,
      });
      journey.sessionId = assembled.session.id;
      journey.notice = assembled.notice;
      journey.questionsReturned = assembled.questions.length;
      journey.preAnswerKeys = Object.keys(assembled.questions[0] as unknown as Record<string, unknown>);
      journey.preAnswerLeaks = (journey.preAnswerKeys as string[]).filter((key: string) =>
        ["correctAnswer", "acceptedAnswers", "explanation", "gradingPoints", "sourceExcerpt", "sourceLocation", "sourceBlockIds", "qualityWarnings"].includes(
          key,
        ),
      );
      journey.typeMismatch = assembled.questions.filter((question) => question.questionType !== "mc").length;

      const snapshot = practiceRepo.getSessionQuestions(assembled.session.id);
      journey.snapshotTypes = snapshot.map((question) => question.questionType);
      journey.snapshotDifficulties = snapshot.map((question) => question.difficulty);
      journey.snapshotRevisions = snapshot.map((question) => question.revision);
      journey.snapshotOrigins = snapshot.map((question) => question.origin);
      journey.snapshotStatuses = snapshot.map((question) => question.status);

      const [first, second] = snapshot;
      if (first) {
        const graded = await practiceService.submitAnswer(
          assembled.session.id,
          learnerId,
          first.id,
          first.correctAnswer,
        );
        journey.correctAnswerVerdict = graded.feedback.isCorrect;
        journey.correctAnswerAutoGraded = graded.feedback.autoGraded;
        journey.feedbackHasExplanation = typeof graded.feedback.explanation === "string" && graded.feedback.explanation.length > 0;
        journey.feedbackHasExcerpt = typeof graded.feedback.sourceExcerpt === "string" && graded.feedback.sourceExcerpt.length > 0;
      }
      if (second) {
        const wrong = second.options.find((option) => option !== second.correctAnswer);
        if (wrong) {
          const graded = await practiceService.submitAnswer(assembled.session.id, learnerId, second.id, wrong);
          journey.wrongAnswerVerdict = graded.feedback.isCorrect;
        } else {
          notes.push("second question had no alternative option");
        }
      } else {
        notes.push("AI practice returned fewer than two questions");
      }

      const reportTarget = second ?? first;
      if (reportTarget) {
        const submitted = reportService.submitQuestionReport(learnerId, {
          questionId: reportTarget.id,
          sessionId: assembled.session.id,
          reason: "other",
          detail: "pilot report (disposable database)",
        });
        journey.reportAccepted = true;
        journey.reportStatus = submitted.status;
        journey.reportAlreadyReported = submitted.alreadyReported;
        const duplicate = reportService.submitQuestionReport(learnerId, {
          questionId: reportTarget.id,
          sessionId: assembled.session.id,
          reason: "other",
          detail: "pilot report duplicate (disposable database)",
        });
        journey.reportDedupeCount = reportService.listQuestionReports({}).length;
        journey.reportDuplicateAlreadyReported = duplicate.alreadyReported;
        journey.reportStoredRevision = reportService
          .listQuestionReports({})
          .map((report) => report.questionRevision ?? null);
      }
      const view = practiceService.getPracticeView(assembled.session.id, learnerId);
      journey.viewAfterAnsweringHasExcerpt = view.feedback.some(
        (entry) => typeof entry.sourceExcerpt === "string" && entry.sourceExcerpt.length > 0,
      );
    } catch (error) {
      notes.push(error instanceof Error ? error.message.slice(0, 300) : String(error));
    }
  }

  const usage = readUsageTotals();
  const report = {
    stamp,
    provider: config.llm.provider,
    model: config.llm.model,
    autoPublishValidated: config.autoPublishValidatedQuestions,
    maxTokens: config.llm.maxTokens,
    thinking: config.llm.thinking,
    emptyContentRetries: config.llm.emptyContentRetries,
    database: dbPath,
    aiLimits: config.aiLimits,
    providerRequests,
    matrixCells: cells.length,
    questionCount: cells.reduce((total, cell) => total + cell.questions.length, 0),
    questionTypes: typesModule.QUESTION_TYPES,
    importedByTopic: [...importedByTopic.entries()],
    sections: [...cellSection.entries()],
    usage,
    cells,
    journey,
    questionTotals: summarize(),
  };
  const outFile = path.join(workDir, `hist-pilot-report-${stamp}.json`);
  writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");
  console.log(`[pilot] cells=${cells.length} questions=${report.questionCount} providerRequests=${providerRequests}`);
  console.log(`[pilot] usage=${JSON.stringify(usage)}`);
  console.log(`[pilot] report=${outFile}`);

  function summarize(): Record<string, unknown> {
    const questions = cells.flatMap((cell) => cell.questions);
    const byType = new Map<string, number>();
    const byDifficulty = new Map<string, number>();
    for (const question of questions) {
      byType.set(question.questionType, (byType.get(question.questionType) ?? 0) + 1);
      byDifficulty.set(question.difficulty, (byDifficulty.get(question.difficulty) ?? 0) + 1);
    }
    return {
      byType: [...byType.entries()],
      byDifficulty: [...byDifficulty.entries()],
      withQualityWarnings: questions.filter((question) => question.qualityWarnings.length > 0).length,
      autoValidated: questions.filter((question) => question.autoValidatedAt !== null).length,
      published: questions.filter((question) => question.status === "published").length,
      bankRowsForQuestions: questionsRepo.countQuestions(),
    };
  }

  function toRecord(question: any): QuestionRecord {
    return {
      id: question.id,
      questionType: question.questionType,
      difficulty: question.difficulty,
      question: question.question,
      options: question.options,
      correctAnswer: question.correctAnswer,
      acceptedAnswers: question.acceptedAnswers,
      explanation: question.explanation,
      knowledgePoint: question.knowledgePoint,
      gradingPoints: question.gradingPoints,
      qualityWarnings: question.qualityWarnings ?? [],
      sourceExcerpt: question.sourceExcerpt,
      sourceLocation: question.sourceLocation,
      sourceBlockIds: question.sourceBlockIds,
      status: question.status,
      autoValidatedAt: question.autoValidatedAt ?? null,
      teacherConfirmationRequired: question.teacherConfirmationRequired ?? false,
      revision: question.revision,
      sourceBlocks: materialsRepo.getBlocksByIds(question.sourceBlockIds).map((block) => ({
        id: block.id,
        text: block.text.slice(0, 1_200),
        sourceLocation: block.sourceLocation,
        sectionId: block.sectionId,
      })),
    };
  }

  function readLatestUsage(): { inputTokens: number | null; outputTokens: number | null } | null {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare(
          "SELECT input_tokens AS i, output_tokens AS o FROM llm_usage_logs ORDER BY created_at DESC, rowid DESC LIMIT 1",
        )
        .get() as { i: number | null; o: number | null } | undefined;
      return row ? { inputTokens: row.i ?? null, outputTokens: row.o ?? null } : null;
    } catch {
      return null;
    } finally {
      db.close();
    }
  }

  function readUsageTotals(): Record<string, number> {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS calls,
                  COALESCE(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END), 0) AS okCalls,
                  COALESCE(SUM(input_tokens), 0) AS inputTokens,
                  COALESCE(SUM(output_tokens), 0) AS outputTokens,
                  COALESCE(SUM(duration_ms), 0) AS durationMs
           FROM llm_usage_logs WHERE provider = 'deepseek'`,
        )
        .get() as Record<string, number>;
      return row;
    } catch {
      return { calls: 0, okCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 0 };
    } finally {
      db.close();
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void main().catch((error) => {
  console.error("[pilot] failed:", error instanceof Error ? error.stack : error);
  process.exit(1);
});
