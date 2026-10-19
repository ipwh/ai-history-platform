# Sprint 16 報告：教師裁決工作台與端到端覆核

日期：2026-10-19
起始／結束 HEAD：`6895db9`（`main`，`origin/main` 相同，未 commit／未 push）
發布狀態：**NOT READY**（完成 UI 不代表內容、版權或部署就緒）

> 【實測】＝本次執行；【靜態】＝閱讀程式碼；【未驗證】；【需決策】。

---

## 1. Git 狀態

| 項目 | 起始【實測】 | 結束【實測】 |
| --- | --- | --- |
| Branch / HEAD / `origin/main` | `main` / `6895db9` / `6895db9` | 相同 |
| 未提交 | 84（24 modified + 60 untracked） | **91（25 modified + 66 untracked）** |

## 2. 變更檔案（區分繼承）

**繼承**：Sprint 9–15 的 84 項全部保留，沒有 reset／clean／覆蓋。

**Sprint 16 新增（5）**

| 檔案 | 用途 |
| --- | --- |
| `src/server/services/review-queue.ts` | 三個佇列的分批唯讀查詢 |
| `src/app/api/teacher/review-queue/route.ts` | 佇列 API（教師／管理員） |
| `src/app/teacher/review/page.tsx` | 工作台頁面（`guardTeacherPage`） |
| `src/components/ReviewWorkbench.tsx` | 佇列、詳情、裁決及 Golden 表單 |
| `tests/review-queue.test.ts` | 權限、分批、計數（8 項） |

**修改（1 個 tracked＋數個未提交檔案）**：`src/components/AppShell.tsx`（導覽加入「教師審核」）、`tests/authz-negative.test.ts`（新路由負向授權）、`README.md`、`docs/teacher-review/README.md`、`docs/audit-2026-10-18-platform-audit.md`、`docs/release-evidence-2026-10-19.json`、本報告。

## 3. 工作台功能與限制

**已實作**
- `/teacher/review`：三個分批佇列（servability 97、provenance 623、Golden 42），每頁 ≤ 10（API 上限 25），上一頁／下一頁，`aria-live` 計數。
- 伺服器提供 `GET /api/teacher/review-queue`：唯讀、`requireTeacher`、參數驗證（不存在 queue → 400、`pageSize>25` → 400）；報告缺失時回 `available:false` 及原因，不以推測數字代替；provenance 佇列明示「P1／P3 只是排序」。
- 單題詳情（servability）：以既有 `GET /api/teacher/questions/[id]/review` 讀取題幹、選項、答案、可接受答案、評分方式、評分要點、來源位置／段落、解釋、現有覆核歷史（獨立於新表單）、不可作答原因。
- 裁決表單：五個既有決定（含後果）、理由 ≥ 5 字、必須勾選確認、帶著 `expectedRevision` 提交；401／403／409／429 有明確訊息；409 會重新載入題目。
- Golden 表單：核准須選類別、理由 ≥ 8 字、每個錯誤選項說明 ≥ 4 字、預期 grading（由標準答案組成）、權威來源、級別；非核准決定不要求；提交帶 `expectedRevision`；明示不改發布狀態。
- 不預設核准（servability 第一個選項是空值）、不提供任何題目編輯。

**限制（未完成／未驗證）**
- **沒有自動化 UI 測試**：repo 無瀏覽器測試框架；驗證只到 typecheck、lint、build、API 測試及既有 E2E，未以真人試用。**【未驗證】**
- provenance 佇列只有證據契約顯示，沒有逐題裁決 API（需按 manifest 覆核後再以既有覆核／裁決記錄）。
- 佇列資料來自稽核報告（`audit:servability`、`audit:review-manifest`）；報告過期時頁面會顯示 `asOf`，需重新執行 audit。

## 4. 角色授權結果【實測】

| 角色 | 佇列（GET） | Servability 裁決 | Golden 核准 |
| --- | --- | --- | --- |
| 未登入 | 401 | 401 | 401 |
| 學生 | 403 | 403 | 403 |
| 管理員（不在 `HISTORY_REVIEWER_EMAILS`） | 200（唯讀） | 403（`approve_after_verified_repair`） | 403 |
| 教師（不在名單） | 200（唯讀） | 403（核准）；退回／隔離可用 | 403 |
| 名單內歷史科教師 | 200 | 允許（仍需版本／指紋） | 允許（仍需完整評估內容） |

伺服器仍是唯一權威；UI 沒有任何 client-side 授權判斷。新路由已加入 `tests/authz-negative.test.ts`（150 項通過）。

## 5. Servability 與 Golden 回歸【實測】

- 97 題仍在所有派題路徑被攔截；`approve_after_verified_repair` 未修復時 409、修復後才可核准；非核准決定不會令題目可見；舊快照未作答題目 409；批次候選排除 held；TOCTOU 條件更新仍生效（既有測試全通過）。
- Golden：42 候選／**0 approved**／0 stale；admin 403、名單未設定 403、缺 fixture 400、版本衝突 409、重複提交 `created:false`、題目改動後 stale（9 項測試）。
- `golden:eval` = `INSUFFICIENT_EVIDENCE`；`golden:export --check` 0 approved、無寫入。

## 6. 指令與測試結果【實測】

| 命令 | 退出碼 | 結果 |
| --- | --- | --- |
| `npm test` | 0 | **91 檔；1,229 通過、4 略過（1,233）** |
| `npm run typecheck`／`lint`／`build` | 0 | 全部通過（build 先清 `.next`） |
| `npx vitest run tests/review-queue.test.ts` | 0 | 8 通過 |
| `npx vitest run tests/authz-negative.test.ts` | 0 | 150 通過 |
| `npm run audit:servability`／`servability-evidence`／`review-provenance`／`provenance-risk`／`adjudication-worklist`／`source-crosswalk`／`golden-readiness`／`review-manifest` | 0 | 數字與 Sprint 15 相同（97、96、16／1,241／623、0／530／0／93、81／10／4／1、124、42／0、623／124） |
| `npm run golden:candidates`／`golden:export -- --check`／`golden:eval` | 0 | 42／0 approved／`INSUFFICIENT_EVIDENCE` |
| `npm run release:gate` | 0 | **NOT READY**（15 項，tests PASS 24 命令） |
| `node scripts/e2e-flow.mjs --start`（Sprint 16：暫存 DB + 複製 `data/uploads`） | 0 | **128 通過／0 失敗** |

E2E 範圍：學生流程、後台、回報、教師覆核、OCR；**不覆蓋**新的 `/teacher/review` UI（無瀏覽器測試框架）。4 項略過為既有條件式測試（環境／憑證），沒有為通過而刪除。

## 7. 更新後數量

97 題（81／10／4／1，0 可自動修復）、623 題（P1 530／P3 93，重疊 124）、Golden 42／0／0、政策 13 項全部 `UNASSIGNED`、gate 15 項 NOT READY。

## 8. Release gate 與剩餘阻塞

PASS 4（isolation、answer-provenance、teacher-decisions、tests）｜FAIL 1（servability 97）｜POLICY_PENDING 6（來源 877、解釋 1,334＋546、元數據 1,880、審核來源 623、結構裁決 97、provenance 530）｜WARN 1（版權 12/36）｜INSUFFICIENT 3（Golden×2、deployment）。UI 完成**沒有**改變任何 gate 狀態。

## 9. 未驗證項目

工作台 UI 的真人可用性與無障礙測試、provenance 逐題裁決流程、政策 B、CI、多執行個體 SQLite、`export-production-snapshot`／`pilot-deepseek`、P1 grading 語義逐題確認。

## 10. 環境聲明

- **沒有修改生產資料庫**、**沒有執行生產 migration**（所有工具唯讀；E2E 用暫存複本）。
- **沒有部署、沒有 commit、沒有 push**；沒有呼叫付費 AI API；沒有建立假教師或假核准。
- 原有 84 項未提交成果完整保留；結束共 **91 項（25 modified + 66 untracked）**。
