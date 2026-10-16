/**
 * 校內試題解析與匯入測試。
 *
 * 驗證：
 *   1. 七種試題檔的結構化格式解析（選擇／填充／是非／配對／時序／長題／資料題）。
 *   2. 答案忠實取自檔案的答案區（不會猜測）；格式不完整時略過並記錄原因。
 *   3. 平台未支援的題型（配對、時序）不會被硬塞成其他題型。
 *   4. 匯入後題目為草稿、來源標示為校內試題、分節依關鍵詞對應。
 *   5. 不考核範圍（課題1 新月沃土／黃河、長江流域／印度河）的題目不會匯入，古埃及文明的題目可以匯入。
 *   6. 重複匯入不會產生重複題目。
 */
import { beforeAll, describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("qbank");
process.env.LLM_PROVIDER = "mock";
delete process.env.ADMIN_TOKEN;

type BankModule = typeof import("@/server/materials/question-bank");
type ImportService = typeof import("@/server/services/question-bank-import-service");
type Seed = typeof import("@/server/seed");
type MaterialService = typeof import("@/server/services/material-service");
type QuestionRepo = typeof import("@/server/repositories/questions");
type SectionTopicRepo = typeof import("@/server/repositories/topics");

let bank: BankModule;
let importService: ImportService;
let seed: Seed;
let questions: QuestionRepo;
let topicsRepo: SectionTopicRepo;
let materialService: MaterialService;

const MCQ_TEXT = `選擇題
A. 石器時代的演進
[[JTH2ndEdMCQ01001
最早的人類在甚麼時候出現？
@O
約五百萬年前
約七百萬年前
約二百萬年前
約一萬年前
❒
##
B
@@
{{}}
d:0;
t:mc; nil:1
]]
[[JTH2ndEdMCQ01002
人類學家推斷最早的人類在哪裏出現？
@O
A. 亞洲
B. 非洲
C. 美洲
D. 歐洲
❒
##
B
@@
{{}}
d:0;
t:mc; nil:1
]]`;

const FBQ_TEXT = `填充題
[[JTH2ndEdFBQ01001
古人類最早在 _______________出現，其後遷徙至亞洲及歐洲。
##
非洲
@@
{{}}
t:fb; nil:1
]]
[[JTH2ndEdFBQ01002
_______________是文字出現前，沒有文字紀錄的時期。_______________是文字出現後，擁有文字紀錄的時期。
##
史前時期；信史時期
@@
{{}}
t:fb; nil:2
]]`;

const TFQ_TEXT = `是非題
[[JTH2ndEdTFQ01001
古人類最早於北美洲出現，其後遷徙至亞洲及歐洲。________
##
非
古人類最早於非洲出現，其後遷徙至亞洲及歐洲。
@@
t:sq; nil:1
]]
[[JTH2ndEdTFQ01002
石器時代屬於史前時期。________
##
是
@@
t:sq; nil:1
]]`;

const MUQ_TEXT = `配對題
[[JTH2ndEdMUQ01001
甲欄
乙欄
舊石器時代
□
文字出現前
新石器時代
□
文字出現後
##
(a)(iii)；(b)(iv)
@@
t:mg; nil:5
]]`;

const LAQ_TEXT = `長題目
[[JTH2ndEdLAQ01001
文字最早在何時發明？文字的發明對歷史的劃分有甚麼影響？（3分）
@O
______________________
##
它約於公元前3200年發明。（1分）歷史學家會根據文字發明的時間，將沒有文字紀錄的時期劃分為史前時期。（2分）
@@
t:sq; nil:1
]]`;

const DBQ_TEXT = `資料題
[[JTH2ndEdDBQ01001
根據下列資料，回答有關問題。
b
資料I：《安妮日記》由德國籍荷蘭猶太女孩安妮．法蘭克撰寫。
試根據史料出產的時代，順序排列三項資料。（3分）
______________________
##
事件一。（1分）事件二。（2分）
@@
t:nil; nil:1
]]`;

const PIPE_MCQ_TEXT = `選擇題

A. 歐洲殖民擴張的簡介
|!|NJCMN0060000001|!|
歐洲國家於何時開始進行殖民擴張？
十六世紀初
十七世紀初
十八世紀末
十九世紀末

##A##
@@x)nil,1@@
[[]]

|!|NJCMN0060000002|!|
下列哪個不是參與後期殖民擴張的主要國家？
英國
西班牙
法國
德國

##B##
@@x)nil,1@@
[[]]

B. 歐洲殖民擴張的原因
|!|NJCMN0060000003|!|
下列哪位是最早能從西歐直航至印度的航海家？
A. 狄亞士
B. 達伽馬
C. 麥哲倫
D. 哥倫布

##B##
@@x)nil,1@@
[[]]`;

const PIPE_TFQ_TEXT = `是非題

|!|NJCTN0060000001|!|
歐洲人在早期擴張階段，以向非洲的擴張規模最大。________
##否。歐洲人在早期擴張階段，以向美洲的擴張規模最大。##
@@x)nil,1@@
[[]]
|!|NJCTN0060000002|!|
十六世紀至二十世紀初的殖民擴張可分為兩個階段。_______
##是##
@@x)nil,1@@
[[]]`;

const PIPE_FBQ_TEXT = `填充題

|!|NJCFN0060000001|!|
十五世紀展開的「___________________」為歐洲人打開了向世界擴張的大門。
##新航路的開闢##
@@x)nil,1@@
[[]]
|!|NJCFN0060000002|!|
歐洲人在十六世紀初至十八世紀末向美洲、___________________、非洲進行擴張。
##亞洲；美洲##
@@x)nil,2@@
[[]]`;

const PIPE_DBQ_TEXT = `資料題

|!|NJCDN0060000001|!|
根據下列資料，回答有關問題。
難度：★★☆（共6分）

資料I：一幅有關葡萄牙航海家達伽馬開闢新航路的地圖
試根據資料I，解釋達伽馬所開闢的新航線。（2分）
這條新航線以 ____________ 為起點，最後到達 ____________。
##
以西歐為起點，繞過好望角，最後到達印度。（2分）
##
@@a)nil,1@@
@@b)nil,1@@
[[]]`;

beforeAll(async () => {
  bank = await import("@/server/materials/question-bank");
  importService = await import("@/server/services/question-bank-import-service");
  seed = await import("@/server/seed");
  questions = await import("@/server/repositories/questions");
  topicsRepo = await import("@/server/repositories/topics");
  materialService = await import("@/server/services/material-service");
  seed.ensureBootstrap();
  seed.seedCurriculum();
});

describe("試題檔類型判斷", () => {
  it("由檔名判斷七種試題類型", () => {
    expect(bank.detectQuestionBankType("HNC1A2E_QB_T1_1.MCQ.docx")).toBe("MCQ");
    expect(bank.detectQuestionBankType("HNC1A2E_QB_T1_2.FBQ.docx")).toBe("FBQ");
    expect(bank.detectQuestionBankType("HNC1A2E_QB_T1_3.TFQ.docx")).toBe("TFQ");
    expect(bank.detectQuestionBankType("HNC1A2E_QB_T1_4.MUQ.docx")).toBe("MUQ");
    expect(bank.detectQuestionBankType("HNC1A2E_QB_T1_5.COQ.docx")).toBe("COQ");
    expect(bank.detectQuestionBankType("HNC1A2E_QB_T1_6.LAQ.docx")).toBe("LAQ");
    expect(bank.detectQuestionBankType("HNC1A2E_QB_T1_7.DBQ.docx")).toBe("DBQ");
  });

  it("書本內容及一般 PDF 不會被當成試題檔", () => {
    expect(bank.detectQuestionBankType("課題1人類的需要 古與今.docx")).toBeNull();
    expect(bank.detectQuestionBankType("教師筆記.pdf")).toBeNull();
    expect(bank.isQuestionBankFileName("HNC2A2E_QB_T5_1.MCQ.docx")).toBe(true);
    expect(bank.isQuestionBankFileName("課題5 近代歐洲的興起.docx")).toBe(false);
  });
});

describe("試題解析", () => {
  it("選擇題：讀出題目、去標記的選項及答案文字（含沒有字母前綴的選項）", () => {
    const result = bank.parseQuestionBank(MCQ_TEXT, "HNC1A2E_QB_T1_1.MCQ.docx");
    expect(result.questions).toHaveLength(2);
    const first = result.questions[0];
    expect(first.question).toContain("最早的人類");
    expect(first.options).toEqual(["約五百萬年前", "約七百萬年前", "約二百萬年前", "約一萬年前"]);
    expect(first.correctAnswer).toBe("約七百萬年前");
    expect(first.fileType).toBe("MCQ");
    expect(first.unitTitle).toContain("石器時代的演進");

    const second = result.questions[1];
    expect(second.options).toEqual(["亞洲", "非洲", "美洲", "歐洲"]);
    expect(second.correctAnswer).toBe("非洲");
    expect(second.questionType).toBe("mc");
  });

  it("填充題：答案順序對應空格，多個空會記錄在說明", () => {
    const result = bank.parseQuestionBank(FBQ_TEXT, "HNC1A2E_QB_T1_2.FBQ.docx");
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].correctAnswer).toBe("非洲");
    expect(result.questions[0].questionType).toBe("fill");

    const multi = result.questions[1];
    expect(multi.correctAnswer).toBe("史前時期");
    expect(multi.explanation).toContain("(1) 史前時期");
    expect(multi.explanation).toContain("(2) 信史時期");
  });

  it("是非題：轉為「是／非」兩個選項，並保留正確說法作解釋", () => {
    const result = bank.parseQuestionBank(TFQ_TEXT, "HNC1A2E_QB_T1_3.TFQ.docx");
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].options).toEqual(["是", "非"]);
    expect(result.questions[0].correctAnswer).toBe("非");
    expect(result.questions[0].explanation).toContain("非洲");
    expect(result.questions[0].question.endsWith("________")).toBe(false);
    expect(result.questions[1].correctAnswer).toBe("是");
  });

  it("長題目：轉為短答題並依「（N 分）」拆出得分要點", () => {
    const result = bank.parseQuestionBank(LAQ_TEXT, "HNC1A2E_QB_T1_6.LAQ.docx");
    expect(result.questions).toHaveLength(1);
    const question = result.questions[0];
    expect(question.questionType).toBe("short");
    expect(question.question).toContain("文字的發明對歷史的劃分");
    expect(question.gradingPoints.length).toBeGreaterThanOrEqual(2);
    expect(question.gradingPoints[0]).toContain("（1分）");
    expect(question.gradingPoints.join("")).toContain("史前時期");
  });

  it("資料題：保留資料文字與題目要求，答案作為得分要點", () => {
    const result = bank.parseQuestionBank(DBQ_TEXT, "HNC1A2E_QB_T1_7.DBQ.docx");
    expect(result.questions).toHaveLength(1);
    expect(result.questions[0].questionType).toBe("short");
    expect(result.questions[0].question).toContain("資料I");
    expect(result.questions[0].question).toContain("順序排列三項資料");
    expect(result.questions[0].gradingPoints.join("")).toContain("（1分）");
  });

  it("配對題與時序題不會被硬塞成其他題型，會略過並記錄原因", () => {
    const parsed = bank.parseQuestionBank(MUQ_TEXT, "HNC1A2E_QB_T1_4.MUQ.docx");
    expect(parsed.questions).toHaveLength(0);
    expect(parsed.skipped[0].reason).toContain("配對題");
  });

  it("格式不完整時略過（不會產生猜測的答案）", () => {
    const broken = `[[JTH2ndEdMCQ01999
沒有選項的題目
##
A
@@
t:mc
]]`;
    const result = bank.parseQuestionBank(broken, "HNC1A2E_QB_T1_1.MCQ.docx");
    expect(result.questions).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });
});

describe("乙式排版（|!|題號|!|）解析", () => {
  it("選擇題：沒有 @O 標記時仍能分出題目與四個選項", () => {
    const result = bank.parseQuestionBank(PIPE_MCQ_TEXT, "HNC2A2E_QB_T6_1.MCQ.docx");
    expect(result.questions).toHaveLength(3);

    const first = result.questions[0];
    expect(first.sourceId).toBe("NJCMN0060000001");
    expect(first.question).toBe("歐洲國家於何時開始進行殖民擴張？");
    expect(first.options).toEqual(["十六世紀初", "十七世紀初", "十八世紀末", "十九世紀末"]);
    expect(first.correctAnswer).toBe("十六世紀初");
    expect(first.unitTitle).toContain("歐洲殖民擴張的簡介");

    // 第二題以後仍屬同一分節，答案是選項中的第二項
    expect(result.questions[1].correctAnswer).toBe("西班牙");

    // 有 A. 至 D. 字母標示時依標記對應，且不會把字母留在選項內
    const labelled = result.questions[2];
    expect(labelled.options).toEqual(["狄亞士", "達伽馬", "麥哲倫", "哥倫布"]);
    expect(labelled.correctAnswer).toBe("達伽馬");
    expect(labelled.unitTitle).toContain("歐洲殖民擴張的原因");
  });

  it("是非題：答案寫成「否。正確說法」時仍正確判定", () => {
    const result = bank.parseQuestionBank(PIPE_TFQ_TEXT, "HNC2A2E_QB_T6_3.TFQ.docx");
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].correctAnswer).toBe("非");
    expect(result.questions[0].explanation).toContain("以向美洲的擴張規模最大");
    expect(result.questions[0].options).toEqual(["是", "非"]);
    expect(result.questions[1].correctAnswer).toBe("是");
  });

  it("填充題：多個空格的答案依「；」順序對應", () => {
    const result = bank.parseQuestionBank(PIPE_FBQ_TEXT, "HNC2A2E_QB_T6_2.FBQ.docx");
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].correctAnswer).toBe("新航路的開闢");
    expect(result.questions[1].correctAnswer).toBe("亞洲");
    expect(result.questions[1].explanation).toContain("(2) 美洲");
  });

  it("資料題：解析難度標示、去除作答線，並就需圖片作答加上品質警告", () => {
    const result = bank.parseQuestionBank(PIPE_DBQ_TEXT, "HNC2A2E_QB_T6_7.DBQ.docx");
    expect(result.questions).toHaveLength(1);
    const question = result.questions[0];
    expect(question.questionType).toBe("short");
    expect(question.difficulty).toBe("advanced");
    expect(question.question).toContain("資料I");
    expect(question.question).not.toContain("難度");
    // 題目內的填空線（學生作答位置）保留；只有整行都是作答線時才會移除
    expect(question.question).toContain("____ 為起點");
    expect(question.gradingPoints.join("")).toContain("（2分）");
    expect(question.qualityWarnings.join("")).toContain("圖片");
    expect(result.warnings.join("")).toContain("原檔圖片");
  });

  it("選項結束符號（私人使用區字元）不會變成選項內容", () => {
    const result = bank.parseQuestionBank(
      PIPE_MCQ_TEXT.replace("\n十九世紀末\n", "\n十九世紀末\n\uF071\n"),
      "HNC2A2E_QB_T6_1.MCQ.docx",
    );
    expect(result.questions[0].options).toEqual(["十六世紀初", "十七世紀初", "十八世紀末", "十九世紀末"]);
  });

  it("選項標記不完整（例如「A花拉子密」或漏標 A、B）時仍能正確分題", () => {
    const mixed = `選擇題
|!|NJCMN0030000015|!|
下列哪人被稱為「西歐世俗思想之父」？
A花拉子密
B.伊本‧魯世德
C.扎哈拉維
D.拉齊
##B##
@@x)nil,1@@
[[]]
|!|NJCMN0070000007|!|
下列哪項不是英國曾在北美殖民地推行的經濟政策？
英國禁止北美殖民地製造類同於英國的出口產品。
英國規定北美殖民地的貨品只能售予英國。
C.英國自1764年起加徵多種稅項。
D.英國禁止北美殖民地由法國輸入原材料。
##D##
@@x)nil,1@@
[[]]`;
    const result = bank.parseQuestionBank(mixed, "HNC1B2E_QB_T3_1.MCQ.docx");
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0].question).toBe("下列哪人被稱為「西歐世俗思想之父」？");
    expect(result.questions[0].options).toEqual(["花拉子密", "伊本‧魯世德", "扎哈拉維", "拉齊"]);
    expect(result.questions[0].correctAnswer).toBe("伊本‧魯世德");

    expect(result.questions[1].options).toEqual([
      "英國禁止北美殖民地製造類同於英國的出口產品。",
      "英國規定北美殖民地的貨品只能售予英國。",
      "英國自1764年起加徵多種稅項。",
      "英國禁止北美殖民地由法國輸入原材料。",
    ]);
    expect(result.questions[1].correctAnswer).toBe("英國禁止北美殖民地由法國輸入原材料。");
  });
});

describe("匯入題庫", () => {
  it("選擇題匯入為草稿、來源標示校內試題、分節依關鍵詞對應", () => {
    const result = importService.importQuestionBank({
      topicId: "topic-1",
      fileName: "HNC1A2E_QB_T1_1.MCQ.docx",
      text: MCQ_TEXT,
    });
    expect(result.imported).toBe(2);
    expect(result.bySection.length).toBeGreaterThan(0);

    const stored = questions.getQuestion("qb-JTH2ndEdMCQ01001");
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("draft");
    expect(stored?.origin).toBe("school-paper");
    expect(stored?.sourceLocation).toContain("HNC1A2E_QB_T1_1.MCQ.docx");
    expect(stored?.sourceLocation).toContain("第 1 題");
    expect(stored?.sourceExcerpt).toContain("最早的人類");
    expect(stored?.topicId).toBe("topic-1");
  });

  it("重複匯入不會產生重複題目", () => {
    const before = questions.listQuestions({ topicId: "topic-1" }).length;
    importService.importQuestionBank({
      topicId: "topic-1",
      fileName: "HNC1A2E_QB_T1_1.MCQ.docx",
      text: MCQ_TEXT,
    });
    expect(questions.listQuestions({ topicId: "topic-1" }).length).toBe(before);
  });

  it("課題1 不考核範圍（新月沃土／黃河、長江流域／印度河）的題目不會匯入", () => {
    const excluded = `[[JTH2ndEdMCQ01901
黃河、長江流域文明有甚麼特徵？
@O
A. 甲骨文
B. 象形文字
❒
##
A
@@
t:mc; nil:1
]]`;
    const result = importService.importQuestionBank({
      topicId: "topic-1",
      fileName: "HNC1A2E_QB_T1_9.MCQ.docx",
      text: excluded,
    });
    expect(result.imported).toBe(0);
    expect(result.excluded).toBe(1);
    expect(questions.getQuestion("qb-JTH2ndEdMCQ01901")).toBeNull();
  });

  it("課題1 考核範圍（古埃及文明）的題目可以匯入", () => {
    const included = `[[JTH2ndEdMCQ01902
古埃及文明位於哪一條河流的下游兩岸？
@O
A. 尼羅河
B. 印度河
❒
##
A
@@
t:mc; nil:1
]]`;
    const result = importService.importQuestionBank({
      topicId: "topic-1",
      fileName: "HNC1A2E_QB_T1_10.MCQ.docx",
      text: included,
    });
    expect(result.imported).toBe(1);
    expect(result.excluded).toBe(0);
    expect(questions.getQuestion("qb-JTH2ndEdMCQ01902")).not.toBeNull();
  });

  it("長題目匯入為短答題並帶有得分要點", () => {
    importService.importQuestionBank({
      topicId: "topic-1",
      fileName: "HNC1A2E_QB_T1_6.LAQ.docx",
      text: LAQ_TEXT,
    });
    const stored = questions.getQuestion("qb-JTH2ndEdLAQ01001");
    expect(stored?.questionType).toBe("short");
    expect(stored?.gradingPoints.length).toBeGreaterThan(0);
  });

  it("需圖片作答的題目會以品質警告存入題庫（仍為草稿，待教師核對）", () => {
    importService.importQuestionBank({
      topicId: "topic-6",
      fileName: "HNC2A2E_QB_T6_7.DBQ.docx",
      text: PIPE_DBQ_TEXT,
    });
    const stored = questions.getQuestion("qb-NJCDN0060000001");
    expect(stored).not.toBeNull();
    expect(stored?.status).toBe("draft");
    expect(stored?.difficulty).toBe("advanced");
    expect(stored?.qualityWarnings.join("")).toContain("圖片");
  });

  it("匯入的試題沒有段落依據，節錄及來源位置對學生一律不顯示（Sprint 7.5）", async () => {
    importService.importQuestionBank({
      topicId: "topic-1",
      fileName: "HNC1A2E_QB_T1_1.MCQ.docx",
      text: MCQ_TEXT,
    });
    const stored = questions.getQuestion("qb-JTH2ndEdMCQ01001");
    expect(stored).not.toBeNull();
    // 匯入時的來源標註：題目文字本身 + 原檔名及題號
    expect(stored?.sourceBlockIds).toEqual([]);
    expect(stored?.sourceExcerpt).toContain("最早的人類");
    expect(stored?.sourceLocation).toContain("HNC1A2E_QB_T1_1.MCQ.docx");

    const { studentExcerptVisibility } = await import("@/server/services/source-visibility");
    const visibility = studentExcerptVisibility(stored!);
    expect(visibility.visible).toBe(false);
    expect(visibility.reason).toBe("unverified-source");
  });

  it("教材匯入後會為「先前找不到依據」的題目重新定位教材依據（雲端首次啟動情境）", async () => {
    // 情境：示範題庫在教材尚未匯入時建立（題目只有原文節錄、沒有段落 ID），
    // 之後教師在介面匯入教材 → 題目應自動重新核對，否則教師端會出現假警報。
    seed.ensureBootstrap();
    seed.seedTopicStructureOnly();
    const before = questions.listQuestions({ topicId: "topic-5" });
    expect(before.length).toBeGreaterThan(0);
    expect(before.every((question) => !question.sourceVerified)).toBe(true);

    const imported = await materialService.importPilotMaterialFromDisk({ runOcr: false });
    expect(imported).not.toBeNull();

    const after = questions.listQuestions({ topicId: "topic-5", origins: ["demo"] });
    expect(after.length).toBe(before.length);
    expect(after.every((question) => question.sourceVerified)).toBe(true);
    expect(after.every((question) => question.sourceBlockIds.length > 0)).toBe(true);
  });

  it("校內試題不會被算作「未通過教材依據核對」，並可按來源篩選", () => {    // 校內試卷的來源是試卷本身，沒有教材依據是正常的
    const allSchoolPaper = questions.listQuestions({ origins: ["school-paper"] });
    const unverifiedSchoolPaper = allSchoolPaper.filter((question) => !question.sourceVerified).length;
    expect(allSchoolPaper.length).toBeGreaterThan(0);
    expect(unverifiedSchoolPaper).toBeGreaterThan(0);
    expect(questions.countSchoolPaperQuestions()).toBe(allSchoolPaper.length);

    // 儀表板：未通過核對的數字已排除校內試題
    expect(questions.countUnverifiedQuestions()).toBe(
      questions.countUnverifiedQuestionsNeedingReview() + unverifiedSchoolPaper,
    );
    expect(questions.countUnverifiedQuestionsNeedingReview()).toBeLessThan(
      questions.countUnverifiedQuestions(),
    );

    // 題目管理：可按來源分開列出（教師分批核對用）
    const topic1SchoolPaper = questions.listQuestions({
      topicId: "topic-1",
      origins: ["school-paper"],
    });
    expect(topic1SchoolPaper.length).toBeGreaterThan(0);
    expect(topic1SchoolPaper.every((question) => question.origin === "school-paper")).toBe(true);
    const generated = questions.listQuestions({ topicId: "topic-1", origins: ["demo"] });
    expect(generated.every((question) => question.origin === "demo")).toBe(true);
  });

  it("課題1 只考核古埃及文明，其餘三個文明的分節不存在於課程結構", () => {
    const sections = topicsRepo.listSections("topic-1").map((section) => section.id);
    expect(sections).not.toContain("topic-1-four-civilisations-mesopotamia");
    expect(sections).not.toContain("topic-1-four-civilisations-indus");
    expect(sections).not.toContain("topic-1-four-civilisations-yellow");
    expect(sections).toContain("topic-1-four-civilisations-egypt");
  });
});
