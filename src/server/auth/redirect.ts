import { safeInternalPath } from "@/lib/safe-internal-path";

/**
 * 登入後導向路徑的檢查。
 *
 * 登入流程會把「返回路徑」經 query string 傳入，最終由伺服器回傳 302。
 * 實際的檢查邏輯放在 `src/lib/safe-internal-path.ts`（練習 → 學伴的
 * `?returnTo=` 亦共用同一把尺，見 `TutorView`），這裡只補上
 * 「不合法就退回網站首頁」的預設。
 */
export function safeNextPath(value: string | null | undefined): string {
  return safeInternalPath(value) ?? "/";
}
