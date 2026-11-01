/**
 * 學伴相關路由共用的存取守衛（單一事實來源）。
 *
 * 原本只有 `/api/tutor/chat` 需要這個檢查；加入「練習上下文」及教師統計後，
 * 若每個路由各自複製一份，日後調整名冊或角色規則時很容易只改到其中一處，
 * 於是出現「聊天要名冊、練習上下文不用」這類不一致。集中在這裡，
 * 所有學伴路由都必須經同一支守衛。
 *
 * 規則（與 2026-10-27 起的既有行為完全相同）：
 *   - 未登入 → 401；
 *   - 教師／管理員 → 放行（供科組測試，記錄屬於自己的 `teacher:`／`admin:` learnerId）；
 *   - 學生 → 必須已完成名冊核對，否則 403。
 *
 * 學習者身分**只**由已簽署的工作階段推導，永不接受前端傳來的 learnerId。
 */
import { ApiRouteError } from "../http";
import { requireStudentOrTeacher } from "../auth/guards";

export async function requireTutorLearnerId(request: Request): Promise<string> {
  const actor = await requireStudentOrTeacher(request);
  if (!actor.user) throw new ApiRouteError("請先以學校 Google 帳戶登入", 401);
  if (actor.user.role === "student" && !actor.user.rosterVerified) {
    throw new ApiRouteError(
      "你的帳戶尚未完成學生名冊核對，暫不可使用學伴；請聯絡歷史科老師。",
      403,
    );
  }
  if (actor.learnerId === null) {
    throw new ApiRouteError("登入工作階段缺少有效的學生身分", 401);
  }
  return actor.learnerId;
}
