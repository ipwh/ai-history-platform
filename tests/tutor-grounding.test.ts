import { beforeAll, describe, expect, it } from "vitest";

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
  });

  it("一般回答不會被誤判", () => {
    expect(groundingModule.answerDeclaresNotCovered("課本提到條約限制德國軍備。")).toBe(false);
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

    // 尚未確認版權：即使已標示開放，亦不可引用
    seedMaterial({
      documentId: "doc-unconfirmed",
      fileName: "課題9 兩次世界大戰_未確認版權.docx",
      kind: "demo",
      studentDistribution: 1,
      rightsConfirmedAt: null,
      texts: ["凡爾賽條約要求德國支付巨額賠款，此段來自未確認版權的文件。"],
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

  it("截圖中的簡體時序問題可找到文藝復興教材依據", () => {
    const grounding = groundingModule.findTutorGrounding(
      "文艺复兴中所有历史事件的顺序是什么",
    );
    expect(grounding.status).toBe("grounded");
    expect(grounding.topicId).toBe("topic-5");
    expect(grounding.sources.length).toBeGreaterThan(0);
    expect(grounding.passages.map((passage) => passage.promptText).join("\n")).toContain("人文主義");
  });

  it("校內試題檔及未確認版權的文件不會被引用", () => {
    const grounding = groundingModule.findTutorGrounding("凡爾賽條約如何約束德國？");
    const combined = grounding.passages.map((passage) => passage.promptText).join("\n");
    expect(combined).not.toContain("未確認版權");
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
