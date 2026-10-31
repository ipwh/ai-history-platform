import type { Metadata, Viewport } from "next";

import { AppShell } from "@/components/AppShell";
import { BROWSER_SUPPORT_NOTICE, buildLegacyBrowserWatchdogScript } from "@/lib/browser-support";
import "./globals.css";

export const metadata: Metadata = {
  title: "歷史科自學網站 ｜ 香港中學歷史科（中一至中六）",
  description:
    "香港中學歷史科自學平台：選擇課題及分節、題型、難度及題數，完成練習後可查看答案、解釋、知識點及教材來源。",
};

/**
 * 所有頁面一律動態渲染。
 *
 * 為甚麼不可讓 Next.js 在建置時預先渲染（2026-10-20 實際缺陷）：
 * 每個頁面都依賴**執行時**的環境設定（登入憑證）、工作階段 cookie 及資料庫。
 * 雲端建置（Cloud Build）的環境沒有 `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET`
 * （兩者只在 Cloud Run 執行時由 Secret Manager 注入），於是後台守衛在建置時看到
 * 「登入未設定」，把 `redirect("/login?error=not_configured&next=…")` **預先渲染成靜態頁面**。
 * 部署後：已登入的管理員開啟 `/admin` 或 `/teacher/**` → 靜態頁面把他送回登入頁 →
 * 登入頁看見已有工作階段，再導向 originally requested 的 `/teacher` → 無限循環重新載入。
 *
 * 同一原因亦會令其他頁面把建置時的資料庫內容／設定烘焙進靜態檔。因此這裡強制
 * 動態渲染，而不是逐一在頁面加上設定（新頁面忘記加就會再出現同一問題）。
 */
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant">
      <body className="min-h-full flex flex-col">
        {/*
          舊裝置的看門狗（Sprint 23）。伺服器輸出只含「正在載入題目…」；若瀏覽器
          無法解析 Next.js 的 client bundle（Safari 15.4 以下的引擎），React 永遠不會
          hydrate，畫面便停在載入中而且沒有錯誤訊息。這段腳本刻意只用 ES5 語法，
          因此即使框架 bundle 解析失敗它仍會執行，並在合理等待後顯示可操作的說明。

          面板本身由伺服器輸出（`hidden`），不依賴 JavaScript 才存在；沒有 JavaScript
          時由下方 <noscript> 提供同樣的說明。
        */}
        <div id="app-root">
          <AppShell>{children}</AppShell>
        </div>

        <div
          id="browser-support-fallback"
          hidden
          tabIndex={-1}
          style={{
            maxWidth: "40rem",
            margin: "2rem auto",
            padding: "1.25rem",
            border: "1px solid #c2cadb",
            borderRadius: "0.75rem",
            background: "#ffffff",
            lineHeight: 1.7,
          }}
        >
          <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem" }}>
            {BROWSER_SUPPORT_NOTICE.title}
          </h1>
          <p style={{ fontSize: "0.95rem" }}>{BROWSER_SUPPORT_NOTICE.body}</p>
          <ul style={{ listStyle: "disc", paddingLeft: "1.25rem", fontSize: "0.9rem", marginTop: "0.5rem" }}>
            {BROWSER_SUPPORT_NOTICE.actions.map((action) => (
              <li key={action} style={{ marginTop: "0.25rem" }}>
                {action}
              </li>
            ))}
          </ul>
          <p id="browser-support-detected" style={{ fontSize: "0.85rem", marginTop: "0.75rem", color: "#4b5563" }} />
          <p style={{ marginTop: "0.75rem" }}>
            <a
              href=""
              style={{
                display: "inline-block",
                padding: "0.5rem 1rem",
                borderRadius: "0.5rem",
                background: "#2f5bd7",
                color: "#ffffff",
                fontWeight: 600,
              }}
            >
              重新載入
            </a>
          </p>
        </div>

        <noscript>
          <div
            style={{
              maxWidth: "40rem",
              margin: "2rem auto",
              padding: "1.25rem",
              border: "1px solid #c2cadb",
              borderRadius: "0.75rem",
              background: "#ffffff",
              lineHeight: 1.7,
            }}
          >
            <h1 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem" }}>
              {BROWSER_SUPPORT_NOTICE.title}
            </h1>
            <p style={{ fontSize: "0.95rem" }}>{BROWSER_SUPPORT_NOTICE.body}</p>
            <p style={{ fontSize: "0.9rem", marginTop: "0.5rem" }}>
              本網站需要 JavaScript。請在瀏覽器設定中重新開啟 JavaScript，或改用其他裝置。
            </p>
          </div>
        </noscript>

        <script
          // 只含 ES5 語法（由 tests/browser-support.test.ts 檢查），刻意不用 next/script：
          // 這裡需要「框架 bundle 解析失敗時仍然執行」的保證。
          dangerouslySetInnerHTML={{ __html: buildLegacyBrowserWatchdogScript() }}
        />
      </body>
    </html>
  );
}
