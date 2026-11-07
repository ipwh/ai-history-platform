/**
 * 教材涵蓋分類回歸（規格 3.13、3.14、5.2 證據等級）。
 *
 * 這裡只有一個問題要答：回覆應否標示為「未找到教材依據」。
 * 錯判的兩個方向都會傷害學生：
 *   ① 明明有教材卻標示「找不到」→ 學生以為課本沒有寫，並隱藏了可用出處；
 *   ② 明明沒有教材卻標示「已對照課本」→ 學生把課外內容當成課文背。
 * 2026-11-06 的實際缺陷屬①：「教材片段**並沒有把**革命寫成加稅後立即爆發」這種
 * **更正學生前提**的開場，被當成「找不到教材」，令有四段依據的回覆降級。
 */
import { describe, expect, it } from "vitest";

import { answerDeclaresNotCovered } from "@/server/services/tutor-grounding";

describe("更正前提不等於教材未涵蓋（規格 3.14）", () => {
  it("更正學生錯誤前提的開場，不算「找不到教材」", () => {
    const sentences = [
      "這個年份並不正確。",
      "教材片段並沒有把革命寫成加稅後立即爆發。",
      "並非沒有相關證據，只是時間線需要更正。",
      "課文沒有直接說明，但提供了相關背景。",
      "學生的前提錯誤，但教材有正確資料。",
      "教材未有明確指出原因，只列出背景因素。",
    ];
    for (const sentence of sentences) {
      expect(answerDeclaresNotCovered(sentence), sentence).toBe(false);
    }
  });

  it("真正宣告「教材找不到」的開場會被識別", () => {
    const sentences = [
      "教材沒有提及此人物。",
      "我在教材片段中找不到這部分的內容。",
      "教材並未涵蓋這個人物。",
      "教材沒有提到哥倫布。",
      "教材未見相關說明。",
      "課本沒有相關記錄。",
    ];
    for (const sentence of sentences) {
      expect(answerDeclaresNotCovered(sentence), sentence).toBe(true);
    }
  });

  it("一般有依據的回覆不會被誤判", () => {
    expect(answerDeclaresNotCovered("這段教材提及了加稅的背景。")).toBe(false);
    expect(answerDeclaresNotCovered("波士頓傾茶事件發生於 1773 年。")).toBe(false);
    expect(answerDeclaresNotCovered("教材指出革命分階段展開。")).toBe(false);
  });
});

describe("只看第一句，避免整篇降級（規格 3.14）", () => {
  it("句中途才提及未涵蓋，不算整個回覆未涵蓋", () => {
    expect(
      answerDeclaresNotCovered(
        "教材指出革命分階段展開。至於海地的情況，教材沒有提及。",
      ),
    ).toBe(false);
  });

  it("分兩部分作答、只有一部分未涵蓋時不會降級", () => {
    expect(
      answerDeclaresNotCovered(
        "先回答第一部分：教材有清楚記載。第二部分（戰後賠款細節）教材未見說明。",
      ),
    ).toBe(false);
  });

  it("較長開場白後才宣告找不到教材，仍然會降級（最多掃描 60 字）", () => {
    const opening =
      "先回應你的問題：你問的是十九世紀歐洲殖民擴張的細節，我在教材片段中找不到這部分的內容。";
    expect(answerDeclaresNotCovered(opening)).toBe(true);
  });
});
