import { authStatusSchema } from "@/lib/types";
import { getServerConfig } from "@/server/config";
import { getSessionUser } from "@/server/auth/session";
import { handleRoute, jsonOk } from "@/server/http";

export const runtime = "nodejs";

/** 目前的登入狀態：前端用來顯示帳戶及決定是否顯示登入按鈕 */
export async function GET() {
  return handleRoute(async () => {
    const { auth } = getServerConfig();
    const user = await getSessionUser();
    return jsonOk(
      authStatusSchema.parse({
        enabled: auth.enabled,
        requireSignIn: auth.requireSignIn,
        schoolDomains: auth.schoolDomains,
        user,
      }),
    );
  });
}
