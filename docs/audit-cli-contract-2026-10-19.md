# CLI 唯讀契約與退出碼（Sprint 13，2026-10-19）

> 本文件記錄每個 audit／export／evaluation／migration 指令的**實際**副作用契約，
> 以及退出碼的語義。所有「是否可能」欄位都以程式碼與測試為依據，不是由指令名稱推斷。
>
> 驗證方式：`tests/read-only-cli.test.ts`（真實資料庫檔案雜湊比對，不是 mock 計數）、
> 各 script 的靜態 import 檢查、以及 `scripts/db/connection.ts` 的唯讀模式實作。

## 1. 為什麼要做這件事

Sprint 11 執行 `npm run golden:export -- --check`（名義上「只檢查」）時，腳本經
`golden-approval` → repositories → `getDb()`，而 `getDb()` 會在開啟連線時**自動執行
migration**，結果對本機開發資料庫套用了 0022。檢查動作不應該改 schema。

Sprint 13 的修正：

1. `connection.ts` 新增 `enableReadOnlyDatabaseMode()`／`openReadOnlyDatabase()`：
   - 不建立資料庫檔案或目錄（檔案不存在即報錯）；
   - 不執行 migration；
   - `new DatabaseSync(path, { readOnly: true })`，任何寫入由 SQLite 拒絕。
2. `golden:export` 在**匯入任何 service／repository 之前**啟用唯讀模式（`--check` 與一般匯出都一樣）。
3. migration 變成獨立、必須明確指定資料庫的命令：`npm run db:migrate -- --database <path>`。
4. 指紋計算抽成純函式 `src/server/quality/question-fingerprint.ts`；audit／export CLI 不再從
   `question-service` 匯入，模組圖內沒有資料庫存取程式碼。

## 2. 指令副作用矩陣

| 指令 | 入口 | 資料來源 | 需要資料庫 | 自動 migration | 可能寫 DB | 可能寫檔案 | 外部服務 | 退出碼契約 | 測試證據 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `npm run audit:content` | `scripts/audit-content-quality.ts` → `quality/content-audit.ts` | SQLite（`readOnly`） | 是 | **否**（`new DatabaseSync(readOnly)`） | 否 | 是（JSON＋MD 報告） | 無 | 0＝報告已產生（內容狀態見報告）；1＝執行錯誤 | 靜態 + `audit:content` 每次執行成功 |
| `npm run audit:servability` | `scripts/audit-servability.ts` | SQLite（`readOnly`） | 是 | 否 | 否 | 是（報告） | 無 | 同上 | 靜態 + 執行 |
| `npm run audit:servability-evidence` | `scripts/audit-servability-evidence.ts` | SQLite（`readOnly`）＋ `materials/` 文件 | 是 | 否 | 否 | 是（報告） | 無 | 同上 | 靜態 + 執行 |
| `npm run audit:review-provenance` | `scripts/audit-review-provenance.ts` | SQLite（`readOnly`） | 是 | 否 | 否 | 是（報告） | 無 | 同上 | 靜態 + 執行 |
| `npm run audit:repair-provenance` | `scripts/audit-repair-provenance.ts` | SQLite（`readOnly`）＋ `materials/` | 是 | 否 | 否 | 僅 `--out` 指定時 | 無 | 同上 | 靜態 + 執行 |
| `npm run audit:provenance-risk` | `scripts/audit-provenance-risk.ts` | 上述兩份報告 ＋ 子程序執行 repair audit（readOnly） | 間接 | 否 | 否 | 是（報告） | 無 | 同上 | 靜態 + 執行 |
| `npm run audit:adjudication-worklist` | `scripts/audit-adjudication-worklist.ts` | SQLite（`openReadOnlyDatabase`）＋ servability／evidence／provenance 報告 | 是 | **否** | 否 | 是（JSON＋MD） | 無 | 0＝報告已產生；1＝錯誤 | `tests/read-only-sidecar.test.ts`（資料庫雜湊不變） |
| `npm run audit:source-crosswalk` | `scripts/audit-source-provenance-crosswalk.ts` | 三份既有報告（**不連資料庫**） | 否 | 否 | 否 | 是（JSON＋MD） | 無 | 同上 | `tests/read-only-sidecar.test.ts` |
| `npm run audit:review-manifest` | `scripts/audit-review-priority-manifest.ts` | SQLite（`openReadOnlyDatabase`）＋ provenance／content／review／servability 報告 | 是 | **否** | 否 | 是（JSON＋MD） | 無 | 0＝報告已產生；1＝錯誤 | `tests/read-only-sidecar.test.ts`（623 唯一、重疊 124、資料庫不變） |
| `npm run audit:explanation-worklist` | `scripts/build-content-improvement-worklist.ts` → `services/content-improvement.ts`（`buildContentWorklist`） | SQLite（`new DatabaseSync(readOnly)`；不經 `getDb()`） | 是 | **否** | 否 | 是（JSON＋MD） | 無 | 0＝報告已產生；1＝錯誤 | `tests/explanation-improvement.test.ts`、`tests/content-improvement-flags.test.ts`、實際執行（1,875 題，資料庫不變） |
| `npm run audit:golden-readiness` | `scripts/audit-golden-readiness.ts` | SQLite（`openReadOnlyDatabase`）＋候選清單 | 是 | **否** | 否 | 是（JSON＋MD） | 無 | 同上 | `tests/read-only-sidecar.test.ts`（裁決列 0 筆不變） |
| `npm run golden:candidates` | `scripts/build-golden-candidates.ts` | SQLite（`readOnly`）＋既有報告 | 是 | 否 | 否 | 是（報告） | 無 | 同上 | 靜態 + 執行 |
| `npm run golden:export -- --check` | `scripts/export-golden-fixtures.ts` | SQLite（**唯讀模式**）＋候選 JSON | 是（必須存在） | **否** | **否** | **否** | 無 | **0**＝檢查完成（approved 可為 0）；**2**＝`INSUFFICIENT_EVIDENCE`（DB 缺失／0022 未套用／候選檔缺失）；**1**＝非預期錯誤 | `tests/read-only-cli.test.ts`（4 個 --check 案例，含檔案雜湊不變） |
| `npm run golden:export`（一般） | 同上 | 同上 | 是 | **否** | **否** | 是（只寫 `--out`） | 無 | 0／2／1（同上；2 時不寫檔） | 同上（3 個匯出案例） |
| `npm run golden:eval` | `scripts/golden-eval.ts` | SQLite（`readOnly`）＋ `golden-questions.v2.json` | 是 | 否 | 否 | 是（評估報告） | 無 | 0＝報告已產生（結果可能是 `INSUFFICIENT_EVIDENCE`）；1＝錯誤 | 靜態 + 執行 |
| `npm run release:gate` | `scripts/release-gate.ts` → `quality/release-gate.ts` | SQLite（`readOnly`）＋ 報告／證據檔 | 是 | 否 | 否 | 是（JSON＋MD） | 無 | **0＝閘門已計算**（不論 READY／NOT READY）；加 `--fail-on-not-ready` 時，非 READY → **1** | `tests/release-gate.test.ts`、實際執行（NOT READY → exit 1） |
| `npm run db:migrate -- --database <path>` | `scripts/db-migrate.ts` | SQLite（**可寫**） | 是（必須明確指定） | **是**（這就是它的用途） | **是**（只新增 migration 記錄／表） | 否 | 無 | 0＝成功；1＝缺 `--database` 或錯誤 | `tests/migration-safety.test.ts`（升級／冪等） |
| `npm run flag:content-improvement`（預設模擬） | `scripts/apply-content-improvement-flags.ts` | SQLite（**唯讀模式**，`enableReadOnlyDatabaseMode()`）＋ 唯讀工作清單 | 是（必須存在，且須已套用 0026） | **否** | **否** | 否 | 無 | 0＝已列出模擬結果（`--list` 亦為 0）；1＝缺 `--reason`／資料表缺失／錯誤 | `tests/content-improvement-flags.test.ts`（dry-run 0 事件）、實際執行（檔案雜湊不變） |
| `npm run flag:content-improvement -- --apply` | 同上 | SQLite（**可寫**，經 `getDb()`） | 是 | **是**（若 0026 未套用則自動套用） | **是**（只寫 `question_content_flags`，不寫 `questions`／`question_reviews`） | 否 | 無 | 0＝全部成功或已存在；1＝缺 `--actor`／任何一條失敗（atomic，整批不寫入） | `tests/content-improvement-flags.test.ts`（冪等、atomic、不改題目） |
| `npm run explanation:batch` | `scripts/build-explanation-batch.ts` | SQLite（`new DatabaseSync(readOnly)`）＋ 課本段落 | 是 | **否** | 否 | 是（批次上下文 JSON，供補寫核對） | 無 | 0＝已產生；1＝錯誤 | 實際執行（課題1：73 題、附課本原文） |
| `npm run explanation:apply`（預設模擬） | `scripts/apply-explanation-rewrites.ts` | SQLite（**唯讀模式**） | 是 | **否** | **否** | 否 | 無 | 0＝模擬完成；1＝清單錯誤／資料表缺失 | `tests/explanation-rewrite.test.ts`（dry-run 零寫入） |
| `npm run explanation:apply -- --apply` | 同上 | SQLite（**可寫**） | 是 | 是（若 0026 未套用） | **是**（只改 `questions.explanation` 及 `revision`；另寫 `question_content_flags`） | 否 | 無 | 0＝全部成功；1＝缺 `--actor`／任何一條失敗（atomic） | `tests/explanation-rewrite.test.ts`（只改解釋、狀態保留、不寫覆核紀錄） |
| `npm run import:materials`、`setup`、`generate:questions`、`publish:drafts`、`approve:questions`、`repair:questions`、`open:materials`、`retire:materials`、`remap:references`、`apply:queue`、`export:snapshot` | 對應 `scripts/*.ts` | SQLite | 是 | **是**（經 `getDb()`） | **是**（寫入工具） | 部分（授權紀錄／快照） | 部分（`generate` 可呼叫 LLM） | 各自既有契約（多數預設模擬、需 `--apply`） | 既有修復／發布測試 |

**未驗證（`UNVERIFIED`）**：

- `export-production-snapshot` 需要正式環境設定，未在本機執行；只做靜態檢查（會寫檔案、寫 DB？讀取為主，未確認）。
- `pilot-deepseek` 需要外部 LLM 憑證，未執行。

## 3. 退出碼語義（設計原則）

1. **報告型 audit**（`audit:*`、`golden:candidates`、`golden:eval`）：退出碼只表示「報告是否成功產生」。
   內容狀態（`FAIL`／`POLICY_PENDING`／`INSUFFICIENT_EVIDENCE`／`WARN`）寫在 JSON／Markdown，
   不改退出碼。理由：這些工具的用途是產生證據；若把內容狀態混進退出碼，CI 會難以區分
   「工具壞了」與「內容未達標」。
2. **`golden:export`**：唯讀檢查與匯出需要明確區分「環境不足」（2）與「程式錯誤」（1），
   否則 CI 會把缺 migration 當成一般失敗而重試。
3. **`release:gate`**：預設 exit 0（報告工具）；加 `--fail-on-not-ready` 才把
   `NOT READY` 變成 exit 1，供 CI／部署前使用。JSON 內有 `verdict` 及每個 gate 的
   `status`／`numerator`／`denominator`／`evidence`，機器判定以 JSON 為準。
4. **`db:migrate`**：唯一會改 schema 的命令，必須明確指定資料庫。

## 4. CI 建議（未在本 Sprint 設定 CI）

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run audit:content          # 產生證據（exit 0 不代表內容合格）
npm run golden:export -- --check
npm run release:gate -- --fail-on-not-ready   # 非 READY → exit 1
```

- 不要把 `audit:*` 的 exit 0 當成發布條件通過。
- 不要在 CI 對正式資料庫執行 `db:migrate`；migration 由部署流程明確執行。
- `release:gate` 的 JSON 是唯一的機器可讀發布判定。

## 5. 已知限制與 WAL sidecar 政策（Sprint 14）

唯讀開啟 WAL 模式的 SQLite 可能在資料庫旁建立／更新 `-shm`／`-wal` sidecar 檔；主資料庫檔案的
SHA-256、schema 及資料列不變（`tests/read-only-cli.test.ts` 逐案例比對；`tests/read-only-sidecar.test.ts`
額外比對 `sqlite_master`、`schema_migrations`、`questions`／`golden_fixture_reviews` 列數）。

必須分清兩種政策，**不得把 A 說成 B**：

| 政策 | 內容 | 本專案現況 |
| --- | --- | --- |
| **A. Database-content read-only** | 不改變 schema 或資料；允許 SQLite 建立必要 `-wal`／`-shm` | **已實作並有測試** |
| **B. Filesystem read-only** | 連 sidecar 也不得建立／修改 | **未實作**（需要 `immutable` 模式或唯讀複本；待負責人決定） |

`tests/read-only-sidecar.test.ts` 會檢查執行後**只**可能出現 `<db>-wal`／`<db>-shm`，不得出現其他檔案；
若日後改為政策 B，該測試需要改為「不得出現任何新檔案」，並調整連線方式。

其他限制：

- `golden:export` 仍需要候選清單檔（`docs/teacher-review/golden-candidates-2026-10-19.json`）；
  它是唯讀輸入，缺失時回 `INSUFFICIENT_EVIDENCE`。
- `export-production-snapshot`、`pilot-deepseek` 仍為 `UNVERIFIED`（見政策清單第 13 項）。
