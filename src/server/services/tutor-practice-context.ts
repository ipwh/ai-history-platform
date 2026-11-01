/**
 * 練習 → 學伴的上下文（P0 安全邊界）。
 *
 * ── 這個模組存在的理由 ────────────────────────────────────────────────
 * 學生在練習中卡住時最需要學伴，但學伴一旦拿到題目物件，就很容易（甚至不小心）
 * 把標準答案、選項對錯、解釋或評卷參考帶進提示詞或回應。因此**只有這裡**負責
 * 把題目轉成學伴可用的上下文，而且它只會輸出「學生本來就看得到」的欄位。
 *
 * ── 絕對不可離開這個模組的資料 ────────────────────────────────────────
 *   `correctAnswer`、`acceptedAnswers`、`explanation`、`sourceExcerpt`、
 *   `sourceLocation`、`sourceBlockIds`、選項的「何者正確」標記、`knowledgePoint`
 *   （往往就是答案本身）、`qualityWarnings`、rubric／評分參考、教師備註、
 *   未發布／未達派題要求的題目。
 *
 * 傳給學伴（及前端）的欄位只有：
 *   `questionId`（關聯用）、`topicId`、`topicTitle`、`questionType`（題型標籤）、
 *   `skill`（技能標籤，本來就在 `studentQuestionFields` 白名單內）、
 *   `stemSummary`（題幹摘要 ≤300 字）、`suggestedQuestions`（引導性問題）。
 *
 * ── 兩條查詢路徑 ──────────────────────────────────────────────────────
 *   A. 有 `sessionId`：從**學生自己的**練習快照取（`getPracticeView` 會先驗證
 *      擁有權），因此即時生成的題目（不在題庫）同樣可用，而且取到的物件本身
 *      就是 `StudentQuestion`（白名單結構，結構上不可能含答案）。
 *   B. 沒有 `sessionId`：直接查題庫，必須同時符合「已發布」、「課題已發布」及
 *      「達到派題要求」（`checkQuestionDeliverable`，與練習派題同一支）。
 *
 * 前端傳來的任何額外欄位（例如 `correctAnswer`）一律**忽略**：本模組不讀取
 * 請求內容，只接受 `questionId` 及可選 `sessionId`。
 */
import {
  QUESTION_TYPE_LABELS,
  type QuestionType,
  type TutorPracticeContext,
} from "@/lib/types";
import { ApiRouteError } from "../http";
import { getQuestion } from "../repositories/questions";
import { getTopic, sectionTitleMap } from "../repositories/topics";
import { checkQuestionDeliverable } from "./question-servability";
import { getPracticeView, PracticeServiceError } from "./practice-service";
import { getTutorTopicCard } from "./tutor-topic-cards";

/** 題幹摘要長度上限（規格：≤200–300 字） */
export const TUTOR_PRACTICE_STEM_MAX_CHARS = 300;
/** 開場建議問題數量上限 */
export const TUTOR_PRACTICE_MAX_SUGGESTIONS = 3;

/** 去掉「課題9：」「的內容」等前後贅字，令建議問題讀起來自然 */
function shortSubject(title: string): string {
  const stripped = title
    .replace(/^(?:課題|單元)\s*\d+\s*[：:：\-–—]?\s*/, "")
    .replace(/\((?:I|II|III)\)/gi, "")
    .replace(/(?:的)?(?:內容|背景|影響|特點|發展|經過|結果)$/, "")
    .trim();
  return stripped.length > 0 ? stripped : title.trim();
}

function summariseStem(stem: string): string {
  const collapsed = stem.replace(/\s+/g, " ").trim();
  if (collapsed.length <= TUTOR_PRACTICE_STEM_MAX_CHARS) return collapsed;
  return `${collapsed.slice(0, TUTOR_PRACTICE_STEM_MAX_CHARS)}…`;
}

/**
 * 開場／澄清用的建議問題。
 *
 * 來源優先次序：課題卡（科組預寫）→ 分節標題 → 技能標籤 → 課題標題。
 * 全部都是「怎樣思考」的問題，**不是**答案或選項。
 */
export function buildPracticeSuggestedQuestions(input: {
  topicId: string;
  topicTitle: string;
  sectionTitle: string | null;
  skill: string | null;
}): string[] {
  const card = getTutorTopicCard(input.topicId);
  const questions: string[] = [];
  const add = (candidate: string): void => {
    const value = candidate.trim();
    if (value.length === 0) return;
    if (questions.includes(value)) return;
    if (questions.length >= TUTOR_PRACTICE_MAX_SUGGESTIONS) return;
    questions.push(value);
  };

  for (const question of card?.suggestedQuestions ?? []) add(question);
  if (questions.length >= TUTOR_PRACTICE_MAX_SUGGESTIONS) return questions;

  if (input.sectionTitle !== null && input.sectionTitle.trim().length > 0) {
    add(`${shortSubject(input.sectionTitle)}的背景和影響有甚麼關係？`);
  }
  if (input.skill !== null && input.skill.trim().length > 0) {
    add(`這題屬於「${input.skill.trim().slice(0, 24)}」，可以從哪一步開始分析？`);
  }
  if (questions.length < 2 && input.topicTitle.trim().length > 0) {
    add(`${shortSubject(input.topicTitle)}有哪些重要轉變？`);
  }
  return questions;
}

function toContext(input: {
  questionId: string;
  topicId: string;
  topicTitle: string;
  sectionId: string | null;
  questionType: QuestionType;
  stem: string;
  skill: string | null;
}): TutorPracticeContext {
  const sectionTitle =
    input.sectionId === null ? null : (sectionTitleMap(input.topicId).get(input.sectionId) ?? null);
  return {
    questionId: input.questionId,
    topicId: input.topicId,
    topicTitle: input.topicTitle,
    questionType: QUESTION_TYPE_LABELS[input.questionType] ?? "",
    skill: input.skill,
    stemSummary: summariseStem(input.stem),
    suggestedQuestions: buildPracticeSuggestedQuestions({
      topicId: input.topicId,
      topicTitle: input.topicTitle,
      sectionTitle,
      skill: input.skill,
    }),
  };
}

/**
 * 解析練習上下文。
 *
 * 失敗時拋出 `ApiRouteError`（404 = 找不到／不可用；403 = 不是自己的練習）。
 * 訊息刻意一致（「找不到這條練習題目」），避免以錯誤訊息區分「存在但未發布」與
 * 「不存在」，令未發布題目無法被藉此探測。
 */
export function resolveTutorPracticeContext(input: {
  questionId: string;
  sessionId?: string | null;
  learnerId: string;
}): TutorPracticeContext {
  const questionId = input.questionId.trim();
  if (questionId.length === 0) throw new ApiRouteError("找不到這條練習題目", 404);

  if (input.sessionId !== undefined && input.sessionId !== null && input.sessionId.length > 0) {
    let view: ReturnType<typeof getPracticeView>;
    try {
      view = getPracticeView(input.sessionId, input.learnerId);
    } catch (error) {
      if (error instanceof PracticeServiceError) {
        throw new ApiRouteError(error.message, error.status);
      }
      throw error;
    }
    const question = view.questions.find((item) => item.id === questionId);
    if (!question) throw new ApiRouteError("找不到這條練習題目", 404);
    // 快照題目所屬課題仍須存在且已發布：課題下架後不應再經學伴討論其內容。
    const topic = getTopic(question.topicId);
    if (!topic || !topic.published) throw new ApiRouteError("找不到這條練習題目", 404);
    return toContext({
      questionId: question.id,
      topicId: question.topicId,
      topicTitle: topic.title,
      sectionId: question.sectionId ?? null,
      questionType: question.questionType,
      stem: question.question,
      skill: question.skill ?? null,
    });
  }

  const question = getQuestion(questionId);
  if (!question) throw new ApiRouteError("找不到這條練習題目", 404);
  if (question.status !== "published") throw new ApiRouteError("找不到這條練習題目", 404);
  const topic = getTopic(question.topicId);
  if (!topic || !topic.published) throw new ApiRouteError("找不到這條練習題目", 404);
  if (!checkQuestionDeliverable(question).ok) {
    throw new ApiRouteError("找不到這條練習題目", 404);
  }
  return toContext({
    questionId: question.id,
    topicId: question.topicId,
    topicTitle: topic.title,
    sectionId: question.sectionId,
    questionType: question.questionType,
    stem: question.question,
    skill: question.skill ?? null,
  });
}

/**
 * 注入 system prompt 的「練習上下文」區塊。
 *
 * 只包含題幹摘要、課題、題型及技能——足以理解學生在問哪一條題目，但不足以
 * 知道答案。區塊內另有明確禁令，避免模型自行補完答案或講出選項對錯。
 */
export function describeTutorPracticeContextForPrompt(context: TutorPracticeContext): string {
  const lines = [
    "【練習上下文（學生正在做練習，不是要你代答）】",
    `課題：${context.topicTitle.length > 0 ? context.topicTitle : "（未標示）"}`,
    `題型：${context.questionType.length > 0 ? context.questionType : "（未標示）"}`,
  ];
  if (context.skill !== null && context.skill.length > 0) {
    lines.push(`這題主要練習的技能：${context.skill}（可在回覆中點出思考方向，但不要評分）`);
  }
  lines.push(`題幹摘要：${context.stemSummary.length > 0 ? context.stemSummary : "（未提供）"}`);
  lines.push("規則：");
  lines.push("1. 只協助理解概念、歷史背景及作答思路；不要直接給出這題的答案、選項字母或「哪個選項對」。");
  lines.push("2. 學生要求你直接說答案時，改為提供一個思考步驟或反問，讓學生自行判斷。");
  lines.push("3. 你沒有看過這題的標準答案、解釋或評分參考，也不可聲稱看過；不要猜測官方答案。");
  lines.push("4. 不要複述題幹全文，也不要自行改寫題目或新增選項。");
  return lines.join("\n");
}
