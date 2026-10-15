/**
 * 登入後導向路徑的檢查（單一事實來源）。
 *
 * 登入流程會把「返回路徑」經 query string 傳入，最終由伺服器回傳 302；
 * 若不嚴加檢查，攻擊者可以用 `?next=` 把已登入的使用者導向外部網站
 * （開放式轉址，常見於以假登入頁騙取帳密的釣魚攻擊）。
 *
 * 注意：WHATWG URL 解析器對 http(s) 這類特殊協定會把反斜線視為斜線，
 * 因此 `/\evil.example.com` 會被解析成 `https://evil.example.com/`。
 * 只檢查 `startsWith("//")` 並不足以阻擋這種寫法。
 */

/** 只接受站內路徑；任何可疑寫法一律退回網站首頁 */
export function safeNextPath(value: string | null | undefined): string {
  if (typeof value !== "string") return "/";
  if (value.includes("\\")) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}
