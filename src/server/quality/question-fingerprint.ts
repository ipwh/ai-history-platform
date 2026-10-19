/**
 * 題目內容指紋（純函式，Sprint 13 由 `question-service` 抽出）。
 *
 * 為什麼要獨立成模組：audit／export／evaluation CLI 只需要計算指紋，卻因為從
 * `question-service` 匯入而連帶載入 repositories（`getDb()`）。雖然載入本身不會
 * 開啟資料庫，但這種依賴令「唯讀工具不可能寫入」難以靜態證明。抽成純函式後，
 * 這些 CLI 的模組圖不再包含任何資料庫存取程式碼。
 *
 * 指紋只涵蓋會影響學生作答的欄位（分節、題型、題幹、選項、答案、可接受寫法、
 * 解釋、知識點、技能），不包含狀態、品質警告、建立時間等營運欄位——教師覆核後
 * 調整品質警告或停用／發布不應令覆核失效。
 */
import { createHash } from "node:crypto";

import type { Question } from "../../lib/types";

export function questionFingerprint(question: Question): string {
  const payload = JSON.stringify({
    topicId: question.topicId,
    sectionId: question.sectionId,
    questionType: question.questionType,
    difficulty: question.difficulty,
    question: question.question,
    options: question.options,
    correctAnswer: question.correctAnswer,
    acceptedAnswers: question.acceptedAnswers,
    explanation: question.explanation,
    knowledgePoint: question.knowledgePoint,
    gradingPoints: question.gradingPoints,
    skill: question.skill,
  });
  return createHash("sha256").update(payload).digest("hex");
}
