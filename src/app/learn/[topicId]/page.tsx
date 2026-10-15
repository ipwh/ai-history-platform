import Link from "next/link";

import { Notice } from "@/components/ui";
import { guardStudentPage } from "@/server/auth/guards";
import { LessonServiceError, getLessonView } from "@/server/services/lesson-service";

/**
 * 學生閱讀教材（學習模式）。
 *
 * 讓學生在作答之前先讀一次該課題的教材內容，令自學流程完整（先學習、後練習）。
 * 內容**原樣取自已匯入的教材**，不經 AI 改寫：教材是唯一經教師採用的史實來源，
 * 自動改寫可能加入未經核實的歷史陳述。
 */
export default async function LessonPage({
  params,
}: {
  params: Promise<{ topicId: string }>;
}) {
  const { topicId } = await params;
  await guardStudentPage(`/learn/${topicId}`);

  let lesson;
  try {
    lesson = getLessonView(topicId);
  } catch (error) {
    const status = error instanceof LessonServiceError ? error.status : 500;
    return (
      <div className="flex flex-col gap-4">
        <ErrorBlock
          message={
            error instanceof LessonServiceError
              ? error.message
              : "載入教材時發生問題，請稍後再試。"
          }
          status={status}
        />
      </div>
    );
  }

  return (
    <article className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-gray-600">
          {lesson.topic.levelLabel}
          {lesson.topic.themeTitle.length > 0 ? `｜${lesson.topic.themeTitle}` : ""}
        </p>
        <h1 className="text-xl font-bold">{lesson.topic.title}</h1>
        <p className="text-sm text-gray-600">
          以下內容取自教師採用的教材，方便你先閱讀、後練習。
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        <Link href={`/practice/new?topic=${lesson.topic.id}`} className="btn btn-primary">
          開始練習這個課題
        </Link>
        <Link href="/" className="btn">
          返回課題列表
        </Link>
      </nav>

      {lesson.hasOcrText ? (
        <Notice tone="warning">
          部分內容由圖片文字辨識（OCR）產生，可能與課本原文有出入。如發現文字有誤，請以課本為準。
        </Notice>
      ) : null}

      {lesson.notice !== null ? <Notice tone="warning">{lesson.notice}</Notice> : null}

      {lesson.sections.map((section) => (
        <section
          key={section.id}
          className="card flex flex-col gap-3"
          style={section.depth > 0 ? { marginLeft: "1rem" } : undefined}
        >
          <h2 className={section.depth > 0 ? "font-semibold" : "text-lg font-bold"}>
            {section.title}
          </h2>

          {section.blocks.map((block) => {
            if (block.type === "heading") {
              const Heading = block.level !== null && block.level <= 3 ? "h3" : "h4";
              return (
                <Heading key={block.id} className="font-semibold mt-1">
                  {block.text}
                </Heading>
              );
            }

            if (block.type === "table" && block.rows.length > 0) {
              return (
                <div key={block.id} className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <tbody>
                      {block.rows.map((row, rowIndex) => (
                        // 表格列沒有穩定 ID，以次序作 key（內容不會重新排序）
                        <tr key={`${block.id}-r${rowIndex}`} className="align-top">
                          {row.map((cell, cellIndex) => (
                            <td
                              key={`${block.id}-r${rowIndex}-c${cellIndex}`}
                              className="border px-2 py-1"
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            }

            if (block.type === "list") {
              const items = block.text
                .split("\n")
                .map((item) => item.trim())
                .filter((item) => item.length > 0);
              return (
                <ul key={block.id} className="list-disc pl-5 flex flex-col gap-1 text-sm">
                  {items.map((item, itemIndex) => (
                    <li key={`${block.id}-i${itemIndex}`}>{item}</li>
                  ))}
                </ul>
              );
            }

            if (block.text.trim().length === 0) return null;

            return (
              <p key={block.id} className="text-sm leading-relaxed whitespace-pre-wrap">
                {block.text}
              </p>
            );
          })}
        </section>
      ))}

      <footer className="text-xs text-gray-500">
        內容來源為教師匯入的教材；如對內容有疑問，請向歷史科教師查詢。
      </footer>
    </article>
  );
}

function ErrorBlock({ message, status }: { message: string; status: number }) {
  return (
    <section className="card flex flex-col gap-3">
      <h1 className="text-lg font-bold">暫時未能顯示教材</h1>
      <p className="text-sm text-gray-700">{message}</p>
      {status === 404 ? (
        <p className="text-sm text-gray-600">
          這個課題可能尚未開放，或教材仍未匯入。你可以先返回課題列表選擇其他課題。
        </p>
      ) : null}
      <p className="text-sm">
        <Link href="/" className="btn">
          返回課題列表
        </Link>
      </p>
    </section>
  );
}
