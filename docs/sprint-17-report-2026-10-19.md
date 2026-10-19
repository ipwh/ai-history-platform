# Sprint 17 報告：審核工作台驗證與 provenance 裁決契約

日期：2026-10-19
起始／結束 HEAD：`6895db9`（`main`，`origin/main` 相同；未 commit／未 push）
發布狀態：**NOT READY**（維持）

> 【實測】／【靜態】／【未驗證】／【需決策】

---

## 1. Git 狀態

| 項目 | 起始【實測】 | 結束【實測】 |
| --- | --- | --- |
| Branch / HEAD / `origin/main` | `main` / `6895db9` / `6895db9` | 相同 |
| 未提交 | **91（25 modified + 66 untracked）** | **94（25 modified + 69 untracked）** |

Sprint 9–16 的 91 項全部保留；本 Sprint **只新增 2 個文件檔案**，沒有改動任何應用程式碼、schema、題目或審核紀錄。

## 2. Sprint 17 變更

| 檔案 | 內容 |
| --- | --- |
| `docs/teacher-review/provenance-adjudication-design-2026-10-19.md` | 623 題 provenance 裁決的契約設計（決定值、必填證據、授權、冪等、失效、gate 關係），**實作 BLOCKED** |
| `docs/teacher-review/workbench-verification-2026-10-19.md` | UI 自動化約束＋最小方案、無障礙程式碼檢視、角色行為 |
| `docs/sprint-17-report-2026-10-19.md` | 本報告 |

繼承自 Sprint 9–16 的 91 項未提交成果完整保留（沒有 reset／clean／覆蓋／格式化）。

## 3. 瀏覽器／UI 測試：**未加入（已記錄約束及最小方案）**

【實測】`package.json` 及 `node_modules` 沒有 Playwright／Puppeteer／Cypress／Testing Library／jsdom／axe；
既有 `scripts/e2e-flow.mjs` 是 HTTP 腳本，不渲染 React。

依指示**沒有安裝新依賴**。最小方案已寫入 [workbench-verification](teacher-review/workbench-verification-2026-10-19.md) §1：
`@playwright/test`、`next start`＋暫存 DB／uploads、簽發三種角色 cookie、5 個案例（佇列／分頁、缺報告狀態、servability 表單與 409、Golden 必填與錯誤、角色拒絕）、成本與風險。
**UI 自動化覆蓋 = `UNVERIFIED`**；API 測試通過不等於 UI 已驗證。

## 4. 無障礙與教師可用性

【靜態】程式碼檢視（詳見驗證文件 §3）：

**已具備**：所有輸入有 `<label>`；佇列計數／訊息有 `aria-live`；原生控件可鍵盤操作；`role="tab"`＋`aria-selected`；狀態以文字而非顏色區分；既有覆核歷史獨立於新表單。

**缺口（未修正）**：提交後／409 後沒有焦點移動；錯誤沒有 `aria-describedby`／`aria-invalid`；沒有 axe 掃描；切換佇列會丟失未提交理由；**沒有真實教師試用 → teacher usability `UNVERIFIED`**。

未修正原因：屬 UI 行為改動，應與瀏覽器測試一併驗證，避免無測試情況下改動已通過 API 契約的介面。

## 5. Provenance 裁決：**設計完成，實作暫緩（BLOCKED）**

契約設計（[provenance-adjudication-design](teacher-review/provenance-adjudication-design-2026-10-19.md)）已定義：

- 不重用 servability／Golden／發布覆核三種既有語義（避免一個「已覆核」被另一語義引用）。
- 概念決定：未覆核／證據不足／已核實修復語義／需修正／拒絕；**在 schema 契約批准前不得成為 API enum**。
- 必填證據：revision＋fingerprint（伺服器計算）、來源核實結果及參考、空格位置與映射、可接受答案及正規化、grading points／semantics、理由 ≥ 20 字、明確 `missing_evidence`（不得以猜測填補）。
- 授權：`HISTORY_REVIEWER_EMAILS`；冪等（相同決定＋理由回 `created:false`）；版本改變 → `stale`；只新增。
- 明確：provenance 決定**不會**令題目可派發，也不通過版權或部署閘門。

**BLOCKED 原因（需負責人批准）**：① 新資料表＋migration（未獲授權執行 migration）；② 決定值與「是否影響 gate」的映射（政策第 3 項）；③ P1 grading 語義須教師提供；④ 未批准即加 API 會造成第三套審核來源。

解除條件已列於設計文件 §6。

## 6. 更新後數量（重新核實，與 Sprint 16 一致）【實測】

| 項目 | 數量 |
| --- | --- |
| 不可作答題目 | **97**（96 Roman、1 答案外洩） |
| 623 題 provenance | P1 **530**／P3 **93**；與來源待核實重疊 **124**（交集，不另計） |
| Golden | 42 候選／**0 approved**／0 stale；`golden:eval` = `INSUFFICIENT_EVIDENCE` |
| 政策決定 | **13 項全部 `UNASSIGNED`**（本 Sprint 沒有虛構批准） |

## 7. 測試與指令【實測】

| 命令 | 退出碼 | 結果 |
| --- | --- | --- |
| `npm test` | 0 | **91 檔；1,229 通過、4 略過（1,233）** |
| `npm run release:gate` | 0 | **NOT READY**（15 項） |
| `npx vitest run tests/review-queue.test.ts`（Sprint 16 既有） | 0 | 8 通過 |
| `tests/authz-negative.test.ts`、`tests/servability-adjudication.test.ts`、`tests/golden-approval.test.ts`、`tests/read-only-cli.test.ts`、`tests/read-only-sidecar.test.ts` | 0 | 150／12／9／7／6 通過（繼承） |
| UI 瀏覽器測試 | — | **未執行**（無框架，未安裝） |
| E2E | — | **本 Sprint 未重新執行**（沒有應用程式碼變更）；上一次 Sprint 16 實測為 128／0 |

`typecheck`／`lint`／`build` 本 Sprint 未重新執行，因為沒有任何程式碼變更；上一次 Sprint 16 全部通過。**這不是本次驗證結果**，如實標示。

## 8. Release gate 與阻塞

15 項、**NOT READY**：PASS 4／FAIL 1（servability 97）／POLICY_PENDING 6（來源 877、解釋 1,334＋546、元數據 1,880、審核來源 623、結構裁決 97、provenance 530）／WARN 1（版權 12/36）／INSUFFICIENT 3（Golden×2、deployment）。本 Sprint 沒有新增或修改 gate，也沒有一個 gate 因新文件而改變。

## 9. 政策決策包

13 項全部仍 `UNASSIGNED`（維持安全預設）。本 Sprint 新增的設計文件使第 3 項（P1／P3 覆核政策）與第 11 項（CLI 契約）更具體，但**沒有**作出任何決定。

## 10. 未驗證項目

UI 自動化與真人可用性、無障礙正式審核（axe／讀屏）、provenance 裁決實作、政策 B、CI、多執行個體 SQLite、`export-production-snapshot`／`pilot-deepseek`、P1 grading 語義逐題確認。

## 11. 驗收對照

1. 既有工作完整保留 — 是。
2. UI 自動化覆蓋或具體方案 — **未加入，已提交最小方案**。
3. 表單保留授權／版本／指紋保護 — 是（Sprint 16 測試仍通過）。
4. Provenance 有明確可稽核契約才引入寫入 API — **契約已設計，實作暫緩**。
5. 覆核不改變題目內容或發布狀態 — 是（無任何寫入）。
6. 數量一致並正確處理重疊 — 是（124 為交集）。
7. 新行為有回歸測試 — 本 Sprint 無新行為；設計文件不需測試。
8. 未驗證項目如實標示 — 是。
9. Gate 維持 `NOT READY` — 是。

## 12. 環境聲明

- **沒有存取或修改生產資料庫**、**沒有執行任何 migration**（含生產及本機）。
- **沒有部署、沒有 commit、沒有 push**；沒有呼叫付費 AI API；沒有建立假教師、假裁決或 Golden 核准。
- 沒有安裝新依賴。
- 結束 `git status --short`：**94 項（25 modified + 69 untracked）**。
