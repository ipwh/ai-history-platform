/**
 * 站內返回路徑的檢查（單一事實來源）。
 *
 * 兩個地方需要「由 A 頁帶去 B 頁，再帶回 A 頁」的路徑：
 *   1. 登入後導向（`?next=`），最終由伺服器回傳 302；
 *   2. 練習 → 學伴 → 返回該題（`?returnTo=`）。
 *
 * 兩者都不可以信任網址參數：若不嚴加檢查，攻擊者可以用 `?next=`／`?returnTo=`
 * 把已登入的使用者導向外部網站（開放式轉址，常見於以假登入頁騙取帳密的釣魚攻擊）。
 *
 * 注意：WHATWG URL 解析器對 http(s) 這類特殊協定會把反斜線視為斜線，
 * 因此 `/\evil.example.com` 會被解析成 `https://evil.example.com/`。
 * 只檢查 `startsWith("//")` 並不足以阻擋這種寫法。
 */

/** 只接受站內路徑；任何可疑寫法一律回傳 `null`（呼叫端自行決定後備行為） */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  if (value.length === 0) return null;
  if (value.includes("\\")) return null;
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//")) return null;
  return value;
}
