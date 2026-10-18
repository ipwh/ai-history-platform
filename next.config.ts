import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { NextConfig } from "next";

/**
 * tesseract.js 的 worker 會在執行時以 `require()` 載入自身的相依套件
 * （例如 bmp-js），靜態分析無法追蹤。這裡直接讀取其 package.json 的 dependencies，
 * 令追蹤清單隨套件更新自動調整，避免容器內 OCR 因缺少模組而失敗。
 */
function tesseractDependencyGlobs(): string[] {
  try {
    const manifestPath = path.join(process.cwd(), "node_modules", "tesseract.js", "package.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    return Object.keys(manifest.dependencies ?? {}).map(
      (name) => `./node_modules/${name}/**/*`,
    );
  } catch {
    return [];
  }
}

/**
 * 開發模式允許的本機來源（`allowedDevOrigins`）。
 *
 * Next.js 16 預設只准 `localhost` 存取開發專用資源（包括 HMR WebSocket）。
 * 以 `127.0.0.1` 或區網 IP 開啟時，HMR 會被攔截：
 *
 *   ⚠ Blocked cross-origin request to Next.js dev resource /_next/hmr from "127.0.0.1"
 *
 * 其後果不是錯誤訊息，而是**頁面不停重新載入**（HMR 連不上 → 用戶端反覆重試／重載），
 * 2026-10-18 實際發生。這裡自動加入所有本機 IPv4 位址（含 127.0.0.1、區網 IP），
 * 令任何本機開啟方式都可以正常使用；只影響開發模式，正式建置不會讀取這項設定。
 */
function localDevOrigins(): string[] {
  const origins = new Set<string>(["127.0.0.1"]);
  for (const addresses of Object.values(os.networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) origins.add(address.address);
    }
  }
  return [...origins];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: localDevOrigins(),
  /**
   * 本網站的頁面及 API 每次請求都會讀取本機 SQLite 資料庫，屬於「完全動態」的應用，
   * 因此關閉 Cache Components（`cacheComponents`）。
   *
   * 若開啟 `cacheComponents`，Next.js 會要求所有未快取的資料都放在 <Suspense> 內，
   * 而且 Route Handler 不能設定 `runtime`；對本專案的用途沒有好處。
   * 詳情可參考 node_modules/next/dist/docs 內的 caching 說明。
   */
  cacheComponents: false,
  /**
   * 這些套件需要在執行時由 node_modules 直接載入，不經打包：
   *   - tesseract.js：會建立 worker thread 並以相對路徑載入 WASM 與語言資料，
   *     打包後路徑會失效，導致 OCR 工作無法啟動。
   *   - unpdf / pdfjs：內含自己的 worker 檔案，同樣需要保持獨立。
   */
  serverExternalPackages: ["tesseract.js", "unpdf"],
  /**
   * 產生自足式（standalone）輸出，供 Docker／Cloud Run 使用：
   * `.next/standalone` 只包含執行所需的檔案，啟動方式為 `node .next/standalone/server.js`。
   */
  output: "standalone",
  /**
   * 上述獨立套件會以相對路徑在執行時載入 WASM、worker 及語言資料，
   * 靜態分析無法追蹤，因此明確加入所有 route 的追蹤清單，避免容器內 OCR／PDF 解析失效。
   */
  outputFileTracingIncludes: {
    "/**": [
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/unpdf/**/*",
      "./node_modules/pdfjs-dist/**/*",
      ...tesseractDependencyGlobs(),
    ],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
