import Link from "next/link";

import { TutorView } from "@/components/TutorView";
import { tutorAccessState } from "@/lib/tutor-access";
import { guardStudentPage } from "@/server/auth/guards";

/**
 * 學伴頁面守衛：與其他學生頁面一致，未登入時由伺服器端導向登入頁，
 * 不把介面骨架送給未登入使用者（API 本身另有 401 檢查）。
 *
 * 教師／管理員及名冊未核對的學生會看到明確說明，而不是一個每次送出都收到
 * 403 的對話框（判斷集中在 lib/tutor-access.ts，與 API 守衛同一語意）。
 */
export default async function TutorPage() {
  const user = await guardStudentPage("/tutor");
  const access = tutorAccessState(user);

  if (access === "staff") {
    return (
      <section className="card space-y-3">
        <h1 className="text-xl font-bold">🏛️ 歷史科自學學伴 (Beta)</h1>
        <p>
          這項功能現階段<b>只開放給已核對學生名冊的學生</b>。教師及管理員帳戶暫不可使用，
          以免與學生的每日提問配額及對話記錄混用。
        </p>
        <p className="text-sm text-gray-600">
          你仍可以使用學生端的其他功能（課題、練習、重溫、學習記錄）。
        </p>
        <Link className="btn" href={user?.role === "admin" ? "/admin" : "/teacher"}>
          返回{user?.role === "admin" ? "管理員端" : "教師端"}
        </Link>
      </section>
    );
  }

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

  return <TutorView />;
}
