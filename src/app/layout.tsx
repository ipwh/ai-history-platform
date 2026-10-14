import type { Metadata, Viewport } from "next";

import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "歷史科自學網站 ｜ 香港中學歷史科（中一至中三）",
  description:
    "香港中學歷史科自學平台：選擇課題及分節、題型、難度及題數，完成練習後可查看答案、解釋、知識點及教材來源。",
};

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
