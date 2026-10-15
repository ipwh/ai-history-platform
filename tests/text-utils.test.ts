import { describe, expect, it } from "vitest";

import {
  dedupeAdjacent,
  extractYears,
  isLikelyHeading,
  joinTableRow,
  looksLikeBullet,
  normalizeForMatch,
  stripBulletPrefix,
  stripHtml,
  stripMarkdownArtifacts,
  stripPageReferences,
  TABLE_CELL_SEPARATOR,
} from "@/server/materials/text-utils";

describe("text-utils", () => {
  it("移除 HTML 標籤及全角空白", () => {
    expect(stripHtml("<strong>文藝復興</strong>&nbsp;運動")).toBe("文藝復興 運動");
  });

  it("比對用的正規化會移除標點、頁碼及大小寫差異", () => {
    expect(normalizeForMatch("文藝復興（十四至十七世紀）(p.6-24)")).toBe("文藝復興十四至十七世紀");
    expect(normalizeForMatch("ABC 測試")).toBe("abc測試");
  });

  it("移除頁碼但保留可讀文字", () => {
    expect(stripPageReferences("起源與發展 (p.10-23)")).toBe("起源與發展");
  });

  it("判斷短句為標題，長句或句末標點則否", () => {
    expect(isLikelyHeading("起源與發展")).toBe(true);
    expect(isLikelyHeading("這是一段很長的敘述，說明文藝復興的出現原因及影響。")).toBe(false);
    expect(isLikelyHeading("1. 第一項")).toBe(false);
  });

  it("辨識清單項目符號", () => {
    expect(looksLikeBullet("• 復興古希臘、羅馬文明")).toBe(true);
    expect(looksLikeBullet("（1）第一項")).toBe(true);
    expect(looksLikeBullet("這是一般段落")).toBe(false);
    expect(stripBulletPrefix("1. 馬丁路德")).toBe("馬丁路德");
  });

  it("移除相鄰重複段落（DOCX 文字方塊重複）", () => {
    const items = ["A", "A", "B", "B", "A"];
    expect(dedupeAdjacent(items, (item) => item)).toEqual(["A", "B", "A"]);
  });

  it("抽取年份", () => {
    expect(extractYears("1769年瓦特改良蒸汽機，1865年鋪設輸油管")).toEqual(["1769年", "1865年"]);
  });

  it("抽取年份時保留千位分隔符，不會只抽出被切斷的數字", () => {
    // 教材寫成「約公元前3,500年」時，若只抽出「500年」，填充題會挖出「約公元前3,＿＿＿」
    expect(extractYears("展開時間：約公元前3,500年")).toEqual(["3,500年"]);
    expect(extractYears("公元1,000年")).toEqual(["1,000年"]);
    // 年份以外的長數字（例如 12,345）不會被當成一年
    expect(extractYears("共 12,345年 的紀錄")).toEqual([]);
  });

  it("表格列會以固定的分隔符接成文字（供生成題目及核對教材依據）", () => {
    const row = joinTableRow(["能源", "  ", "人力、畜力"]);
    expect(row).toBe(`能源${TABLE_CELL_SEPARATOR}人力、畜力`);
    expect(row.split(TABLE_CELL_SEPARATOR)).toHaveLength(2);
    expect(joinTableRow(["   "])).toBe("");
  });
});

describe("stripMarkdownArtifacts（移除模型輸出的標題／Markdown 符號）", () => {
  it("移除行首的標題符號", () => {
    expect(stripMarkdownArtifacts("## 試指出文藝復興的兩項主要特點。")).toBe(
      "試指出文藝復興的兩項主要特點。",
    );
    expect(stripMarkdownArtifacts("### 拿破崙的改革")).toBe("拿破崙的改革");
  });

  it("移除句子中間誤插的標題符號", () => {
    expect(stripMarkdownArtifacts("文藝復興##主要特點")).toBe("文藝復興主要特點");
    expect(stripMarkdownArtifacts("**文藝復興**時期，歐洲人重視人文主義。")).toBe(
      "文藝復興時期，歐洲人重視人文主義。",
    );
  });

  it("移除清單及引用符號，但保留每一行的文字", () => {
    expect(stripMarkdownArtifacts("- 重視人文主義\n- 復興古典文化")).toBe(
      "重視人文主義\n復興古典文化",
    );
    expect(stripMarkdownArtifacts("> 文藝復興的起源")).toBe("文藝復興的起源");
  });

  it("移除行內程式碼及斜體記號，不改動文字內容", () => {
    expect(stripMarkdownArtifacts("`人文主義`是核心思想")).toBe("人文主義是核心思想");
    expect(stripMarkdownArtifacts("文藝復興時期*歐洲人*重視理性。")).toBe(
      "文藝復興時期歐洲人重視理性。",
    );
  });

  it("正常的中文句子不會被改動", () => {
    const sentence = "文藝復興時期，歐洲人重視人文主義，並復興古希臘與羅馬的文化。";
    expect(stripMarkdownArtifacts(sentence)).toBe(sentence);
    // 年份、百分比等數字不會被誤刪
    expect(stripMarkdownArtifacts("工業革命在 1769 年開始，產量增加 90%。")).toBe(
      "工業革命在 1769 年開始，產量增加 90%。",
    );
  });
});
