import type { Metadata, Viewport } from "next";

import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "歷史科自學網站 ｜ 香港中學歷史科（中一至中三）",
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
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
