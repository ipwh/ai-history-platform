import fs from "node:fs";
import path from "node:path";

import {
  TUTOR_STUDENT_QUERY_MATRIX,
  type TutorQueryIntent,
} from "../tests/fixtures/tutor-student-query-matrix";
import { LIVE_EVAL_DATASET } from "../tests/fixtures/tutor-live-eval-dataset";
import { caseEntry } from "../tests/fixtures/tutor-case-id-map";

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function isWithinDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function historicalPitfalls(intent: TutorQueryIntent, knownFailureMode: string | null): string[] {
  const byIntent: Record<TutorQueryIntent, string> = {
    factual: "核對事件年份與人物身分；勿混淆事件開始、宣言公布及戰爭結束。",
    causal: "避免單因論及倒置因果；分清長期背景、直接導火線與行動者選擇。",
    process: "核對階段及時間先後；勿把不同時期的政策或事件合併。",
    impact: "分清短期與長期影響；勿把同時發生的現象直接寫成因果。",
    comparison: "使用對稱的比較準則；若其中一方證據不足，不可用另一方材料補寫。",
    evaluation: "先明示判斷準則；勿把價值判斷、爭議解釋或推論說成無爭議史實。",
    verification: "拆分前提中正確與錯誤部分；核對年份、人物及事件是否互相混淆。",
    "follow-up": "核對代詞是否指向正確的上文內容；不可脫離前文另猜課題。",
    "off-topic": "區分教材範圍不足與問題本身不屬歷史；不要把兩者混為一談。",
    "exam-technique": "把答題框架與歷史事實分開；不得把作答建議包裝成教材內容。",
  };
  return [
    byIntent[intent],
    ...(knownFailureMode === null ? [] : [`矩陣已記錄的失敗模式：${knownFailureMode}`]),
  ];
}

async function main(): Promise<void> {
  const repoRoot = process.cwd();
  const argv = process.argv.slice(2);
  const databasePath = path.resolve(readArg(argv, "--database") ?? path.join(repoRoot, "data", "app.db"));
  const outputPathArg = readArg(argv, "--out");
  if (outputPathArg === null) {
    throw new Error("請以 --out 指定輸出位置；審閱套件可能含教材節錄，不會預設寫入版本庫。");
  }
  const outputPath = path.resolve(outputPathArg);
  if (isWithinDirectory(outputPath, repoRoot)) {
    throw new Error("輸出位置必須在版本庫以外，避免教材節錄被意外提交。");
  }
  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  // 已記錄的模型回覆（例如受控評估輸出）：只合併內容，**不會**因此變成已核准。
  const answersPathArg = readArg(argv, "--answers");
  let recordedAnswers: Map<string, { answer: string; model?: string; promptVersion?: string; generatedAt?: string }> | null =
    null;
  if (answersPathArg !== null) {
    const answersPath = path.resolve(answersPathArg);
    if (!fs.existsSync(answersPath)) throw new Error(`找不到回覆檔案：${answersPath}`);
    // Windows 編輯器（包括 PowerShell 5.1 的 Set-Content）常加 UTF-8 BOM，
    // JSON.parse 會拒絕；讀入時先移除 BOM，避免教師因工具差異而被擋。
    const raw = fs.readFileSync(answersPath, "utf8").replace(/^\uFEFF/, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new Error(`回覆檔案不是有效 JSON：${answersPath}`);
    }
    const records = Array.isArray(parsed)
      ? parsed
      : (parsed as { answers?: unknown }).answers;
    if (!Array.isArray(records)) throw new Error("回覆檔案格式不正確：應為陣列或含 answers 陣列的物件");
    recordedAnswers = new Map();
    for (const record of records as {
      caseId?: string;
      answer?: string;
      model?: string;
      promptVersion?: string;
      generatedAt?: string;
    }[]) {
      if (typeof record.caseId !== "string" || typeof record.answer !== "string") continue;
      recordedAnswers.set(record.caseId, {
        answer: record.answer,
        model: record.model,
        promptVersion: record.promptVersion,
        generatedAt: record.generatedAt,
      });
    }
  }

  process.env.APP_DATABASE_PATH = databasePath;
  const database = await import("../src/server/db/connection");
  database.enableReadOnlyDatabaseMode();
  const [groundingModule, queryModule, tutorModule, depthModule, answerabilityModule] =
    await Promise.all([
      import("../src/server/services/tutor-grounding"),
      import("../src/server/services/tutor-query"),
      import("../src/server/services/tutor"),
      import("../src/server/services/tutor-depth"),
      import("../src/server/services/tutor-answerability"),
    ]);

  try {
    const curriculum = groundingModule.loadTutorCurriculumIndex();
    if (curriculum.topics.length === 0) {
      throw new Error("唯讀課程索引為空，不能產生教師審閱套件。");
    }

    const isOnTopic = (query: string, hasContext: boolean): boolean => {
      const normalized = queryModule.normalizeTutorQuery(query);
      return (
        !queryModule.isClearlyNonHistoryTutorQuery(query) &&
        (tutorModule.isHistoryTopicPrompt(normalized) ||
          groundingModule.matchesCurriculumTerms(curriculum, normalized) ||
          (hasContext && tutorModule.isShortHistoryFollowUp(query)))
      );
    };

    const cases = TUTOR_STUDENT_QUERY_MATRIX.map((item) => {
      const actualGateCheck =
        item.gate === "follow-up-only"
          ? tutorModule.isShortHistoryFollowUp(item.query) && isOnTopic(item.query, true)
          : item.gate === "unclear"
            ? queryModule.isUnclearTutorQuery(item.query, curriculum, false) ||
              !isOnTopic(item.query, false)
            : isOnTopic(item.query, false) === (item.gate === "on-topic");
      const actualDepth = depthModule.resolveTutorReplyDepth("auto", item.query);
      const topicGuess = groundingModule.guessTutorTopic(
        item.query,
        curriculum.topics,
        curriculum.sectionsByTopic,
      );
      const topicCheck =
        item.topicId === null
          ? "not-specified"
          : topicGuess?.topicId === item.topicId
            ? "pass"
            : "fail";
      const depthCheck =
        item.depth === null ? "not-specified" : actualDepth === item.depth ? "pass" : "fail";
      const shortFollowUpCheck =
        tutorModule.isShortHistoryFollowUp(item.query) === item.shortFollowUp ? "pass" : "fail";
      const checks = [actualGateCheck ? "pass" : "fail", topicCheck, depthCheck, shortFollowUpCheck];
      const softwareStatus = checks.includes("fail") ? "fail" : "pass";
      const shouldRetrieve = item.gate === "on-topic" && actualGateCheck;
      const grounding = shouldRetrieve
        ? groundingModule.findTutorGrounding(
            queryModule.normalizeTutorQuery(item.query),
            [],
            curriculum,
            { maxSources: depthModule.tutorMaxSourcesForDepth(actualDepth) },
          )
        : null;
      const audit = grounding?.selectionAudit;
      const passageAudits = new Map(
        (audit?.selected ?? []).map((selected) => [selected.blockId, selected]),
      );
      // 可答性狀態（Sprint 29）：與教材是否涵蓋分開記錄，令教師一眼看到
      // 「教材支持／部分支持／一般歷史知識／需澄清／非歷史」。
      // 追問類案例在原矩陣是單獨一句，因此一律以「沒有上文」評估。
      const answerability = answerabilityModule.classifyTutorAnswerability({
        message: item.query,
        curriculum,
        grounding:
          grounding ?? {
            status: "not-covered",
            topicId: null,
            topicTitle: null,
            sources: [],
            passages: [],
          },
        hasHistoryContext: false,
        unclear: queryModule.isUnclearTutorQuery(item.query, curriculum, false),
      });

      return {
        id: item.id,
        originalQuestion: item.query,
        language: item.language,
        intendedQuestionType: item.intent,
        category: item.category,
        level: item.level,
        inferredTopic: topicGuess
          ? { topicId: topicGuess.topicId, topicTitle: topicGuess.topicTitle }
          : null,
        softwareBehavior: {
          status: softwareStatus,
          checks: {
            gate: actualGateCheck ? "pass" : "fail",
            expectedTopic: topicCheck,
            expectedDepth: depthCheck,
            shortFollowUp: shortFollowUpCheck,
          },
          expectedGate: item.gate,
          actualDepth,
          expectedDepth: item.depth,
        },
        selectedMaterialEvidence: {
          retrievalStatus: grounding?.status ?? "not-run",
          topicId: grounding?.topicId ?? null,
          topicTitle: grounding?.topicTitle ?? null,
          uncoveredTerms: grounding?.uncoveredTerms ?? [],
          topicEvidence: grounding?.topicEvidence ?? [],
          passages: (grounding?.passages ?? []).map((passage) => ({
            blockId: passage.anchorBlockId,
            topicId: passage.topicId ?? null,
            topicTitle: passage.topicTitle ?? null,
            document: passage.documentLabel,
            location: passage.location,
            score: passage.score,
            truncated: passageAudits.get(passage.anchorBlockId)?.truncated ?? false,
            modelContextText: passage.promptText,
          })),
          selectionAudit: audit
            ? {
                candidateBlocks: audit.candidateBlocks,
                scoredHits: audit.scoredHits,
                belowThreshold: audit.belowThreshold,
                searchedTopicIds: audit.searchedTopicIds ?? [],
                topicAllocation: audit.topicAllocation ?? [],
                selected: audit.selected,
                excluded: audit.excluded,
              }
            : null,
        },
        expectedRetrieval: item.expectedRetrieval,
        expectedAnswerCharacteristics: item.expectedAnswerCharacteristics,
        answerability: {
          state: answerability.state,
          scope: answerability.scope,
          materialEvidence: answerability.materialEvidence,
          evidenceSupport: answerability.evidenceSupport,
          evidenceNotes: answerability.evidenceNotes,
          confidence: answerability.confidence,
          allowGeneralKnowledge: answerability.allowGeneralKnowledge,
          requireDisclosure: answerability.requireDisclosure,
          reason: answerability.reason,
        },
        recommendedDepth: actualDepth,
        studentLevel: item.level,
        commonHistoricalInaccuraciesToCheck: historicalPitfalls(
          item.intent,
          item.knownFailureMode,
        ),
        actualAnswer: recordedAnswers?.get(item.id)?.answer ?? null,
        actualAnswerNote:
          recordedAnswers?.get(item.id) === undefined
            ? "未發出模型請求；請由教師按授權流程安全重現並記錄。"
            : "由受控評估記錄的模型回覆；仍需教師逐題覆核，自動記錄不代表核准。",
        actualAnswerProvenance: recordedAnswers?.get(item.id) ?? null,
        review: {
          softwareBehavior: softwareStatus,
          historicalContentVerified: "pending-human-review",
          materialEvidenceSufficient: "pending-human-review",
          pedagogicallyAppropriate: "pending-human-review",
          languageQualityAccepted: "pending-human-review",
          status: "pending-human-review",
          reviewer: null,
          reviewedAt: null,
          notes: "",
        },
        fixtureReviewStatus: item.reviewStatus,
        knownFailureMode: item.knownFailureMode,
        severity: item.severity,
        // 舊有矩陣的硬閘期望與新政策的差異：明確標示，避免教師誤解
        gateExpectationVsPolicy:
          item.gate === "off-topic" && answerability.scope === "history"
            ? "policy-now-answers-with-disclosure"
            : "unchanged",
      };
    });

    // ── 12 條受控評估案例（Sprint 33）──────────────────────────────────
    // 這些案例**不屬於** 83 條教師矩陣，因此獨立成一節；狀態一律 pending-human-review。
    const liveCases = LIVE_EVAL_DATASET.map((entry) => {
      const recorded = recordedAnswers?.get(entry.id) ?? null;
      const mapped = caseEntry("live-eval-dataset", entry.id);
      const history = entry.history ? [...entry.history] : [];
      const liveDepth = depthModule.resolveTutorReplyDepth("auto", entry.query, null);
      const liveGrounding = groundingModule.findTutorGrounding(
        queryModule.normalizeTutorQuery(entry.query),
        history,
        curriculum,
        { maxSources: depthModule.tutorMaxSourcesForDepth(liveDepth) },
      );
      const liveDecision = answerabilityModule.classifyTutorAnswerability({
        message: entry.query,
        curriculum,
        grounding: liveGrounding,
        hasHistoryContext: history.length > 0,
        unclear: queryModule.isUnclearTutorQuery(entry.query, curriculum, history.length > 0),
      });
      const prompt = {
        state: liveDecision.state,
        confidence: liveDecision.confidence ?? null,
        depth: liveDepth,
        groundingStatus: liveGrounding.status,
        passageCount: liveGrounding.passages.length,
      };
      return {
        caseId: entry.id,
        source: "live-eval-dataset",
        duplicateGroup: mapped?.duplicateGroup ?? null,
        query: entry.query,
        persona: entry.persona,
        language: entry.language,
        coverageClass: entry.coverageClass,
        expected: {
          state: entry.expectedState,
          evidencePolicy: entry.expectedEvidencePolicy,
          confidence: entry.expectedConfidence,
          disclosure: entry.expectedDisclosure,
          depth: entry.expectedDepth,
          evaluationFocus: entry.evaluationFocus,
        },
        deterministic: {
          stateFromClassifier: prompt.state,
          confidenceFromClassifier: prompt.confidence,
          depth: prompt.depth,
          groundingStatus: prompt.groundingStatus,
          passageCount: prompt.passageCount,
        },
        liveModel: {
          answer: recorded?.answer ?? null,
          model: recorded?.model ?? null,
          promptVersion: recorded?.promptVersion ?? null,
          generatedAt: recorded?.generatedAt ?? null,
        },
        teacherDecision: {
          status: "pending-human-review",
          reviewer: null,
          reviewedAt: null,
          notes: "",
        },
      };
    });

    const answerabilitySummary = cases.reduce<Record<string, number>>((summary, entry) => {
      summary[entry.answerability.state] = (summary[entry.answerability.state] ?? 0) + 1;
      return summary;
    }, {});

    const payload = {
      generatedAt: new Date().toISOString(),
      notice:
        "唯讀檢索套件；不呼叫模型。自動行為檢查及教材節錄均不代表歷史內容或教學質素已獲教師核准。answerability 為 Sprint 29 的可答性狀態（A 教材支持／B 部分支持／C 一般歷史知識／D 需澄清／out-of-scope）。",
      database: path.basename(databasePath),
      caseCount: cases.length,
      promptVersion: groundingModule.TUTOR_PROMPT_VERSION,
      answersIncluded: cases.filter((entry) => entry.actualAnswer !== null).length,
      /**
       * 三層證據必須分開閱讀（Sprint 31）：
       *   - deterministic：自動測試／分類器／檢索結果，只證明軟件行為；
       *   - liveModel：受控評估記錄的模型回覆（`actualAnswer`／`actualAnswerProvenance`），
       *     不證明內容正確；
       *   - teacherDecision：歷史科教師的逐題裁決（`review`），只有這一層可以構成核准。
       */
      evidenceLayers: {
        deterministic: ["softwareBehavior", "selectedMaterialEvidence", "answerability", "recommendedDepth"],
        liveModel: ["actualAnswer", "actualAnswerProvenance"],
        teacherDecision: ["review"],
      },
      answerabilitySummary,
      liveEvaluationCaseCount: liveCases.length,
      liveEvaluationAnswersIncluded: liveCases.filter((entry) => entry.liveModel.answer !== null).length,
      liveEvaluationCases: liveCases,
      cases,
    };
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const descriptor = fs.openSync(outputPath, "wx");
    let descriptorClosed = false;
    try {
      fs.writeFileSync(descriptor, content, { encoding: "utf8" });
      fs.fsyncSync(descriptor);
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      try {
        fs.closeSync(descriptor);
        descriptorClosed = true;
      } catch (closeError) {
        descriptorClosed = true;
        cleanupErrors.push(closeError);
      }
      try {
        fs.unlinkSync(outputPath);
      } catch (unlinkError) {
        cleanupErrors.push(unlinkError);
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          "教師覆核套件寫入失敗，而且未能完整清除部分輸出。",
        );
      }
      throw error;
    } finally {
      if (!descriptorClosed) fs.closeSync(descriptor);
    }
    console.log(`已輸出 ${cases.length} 條案例：${outputPath}`);
    console.log("沒有呼叫模型；所有歷史內容、證據充分度、教學及語言覆核仍為 pending-human-review。");
  } finally {
    database.closeDefaultDatabase();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
