# 香港中學歷史科自學平台 —— Google Cloud Run 映像檔
#
# 建置方式（在本機測試）：
#   docker build -t hk-history-self-study .
#   docker run --rm -p 8080:8080 --env-file .env.docker hk-history-self-study
#
# Cloud Run 部署建議使用 scripts/deploy-cloud-run.ps1 或 cloudbuild.yaml（見 README「Google Cloud Run 部署」）。

# ---------------------------------------------------------------------------
# 1. 安裝依賴（只安裝鎖定版本，並保留快取層）
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# 2. 建置 Next.js（standalone 輸出，只需 runtime 檔案）
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# 3. 執行環境（最小映像檔；不需 devDependencies）
#    注意：Cloud Run 的容器檔案系統不會保留資料，因此資料庫、上載教材及 OCR
#    快取預設寫入 /tmp（重啟即清空）。正式使用請改掛 Cloud SQL／Filestore／
#    Cloud Storage，並以環境變數指向。
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0 \
    APP_DATABASE_PATH=/tmp/data/app.db \
    APP_UPLOADS_DIR=/tmp/data/uploads \
    APP_MATERIALS_DIR=/app/materials \
    OCR_CACHE_PATH=/tmp/data/ocr-cache \
    OCR_LANG_PATH=/app/ocr-lang

# 本機 OCR 語言資料：建置時下載 chi_tra.traineddata，令容器離線亦可執行 OCR。
# 如建置環境無法連線，映像檔仍會成功建置，首次 OCR 時才由網絡下載。
ARG OCR_LANG_URL=https://github.com/tesseract-ocr/tessdata_fast/raw/main/chi_tra.traineddata
RUN mkdir -p /app/ocr-lang /tmp/data \
    && OCR_LANG_URL="${OCR_LANG_URL}" node -e "\
const fs = require('node:fs');\
fetch(process.env.OCR_LANG_URL).then(async (res) => {\
  if (!res.ok) throw new Error('HTTP ' + res.status);\
  fs.writeFileSync('/app/ocr-lang/chi_tra.traineddata', Buffer.from(await res.arrayBuffer()));\
  console.log('已下載 OCR 語言資料：chi_tra.traineddata');\
}).catch((error) => {\
  console.log('警告：未能下載 OCR 語言資料（' + error.message + '），首次執行 OCR 時會改用網絡下載');\
});" \
    && chown -R node:node /app /tmp/data

# standalone 輸出（含最小化的 node_modules）＋ 靜態資源 ＋ 教材來源檔案
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/materials ./materials

USER node
EXPOSE 8080

# Cloud Run 會以 HTTP 健康檢查探測；/api/health 只回報狀態，不會洩漏憑證
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
