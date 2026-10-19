/**
 * 來源、解釋、元數據及政策分類的單元測試。
 *
 * 這些測試固定「程式只發現問題、不自行裁定歷史事實或版權」的界線。
 */
import { describe, expect, it } from "vitest";

import { classifySourceTraceability } from "@/server/quality/source-traceability";
import {
  classifyExplanation,
  isPlaceholderExplanation,
} from "@/server/quality/explanation-quality";
import {
  assessMetadata,
  isLayoutResidueKnowledgePoint,
} from "@/server/quality/metadata-quality";
import { evaluateQuestionPolicy } from "@/server/quality/question-policy";

const SECTION_TITLES = ["冷戰的背景與成因", "冷戰的主要發展"];

function sourceInput(overrides: Partial<Parameters<typeof classifySourceTraceability>[0]> = {}) {
  return {
    origin: "school-paper",
    sourceLocation: "",
    sourceBlockIds: [],
    sourceVerified: false,
    blockResolutions: [],
    ...overrides,
  };
}

describe("來源可追溯性分類", () => {
  it("可解析的段落及文件 → traceable", () => {
    const result = classifySourceTraceability(
      sourceInput({
        sourceLocation: "教材.docx · 第 12 段（段落）",
        sourceBlockIds: ["blk-1"],
        sourceVerified: true,
        blockResolutions: [{ blockId: "blk-1", blockExists: true, documentExists: true }],
      }),
    );
    expect(result.status).toBe("traceable");
    expect(result.evidence.hasDocumentRecord).toBe(true);
    expect(result.codes).toEqual(["SOURCE_BLOCKS_RESOLVED"]);
  });

  it("來源段落已不存在 → partial（不假裝可追溯）", () => {
    const result = classifySourceTraceability(
      sourceInput({
        sourceBlockIds: ["blk-missing"],
        sourceVerified: true,
        blockResolutions: [{ blockId: "blk-missing", blockExists: false, documentExists: false }],
      }),
    );
    expect(result.status).toBe("partial");
    expect(result.codes).toContain("SOURCE_BLOCK_MISSING");
  });

  it("段落存在但文件已刪除 → partial", () => {
    const result = classifySourceTraceability(
      sourceInput({
        sourceBlockIds: ["blk-2"],
        sourceVerified: true,
        blockResolutions: [{ blockId: "blk-2", blockExists: true, documentExists: false }],
      }),
    );
    expect(result.status).toBe("partial");
    expect(result.codes).toContain("SOURCE_BLOCK_DOCUMENT_MISSING");
  });

  it("有段落連結但未核實 → pending_verification", () => {
    const result = classifySourceTraceability(
      sourceInput({
        sourceBlockIds: ["blk-3"],
        sourceVerified: false,
        blockResolutions: [{ blockId: "blk-3", blockExists: true, documentExists: true }],
      }),
    );
    expect(result.status).toBe("pending_verification");
    expect(result.codes).toContain("SOURCE_BLOCK_UNVERIFIED");
  });

  it("校內試題只有檔名及題號 → pending_verification（不可當成已核實）", () => {
    const result = classifySourceTraceability(
      sourceInput({
        sourceLocation: "課題1_MCQ.docx · 第 12 題 · A. 石器時代的演進",
      }),
    );
    expect(result.status).toBe("pending_verification");
    expect(result.codes).toEqual(
      expect.arrayContaining(["SOURCE_LOCATION_UNVERIFIED", "SOURCE_DOCUMENT_RECORD_MISSING"]),
    );
    expect(result.evidence.hasImportBatch).toBe(false);
    expect(result.evidence.hasSourceHash).toBe(false);
  });

  it("只有描述文字、沒有檔名或題號 → partial", () => {
    const result = classifySourceTraceability(
      sourceInput({ sourceLocation: "校內試卷" }),
    );
    expect(result.status).toBe("partial");
    expect(result.codes).toContain("SOURCE_LOCATION_INCOMPLETE");
  });

  it("完全沒有來源資料 → unknown", () => {
    const result = classifySourceTraceability(sourceInput());
    expect(result.status).toBe("unknown");
    expect(result.codes).toContain("SOURCE_MISSING");
  });

  it("相同輸入產生相同結果（可重複比對）", () => {
    const input = sourceInput({
      sourceLocation: "課題1_MCQ.docx · 第 3 題",
    });
    expect(classifySourceTraceability(input)).toEqual(classifySourceTraceability(input));
  });
});

describe("解釋品質分類", () => {
  it("已知佔位文字（完整字串及模板）可被識別", () => {
    expect(isPlaceholderExplanation("答案依校內試題檔的評卷參考。")).toBe(true);
    expect(isPlaceholderExplanation("見課本。")).toBe(true);
    expect(classifyExplanation({
      explanation: "答案依校內試題檔的評卷參考。",
      correctAnswer: "1922",
      acceptedAnswers: [],
      options: [],
      hasHumanReview: false,
    }).class).toBe("placeholder");
  });

  it("只提到「參考答案」不等於佔位文字", () => {
    const explanation = "參考答案指出，凡爾賽條約要求德國承擔戰爭責任，因此加劇民族主義。";
    expect(isPlaceholderExplanation(explanation)).toBe(false);
    expect(
      classifyExplanation({
        explanation,
        correctAnswer: "凡爾賽條約",
        acceptedAnswers: [],
        options: [],
        hasHumanReview: false,
      }).class,
    ).toBe("not_assessed");
  });

  it("短但有說明性用語的解釋不會因長度被誤判", () => {
    const result = classifyExplanation({
      explanation: "工業革命促成城市化。",
      correctAnswer: "城市化",
      acceptedAnswers: [],
      options: [],
      hasHumanReview: false,
    });
    expect(result.class).toBe("not_assessed");
    expect(result.codes).not.toContain("EXPLANATION_SHORT_WITHOUT_REASONING");
  });

  it("很短且沒有說明性用語 → insufficient（啟發式，需覆核）", () => {
    const result = classifyExplanation({
      explanation: "工業革命",
      correctAnswer: "工業革命",
      acceptedAnswers: [],
      options: [],
      hasHumanReview: false,
    });
    // 解釋等於答案 → answer_only 先於長度判斷
    expect(result.class).toBe("answer_only");
    const short = classifyExplanation({
      explanation: "課堂內容",
      correctAnswer: "工業革命",
      acceptedAnswers: [],
      options: [],
      hasHumanReview: false,
    });
    expect(short.class).toBe("insufficient");
  });

  it("填充題只列出答案 → answer_only", () => {
    const result = classifyExplanation({
      explanation: "填充題答案（依空格次序）：(1) 社會、(2) 1922",
      correctAnswer: "1922",
      acceptedAnswers: [],
      options: [],
      hasHumanReview: false,
    });
    expect(result.class).toBe("answer_only");
  });

  it("選擇題解釋指出另一個選項 → potentially_inconsistent（只進入覆核）", () => {
    const result = classifyExplanation({
      explanation: "答案是十八世紀，因為啟蒙運動在十八世紀達到高峰。",
      correctAnswer: "十七世紀",
      acceptedAnswers: [],
      options: ["十七世紀", "十八世紀", "十九世紀", "二十世紀"],
      hasHumanReview: false,
    });
    expect(result.class).toBe("potentially_inconsistent");
    expect(result.codes).toContain("EXPLANATION_ANSWER_CONFLICT");
  });

  it("有人工覆核但解釋仍是佔位 → 標示 reviewed-but-low-quality，不當作合格", () => {
    const result = classifyExplanation({
      explanation: "答案依校內試題檔的評卷參考。",
      correctAnswer: "1922",
      acceptedAnswers: [],
      options: [],
      hasHumanReview: true,
    });
    expect(result.class).toBe("placeholder");
    expect(result.codes).toContain("EXPLANATION_REVIEWED_BUT_LOW_QUALITY");
  });
});

describe("元數據品質", () => {
  const base = {
    topicId: "topic-10",
    sectionId: "topic-10-coldwar-background",
    knowledgePoint: "A. 冷戰的背景與成因",
    difficulty: "basic",
    skill: null,
    topicExists: true,
    sectionExists: true,
    sectionTopicId: "topic-10",
    sectionTitles: SECTION_TITLES,
  };

  it("有效的知識點與關聯 → 只有技能警告", () => {
    const result = assessMetadata(base);
    expect(result.blocking).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(["SKILL_MISSING"]);
  });

  it("知識點排版殘留 → needs_review", () => {
    expect(isLayoutResidueKnowledgePoint("D. iii、iv")).toBe(true);
    expect(isLayoutResidueKnowledgePoint("A. 國家W")).toBe(true);
    const result = assessMetadata({ ...base, knowledgePoint: "D. iii、iv" });
    expect(result.issues.map((issue) => issue.code)).toContain("KNOWLEDGE_POINT_LAYOUT_RESIDUE");
  });

  it("通用標籤「校內試題」→ needs_review，不會被猜成某一分節", () => {
    const result = assessMetadata({ ...base, knowledgePoint: "校內試題" });
    expect(result.issues.map((issue) => issue.code)).toContain("KNOWLEDGE_POINT_GENERIC");
    expect(result.issues.map((issue) => issue.code)).not.toContain("KNOWLEDGE_POINT_UNMAPPED");
  });

  it("分節不存在或屬於其他課題 → blocking", () => {
    expect(assessMetadata({ ...base, sectionExists: false }).blocking).toBe(true);
    expect(assessMetadata({ ...base, sectionTopicId: "topic-9" }).blocking).toBe(true);
  });

  it("無效難度 → blocking", () => {
    expect(assessMetadata({ ...base, difficulty: "expert" }).blocking).toBe(true);
  });
});

describe("題目政策分類", () => {
  const traceable = classifySourceTraceability(
    sourceInput({
      sourceLocation: "教材.docx · 第 12 段（段落）",
      sourceBlockIds: ["blk-1"],
      sourceVerified: true,
      blockResolutions: [{ blockId: "blk-1", blockExists: true, documentExists: true }],
    }),
  );
  const pending = classifySourceTraceability(
    sourceInput({ sourceLocation: "課題1_MCQ.docx · 第 1 題" }),
  );
  const goodExplanation = classifyExplanation({
    explanation: "因為工業革命促成城市化，所以人口集中。",
    correctAnswer: "城市化",
    acceptedAnswers: [],
    options: [],
    hasHumanReview: false,
  });
  const placeholderExplanation = classifyExplanation({
    explanation: "答案依校內試題檔的評卷參考。",
    correctAnswer: "城市化",
    acceptedAnswers: [],
    options: [],
    hasHumanReview: false,
  });
  const metadataOk = assessMetadata({
    topicId: "topic-10",
    sectionId: "topic-10-coldwar-background",
    knowledgePoint: "A. 冷戰的背景與成因",
    difficulty: "basic",
    skill: "chronology",
    topicExists: true,
    sectionExists: true,
    sectionTopicId: "topic-10",
    sectionTitles: SECTION_TITLES,
  });

  it("隔離題目 → hard block，不可派發", () => {
    const policy = evaluateQuestionPolicy({
      teacherConfirmationRequired: true,
      servability: { ok: true },
      source: traceable,
      explanation: goodExplanation,
      metadata: metadataOk,
    });
    expect(policy.canServe).toBe(false);
    expect(policy.findings.map((finding) => finding.code)).toContain("TEACHER_CONFIRMATION_REQUIRED");
  });

  it("來源待核實 → teacher_review，但學生仍可作答（現行行為不變）", () => {
    const policy = evaluateQuestionPolicy({
      teacherConfirmationRequired: false,
      servability: { ok: true },
      source: pending,
      explanation: goodExplanation,
      metadata: metadataOk,
    });
    expect(policy.canServe).toBe(true);
    expect(policy.releasable).toBe(false);
    expect(policy.findings.map((finding) => finding.code)).toContain("SOURCE_PENDING_VERIFICATION");
  });

  it("佔位解釋 → policy_pending（不可當作通過）", () => {
    const policy = evaluateQuestionPolicy({
      teacherConfirmationRequired: false,
      servability: { ok: true },
      source: traceable,
      explanation: placeholderExplanation,
      metadata: metadataOk,
    });
    expect(policy.canServe).toBe(true);
    expect(policy.releasable).toBe(false);
    expect(policy.counts.policy_pending).toBe(1);
  });
});
