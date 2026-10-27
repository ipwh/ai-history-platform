import type { SessionUser } from "./types";

/**
 * 誰可以使用 AI 歷史自學學伴（Beta）。
 *
 * 這個判斷刻意與伺服器端 API 的守衛（`src/app/api/tutor/chat/route.ts` 的
 * `requireTutorAccess`）使用同一個語意，令介面在同一情況下顯示說明，
 * 而不是渲染一個每次送出都收到 403 的對話框。
 *
 *   - anonymous：未登入（正式環境會被 `guardStudentPage` 導向登入頁）。
 *   - unverified：學生帳戶但尚未在名冊核對，API 會回 403。
 *   - staff-preview：教師／管理員。2026-10-27 起開放測試；介面會標明這是測試身分，
 *     對話記錄記在 `teacher:`／`admin:` learnerId，不影響任何學生。
 *   - allowed：已登入且在名冊內的學生。
 */
export type TutorAccessState = "allowed" | "anonymous" | "staff-preview" | "unverified";

export function tutorAccessState(user: SessionUser | null): TutorAccessState {
  if (user === null) return "anonymous";
  if (user.role !== "student") return "staff-preview";
  if (!user.rosterVerified) return "unverified";
  return "allowed";
}
