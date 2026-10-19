# Sprint 11 報告：教師裁決流程、安全修復證據與 Golden Dataset 核准

日期：2026-10-19
基準 HEAD：`6895db9`（`main`，與 `origin/main` 相同）
本 Sprint **沒有** commit、push、部署，也**沒有**接觸正式資料庫或呼叫付費 AI。

整體學生正式發布狀態仍然是 **NOT READY**。本 Sprint 只建立流程、證據與閘門，沒有把任何自動化結果轉成教師核准。

---

## A. Baseline

### A.1 起始狀態

| 項目 | 值 |
| --- | --- |
| Branch | `main` |
| HEAD | `6895db9` |
| `origin/main` | `6895db9` |
| 未提交項目 | 15 modified + 19 untracked = 34（Sprint 9–10 的成果，全部保留） |

Sprint 10 的 34 項未提交工作（`src/server/quality/*`、`scripts/audit-*.ts`、`tests/review-and-servability.test.ts`、`tests/golden-evaluation.test.ts`、`docs/quality/*`、`docs/teacher-review/golden-*`、`docs/sprint-10-report-2026-10-19.md` 等）**原樣保留**，沒有 reset、clean、覆蓋或格式化。

### A.2 本次新增／修改的檔案

新增：

- `src/server/services/servability-adjudication.ts` — 結構不可作答題目的教師裁決服務。
- `src/app/api/teacher/questions/[questionId]/servability/route.ts` — 裁決 API。
- `src/server/quality/provenance-risk.ts` — 只有自動化修復證據題目的風險分級（純函式）。
- `scripts/audit-provenance-risk.ts` — 唯讀風險報告。
- `scripts/audit-servability-evidence.ts` + `docs/quality/servability-evidence-2026-10-19.{json,md}`（Sprint 11 完成並重跑）— 96 題原始證據核對。
- `src/server/repositories/golden-fixtures.ts`、`src/server/services/golden-approval.ts`、`src/app/api/teacher/golden/route.ts`、`src/app/api/teacher/golden/[questionId]/route.ts`、`scripts/export-golden-fixtures.ts` — Golden v2 人工核准流程。
- `tests/servability-adjudication.test.ts`、`tests/golden-approval.test.ts`、`tests/provenance-risk.test.ts`。
- `docs/quality/provenance-risk-2026-10-19.{json,md}`、`docs/sprint-11-report-2026-10-19.md`（本檔）。

修改：

- `src/server/services/question-service.ts` — 核准不可繞過可作答性；`recordQuestionReview` 新增 `forceNew` 參數。
- `src/server/db/migrations.ts` — migration `0022-golden-fixture-reviews`（只新增表，不改舊表）。
- `src/server/quality/release-gates.ts` / `release-gate.ts` — 新增 3 個閘門。
- `scripts/release-gate.ts`、`package.json`（`audit:provenance-risk`、`golden:export`）。
- `tests/release-gate.test.ts`、`tests/authz-negative.test.ts`（路由清單）。
- `docs/release-evidence-2026-10-19.json`、`docs/audit-2026-10-18-platform-audit.md`、`README.md`、`docs/teacher-review/README.md`。

---

## B. 實作

### B.1 逐題教師裁決（97 題不可作答）

- API：`POST /api/teacher/questions/[questionId]/servability`
- 決策：`return_to_draft`、`keep_quarantined`、`request_more_evidence`、`reject`、`approve_after_verified_repair`。
- 重用既有 `recordQuestionReview()`：綁定題目版本與內容指紋、伺服器時間、覆核者身分（只取自工作階段）、並寫入 `question_reviews`。
- `keep_quarantined` 會設定 `teacher_confirmation_required = 1`，題目留在草稿。
- 需要真實教師／管理員工作階段：未登入 401、學生 403、示範模式身分**不可**記錄裁決。
- 版本衝突回 409，不記錄任何決定。
- 同一版本、同一決定但理由不同時會留下新紀錄（`forceNew`），不會被冪等邏輯吞掉。

`approve_after_verified_repair` 只在題目**已修復至結構可作答**時成功（會再經 `recordQuestionReview(approved)` 檢查）；未修復時回 409，不記錄任何決定。其餘四種決策都只記錄退回／不可用，不會令題目重新派發。

### B.2 核准不能繞過可作答性（P0 修正）

`recordQuestionReview()` 在 `decision === "approved"` 且 `checkQuestionServable()` 失敗時拋出 409：

> 無法核准：題目結構上不可作答（…）。請先修正題目內容並重新檢查，或退回草稿／保留隔離。這次沒有記錄任何覆核決定。

這堵住「教師按下通過 → 97 題重新派發」的繞過途徑，同時保留 Sprint 9 對 `qb-JTH2ndEdFBQ09015` 的原文裁決（裁決紀錄不動，題目仍然不可派發）。

同時 `changeQuestionStatus()` 在 `status === "published"` 時也會執行 `checkQuestionServable()`：即使題目仍有舊版本的核准紀錄，直接切換狀態也回 409。發布狀態本身不會再標示一個結構上不可作答的題目為「可用」。

### B.3 96 題羅馬數字題目的原始證據核對

`npm run audit:servability-evidence`（唯讀）在 `materials/` 找回原始 DOCX，抽取題幹段落，比對陳述句與 i／ii／iii 標示：

| 結果 | 題數 | 意義 |
| --- | --- | --- |
| `labels_missing_in_source` | **81** | 原文標示不齊全：80 題陳述完全沒有編號（表格／分欄轉換時已失去），1 題只有 i–iii、缺 iv |
| `statement_count_mismatch` | **10** | 原文陳述數與選項指涉的數目不同，需要教師判斷 |
| `source_file_missing` | **4** | `materials/` 沒有對應原始檔 |
| `source_block_not_found` | **1** | 找到檔案但定位不到題幹段落 |
| `labels_present_in_source`（可直接補標示） | **0** | — |

**結論：0 題具備「按原文即可確定補上標示」的可靠證據。** 例如 `qb-JTH2ndEdMCQ01023` 原文題幹就是「下列哪些屬於一手資料？ 日記 錄像 事件發生時的報導 學術論文」，四句之間沒有編號；按選項順序補 i／ii／iii 屬於推測，Sprint 明文禁止，因此 **96 題全部需要教師裁決**（或提供原卷掃描）。

### B.4 623 題只有自動化修復證據的風險分級

`npm run audit:provenance-risk` 連接 `audit:review-provenance` 的 `automationOnly` 清單與 `audit:repair-provenance --full` 的逐題比較結果：

| 等級 | 題數 | 判準 |
| --- | --- | --- |
| P0 | **0** | 答案映射或題目含義改變 |
| P1 | **530** | 多空格填充題補回其餘空格（題幹改變），但考核空格及答案不變 |
| P2 | **0** | 沒有可比較的原始內容 |
| P3 | **93** | 只移除選項殘留項目符號（`FORMATTING_CHANGE_ONLY`），文字及答案相同 |

分級只採用可核實的 diff，不採信修復腳本「答案不變」的文字說明；P3 只代表覆核次序較後，**不是**已核准。

### B.5 Golden Dataset v2 人工核准流程

- `GET /api/teacher/golden` — 候選清單（含目前版本、指紋、既有裁決、是否失效）。
- `POST /api/teacher/golden/[questionId]` — `approved` / `rejected` / `revision_requested`。
- 核准**必須**同時提供教師評估內容（`category`、`reasoning`、預期 `grading`、`distractorNotes`、`knownEdgeCases`、`reference`、`level`）；否則回 400，不能只記一個「核准」。
- 裁決寫入 `golden_fixture_reviews`（只新增，不更新或刪除），綁定題目版本＋指紋；題目改動後裁決自動失效（`stale`）。
- `npm run golden:export` 只匯出仍然有效且通過 `goldenFixtureSchema` 的 approved fixture；沒有教師核准時必然是 0。

**目前 approved fixture 仍為 0**：本 Sprint 沒有真實歷史科教師完成核准，`golden:eval` 維持 `INSUFFICIENT_EVIDENCE`。

### B.6 資料契約

| 概念 | 來源 | 不可混淆之處 |
| --- | --- | --- |
| 來源可追溯 | `source_location`、`source_block_ids`、`material_documents` | 不等於版權許可，也不等於歷史正確 |
| 版權 | `material_documents.rights_confirmed_at` ＋ 擁有者聲明 | 不等於內容正確 |
| 可作答性 | `checkQuestionServable()`（單一真相） | 核准不能繞過 |
| 發布核准 | `question_reviews`（版本＋指紋） | 自動化紀錄不可冒充教師 |
| 結構裁決 | `question_reviews` 理由前綴 `結構裁決（ISSUE_CODE）：…` | 與一般覆核同表，但可辨識 |
| Golden fixture 核准 | `golden_fixture_reviews` | 與發布無關，不改變題目狀態 |

---

## C. 數據證據

| 指標 | 數值 | 查詢依據 |
| --- | --- | --- |
| 題目總數／已發布 | 1,880／1,880 | `audit:content`、`release:gate` |
| 已發布但不可作答 | **97**（96 羅馬數字、1 答案外洩） | `audit:servability` |
| 有原始證據可直接補標示 | **0**／96 | `audit:servability-evidence` |
| 已有結構裁決紀錄 | **0** | `release:gate`（`question_reviews.reason LIKE '結構裁決%'`） |
| 待教師裁決的不可作答題目 | **97** | 上一列相減 |
| 教師逐題裁決／擁有者批次／只有自動修復 | 16／1,241／623 | `audit:review-provenance` |
| Provenance 風險 P0／P1／P2／P3 | 0／530／0／93 | `audit:provenance-risk` |
| Golden 候選／approved／pending／stale | 42／0／42／0 | `golden:candidates`、`golden:export --check` |
| 覆核紀錄總數 | 3,168（未改動） | `question_reviews` |

---

## D. 測試

| 指令 | 結果 |
| --- | --- |
| `npm test` | 87 檔通過；**1,193 通過、4 略過（1,197）** |
| `npm run typecheck` | 通過 |
| `npm run lint` | 通過 |
| `npm run build` | 通過（先清除 `.next` 避開 OneDrive 鎖定） |
| `npm run audit:repair-provenance` | 877 語意不變／987 純格式／14 曾改變考核答案（已裁決） |
| `npm run audit:content` | 完成（唯讀） |
| `npm run audit:servability` | 97 題不可作答 |
| `npm run audit:servability-evidence` | 96 題核對完成；0 題可直接補標示（81 題原文標示不齊全：80 題完全無編號、1 題只有 i–iii） |
| `npm run audit:review-provenance` | 3,168 筆分類完成 |
| `npm run audit:provenance-risk` | 623 題分級完成 |
| `npm run golden:candidates` | 42 候選 |
| `npm run golden:export -- --check` | 0 approved fixture |
| `npm run golden:eval` | `INSUFFICIENT_EVIDENCE` |
| `npm run release:gate` | **NOT READY**（15 個閘門） |
| `node scripts/e2e-flow.mjs --start`（暫存 DB、空上載目錄、匿名示範模式） | **121 通過／5 失敗**（與 Sprint 9、10 相同的環境限制） |

E2E 的 5 項失敗（已逐項核對，非本次回歸）：

1. `回饋包含教材來源位置`、2. `回饋包含教材原文節錄` — 練習抽到沒有教材節錄的校內試卷題。
3. `此分節有填充題可用` — 該分節在該難度沒有可用填充題。
4. `OCR 完成`、5. `OCR 文字已寫入教材段落` — 快照資料庫沒有上載原檔。

未執行：正式環境部署驗證、Cloud Run 併發、備份還原演練（需要授權）。

### 新增測試覆蓋

- `tests/servability-adjudication.test.ts`（9）：權限 401／403、四種裁決、理由必填、版本衝突 409、歷史保留、核准被拒、修復後可核准。
- `tests/golden-approval.test.ts`（6）：權限、核准必須有評估內容、reviewer 取自工作階段、匯出可重現、指紋失效、版本衝突、拒絕／要求修訂。
- `tests/provenance-risk.test.ts`（7）：P0／P1／P2／P3 判準、無證據不假設、可重複。
- `tests/release-gate.test.ts`（+5）、`tests/authz-negative.test.ts`（+3 路由）— 146 項路由授權測試全部通過。

---

## E. Release gate

| 閘門 | 狀態 | 證據 |
| --- | --- | --- |
| question-isolation | PASS | 0 題待教師確認 |
| question-servability | **FAIL** | 97 題已發布但不可作答（派發層攔下） |
| answer-provenance | PASS | 18 題已裁決 |
| source-traceability | POLICY_PENDING | 877／1,880 |
| explanation-quality | POLICY_PENDING | 1,334 佔位 ＋ 546 只列答案 |
| metadata | POLICY_PENDING | 1,880 題技能空白 |
| teacher-decisions | PASS | 0 |
| review-provenance | POLICY_PENDING | 623 題只有自動修復證據 |
| copyright | WARN | 擁有者已確認；逐份 12／36 |
| golden-evaluation | INSUFFICIENT_EVIDENCE | 資料集 0 fixture |
| **servability-adjudication** | **POLICY_PENDING** | 97 題待教師裁決；0 題可自動補標示 |
| **provenance-risk** | **POLICY_PENDING** | P1 530、P3 93 |
| **golden-approval** | **INSUFFICIENT_EVIDENCE** | 0 approved／42 候選 |
| tests | PASS | 見 §D |
| deployment | INSUFFICIENT_EVIDENCE | 未部署 |

**整體：NOT READY。** 不可作答題目即使獲得教師裁決，仍受 `checkQuestionServable()` 攔截；沒有 golden fixture 不會被當成零錯誤。

### 仍需科組／負責人決定

1. 96 題羅馬數字題目：提供原卷掃描逐一補回標示，或退回草稿重寫，或永久不派發。
2. `qb-JTH2ndEdFBQ09015`：維持原文但不可派發（現狀），或改寫題幹、或退回課程設計者。
3. 623 題：現有自動修復證據是否足以支持目前版本，或需教師逐題確認（P1 530 題優先）。
4. 1,334 題佔位解釋及 1,880 題空白技能標籤的發布政策。
5. Golden Dataset 由哪位歷史科教師負責逐題核准（需要真實身分，不能用 admin 代替）。

---

## F. Git 與環境

- 修改後 `git status --short` 見交付訊息；所有 Sprint 9–10 的未提交工作仍在工作樹中。
- 有 migration：`0022-golden-fixture-reviews`（只建立新表 `golden_fixture_reviews`，不改舊表；舊資料庫未套用時發布閘門視為 0 筆裁決）。
- **沒有操作正式資料庫。**
- **沒有部署。**
- **沒有 commit。**
- **沒有 push。**


