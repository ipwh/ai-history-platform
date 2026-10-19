# Sprint 14 報告：證據驅動的題目發布準備度與治理收斂

日期：2026-10-19
基準 HEAD：`6895db9`（`main`，與 `origin/main` 相同）
整體發布狀態：**NOT READY**（本 Sprint 不以改變它為目標）

> 標記：**【實測】**＝本次執行並記錄；**【靜態】**＝閱讀程式碼／schema；**【推論】**；**【未驗證】**；**【需決策】**＝需真人教師／科組／負責人。

---

## 1. Git 狀態

| 項目 | 起始【實測】 | 結束【實測】 |
| --- | --- | --- |
| Branch | `main` | `main` |
| HEAD／`origin/main` | `6895db9` / `6895db9` | `6895db9` / `6895db9` |
| 未提交 | **69（24 modified + 45 untracked）** | **80（24 modified + 56 untracked）** |

起始與 Sprint 13 報告一致。Sprint 14 新增 **11 個檔案**：3 個 CLI（`audit-adjudication-worklist.ts`、`audit-source-provenance-crosswalk.ts`、`audit-golden-readiness.ts`）、1 個測試（`tests/read-only-sidecar.test.ts`）、6 份報告輸出（各 JSON＋MD）、以及本報告；另外更新 `package.json`（3 個 npm script，屬既有 modified 檔案）。**沒有修改任何既有的 tracked 程式碼邏輯**。

### 1.1 既有未提交成果

Sprint 9–13 的 69 項全部保留（逐項 `git status` 比對）；沒有 reset／clean／覆蓋／刪除／格式化；沒有改動題庫、答案或歷史審核紀錄。

### 1.2 本 Sprint 新增／更新的輸出

| 類型 | 檔案 |
| --- | --- |
| 新 CLI | `scripts/audit-adjudication-worklist.ts`、`scripts/audit-source-provenance-crosswalk.ts`、`scripts/audit-golden-readiness.ts` |
| 新測試 | `tests/read-only-sidecar.test.ts`（5 項） |
| 新報告 | `docs/quality/adjudication-worklist-2026-10-19.{json,md}`、`docs/quality/source-provenance-crosswalk-2026-10-19.{json,md}`、`docs/teacher-review/golden-readiness-2026-10-19.{json,md}` |
| 文件 | `docs/sprint-14-report-2026-10-19.md`、`docs/audit-cli-contract-2026-10-19.md`（sidecar 政策＋新指令）、`docs/teacher-review/policy-decisions-2026-10-19.md`（12／13 項）、`README.md`、`docs/teacher-review/README.md`、`docs/audit-2026-10-18-platform-audit.md`、`docs/release-evidence-2026-10-19.json`、`package.json`（3 個 npm script） |

---

## 2. 97 題裁決工作清單【實測】

`npm run audit:adjudication-worklist` → [docs/quality/adjudication-worklist-2026-10-19.md](quality/adjudication-worklist-2026-10-19.md)

每題包含：ID、當前 revision／fingerprint、servability 狀態、issue code、結構原因、答案／可接受答案／grading points、評分方式、原文位置及 block ids、是否有原始檔、原文證據狀態與分類、缺少的證據、provenance 記錄、既有 review（最新決定／審核者／時間）、建議下一步、**必須維持隔離**、稽核時間及資料來源。

| 類別 | 題數 | 說明 |
| --- | --- | --- |
| Roman numeral 標示缺失 | 96 | 全部需教師裁決 |
| ├ 原卷可取得且可以核對（標示不齊全） | **81** | 原文存在但沒有 i／ii／iii 標示；需原卷或教師確認對應 |
| ├ 原卷存在但題目／選項陳述不一致 | **10** | `statement_count_mismatch` |
| ├ 原卷缺失 | **4** | `source_file_missing` |
| └ 原文段落無法定位 | **1** | `source_block_not_found` |
| 答案外洩（`qb-JTH2ndEdFBQ09015`） | 1 | 需教師決定改寫或維持不派發 |
| **可自動補標示** | **0** | 與 Sprint 11–13 一致，維持至有新可驗證證據 |

所有 97 題 `mustStayQuarantined = true`；清單只提出建議，沒有裁決。

---

## 3. 教師裁決與題目狀態的一致性【實測＋靜態】

| 契約 | 現況 | 證據 |
| --- | --- | --- |
| 裁決綁定 revision＋fingerprint | 是（`recordQuestionReview` 比對，衝突 409） | `tests/question-review.test.ts`、`tests/servability-adjudication.test.ts` |
| 題目審核期間被修改 → 舊裁決失效 | 是（刻意以 `expectedRevision` 檢查＋條件式更新） | 同上、`tests/release-controls.test.ts` |
| 裁決 ≠ 可作答 | 是（`approve_after_verified_repair` 仍先檢查 `checkQuestionServable`；`changeQuestionStatus` 亦檢查） | `tests/servability-adjudication.test.ts` |
| 缺原始證據不推測答案 | 是（工作清單只列建議；沒有自動改寫） | 本 Sprint 清單、Sprint 11 evidence audit |
| 學生派題排除未核准題目 | 是（三條派題分支＋舊快照作答檢查） | `tests/teacher-adjudication.test.ts`、`tests/release-controls.test.ts` |
| 批次保留 held 及原因 | 是（`held` 清單；Sprint 12 加入不可作答題目） | `tests/release-controls.test.ts` |
| 歷史 review 不覆寫 | 是（只新增；migration 0021 後由應用層冪等） | `tests/teacher-adjudication.test.ts`、migration 測試 |

`qb-JTH2ndEdFBQ09015`：Sprint 9 裁決紀錄未改動；工作清單顯示 `reviewRecords: 5`、`currentHumanReview: true`，但 `mustStayQuarantined: true`（裁決 ≠ 可派發）。

---

## 4. 623 題 provenance × 1,003 題來源交叉分析【實測】

`npm run audit:source-crosswalk` → [docs/quality/source-provenance-crosswalk-2026-10-19.md](quality/source-provenance-crosswalk-2026-10-19.md)

| 指標 | 數量 |
| --- | --- |
| provenance 風險題目（唯一） | **623**（重複列 0） |
| 來源待核實（`pending_verification`） | **1,003** |
| 來源可定位（`traceable`） | **877** |
| **兩份清單重疊** | **124**（P1 **31**、P3 **93**） |
| 重疊中只有自動修復證據 | 623（全部） |
| 重疊中有教師逐題裁決 | **0** |
| 有修復差異但來源不可追溯（需先補來源） | **31** |
| 沒有可比較的修復前內容 | 0 |
| 同一題重複出現在 provenance 清單 | 0 |

來源狀態 × provenance 等級：

| 來源狀態 | P0 | P1 | P2 | P3 |
| --- | --- | --- | --- | --- |
| `pending_verification` | 0 | 31 | 0 | 93 |
| `traceable` | 0 | 499 | 0 | 0 |

**解讀**：499 題 P1 有可追溯來源（可先核對原文再決定）；31 題 P1 與 93 題 P3 同時缺來源，其中 31 題有實質修復差異——**必須先補來源**才可能有有效覆核。

### P1 530 題（多空格填充題）
`audit:repair-provenance` 逐題欄位已核對：`blankCountOriginal/Current`、`assessedBlankIndexOriginal/Current`、`original/currentCorrectAnswer`、選項、`classifications`。抽樣 `qb-JTH2ndEdFBQ01002`：原文 2 個空格、現時題幹已補「信史時期」、考核空格仍為第 1 個、答案仍為「史前時期」。
**限制**：資料庫沒有舊版本內容；「答案文字相同」不等於 grading 語義必然相同（例如可接受答案集合或 AI 批改行為改變），因此 530 題維持待覆核，不因本報告降級。

### P3 93 題
分類為 `FORMATTING_CHANGE_ONLY`，且逐字比較顯示題幹、選項文字、答案相同——只移除選項開頭殘留項目符號。已核對不影響選項識別（順序與文字不變）或答案映射。**P3 不代表已核准**，仍待覆核政策（見政策清單第 4 項）。

---

## 5. 唯讀 CLI 與 WAL sidecar 驗收【實測】

### 5.1 政策區分

| 政策 | 內容 | 狀態 |
| --- | --- | --- |
| **A. Database-content read-only** | 不改 schema／資料；允許 SQLite 建立必要 `-wal`／`-shm` | **已實作並驗證** |
| **B. Filesystem read-only** | 連 sidecar 都不得出現 | **未實作／未宣稱** |

### 5.2 `tests/read-only-sidecar.test.ts`（5 項全通過）

| 測試 | 驗證 |
| --- | --- |
| `--check` 對 WAL 資料庫 | 主檔 SHA-256 不變；`sqlite_master`、`schema_migrations`、`questions`、`golden_fixture_reviews` 列數不變；執行後**只**可能出現 `<db>-wal`／`<db>-shm`，不得有其他檔案 |
| 缺 0022 | exit 2；表仍不存在；schema／migration 記錄不變；主檔雜湊不變 |
| 裁決工作清單 | 產生 JSON＋MD；資料庫 schema／資料／雜湊不變 |
| 來源交叉分析 | 不連資料庫；報告數量 623／1,003（可重現） |
| Golden 準備度 | 產生報告；`golden_fixture_reviews` 仍 0 筆；主檔雜湊不變 |

Sprint 13 的 `tests/read-only-cli.test.ts`（7 項）仍全通過（`golden:export --check` 不 migration、不寫檔、exit 2 語義）。

### 5.3 其他 CLI

`audit:*`、`golden:candidates`、`golden:eval`、`release:gate` 均以 `readOnly: true` 讀取；新的三個報告工具同樣使用 `openReadOnlyDatabase()`（不 mkdir、不 migration）。完整矩陣見 [audit-cli-contract-2026-10-19.md](audit-cli-contract-2026-10-19.md)。
`UNVERIFIED`：`export-production-snapshot`、`pilot-deepseek`。

---

## 6. Golden Dataset 核准準備度【實測】

`npm run audit:golden-readiness` → [docs/teacher-review/golden-readiness-2026-10-19.md](teacher-review/golden-readiness-2026-10-19.md)

| 指標 | 數量 |
| --- | --- |
| 候選 | **42** |
| approved | **0** |
| pending | **42** |
| stale 裁決 | 0 |
| 版本／指紋與候選一致 | 42 |
| 有來源證據且答案完整（可交教師審核） | **42** |
| 因版本漂移被阻塞 | 0 |
| 因缺證據被阻塞 | 0 |
| `HISTORY_REVIEWER_EMAILS` | **未設定**（核准一律 403，fail-closed） |
| Golden 裁決表 | 存在（migration 0022） |

每題仍缺少（必須由教師在正式核准流程提供）：**預期 grading、審核理由／類別、錯誤選項說明（MCQ 每題 N-1 條）**。
沒有自動核准任何 fixture；admin 角色不具學科資格。

---

## 7. Release gate 實際狀態【實測】

`npm run release:gate` → **NOT READY**（15 項，與 Sprint 13 相同，沒有因新報告而改變）：

| Gate | 狀態 | 證據 |
| --- | --- | --- |
| question-isolation | PASS | 0／1880 |
| question-servability | **FAIL** | 97／1880 |
| answer-provenance | PASS | 0／18 |
| source-traceability | POLICY_PENDING | 877／1880 |
| explanation-quality | POLICY_PENDING | 1,334＋546 |
| metadata | POLICY_PENDING | 1,880 |
| teacher-decisions | PASS | 0 |
| review-provenance | POLICY_PENDING | 623 |
| copyright | WARN | 12／36 |
| golden-evaluation | INSUFFICIENT_EVIDENCE | 0 fixture |
| servability-adjudication | POLICY_PENDING | 97 待裁決 |
| provenance-risk | POLICY_PENDING | P1 530 |
| golden-approval | INSUFFICIENT_EVIDENCE | 0／42 |
| tests | PASS | 20 條命令、0 失敗 |
| deployment | INSUFFICIENT_EVIDENCE | 無 staging／production 證據 |

沒有把 `POLICY_PENDING`／`INSUFFICIENT_EVIDENCE` 當 PASS；沒有刪除 gate 或降低門檻。

---

## 8. 測試與建置【實測】

| 命令 | 退出碼 | 結果 |
| --- | --- | --- |
| `npm test` | 0 | **90 檔；1,215 通過、4 略過（1,219）** |
| `npm run typecheck` | 0 | 通過 |
| `npm run lint` | 0 | 通過 |
| `npm run build` | 0 | 通過（先清 `.next`） |
| `npm run audit:content` | 0 | 完成（1,880 題；來源 877／1,003） |
| `npm run audit:servability` | 0 | 97 題 |
| `npm run audit:servability-evidence` | 0 | 96 題；0 可自動補標示 |
| `npm run audit:review-provenance` | 0 | 16／1,241／623 |
| `npm run audit:repair-provenance` | 0 | 877／987／14 |
| `npm run audit:provenance-risk` | 0 | P0 0／P1 530／P2 0／P3 93 |
| `npm run audit:adjudication-worklist` | 0 | 97 題清單；Roman 96（81／10／1／4） |
| `npm run audit:source-crosswalk` | 0 | 重疊 124（P1 31、P3 93）；需先補來源 31 |
| `npm run audit:golden-readiness` | 0 | 42 候選、0 approved、42 待教師審核 |
| `npm run golden:candidates` | 0 | 42 候選 |
| `npx tsx scripts/export-golden-fixtures.ts --check` | 0 | 0 approved、無寫入 |
| `npm run golden:eval` | 0 | `INSUFFICIENT_EVIDENCE` |
| `npm run release:gate` | 0 | **NOT READY** |
| `node scripts/e2e-flow.mjs --start`（Sprint 14：暫存 DB + 複製 `data/uploads`） | 0 | **128 通過／0 失敗**（本次實測，非沿用） |

---

## 9. 未驗證項目【未驗證】

1. `export-production-snapshot`、`pilot-deepseek` 的副作用（需正式環境／外部憑證）。
2. 政策 B（Filesystem read-only）未實作；目前只宣稱政策 A。
3. CI 未設定（repo 沒有 `.github/`）。
4. 多執行個體（Cloud Run）下的 SQLite 行為。
5. 530 題的 grading 語義等價性只有「重建後考核答案不變」的證據，沒有逐題教師確認。

---

## 10. 需要教師／科組／負責人決定【需決策】

見 [policy-decisions-2026-10-19.md](teacher-review/policy-decisions-2026-10-19.md)（13 項）。Sprint 14 新增：
- 第 12 項：WAL sidecar 政策（A 已實作；是否要求 B）。
- 第 13 項：`export-production-snapshot`、`pilot-deepseek` 的驗證責任。
既有：96 題處置、`qb-JTH2ndEdFBQ09015`、P1 530／P3 93、1,003 題來源、1,334＋546 解釋、1,880 技能、12/36 權利、`HISTORY_REVIEWER_EMAILS`、Golden 教師安排、部署驗收、CLI 契約。

---

## 11. 資料庫、部署與版本控制聲明

- **沒有任何資料庫寫入**：所有工具以 `readOnly`／`openReadOnlyDatabase()` 開啟；測試以 `%TEMP%` 隔離資料庫並比對主檔雜湊、schema、migration 及資料列。
- **沒有執行 migration**：`db:migrate` 未執行；`data/app.db` 的 0022 為 Sprint 11 遺留。
- **沒有部署、沒有 commit、沒有 push**：HEAD／`origin/main` 仍 `6895db9`。
- 沒有呼叫付費 AI API（E2E 使用 `LLM_PROVIDER=mock`）。
- 原有 69 項未提交成果完整保留；結束時 `git status --short` 共 **80 項（24 modified + 56 untracked）**。
