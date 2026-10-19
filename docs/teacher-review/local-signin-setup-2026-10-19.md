# 本機登入設定指南（教師審核工作台，2026-10-19）

目的：令 `ipwh@pochiu.edu.hk` 能在本機以**真實工作階段**登入 `/teacher/review`，逐題記錄裁決。

目前狀況：`.env.local` 已有 `AUTH_SECRET`、`AUTH_ADMIN_EMAILS=ipwh@pochiu.edu.hk`、`HISTORY_REVIEWER_EMAILS=ipwh@pochiu.edu.hk`，但 **Google OAuth 用戶端憑證仍是註解狀態**，因此沒有任何可用登入路徑；匿名示範模式的 actor 是「（示範模式：未登入）」，不在審核者名單內，所有核准會回 **403**。

> 安全提醒：`GOOGLE_CLIENT_SECRET` 屬密鑰。請**直接編輯 `.env.local`**，不要貼在對話、issue 或 commit 內。`.env.local` 已被 `.gitignore` 排除。

## 步驟

1. 到 <https://console.cloud.google.com/apis/credentials> 建立「OAuth 用戶端 ID」，類型選 **網頁應用程式**。
2. 「已授權的重新導向 URI」加入（本機開發只此一條即可）：
   ```
   http://localhost:3000/api/auth/google/callback
   ```
3. 在 `.env.local` 移除以下兩行開頭的 `#`，並填入上一步取得的值：
   ```
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   ```
   （這兩行本來就在 `.env.local` 內，請勿新增重複鍵。）
4. 重新啟動開發伺服器（`npm run dev`）或測試伺服器，令新的環境變數生效。
5. 開啟 <http://localhost:3000>，以 `ipwh@pochiu.edu.hk` 登入。

## 驗證清單（登入後逐項確認）

| 檢查 | 預期 |
| --- | --- |
| `GET /api/auth/session` | `user.email` 為 `ipwh@pochiu.edu.hk`，`role` 為 `admin`（來自 `AUTH_ADMIN_EMAILS`） |
| `GET /api/teacher/review-queue?queue=servability` | `200`，`available: true`，`total: 97` |
| `/teacher/review` 頁面 | 顯示三個佇列；點選題目可看到證據與表單 |
| 提交一筆 **不影響內容** 的裁決（例如 `keep_quarantined`） | `200`；紀錄的 reviewer 為你的電郵，並綁定題目版本 |
| 以相同內容重複提交 | 不應產生誤導性重複紀錄（服務層為冪等） |

若第 4 項成功而題目仍不可派發，屬預期行為：「裁決」與「可作答性」是兩個獨立條件。

## 已知邊界

- 本機登入**不代表** staging／production 授權；那兩處的 `HISTORY_REVIEWER_EMAILS` 仍為未設定（fail closed）。
- `audit:*` CLI（`tsx`）不會載入 `.env.local`，因此 `audit:golden-readiness` 會顯示 `reviewerAllowlistConfigured: false`。這是工具與應用程式環境載入方式不同所致，不是名單失效（Sprint 19 已記錄，未修正）。
- 我不會、也不能代替你登入；憑證與登入動作必須由你完成。

## 若你不希望建立 Google OAuth 用戶端

另一個選項是新增「僅限本機、需明確開啟」的開發登入路徑。這屬於**認證功能變更**（會多一條簽發工作階段的入口），必須先完成風險評估並由你授權，本 Sprint 不會自行加入。
