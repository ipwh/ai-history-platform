# Sprint 9 報告：題目來源、解釋品質與發布閘門（2026-10-19）

## A. Baseline

| 項目 | 內容 |
| --- | --- |
| Branch / HEAD（開始時） | `main` / `0454aaefdf96abc20f01ee6388e9e2e728953420` |
| Remote | `origin` → `https://github.com/ipwh/ai-history-platform.git` |
| 未提交工作（開始時） | 34 modified + 14 untracked（48 項），全部為先前稽核、修復及 18 題裁決工作 |
| 保護方式 | 逐項以 `git status --short` 及 `git diff` 核對；沒有 reset、checkout、格式化或覆蓋任何既有檔案；本 Sprint 只新增檔案及針對性修改 |
| 規範／CI | `AGENTS.md` 只有 Next.js 規則區塊；無 `CLAUDE.md`；無 `.github/` CI |
| 資料庫 | 本機 `data/app.db`（唯讀）；**沒有**接觸正式資料庫 |

**本次新增與既有修改的區分**：本次新增 `src/server/quality/*`、`scripts/audit-content-quality.ts`、`scripts/release-gate.ts`、`tests/content-quality.test.ts`、`tests/content-audit.test.ts`、`tests/release-gate.test.ts`、`docs/quality/*`、`docs/release-gate-2026-10-19.*`、`docs/release-evidence-2026-10-19.json`、`docs/teacher-review/copyright-owner-attestation-2026-10-19.md`、本報告；另外只修改 `package.json`（兩個 script）、`README.md`、`docs/teacher-review/README.md`、`docs/audit-2026-10-18-platform-audit.md`、`docs/teacher-review/content-quality-queue-2026-10-19.md` 的對應段落。沒有重做 18 題裁決。

## B. 實作

| 檔案 | 用途 | 解決的問題 |
| --- | --- | --- |
| `src/server/quality/source-traceability.ts` | 來源狀態純函式（`traceable`／`partial`／`unknown`／`pending_verification`） | 把「可定位程度」與史實、版權分開；不虛構文件、頁碼或核實紀錄 |
| `src/server/quality/explanation-quality.ts` | 解釋分類（`placeholder`／`answer_only`／`insufficient`／`potentially_inconsistent`／`not_assessed`）＋人工覆核疊加 | 集中管理佔位模板；短解釋不因長度單獨判錯；矛盾只進入覆核 |
| `src/server/quality/metadata-quality.ts` | 知識點／難度／技能規則 | 排版殘留、通用標籤、分節對不上、無效關聯（阻擋級） |
| `src/server/quality/question-policy.ts` | `hard_block`／`teacher_review`／`warning`／`policy_pending` | 不同性質問題分開處理；`canServe` 只依硬性規則，保持現行派發行為 |
| `src/server/quality/content-audit.ts` | 唯讀載入＋逐題分類＋內容指紋 | 可重複比較的稽核 |
| `src/server/quality/release-gates.ts` | 11 個閘門的純函式判定 | 未定義標準／無證據不可當作通過 |
| `src/server/quality/release-gate.ts` | 收集 DB、Golden、測試及部署證據 | 單一可執行閘門 |
| `scripts/audit-content-quality.ts` | CLI：JSON＋Markdown | 逐題代碼、嚴重程度、建議 |
| `scripts/release-gate.ts` | CLI：閘門報告；可選 `--fail-on-not-ready` | CI 可用 |

**資料契約**（沿用現有 schema，沒有 migration）：

- 來源：`origin`、`source_location`、`source_block_ids_json`、`source_verified`；文件由 `material_blocks` → `material_documents` 解析。平台**沒有**匯入批次表（已知缺口，未新增 migration）。
- 解釋：`explanation`；人工覆核由 `question_reviews`（revision＋fingerprint＋role≠automation，並以理由排除歷史自動修復）判定。
- 元數據：`knowledge_point`、`difficulty`、`skill`、`topic_id`、`section_id`；分節與課題的實際對應由 `sections` 驗證。
- 政策：不寫入資料庫；只在報告中分類。`canServe` 維持「隔離＋結構可作答＋有效關聯」的現行硬性規則，**沒有**把來源／解釋／元數據加入派發阻擋（屬產品政策）。

## C. 數據證據（2026-10-19，`data/app.db`，1,880 題）

| 指標 | 數量 | 查詢依據 |
| --- | --- | --- |
| 題目／已發布 | 1,880／1,880 | `SELECT COUNT(*) FROM questions` |
| 待教師確認 | **0** | `teacher_confirmation_required = 1` |
| `question_reviews` | **3,168** | `SELECT COUNT(*)` |
| 來源 `traceable` | **877** | `source_block_ids` 解析到現存段落＋文件 |
| 來源 `pending_verification` | **1,003** | 校內試題檔名＋題號，但無文件紀錄／雜湊／匯入批次 |
| 來源 `partial`／`unknown` | **0／0** | — |
| 解釋 `placeholder` | **1,334** | 佔位模板清單 |
| 解釋 `answer_only` | **546** | `填充題答案（依空格次序）…` |
| 解釋 `insufficient`／`potentially_inconsistent` | **0／0** | 啟發式規則 |
| 有人工覆核但仍低品質 | **1,244** | `question_reviews` 綁定目前 revision／fingerprint |
| 以非 `automation` 角色寫入的自動修復紀錄 | **1,279** | 理由含「自動修復」但 role 不是 automation（AU-30） |
| 技能空白 | **1,880** | `skill IS NULL` |
| 知識點排版殘留／通用標籤／對不上 | **122／587／878** | 分類規則 |
| 無效課題／分節關聯 | **0** | `topics`／`sections` 對照 |
| 難度值 | 只有 `basic` | `GROUP BY difficulty` |
| 已發布但結構不可作答 | **97** | `checkQuestionServable()`（派發層會攔下） |
| 教材文件／可發布／有權利紀錄 | **36／12／12** | `material_documents` |

**重要釐清**：舊報告的「580 題來源不可追溯」是**改寫來源不可追溯**（revision > 1 沒有修復紀錄），不是來源文件不可追溯。本 Sprint 分開量度：來源 `unknown` = 0，但 1,003 題只屬「待核實」。

## D. 測試

| 指令 | 退出碼 | 結果 |
| --- | --- | --- |
| `npm test` | 0 | **82 檔；1,131 通過、4 略過（1,135）**；0 失敗 |
| `npm run typecheck` | 0 | `next typegen` + `tsc --noEmit` 無錯誤 |
| `npm run lint` | 0 | 無錯誤、無警告 |
| `npm run build` | 0 | 首次因 OneDrive 鎖定 `.next` 而 EPERM；清除 `.next` 後成功（環境限制） |
| `npm run audit:repair-provenance` | 0 | 877 語意不變、987 純格式、**14** 考核答案仍與重建原卷不同（裁決後：2 刪除、2 改回原空格） |
| `npm run audit:content` | 0 | 見 C 節 |
| `npm run release:gate` | 0 | **NOT READY** |
| `node scripts/e2e-flow.mjs --start`（暫存 DB） | 1 | **121 通過／5 失敗** |

**E2E 5 項失敗（逐項分類）**：

1. `回饋包含教材來源位置`、2. `回饋包含教材原文節錄`：練習抽到沒有教材節錄的校內試卷題（既有資料特性，非本次改動）。
3. `此分節有填充題可用`：該分節在該難度沒有可用填充題（既有資料分佈）。
4. `OCR 完成`、5. `OCR 文字已寫入教材段落`：暫存快照沒有上載原檔，OCR 無法執行（環境限制）。
沒有新增失敗；與裁決衝刺前的 121／5 完全相同。

**未執行**：正式環境部署驗證、Cloud Run 多執行個體併發、備份還原演練（需要授權及正式環境）。

## E. Release gate

| 閘門 | 狀態 | 說明 |
| --- | --- | --- |
| question-isolation | **PASS** | 0 題待確認 |
| question-servability | **FAIL** | 97 題已發布但不可作答（派發層攔下；仍需修正／改回草稿） |
| answer-provenance | **PASS** | 18 題已裁決、0 未決 |
| source-traceability | **POLICY_PENDING** | 877／1,880 可定位；1,003 待核實 |
| explanation-quality | **POLICY_PENDING** | 1,334 佔位、546 只列答案；未定是否暫緩 |
| metadata | **POLICY_PENDING** | 1,587 項需教師確認；0 阻擋級 |
| teacher-decisions | **PASS** | 0 待覆核、0 未結回報 |
| copyright | **WARN** | 擁有者確認；逐份紀錄 12／36 |
| golden-evaluation | **INSUFFICIENT_EVIDENCE** | 空 |
| tests | **PASS** | 見 `docs/release-evidence-2026-10-19.json` |
| deployment | **INSUFFICIENT_EVIDENCE** | 未部署 |

**結果：NOT READY。** 已修正／建立的風險：來源、解釋、元數據及政策有可重複量度；未定義標準不再被當成通過；版權與史實分開。
仍存在的風險：內容（97 題不可作答、1,334＋546 解釋）、來源文件紀錄、元數據、Golden dataset、部署驗證。

**需要負責人決定的政策（decision list）**：

1. 佔位／只列答案的解釋是否暫緩派發（影響可用題目數）。
2. 1,003 題校內試題是否必須建立文件紀錄（檔名、題號、SHA-256）及匯入批次才可發布。
3. 技能標籤是否為發布必要條件（現為 WARN）。
4. 版權：接受擁有者聲明，或要求逐份授權證據（現為 WARN）。
5. 97 題已發布但不可作答：修正或改回草稿。
6. Golden dataset 的負責人、樣本數及完成日期。

## F. Git 與環境

- 沒有新增 migration。
- 沒有接觸正式資料庫、沒有部署。
- 沒有呼叫付費 AI；沒有批次改寫題目、答案、選項或解釋。
- `data/app.db` 及 `.next` 均為 gitignored；沒有把資料庫或建置產物加入提交。
- 依使用者指示，本 Sprint 完成後已 commit 及 push（內容見最後回報）。
