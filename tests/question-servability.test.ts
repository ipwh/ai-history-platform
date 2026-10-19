/**
 * 題目是否可以派給學生（結構檢查）及多空格填充題的改寫。
 *
 * 這些缺陷由「模擬學生使用」發現（2026-10-18）：923 題填充題中有 574 題的題幹
 * 有 2–5 個空格，但答案區只記錄 1 個答案；另有選項在解析後全部變成「.」的選擇題。
 * 這一層測試固定修復後的行為，避免日後再匯入同類題目。
 */
import { describe, expect, it } from "vitest";

import {
  blankAnswersFromExplanation,
  normaliseMultiBlankFill,
} from "@/server/materials/question-bank";
import { checkQuestionServable } from "@/server/services/question-servability";

describe("由評卷參考還原多個空格的答案", () => {
  it("按次序還原「(1) …、(2) …」格式", () => {
    expect(
      blankAnswersFromExplanation("填充題答案（依空格次序）：(1) 民族、(2) 殖民"),
    ).toEqual(["民族", "殖民"]);
    expect(
      blankAnswersFromExplanation(
        "填充題答案（依空格次序）：(1) 史前時期、(2) 信史時期、(3) 公元前",
      ),
    ).toEqual(["史前時期", "信史時期", "公元前"]);
  });

  it("沒有空格次序標示時不會猜測", () => {
    expect(blankAnswersFromExplanation("答案依校內試題檔的評卷參考。")).toEqual([]);
  });
});

describe("多空格填充題改寫成單一空格", () => {
  it("把其餘空格的答案填回題幹，只保留一個空格", () => {
    const result = normaliseMultiBlankFill(
      "_______________是文字出現前，沒有文字紀錄的時期。_______________是文字出現後，擁有文字紀錄的時期。",
      ["史前時期", "信史時期"],
    );
    expect(result?.correctAnswer).toBe("史前時期");
    expect(result?.question).toContain("＿＿＿");
    expect(result?.question).toContain("信史時期");
    expect(result?.question.match(/[＿_]{2,}/g)).toHaveLength(1);
  });

  it("會改用不會令答案外洩的空格", () => {
    // 保留第 1 個空格時，答案「戰爭」仍出現在後半句「以戰爭解決紛爭」 → 必須改用第 2 個空格
    const result = normaliseMultiBlankFill(
      "軍備競賽增加了______________風險。此外，擁有軍事優勢的國家變得______________，傾向以戰爭解決紛爭。",
      ["戰爭", "好戰"],
    );
    expect(result?.correctAnswer).toBe("好戰");
    expect(result?.question).toContain("增加了戰爭風險");
  });

  it("答案數目少於空格數目時不勉強改寫", () => {
    expect(
      normaliseMultiBlankFill("題幹有＿＿＿＿及＿＿＿＿兩個空格。", ["只有一個答案"]),
    ).toBeNull();
  });

  it("只有一個空格時不需要改寫", () => {
    expect(normaliseMultiBlankFill("這是＿＿＿＿單一空格。", ["答案"])).toBeNull();
  });
});

describe("題目結構是否可派給學生", () => {
  it("單空格、答案未外洩的填充題可以派給學生", () => {
    expect(
      checkQuestionServable({
        questionType: "fill",
        question: "人類歷史中，文字發明以前、沒有文字紀錄的時期稱為＿＿＿。",
        options: [],
        correctAnswer: "史前時期",
      }).ok,
    ).toBe(true);
  });

  it("多空格、沒有空格或答案外洩的填充題不可派給學生", () => {
    expect(
      checkQuestionServable({
        questionType: "fill",
        question: "＿＿＿＿是甲，＿＿＿＿是乙。",
        options: [],
        correctAnswer: "甲",
      }).ok,
    ).toBe(false);
    expect(
      checkQuestionServable({
        questionType: "fill",
        question: "工人開始組織 ，向僱主提出訴求。",
        options: [],
        correctAnswer: "工會",
      }).ok,
    ).toBe(false);
    expect(
      checkQuestionServable({
        questionType: "fill",
        question: "教士＿＿＿＿的信徒稱為「聶斯托利派」。",
        options: [],
        correctAnswer: "聶斯托利",
      }).ok,
    ).toBe(false);
  });

  it("選項含逗號排列（排序題）不會被誤判為重複選項", () => {
    expect(
      checkQuestionServable({
        questionType: "mc",
        question: "按年代順序排列以下的年份。 i. 公元850年 ii. 公元前800年 iii. 公元1200年 iv. 公元前1500年",
        options: ["i，ii，iv，iii", "ii，iii，iv，i", "iii，ii，iv，i", "iv，iii，ii，i"],
        correctAnswer: "ii，iii，iv，i",
      }).ok,
    ).toBe(true);
    expect(
      checkQuestionServable({
        questionType: "mc",
        question: "以下哪項描述是正確的？ i. 甲 ii. 乙 iii. 丙 iv. 丁",
        options: ["i及ii", "ii及iii", "iii及iv", "i、ii及iv"],
        correctAnswer: "ii及iii",
      }).ok,
    ).toBe(true);
  });

  it("選項以 i／ii 指涉題幹、但題幹沒有對應標示時不可派給學生", () => {
    const unlabelled = checkQuestionServable({
      questionType: "mc",
      question: "下列哪些屬於一手資料？ 日記 錄像 事件發生時的報章報道 學術論文",
      options: ["i、ii和iii", "i、ii和iv", "i、iii和iv", "ii、iii和iv"],
      correctAnswer: "i、ii和iii",
    });
    expect(unlabelled.ok).toBe(false);
    expect(unlabelled.reason).toContain("i");

    // 只標示了部分陳述（缺 iii）仍然不可作答
    expect(
      checkQuestionServable({
        questionType: "mc",
        question: "以下哪項正確？ i. 甲 ii. 乙",
        options: ["i及ii", "ii及iii", "iii及iv", "i及iv"],
        correctAnswer: "i及ii",
      }).ok,
    ).toBe(false);

    // 完全沒有羅馬數字選項的一般選擇題不受影響
    expect(
      checkQuestionServable({
        questionType: "mc",
        question: "以下哪個城市是意大利首都？",
        options: ["米蘭", "羅馬", "都靈", "威尼斯"],
        correctAnswer: "羅馬",
      }).ok,
    ).toBe(true);
  });

  it("答案欄混入空格標記、句末標點或整句內容的填充題不可派給學生", () => {
    const corrupt = checkQuestionServable({
      questionType: "fill",
      question: "法國的極端民族主義鼓吹報復＿＿＿。",
      options: [],
      correctAnswer: "阿爾薩斯—洛林 1919年，戰勝國召開______________，並與德國簽訂條約。",
    });
    expect(corrupt.ok).toBe(false);

    expect(
      checkQuestionServable({
        questionType: "fill",
        question: "第一次世界大戰於＿＿＿年結束。",
        options: [],
        correctAnswer: "1918年。",
      }).ok,
    ).toBe(false);

    // 「甲 / 乙」這類同義寫法仍然可以派給學生
    expect(
      checkQuestionServable({
        questionType: "fill",
        question: "宗教改革後，追隨馬丁路德的教會稱為＿＿＿。",
        options: [],
        correctAnswer: "路德宗 / 信義宗",
      }).ok,
    ).toBe(true);
  });

  it("選項全部變成「.」、空白、重複或答案不在選項內的選擇題不可派給學生", () => {
    expect(
      checkQuestionServable({
        questionType: "mc",
        question: "以下哪個國家倡議成立國際聯盟？",
        options: [".", ".", ".", "."],
        correctAnswer: ".",
      }).ok,
    ).toBe(false);
    expect(
      checkQuestionServable({
        questionType: "mc",
        question: "以下哪項正確？",
        options: ["甲", "", "丙"],
        correctAnswer: "甲",
      }).ok,
    ).toBe(false);
    expect(
      checkQuestionServable({
        questionType: "mc",
        question: "以下哪項正確？",
        options: ["甲", "甲", "丙"],
        correctAnswer: "甲",
      }).ok,
    ).toBe(false);
    expect(
      checkQuestionServable({
        questionType: "mc",
        question: "以下哪項正確？",
        options: ["甲", "乙"],
        correctAnswer: "丙",
      }).ok,
    ).toBe(false);
  });
});
