import Link from "next/link";
import { redirect } from "next/navigation";

import { SchoolBrand, SITE_NAME } from "@/components/SchoolBrand";
import { getSessionUser } from "@/server/auth/session";
import { getServerConfig } from "@/server/config";

export const metadata = { title: "登入 ｜ 歷史科自學網站" };

/** 登入失敗時顯示的說明（代碼由 /api/auth/google/callback 提供） */
const ERROR_MESSAGES: Record<string, string> = {
  not_configured: "系統尚未設定 Google 登入憑證，請聯絡歷史科教師。",
  access_denied: "登入已取消，或你的帳戶未獲授權使用本網站。",
  invalid_state: "登入工作階段已逾時，請重新登入。",
  google_error: "Google 登入服務發生錯誤，請稍後再試。",
  timeout: "Google 登入服務回應逾時，請稍後再試。",
  token_exchange_failed: "無法完成登入，請重新登入。",
  userinfo_failed: "無法讀取 Google 帳戶資料，請稍後再試。",
  email_not_verified: "此 Google 帳戶的電郵尚未驗證，無法登入。",
  not_in_roster: "你的帳戶不在本學年的學生名冊內，請聯絡歷史科教師。",
  roster_unavailable: "學生名冊暫時無法讀取，請稍後再試。",
  outside_scope: "你的班別不在開放範圍內，請聯絡歷史科教師。",
  auth_failed: "登入失敗，請稍後再試。",
};

function safeNextPath(value: string | undefined): string {
  if (value === undefined) return "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; denied?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  const { auth } = getServerConfig();
  const user = await getSessionUser();

  if (user && params.denied !== "teacher") {
    redirect(next);
  }

  const errorMessage =
    params.denied === "teacher"
      ? "「教師端」功能只限教師及管理員帳戶使用。如需權限，請聯絡科任教師。"
      : params.denied === "admin"
        ? "「管理員端」功能只限管理員帳戶使用。如需權限，請聯絡系統管理員。"
        : params.error !== undefined
          ? (ERROR_MESSAGES[params.error] ?? ERROR_MESSAGES.auth_failed)
          : null;

  return (
    <div className="max-w-sm mx-auto flex flex-col gap-5 py-10">
      <SchoolBrand variant="stacked" />

      <section className="card flex flex-col gap-4">
        <div className="text-center">
          <h1 className="text-xl font-bold">{SITE_NAME}</h1>
          <p className="text-sm text-gray-600">以學校 Google 帳戶登入</p>
        </div>

        {errorMessage !== null ? (
          <div
            className="rounded-xl px-3 py-2 text-sm"
            style={{ background: "var(--warning-soft)", border: "1px solid #f2ddb0" }}
            role="alert"
          >
            {errorMessage}
          </div>
        ) : null}

        {auth.enabled ? (
          <a
            className="btn btn-primary w-full text-base"
            href={`/api/auth/google/start?next=${encodeURIComponent(next)}`}
          >
            以學校 Google 帳戶登入
          </a>
        ) : (
          <>
            <p className="text-sm text-center" style={{ color: "var(--danger)" }}>
              系統尚未設定 Google 登入，現以匿名模式使用。
            </p>
            {/* 未啟用登入時首頁毋須登入，才顯示返回連結；否則點下去只會回到本頁 */}
            <p className="text-sm text-center">
              <Link href="/" style={{ color: "var(--accent)" }}>
                返回課題首頁
              </Link>
            </p>
          </>
        )}
      </section>
    </div>
  );
}
