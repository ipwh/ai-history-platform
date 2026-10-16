/**
 * 自動品質閘門的能力與**限制**（Sprint 7.8 發行前審計，第 3 節）。
 *
 * 這份測試的目的不是證明「題目正確」，而是把閘門的行為寫成可執行的紀錄：
 *   1. 確定會被丟棄的個案（答案不唯一、教材不支持、解釋空洞、抄錄原文）；
 *   2. 會被保留但附警告的個案；
 *   3. 無法判斷而需要教師跟進的個案（本檔案以「目前行為」記錄，日後改善時會即時看到）；
 *   4. 明顯無法偵測的個案（純粹需要歷史專業判斷，例如史實前提錯誤、不同措辭但同樣
 *      說得通的錯誤選項）。
 *
 * 所有教材及題目都是合成的（不涉及真實教材內容）。
 */
import { describe, expect, it } from "vitest";

import { checkQuestionQuality, type QualityCandidate } from "@/server/llm/question-quality";
import { validateLlmQuestions } from "@/server/llm/validation";
import type { MaterialUnit } from "@/server/llm/provider";

/** 合成教材：同一段時間有年份及時期兩種說法（回報個案的結構） */
const UNITS: MaterialUnit[] = [
  {
    blockId: "audit-1453",
    sourceLocation: "合成教材 · 第 1 段",
    text: "公元1453年：中古時代結束，進入近代。",
  },
  {
    blockId: "audit-renaissance",
    sourceLocation: "合成教材 · 第 2 段",
    text: "中古時代前期（以神為本） | 文藝復興期間（以人為本）",
  },
];

function mc(overrides: Partial<QualityCandidate>): QualityCandidate {
  return {
    questionType: "mc",
    question: "合成題目？",
    options: ["康熙", "乾隆", "雍正", "嘉慶"],
    correctAnswer: "康熙",
    explanation: "合成解釋：合成教材記載康熙年間的事。",
    sourceExcerpt: "公元1453年：中古時代結束，進入近代。",
    sourceBlockIds: ["audit-1453"],
    ...overrides,
  };
}

describe("Mandatory regression case：題幹要「詞語」但答案是年份", () => {
  const MISSION_UNITS: MaterialUnit[] = [
    {
      blockId: "mission-1453",
      sourceLocation: "合成教材 · 第 1 段",
      text: "公元1453年：歐洲的中古時代結束，進入近代。",
    },
    {
      blockId: "mission-row",
      sourceLocation: "合成教材 · 第 2 段",
      text: "中古時代前期（以神為本） | 文藝復興期間（以人為本）",
    },
  ];

  it("任務指定的 1453 題（A 導火線／B 文藝復興期間／C 公元1453年／D 文藝復興前）會被丟棄", () => {
    const result = checkQuestionQuality(
      {
        questionType: "mc",
        question: "「歐洲的中古時代結束，進入近代」是指以下哪一個詞語？",
        options: ["導火線", "文藝復興期間", "公元1453年", "文藝復興前"],
        correctAnswer: "公元1453年",
        explanation: "合成解釋：合成教材以公元1453年標示中古時代的結束。",
        sourceExcerpt: "公元1453年：歐洲的中古時代結束，進入近代。",
        sourceBlockIds: ["mission-1453"],
      },
      MISSION_UNITS,
    );

    expect(result.ok).toBe(false);
    // 兩個獨立理由：題幹問「詞語」但答案是年份；時期選項在教材中同樣被連繫到同一件事
    const reasons = result.issues.map((issue) => issue.code);
    expect(reasons).toContain("stem-answer-type-mismatch");
    expect(reasons).toContain("ambiguous-options");
  });

  it("改寫為精確的年份題（並檢查所有錯誤選項）後可以通過", () => {
    const result = checkQuestionQuality(
      {
        questionType: "mc",
        // 明確問年份：與教材「公元1453年：…」的寫法一致
        question: "合成教材以哪一年標示歐洲中古時代的結束？",
        options: ["公元1453年", "公元476年", "公元800年", "公元1492年"],
        correctAnswer: "公元1453年",
        explanation: "合成解釋：合成教材以公元1453年標示中古時代的結束。",
        sourceExcerpt: "公元1453年：歐洲的中古時代結束，進入近代。",
        sourceBlockIds: ["mission-1453"],
      },
      MISSION_UNITS,
    );

    expect(result.issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("題幹問年份但標準答案不是年份時同樣丟棄（反向類型不符）", () => {
    const result = checkQuestionQuality(
      {
        questionType: "mc",
        question: "歐洲的中古時代在哪一年結束？",
        options: ["文藝復興期間", "導火線", "啟蒙運動", "新帝國主義"],
        correctAnswer: "文藝復興期間",
        explanation: "合成解釋：合成教材以文藝復興期間標示中古時代的結束。",
        sourceExcerpt: "中古時代前期（以神為本） | 文藝復興期間（以人為本）",
        sourceBlockIds: ["mission-row"],
      },
      MISSION_UNITS,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("stem-answer-type-mismatch");
  });
});

describe("會確定被丟棄的個案", () => {
  it("答案不唯一（同一段教材同時以年份及時期說明同一件事）", () => {
    const result = checkQuestionQuality(
      mc({
        question: "「中古時代結束，進入近代」是指以下哪一個詞語？",
        options: ["公元1453年", "文藝復興期間", "康熙", "乾隆"],
        correctAnswer: "公元1453年",
      }),
      UNITS,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "ambiguous-options")).toBe(true);
  });

  it("標準答案不在提供的教材之中（選擇題）", () => {
    const result = checkQuestionQuality(
      mc({ correctAnswer: "路易十四", options: ["路易十四", "路易十六", "拿破崙", "康熙"] }),
      UNITS,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === "answer-not-in-material")).toBe(true);
  });

  it("解釋空白或只是重複題幹", () => {
    expect(checkQuestionQuality(mc({ explanation: "" }), UNITS).ok).toBe(false);
    expect(
      checkQuestionQuality(mc({ explanation: "合成題目？" }), UNITS).ok,
    ).toBe(false);
  });
});

describe("只會提出警告的個案（保留給教師判斷）", () => {
  it("選項包含標準答案但並非等同（康熙／康熙與乾隆）", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "audit-kangxi",
        sourceLocation: "合成教材 · 第 3 段",
        text: "合成史料：康熙與乾隆均曾南巡。",
      },
    ];
    const result = checkQuestionQuality(
      mc({
        question: "合成史料提及哪位君主曾南巡？",
        options: ["康熙", "康熙與乾隆", "雍正", "嘉慶"],
        correctAnswer: "康熙",
        explanation: "合成解釋：合成史料記載康熙曾南巡。",
        sourceExcerpt: "合成史料：康熙與乾隆均曾南巡。",
        sourceBlockIds: ["audit-kangxi"],
      }),
      units,
    );

    // 「康熙與乾隆」不是完美答案（只有康熙正確），但題目仍可作答：
    // 保留並提示教師核對，而不是丟棄
    expect(result.ok).toBe(true);
    expect(result.issues.some((issue) => issue.severity === "warning")).toBe(true);
  });

  it("是非題（答案為「是／否」）一律 fail-closed：機器無法核對這種答案的教材依據", () => {
    // 「是」不會出現於教材，因此答案被視為沒有教材依據而丟棄。
    // 這是刻意的：是非題的正確性取決於整句陳述，確定性規則無法核對，
    // 與其讓未經核對的是非題被當成有明確答案，不如抽起交由教師處理。
    const result = checkQuestionQuality(
      mc({
        question: "合成教材指中古時代由公元1453年開始，對嗎？",
        options: ["對", "錯"],
        correctAnswer: "對",
        explanation: "合成解釋：合成教材提及公元1453年。",
      }),
      UNITS,
    );

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.severity === "blocking")).toBe(true);
  });
});

describe("目前無法偵測的個案（已知限制，需要教師或人手覆核）", () => {
  it("題幹前提錯誤但所有用字都見於教材（沒有可對照的不存在年份）", () => {
    // 「文藝復興是一場軍事擴張運動」是錯誤前提；答案「人文主義」確實見於教材，
    // 題幹用字亦全部出自教材，確定性規則無法判斷前提被扭曲
    const units: MaterialUnit[] = [
      {
        blockId: "audit-renaissance-def",
        sourceLocation: "合成教材 · 第 6 段",
        text: "文藝復興：以人文主義為核心的文化與思想革新運動，重視人的價值。",
      },
    ];
    const result = checkQuestionQuality(
      mc({
        question: "文藝復興是一場軍事擴張運動，其核心思想是甚麼？",
        options: ["人文主義", "重商主義", "軍國主義", "封建主義"],
        correctAnswer: "人文主義",
        explanation: "合成解釋：合成教材指文藝復興以人文主義為核心。",
        sourceExcerpt: "文藝復興：以人文主義為核心的文化與思想革新運動，重視人的價值。",
        sourceBlockIds: ["audit-renaissance-def"],
      }),
      units,
    );

    // 已知限制：題幹的錯誤前提需要歷史專業判斷
    expect(result.ok).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
  });

  it("錯誤選項本身在史實上說得通，但措辭與標準答案不同", () => {
    // 合成情況：答案「康熙」與錯誤選項「清聖祖」其實是同一人；措辭不同、
    // 沒有互相包含關係，規則無法判斷兩者等同
    const units: MaterialUnit[] = [
      {
        blockId: "audit-kangxi",
        sourceLocation: "合成教材 · 第 3 段",
        text: "康熙（清聖祖）在位期間推行多項政策。",
      },
    ];
    const result = checkQuestionQuality(
      mc({
        question: "合成教材提及哪位君主推行多項政策？",
        options: ["康熙", "清聖祖", "雍正", "嘉慶"],
        correctAnswer: "康熙",
        explanation: "合成解釋：合成教材記載康熙推行多項政策。",
        sourceExcerpt: "康熙（清聖祖）在位期間推行多項政策。",
        sourceBlockIds: ["audit-kangxi"],
      }),
      units,
    );

    // 這是已知限制：兩個名詞指同一人時，規則不會偵測出來
    expect(result.ok).toBe(true);
  });

  it("教材只在無關地方提到答案字串時，規則無法判斷是否真的支持答案（已知限制）", () => {
    // 教材既有「條約」的例子，也有完全無關的一句提及「條約」二字；
    // 字串比對只能證明「答案見於教材」，不能證明「這一段支持這個答案」
    const units: MaterialUnit[] = [
      {
        blockId: "audit-unsupported",
        sourceLocation: "合成教材 · 第 7 段",
        text: "工業革命：十八世紀中葉在英國展開的生產方式變革。",
      },
      {
        blockId: "audit-unrelated",
        sourceLocation: "合成教材 · 第 8 段",
        text: "簽訂條約後，兩國交換禮物以示友好。",
      },
    ];
    const result = checkQuestionQuality(
      mc({
        question: "合成教材最後提到哪一件外交行為？",
        options: ["條約", "戰爭", "貿易", "聯姻"],
        correctAnswer: "條約",
        explanation: "合成解釋：合成教材提及條約。",
        sourceExcerpt: "簽訂條約後，兩國交換禮物以示友好。",
        sourceBlockIds: ["audit-unrelated"],
      }),
      units,
    );

    // 這一題其實有教材支持；真正無法偵測的是「答案見於教材但所引段落不支持」的情況
    expect(result.ok).toBe(true);
  });

  it("因果主張未被教材支持時無法偵測（已知限制）", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "audit-cause",
        sourceLocation: "合成教材 · 第 9 段",
        text: "公元1453年：中古時代結束，進入近代。",
      },
    ];
    const result = checkQuestionQuality(
      mc({
        question: "中古時代結束的原因是甚麼？",
        options: ["公元1453年", "兩國交戰", "疫病流行", "宗教改革"],
        correctAnswer: "公元1453年",
        explanation: "合成解釋：合成教材以公元1453年標示中古時代的結束。",
        sourceExcerpt: "公元1453年：中古時代結束，進入近代。",
        sourceBlockIds: ["audit-cause"],
      }),
      units,
    );

    // 教材只提供一個年份（時間界線），並沒有交代「原因」；把年份當成原因是類型錯誤，
    // 但確定性規則只看到答案見於教材，因此這一題會被保留（需教師或專家判斷）
    expect(result.ok).toBe(true);
  });

  it("同類但不同的歷史概念（工業革命／產業革命）不會被當成重複答案", () => {    const units: MaterialUnit[] = [
      {
        blockId: "audit-industry",
        sourceLocation: "合成教材 · 第 4 段",
        text: "工業革命：十八世紀中葉在英國展開的生產方式變革。",
      },
    ];
    const result = checkQuestionQuality(
      mc({
        question: "十八世紀中葉在英國展開的生產方式變革稱為？",
        options: ["工業革命", "產業革命", "政治革命", "農業革命"],
        correctAnswer: "工業革命",
        explanation: "合成解釋：合成教材以工業革命稱之。",
        sourceExcerpt: "工業革命：十八世紀中葉在英國展開的生產方式變革。",
        sourceBlockIds: ["audit-industry"],
      }),
      units,
    );

    // 「產業革命」在部分文獻是同一件事的另一個譯名；規則無法判斷譯名等價，
    // 因此題目會被保留（教師需自行判斷選項是否互相等同）
    expect(result.ok).toBe(true);
  });

  it("有明確唯一答案的正常題目會被保留", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "audit-clear",
        sourceLocation: "合成教材 · 第 5 段",
        text: "合成條約：兩國於合成年簽訂，劃定邊界。",
      },
    ];
    const result = checkQuestionQuality(
      mc({
        question: "兩國在合成條約中劃定了甚麼？",
        options: ["邊界", "關稅", "語言", "貨幣"],
        correctAnswer: "邊界",
        explanation: "合成解釋：合成條約劃定邊界。",
        sourceExcerpt: "合成條約：兩國於合成年簽訂，劃定邊界。",
        sourceBlockIds: ["audit-clear"],
      }),
      units,
    );

    expect(result.ok).toBe(true);
    expect(result.issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
  });
});

describe("驗證層：無法判斷的個案不會被當成「確定無問題」", () => {
  it("品質閘門通過的題目不會因此獲得任何『已覆核』標記", () => {
    const units: MaterialUnit[] = [
      {
        blockId: "audit-clear",
        sourceLocation: "合成教材 · 第 5 段",
        text: "合成條約：兩國於合成年簽訂，劃定邊界。",
      },
    ];
    const result = validateLlmQuestions(
      {
        questions: [
          {
            questionType: "mc",
            difficulty: "basic",
            question: "兩國在合成條約中劃定了甚麼？",
            options: ["邊界", "關稅", "語言", "貨幣"],
            correctAnswerIndex: 0,
            correctAnswer: "邊界",
            explanation: "合成解釋：合成條約劃定邊界。",
            knowledgePoint: "合成知識點",
            sourceExcerpt: "合成條約：兩國於合成年簽訂，劃定邊界。",
            sourceBlockIds: ["audit-clear"],
            gradingPoints: [],
          },
        ],
      },
      {
        topicId: "topic-audit",
        sectionId: "topic-audit-section",
        questionTypes: ["mc"],
        difficulty: "basic",
        origin: "material-ai",
        units,
        now: "2026-01-01T00:00:00.000Z",
        idFor: (index) => `audit-${index}`,
      },
    );

    expect(result.accepted).toHaveLength(1);
    const accepted = result.accepted[0];
    // 驗證通過只代表機器檢查通過：題目仍是草稿，自動驗證欄位為空，
    // 由呼叫端（生成流程）另行記錄自動驗證，絕不會寫入人工覆核紀錄
    expect(accepted.status).toBe("draft");
    expect(accepted.autoValidatedAt).toBeNull();
  });
});
