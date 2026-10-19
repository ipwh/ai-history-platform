/**
 * 香港歷史科內容審核者的授權邊界（Sprint 12）。
 *
 * 背景：`teacher` 與 `admin` 是**平台角色**，不是學科資格。管理員可以維運系統，
 * 但「這條題目的標準答案在歷史上正確」必須由獲授權的歷史科教師確認。
 * 在系統未有科目級角色之前，最小可行的授權邊界是一份**明確的名單**
 * （`HISTORY_REVIEWER_EMAILS`），只列出獲科組授權審核歷史科內容的教師。
 *
 * Fail-closed：
 *   - 名單未設定或為空 → 沒有人可以核准歷史科內容（包括 admin）；
 *   - 名單只接受完整電郵比對，不做網域推斷、不以 `AUTH_TEACHER_EMAILS` 代替。
 *
 * 尚未完成（需要負責人決定，見 `docs/teacher-review/policy-decisions-2026-10-19.md`）：
 *   - 誰實際填入這份名單、以甚麼程序更新；
 *   - 是否需要把「歷史科教師」變成可稽核的資料表欄位（而非環境設定）。
 */
const ENV_KEY = "HISTORY_REVIEWER_EMAILS";

/** 目前設定的歷史科審核者名單（小寫、去空白；未設定時為空陣列） */
export function historyReviewerEmails(): string[] {
  const raw = process.env[ENV_KEY];
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);
}

/**
 * 這位使用者是否獲授權審核歷史科內容（Golden fixture 核准、結構裁決的「已修復並核准」）。
 * 名單為空時一律 false（fail-closed），不會因為角色是 admin 而放行。
 */
export function isAuthorizedHistoryReviewer(email: string | null | undefined): boolean {
  if (!email) return false;
  const candidate = email.trim().toLowerCase();
  if (candidate.length === 0) return false;
  return historyReviewerEmails().includes(candidate);
}

export const HISTORY_REVIEWER_ENV_KEY = ENV_KEY;
