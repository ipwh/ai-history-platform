/**
 * 建置產物檢查：不得有任何頁面被預先渲染成靜態檔。
 *
 * 為甚麼需要這個檢查（2026-10-20 實際缺陷）：
 * 每個頁面都依賴執行時的登入憑證、工作階段 cookie 及資料庫。雲端建置（Cloud Build）
 * 與 CI 的環境**沒有** `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET`（只在執行時注入），
 * 因此後台守衛在該環境會看到「登入未設定」，把
 * `redirect("/login?error=not_configured&next=…")` 預先渲染成靜態頁面。
 * 部署後已登入的管理員開 /admin 或 /teacher/** 會不停往返登入頁（無限重新載入）。
 *
 * 這個檢查在 `next build` 之後執行：只要 `.next/server/app` 內出現任何頁面 HTML
 * （`_global-error` 等 Next.js 內建頁面除外），就代表某個頁面又脫離了動態渲染
 * （例如日後移除了 `src/app/layout.tsx` 的 `dynamic = "force-dynamic"`）。
 *
 * 用法：npm run verify:build（CI 及部署前都應執行）
 */
import fs from "node:fs";
import path from "node:path";

const APP_DIR = path.join(process.cwd(), ".next", "server", "app");
/** Next.js 內建的靜態頁面，不屬於應用程式路由 */
const ALLOWED = new Set(["_global-error.html", "_not-found.html", "_404.html"]);

if (!fs.existsSync(APP_DIR)) {
  console.error(`找不到建置產物：${APP_DIR}（請先執行 npm run build）`);
  process.exit(1);
}

const walk = (directory) => {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...walk(full));
    else if (entry.name.endsWith(".html")) {
      found.push(path.relative(APP_DIR, full).split(path.sep).join("/"));
    }
  }
  return found;
};

const prerendered = walk(APP_DIR)
  .filter((file) => !ALLOWED.has(file))
  .sort();

if (prerendered.length > 0) {
  console.error("建置產物含預先渲染的頁面，頁面將使用建置時的環境（沒有登入憑證）：");
  for (const file of prerendered) console.error(`  - ${file}`);
  console.error(
    "\n所有頁面必須動態渲染（見 src/app/layout.tsx 的 dynamic = \"force-dynamic\"）。",
  );
  process.exit(1);
}

console.log(`✓ 沒有頁面被預先渲染（檢查 ${APP_DIR}）`);
