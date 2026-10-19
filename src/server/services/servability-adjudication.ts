/**
 * 結構不可作答題目的教師裁決服務。
 *
 * 重用既有 `recordQuestionReview()`（綁定版本＋指紋、伺服器時間、覆核者身分）：
 *   - `return_to_draft`：記錄 returned，題目回到草稿；
 *   - `keep_quarantined`：記錄 returned，並保留／設定待教師確認標記；
 *   - `request_more_evidence`：記錄 returned，理由標明要求補充證據；
 *   - `reject`：記錄 rejected，題目留在草稿。
 *
 * `approve_after_verified_repair` 不由這裡處理：教師必須先在題目管理修改內容
 * （版本遞增），再經既有覆核流程核准；`recordQuestionReview()` 會拒絕核准仍然
 * 結構不可作答的題目。
 */
import { setTeacherConfirmationRequired } from "../repositories/questions";
import { listQuestionReviews, getQuestion } from "../repositories/questions";
import { classifyServabilityIssue } from "../quality/servability-remediation";
import { checkQuestionServable } from "./question-servability";
import { isAuthorizedHistoryReviewer } from "../auth/history-reviewer";
import {
  QuestionServiceError,
  recordQuestionReview,
  teacherQuestionView,
} from "./question-service";
import type { TeacherQuestionView } from "../../lib/types";

export const SERVABILITY_DECISIONS = [
  "return_to_draft",
  "keep_quarantined",
  "request_more_evidence",
  "reject",
  "approve_after_verified_repair",
] as const;

export type ServabilityDecision = (typeof SERVABILITY_DECISIONS)[number];

export interface ServabilityDecisionInput {
  questionId: string;
  decision: ServabilityDecision;
  reason: string;
  expectedRevision: number;
  actor: { email: string; role: string };
}

const PREFIX: Record<ServabilityDecision, string> = {
  return_to_draft: "退回草稿",
  keep_quarantined: "保留隔離",
  request_more_evidence: "要求補充證據",
  reject: "不可用",
  approve_after_verified_repair: "已修復並核准",
};

export function recordServabilityDecision(
  input: ServabilityDecisionInput,
): TeacherQuestionView {
  const question = getQuestion(input.questionId);
  if (!question) throw new QuestionServiceError("找不到指定的題目", 404);

  if (input.actor.email.trim().length === 0 || input.actor.role.trim().length === 0) {
    throw new QuestionServiceError(
      "缺少裁決者身分，無法記錄裁決。身分只可由伺服器端工作階段提供。",
      400,
    );
  }
  const reason = input.reason.trim();
  if (reason.length < 5) {
    throw new QuestionServiceError("請填寫至少 5 個字的裁決理由", 400);
  }

  const servability = checkQuestionServable(question);
  const issue = servability.ok ? "題目目前可作答" : classifyServabilityIssue(servability.reason);

  // 只有在「已核實的修復」之後才可核准：題目現在必須結構上可作答，
  // 而 `recordQuestionReview(approved)` 會再檢查一次（雙重保險）。
  if (input.decision === "approve_after_verified_repair") {
    // 這是「確認內容可以發布」的學科決定：需要歷史科審核者授權名單，admin 角色不足。
    if (!isAuthorizedHistoryReviewer(input.actor.email)) {
      throw new QuestionServiceError(
        "未獲授權核准歷史科題目內容（需要 HISTORY_REVIEWER_EMAILS 名單中的歷史科教師帳戶）；" +
          "仍可記錄退回、保留隔離、要求補充證據或不可用。",
        403,
      );
    }
    if (!servability.ok) {
      throw new QuestionServiceError(
        `無法核准：題目結構上仍不可作答（${servability.reason}）。請先完成修正並重新檢查。這次沒有記錄任何決定。`,
        409,
      );
    }
    const approved = recordQuestionReview({
      questionId: input.questionId,
      decision: "approved",
      reason: `結構裁決（${issue}）：${PREFIX[input.decision]}。${reason}`,
      expectedRevision: input.expectedRevision,
      actor: input.actor,
    });
    return approved.view;
  }

  const decision = input.decision === "reject" ? "rejected" : "returned";
  const reasonText = `結構裁決（${issue}）：${PREFIX[input.decision]}。${reason}`;

  // 同一版本、同一決定（退回／不可用）但理由不同，是另一次裁決，必須留下新紀錄。
  const latest = listQuestionReviews(input.questionId, 1)[0];
  const forceNew =
    Boolean(latest) &&
    latest.revision === question.revision &&
    latest.decision === decision &&
    (latest.reason ?? "") !== reasonText;

  const result = recordQuestionReview({
    questionId: input.questionId,
    decision,
    reason: reasonText,
    expectedRevision: input.expectedRevision,
    actor: input.actor,
    forceNew,
  });

  if (input.decision === "keep_quarantined") {
    const updated = setTeacherConfirmationRequired(input.questionId, true);
    if (!updated) throw new QuestionServiceError("題目狀態更新失敗", 500);
    return teacherQuestionView(updated);
  }

  return result.view;
}

