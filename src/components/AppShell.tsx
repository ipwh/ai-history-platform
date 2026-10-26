"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { SchoolBrand } from "@/components/SchoolBrand";
import { api } from "@/lib/api-client";
import { SIGN_IN_ROLE_LABELS, type AuthStatus, type Health } from "@/lib/types";

/** 教師端導覽：只包含出題相關功能及學生練習記錄 */
const TEACHER_NAV_ITEMS = [
  { href: "/teacher", label: "教師端", exact: true },
  { href: "/teacher/questions", label: "題目管理", exact: false },
  { href: "/teacher/review", label: "教師審核", exact: false },
  { href: "/teacher/records", label: "學習記錄", exact: false },
];

/** 管理員端導覽：教材、OCR、課題發布及系統狀態 */
const ADMIN_NAV_ITEMS = [
  { href: "/admin", label: "管理員端", exact: true },
  { href: "/admin/materials", label: "教材管理", exact: false },
  { href: "/admin/settings", label: "課題與系統", exact: false },
];

/**
 * 全站外框：頂部導覽依身分顯示。
 *
 *   - 學生：只顯示學生端導覽（課題、練習、我的帳戶）。
 *   - 教師：另顯示教師端導覽（題目管理、學習記錄）及「學生端測試」。
 *   - 管理員：再顯示管理員端導覽（教材管理、課題與系統）。
 *   - 未啟用登入（匿名示範模式）：為方便本機測試顯示全部入口。
 *
 * 實際權限一律由伺服器端守衛決定，這裡只控制介面顯示。
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // 標記「React 已 hydrate」。根版面的舊裝置看門狗（ES5）會輪詢這個屬性：
  // 若一直未設定，代表框架 bundle 未能執行（例如 Safari 16.4 以下無法解析），
  // 由它顯示可操作的說明，避免學生只看到永遠不會結束的載入畫面。
  useEffect(() => {
    document.documentElement.setAttribute("data-app-hydrated", "1");
  }, []);

  useEffect(() => {
    api
      .get<Health>("/api/health")
      .then(setHealth)
      .catch(() => setHealth(null));
    api
      .get<AuthStatus>("/api/auth/session")
      .then(setAuth)
      .catch(() => setAuth(null));
  }, [pathname]);

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await api.post("/api/auth/sign-out", {});
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  const authEnabled = auth?.enabled === true;
  const role = authEnabled ? (auth?.user?.role ?? null) : null;
  /**
   * 未啟用登入（匿名示範模式）時，為方便本機測試仍顯示教師端及管理員端入口。
   * auth === null 代表仍在讀取登入狀態，此時只顯示學生端入口，
   * 避免學生或未登入者在載入期間短暫看到後台連結。
   */
  const demoMode = auth !== null && !authEnabled;
  const isAdmin = role === "admin";
  const isStaff = role === "teacher" || isAdmin;
  const showTeacherNav = demoMode || isStaff;
  const showAdminNav = demoMode || isAdmin;
  const onStaffPage = pathname.startsWith("/teacher") || pathname.startsWith("/admin");

  const navItems = [
    { href: "/", label: isStaff || demoMode ? "學生端測試" : "課題首頁", exact: true },
    { href: "/review", label: "重溫", exact: false },
    // 歷史自學學伴：只顯示給已登入的學生。教師／管理員的 API 一律 403
    // （見 src/lib/tutor-access.ts），因此不在此顯示，避免點了才發現不可用。
    ...(role === "student" ? [{ href: "/tutor", label: "歷史學伴", exact: false }] : []),
    ...(authEnabled ? [{ href: "/account", label: "我的帳戶", exact: false }] : []),
    ...(showAdminNav ? ADMIN_NAV_ITEMS : []),
    ...(showTeacherNav ? TEACHER_NAV_ITEMS : []),
  ];

  return (
    <div className="min-h-full flex flex-col">
      <header className="bg-white border-b" style={{ borderColor: "var(--border)" }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link href="/" aria-label="返回課題首頁">
            <SchoolBrand showSiteName />
          </Link>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            {navItems.map((item) => {
              const active = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="nav-link"
                  data-active={active ? "true" : "false"}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {health ? (
              <span
                className={`badge ${health.demoMode ? "badge-warning" : "badge-success"}`}
                title={
                  health.demoMode
                    ? "現時使用本地示範模式，不需要 API key"
                    : health.llmProviderLabel
                }
              >
                {health.demoMode ? "示範模式（無需 API key）" : health.llmProviderLabel}
              </span>
            ) : null}
            {auth?.enabled && auth.user ? (
              <span className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
                <span
                  className={`badge max-w-full truncate ${
                    auth.user.role === "student" ? "badge-success" : "badge-accent"
                  }`}
                  title={auth.user.email}
                >
                  {SIGN_IN_ROLE_LABELS[auth.user.role]}｜{auth.user.email}
                </span>
                {auth.user.role === "student" ? (
                  <span className="badge" title="來自學生名冊（班別 班號）">
                    {[auth.user.className, auth.user.studentNumber].filter(Boolean).join(" ") ||
                      (auth.user.rosterVerified ? "名冊已核對" : "名冊未核對")}
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn"
                  onClick={handleSignOut}
                  disabled={signingOut}
                >
                  {signingOut ? "登出中…" : "登出"}
                </button>
              </span>
            ) : null}
          </div>
        </div>
      </header>

      {isStaff && !onStaffPage ? (
        <div className="text-sm" style={{ background: "var(--accent-soft)" }}>
          <div className="max-w-5xl mx-auto px-4 py-2 flex flex-wrap items-center gap-2">
            <span className="badge badge-accent">{isAdmin ? "管理員測試模式" : "教師測試模式"}</span>
            <span>
              你現正以{isAdmin ? "管理員" : "教師"}身分使用學生端功能，練習記錄只屬於你的
              {isAdmin ? "管理員" : "教師"}帳戶，不會影響任何學生。
            </span>
            <Link href={isAdmin ? "/admin" : "/teacher"} className="btn ml-auto">
              返回{isAdmin ? "管理員端" : "教師端"}
            </Link>
          </div>
        </div>
      ) : null}

      <main className="flex-1 w-full max-w-5xl mx-auto px-4 py-5">{children}</main>

      {auth?.enabled ? (
        <footer className="border-t bg-white" style={{ borderColor: "var(--border)" }}>
          <div className="max-w-5xl mx-auto px-4 py-4 text-xs text-gray-500 leading-relaxed">
            <p>練習記錄會儲存在你的學校 Google 帳戶之下，並供歷史科教師查閱及下載。</p>
            {isStaff ? (
              <p className="mt-1">
                教師及管理員帳戶可使用全部學生端功能作測試；後台與學生的學習記錄以不同身分儲存，不會混用。
              </p>
            ) : null}
          </div>
        </footer>
      ) : null}
    </div>
  );
}
