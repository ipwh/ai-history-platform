/**
 * 題目修復的答案對應與來源（Sprint：repair provenance & answer integrity）。
 *
 * 這一組測試固定「修復不得靜默改變被考核的答案」的行為：
 *   1. 多空格填充題只有在**仍考核原第 1 個空格**時才可自動改寫；
 *   2. 會改變考核答案的改寫一律不改內容、標示待教師確認，且不記錄任何覆核；
 *   3. 修復理由必須與實際改動一致（不可把改變答案說成「答案不變」）；
 *   4. 已派發的練習仍以快照批改，題目日後被改寫不會改寫歷史成績；
 *   5. 結構安全網（checkQuestionServable）同樣適用於即時生成的題目。
 *
 * 純函式部分不需要資料庫；「歷史作答」一節使用獨立暫存資料庫。
 */
import { beforeAll, describe, expect, it } from "vitest";

import { questionSchema, type Question } from "@/lib/types";
import {
  blankAnswersFromExplanation,
  normaliseMultiBlankFill,
} from "@/server/materials/question-bank";
import {
  AUTO_PREFIX,
  AUTO_QUARANTINE_PREFIX,
  AUTO_REPAIR_PREFIX,
  cleanBullet,
  nextTeacherConfirmationFlag,
  planQuestionRepair,
  repairWarnings,
} from "@/server/services/question-repair";
import { checkQuestionServable } from "@/server/services/question-servability";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("repair-provenance");
process.env.LLM_PROVIDER = "mock";
delete process.env.K_SERVICE;

function buildQuestion(overrides: Partial<Question>): Question {
  return questionSchema.parse({
    id: "q-repair-test",
    topicId: "topic-5",
    sectionId: "topic-5-renaissance-features",
    questionType: "fill",
    difficulty: "basic",
    question: "＿＿＿是甲。",
    options: [],
    correctAnswer: "甲",
    acceptedAnswers: [],
    explanation: "測試用解釋。",
    knowledgePoint: "測試知識點",
    sourceExcerpt: "測試節錄",
    sourceLocation: "測試 · 第 1 題",
    origin: "school-paper",
    status: "draft",
    sourceVerified: false,
    createdAt: "2026-10-19T00:00:00.000Z",
    ...overrides,
  });
}

describe("多空格填充題的空白與答案對應", () => {
  it("單一空格不需要改寫", () => {
    expect(normaliseMultiBlankFill("人類最早在＿＿＿出現。", ["非洲"])).toBeNull();
    const plan = planQuestionRepair(
      buildQuestion({ question: "人類最早在＿＿＿出現。", correctAnswer: "非洲" }),
    );
    expect(plan.changed).toBe(false);
    expect(plan.blocked).toBe(false);
    expect(plan.classification).toBe("unchanged");
  });

  it("保留原第 1 個空格時，考核答案不變（可安全改寫）", () => {
    const normalised = normaliseMultiBlankFill("＿＿＿是甲，＿＿＿是乙。", ["甲", "乙"]);
    expect(normalised).not.toBeNull();
    expect(normalised!.assessedBlankIndex).toBe(1);
    expect(normalised!.originalAnswer).toBe("甲");
    expect(normalised!.correctAnswer).toBe("甲");
    expect(normalised!.question).toContain("＿＿＿");
    expect(normalised!.question).toContain("乙");

    const plan = planQuestionRepair(
      buildQuestion({ question: "＿＿＿是甲，＿＿＿是乙。", correctAnswer: "甲", gradingPoints: ["乙"] }),
    );
    expect(plan.changed).toBe(true);
    expect(plan.classification).toBe("answer-preserved");
    expect(plan.blocked).toBe(false);
    expect(plan.reviewReason).toContain("仍考核第 1 個空格");
    expect(plan.reviewReason).toContain("考核答案及題意不變");
  });

  it("答案出現在後文時會改用另一個空格，並如實回報考核目標已改變", () => {
    const stem =
      "軍備競賽增加了＿＿＿風險。此外，擁有軍事優勢的國家變得＿＿＿，傾向以戰爭解決紛爭。";
    const normalised = normaliseMultiBlankFill(stem, ["戰爭", "好戰"]);
    expect(normalised?.assessedBlankIndex).toBe(2);
    expect(normalised?.originalAnswer).toBe("戰爭");
    expect(normalised?.correctAnswer).toBe("好戰");

    const plan = planQuestionRepair(
      buildQuestion({ question: stem, correctAnswer: "戰爭", gradingPoints: ["好戰"] }),
    );
    expect(plan.classification).toBe("answer-affecting");
    expect(plan.changed).toBe(false);
    expect(plan.blocked).toBe(true);
    expect(plan.requiresReview).toBe(true);
    expect(plan.unusable).toBe(false);
    // 內容保持原狀，供教師比較原卷
    expect(plan.question.question).toBe(stem);
    expect(plan.question.correctAnswer).toBe("戰爭");
    expect(plan.reviewReason).toBeNull();
  });

  it("重複出現的答案字串仍以位置判斷（不可誤當同一個空格）", () => {
    const stem = "＿＿＿是甲，＿＿＿是中產階級，＿＿＿也是甲。";
    const normalised = normaliseMultiBlankFill(stem, ["中產階級", "工人階級", "中產階級"]);
    expect(normalised).not.toBeNull();
    // 第 1 個空格若保留，答案「中產階級」會在後文再次出現 → 必須改用第 2 個空格
    expect(normalised!.assessedBlankIndex).toBe(2);
    expect(normalised!.originalAnswer).toBe("中產階級");
    expect(normalised!.correctAnswer).toBe("工人階級");
  });

  it("答案兩側的空白不會改變空格對應", () => {
    const normalised = normaliseMultiBlankFill("＿＿＿ 是 甲，＿＿＿ 是 乙。", [" 甲 ", " 乙 "]);
    expect(normalised?.assessedBlankIndex).toBe(1);
    expect(normalised?.correctAnswer).toBe("甲");
  });

  it("Unicode 排版字元（U+2024）、全形標點及斜線不會破壞空格對應", () => {
    const stem = "＿＿＿是羅馬的重要將領，＿＿＿是羅馬第一位皇帝。";
    const normalised = normaliseMultiBlankFill(stem, ["尤利烏斯․凱撒", "奧古斯都"]);
    expect(normalised?.assessedBlankIndex).toBe(1);
    expect(normalised?.originalAnswer).toBe("尤利烏斯․凱撒");
    expect(normalised?.correctAnswer).toBe("尤利烏斯․凱撒");

    // 「甲 / 乙」這種同義寫法本身不應令空格對應改變
    const slash = normaliseMultiBlankFill("＿＿＿是第一個答案，＿＿＿是第二個答案。", [
      "甲 / 乙",
      "丙",
    ]);
    expect(slash?.assessedBlankIndex).toBe(1);
    expect(slash?.correctAnswer).toBe("甲 / 乙");
  });

  it("題幹混有項目符號或選項標記時，空格數目仍以實際空格標記計算", () => {
    const normalised = normaliseMultiBlankFill("A. ＿＿＿是甲，＿＿＿是乙。", ["甲", "乙"]);
    expect(normalised).not.toBeNull();
    expect(normalised!.assessedBlankIndex).toBe(1);
    expect(normalised!.question).toContain("A.");
  });

  it("答案數目少於空格數目時不強行改寫（無法確定等價）", () => {
    const plan = planQuestionRepair(
      buildQuestion({ question: "＿＿＿是甲，＿＿＿是乙。", correctAnswer: "甲", gradingPoints: [] }),
    );
    expect(plan.classification).toBe("unrepairable");
    expect(plan.blocked).toBe(true);
    expect(plan.unusable).toBe(true);
    expect(plan.changed).toBe(false);
    expect(plan.reviewReason).toBeNull();
  });

  it("可由評卷參考還原多個答案時，判斷方式與匯入流程一致", () => {
    expect(blankAnswersFromExplanation("填充題答案（依空格次序）：(1) 民族、(2) 殖民")).toEqual([
      "民族",
      "殖民",
    ]);
  });
});

describe("選項排版符號", () => {
  it("只移除開頭的項目符號，且可重複執行", () => {
    expect(cleanBullet(". i和ii")).toBe("i和ii");
    expect(cleanBullet("． i和ii")).toBe("i和ii");
    expect(cleanBullet("· i和ii")).toBe("i和ii");
    expect(cleanBullet("• i和ii")).toBe("i和ii");
    expect(cleanBullet("‧ i和ii")).toBe("i和ii");
    expect(cleanBullet(cleanBullet(". i和ii"))).toBe("i和ii");
  });

  it("選擇題的項目符號屬純格式改動，答案與選項文字不變", () => {
    const question = buildQuestion({
      questionType: "mc",
      question: "以下哪項正確？ i. 甲 ii. 乙 iii. 丙",
      options: [". i和ii", ". ii和iii", ". i和iii", ". 以上皆是"],
      correctAnswer: ". i和ii",
    });
    const plan = planQuestionRepair(question);
    expect(plan.classification).toBe("formatting-only");
    expect(plan.changed).toBe(true);
    expect(plan.blocked).toBe(false);
    expect(plan.question.correctAnswer).toBe("i和ii");
    expect(plan.question.options).toEqual(["i和ii", "ii和iii", "i和iii", "以上皆是"]);
    expect(plan.reviewReason).toContain("[automation]");
    expect(plan.reviewReason).toContain("答案及選項文字不變");
  });

  it("沒有項目符號的選擇題不會被改動（idempotent）", () => {
    const plan = planQuestionRepair(
      buildQuestion({
        questionType: "mc",
        question: "以下哪項正確？",
        options: ["甲", "乙", "丙", "丁"],
        correctAnswer: "甲",
      }),
    );
    expect(plan.changed).toBe(false);
    expect(plan.blocked).toBe(false);
  });
});

describe("修復理由必須與實際改動一致", () => {
  it("改變考核答案時，不會產生任何可自動通過的覆核理由", () => {
    const plan = planQuestionRepair(
      buildQuestion({
        question: "軍備競賽增加了＿＿＿風險。此後傾向以戰爭解決紛爭，變得＿＿＿。",
        correctAnswer: "戰爭",
        gradingPoints: ["好戰"],
      }),
    );
    expect(plan.classification).toBe("answer-affecting");
    expect(plan.reviewReason).toBeNull();
    expect(plan.note).toContain("不會自動改寫");
    expect(plan.note).toContain("戰爭");
    expect(plan.note).toContain("好戰");
  });

  it("品質警告會如實說明需要教師確認，並保留其他來源的警告", () => {
    const question = buildQuestion({
      question: "軍備競賽增加了＿＿＿風險。此後傾向以戰爭解決紛爭，變得＿＿＿。",
      correctAnswer: "戰爭",
      gradingPoints: ["好戰"],
      qualityWarnings: ["教師較早前留下的警告"],
    });
    const plan = planQuestionRepair(question);
    const warnings = repairWarnings(question, plan);
    expect(warnings[0]).toBe("教師較早前留下的警告");
    expect(warnings.some((warning) => warning.startsWith(AUTO_REPAIR_PREFIX))).toBe(true);
    expect(warnings.some((warning) => warning.startsWith(AUTO_QUARANTINE_PREFIX))).toBe(false);
    expect(warnings.join("\n")).toContain("須由教師確認考核內容");
    // 原題的警告陣列沒有被就地修改
    expect(question.qualityWarnings).toEqual(["教師較早前留下的警告"]);
    // 仍須保持待教師確認
    expect(nextTeacherConfirmationFlag(question, plan)).toBe(true);
  });

  it("安全改寫可用準確理由補記覆核；改變考核內容則不可", () => {
    const preserved = planQuestionRepair(
      buildQuestion({ question: "＿＿＿是甲，＿＿＿是乙。", correctAnswer: "甲", gradingPoints: ["乙"] }),
    );
    const affecting = planQuestionRepair(
      buildQuestion({
        question: "軍備競賽增加了＿＿＿風險。此後傾向以戰爭解決紛爭，變得＿＿＿。",
        correctAnswer: "戰爭",
        gradingPoints: ["好戰"],
      }),
    );
    expect(preserved.reviewReason).not.toBeNull();
    expect(affecting.reviewReason).toBeNull();
  });

  it("隔離標記（已改變考核答案）不會被下一次自動修復清除", () => {
    const question = buildQuestion({
      teacherConfirmationRequired: true,
      qualityWarnings: [
        `${AUTO_QUARANTINE_PREFIX}考核空格由第 1 個改為第 2 個；須由教師核對原卷後確認`,
      ],
    });
    const plan = planQuestionRepair(question);
    expect(plan.changed).toBe(false);
    expect(plan.blocked).toBe(false);
    // 題目結構已可用，但隔離標記必須保留：只有教師可以清除
    expect(nextTeacherConfirmationFlag(question, plan)).toBe(true);
  });

  it("同時存在舊版自動標記時，隔離標記仍不會被清除", () => {
    const question = buildQuestion({
      teacherConfirmationRequired: true,
      qualityWarnings: [
        `${AUTO_PREFIX}舊版修復腳本留下的標記`,
        `${AUTO_QUARANTINE_PREFIX}考核空格由第 1 個改為第 2 個`,
      ],
    });
    const plan = planQuestionRepair(question);
    expect(nextTeacherConfirmationFlag(question, plan)).toBe(true);
  });

  it("舊版「平台自動檢查：」標記在題目恢復可用時仍會清除（向後兼容）", () => {
    const question = buildQuestion({
      question: "人類最早在＿＿＿出現。",
      correctAnswer: "非洲",
      teacherConfirmationRequired: true,
      qualityWarnings: [`${AUTO_PREFIX}舊版修復腳本留下的標記`],
    });
    const plan = planQuestionRepair(question);
    expect(nextTeacherConfirmationFlag(question, plan)).toBe(false);
  });
});

describe("結構安全網（所有交付路徑共用）", () => {
  it("沒有空格標記的填充題不可派給學生", () => {
    const question = buildQuestion({ question: "工人開始組織，向僱主提出訴求。", correctAnswer: "工會" });
    expect(checkQuestionServable(question).ok).toBe(false);
    const plan = planQuestionRepair(question);
    expect(plan.blocked).toBe(true);
    expect(plan.unusable).toBe(true);
    expect(plan.reviewReason).toBeNull();
  });

  it("即時生成的題目同樣受結構檢查約束（選項指涉 i／ii 但題幹無標示）", () => {
    // 這是生成流程回傳的題目形狀（不含資料庫欄位以外的內容）
    const generated = buildQuestion({
      questionType: "mc",
      id: "gen-1",
      origin: "material-ai",
      status: "draft",
      question: "下列哪些屬於一手資料？ 日記 錄像 事件發生時的報章報道 學術論文",
      options: ["i、ii和iii", "i、ii和iv", "i、iii和iv", "ii、iii和iv"],
      correctAnswer: "i、ii和iii",
    });
    const check = checkQuestionServable(generated);
    expect(check.ok).toBe(false);
    expect(check.reason).toContain("羅馬數字");
  });

  it("改變考核內容的題目不會被 --delete-unusable 誤刪（unusable 為 false）", () => {
    const plan = planQuestionRepair(
      buildQuestion({
        question: "軍備競賽增加了＿＿＿風險。此後傾向以戰爭解決紛爭，變得＿＿＿。",
        correctAnswer: "戰爭",
        gradingPoints: ["好戰"],
      }),
    );
    expect(plan.blocked).toBe(true);
    expect(plan.unusable).toBe(false);
    // 沒有任何部分改寫：原題物件完整保留，供教師比較
    expect(plan.question.question).toBe(
      "軍備競賽增加了＿＿＿風險。此後傾向以戰爭解決紛爭，變得＿＿＿。",
    );
    expect(plan.question.correctAnswer).toBe("戰爭");
    expect(plan.changed).toBe(false);
  });

  it("格式完整的即時生成題目可以通過同一道結構檢查（不會誤擋）", () => {
    const valid = buildQuestion({
      questionType: "mc",
      id: "gen-2",
      origin: "material-ai",
      question: "文藝復興首先在哪裏興起？",
      options: ["意大利", "法國", "英國", "德國"],
      correctAnswer: "意大利",
    });
    expect(checkQuestionServable(valid).ok).toBe(true);
  });
});

describe("重複執行（idempotency）", () => {
  it("安全改寫後再執行一次不會再改動", () => {
    const question = buildQuestion({
      question: "＿＿＿是甲，＿＿＿是乙。",
      correctAnswer: "甲",
      gradingPoints: ["乙"],
    });
    const first = planQuestionRepair(question);
    expect(first.changed).toBe(true);
    const second = planQuestionRepair(first.question);
    expect(second.changed).toBe(false);
    expect(second.classification).toBe("unchanged");
  });

  it("移除項目符號後再執行一次不會再改動", () => {
    const question = buildQuestion({
      questionType: "mc",
      question: "以下哪項正確？",
      options: [". 甲", ". 乙", ". 丙", ". 丁"],
      correctAnswer: ". 甲",
    });
    const first = planQuestionRepair(question);
    const second = planQuestionRepair(first.question);
    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
  });
});

describe("歷史作答與練習快照", () => {
  type PracticeService = typeof import("@/server/services/practice-service");
  type QuestionsRepo = typeof import("@/server/repositories/questions");
  type PracticeRepo = typeof import("@/server/repositories/practice");
  type Seed = typeof import("@/server/seed");

  let practice: PracticeService;
  let questionsRepo: QuestionsRepo;
  let practiceRepo: PracticeRepo;

  const LEARNER = "repair-provenance-learner";
  const SECTION = "topic-5-renaissance-features";
  const QUESTION_ID = "q-repair-history";

  beforeAll(async () => {
    practice = await import("@/server/services/practice-service");
    questionsRepo = await import("@/server/repositories/questions");
    practiceRepo = await import("@/server/repositories/practice");
    const seed: Seed = await import("@/server/seed");
    seed.ensureBootstrap();
  });

  it("匯入時若改寫會改變考核答案，會標示待教師確認（不會自動發布）", async () => {
    const { importQuestionBank } = await import("@/server/services/question-bank-import-service");
    const text = `填充題

A. 測試單元

[[TESTFBQ90001
＿＿＿＿是甲，＿＿＿＿是乙。

##

甲；乙

@@

{{}}

d:0;

t:fb; nil:2
]]

[[TESTFBQ90002
軍備競賽增加了＿＿＿＿風險。此後傾向以戰爭解決紛爭，變得＿＿＿＿。

##

戰爭；好戰

@@

{{}}

d:0;

t:fb; nil:2
]]
`;
    const result = importQuestionBank({
      topicId: "topic-10",
      fileName: "測試_填充題.docx",
      text,
    });
    expect(result.imported).toBe(2);

    const preserved = questionsRepo.getQuestion("qb-TESTFBQ90001");
    expect(preserved?.correctAnswer).toBe("甲");
    expect(preserved?.teacherConfirmationRequired).toBe(false);

    const changed = questionsRepo.getQuestion("qb-TESTFBQ90002");
    expect(changed?.correctAnswer).toBe("好戰");
    expect(changed?.teacherConfirmationRequired).toBe(true);
    expect(changed?.qualityWarnings.join("\n")).toContain("改變了考核內容");
  });

  it("題目日後被改寫，已派發的練習仍以原快照批改（不會追溯改分）", async () => {
    questionsRepo.insertQuestion({
      id: QUESTION_ID,
      topicId: "topic-5",
      sectionId: SECTION,
      questionType: "fill",
      difficulty: "basic",
      question: "文藝復興首先在＿＿＿興起。",
      options: [],
      correctAnswer: "意大利",
      acceptedAnswers: [],
      explanation: "測試用解釋。",
      knowledgePoint: "測試知識點",
      sourceExcerpt: "文藝復興首先在意大利興起。",
      sourceLocation: "測試 · 第 1 題",
      sourceBlockIds: [],
      gradingPoints: [],
      origin: "school-paper",
      status: "published",
      sourceVerified: false,
      qualityWarnings: [],
      skill: null,
      revision: 1,
      autoValidatedAt: null,
      autoValidatedRevision: null,
      autoValidatedFingerprint: null,
      teacherConfirmationRequired: false,
      createdAt: "2026-10-19T00:00:00.000Z",
    });

    const assembled = await practice.createPractice({
      learnerId: LEARNER,
      topicId: "topic-5",
      sectionIds: [SECTION],
      questionTypes: ["fill"],
      difficulty: "basic",
      questionCount: 1,
      mode: "standard",
      sourceSessionId: null,
    });
    expect(assembled.questions.map((question) => question.id)).toContain(QUESTION_ID);

    const submitted = await practice.submitAnswer(
      assembled.session.id,
      LEARNER,
      QUESTION_ID,
      "意大利",
    );
    expect(submitted.feedback.isCorrect).toBe(true);

    const attemptBefore = practiceRepo.getAttempt(assembled.session.id, QUESTION_ID);
    expect(attemptBefore?.questionRevision).toBe(1);

    // 模擬「事後修復」改寫答案：現行題目改成另一個答案
    const current = questionsRepo.getQuestion(QUESTION_ID)!;
    questionsRepo.updateQuestion(QUESTION_ID, { ...current, correctAnswer: "法國" });
    expect(questionsRepo.getQuestion(QUESTION_ID)?.correctAnswer).toBe("法國");

    // 學生成績與快照仍以原題目版本為準
    const result = practice.getPracticeResult(assembled.session.id, LEARNER);
    expect(result.correctCount).toBe(1);
    expect(result.feedback[0].correctAnswer).toBe("意大利");
    const snapshot = practice.getPracticeView(assembled.session.id, LEARNER);
    const snapshotQuestion = snapshot.questions.find((question) => question.id === QUESTION_ID);
    expect(snapshotQuestion).toBeDefined();

    const attemptAfter = practiceRepo.getAttempt(assembled.session.id, QUESTION_ID);
    expect(attemptAfter?.questionRevision).toBe(1);
    expect(attemptAfter?.answer).toBe("意大利");
  });
});
