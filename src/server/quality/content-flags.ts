/**
 * 內容改進標記（純函式部分）。
 *
 * 標記只是**工作狀態**，不是覆核決定，也不是品質判定：
 *   - `explanation_needs_rewrite`：解釋需要補寫（佔位文字／只列答案／過短）
 *   - `skill_needs_confirmation`：歷史技能標籤需要教師確認
 *
 * 為甚麼要與 `question_reviews` 分開：覆核紀錄代表「誰核准過這一版題目」，會決定題目
 * 是否可向學生發布。如果把「待重寫」寫成 `returned`，題目會立即下架，等於用行政動作
 * 改變發布狀態；而且會令覆核證據出現無法分辨來源的紀錄。兩者分開保存，各自的問題
 * 都可以獨立回答。
 *
 * 事件表只可新增（append-only）；現行狀態由「每題每種標記的最新事件」推導。
 */
export const CONTENT_FLAGS = [
  "explanation_needs_rewrite",
  "skill_needs_confirmation",
  "explanation_rewritten",
] as const;

export type ContentFlag = (typeof CONTENT_FLAGS)[number];

export const CONTENT_FLAG_LABELS: Record<ContentFlag, string> = {
  explanation_needs_rewrite: "解釋待重寫",
  skill_needs_confirmation: "技能待確認",
  explanation_rewritten: "解釋已補寫（自動化紀錄）",
};

export const CONTENT_FLAG_STATES = ["open", "cleared"] as const;
export type ContentFlagState = (typeof CONTENT_FLAG_STATES)[number];

/**
 * 屬於「待辦」的標記（會令題目出現在工作佇列的「已標記」篩選）。
 *
 * `explanation_rewritten` 不在其中：它是**已完成工作的紀錄**（誰在何時補寫了解釋），
 * 不是待辦事項；若把它算成待辦，補寫完成的題目會永遠留在「已標記」清單。
 */
export const CONTENT_TODO_FLAGS = [
  "explanation_needs_rewrite",
  "skill_needs_confirmation",
] as const;

export interface ContentFlagEvent {
  id: string;
  questionId: string;
  revision: number;
  questionFingerprint: string;
  flag: ContentFlag;
  state: ContentFlagState;
  reason: string;
  actorEmail: string;
  actorRole: string;
  createdAt: string;
}

export interface ContentFlagStatus {
  flag: ContentFlag;
  state: ContentFlagState;
  /** 標記時的題目版本（該版本已不是現行版本時，只代表歷史） */
  revision: number;
  questionFingerprint: string;
  reason: string;
  actorEmail: string;
  actorRole: string;
  /** 事件建立時間（ISO 8601） */
  createdAt: string;
  /**
   * 標記之後題目內容已改變。
   *
   * `true` 不代表問題已解決（改寫可能仍然不足），只代表「這條標記是對舊內容下的判斷」，
   * 需要教師重新檢視；因此工作清單仍會顯示這條標記，不會靜默清除。
   */
  contentChangedSinceFlag: boolean;
}

/** 狀態鍵：同一題可以同時有多種標記 */
export function flagKey(questionId: string, flag: ContentFlag): string {
  return `${questionId}::${flag}`;
}

/**
 * 由事件序列推導現行狀態。
 *
 * 事件必須已按時間排序（舊→新）；同一時間以輸入次序為準（呼叫端由 `created_at, id`
 * 排序即可）。每一題每一種標記只保留最後一個事件。
 */
export function deriveFlagStatuses(
  events: ContentFlagEvent[],
  current: { revision: number; fingerprint: string } | null,
): Map<string, ContentFlagStatus> {
  const latest = new Map<string, ContentFlagEvent>();
  for (const event of events) {
    latest.set(flagKey(event.questionId, event.flag), event);
  }
  const statuses = new Map<string, ContentFlagStatus>();
  for (const [key, event] of latest) {
    statuses.set(key, {
      flag: event.flag,
      state: event.state,
      revision: event.revision,
      questionFingerprint: event.questionFingerprint,
      reason: event.reason,
      actorEmail: event.actorEmail,
      actorRole: event.actorRole,
      createdAt: event.createdAt,
      contentChangedSinceFlag:
        current !== null &&
        (current.revision !== event.revision ||
          current.fingerprint !== event.questionFingerprint),
    });
  }
  return statuses;
}

/** 現行有效的標記（`state = open`；內容已改的仍保留，但另以 `contentChangedSinceFlag` 標示） */
export function isOpen(status: ContentFlagStatus): boolean {
  return status.state === "open";
}
