"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { api, forgetLearner } from "@/lib/api-client";
import { SIGN_IN_ROLE_LABELS, type AuthStatus } from "@/lib/types";
import { ErrorNotice, Loading } from "@/components/ui";

/**
 * 我的帳戶：登入狀態及登出。
 *
 * 練習記錄由伺服器依登入身分保存，前端無法選擇或刪除他人的記錄。
 */
export function AccountView() {
  const router = useRouter();
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    api
      .get<AuthStatus>("/api/auth/session")
      .then(setAuth)
      .catch(setError);
  }, []);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    try {
      await api.post("/api/auth/sign-out", {});
      forgetLearner();
      router.replace("/login");
      router.refresh();
    } catch (caught) {
      setError(caught);
    } finally {
      setSigningOut(false);
    }
  }, [router]);

  if (!auth) {
    return error ? <ErrorNotice error={error} /> : <Loading label="正在載入帳戶資料…" />;
  }

  const role = auth.user?.role ?? null;
  const isStudent = role === "student";
  const isAdmin = role === "admin";
  const isStaff = role === "teacher" || isAdmin;
  const roleLabel = isAdmin ? "管理員" : "教師";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">我的帳戶</h1>

      {error ? <ErrorNotice error={error} /> : null}

      <section className="card flex flex-col gap-2 text-sm">
        <h2 className="font-semibold">登入狀態</h2>
        {auth.enabled ? (
          auth.user ? (
            <>
              <p>
                帳戶：<span className="font-medium">{auth.user.email}</span>
              </p>
              <p>
                身分：
                <span className="badge badge-accent ml-1">
                  {SIGN_IN_ROLE_LABELS[auth.user.role]}
                </span>
                {isStaff ? (
                  <span className="ml-2 text-gray-600">
                    {roleLabel}帳戶可使用全部學生端功能作測試，練習記錄只屬於你的{roleLabel}帳戶。
                  </span>
                ) : null}
              </p>
              <p className="text-gray-600">
                學習記錄會儲存在你的帳戶之下，並供歷史科教師查閱及下載；系統不會顯示其他學生的記錄。
              </p>
              {isStudent ? (
                <p>
                  班別／班號：
                  <span className="font-medium ml-1">
                    {[auth.user.className, auth.user.studentNumber].filter(Boolean).join(" ") ||
                      "未提供"}
                  </span>
                  <span className="ml-2">
                    {auth.user.rosterVerified ? (
                      <span className="badge badge-success">已在學生名冊核對</span>
                    ) : (
                      <span className="badge badge-warning">名冊未核對</span>
                    )}
                  </span>
                </p>
              ) : null}
              {isStudent && auth.user.rosterVerified ? (
                <p className="text-gray-600">
                  班別及班號來自歷史科學生名冊（Google Sheet），只用於顯示及教師核對，不會顯示其他學生資料。
                </p>
              ) : null}
            </>
          ) : (
            <p>
              未登入。
              <Link href="/login" className="btn ml-2">
                以學校 Google 帳戶登入
              </Link>
            </p>
          )
        ) : (
          <p className="text-gray-600">
            目前未啟用學校帳戶登入（本機示範模式）：學習記錄以瀏覽器隨機 ID 儲存，
            只在這部電腦有效，亦不會包含任何個人資料。
          </p>
        )}
      </section>

      <section className="card flex flex-col gap-3 text-sm">
        <h2 className="font-semibold">登出</h2>
        <p className="text-gray-600">
          練習記錄會保留在學校系統內，供歷史科教師查閱及下載，登出不會刪除記錄。
        </p>
        <div className="flex flex-wrap gap-2">
          {auth.enabled && auth.user ? (
            <button type="button" className="btn" onClick={handleSignOut} disabled={signingOut}>
              {signingOut ? "登出中…" : "登出"}
            </button>
          ) : null}
          {isStaff ? (
            <Link href="/teacher" className="btn btn-primary">
              前往教師端
            </Link>
          ) : null}
          {isAdmin ? (
            <Link href="/admin" className="btn btn-primary">
              前往管理員端
            </Link>
          ) : null}
        </div>
      </section>
    </div>
  );
}
