/**
 * 教學品質閘門（Sprint 8.5）：以**版本控制、確定性**的樣本驗收語意檢查。
 *
 * 兩部分：
 *   1. `docs/teacher-review/question-quality-fixtures.v1.json` 的樣本個案：
 *      每個個案記錄教材樣本、題目、預期結果（保留／丟棄、閘門判定、觸發的問題代碼）
 *      及所測試的失敗模式；全部經 `validateLlmQuestions`（生成的唯一入口）驗證，
 *      確保測試與正式流程走同一條路徑。
 *   2. 流程層面的個案：有限次重寫、被丟棄的題目不會發布、未核對來源的節錄不會外洩、
 *      以及既有保護（發布關卡／學生端欄位）不受本 Sprint 影響。
 *
 * 全部使用合成教材與本地 stub provider（**不會**呼叫任何付費 AI 服務）。
 * 樣本集不是教師覆核過的黃金題庫（見檔案的 disclaimer）。
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("question-quality-gate");
process.env.LLM_PROVIDER = "mock";
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.AUTH_ADMIN_EMAILS = "admin@example.com";
delete process.env.ADMIN_TOKEN;
delete process.env.K_SERVICE;

type AnalysisModule = typeof import("@/server/llm/material-analysis");
type MaterialsRepo = typeof import("@/server/repositories/materials");
type QuestionService = typeof import("@/server/services/question-service");
type QuestionRepo = typeof import("@/server/repositories/questions");
type SeedModule = typeof import("@/server/seed");
type TopicsRepo = typeof import("@/server/repositories/topics");
type ValidationModule = typeof import("@/server/llm/validation");
type VisibilityModule = typeof import("@/server/services/source-visibility");

let analysisModule: AnalysisModule;
let materialsRepo: MaterialsRepo;
let questions: QuestionRepo;
let questionService: QuestionService;
let seed: SeedModule;
let topics: TopicsRepo;
let validation: ValidationModule;
let visibility: VisibilityModule;

interface FixtureRequest {
  questionType: "mc" | "fill";
  difficulty: "basic" | "advanced" | "challenge";
  question: string;
  options: string[];
  correctAnswerIndex: number | null;
  correctAnswer: string;
  explanation: string;
  knowledgePoint: string;
  sourceExcerpt: string;
  sourceBlockIds: string[];
  gradingPoints: string[];
}

interface FixtureCase {
  id: string;
  failureMode: string;
  materialSet: string;
  request: FixtureRequest;
  /** 對照組的個案 ID（acceptance 與 defective 互相對照）；沒有對照組時為 null */
  pairWith?: string | null;
  /** acceptable = 目前規則判定為 pass；defective = 預期會被攔下或暫緩 */
  polarity?: "acceptable" | "defective";
  /** 這個個案依據的教材原文（逐字） */
  evidence?: { blockId: string; quote: string };
  expected: {
    result: "accepted" | "discarded";
    outcome?: "pass" | "revise" | "reject";
    codesInclude?: string[];
    reasonContains?: string;
  };
  note: string;
}

interface FixtureFile {
  version: number;
  reviewStatus: string;
  materialSets: Record<
    string,
    { blockId: string; sectionId?: string; sourceLocation: string; text: string }[]
  >;
  cases: FixtureCase[];
  coverage?: { aspect: string; defective: string | null; acceptable: string | null }[];
}

const FIXTURE_PATH = path.join(
  "docs",
  "teacher-review",
  "question-quality-fixtures.v1.json",
);
const fixtures = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as FixtureFile;

/** 以個案的教材樣本建立驗證情境（與生成流程相同的欄位） */
function contextFor(fixtureCase: FixtureCase) {
  return {
    topicId: "topic-5",
    sectionId: "fx-section",
    sectionIds: ["fx-section"],
    questionTypes: ["mc", "fill"] as ("mc" | "fill")[],
    difficulty: "basic" as const,
    origin: "material-ai" as const,
    units: fixtures.materialSets[fixtureCase.materialSet]!.map((unit) => ({ ...unit })),
    now: "2026-01-01T00:00:00.000Z",
    idFor: (index: number) => `${fixtureCase.id}-${index}`,
  };
}

beforeAll(async () => {
  analysisModule = await import("@/server/llm/material-analysis");
  materialsRepo = await import("@/server/repositories/materials");
  questions = await import("@/server/repositories/questions");
  questionService = await import("@/server/services/question-service");
  seed = await import("@/server/seed");
  topics = await import("@/server/repositories/topics");
  validation = await import("@/server/llm/validation");
  visibility = await import("@/server/services/source-visibility");
  seed.ensureBootstrap();
});

afterAll(() => {
  delete process.env.LLM_PROVIDER;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_BASE_URL;
  delete process.env.LLM_MODEL;
});

describe("版本控制的教學品質樣本（docs/teacher-review/question-quality-fixtures.v1.json）", () => {
  it("樣本檔標明不是教師覆核的黃金題庫，並涵蓋 12 個以上的失敗模式", () => {
    expect(fixtures.version).toBe(1);
    expect(fixtures.reviewStatus).toBe("machine-fixtures-not-teacher-approved");
    expect(fixtures.cases.length).toBeGreaterThanOrEqual(12);
    expect(new Set(fixtures.cases.map((item) => item.id)).size).toBe(fixtures.cases.length);
    for (const fixtureCase of fixtures.cases) {
      expect(fixtureCase.failureMode.length).toBeGreaterThan(5);
      expect(fixtureCase.note.length).toBeGreaterThan(5);
      expect(fixtures.materialSets[fixtureCase.materialSet]).toBeDefined();
    }
  });

  it("對照組成對（acceptable ↔ defective）且每個個案都指出依據", () => {
    const byId = new Map(fixtures.cases.map((item) => [item.id, item]));
    let paired = 0;
    for (const fixtureCase of fixtures.cases) {
      // 每個個案都要標示 polarity 及 evidence（Sprint 8.5：樣本必須說明依據及預期失敗模式）
      expect(["acceptable", "defective"], `${fixtureCase.id} 的 polarity`).toContain(
        fixtureCase.polarity,
      );
      const evidence = fixtureCase.evidence;
      expect(evidence, `${fixtureCase.id} 缺少 evidence`).toBeDefined();
      const units = fixtures.materialSets[fixtureCase.materialSet]!;
      const block = units.find((unit) => unit.blockId === evidence!.blockId);
      expect(block, `${fixtureCase.id} 的 evidence.blockId 不在教材樣本中`).toBeDefined();
      // 依據必須逐字出現在該段落（樣本自身亦要通過「節錄逐字出自引用段落」的核對）
      expect(block!.text.includes(evidence!.quote), `${fixtureCase.id} 的依據不是逐字原文`).toBe(
        true,
      );

      // polarity 必須與預期結果一致，否則對照組會誤導讀者
      const expectedPass = fixtureCase.expected.result === "accepted" && fixtureCase.expected.outcome === "pass";
      expect(fixtureCase.polarity, `${fixtureCase.id} 的 polarity 與預期結果不符`).toBe(
        expectedPass ? "acceptable" : "defective",
      );

      const pair = fixtureCase.pairWith;
      if (pair === null || pair === undefined) continue;
      const partner = byId.get(pair);
      expect(partner, `${fixtureCase.id} 的對照組 ${pair} 不存在`).toBeDefined();
      expect(partner!.pairWith, `${fixtureCase.id} 與 ${pair} 的對照關係不對稱`).toBe(fixtureCase.id);
      expect(partner!.polarity, `${fixtureCase.id} 與對照組的 polarity 相同`).not.toBe(
        fixtureCase.polarity,
      );
      paired += 1;
    }
    // 至少一半個案屬對照組（另一半是獨立的失敗模式樣本）
    expect(paired).toBeGreaterThanOrEqual(10);
    expect(fixtures.coverage?.length ?? 0).toBeGreaterThanOrEqual(12);
  });

  it("每個樣本個案都得出預期結果（與生成流程走同一條驗證路徑）", () => {
    for (const fixtureCase of fixtures.cases) {
      // 短答題功能已移除：樣本中的短答題個案只保留作歷史記錄，不再走驗證路徑。
      if ((fixtureCase.request as { questionType?: string }).questionType === "short") continue;
      const context = contextFor(fixtureCase);
      const result = validation.validateLlmQuestions(
        { questions: [fixtureCase.request] },
        context,
      );

      if (fixtureCase.expected.result === "discarded") {
        expect(result.accepted, `${fixtureCase.id} 應被丟棄`).toHaveLength(0);
        if (fixtureCase.expected.reasonContains) {
          expect(
            result.discardedReasons.join(" "),
            `${fixtureCase.id} 的丟棄原因`,
          ).toContain(fixtureCase.expected.reasonContains);
        }
        continue;
      }

      expect(result.accepted, `${fixtureCase.id} 應被保留（原因：${result.discardedReasons.join("；")}）`).toHaveLength(1);
      const outcome = result.qualityOutcomes[0]!;
      expect(
        outcome.outcome,
        `${fixtureCase.id} 的閘門判定（實際提示：${outcome.notes.join("；")}）`,
      ).toBe(fixtureCase.expected.outcome);
      const notes = outcome.notes.join(" ");
      for (const code of fixtureCase.expected.codesInclude ?? []) {
        const keywords = EXPECTED_CODE_TEXT[code] ?? [code];
        expect(
          keywords.some((keyword) => notes.includes(keyword)),
          `${fixtureCase.id} 應包含 ${code} 的提示（實際：${notes}）`,
        ).toBe(true);
      }
      // 未通過（revise）的題目必須暫緩自動發布，不會靜默地給學生
      if (fixtureCase.expected.outcome !== "pass") {
        expect(
          result.accepted[0]!.teacherConfirmationRequired,
          `${fixtureCase.id} 應暫緩自動發布`,
        ).toBe(true);
      } else {
        expect(
          result.accepted[0]!.teacherConfirmationRequired,
          `${fixtureCase.id} 不應暫緩`,
        ).toBe(false);
      }
    }
  });

  it("樣本教材的分析結果與個案的教學意圖一致（確定性、可解釋）", () => {
    const bySet = new Map<string, ReturnType<typeof analysisModule.analyseMaterial>>();
    for (const [name, units] of Object.entries(fixtures.materialSets)) {
      bySet.set(name, analysisModule.analyseMaterial({ units: units.map((unit) => ({ ...unit })) }));
    }

    const causeAndEffect = bySet.get("cause-and-effect")!;
    expect(causeAndEffect.dimensions["cause-consequence"]).toBe(true);
    expect(causeAndEffect.dimensions.chronology).toBe(false); // 只有一個年份
    expect(causeAndEffect.limitations.map((item) => item.code)).toContain("single-dated-event");

    const single = bySet.get("single-statement")!;
    expect(single.dimensions["cause-consequence"]).toBe(false);
    expect(single.dimensions.comparison).toBe(false);
    expect(single.concepts.map((concept) => concept.term)).toContain("人文主義");

    const multi = bySet.get("multi-paragraph")!;
    expect(multi.dimensions["cause-consequence"]).toBe(true);
    expect(multi.documentCount).toBe(1);
    expect(multi.claims.length).toBeGreaterThanOrEqual(2);

    const ambiguous = bySet.get("ambiguous-date-versus-period")!;
    expect(ambiguous.events.map((event) => event.time)).toContain("公元1453年");
    expect(ambiguous.events[0]!.sortKey).toBe(1453);
  });

  it("分析結果會列明教材沒有交代的面向（不足時不假裝支援）", () => {
    const units = fixtures.materialSets["single-statement"]!.map((unit) => ({ ...unit }));
    const analysis = analysisModule.analyseMaterial({ units });
    const codes = analysis.limitations.map((item) => item.code);
    expect(codes).toContain("no-causal-relation");
    expect(codes).toContain("no-comparison-material");
    expect(codes).toContain("no-dated-events");
    // 提示詞段落必須把「不可考核」的面向寫給模型看
    const prompt = analysisModule.materialAnalysisPrompt(analysis);
    expect(prompt).toContain("沒有");
    expect(prompt).toContain("不可出");
  });
});

describe("語意檢查：因果、約數、推論與解釋（Sprint 8.5，確定性規則）", () => {
  /** 教材只**先後提及**兩件事，沒有交代因果（沒有因果標記詞） */
  const chronologyOnly = [
    {
      blockId: "fx-chron-1",
      sourceLocation: "合成教材 · 第 1 段（段落）",
      text: "十八世紀中葉，英國的棉織品產量大幅增加。其後，英國的鐵路網亦逐步建成。",
    },
  ];
  /** 教材並列三項因素，沒有交代哪一項最重要 */
  const parallelFactors = [
    {
      blockId: "fx-list-1",
      sourceLocation: "合成教材 · 第 2 段（清單）",
      text: "工業革命在英國展開的因素包括：豐富的煤鐵資源、海外的市場，以及穩定的政治環境。",
    },
  ];
  /** 教材以推測語氣交代（「相信」、「可能」） */
  const hedged = [
    {
      blockId: "fx-hedge-1",
      sourceLocation: "合成教材 · 第 3 段（段落）",
      text: "學者相信，這座城市的人口可能曾經超過五萬人。",
    },
  ];
  /** 教材只寫世紀，沒有明確年份 */
  const centuryOnly = [
    {
      blockId: "fx-century-1",
      sourceLocation: "合成教材 · 第 4 段（段落）",
      text: "十八世紀，工業革命率先在英國的紡織業展開。",
    },
  ];

  async function quality(
    candidate: Parameters<Awaited<typeof import("@/server/llm/question-quality")>["checkQuestionQuality"]>[0],
    units: { blockId: string; sourceLocation: string; text: string }[],
  ) {
    const { checkQuestionQuality } = await import("@/server/llm/question-quality");
    return checkQuestionQuality(candidate, units);
  }

  it("教材只交代先後，題目卻寫成因果 → 未確定（交教師確認）", async () => {
    const result = await quality(
      {
        questionType: "mc",
        question: "為甚麼英國的棉織品大量增產？",
        options: [
          "棉織品產量大幅增加",
          "棉織品產量大幅減少",
          "棉織品完全停止生產",
          "棉織品只供本地使用",
        ],
        correctAnswer: "棉織品產量大幅增加",
        explanation: "鐵路網建成，因此棉織品可以大量外銷。",
        sourceExcerpt: "十八世紀中葉，英國的棉織品產量大幅增加。",
        sourceBlockIds: ["fx-chron-1"],
      },
      chronologyOnly,
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("dimension-unsupported");
    expect(codes).toContain("unsupported-causation");
    expect(result.outcome).toBe("revise");
    expect(result.ok).toBe(true);
  });

  it("教材真的有因果交代時，因果題目不會被質疑", async () => {
    const result = await quality(
      {
        questionType: "mc",
        question: "為甚麼英國能夠大量生產棉織品？",
        options: [
          "英國擁有豐富的煤鐵資源與海外市場",
          "英國缺乏煤鐵資源",
          "英國沒有海外市場",
          "英國禁止使用機器生產",
        ],
        correctAnswer: "英國擁有豐富的煤鐵資源與海外市場",
        explanation: "教材指出英國的煤鐵資源與海外市場，令它可以大量生產並外銷棉織品。",
        sourceExcerpt: "由於英國擁有豐富的煤鐵資源與海外市場，因此能夠大量生產並外銷棉織品。",
        sourceBlockIds: ["fx-cause-1"],
      },
      fixtures.materialSets["cause-and-effect"]!.map((unit) => ({ ...unit })),
    );
    expect(result.issues.map((issue) => issue.code)).not.toContain("unsupported-causation");
    expect(result.outcome).toBe("pass");
  });

  it("「因此答案是…」的解題語不算因果斷言", async () => {
    const result = await quality(
      {
        questionType: "mc",
        question: "「重視古典學問並強調人的價值」是哪一種思想的特點？",
        options: ["人文主義", "重商主義", "封建制度", "君權神授"],
        correctAnswer: "人文主義",
        explanation: "教材指出人文主義強調人的價值與理性，並重視古典學問，因此答案是人文主義。",
        sourceExcerpt: "人文主義：一種強調人的價值與理性，並重視古典學問的思想。",
        sourceBlockIds: ["fx-single-1"],
      },
      fixtures.materialSets["single-statement"]!.map((unit) => ({ ...unit })),
    );
    expect(result.issues.map((issue) => issue.code)).not.toContain("unsupported-causation");
  });

  it("教材只寫世紀時，要求準確年份的題目 → 未確定", async () => {
    const result = await quality(
      {
        questionType: "mc",
        question: "工業革命在哪一年率先在英國的紡織業展開？",
        options: ["1740年", "1776年", "1801年", "1840年"],
        correctAnswer: "1740年",
        explanation: "教材把工業革命的開展放在十八世紀的英國紡織業。",
        sourceExcerpt: "十八世紀，工業革命率先在英國的紡織業展開。",
        sourceBlockIds: ["fx-century-1"],
      },
      centuryOnly,
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("approximate-date-overprecision");
    expect(result.issues.map((issue) => issue.message).join(" ")).toContain("沒有明確年份");
  });

  it("教材寫出明確年份時，年份題目可以通過這項檢查", async () => {
    const units = [
      {
        blockId: "fx-year-1",
        sourceLocation: "合成教材 · 第 5 段（段落）",
        text: "1914年，第一次世界大戰爆發。",
      },
    ];
    const result = await quality(
      {
        questionType: "fill",
        question: "第一次世界大戰在＿＿＿年爆發。",
        options: [],
        correctAnswer: "1914年",
        explanation: "教材把第一次世界大戰的爆發定在1914年，這是明確的年份。",
        sourceExcerpt: "1914年，第一次世界大戰爆發。",
        sourceBlockIds: ["fx-year-1"],
      },
      units,
    );
    expect(result.issues.map((issue) => issue.code)).not.toContain(
      "approximate-date-overprecision",
    );
  });

  it("教材只並列幾項因素時，不可斷言哪一項最重要", async () => {
    const result = await quality(
      {
        questionType: "mc",
        question: "以下哪一項是工業革命在英國展開的最重要因素？",
        options: ["豐富的煤鐵資源", "海外的市場", "穩定的政治環境", "英國的鐵路網"],
        correctAnswer: "豐富的煤鐵資源",
        explanation: "教材列出三項因素，其中煤鐵資源最重要。",
        sourceExcerpt: "工業革命在英國展開的因素包括：豐富的煤鐵資源、海外的市場，以及穩定的政治環境。",
        sourceBlockIds: ["fx-list-1"],
      },
      parallelFactors,
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("unsupported-evaluation");
    expect(result.outcome).toBe("revise");
  });

  it("教材自己寫了「最早」時，題目的「最早」不算無依據", async () => {
    const units = [
      {
        blockId: "fx-early-1",
        sourceLocation: "合成教材 · 第 6 段（段落）",
        text: "工業革命最早在英國的紡織業展開。",
      },
    ];
    const result = await quality(
      {
        questionType: "mc",
        question: "工業革命最早在哪一個行業展開？",
        options: ["紡織業", "採礦業", "鐵路業", "造船業"],
        correctAnswer: "紡織業",
        explanation: "教材指出工業革命最早在英國的紡織業展開。",
        sourceExcerpt: "工業革命最早在英國的紡織業展開。",
        sourceBlockIds: ["fx-early-1"],
      },
      units,
    );
    expect(result.issues.map((issue) => issue.code)).not.toContain("unsupported-evaluation");
  });

  it("教材只以推測語氣交代時，解釋不可寫成確定史實", async () => {
    const result = await quality(
      {
        questionType: "mc",
        question: "這座城市的人口有多少？",
        options: ["超過五萬人", "少於一千人", "完全沒有居民", "超過一百萬人"],
        correctAnswer: "超過五萬人",
        explanation: "這座城市的人口超過五萬人，是當時區內最大的城市。",
        sourceExcerpt: "學者相信，這座城市的人口可能曾經超過五萬人。",
        sourceBlockIds: ["fx-hedge-1"],
      },
      hedged,
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).toContain("asserted-inference");
    expect(codes).toContain("unsupported-evaluation");
  });

  it("解釋與題目、答案及節錄都無關時提出提示（不是丟棄）", async () => {
    const units = fixtures.materialSets["cause-and-effect"]!.map((unit) => ({ ...unit }));
    const result = await quality(
      {
        questionType: "mc",
        question: "為甚麼工業革命最早在英國展開？",
        options: ["豐富的煤鐵資源", "禁止海外貿易", "工匠拒絕使用機器", "缺乏可通航的河流"],
        correctAnswer: "豐富的煤鐵資源",
        // 與本題完全無關的解釋（貼錯內容）
        explanation: "文藝復興在意大利半島的城市共和國之中興起，重視古典學問與人的價值。",
        sourceExcerpt: "由於英國擁有豐富的煤鐵資源與海外市場，因此能夠大量生產並外銷棉織品。",
        sourceBlockIds: ["fx-cause-1"],
      },
      units,
    );
    expect(result.issues.map((issue) => issue.code)).toContain("explanation-off-topic");
    expect(result.outcome).toBe("revise");
  });

  it("專有名詞及短引文不應被當成抄錄（教學上必須使用教材用語）", async () => {
    const units = fixtures.materialSets["multi-paragraph"]!.map((unit) => ({ ...unit }));
    const result = await quality(
      {
        questionType: "mc",
        question: "列強在亞洲取得的「領事裁判權」是指甚麼？",
        options: [
          "列強得以用本國法律審理本國僑民",
          "列強可自由進出當地港口",
          "列強可以在當地駐軍",
          "列強可以徵收當地的關稅",
        ],
        correctAnswer: "列強得以用本國法律審理本國僑民",
        explanation: "教材指出取得領事裁判權之後，列強可用本國法律審理本國僑民，因此當地政府無法約束他們。",
        sourceExcerpt: "取得領事裁判權之後，列強得以用本國法律審理本國僑民，因此當地政府無法約束他們的行為，主權因而受損。",
        sourceBlockIds: ["fx-multi-2"],
      },
      units,
    );
    const codes = result.issues.map((issue) => issue.code);
    expect(codes).not.toContain("copied-source");
    expect(codes).not.toContain("excessive-verbatim");
    expect(result.outcome).toBe("pass");
  });
});

/** 問題代碼在提示訊息中的關鍵字（令斷言不依賴完整句子；同一代碼的不同分支可有多個關鍵字） */
const EXPECTED_CODE_TEXT: Record<string, string[]> = {
  "mechanical-deletion": ["沒有足夠線索"],
  "explanation-restates-answer": ["解釋"],
  "explanation-off-topic": ["答非所問"],
  "answer-not-in-material": ["未見於提供的教材", "教材語句的改寫"],
  "dimension-unsupported": ["教材沒有提供相應內容"],
  "unsupported-causation": ["沒有交代它們的因果關係"],
  "approximate-date-overprecision": ["沒有明確年份"],
  "asserted-inference": ["推測語氣"],
  "unsupported-evaluation": ["比較或排他寫法"],
  "excessive-verbatim": ["高度重疊"],
  "answer-incomplete": ["得分要點"],
};

describe("教學品質閘門：抄錄與解釋（確定性檢查）", () => {
  const units = fixtures.materialSets["cause-and-effect"]!.map((unit) => ({ ...unit }));

  it("非挖空題幹與教材句子高度重疊而沒有提問框架時提出提示（不是丟棄）", async () => {
    const { checkQuestionQuality } = await import("@/server/llm/question-quality");
    const result = checkQuestionQuality(
      {
        questionType: "mc",
        // 教材句子的近句照抄（只是少了開頭的時間），沒有加上任何提問框架
        question: "工業革命率先在英國的紡織業展開。",
        options: ["十八世紀中葉", "十七世紀初", "十九世紀末", "二十世紀初"],
        correctAnswer: "十八世紀中葉",
        explanation: "教材把工業革命的開展放在十八世紀中葉的英國紡織業，說明它是一個有時序的歷史事件。",
        sourceExcerpt: "十八世紀中葉，工業革命率先在英國的紡織業展開。",
        sourceBlockIds: ["fx-cause-1"],
      },
      units,
    );

    expect(result.ok).toBe(true); // 不是 blocking：只是教學品質提示
    expect(result.outcome).toBe("revise");
    expect(result.issues.map((issue) => issue.code)).toContain("excessive-verbatim");
  });

  it("題幹加上提問框架（試比較／為甚麼）時不視為抄錄", async () => {
    const { checkQuestionQuality } = await import("@/server/llm/question-quality");
    const result = checkQuestionQuality(
      {
        questionType: "mc",
        question: "試比較家庭手工業與工廠制度的生產方式。",
        options: ["家中生產與集中生產", "兩者完全相同", "兩者都沒有分工", "兩者都在農田生產"],
        correctAnswer: "家中生產與集中生產",
        explanation: "教材指出工廠制度取代家庭手工業，生產方式由家中轉為工廠集中生產。",
        sourceExcerpt: "工廠制度其後取代家庭手工業，導致工匠生計受到衝擊，工人於是組織工會爭取改善待遇。",
        sourceBlockIds: ["fx-cause-2"],
      },
      units,
    );

    expect(result.issues.map((issue) => issue.code)).not.toContain("excessive-verbatim");
  });

});

/**
 * 流程層面的個案：以**本地 HTTP stub**當作 provider（不需付費 API key、不會連外）。
 * `LLM_PROVIDER=openai-compatible` + `LLM_BASE_URL=http://127.0.0.1:<port>/v1`。
 */
describe("生成流程的有限次重寫與失敗處理", () => {
  let server: http.Server;
  let port = 0;
  let calls: { hasRevisionNotes: boolean; hasAnalysis: boolean }[] = [];
  let responder: (body: string) => unknown;
  /** 樣本教材的 blockId → 測試資料庫的實際 blockId */
  let blockIds = new Map<string, string>();
  /** 測試課題的教材分節 ID（由 seedFixtureTopic 建立） */
  let sectionId = "";

  /** 由版本控制的樣本檔取得個案（避免測試自行另寫一份題目） */
  function fixtureCase(id: string): FixtureCase {
    const found = fixtures.cases.find((item) => item.id === id);
    if (!found) throw new Error(`樣本檔找不到個案 ${id}`);
    return found;
  }

  /** 把樣本個案引用的合成 blockId 換成測試資料庫的實際 blockId */
  function withRealBlocks(id: string) {
    const request = fixtureCase(id).request;
    return {
      ...request,
      sourceBlockIds: request.sourceBlockIds.map((blockId) => blockIds.get(blockId) ?? blockId),
    };
  }

  /**
   * 建立測試用課題及教材：樣本教材（合成內容）寫入測試資料庫，
   * 另加一段其他分節的教材，令生成流程不會因為「教材太少」而拒絕生成。
   */
  function seedFixtureTopic(topicId: string, materialSet: string): void {
    const units = fixtures.materialSets[materialSet]!;
    sectionId = `${topicId}-section`;
    topics.seedTopicStructure({
      topic: {
        id: topicId,
        title: "合成測試課題",
        description: "教學品質閘門測試用（合成內容）",
        order: 90,
        published: true,
        level: 2,
        topicNumber: 5,
      },
      sections: [
        { id: sectionId, title: "合成分節（樣本教材）" },
        { id: `${topicId}-extra`, title: "合成分節（另一段教材）" },
      ],
    });
    const document = materialsRepo.createDocument({
      fileName: `合成教材 ${topicId}.docx`,
      kind: "demo",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: 2048,
      status: "ready",
      topicId,
      sourceNote: "Sprint 8.5 教學品質樣本（合成內容，非教科書原文）",
    });
    const blocks = materialsRepo.insertBlocks([
      ...units.map((unit, index) => ({
        documentId: document.id,
        topicId,
        sectionId,
        order: index,
        type: "paragraph" as const,
        level: null,
        text: unit.text,
        table: null,
        sourceLocation: unit.sourceLocation,
      })),
      {
        documentId: document.id,
        topicId,
        sectionId: `${topicId}-extra`,
        order: units.length,
        type: "paragraph" as const,
        level: null,
        text: "另一個分節的合成教材：古代文明以河流灌溉農業為基礎，其後發展出文字與城邦制度，這段文字只用於提供選擇題的干擾選項。",
        table: null,
        sourceLocation: "合成教材（另一分節） · 第 1 段（段落）",
      },
    ]);
    blockIds = new Map(units.map((unit, index) => [unit.blockId, blocks[index]!.id]));
  }

  beforeAll(async () => {
    server = http.createServer((request, response) => {
      let body = "";
      request.on("data", (chunk) => {
        body += String(chunk);
      });
      request.on("end", () => {
        calls.push({
          hasRevisionNotes: body.includes("上一輪生成的題目有以下問題"),
          hasAnalysis: body.includes("教材分析（由系統按教材原文整理"),
        });
        let status = 200;
        let payload: unknown;
        try {
          payload = responder(body);
        } catch (error) {
          status = 500;
          payload = { error: { message: error instanceof Error ? error.message : String(error) } };
        }
        response.writeHead(status, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: typeof payload === "string" ? payload : JSON.stringify(payload),
                },
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    port = typeof address === "object" && address !== null ? address.port : 0;
    process.env.LLM_PROVIDER = "openai-compatible";
    process.env.LLM_API_KEY = "stub-key";
    process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
    process.env.LLM_MODEL = "stub-model";
    process.env.LLM_ALLOW_MOCK_FALLBACK = "false";
    process.env.LLM_EMPTY_CONTENT_RETRIES = "0";
    process.env.AUTO_PUBLISH_VALIDATED_QUESTIONS = "true";
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    process.env.LLM_PROVIDER = "mock";
  });

  it("可修正的品質問題會觸發一次重寫（合共最多 2 次 provider 呼叫）", async () => {
    calls = [];
    const topicId = "fx-topic-quality";
    seedFixtureTopic(topicId, "cause-and-effect");
    const good = withRealBlocks("cause-and-effect-supported");
    const restating = {
      ...good,
      // 第一次回應：解釋只是重複標準答案 → 屬「機器可自行修正」的品質問題，觸發重寫
      explanation: good.correctAnswer,
    };
    responder = () => ({ questions: [calls.length === 1 ? restating : good] });

    const result = await questionService.generateQuestions({
      topicId,
      sectionIds: [sectionId],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
    });

    expect(calls.length).toBe(2);
    expect(calls[1]!.hasRevisionNotes).toBe(true);
    // 教材語意分析必須真的交給模型（不只是閘門自用），否則模型看不到教材的歷史意義
    expect(calls[0]!.hasAnalysis).toBe(true);
    expect(calls[1]!.hasAnalysis).toBe(true);
    expect(result.notice ?? "").toContain("重寫");
    // 重寫後的那一條（解釋說明推理）應可通過，不會被暫緩
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.explanation).toContain("教材指出");
    expect(
      result.questions[0]!.teacherConfirmationRequired,
      JSON.stringify({
        warnings: result.questions[0]!.qualityWarnings,
        notice: result.notice,
        stem: result.questions[0]!.question,
      }),
    ).toBe(false);
  });

  it("重寫後仍然不合格時保留為草稿（不會自動發布、不會無限重試）", async () => {
    calls = [];
    const topicId = "fx-topic-quality-2";
    seedFixtureTopic(topicId, "cause-and-effect");
    const good = withRealBlocks("cause-and-effect-supported");
    const restating = { ...good, explanation: good.correctAnswer };
    // 兩次回應都只是重複答案，沒有說明理由
    responder = () => ({ questions: [restating] });

    const result = await questionService.generateQuestions({
      topicId,
      sectionIds: [sectionId],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
    });

    // 成本控制：最多兩次呼叫，不會一直重試
    expect(calls.length).toBe(2);
    expect(result.questions[0]!.teacherConfirmationRequired).toBe(true);
    expect(result.questions[0]!.status).toBe("draft");
    expect(result.notice ?? "").toContain("教師");
  });

  it("重寫時 provider 失敗仍保留第一輪的題目（重寫是額外的嘗試）", async () => {
    calls = [];
    const topicId = "fx-topic-quality-rewrite-fail";
    seedFixtureTopic(topicId, "cause-and-effect");
    const good = withRealBlocks("cause-and-effect-supported");
    const restating = { ...good, explanation: good.correctAnswer };
    responder = () => {
      if (calls.length >= 2) throw new Error("stub provider failure on rewrite");
      return { questions: [restating] };
    };

    const result = await questionService.generateQuestions({
      topicId,
      sectionIds: [sectionId],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
    });

    expect(calls.length).toBe(2);
    // 第一輪的題目不會因為可選的重寫步驟失敗而消失，但必須暫緩自動發布
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0]!.teacherConfirmationRequired).toBe(true);
    expect(result.questions[0]!.status).toBe("draft");
    expect(result.notice ?? "").toContain("第一輪");
  });

  it("重新執行品質驗證不可釋放 `revise` 的暫緩標記（Sprint 8.5 修正的繞過路徑）", async () => {
    calls = [];
    const topicId = "fx-topic-quality-revalidate";
    seedFixtureTopic(topicId, "cause-and-effect");
    const good = withRealBlocks("cause-and-effect-supported");
    // 兩次回應都只是重複答案 → 判定 revise（可修正的教學品質問題）
    const restating = { ...good, explanation: good.correctAnswer };
    responder = () => ({ questions: [restating] });

    const generated = await questionService.generateQuestions({
      topicId,
      sectionIds: [sectionId],
      questionTypes: ["mc"],
      difficulty: "basic",
      questionCount: 1,
    });
    const held = generated.questions[0]!;
    expect(held.teacherConfirmationRequired).toBe(true);
    expect(held.status).toBe("draft");

    // 教師按「重新執行品質驗證」：機器檢查不通過（解釋只是重複答案），標記必須保留
    const revalidated = questionService.revalidateQuestion(held.id);
    expect(revalidated.autoValidated).toBe(false);
    expect(revalidated.qualityIssues.join(" ")).toContain("解釋");
    expect(questions.getQuestion(held.id)!.teacherConfirmationRequired).toBe(true);
    expect(questions.getQuestion(held.id)!.status).toBe("draft");

    // 因此不能經任何機器路徑發布（changeQuestionStatus 的發布關卡）
    expect(() => questionService.changeQuestionStatus(held.id, "published")).toThrowError(
      /無法發布/,
    );

    // 教師明確通過覆核（人工決定）才會清除標記並發布
    const reviewed = questionService.recordQuestionReview({
      questionId: held.id,
      decision: "approved",
      expectedRevision: held.revision,
      actor: { email: "teacher@example.com", role: "teacher" },
    });
    expect(reviewed.view.question.teacherConfirmationRequired).toBe(false);
    expect(reviewed.view.question.status).toBe("published");
  });

  it("被丟棄的題目不會寫入題庫，亦不會發布", async () => {
    calls = [];
    const topicId = "fx-topic-quality-3";
    seedFixtureTopic(topicId, "ambiguous-date-versus-period");
    // 樣本個案：答案不是唯一（教材同時以年份及時期說明同一件事）→ 屬 blocking，應被丟棄
    responder = () => ({ questions: [withRealBlocks("ambiguous-date-versus-period")] });

    await expect(
      questionService.generateQuestions({
        topicId,
        sectionIds: [sectionId],
        questionTypes: ["mc"],
        difficulty: "basic",
        questionCount: 1,
      }),
    ).rejects.toThrow(/未能生成合乎要求的題目/);

    expect(questions.listQuestions({ topicId })).toHaveLength(0);
  });

  it("provider 兩次都失敗時回報錯誤，不會留下半完成的題目", async () => {
    calls = [];
    const topicId = "fx-topic-quality-4";
    seedFixtureTopic(topicId, "cause-and-effect");
    responder = () => {
      throw new Error("stub provider failure");
    };

    await expect(
      questionService.generateQuestions({
        topicId,
        sectionIds: [sectionId],
        questionTypes: ["mc"],
        difficulty: "basic",
        questionCount: 1,
      }),
    ).rejects.toThrow();

    expect(questions.listQuestions({ topicId })).toHaveLength(0);
  });
});

describe("既有保護不受本 Sprint 影響（迴歸）", () => {
  it("未通過教材依據核對的題目，學生端仍然拿不到節錄", async () => {
    const question = questions.insertQuestion({
      id: "fx-unverified-1",
      topicId: "topic-1",
      sectionId: "topic-1-stone-age",
      questionType: "mc",
      difficulty: "basic",
      question: "合成問題：以下哪一項是測試項目？",
      options: ["甲", "乙", "丙", "丁"],
      correctAnswer: "甲",
      acceptedAnswers: [],
      explanation: "合成解釋：用於測試學生端的來源閘門。",
      knowledgePoint: "合成知識點",
      sourceExcerpt: "合成校內試題的節錄文字",
      sourceLocation: "SYNTH_QB_1.MCQ.docx · 第 1 題",
      sourceBlockIds: [],
      gradingPoints: [],
      origin: "school-paper",
      status: "published",
      sourceVerified: false,
      skill: null,
      qualityWarnings: [],
      autoValidatedAt: null,
      autoValidatedRevision: null,
      autoValidatedFingerprint: null,
      teacherConfirmationRequired: false,
      revision: 1,
      createdAt: new Date().toISOString(),
    });

    const view = visibility.studentExcerptVisibility(question);
    expect(view.visible).toBe(false);
    expect(view.reason).toBe("unverified-source");
  });

  it("發布關卡仍然要求覆核或自動驗證紀錄（品質閘門不會代替它們）", async () => {
    const question = questions.insertQuestion({
      id: "fx-no-review-1",
      topicId: "topic-1",
      sectionId: "topic-1-stone-age",
      questionType: "mc",
      difficulty: "basic",
      question: "合成問題：以下哪一項是合成答案？",
      options: ["合成甲", "合成乙", "合成丙", "合成丁"],
      correctAnswer: "合成甲",
      acceptedAnswers: [],
      explanation: "合成解釋：用於測試發布關卡。",
      knowledgePoint: "合成知識點",
      sourceExcerpt: "合成節錄",
      sourceLocation: "合成教材 · 第 1 段",
      sourceBlockIds: [],
      gradingPoints: [],
      origin: "manual",
      status: "draft",
      sourceVerified: false,
      skill: null,
      qualityWarnings: [],
      autoValidatedAt: null,
      autoValidatedRevision: null,
      autoValidatedFingerprint: null,
      teacherConfirmationRequired: false,
      revision: 1,
      createdAt: new Date().toISOString(),
    });

    expect(() =>
      questionService.changeQuestionStatus(question.id, "published"),
    ).toThrowError(/無法發布/);
  });
});
