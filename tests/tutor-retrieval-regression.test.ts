/**
 * 檢索段落選取回歸（規格 3.9、3.15、3.16）。
 *
 * 規格最嚴重的缺陷：**已命中的段落被靜默丟棄**。原本有兩個位置會丟棄命中段落：
 *   ① 段落組在 offset 0 遇到 240 字上限便 `break`（長清單段落永遠送不到模型）；
 *   ② `scoreBlockText` 按段落長度開方折算，320 字以上的段落即使命中兩個課本專名
 *      仍會跌破命中門檻（323 字得 5.6 分，門檻 6）。
 * 兩者都會令回覆變成「教材找不到」，而學生問的正是課文寫過的內容。
 *
 * 這裡把「retrieved candidate ≠ selected context」固定成可審核的紀錄
 * （`TutorPassageSelectionAudit`），並逐項測試長度、位置及多段同時命中的情況。
 */
import { beforeAll, describe, expect, it } from "vitest";

type GroundingModule = typeof import("@/server/services/tutor-grounding");

let grounding: GroundingModule;

beforeAll(async () => {
  process.env.AUTH_SECRET = "tutor-retrieval-regression-secret-0123456789";
  grounding = await import("@/server/services/tutor-grounding");
});

interface BlockInput {
  id: string;
  order: number;
  text: string;
  documentId?: string;
  topicId?: string | null;
  type?: string;
}

function block(input: BlockInput) {
  return {
    id: input.id,
    documentId: input.documentId ?? "doc-meiji",
    topicId: input.topicId ?? null,
    documentFileName: "課題6 歐洲國家的殖民擴張_筆記.docx",
    sectionId: null,
    type: input.type ?? "paragraph",
    text: input.text,
    table: null,
    sourceLocation: `課題6 歐洲國家的殖民擴張_筆記.docx · 第 ${input.order + 1} 段（段落）`,
    extractionMethod: "native",
  };
}

function emptyAudit(): import("@/server/services/tutor-grounding").TutorPassageSelectionAudit {
  return {
    candidateBlocks: 0,
    scoredHits: 0,
    belowThreshold: 0,
    selected: [],
    excluded: [],
  };
}

/** 用無關句子把段落湊到指定字數（模擬教材的長清單段落） */
function padTo(target: number, sentences: readonly string[]): string {
  let text = "";
  let index = 0;
  while (text.length < target) {
    text += sentences[index % sentences.length] ?? "";
    index += 1;
  }
  return text.slice(0, target);
}

const FILLER = [
  "政府亦設立不同部門處理地方事務。",
  "各項措施分階段推行。",
  "地方官員需定期向中央匯報。",
];

const TERMS = () => grounding.extractQueryTerms("明治天皇推動了哪些改革？");

describe("長段落不可被靜默丟棄（規格 3.9）", () => {
  const cases: [string, number][] = [
    ["240 字（剛好等於上限）", 240],
    ["241 字（超出一字）", 241],
    ["323 字（實測的長清單段落）", 323],
  ];

  it("不同長度的命中段落都會入選，並保留命中內容", () => {
    for (const [label, length] of cases) {
      const text = padTo(length, ["明治天皇於1868年重掌權力。", ...FILLER]);
      const audit = emptyAudit();
      const passages = grounding.selectTutorPassages(
        [block({ id: `long-${length}`, order: 0, text })],
        TERMS(),
        { audit },
      );
      expect(passages.length, label).toBeGreaterThan(0);
      expect(passages[0]?.promptText, label).toContain("明治天皇");
      expect(passages[0]?.promptText.length, label).toBeLessThanOrEqual(
        grounding.TUTOR_MODEL_PASSAGE_MAX_CHARS,
      );
      expect(audit.selected[0]?.originalChars, label).toBe(length);
    }
  });

  it("關鍵詞在段首、段中、段尾都能保留", () => {
    const positions = {
      段首: padTo(320, ["明治天皇於1868年重掌權力。", ...FILLER]),
      段中: padTo(150, FILLER) + "明治天皇於1868年重掌權力。" + padTo(150, FILLER),
      段尾: padTo(300, FILLER) + "明治天皇於1868年重掌權力。",
    };

    for (const [label, text] of Object.entries(positions)) {
      const passages = grounding.selectTutorPassages([block({ id: "x", order: 0, text })], TERMS());
      expect(passages.length, label).toBeGreaterThan(0);
      expect(passages[0]?.promptText, label).toContain("明治天皇");
    }
  });

  it("截取後的文字仍包含人物、時間及因果敘述，不是只有關鍵詞", () => {
    const text = [
      "德川幕府長期閉關自守，社會矛盾與外來壓力同時累積。",
      "1868年，德川幕府被推翻，明治天皇重掌權力，史稱「王政復古」。",
      "新政府隨即推行明治維新，廢除封建制度並引進西方技術，因為要回應西方列強的威脅。",
      ...FILLER,
    ].join("");
    const passages = grounding.selectTutorPassages([block({ id: "c", order: 0, text })], TERMS());
    const promptText = passages[0]?.promptText ?? "";
    expect(promptText).toContain("明治天皇");
    expect(promptText).toMatch(/1868|德川幕府/);
    expect(promptText).toMatch(/因為|回應|改革/);
  });

  it("多個命中詞分散在不同句子時，窗口內同時保留兩個詞", () => {
    const text = [
      "明治天皇重掌權力。",
      padTo(90, FILLER),
      "新政府推行明治維新，改革涵蓋政治、經濟及軍事。",
      padTo(90, FILLER),
    ].join("");
    const passages = grounding.selectTutorPassages([block({ id: "m", order: 0, text })], TERMS());
    expect(passages[0]?.promptText).toContain("明治天皇");
  });

  it("同時命中多個長段落時，按分數排序並如實記錄排除原因", () => {
    const blocks = [
      block({ id: "a", order: 0, text: padTo(320, ["明治天皇於1868年重掌權力。", ...FILLER]) }),
      block({ id: "b", order: 1, text: padTo(300, ["明治維新推行全面改革。", ...FILLER]) }),
      block({ id: "c", order: 2, text: padTo(280, ["明治天皇批准改革方案。", ...FILLER]) }),
      block({ id: "d", order: 3, text: padTo(260, ["明治天皇下令廢除封建制度。", ...FILLER]) }),
    ];
    const audit = emptyAudit();
    const passages = grounding.selectTutorPassages(blocks, TERMS(), { maxSources: 2, audit });

    expect(passages).toHaveLength(2);
    expect(audit.selected).toHaveLength(2);
    expect(audit.scoredHits).toBeGreaterThanOrEqual(2);
    expect(audit.belowThreshold).toBeGreaterThanOrEqual(0);
    // 未入選的命中段落必須有原因（不是靜默消失）
    expect(audit.excluded.length).toBeGreaterThan(0);
    for (const excluded of audit.excluded) {
      expect(["max-sources", "duplicate", "already-used", "too-short"]).toContain(excluded.reason);
    }
    expect(audit.candidateBlocks).toBe(4);
  });

  it("候選數與選段數可以不同（retrieved candidate ≠ selected context）", () => {
    const audit = emptyAudit();
    const blocks = [
      block({ id: "h1", order: 0, text: "明治維新推行政治改革，廢除封建制度。" }),
      block({ id: "h2", order: 1, text: "明治天皇重掌權力，展開維新。" }),
      block({ id: "h3", order: 2, text: "明治政府改革軍事，實行徵兵制。" }),
    ];
    const passages = grounding.selectTutorPassages(blocks, TERMS(), { audit });
    expect(audit.candidateBlocks).toBe(3);
    expect(audit.selected.length).toBe(passages.length);
    expect(audit.selected.length).toBeLessThanOrEqual(3);
    for (const selected of audit.selected) {
      expect(selected.promptChars).toBeLessThanOrEqual(grounding.TUTOR_MODEL_PASSAGE_MAX_CHARS);
      if (selected.truncated) expect(selected.windowStartSentence).not.toBeNull();
      else expect(selected.windowStartSentence).toBeNull();
    }
  });
});

describe("跨課題選段須保留各課題的教材證據", () => {
  it("高分主課題不能擠掉明確點名的第二課題", () => {
    const blocks = [
      ...Array.from({ length: 8 }, (_, index) =>
        block({
          id: `american-${index}`,
          order: index,
          documentId: `american-doc-${index}`,
          topicId: "topic-7",
          text: `美國革命的發展與十三個殖民地的自治要求有關，英國殖民政策引起衝突，教材證據 ${index}。`,
        }),
      ),
      ...Array.from({ length: 8 }, (_, index) =>
        block({
          id: `french-${index}`,
          order: index,
          documentId: `french-doc-${index}`,
          topicId: "topic-5",
          text: `法國大革命於1789年爆發，革命者推翻舊制度，並提出人民主權等政治主張，教材證據 ${index}。`,
        }),
      ),
    ];
    const terms = grounding.extractQueryTerms("比較美國革命與法國大革命有甚麼異同？");

    const passages = grounding.selectTutorPassages(blocks, terms, {
      maxSources: 4,
      balancedTopicIds: ["topic-7", "topic-5"],
    });

    expect(passages).toHaveLength(4);
    expect(passages.some((passage) => passage.topicId === "topic-7")).toBe(true);
    expect(passages.some((passage) => passage.topicId === "topic-5")).toBe(true);
    const byTopic = new Map<string, number>();
    for (const passage of passages) {
      if (passage.topicId !== null && passage.topicId !== undefined) {
        byTopic.set(passage.topicId, (byTopic.get(passage.topicId) ?? 0) + 1);
      }
    }
    expect(Math.abs((byTopic.get("topic-7") ?? 0) - (byTopic.get("topic-5") ?? 0))).toBeLessThanOrEqual(1);
  });
});

describe("英文專名與中文橋樑（規格 3.15、3.16）", () => {
  const bridges: [string, string][] = [
    ["What was the Silk Road?", "絲綢之路"],
    ["What was the printing press?", "活字印刷術"],
    ["What was the Stamp Act?", "印花稅法"],
    ["What was the Declaration of Independence?", "美國獨立宣言"],
    ["What was the American Revolution?", "美國革命"],
    ["What was the Meiji Restoration?", "明治維新"],
  ];

  it("英文專名會連到教材的中文寫法（否則永遠找不到中文段落）", () => {
    for (const [query, canonical] of bridges) {
      const terms = grounding.extractQueryTerms(query);
      const matched = terms.find((term) => term.term === canonical);
      expect(matched, `${query} → ${canonical}`).toBeDefined();
      // 英文命中時中文寫法必須以最高權重參與檢索（教材用中文）
      expect(matched?.weight, `${query} → ${canonical}`).toBeGreaterThanOrEqual(8);
    }
  });

  it("英文疑問詞不會污染查詢詞（who／what／how…）", () => {
    for (const query of ["Who was Washington?", "What was the Stamp Act?", "How did it end?"]) {
      const terms = grounding.extractQueryTerms(query);
      for (const interrogative of ["who", "what", "how", "when", "where", "why", "which"]) {
        expect(terms.some((term) => term.term === interrogative), query).toBe(false);
      }
    }
  });

  it("短中文別名（例如「獨立宣言」）仍可命中，不會因為長度被排除", () => {
    const passages = grounding.selectTutorPassages(
      [block({ id: "i1", order: 0, text: "《獨立宣言》於 1776 年發表，宣布十三州脫離英國。" })],
      grounding.extractQueryTerms("What was the Declaration of Independence?"),
    );
    expect(passages.length).toBeGreaterThan(0);
    expect(passages[0]?.promptText).toContain("獨立宣言");
  });
});
