# Sprint 13 報告：唯讀稽核完整性、資料庫副作用控制與發布治理

日期：2026-10-19
基準 HEAD：`6895db9`（`main`，與 `origin/main` 相同）
整體發布狀態：**NOT READY**（本 Sprint 不以改變它為目標）

> 標記：**【實測】**＝本次實際執行並記錄輸出；**【靜態】**＝閱讀程式碼／schema；**【未驗證】**＝現有環境無法驗證；**【需決策】**＝需真人教師／科組／負責人。

---

## 1. Git 狀態

### 1.1 起始【實測】

| 項目 | 實際 | Sprint 12 報告預期 |
| --- | --- | --- |
| Branch | `main` | `main` |
| HEAD／`origin/main` | `6895db9` / `6895db9` | 相同 |
| 未提交項目 | **63（23 modified + 40 untracked）** | 63（23+40） |

組成與預期一致（Sprint 12 已在報告中更正 Sprint 11 的 18+36 記法）。

### 1.2 新增與修改

**新增（5）**

| 檔案 | 用途 |
| --- | --- |
| `src/server/quality/question-fingerprint.ts` | 純函式指紋（讓 audit CLI 不再依賴 repositories） |
| `scripts/db-migrate.ts` | 明確、需指定資料庫的 migration 命令 |
| `tests/read-only-cli.test.ts` | `golden:export` 唯讀契約（7 個案例，檔案雜湊比對） |
| `docs/audit-cli-contract-2026-10-19.md` | 所有 CLI 的副作用矩陣與退出碼契約 |
| `docs/sprint-13-report-2026-10-19.md` | 本報告 |

**修改（本 Sprint 首次改動 2 個 tracked 檔案）**

| 檔案 | 改動 |
| --- | --- |
| `src/server/db/connection.ts` | `enableReadOnlyDatabaseMode()`、`openReadOnlyDatabase()`、唯讀連線快取；`closeDefaultDatabase()` 一併關閉唯讀連線 |
| `package.json` | 新增 `db:migrate` |
| `src/server/services/question-service.ts` | 指紋改為呼叫純函式模組（行為不變） |
| `scripts/export-golden-fixtures.ts`（untracked） | 重寫：唯讀模式 + 三種退出碼 + 不寫檔的 `--check` |
| `scripts/audit-servability.ts`、`audit-review-provenance.ts`、`golden-eval.ts`、`build-golden-candidates.ts`（untracked） | 改從純函式模組匯入指紋 |
| `src/server/services/golden-approval.ts`（untracked） | 新增 `goldenSchemaStatus()`（缺表時可回報，不自動修補） |
| `docs/release-evidence-2026-10-19.json`、`docs/teacher-review/policy-decisions-2026-10-19.md`、`docs/quality/*`（重新產生） | 同步證據與政策 |

### 1.3 既有未提交成果

Sprint 9–12 的 63 項全部保留；沒有 `git reset`／`clean`／強制 checkout／格式化；沒有刪除任何報告或審核歷史。

---

## 2. `golden:export -- --check` 的根因、修正及副作用測試

### 2.1 根因【靜態＋實測】

呼叫鏈：

```
scripts/export-golden-fixtures.ts
  → services/golden-approval.ts（exportGoldenFixtures／listGoldenCandidateViews）
    → repositories/questions.ts（getQuestion…）與 repositories/topics.ts
      → db/connection.ts getDb()
        → openDatabase()：mkdirSync + new DatabaseSync + PRAGMA journal_mode=WAL + runMigrations()
```

`--check` 與一般匯出共用同一條鏈，所以「只是檢查」也會建立目錄／檔案、設 WAL、**套用 migration**。
實際證據：`data/app.db` 有 `golden_fixture_reviews` 及 `schema_migrations` 的 0022 記錄（Sprint 11 執行匯出時寫入），而該 Sprint 從未刻意執行 migration。

### 2.2 修正（範圍最小，不是把 migration 移到隱藏函式）

1. `connection.ts` 增加**唯讀模式**：
   - `enableReadOnlyDatabaseMode()`（供 CLI 在匯入 service 前呼叫）；
   - `openReadOnlyDatabase(path)`：檔案不存在即 `ReadOnlyDatabaseError`、**不 mkdir**、**不 migration**、`readOnly: true`；
   - `getDb()` 在唯讀模式下回傳唯讀連線，任何寫入由 SQLite 拒絕。
2. `export-golden-fixtures.ts`：
   - `--check` 與一般匯出都先啟用唯讀模式，再動態匯入服務；
   - `goldenSchemaStatus()` 檢查 `golden_fixture_reviews` 是否存在；缺表 → `INSUFFICIENT_EVIDENCE`（exit 2），提示用 `db:migrate`；
   - `--check` 只輸出 JSON 摘要，不呼叫任何寫檔 API；
   - 一般匯出只寫 `--out`（預設 `docs/teacher-review/golden-questions.v2.json`）。
3. migration 獨立：`npm run db:migrate -- --database <path>`（沒有預設值，避免誤對 `data/app.db` 執行）。
4. 指紋抽成純函式：audit／export CLI 的模組圖不再包含 `repositories`（可用 import 檢查證明）。

### 2.3 副作用測試【實測】

`tests/read-only-cli.test.ts`（7 項全通過，使用 `%TEMP%` 隔離資料庫與 SHA-256 檔案雜湊）：

| 案例 | 期望 | 結果 |
| --- | --- | --- |
| 資料庫不存在 | exit 2、訊息含 `INSUFFICIENT_EVIDENCE`、**不建立檔案** | 通過 |
| 0022 未套用 | exit 2、不建表、`schema_migrations` 無 0022、主檔雜湊不變 | 通過 |
| schema 完整 + `--check` | exit 0、不產生 `--out` 檔、主檔雜湊不變 | 通過 |
| 有 approved 裁決列 | 裁決列（id／decision／revision／fingerprint／reviewer）完全不變 | 通過 |
| 一般匯出 | 寫出 `version: 2` dataset（`questions: []`）、主檔雜湊不變 | 通過 |
| schema 缺失 + 一般匯出 | exit 2、不寫檔 | 通過 |
| `--out` 是目錄 | exit 1、訊息含「目錄」、資料庫不變 | 通過 |

另在 `data/app.db` 的**複本**上實測：【實測】`--check` 前後主檔 SHA-256 相同（`hashSame=True`）。

### 2.4 已知限制【實測】

唯讀開啟 WAL 資料庫時，SQLite 會在旁建立／更新 `-shm`／`-wal` sidecar 檔（本次觀察：`app.db-shm` 32 KB、`app.db-wal` 0 bytes）。**主資料庫內容不變**，但「完全沒有任何檔案變動」嚴格來說不成立；已在契約文件第 5 節列明。

---

## 3. 所有 CLI 的唯讀契約矩陣

完整表格（欄位：入口、資料來源、DB、自動 migration、寫 DB、寫檔、外部服務、退出碼、測試證據）見
[audit-cli-contract-2026-10-19.md](audit-cli-contract-2026-10-19.md)。

摘要【靜態＋實測】：

| 類別 | 指令 | 自動 migration | 寫 DB |
| --- | --- | --- | --- |
| 唯讀報告 | `audit:content`、`audit:servability`、`audit:servability-evidence`、`audit:review-provenance`、`audit:repair-provenance`、`audit:provenance-risk`、`golden:candidates`、`golden:eval`、`release:gate` | 否（全部 `readOnly: true`） | 否 |
| 唯讀＋匯出 | `golden:export`（`--check` 不寫檔） | **否（Sprint 13 修正）** | 否 |
| 明確寫入 | `db:migrate` | 是（這就是用途） | 是（只 migration 記錄／表） |
| 寫入工具 | `import:materials`、`setup`、`generate:questions`、`publish:drafts`、`approve:questions`、`repair:questions`、`open:materials`、`retire:materials`、`remap:references`、`apply:queue`、`export:snapshot` | 是（經 `getDb()`） | 是 |

`UNVERIFIED`：`export-production-snapshot`（需正式環境設定）、`pilot-deepseek`（需外部 LLM 憑證）——只做靜態檢查，沒有執行。

---

## 4. 退出碼、機器可讀狀態與 CI 一致性

| 工具 | 退出碼 | 契約 |
| --- | --- | --- |
| `audit:*`、`golden:candidates`、`golden:eval` | 0／1 | 0＝報告已產生（**內容狀態見報告，不代表合格**）；1＝執行錯誤 |
| `golden:export --check` | **0／2／1** | 0＝檢查完成；2＝`INSUFFICIENT_EVIDENCE`；1＝非預期錯誤 |
| `golden:export`（一般） | 0／2／1 | 同上；2 時不寫檔 |
| `release:gate` | 0（加 `--fail-on-not-ready` 時非 READY→1） | 機器判定以 JSON `verdict` 及各 gate `status` 為準 |
| `db:migrate` | 0／1 | 1＝缺 `--database` 或錯誤 |

【實測】`npx tsx scripts/release-gate.ts --fail-on-not-ready` → 輸出 `結果：NOT READY`、**exit 1**。
【實測】`release-gate-2026-10-19.json` 保留每個 gate 的 `status`／`numerator`／`denominator`／`evidence`／`recommendations`，沒有把 `POLICY_PENDING`／`INSUFFICIENT_EVIDENCE` 轉成 PASS。
【實測】Sprint 12 的 BOM 事件證明：證據檔無法解析時 `tests` 閘門降為 `INSUFFICIENT_EVIDENCE`（fail-closed）；本次重新驗證 JSON 可解析且 `tests` 為 PASS（17 條命令）。

CI 尚未設定（repo 沒有 `.github/`）；建議流程已寫入契約文件第 4 節。**不要把 audit exit 0 當成發布條件通過。**

---

## 5. Golden Dataset 與 reviewer authorization【實測】

| 檢查 | 結果 |
| --- | --- |
| 候選／approved／stale | **42／0／0**（`golden:export --check`、`golden:candidates`） |
| `golden:eval` | `INSUFFICIENT_EVIDENCE`（0 fixture） |
| `HISTORY_REVIEWER_EMAILS` | 未設定 → Golden 裁決及「已修復並核准」一律 403（`tests/golden-approval.test.ts`、`tests/servability-adjudication.test.ts`） |
| admin 角色 | 不因角色取得歷史科權限（`tests/authz-negative.test.ts` 的 `adminAllowed: false`） |
| 重複／不合法 reviewer 設定 | 名單只做完整電郵比對；未列出者一律拒絕（含 admin）；空白名單 fail-closed |
| revision／fingerprint 改變 | 舊核准在 `listGoldenCandidateViews()` 標為 `stale`、`exportGoldenFixtures()` 不採用（既有測試 + `tests/golden-approval.test.ts`） |
| `--check` 是否改狀態 | 測試證明裁決列與主檔雜湊不變 |
| 空資料／DB 不可用／migration 缺失 | 一律 exit 2（`INSUFFICIENT_EVIDENCE`），不會產生虛假 PASS |

**沒有任何假教師、假核准或 fixture 被建立**；`golden_fixture_reviews` 仍是 0 筆（本機開發資料庫）。

---

## 6. 97 題、623 題與 Sprint 12 修正的重新驗證【實測】

| 項目 | 結果 | 來源 |
| --- | --- | --- |
| 不可作答題目 | **97**（96 `MCQ_ROMAN_LABEL_MISSING`、1 `FILL_ANSWER_LEAKS`） | `audit:servability` |
| 96 題原文核對 | 0 題可直接補標示（81 不齊全、10 陳述數不符、4 缺檔、1 找不到段落） | `audit:servability-evidence` |
| `qb-JTH2ndEdFBQ09015` | 仍被 `checkQuestionServable` 攔截；Sprint 9 裁決歷史未改；0 次作答 | servability 報告、測試 |
| 623 題 provenance | **P0 0／P1 530／P2 0／P3 93** | `audit:provenance-risk` |
| revision 條件更新 | `setQuestionStatusIfRevision()` 測試通過 | `tests/release-controls.test.ts` |
| 舊快照不可提交隔離題目新作答 | 測試通過（已作答者仍可看歷史回饋） | 同上 |
| 批次候選排除 held | 測試通過 | 同上 |
| 未設定 reviewer 名單時拒絕 | 測試通過 | `tests/golden-approval.test.ts`、`tests/servability-adjudication.test.ts` |

沒有改動任何題目、答案或歷史審核紀錄。

---

## 7. 測試與建置【實測】

| 命令 | 退出碼 | 結果 |
| --- | --- | --- |
| `npm test` | 0 | **89 檔；1,210 通過、4 略過（1,214）** |
| `npm run typecheck` | 0 | 通過 |
| `npm run lint` | 0 | 通過 |
| `npm run build` | 0 | 通過（先清 `.next` 避 OneDrive EPERM） |
| `npm run audit:content` | 0 | 完成（指紋 `3e92788a…`，與 Sprint 12 相同） |
| `npm run audit:servability` | 0 | 97 題不可作答 |
| `npm run audit:servability-evidence` | 0 | 96 題核對完成 |
| `npm run audit:review-provenance` | 0 | 16／1,241／623（與 Sprint 12 相同） |
| `npm run audit:repair-provenance` | 0 | 877／987／14（與 Sprint 12 相同） |
| `npm run audit:provenance-risk` | 0 | P0 0／P1 530／P2 0／P3 93 |
| `npm run golden:candidates` | 0 | 42 候選 |
| `npx tsx scripts/export-golden-fixtures.ts --check` | 0 | schema 可用、0 approved、無寫入 |
| `tests/read-only-cli.test.ts` | 0 | 7 通過 |
| `npm run golden:eval` | 0 | `INSUFFICIENT_EVIDENCE` |
| `npx tsx scripts/release-gate.ts --fail-on-not-ready` | **1** | `NOT READY`（正確阻擋） |
| `npm run release:gate` | 0 | `NOT READY`（15 閘門） |
| `npm run db:migrate`（無參數） | **未執行** | 只以程式碼確認缺 `--database` 會 exit 1；本 Sprint **沒有**對任何資料庫執行 migration |

E2E：本 Sprint 未改動派題路徑（只改 CLI／connection／指紋模組），沿用 Sprint 12 的實測結果（空上載 126／2、提供原檔 128／0）。**未重新執行**，標記為沿用證據，不是本次結果。

---

## 8. 尚未驗證或無法在本機重現【未驗證】

1. `export-production-snapshot`、`pilot-deepseek` 的副作用（需正式環境設定／外部憑證）。
2. WAL sidecar（`-shm`／`-wal`）檔案變動；主檔內容不變已驗證。
3. CI 整合（repo 沒有 CI 設定）。
4. 多執行個體（Cloud Run）下的 SQLite 行為。
5. `db:migrate` 對「舊 schema 資料庫」的完整升級路徑已在測試覆蓋（migration-safety），但**未對任何真實資料庫執行**。

---

## 9. Release gate 每個阻塞的狀態與證據【實測】

15 項：PASS 4（isolation、answer-provenance、teacher-decisions、tests 17 命令）｜FAIL 1（question-servability 97/1880）｜POLICY_PENDING 6（source 877/1880、explanation 1,334+546、metadata 1,880、review-provenance 623、servability-adjudication 97、provenance-risk 530）｜WARN 1（copyright 12/36）｜INSUFFICIENT_EVIDENCE 3（golden-evaluation 0、golden-approval 0/42、deployment）。

**NOT READY 的具體原因**與 Sprint 12 相同：97 題待裁決、623 題待政策、1,003 題來源待核實、1,334＋546 解釋標準未定、1,880 技能標籤未定、0 Golden fixture、12/36 權利證據、無部署證據；另加 `HISTORY_REVIEWER_EMAILS` 未設定（學科授權阻塞）。

---

## 10. 需決策項目

已更新 [policy-decisions-2026-10-19.md](teacher-review/policy-decisions-2026-10-19.md)（11 項；新增第 11 項 CLI 唯讀契約與 migration 責任）。新增待決：
- 是否在 CI 加「audit script 不得 import repositories」的靜態檢查；
- 誰負責 `HISTORY_REVIEWER_EMAILS`；
- 是否接受 WAL sidecar 檔案變動作為「唯讀」的已知限制。

---

## 11. 資料庫、部署與版本控制聲明

- **沒有對任何資料庫寫入內容**：本 Sprint 只以唯讀模式開啟 `data/app.db`；測試使用 `%TEMP%` 隔離資料庫（含檔案雜湊比對）。
- **沒有執行 migration**：新增 `db:migrate` 但未執行；`data/app.db` 的 0022 是 Sprint 11 遺留（本 Sprint 未再變更）。
- **沒有部署、沒有 commit、沒有 push**：HEAD 仍 `6895db9`。
- 沒有呼叫付費 AI API。
- 所有原有的 63 項未提交成果完整保留；本 Sprint 結束時 `git status --short` 共 **69 項（24 modified + 45 untracked）**。與起始相比：**+1 modified**（`src/server/db/connection.ts`）、**+5 untracked**（`src/server/quality/question-fingerprint.ts`、`scripts/db-migrate.ts`、`tests/read-only-cli.test.ts`、`docs/audit-cli-contract-2026-10-19.md`、`docs/sprint-13-report-2026-10-19.md`）；其餘為 Sprint 9–12 原有項目。
