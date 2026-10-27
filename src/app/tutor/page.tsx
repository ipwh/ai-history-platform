import Link from "next/link";

import { TutorView } from "@/components/TutorView";
import { tutorAccessState } from "@/lib/tutor-access";
import { guardStudentPage } from "@/server/auth/guards";

/**
 * 學伴頁面守衛：與其他學生頁面一致，未登入時由伺服器端導向登入頁，
 * 不把介面骨架送給未登入使用者（API 本身另有 401 檢查）。
 *
 * 教師／管理員可以進入測試（2026-10-27 起），並看到明確標示「教師測試身分」，
 * 提醒其對話記錄、每日配額都屬於自己的教職員帳戶，不會影響任何學生。
 * 名冊未核對的學生會看到說明，而不是一個每次送出都收到 403 的對話框。
 */
export default async function TutorPage() {
  const user = await guardStudentPage("/tutor");
  const access = tutorAccessState(user);

  if (access === "unverified") {
    return (
      <section className="card space-y-3">
        <h1 className="text-xl font-bold">🏛️ 歷史科自學學伴 (Beta)</h1>
        <p>
          你的帳戶尚未完成<b>學生名冊核對</b>，因此暫不可使用學伴。請聯絡歷史科老師確認班別及學號是否已在名冊內。
        </p>
        <Link className="btn" href="/">
          返回課題首頁
        </Link>
      </section>
    );
  }

  return (
    <TutorView
      staffPreview={access === "staff-preview"}
      backHref={user?.role === "admin" ? "/admin" : "/teacher"}
    />
  );
}