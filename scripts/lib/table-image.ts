/**
 * 把練習表格渲染成 JPG（供存檔及在手機／即時通訊分享）。
 *
 * 為甚麼用 Playwright／Chromium 而不是自製圖片編碼器：
 *   - 表格含中文，需要字型光柵化；純 Node 沒有內建字型引擎，自行實作會非常龐大；
 *   - Playwright 已是本專案的開發依賴（UI 測試在用），Chromium 的
 *     `page.screenshot({ type: "jpeg" })` 可直接輸出 JPEG，不需要額外原生套件
 *     （sharp／canvas 皆要編譯或下載二進位檔）。
 *
 * 邊界：本模組只讀取記憶體中的表格資料並寫出一個本機檔案；不載入任何外部網址、
 * 不執行頁面內的第三方指令碼（`setContent` 使用靜態 HTML，沒有 `<script>`）。
 */
import fs from "node:fs";

export interface PracticeTableImage {
  /** 標題（例如「中四 本週累計」） */
  title: string;
  /** 副標題（日期範圍等） */
  subtitle: string;
  /** 統計摘要行（可為空） */
  summary: string[];
  columns: string[];
  rows: string[][];
  /** 表格下方的說明（口徑等） */
  notes: string[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 建立表格的 HTML（可直接測試；不含 script）。
 *
 * 準確率低於 60% 的列會標示顏色，令教師在分享的圖片上一眼看到需要跟進的學生；
 * 這個標示只影響圖片，Excel 與電郵正文的數字不受影響。
 */
export function buildPracticeTableHtml(image: PracticeTableImage): string {
  const accuracyIndex = image.columns.indexOf("準確率");
  const bodyRows = image.rows
    .map((row) => {
      const cells = row
        .map((cell) => `<td>${escapeHtml(cell)}</td>`)
        .join("");
      const accuracy =
        accuracyIndex >= 0 ? Number.parseFloat((row[accuracyIndex] ?? "").replace("%", "")) : NaN;
      const low = Number.isFinite(accuracy) && accuracy < 60;
      return `<tr${low ? ' class="low"' : ""}>${cells}</tr>`;
    })
    .join("\n");
  const head = image.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const summary = image.summary.filter((line) => line.trim().length > 0);
  const notes = image.notes.filter((line) => line.trim().length > 0);

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(image.title)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 28px 32px 24px;
    background: #ffffff;
    color: #111827;
    font-family: "Microsoft JhengHei", "Noto Sans TC", "PingFang HK", "Segoe UI", sans-serif;
    font-size: 15px;
  }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: 0.5px; }
  .subtitle { color: #4b5563; font-size: 14px; margin-bottom: 10px; }
  .summary { display: flex; flex-wrap: wrap; gap: 18px; margin: 0 0 14px; padding: 10px 14px;
    background: #f3f4f6; border-radius: 8px; font-size: 14px; color: #1f2937; }
  .summary span strong { font-size: 16px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 7px 10px; text-align: right; white-space: nowrap; }
  th:nth-child(1), td:nth-child(1), th:nth-child(2), td:nth-child(2) { text-align: left; }
  thead th { background: #1f2937; color: #ffffff; font-weight: 600; border-bottom: none; }
  tbody tr:nth-child(even) { background: #f9fafb; }
  tbody tr.low td { color: #b91c1c; }
  tbody tr.low td:nth-child(-n+2) { color: #111827; }
  .notes { margin-top: 12px; font-size: 12px; color: #6b7280; line-height: 1.7; }
  .notes div::before { content: "※ "; }
</style>
</head>
<body>
  <h1>${escapeHtml(image.title)}</h1>
  <div class="subtitle">${escapeHtml(image.subtitle)}</div>
  ${
    summary.length > 0
      ? `<div class="summary">${summary
          .map((line) => {
            const separator = line.indexOf("：");
            return separator > 0
              ? `<span>${escapeHtml(line.slice(0, separator))}：<strong>${escapeHtml(
                  line.slice(separator + 1),
                )}</strong></span>`
              : `<span>${escapeHtml(line)}</span>`;
          })
          .join("")}</div>`
      : ""
  }
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>
${bodyRows}
    </tbody>
  </table>
  ${
    notes.length > 0
      ? `<div class="notes">${notes.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>`
      : ""
  }
</body>
</html>`;
}

/** 以 Chromium 渲染並輸出 JPEG；失敗時拋出可讀原因 */
export async function renderPracticeTableJpeg(
  image: PracticeTableImage,
  outputPath: string,
  options: { quality?: number } = {},
): Promise<void> {
  let chromium: typeof import("@playwright/test").chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch {
    throw new Error(
      "未安裝 Playwright（npm ci 應已包含）。請執行 npm install 後重試。",
    );
  }

  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 1180, height: 900 },
      deviceScaleFactor: 2,
    });
    await page.setContent(buildPracticeTableHtml(image), { waitUntil: "load" });
    await page.screenshot({
      path: outputPath,
      type: "jpeg",
      quality: options.quality ?? 92,
      fullPage: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Executable doesn't exist|browserType\.launch/i.test(message)) {
      throw new Error(
        `未能啟動 Chromium 產生 JPG：${message.split("\n")[0]}。` +
          "請執行 npx playwright install chromium 後重試。",
      );
    }
    throw new Error(`未能產生 JPG：${message.split("\n")[0]}`);
  } finally {
    await browser?.close().catch(() => undefined);
  }

  // 確認真的是 JPEG（避免把 HTML 錯誤頁當成圖片存檔）
  const header = Buffer.alloc(3);
  const handle = fs.openSync(outputPath, "r");
  try {
    fs.readSync(handle, header, 0, 3, 0);
  } finally {
    fs.closeSync(handle);
  }
  if (header[0] !== 0xff || header[1] !== 0xd8 || header[2] !== 0xff) {
    throw new Error("產生的檔案不是 JPEG（檔頭不正確）。");
  }
}
