/**
 * 學生端題目的序列化（防作弊脫敏）。
 *
 * 所有把題目送到瀏覽器的地方都必須經由這裡，不可直接把 `Question` 回傳：
 * 完整題目含標準答案、可接受答案、解釋、得分要點及教材原文節錄，任何一項在
 * 學生作答前外洩都會令題目失去考核意義（開瀏覽器開發工具即可看到）。
 *
 * 做法是**白名單**：只複製作答所需的欄位，其餘一概不傳。相對於「剔除已知敏感
 * 欄位」，白名單在題目結構新增欄位時不會靜默外洩。
 */
import {
  studentQuestionSchema,
  studentQuestionFields,
  type Question,
  type StudentQuestion,
} from "./types";

/** 學生端題目可以包含的欄位名稱 */
export const STUDENT_QUESTION_ALLOWED_FIELDS: readonly string[] = Object.keys(
  studentQuestionFields,
);

/**
 * 學生端**任何情況**下都不可提前取得的題目欄位。
 *
 * 作答後的回饋（`QuestionFeedback`）會包含 `correctAnswer` 及 `explanation`，
 * 那是評分後的結果，不屬於這裡的範圍；這份清單用於檢查「題目」本身。
 */
export const QUESTION_CONFIDENTIAL_FIELDS = [
  "correctAnswer",
  "acceptedAnswers",
  "explanation",
  "gradingPoints",
  // 知識點往往就是標準答案，作答前不可傳給瀏覽器
  "knowledgePoint",
  "sourceExcerpt",
  "sourceLocation",
  "sourceBlockIds",
  "qualityWarnings",
  "teacherConfirmationRequired",
  "autoValidatedAt",
  "autoValidatedRevision",
  "autoValidatedFingerprint",
] as const;

/**
 * 把完整題目轉成學生端 DTO。
 *
 * 逐欄複製（而不是解析整份題目後刪除敏感欄位），確保回傳值只包含白名單欄位；
 * 最後交由 zod schema 驗證，欄位缺失或型別錯誤會立即拋錯，不會靜默送出殘缺題目。
 */
export function toStudentQuestion(question: Question): StudentQuestion {
  return studentQuestionSchema.parse({
    id: question.id,
    topicId: question.topicId,
    sectionId: question.sectionId,
    questionType: question.questionType,
    difficulty: question.difficulty,
    question: question.question,
    options: [...question.options],
    origin: question.origin,
    skill: question.skill,
  });
}

export function toStudentQuestions(questions: Question[]): StudentQuestion[] {
  return questions.map(toStudentQuestion);
}

/**
 * 在任意 JSON 內容中找出敏感題目欄位（供測試及稽核使用）。
 *
 * 回傳去重後的欄位路徑（例如 `questions[0].correctAnswer`），空陣列代表沒有外洩。
 * 走訪有深度上限，避免遇到異常結構時無限遞迴。
 */
export function findConfidentialQuestionFields(payload: unknown): string[] {
  const confidential = new Set<string>(QUESTION_CONFIDENTIAL_FIELDS);
  const found = new Set<string>();
  const seen = new Set<object>();

  function visit(value: unknown, path: string, depth: number): void {
    if (depth > 12 || value === null || typeof value !== "object") return;
    if (seen.has(value)) return;
    seen.add(value);

    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`, depth + 1));
      return;
    }

    for (const [key, child] of Object.entries(value)) {
      const childPath = path.length > 0 ? `${path}.${key}` : key;
      if (confidential.has(key)) found.add(childPath);
      visit(child, childPath, depth + 1);
    }
  }

  visit(payload, "", 0);
  return [...found];
}
