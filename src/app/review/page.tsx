import Link from "next/link";

import { Notice } from "@/components/ui";
import { getRequestUser, guardStudentPage, isAuthEnabled } from "@/server/auth/guards";
import { getReviewQueue, listProgressTopics, sectionTitles } from "@/server/services/learning-loop";

/**
 * 重溫佇列（複習入口）。
 *
 * 顯示目前到期需要重溫的題目（依「每題最新一次作答結果」及已記載的重溫間隔），
 * 並提供直接重做該課題錯題的入口。
 *
 * 學習者身分**只**取自伺服器端的工作階段（`getRequestUser()`）；不接受任何前端提供的
 * 學習者 ID，因此不可能顯示其他學生的記錄。未登入時（匿名示範模式）無法得知身分，
 * 頁面會說明需要登入，而不是顯示空白的假進度。
 *
 * 注意：這裡只顯示「有多少條到期」及所屬課題／分節，不顯示題目內容或答案，
 * 亦不會因為顯示而把題目標記為已重溫——只有真正再次作答並成功提交才會有新記錄。
 */
export default async function ReviewPage() {
  await guardStudentPage("/review");
  const user = await getRequestUser();
  const learnerId = user?.learnerId ?? null;

  if (learnerId === null) {
    return (
      <section className="card flex flex-col gap-3">
        <h1 className="text-lg font-bold">重溫題目</h1>
        <Notice tone="warning">
          {isAuthEnabled()
            ? "請先登入，系統才能依你的作答記錄顯示需要重溫的題目。"
            : "目前未啟用學校帳戶登入（匿名示範模式），系統無法確認你的身分，因此未能顯示重溫佇列。啟用登入後即可使用。"}
        </Notice>
        <p className="text-sm">
          <Link href={isAuthEnabled() ? "/login" : "/"} className="btn">
            {isAuthEnabled() ? "前往登入" : "返回課題列表"}
          </Link>
        </p>
      </section>
    );
  }

  const queue = getReviewQueue(learnerId, {});
  const topics = new Map(listProgressTopics().map((topic) => [topic.id, topic.title]));

  // 依課題分組，讓學生知道要先處理哪一個課題
  const grouped = new Map<string, number>();
  for (const item of queue.dueItems) {
    grouped.set(item.topicId, (grouped.get(item.topicId) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">重溫題目</h1>
        <p className="text-sm text-gray-600">
          依你的作答記錄，以下題目已到重溫時間。重溫有助把知識留在長期記憶。
        </p>
      </header>

      {queue.dataIssues > 0 ? (
        <Notice tone="warning">
          有 {queue.dataIssues} 筆作答記錄的時間資料無法讀取，因此未計入重溫排程（不會猜測其到期日）。
        </Notice>
      ) : null}

      {queue.dueCount === 0 ? (
        <section className="card flex flex-col gap-2">
          <h2 className="font-bold">暫時沒有需要重溫的題目</h2>
          <p className="text-sm text-gray-700">
            這代表你最近作答的題目都還未到重溫時間。你可以繼續練習新的課題，之後再回來重溫。
          </p>
          <p className="text-sm">
            <Link href="/" className="btn">
              返回課題列表
            </Link>
          </p>
        </section>
      ) : (
        <>
          <section className="card flex flex-col gap-2">
            <h2 className="font-bold">共 {queue.dueCount} 條題目到期</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {[...grouped.entries()].map(([topicId, count]) => (
                <li key={topicId} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{topics.get(topicId) ?? topicId}</span>
                  <span className="text-gray-600">{count} 條</span>
                  <Link href={`/practice/new?topic=${topicId}`} className="btn">
                    重做這個課題的錯題
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <section className="card flex flex-col gap-2">
            <h2 className="font-semibold">為甚麼有些題目較早需要重溫？</h2>
            <ul className="list-disc pl-5 text-sm text-gray-700 flex flex-col gap-1">
              <li>之前答錯或答案未能確定的題目：1 天後重溫。</li>
              <li>曾答錯、最近答對的題目：3 天後重溫。</li>
              <li>一直答對的題目：7 天後重溫。</li>
            </ul>
            <p className="text-xs text-gray-500">
              這些間隔是為避免「一試定生死」而設的簡單規則，並非經實證驗證的最佳複習時間表。
            </p>
          </section>

          <section className="card flex flex-col gap-2">
            <h2 className="font-semibold">到期題目一覽</h2>
            <ul className="flex flex-col gap-1 text-sm">
              {queue.dueItems.slice(0, 20).map((item) => (
                <li key={item.questionId} className="flex flex-wrap gap-2 text-gray-700">
                  <span>{topics.get(item.topicId) ?? ""}</span>
                  <span className="text-gray-500">
                    {sectionTitles(item.topicId).get(item.sectionId) ?? ""}
                  </span>
                  <span className="text-xs text-gray-500">
                    {item.reason === "incorrect" || item.reason === "uncertain"
                      ? `上次未答對，已過 ${item.daysSince} 天`
                      : `已過 ${item.daysSince} 天`}
                  </span>
                </li>
              ))}
            </ul>
            {queue.dueItems.length > 20 ? (
              <p className="text-xs text-gray-500">其餘 {queue.dueItems.length - 20} 條未在此顯示。</p>
            ) : null}
          </section>
        </>
      )}

      <p className="text-xs text-gray-500">
        系統不會因為你查看這個頁面而把題目標記為已重溫；只有再次作答並成功提交才會有新記錄。
      </p>
    </div>
  );
}
