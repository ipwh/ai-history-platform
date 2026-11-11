import { beforeAll, describe, expect, it } from "vitest";

import { normalizeTutorQuery } from "@/server/services/tutor-query";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-grounding");
process.env.AUTH_SECRET = "tutor-grounding-secret-0123456789012345678";
process.env.AUTH_REQUIRE_SIGN_IN = "false";
process.env.BACKUP_ENABLED = "false";

type GroundingModule = typeof import("@/server/services/tutor-grounding");

let groundingModule: GroundingModule;
let getDb: typeof import("@/server/db/connection").getDb;

interface TestBlockInput {
  id: string;
  text: string;
  order: number;
  type?: string;
  documentId?: string;
  sectionId?: string | null;
}

function block(input: TestBlockInput) {
  return {
    id: input.id,
    documentId: input.documentId ?? "doc-a",
    documentFileName: "課題9 兩次世界大戰_筆記.docx",
    sectionId: input.sectionId ?? null,
    type: input.type ?? "paragraph",
    text: input.text,
    table: null,
    sourceLocation: `課題9 兩次世界大戰_筆記.docx · 第 ${input.order + 1} 段（段落）`,
    extractionMethod: "native",
  };
}

beforeAll(async () => {
  groundingModule = await import("@/server/services/tutor-grounding");
  getDb = (await import("@/server/db/connection")).getDb;
});

describe("學伴教材依據：查詢詞抽取", () => {
  it("課本專名取得最高權重，提問用語不會成為查詢詞", () => {
    const weights = new Map(
      groundingModule.extractQueryTerms("凡爾賽條約如何約束德國？").map((term) => [
        term.term,
        term.weight,
      ]),
    );
    expect(weights.get("凡爾賽條約")).toBe(8);
    expect(weights.has("如何")).toBe(false);
    expect(weights.has("甚麼")).toBe(false);
  });

  it("同義寫法會同時加入課本寫法，令教材原文搜得到", () => {
    // 「一戰」是教材寫法「第一次世界大戰」的簡稱
    const terms = groundingModule.extractQueryTerms("一戰的起因是甚麼？");
    const weightOf = (value: string) =>
      terms.find((term) => term.term === value)?.weight ?? 0;
    expect(weightOf("第一次世界大戰")).toBeGreaterThanOrEqual(8);
    expect(weightOf("一戰")).toBeGreaterThan(0);
  });

  it("類別詞會展開成教材用語（藝術家 → 藝術三傑）", () => {
    const terms = groundingModule.extractQueryTerms("列出文藝復興時期著名的藝術家");
    const weightOf = (value: string) =>
      terms.find((term) => term.term === value)?.weight ?? 0;
    expect(weightOf("藝術三傑")).toBeGreaterThanOrEqual(5);
  });

  it("決策 3：課程常見類別詞展開（極權主義／獨裁／統治者／措施）", () => {
    const weightOf = (message: string, value: string) =>
      groundingModule.extractQueryTerms(message).find((term) => term.term === value)?.weight ?? 0;

    expect(weightOf("乜嘢係極權主義？", "極權")).toBeGreaterThanOrEqual(5);
    expect(weightOf("乜嘢係極權主義？", "獨裁")).toBeGreaterThanOrEqual(5);
    expect(weightOf("獨裁者有甚麼特徵？", "極權")).toBeGreaterThanOrEqual(5);
    expect(weightOf("法國大革命期間的統治者是誰？", "君主")).toBeGreaterThanOrEqual(5);
    expect(weightOf("凡爾賽條約有甚麼措施？", "規定")).toBeGreaterThanOrEqual(5);
  });

  it("決策 3：「極權主義」可以召回教材寫成「獨裁統治」的段落", () => {
    const passages = groundingModule.selectTutorPassages(
      [
        block({ id: "g1", order: 0, text: "極權主義的特點" }),
        block({
          id: "g2",
          order: 1,
          text: "極權統治者以獨裁方式控制社會，禁止反對聲音，並嚴密監控人民的思想。",
        }),
      ],
      groundingModule.extractQueryTerms("乜嘢係極權主義？"),
    );
    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]?.promptText).toContain("獨裁");
  });

  it("決策 3：「發明家」可以召回教材寫成「學者」的段落", () => {
    const passages = groundingModule.selectTutorPassages(
      [
        block({
          id: "i1",
          order: 0,
          text: "科學革命強調運用科學方法，學者開始質疑傳統權威，天文學家以觀察驗證理論。",
        }),
      ],
      groundingModule.extractQueryTerms("列出科學革命有關的發明家"),
    );
    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]?.promptText).toContain("學者");
  });

  it("關鍵詞抽取：只取名詞類片段，不會產生跨詞噪音（2026-11-06）", () => {
    expect(groundingModule.extractDistinctiveTerms("法國為何參與了美國革命?")).toEqual(
      expect.arrayContaining(["法國", "美國革命"]),
    );
    // 舊版 n-gram 做法會產生「何參」「法國為」「要人」「算方」等噪音
    const noisy = groundingModule.extractDistinctiveTerms("法國為何參與了美國革命?");
    expect(noisy).not.toContain("何參");
    expect(noisy).not.toContain("法國為");
    // 疑問詞、功能字、常見動詞及抽象焦點詞一律不當作關鍵詞
    expect(groundingModule.extractDistinctiveTerms("文藝復興有甚麼重要人物?")).toEqual([
      "文藝復興",
    ]);
    expect(groundingModule.extractDistinctiveTerms("十三個殖民地為何反抗英國?")).toEqual(
      expect.arrayContaining(["殖民地", "英國"]),
    );
    expect(groundingModule.extractDistinctiveTerms("十三個殖民地為何反抗英國?")).not.toContain(
      "十三",
    );
    expect(groundingModule.extractDistinctiveTerms("點解?")).toEqual([]);
  });

  it("關鍵詞涵蓋判斷容許教材用較短寫法（伊斯蘭曆法 vs 伊斯蘭曆）", () => {
    expect(groundingModule.termCoveredBy("該年亦成為伊斯蘭曆的元年", "伊斯蘭曆法")).toBe(true);
    expect(groundingModule.termCoveredBy("美國革命激發歐洲的革命浪潮", "法國")).toBe(false);
  });

  it("提問的稀有關鍵詞會提高含該詞段落的分數（法國 → 含法國的段落）", () => {
    const blocks = [
      block({
        id: "e0",
        order: 0,
        documentId: "doc-e0",
        text: "美國革命的原因與美國革命的背景，以及美國革命的深遠影響。",
      }),
      block({
        id: "e1",
        order: 1,
        documentId: "doc-e1",
        text: "十七至十八世紀初，英國於北美洲東岸建立起十三個殖民地，並實施貿易管制。",
      }),
      block({
        id: "e2",
        order: 2,
        documentId: "doc-e2",
        text: "美國革命鼓舞法國人民，最終推翻君主專制，歐洲政局因而出現重大轉變。",
      }),
    ];
    const terms = groundingModule.extractQueryTerms("法國為何參與了美國革命?");
    const scoreOf = (
      passages: ReturnType<GroundingModule["selectTutorPassages"]>,
      blockId: string,
    ): number => passages.find((passage) => passage.anchorBlockId === blockId)?.score ?? 0;

    const withoutEmphasis = groundingModule.selectTutorPassages(blocks, terms, { maxSources: 3 });
    const withEmphasis = groundingModule.selectTutorPassages(blocks, terms, {
      maxSources: 3,
      emphasisTerms: ["法國"],
    });

    // 只加權「法國」所在的段落，其餘段落分數不變
    expect(scoreOf(withEmphasis, "e2")).toBeGreaterThan(scoreOf(withoutEmphasis, "e2"));
    expect(scoreOf(withEmphasis, "e0")).toBe(scoreOf(withoutEmphasis, "e0"));
  });

  it("「開埠」會展開成課題8 教材的寫法（自由港／割讓／侵佔）", () => {
    const weightOf = (value: string) =>
      groundingModule
        .extractQueryTerms("列出香港開埠的過程")
        .find((term) => term.term === value)?.weight ?? 0;

    expect(weightOf("自由港")).toBeGreaterThanOrEqual(5);
    expect(weightOf("割讓")).toBeGreaterThanOrEqual(5);
    expect(weightOf("侵佔")).toBeGreaterThanOrEqual(5);
  });

  it("錯一個字的專名會以課程寫法加入檢索詞（2026-11-02）", () => {
    const weights = new Map(
      groundingModule
        .extractQueryTerms("凡爾塞條約對德國有咩影響")
        .map((term) => [term.term, term.weight]),
    );
    expect(weights.get("凡爾賽條約")).toBeGreaterThanOrEqual(5);
  });

  it("命中同組任何寫法時，同組的中文寫法亦會加入檢索詞（2026-11-02）", () => {
    // 學生寫英文，教材寫中文：「Japanese occupation」→ 亦要有「日佔時期」等
    const weights = new Map(
      groundingModule
        .extractQueryTerms("Japanese occupation 期間香港發生咩事？")
        .map((term) => [term.term, term.weight]),
    );
    expect(weights.get("三年零八個月")).toBeGreaterThanOrEqual(5);
    expect(weights.get("日佔時期")).toBeGreaterThanOrEqual(5);
    expect(weights.get("日治時期")).toBeGreaterThanOrEqual(5);
  });

  /**
   * 2026-11-06 實測（人物／專名類提問）：
   * ① 「Who was George Washington?」把 `who` 當成世界衛生組織（WHO）的別名，
   *    檢索詞最高分變成「世界衛生組織」；
   * ② 英文問法只靠別名「華盛頓」（權重 5）命中，折算長度後低於命中門檻，
   *    整條提問變成「找不到教材依據」，而中文問法卻找得到。
   */
  it("英文疑問詞不會被當成專名別名（who 不等於世界衛生組織）", () => {
    const weights = new Map(
      groundingModule
        .extractQueryTerms("Who was George Washington?")
        .map((term) => [term.term, term.weight]),
    );
    expect(weights.has("世界衛生組織")).toBe(false);
    expect(weights.has("世衛")).toBe(false);
    expect(weights.get("喬治華盛頓")).toBeGreaterThanOrEqual(8);
  });

  it("人物類的中文別名以課程慣用寫法同權（姓名本身就是唯一線索）", () => {
    const weights = new Map(
      groundingModule
        .extractQueryTerms("Who was George Washington?")
        .map((term) => [term.term, term.weight]),
    );
    expect(weights.get("華盛頓")).toBeGreaterThanOrEqual(8);
    // 英文命中時，中文寫法是唯一的檢索橋樑，一律用語意改寫級（12）權重；
    // 中文提問時非人物類仍維持 5 分，避免「順帶提過」的段落被推前。
    const englishWeights = new Map(
      groundingModule
        .extractQueryTerms("Japanese occupation 期間香港發生咩事？")
        .map((term) => [term.term, term.weight]),
    );
    expect(englishWeights.get("日佔時期")).toBe(12);

    const chineseWeights = new Map(
      groundingModule
        .extractQueryTerms("日佔時期香港發生咩事？")
        .map((term) => [term.term, term.weight]),
    );
    // 中文提問時：課程慣用寫法 8 分，其餘中文別名 5 分（維持原有排序行為）
    expect(chineseWeights.get("三年零八個月")).toBe(8);
    expect(chineseWeights.get("日治時期")).toBe(5);
  });

  it("「香港開埠的過程」可以召回教材只寫「割讓」「自由港」的段落", () => {
    // 課題8 的溫習筆記全篇沒有「開埠」二字：寫的是「英國侵佔香港」及
    // 「割讓香港島／九龍半島」；若沒有類別詞展開，這段問題會一段都召回不到，
    // 學伴只能答「教材找不到」（2026-11-02 實際發生）。
    const passages = groundingModule.selectTutorPassages(
      [
        block({
          id: "k1",
          order: 0,
          text: "香港位於中國南部沿海，擁有水深良港。英國於1841年強佔香港島後，隨即宣布香港為自由港。",
        }),
        block({
          id: "k2",
          order: 1,
          text: "1842年，清政府與英國簽訂《南京條約》，被迫割讓香港島予英國。",
        }),
        block({
          id: "k3",
          order: 0,
          documentId: "doc-b",
          text: "文藝復興時期畫家開始採用透視法作畫，重視人體比例。",
        }),
      ],
      groundingModule.extractQueryTerms("列出香港開埠的過程"),
    );

    const combined = passages.map((passage) => passage.promptText).join("\n");
    expect(passages.length).toBeGreaterThan(0);
    expect(combined).toContain("自由港");
    expect(combined).toContain("割讓");
    expect(combined).not.toContain("透視法");
  });
});

describe("學伴教材依據：段落評分與段落組合併", () => {
  const terms = () => groundingModule.extractQueryTerms("凡爾賽條約如何約束德國？");

  it("與教材相關的段落得分明顯較高", () => {
    const relevant = groundingModule.scoreBlockText(
      "《凡爾賽條約》規定德國須限制軍隊數目，並支付巨額賠款。",
      terms(),
    );
    const irrelevant = groundingModule.scoreBlockText(
      "文藝復興時期畫家開始採用透視法作畫。",
      terms(),
    );
    expect(relevant.score).toBeGreaterThan(irrelevant.score);
    expect(relevant.strong).toBeGreaterThan(0);
  });

  it("命中段落會與相鄰段落合併成段落組，節錄不超過 60 字", () => {
    const passages = groundingModule.selectTutorPassages(
      [
        block({ id: "b1", order: 0, text: "凡爾賽條約的內容" }),
        block({
          id: "b2",
          order: 1,
          text: "《凡爾賽條約》規定德國須限制軍隊數目、放棄海外殖民地及支付巨額賠款，並承認發動戰爭的責任。",
        }),
        block({ id: "b3", order: 2, text: "條約亦設立國際聯盟，但美國最終沒有加入。" }),
      ],
      terms(),
    );

    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]?.promptText).toContain("巨額賠款");
    expect(passages[0]?.promptText.length).toBeLessThanOrEqual(
      groundingModule.TUTOR_MODEL_PASSAGE_MAX_CHARS,
    );
    expect(passages[0]?.excerpt.length).toBeLessThanOrEqual(
      groundingModule.TUTOR_STUDENT_EXCERPT_MAX_CHARS,
    );
    // 來源位置精簡為「第N段」，學生不需要看到整條檔名及匯入標記
    expect(passages[0]?.location).toMatch(/^第\d+段$/);
  });

  /**
   * 2026-11-06 實測：命中的段落是 323 字的清單（教材「明治天皇重掌權力……」那一段）。
   * 舊邏輯在 offset 0 便因長度上限 break，段落組只剩前面的鄰段——命中的句子完全沒有
   * 送去模型，`uncoveredTerms` 因此把「明治天皇」判成教材未涵蓋，回覆變成「教材找不到」。
   */
  it("命中段落本身超過長度上限時，仍會保留含檢索詞的句子", () => {
    const longBlock = [
      "1868年：德川幕府被推翻，明治天皇重掌權力，史稱「王政復古」。",
      "新政府隨即展開「明治維新」（1868-1912年），推行全面現代化改革，期望增強國力",
      "政治現代化：廢除封建制度，實行中央集權；建立君主立憲體制。",
      "經濟現代化：改革貨幣制度，引進西方技術及機器，發展工商業與鐵路。",
      "軍事現代化：實行徵兵制，建立現代化軍隊，並聘用外國教官訓練。",
      "社會現代化：廢除身分等級，推行普及教育，派遣留學生到歐美學習。",
    ].join("\n");

    const passages = groundingModule.selectTutorPassages(
      [
        block({ id: "m1", order: 0, text: longBlock }),
        block({ id: "m2", order: 1, text: "日本其後在甲午戰爭中擊敗中國。" }),
      ],
      groundingModule.extractQueryTerms("明治天皇推動了哪些改革？"),
    );

    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]?.promptText).toContain("明治天皇");
    expect(passages[0]?.promptText.length).toBeLessThanOrEqual(
      groundingModule.TUTOR_MODEL_PASSAGE_MAX_CHARS,
    );
  });

  it("練習題目及評分參考不會成為教材依據", () => {
    const passages = groundingModule.selectTutorPassages(
      [
        block({
          id: "x1",
          order: 0,
          text: "《凡爾賽條約》規定德國須支付巨額賠款及限制軍隊數目（3分）。",
        }),
      ],
      terms(),
    );
    expect(passages).toHaveLength(0);
  });

  it("圖片位置標示不會成為教材依據，行內標記亦會移除", () => {
    const passages = groundingModule.selectTutorPassages(
      [
        block({ id: "i1", order: 0, text: "凡爾賽條約的插圖", type: "image" }),
        block({
          id: "i2",
          order: 1,
          text: "《凡爾賽條約》規定德國須支付巨額賠款。圖片內容未能自動擷取",
        }),
        block({
          id: "i3",
          order: 2,
          text: "《凡爾賽條約》要求德國限制軍隊數目。[[IMAGE_UNEXTRACTED]]",
        }),
      ],
      terms(),
    );

    const combined = passages.map((passage) => passage.promptText).join("\n");
    expect(combined).toContain("限制軍隊數目");
    expect(combined).not.toContain("圖片內容未能自動擷取");
    expect(combined).not.toContain("IMAGE_UNEXTRACTED");
    expect(combined).not.toContain("插圖");
  });

  it("「列出藝術家」會取到教材的「藝術三傑」段落（類別詞展開）", () => {
    const passages = groundingModule.selectTutorPassages(
      [
        block({ id: "a1", order: 0, text: "文藝復興期間藝術發展蓬勃。" }),
        block({
          id: "a2",
          order: 1,
          text: "達文西、米開蘭基羅與拉斐爾被合稱為「藝術三傑」。",
        }),
      ],
      groundingModule.extractQueryTerms("列出文藝復興時期著名的藝術家"),
    );

    expect(passages.map((passage) => passage.promptText).join("\n")).toContain("藝術三傑");
  });

  it("提問點名的分節，其段落會優先於其他分節", () => {
    const text = "科學革命期間，學者提出多項新理論。";
    const passages = groundingModule.selectTutorPassages(
      [
        block({ id: "p1", order: 0, text }),
        block({ id: "p2", order: 1, text, sectionId: "topic-5-science-enlightenment" }),
      ],
      groundingModule.extractQueryTerms("科學革命有甚麼重要突破？"),
      { preferredSectionIds: ["topic-5-science-enlightenment"] },
    );

    expect(passages[0]?.anchorBlockId).toBe("p2");
  });

  it("「列出」類問題會優先取表格或清單段落", () => {
    const passages = groundingModule.selectTutorPassages(
      [
        block({ id: "e1", order: 0, type: "paragraph", text: "文藝復興時期的代表人物包括多位學者。" }),
        block({ id: "e2", order: 1, type: "table", text: "文藝復興時期的代表人物表。" }),
      ],
      groundingModule.extractQueryTerms("列出文藝復興時期的代表人物"),
      { enumerate: true },
    );

    expect(passages[0]?.anchorBlockId).toBe("e2");
  });
});

describe("學伴教材依據：課題推斷", () => {
  const topics = [
    { id: "topic-9", title: "課題9：20世紀的國際紛爭及危機(I)–兩次世界大戰" },
    { id: "topic-5", title: "課題5：近代歐洲的興起" },
  ];
  const sections = new Map([
    ["topic-9", [{ title: "兩次世界大戰的爆發", matchKeywords: ["極權主義"] }]],
    ["topic-5", [{ title: "文藝復興", matchKeywords: ["人文主義"] }]],
  ]);

  it("課程用語（分節關鍵詞）可通過主題硬閘", () => {
    const index = {
      topics,
      sectionsByTopic: new Map([
        ["topic-9", [{ id: "topic-9-interwar", title: "兩次大戰期間", matchKeywords: ["極權"] }]],
        ["topic-5", [{ id: "topic-5-renaissance", title: "文藝復興", matchKeywords: ["人文主義"] }]],
      ]),
    };
    expect(groundingModule.matchesCurriculumTerms(index, "我想知道極權主義的特點")).toBe(true);
    expect(
      groundingModule.matchesCurriculumTerms(index, "文艺复兴中所有历史事件的顺序是什么"),
    ).toBe(true);
    expect(groundingModule.matchesCurriculumTerms(index, "今天天氣如何")).toBe(false);
    expect(groundingModule.matchesCurriculumTerms(index, "幫我寫 Python")).toBe(false);
  });

  it("以課本專名推斷所屬課題", () => {
    expect(
      groundingModule.guessTutorTopic("凡爾賽條約如何約束德國？", topics, sections)?.topicId,
    ).toBe("topic-9");
  });

  it("簡體字提問可依繁體課程用語推斷課題及抽取教材查詢詞", () => {
    const message = "文艺复兴中所有历史事件的顺序是什么";
    expect(
      groundingModule.guessTutorTopic(message, topics, sections)?.topicId,
    ).toBe("topic-5");
    expect(
      groundingModule.extractQueryTerms(message).some((term) => term.term === "文藝復興"),
    ).toBe(true);
  });

  it("常見簡體歷史概念可抽取為課本慣用查詢詞", () => {
    const terms = groundingModule.extractQueryTerms("法西斯主义与纳粹主义有什么分别");
    const extracted = new Set(terms.map((term) => term.term));
    expect(extracted.has("法西斯主義")).toBe(true);
    expect(extracted.has("納粹主義")).toBe(true);
  });

  it("口語的成因、比較及排序用詞會展開成教材查詢詞", () => {
    const terms = (message: string) =>
      new Set(groundingModule.extractQueryTerms(message).map((term) => term.term));
    expect(terms("二戰點解會打起？").has("起因")).toBe(true);
    expect(terms("法西斯同納粹咩分別？").has("異同")).toBe(true);
    expect(terms("文藝復興所有事件順序係點？").has("時序")).toBe(true);
    expect(terms("點解？").has("起因")).toBe(false);
  });

  it("分節關鍵詞亦可推斷課題", () => {
    expect(
      groundingModule.guessTutorTopic("人文主義有甚麼特徵？", topics, sections)?.topicId,
    ).toBe("topic-5");
  });

  it("單一分節關鍵詞已足以定位課題（毋須依賴詞庫）", () => {
    const keywordSections = new Map([
      ["topic-3", [{ title: "歐亞貿易", matchKeywords: ["絲綢之路"] }]],
    ]);
    expect(
      groundingModule.guessTutorTopic(
        "絲綢之路對文化交流有甚麼影響？",
        [{ id: "topic-3", title: "課題3：伊斯蘭文明的興起與中古時代歐亞的文化交流" }],
        keywordSections,
      )?.topicId,
    ).toBe("topic-3");
  });

  it("無法判斷時不猜課題（避免用另一個課題的教材作答）", () => {
    expect(groundingModule.guessTutorTopic("今天天氣如何？", topics, sections)).toBeNull();
  });

  it("詞庫範疇寫錯時，教師維護的分節關鍵詞仍可把提問帶到正確課題（2026-11-02）", () => {
    // 重現：「聯合國喺戰後國際合作有咩角色？」原本因詞庫「聯合國」標為課題9 的
    // +10，壓過課題11 的分節「聯合國」+6，結果引用兩次世界大戰的教材。
    const index = {
      topics: [
        { id: "topic-9", title: "課題9：20世紀的國際紛爭及危機(I)–兩次世界大戰" },
        { id: "topic-11", title: "課題11：20世紀以來的國際合作" },
      ],
      sectionsByTopic: new Map([
        ["topic-9", [{ id: "topic-9-ww1", title: "第一次世界大戰的起因", matchKeywords: ["戰爭爆發"] }]],
        ["topic-11", [{ id: "topic-11-un", title: "國際組織與合作", matchKeywords: ["聯合國"] }]],
      ]),
    };
    expect(
      groundingModule.guessTutorTopic("聯合國喺戰後國際合作有咩角色？", index.topics, index.sectionsByTopic)
        ?.topicId,
    ).toBe("topic-11");
  });

  it("分節關鍵詞只差一個「的」仍可命中（4 字窗口，2026-11-02）", () => {
    expect(
      groundingModule.keywordMatchStrength("中國早期現代化努力有幾次改革", "中國早期的現代化努力"),
    ).toBe("window");
    expect(
      groundingModule.keywordMatchStrength("中國早期的現代化努力是甚麼", "中國早期的現代化努力"),
    ).toBe("exact");
    // 3 字以下不設窗口，避免「香港」「戰爭」在任何句子都命中
    expect(groundingModule.keywordMatchStrength("香港歷史", "香港")).toBe("exact");
    expect(groundingModule.keywordMatchStrength("九龍歷史", "香港")).toBeNull();
  });

  it("窗口命中可令少一個「的」的提問通過硬閘並定位課題", () => {
    const index = {
      topics: [{ id: "hs-topic-2", title: "課題2：中國的現代化與蛻變" }],
      sectionsByTopic: new Map([
        [
          "hs-topic-2",
          [
            {
              id: "hs-topic-2-early",
              title: "中國早期的現代化努力：改革與革命",
              matchKeywords: ["洋務運動"],
            },
          ],
        ],
      ]),
    };
    expect(
      groundingModule.matchesCurriculumTerms(index, "中國早期現代化努力有邊幾次改革？"),
    ).toBe(true);
    expect(
      groundingModule.guessTutorTopic(
        "中國早期現代化努力有邊幾次改革？",
        index.topics,
        index.sectionsByTopic,
      )?.topicId,
    ).toBe("hs-topic-2");
  });

  it("「課題12」不會被當成「課題1」（2026-11-02）", () => {
    const index = {
      topics: [
        { id: "topic-1", title: "課題1：人類的需要：古與今" },
        { id: "topic-12", title: "課題12：20世紀香港的成長與蛻變" },
      ],
      sectionsByTopic: new Map<string, { id: string; title: string; matchKeywords: string[] }[]>(),
    };
    expect(
      groundingModule.guessTutorTopic("課題12有咩內容？", index.topics, index.sectionsByTopic)
        ?.topicId,
    ).toBe("topic-12");
    expect(
      groundingModule.guessTutorTopic("課題1講咩？", index.topics, index.sectionsByTopic)?.topicId,
    ).toBe("topic-1");
  });

  it("同分時以分節關鍵詞為先（避免引用完全沒有該內容的課題）", () => {
    // 重現：「香港如何由轉口港發展成國際金融中心？」同時命中課題8（詞庫「轉口港」）
    // 及高中課題1（分節「國際金融中心」）各 10 分；「國際金融中心」只在高中教材出現。
    const index = {
      topics: [
        { id: "topic-8", title: "課題8：香港直至19世紀末的成長與發展" },
        { id: "hs-topic-1", title: "課題1：香港的現代化與蛻變" },
      ],
      sectionsByTopic: new Map([
        ["topic-8", [{ id: "topic-8-economy", title: "經濟與社會民生狀況", matchKeywords: ["轉口貿易"] }]],
        [
          "hs-topic-1",
          [{ id: "hs-topic-1-economy", title: "經濟發展：由轉口港到國際金融中心", matchKeywords: ["國際金融中心"] }],
        ],
      ]),
    };
    expect(
      groundingModule.guessTutorTopic(
        "香港如何由轉口港發展成國際金融中心？",
        index.topics,
        index.sectionsByTopic,
      )?.topicId,
    ).toBe("hs-topic-1");
  });
});

describe("學伴教材依據：課本用語對照", () => {
  it("教材寫法不產生提示", () => {
    expect(groundingModule.detectTermMismatches("希特拉於1933年出任德國總理。")).toEqual([]);
  });

  it("模型用了其他地區譯名時提示課本寫法", () => {
    expect(groundingModule.detectTermMismatches("希特勒於1933年出任德國總理。")).toEqual([
      { canonical: "希特拉", used: "希特勒" },
    ]);
  });

  it("較長專名的一部分不會被誤報", () => {
    expect(
      groundingModule.detectTermMismatches("第二次世界大戰在1939年爆發。"),
    ).toEqual([]);
  });

  it("課本用語表包含提問涉及的專名", () => {
    const glossary = groundingModule.buildTutorGlossary("topic-9", "希特拉如何崛起？");
    expect(glossary.map((term) => term.canonical)).toContain("希特拉");
  });

  it("課題8 的課本寫法是「英國侵佔香港」，回覆寫「開埠」時提示改用課本寫法", () => {
    expect(groundingModule.detectTermMismatches("香港在開埠後迅速發展成轉口港。")).toEqual([
      { canonical: "英國侵佔香港", used: "開埠" },
    ]);
  });

  it("學生用「開埠」提問時，課本用語表給出「英國侵佔香港」", () => {
    const glossary = groundingModule.buildTutorGlossary("topic-8", "列出香港開埠的過程");
    expect(glossary.map((term) => term.canonical)).toContain("英國侵佔香港");
  });
});

describe("學伴教材依據：回答自行說明未涵蓋", () => {
  it("回覆開首明說課本沒有提及", () => {
    expect(
      groundingModule.answerDeclaresNotCovered("課本這部分沒有提及；以下屬一般背景補充。"),
    ).toBe(true);
    expect(groundingModule.answerDeclaresNotCovered("教材並未涵蓋這個課題。")).toBe(true);
    expect(
      groundingModule.answerDeclaresNotCovered("我在教材中找不到這部分的內容，以下屬補充。"),
    ).toBe(true);
    expect(groundingModule.answerDeclaresNotCovered("教材片段中未見相關內容。")).toBe(true);
    // 常見的等義寫法（「提到」「並沒有提到」）仍要偵測得到
    expect(groundingModule.answerDeclaresNotCovered("課本沒有提到這條條款。")).toBe(true);
    expect(groundingModule.answerDeclaresNotCovered("教材並沒有提到這件事。")).toBe(true);
    expect(groundingModule.answerDeclaresNotCovered("筆記中並無相關說明。")).toBe(true);
  });

  it("一般回答不會被誤判", () => {
    expect(groundingModule.answerDeclaresNotCovered("課本提到條約限制德國軍備。")).toBe(false);
  });

  /**
   * 2026-11-06 實測：更正錯誤前提的開場（「教材片段並沒有把革命寫成…」）被舊規則
   * 當成「找不到教材」，令本來有四段教材依據的回覆降級並隱藏出處。
   */
  it("更正學生錯誤前提的開場，不算「找不到教材」", () => {
    expect(
      groundingModule.answerDeclaresNotCovered(
        "你的說法需要先更正：教材片段並沒有把美國革命寫成「英國加稅後立即爆發」。",
      ),
    ).toBe(false);
    expect(
      groundingModule.answerDeclaresNotCovered(
        "教材片段把它定於1775年，並沒有說是1776年開始。",
      ),
    ).toBe(false);
  });

  it("句中途才提及不算「未涵蓋」", () => {
    const answer = `${"你認為條約如何影響德國？".repeat(6)}課本沒有提及這點。`;
    expect(groundingModule.answerDeclaresNotCovered(answer)).toBe(false);
  });

  it("分兩部分作答、只有一部分未涵蓋時不會把整個回覆降級", () => {
    // 決策 4：只看「第一句」。第一句是開場白，後面的部分才提到找不到教材，
    // 因此不應把整個回覆降級（仍然顯示已對照的教材節錄）。
    const answer =
      "先分開兩點回應。**凡爾賽條約**：課本這部分沒有提及，以下屬一般背景補充。文藝復興則有教材依據。";
    expect(groundingModule.answerDeclaresNotCovered(answer)).toBe(false);
  });

  it("長開場白後才宣告找不到教材，仍會降級（第一句最多掃描 60 字）", () => {
    expect(
      groundingModule.answerDeclaresNotCovered(
        "先回應你的問題：凡爾賽條約的具體內容，我在教材片段中找不到。以下屬一般背景補充。",
      ),
    ).toBe(true);
    expect(
      groundingModule.answerDeclaresNotCovered(
        "你問的凡爾賽條約問題，在我們使用的課本裡我找不到相關內容。",
      ),
    ).toBe(true);
  });

  it("第一句已超過掃描長度時，句末的宣告不影響標示（避免長篇回覆整段降級）", () => {
    const longOpening = `${"這是一個較長的開場說明，".repeat(6)}我在教材片段中找不到。`;
    expect(groundingModule.answerDeclaresNotCovered(longOpening)).toBe(false);
  });
});

describe("學伴教材依據：提示詞", () => {
  const empty = {
    status: "not-covered" as const,
    topicId: null,
    topicTitle: null,
    sources: [],
    passages: [],
  };

  it("沒有教材片段時要求模型明說找不到，並禁止斷言課本沒有提及", () => {
    const prompt = groundingModule.buildTutorSystemPrompt({ grounding: empty });
    expect(prompt).toContain("我在教材中找不到這部分的內容");
    expect(prompt).toContain("不可斷言課本「沒有提及」");
    expect(prompt).not.toContain("【教材片段】以下是從本校教材檢索到的相關片段");
  });

  it("有教材片段時要求只可根據片段作答，並禁止自行標示出處", () => {
    const prompt = groundingModule.buildTutorSystemPrompt({
      grounding: {
        status: "grounded",
        topicId: "topic-9",
        topicTitle: "課題9：20世紀的國際紛爭及危機(I)–兩次世界大戰",
        sources: [],
        passages: [
          {
            anchorBlockId: "b2",
            documentId: "doc-a",
            documentLabel: "課題9 兩次世界大戰_筆記",
            location: "第2段",
            promptText: "《凡爾賽條約》規定德國須支付巨額賠款。",
            excerpt: "《凡爾賽條約》規定德國須支付巨額賠款。",
            score: 20,
          },
        ],
      },
      glossary: [{ canonical: "希特拉", aliases: ["希特勒"] }],
    });
    expect(prompt).toContain("唯一可用的事實依據");
    expect(prompt).toContain("《凡爾賽條約》規定德國須支付巨額賠款。");
    expect(prompt).toContain("不要輸出教材編號");
    expect(prompt).toContain("希特拉（不要寫希特勒）");
  });
});

describe("學伴教材依據：資料庫檢索（只使用已開放給學生的教材）", () => {
  function seedMaterial(input: {
    documentId: string;
    fileName: string;
    kind: string;
    studentDistribution: number;
    rightsConfirmedAt: string | null;
    texts: string[];
    topicId?: string;
  }): void {
    const db = getDb();
    const topicId = input.topicId ?? "topic-9";
    db.prepare(
      `INSERT INTO material_documents
         (id, file_name, kind, status, created_at, student_distribution, rights_confirmed_at)
       VALUES (?, ?, ?, 'ready', ?, ?, ?)`,
    ).run(
      input.documentId,
      input.fileName,
      input.kind,
      "2026-10-27T00:00:00.000+08:00",
      input.studentDistribution,
      input.rightsConfirmedAt,
    );
    input.texts.forEach((text, index) => {
      db.prepare(
        `INSERT INTO material_blocks
           (id, document_id, topic_id, section_id, sort_order, type, text, source_location, created_at, extraction_method)
         VALUES (?, ?, ?, NULL, ?, 'paragraph', ?, ?, ?, 'native')`,
      ).run(
        `${input.documentId}-b${index}`,
        input.documentId,
        topicId,
        index,
        text,
        `${input.fileName} · 第 ${index + 1} 段（段落）`,
        "2026-10-27T00:00:00.000+08:00",
      );
    });
  }

  beforeAll(() => {
    const db = getDb();
    const now = "2026-10-27T00:00:00.000+08:00";
    db.prepare(
      `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
       VALUES ('topic-9', '課題9：20世紀的國際紛爭及危機(I)–兩次世界大戰', '', 1, 9, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
       VALUES ('topic-5', '課題5：近代歐洲的興起', '', 1, 5, ?, ?)`,
    ).run(now, now);

    // 另一個課題的教材：用來驗證「上一輪的課題不會污染當前問題」
    seedMaterial({
      documentId: "doc-renaissance",
      fileName: "課題5 近代歐洲的興起_筆記.docx",
      kind: "demo",
      studentDistribution: 1,
      rightsConfirmedAt: now,
      topicId: "topic-5",
      texts: [
        "文藝復興的主要特點",
        "文藝復興復興古希臘、羅馬文明，重視人文主義及個人價值，藝術創作採用透視法。",
      ],
    });

    seedMaterial({
      documentId: "doc-notes",
      fileName: "課題9 兩次世界大戰_筆記.docx",
      kind: "demo",
      studentDistribution: 1,
      rightsConfirmedAt: "2026-10-27T00:00:00.000+08:00",
      texts: [
        "凡爾賽條約的內容",
        "《凡爾賽條約》規定德國須限制軍隊數目、放棄海外殖民地及支付巨額賠款，並承認發動戰爭的責任。",
        "條約亦設立國際聯盟，但美國最終沒有加入。",
      ],
    });

    // 校內試題檔：永不使用（問題與答案，不是課文）
    seedMaterial({
      documentId: "doc-paper",
      fileName: "課題9 兩次世界大戰_填充題.docx",
      kind: "question-bank",
      studentDistribution: 0,
      rightsConfirmedAt: "2026-10-27T00:00:00.000+08:00",
      texts: ["《凡爾賽條約》規定德國須支付巨額賠款（2分）。"],
    });

    // 尚未確認使用授權：即使已標示開放，亦不可引用
    seedMaterial({
      documentId: "doc-unconfirmed",
      fileName: "課題9 兩次世界大戰_未確認使用授權.docx",
      kind: "demo",
      studentDistribution: 1,
      rightsConfirmedAt: null,
      texts: ["凡爾賽條約要求德國支付巨額賠款，此段來自未確認使用授權的文件。"],
    });
  });

  it("找到教材段落並提供出處", () => {
    const grounding = groundingModule.findTutorGrounding("凡爾賽條約如何約束德國？");
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("topic-9");
    expect(grounding.sources.length).toBeGreaterThan(0);
    expect(grounding.sources[0]?.documentLabel).toContain("課題9");
    expect(grounding.sources[0]?.location).toMatch(/^第\d+段$/);
    expect(grounding.sources[0]?.excerpt.length).toBeLessThanOrEqual(60);
  });

  it("口語提問正規化後仍可找到凡爾賽條約教材依據", () => {
    const grounding = groundingModule.findTutorGrounding(
      normalizeTutorQuery("凡爾賽條約點罰德國㗎"),
    );
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("topic-9");
    expect(grounding.passages.map((passage) => passage.promptText).join("\n")).toContain("賠款");
  });

  it("截圖中的簡體時序問題可找到文藝復興教材依據", () => {
    const grounding = groundingModule.findTutorGrounding(
      "文艺复兴中所有历史事件的顺序是什么",
    );
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("topic-5");
    expect(grounding.sources.length).toBeGreaterThan(0);
    expect(grounding.passages.map((passage) => passage.promptText).join("\n")).toContain("人文主義");
  });

  it("校內試題檔及未確認使用授權的文件不會被引用", () => {
    const grounding = groundingModule.findTutorGrounding("凡爾賽條約如何約束德國？");
    const combined = grounding.passages.map((passage) => passage.promptText).join("\n");
    expect(combined).not.toContain("未確認使用授權");
    expect(combined).not.toContain("2分");
    expect(
      grounding.sources.every((source) => source.documentLabel.includes("筆記")),
    ).toBe(true);
  });

  it("教材沒有相關內容時回報「未涵蓋」，不會假裝有依據", () => {
    const grounding = groundingModule.findTutorGrounding("伊斯蘭曆法的計算方法是甚麼？");
    expect(grounding.status).toBe("not-covered");
    expect(grounding.sources).toHaveLength(0);
  });

  it("關鍵詞已涵蓋時 uncoveredTerms 為空（不會多花一次外部搜尋）", () => {
    const grounding = groundingModule.findTutorGrounding("凡爾賽條約如何約束德國？");
    expect(grounding.status).toBe("grounded");
    expect(grounding.uncoveredTerms).toEqual([]);
  });

  it("教材命中但提問的關鍵詞不在段落中時，uncoveredTerms 如實列出", () => {
    // 「芬蘭」不在課題9 的教材中：仍然引用《凡爾賽條約》的段落，但要指出關鍵詞缺口，
    // 令 API 即使在 not-covered-only 模式下仍會抓取外部參考（2026-11-06）。
    const grounding = groundingModule.findTutorGrounding("凡爾賽條約對芬蘭有甚麼影響？");
    expect(grounding.status).toBe("grounded");
    expect(grounding.uncoveredTerms).toContain("芬蘭");
  });

  it("上一輪問文藝復興，不會令本輪的凡爾賽條約引用課題5 教材", () => {
    const grounding = groundingModule.findTutorGrounding("凡爾賽條約如何約束德國？", [
      "文藝復興及工業革命有沒有關係？",
      "列出文藝復興時期著名的藝術家",
    ]);

    expect(grounding.topicId).toBe("topic-9");
    const combined = grounding.passages.map((passage) => passage.promptText).join("\n");
    expect(combined).not.toContain("透視法");
    expect(
      grounding.sources.every((source) => source.documentLabel.includes("課題9")),
    ).toBe(true);
  });

  it("短跟進（沒有課題線索）仍可借助上一輪提問定位課題", () => {
    const grounding = groundingModule.findTutorGrounding("點解？", ["凡爾賽條約如何約束德國？"]);
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("topic-9");
  });
});

describe("學伴教材依據：語意改寫詞（extraTerms）", () => {
  beforeAll(() => {
    const db = getDb();
    const now = "2026-11-02T00:00:00.000+08:00";
    db.prepare(
      `INSERT INTO topics (id, title, description, published, sort_order, created_at, updated_at)
       VALUES ('topic-8', '課題8：香港直至19世紀末的成長與發展', '', 1, 8, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO material_documents
         (id, file_name, kind, status, created_at, student_distribution, rights_confirmed_at)
       VALUES ('doc-hk-notes', '課題8 香港直至十九世紀末的成長與發展_筆記.docx', 'demo', 'ready', ?, 1, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO material_blocks
         (id, document_id, topic_id, section_id, sort_order, type, text, source_location, created_at, extraction_method)
       VALUES ('doc-hk-notes-b0', 'doc-hk-notes', 'topic-8', NULL, 0, 'paragraph', ?, ?, ?, 'native')`,
    ).run(
      "香港位於中國南部沿海，擁有水深良港。英國於1841年強佔香港島後，隨即宣布香港為自由港。",
      "課題8 香港直至十九世紀末的成長與發展_筆記.docx · 第 1 段（段落）",
      now,
    );
    // 分節關鍵詞：改寫詞可能正是它，令「完全沒有課題線索」的提問也能定位課題
    db.prepare(
      `INSERT INTO sections (id, topic_id, parent_id, title, summary, match_keywords_json, sort_order, created_at, updated_at)
       VALUES ('topic-8-freeport', 'topic-8', NULL, '自由港', '', '["自由港"]', 1, ?, ?)`,
    ).run(now, now);
  });

  it("改寫詞以固定權重併入，不會降低既有查詢詞的權重", () => {
    const merged = groundingModule.withExpandedTerms(
      [
        { term: "開埠", weight: 5 },
        { term: "藝術三傑", weight: 20 },
      ],
      ["自由港", "藝術三傑", "甚麼"],
    );

    expect(merged.find((term) => term.term === "自由港")?.weight).toBe(
      groundingModule.TUTOR_EXPANSION_TERM_WEIGHT,
    );
    expect(merged.find((term) => term.term === "藝術三傑")?.weight).toBe(20);
    expect(merged.some((term) => term.term === "甚麼")).toBe(false);
  });

  it("字詞檢索失敗時，改寫詞可令同一條提問找到教材", () => {
    // 教材只寫「自由港」，學生的問法是「港口…開放」（字面完全不重疊）：
    // 這正是語意改寫要補的漏洞，見 services/tutor-query-expansion.ts。
    const message = "點樣睇嗰個港口嘅開放安排？";

    expect(
      groundingModule.findTutorGrounding(message, [], undefined, {
        preferredTopicId: "topic-8",
      }).status,
    ).toBe("not-covered");

    const expanded = groundingModule.findTutorGrounding(message, [], undefined, {
      preferredTopicId: "topic-8",
      extraTerms: ["自由港"],
    });
    expect(expanded.status).toBe("grounded");
    expect(expanded.passages.map((passage) => passage.promptText).join("\n")).toContain("自由港");
  });

  it("完全沒有課題線索時，改寫詞亦可令課題推斷成功", () => {
    const message = "點樣睇嗰個港口嘅安排？";
    expect(groundingModule.findTutorGrounding(message).status).toBe("not-covered");

    const expanded = groundingModule.findTutorGrounding(message, [], undefined, {
      extraTerms: ["自由港"],
    });
    expect(expanded.status).toBe("grounded");
    expect(expanded.topicId).toBe("topic-8");
  });

  it("改寫詞不會令無關段落成為依據", () => {    const grounding = groundingModule.findTutorGrounding(
      "點樣睇嗰個港口嘅開放安排？",
      [],
      undefined,
      { preferredTopicId: "topic-8", extraTerms: ["文藝復興"] },
    );
    expect(grounding.status).toBe("not-covered");
  });
});
