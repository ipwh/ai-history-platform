/**
 * 題目政策分類（純函式）。
 *
 * 這個模組把不同性質的問題分開，避免「把所有品質問題一律封鎖」或
 * 「把所有警告一律忽略」。它**不會**被學生派發路徑直接使用；派發路徑仍然只套用
 * 硬性阻擋（隔離、結構不可作答、無效關聯），以保持既有行為。發布閘門會使用全部類別。
 *
 * 類別：
 *   - `hard_block`：安全、隔離、結構或關聯錯誤，必須阻擋派發及發布。
 *   - `teacher_review`：需要教師判斷（來源未能核實、解釋疑似矛盾或不足、知識點錯配）。
 *   - `warning`：降低分析或顯示質素，但不影響答案正確性。
 *   - `policy_pending`：需要產品負責人決定（例如佔位解釋是否暫緩派發）；未有決定前
 *     維持較保守的發布決策，不可當作通過。
 */
import type { ExplanationQualityResult } from "./explanation-quality";
import type { MetadataQualityResult } from "./metadata-quality";
import type { SourceTraceabilityResult } from "./source-traceability";

export const POLICY_CATEGORIES = [
  "hard_block",
  "teacher_review",
  "warning",
  "policy_pending",
] as const;

export type PolicyCategory = (typeof POLICY_CATEGORIES)[number];

export interface PolicyFinding {
  category: PolicyCategory;
  code: string;
  message: string;
}

export interface QuestionPolicyInput {
  teacherConfirmationRequired: boolean;
  servability: { ok: boolean; reason?: string | null };
  source: SourceTraceabilityResult;
  explanation: ExplanationQualityResult;
  metadata: MetadataQualityResult;
}

export interface QuestionPolicyResult {
  findings: PolicyFinding[];
  counts: Record<PolicyCategory, number>;
  /** 可否派給學生（沿用現行硬性規則）。 */
  canServe: boolean;
  /** 是否具備發布資格（硬性問題及待決政策都不能存在）。 */
  releasable: boolean;
}

export function evaluateQuestionPolicy(input: QuestionPolicyInput): QuestionPolicyResult {
  const findings: PolicyFinding[] = [];

  if (input.teacherConfirmationRequired) {
    findings.push({
      category: "hard_block",
      code: "TEACHER_CONFIRMATION_REQUIRED",
      message: "題目帶待教師確認標記，不得派發或發布",
    });
  }
  if (!input.servability.ok) {
    findings.push({
      category: "hard_block",
      code: "QUESTION_NOT_SERVABLE",
      message: `題目結構上不可作答：${input.servability.reason ?? "未知原因"}`,
    });
  }
  for (const issue of input.metadata.issues) {
    if (issue.severity === "blocking") {
      findings.push({ category: "hard_block", code: issue.code, message: issue.message });
    } else if (issue.severity === "needs_review") {
      findings.push({ category: "teacher_review", code: issue.code, message: issue.message });
    } else {
      findings.push({ category: "warning", code: issue.code, message: issue.message });
    }
  }

  switch (input.source.status) {
    case "traceable":
      break;
    case "pending_verification":
      findings.push({
        category: "teacher_review",
        code: "SOURCE_PENDING_VERIFICATION",
        message: "來源只有文字位置，尚未由系統或教師核實",
      });
      break;
    case "partial":
      findings.push({
        category: "teacher_review",
        code: "SOURCE_PARTIAL",
        message: "來源資料不完整，需要補齊或由教師核實",
      });
      break;
    case "unknown":
      findings.push({
        category: "teacher_review",
        code: "SOURCE_UNKNOWN",
        message: "沒有可定位來源，需教師確認",
      });
      break;
  }

  switch (input.explanation.class) {
    case "placeholder":
    case "answer_only":
      findings.push({
        category: "policy_pending",
        code:
          input.explanation.class === "placeholder"
            ? "EXPLANATION_PLACEHOLDER_POLICY"
            : "EXPLANATION_ANSWER_ONLY_POLICY",
        message:
          input.explanation.class === "placeholder"
            ? "解釋為佔位文字；是否暫緩派發屬產品政策，未有決定前不可視為通過"
            : "解釋只列出答案；改善標準及是否暫緩派發屬產品政策",
      });
      break;
    case "potentially_inconsistent":
      findings.push({
        category: "teacher_review",
        code: "EXPLANATION_POTENTIALLY_INCONSISTENT",
        message: "解釋與標準答案可能不一致，需教師覆核",
      });
      break;
    case "insufficient":
      findings.push({
        category: "teacher_review",
        code: "EXPLANATION_INSUFFICIENT",
        message: "解釋過短且沒有說明理由，需教師判斷是否補寫",
      });
      break;
    case "not_assessed":
      break;
  }

  if (input.explanation.codes.includes("EXPLANATION_REVIEWED_BUT_LOW_QUALITY")) {
    findings.push({
      category: "teacher_review",
      code: "EXPLANATION_REVIEWED_BUT_LOW_QUALITY",
      message: "此題有人工覆核紀錄，但解釋仍被分類為需改善",
    });
  }

  const counts = POLICY_CATEGORIES.reduce(
    (accumulator, category) => {
      accumulator[category] = findings.filter((finding) => finding.category === category).length;
      return accumulator;
    },
    { hard_block: 0, teacher_review: 0, warning: 0, policy_pending: 0 } as Record<
      PolicyCategory,
      number
    >,
  );

  return {
    findings,
    counts,
    canServe: counts.hard_block === 0,
    releasable: counts.hard_block === 0 && counts.teacher_review === 0 && counts.policy_pending === 0,
  };
}
