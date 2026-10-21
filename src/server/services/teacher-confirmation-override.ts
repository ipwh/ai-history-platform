/**
 * 擁有者授權的「待教師確認」解除決定（純函式）。
 *
 * 背景：品質閘門遇到無法自動判斷的情況會設定 `teacherConfirmationRequired`，令題目即使已發布
 * 亦不會派發給學生。正常情況下只有教師的人工覆核可以清除；當擁有者明確授權（例如匯入的校內
 * 試題從未在平台留下覆核紀錄）時，可以用一份逐題決定檔清除標記，但必須：
 *   - 每一題都有可追溯的理由；
 *   - 解除前通過可作答性檢查（不可作答的題目不會因此變成可派發）；
 *   - 答案修正只限「修正匯入黏連」（必須同時提供現值及修正值，兩者不符即拒絕）；
 *   - **不**建立任何 `questionReviews` 覆核紀錄（題目在教師端仍顯示「未經人工覆核」）。
 */
import { checkQuestionServable } from "./question-servability";
import type { Question } from "../../lib/types";

export interface TeacherConfirmationOverrideItem {
  questionId: string;
  reason: string;
  correctAnswer?: { from: string; to: string };
}

export type TeacherConfirmationOverrideStatus =
  | "planned"
  | "already-applied"
  | "missing"
  | "conflict"
  | "unservable";

export interface TeacherConfirmationOverridePlan {
  questionId: string;
  status: TeacherConfirmationOverrideStatus;
  detail: string;
  /** 需要寫入的修正後答案；null 代表不改答案 */
  newCorrectAnswer: string | null;
  /** 是否需要清除 teacherConfirmationRequired */
  clearHold: boolean;
  /** 需要一併寫入的品質警告（保留原暫緩理由，並附上決定紀錄） */
  warnings: string[];
  /** 需要寫入 qualityWarnings 欄位 */
  updateWarnings: boolean;
}

export const OVERRIDE_RESOLUTION_PREFIX = "【";

export function overrideResolutionNote(decidedOn: string, reason: string): string {
  return `${OVERRIDE_RESOLUTION_PREFIX}${decidedOn} 擁有者授權決定】${reason}`;
}

export function planTeacherConfirmationOverride(
  question: Question | null,
  item: TeacherConfirmationOverrideItem,
  decidedOn: string,
): TeacherConfirmationOverridePlan {
  const base: TeacherConfirmationOverridePlan = {
    questionId: item.questionId,
    status: "planned",
    detail: "",
    newCorrectAnswer: null,
    clearHold: false,
    warnings: [],
    updateWarnings: false,
  };
  if (!question) return { ...base, status: "missing", detail: "資料庫內找不到此題目" };
  if (item.reason.trim().length < 10) {
    return { ...base, status: "conflict", detail: "決定檔沒有提供足夠理由（至少 10 字）" };
  }

  let answer = question.correctAnswer;
  if (item.correctAnswer) {
    if (answer === item.correctAnswer.to) {
      // 已經修正過：可重複執行
    } else if (answer !== item.correctAnswer.from) {
      return {
        ...base,
        status: "conflict",
        detail: `答案與決定檔記錄不同（現值「${answer.slice(0, 20)}」），不覆寫`,
      };
    } else {
      base.newCorrectAnswer = item.correctAnswer.to;
      answer = item.correctAnswer.to;
    }
  }

  const servability = checkQuestionServable({
    questionType: question.questionType,
    question: question.question,
    options: question.options,
    correctAnswer: answer,
  });
  if (!servability.ok) {
    return { ...base, status: "unservable", detail: servability.reason ?? "題目不可作答" };
  }

  const resolution = overrideResolutionNote(decidedOn, item.reason);
  const alreadyRecorded = question.qualityWarnings.some((warning) =>
    warning.startsWith(`${OVERRIDE_RESOLUTION_PREFIX}${decidedOn} 擁有者授權決定】`),
  );
  base.warnings = alreadyRecorded
    ? question.qualityWarnings
    : [...question.qualityWarnings, resolution];
  const needsWarningUpdate =
    !alreadyRecorded && question.qualityWarnings.length > 0;

  if (
    !question.teacherConfirmationRequired &&
    base.newCorrectAnswer === null &&
    !needsWarningUpdate
  ) {
    return { ...base, warnings: question.qualityWarnings, status: "already-applied", detail: "已解除暫緩標記，沒有需要寫入" };
  }

  base.clearHold = question.teacherConfirmationRequired;
  base.updateWarnings = needsWarningUpdate;
  base.detail = [
    base.newCorrectAnswer !== null ? "修正破損答案" : null,
    question.teacherConfirmationRequired ? "解除待教師確認標記" : null,
    needsWarningUpdate ? "保留原暫緩理由並附上決定紀錄" : null,
  ]
    .filter(Boolean)
    .join("；");
  return base;
}
