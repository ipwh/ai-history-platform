/**
 * `/tutor` 頁面守衛測試。
 *
 * 契約：未登入時由**伺服器端**導向登入頁，而不是先送出介面骨架再由前端收到 401。
 * 其他學生頁面（`/`、`/review`、`/account`）一向如此；學伴頁面原本是 client component，
 * 守衛只靠 API，因此補上這個測試避免日後退回同一狀態。
 */
import { describe, expect, it } from "vitest";
import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("tutor-page-guard");
process.env.AUTH_SECRET = "tutor-page-guard-secret-0123456789abcdef";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_REQUIRE_SIGN_IN = "true";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.LLM_PROVIDER = "mock";

/** Next 的 redirect() 以帶 digest 的錯誤中止渲染；只斷言 digest，避免依賴訊息文字 */
async function redirectDigest(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const digest = (error as { digest?: unknown }).digest;
    if (typeof digest === "string") return digest;
    throw error;
  }
  throw new Error("预期頁面守衛會中止渲染並導向登入頁，但頁面正常完成");
}

describe("/tutor 頁面守衛", () => {
  it("未登入時在伺服器端導向登入頁，並帶上 /tutor 作返回路徑", async () => {
    const { default: TutorPage } = await import("@/app/tutor/page");

    const digest = await redirectDigest(TutorPage());

    expect(digest).toContain("NEXT_REDIRECT");
    expect(digest).toContain("%2Ftutor");
  });
});
