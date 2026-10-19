# Sprint 12 報告：發布閘門加固、內容治理與教師授權稽核

日期：2026-10-19
基準 HEAD：`6895db9`（`main`，與 `origin/main` 相同）
工作樹：Sprint 9–11 的 54 項未提交成果（實際 **18 modified + 36 untracked**）全部保留；本 Sprint 再新增 **4 個檔案**、修改 **5 個既有檔案**（見 §1.3），結束時共 **63 項**（23 modified + 40 untracked）。

**整體發布狀態：NOT READY**（原因見 §11）。本 Sprint 的目標不是讓 gate 變綠，而是驗證控制是否完整、找出仍可繞過的路徑，並只修正有充分證據支持的程式問題。

> 標記說明：**【實測】**＝本次實際執行並記錄輸出；**【靜態】**＝閱讀程式碼／schema 得出；**【推論】**＝由前兩者推理，未直接執行；**【未驗證】**＝現有環境無法驗證（需正式環境或負責人決定）。

---

## 1. Git 狀態

### 1.1 起始（校對後）【實測】

| 項目 | 實際值 | 預期值（Sprint 11 報告） | 差異 |
| --- | --- | --- | --- |
| Branch | `main` | `main` | 一致 |
| HEAD | `6895db9` | `6895db9` | 一致 |
| `origin/main` | `6895db9` | `6895db9` | 一致 |
| 未提交項目 | 54（**18 modified + 36 untracked**） | 54（21 modified + 33 untracked） | 總數相同；**組成不同**（見 §1.2） |

**基線差異說明**：Sprint 11 結束報告的「21 modified + 33 untracked」與實際 `git status --short` 不符；實際為 **18 modified + 36 untracked**（合計同為 54）。原因是把 3 個 untracked 目錄／檔案誤記為 modified。本 Sprint 以實際 Git 輸出為準，沒有改動任何檔案來「對齊」舊報告，並在 Sprint 11 報告的數字上保留原文（歷史紀錄不改寫）。

### 1.2 既有工作的保護

沒有執行 `git reset`、`git clean`、強制 checkout 或任何格式化；沒有刪除或覆寫 Sprint 9–11 的檔案。所有既有修改原樣保留（`git status` 對照見 §1.3 與 §12）。

### 1.3 本 Sprint 的改動

**新增**

| 檔案 | 用途 |
| --- | --- |
| `src/server/auth/history-reviewer.ts` | 歷史科學科授權邊界（`HISTORY_REVIEWER_EMAILS`，fail-closed） |
| `tests/release-controls.test.ts` | TOCTOU、批次候選、快照作答、閘門 fail-closed（4 組） |
| `docs/teacher-review/policy-decisions-2026-10-19.md` | 10 項待決政策（負責人用） |
| `docs/sprint-12-report-2026-10-19.md` | 本報告 |

**修改**（其中 5 個是本 Sprint 首次改動；其餘是 Sprint 9–11 已修改檔案上的追加）

| 檔案 | 改動 |
| --- | --- |
| `src/server/repositories/questions.ts` | 新增 `setQuestionStatusIfRevision()`（條件式更新） |
| `src/server/services/question-service.ts` | 覆核／發布改用條件式更新；批次發布及批次覆核候選排除結構不可作答題目 |
| `src/server/services/practice-service.ts` | 舊練習快照中**未作答**題目在題庫被隔離／不可作答時拒絕作答（已作答者仍可看歷史回饋） |
| `src/server/services/servability-adjudication.ts` | `approve_after_verified_repair` 需歷史科審核者名單 |
| `src/server/services/golden-approval.ts` | 所有 Golden 裁決需歷史科審核者名單（admin 不足） |
| `src/server/quality/release-gates.ts` | 沒有題目資料時，內容閘門一律 `INSUFFICIENT_EVIDENCE` |
| `tests/migration-safety.test.ts` | migration 0022 升級／冪等／主鍵測試 |
| `tests/golden-approval.test.ts`、`tests/servability-adjudication.test.ts` | 學科授權測試（admin 403、名單未設定 403） |
| `tests/authz-negative.test.ts` | Golden 路由 `adminAllowed: false`、名單環境設定 |
| `scripts/e2e-flow.mjs` | 兩項過時斷言改為驗證 fail-closed 政策；填充題改用父分節抽題 |
| `.env.example` | `HISTORY_REVIEWER_EMAILS` 說明 |
| `docs/release-evidence-2026-10-19.json` | Sprint 12 執行結果 |

---

## 2. 保留的原有成果【實測】

54 項原有未提交項目全部仍在（`git status --short` 與 Sprint 11 結束時逐項一致），包括：
`src/server/quality/*`、`scripts/audit-*.ts`、`scripts/golden-*.ts`、`tests/review-and-servability.test.ts`、`tests/golden-evaluation.test.ts`、`tests/servability-adjudication.test.ts`、`tests/golden-approval.test.ts`、`tests/provenance-risk.test.ts`、`docs/quality/*`、`docs/sprint-10-report-2026-10-19.md`、`docs/sprint-11-report-2026-10-19.md`、`docs/teacher-review/golden-*`、`src/app/api/teacher/golden/`、`src/app/api/teacher/questions/[questionId]/servability/`、`src/server/services/golden-approval.ts`、`src/server/services/servability-adjudication.ts`、`src/server/repositories/golden-fixtures.ts`。

---

## 3. 題目寫入、核准、發布及派發路徑矩陣【靜態＋實測】

Route 總數：**35 個 route 檔／45 個 HTTP 方法**（`src/app/api/**/route.ts`，指令碼實際計數）。

### 3.1 學生派發路徑（P0）

| 入口 | 檔案 | 身分／授權 | 過濾條件 | 可作答性 | 測試證據 |
| --- | --- | --- | --- | --- | --- |
| 建立練習（題庫） | `src/app/api/practice/route.ts` → `practice-service.createPractice` | 學習者身分（`learnerId`／工作階段）；不可冒用他人 | `status='published'` ＋ `!teacherConfirmationRequired` | `checkQuestionServable()` | `tests/practice-*.test.ts`、`tests/teacher-adjudication.test.ts` |
| 建立練習（即時生成） | 同上 | 同上 | 生成結果再過濾 | 同上（生成後再檢查） | 同上 |
| 建立練習（題庫不足時生成） | 同上 | 同上 | `!teacherConfirmationRequired` | 同上 | 同上 |
| 錯題重練 | 同上（`mode: wrong-only`） | 同上 | 只取同一學習者過往錯題；**題庫已隔離則略過並提示** | 以快照內容 + 題庫隔離狀態檢查 | `tests/teacher-adjudication.test.ts`（隔離題不重新派發） |
| 舊練習快照載入 | `GET /api/practice/[sessionId]` → `getPracticeView` | 練習擁有者（403 否則） | 顯示快照（歷史內容） | 不派新題 | `tests/practice-*.test.ts` |
| **舊練習快照作答** | `POST /api/practice/[sessionId]/answers` → `submitAnswer` | 練習擁有者 | — | **Sprint 12 新增**：未作答題目在題庫被隔離／不可作答時回 409；已作答題目仍回歷史回饋 | `tests/release-controls.test.ts`（新） |
| 成績／進度 | `GET /api/practice/[sessionId]/result`、`GET /api/progress` | 練習擁有者 | — | 只讀歷史紀錄 | `tests/practice-*.test.ts` |
| 直接按 ID 取題 | 沒有公開 API；`GET /api/teacher/...` 需教師 | — | — | — | `tests/authz-negative.test.ts` |
| 課題／教材 | `GET /api/topics*`、`/lesson` | 公開（教材另受發行權閘門） | `topics.published=1` | 不涉及題目 | `tests/lesson-*.test.ts` |

### 3.2 教師／管理員寫入路徑

| 入口 | 檔案 | 授權 | 驗證 | 狀態更新方式 |
| --- | --- | --- | --- | --- |
| 建立／編輯題目 | `POST/PATCH /api/teacher/questions` | `requireTeacher` | `questionInputSchema`；禁止直接發布 | `updateManualQuestion()` → 版本遞增、回到草稿 |
| 逐題覆核 | `POST /api/teacher/questions/[id]/review` → `recordQuestionReview` | `requireTeacher`（部署環境必須真實工作階段） | 版本＋指紋比對（409）；**核准先檢查 `checkQuestionServable`**；**Sprint 12：條件式狀態更新** | `setQuestionStatusIfRevision()` |
| 結構裁決 | `POST /api/teacher/questions/[id]/servability` | `requireTeacher`（不接受示範模式） | 理由長度、版本比對；`approve_after_verified_repair` **另需歷史科審核者名單** | `recordQuestionReview` ＋ `setTeacherConfirmationRequired` |
| 狀態切換（發布／下架） | `PATCH /api/teacher/questions/[id]` | `requireTeacher` | 待確認標記、覆核證據、**可作答性** | `setQuestionStatusIfRevision()` |
| 刪除題目 | `DELETE /api/teacher/questions/[id]` | `requireTeacher` | — | 直接刪除（既有練習快照不受影響） |
| AI 生成題目 | `POST /api/teacher/questions/generate` | `requireTeacher` | 生成品質閘門＋`checkQuestionServable` | 自動驗證通過才發布（`setQuestionStatusIfRevision`） |
| Golden 裁決 | `GET/POST /api/teacher/golden...` | `requireTeacher` ＋ **歷史科審核者名單** | 版本＋指紋、fixture 內容 schema | 只新增 `golden_fixture_reviews`（不改題目狀態） |
| 批次發布／批次覆核 | `scripts/publish-draft-questions.ts`、`scripts/approve-questions.ts` | 擁有者授權（`--owner-email`／`--reason`／`--apply`） | 待確認題目排除；**Sprint 12：結構不可作答題目亦排除** | `setQuestionStatusIfRevision`／`recordQuestionReview` |
| 匯入校內試題 | `question-bank-import-service` | 管理員端／CLI | 匯入時即用 `checkQuestionServable` 略過結構不可作答題目 | 新增題目為草稿／待確認 |
| 題庫修復 | `scripts/repair-question-bank.ts`、`question-repair.ts` | CLI（預設模擬） | 修復前後比對；改變考核答案→隔離 | 條件更新＋隔離標記 |

### 3.3 已驗證的結論

1. **學生派題一致性**：三條建立練習分支（題庫／錯題／生成）及舊快照作答都經過 `checkQuestionServable()`；97 題不可作答題目沒有派發入口（`tests/teacher-adjudication.test.ts`、`tests/release-controls.test.ts`）。【實測】
2. **不可繞過的重複檢查**：`approve_after_verified_repair` 先檢查 `checkQuestionServable`，再由 `recordQuestionReview(approved)` 再檢查一次；`changeQuestionStatus(published)` 亦有同一檢查。【實測＋靜態】
3. **TOCTOU**：所有發布／狀態更新改用 `UPDATE ... WHERE revision = ?`；版本不符時不更新並回 409（`tests/release-controls.test.ts`）。【實測】
4. **並行／重複提交**：`insertQuestionReview` 以（版本、指紋、決定）冪等，`forceNew` 只用於「同一版本但理由不同」的獨立決定；migration 0021 已移除唯一索引並由應用層維持冪等。【靜態＋既有測試】
5. **admin ≠ 歷史科教師**：Golden 裁決及「已修復並核准」需 `HISTORY_REVIEWER_EMAILS` 名單；名單為空時 fail-closed（`tests/golden-approval.test.ts`、`tests/servability-adjudication.test.ts`、`tests/authz-negative.test.ts`）。【實測】

---

## 4. 97 題 servability 與裁決流程【實測】

| 項目 | 數值 | 來源 |
| --- | --- | --- |
| 已發布但不可作答 | **97**（96 `MCQ_ROMAN_LABEL_MISSING`、1 `FILL_ANSWER_LEAKS`） | `npm run audit:servability` |
| 96 題原文核對 | 81 題標示不齊全（80 完全無編號、1 只有 i–iii）、10 題陳述數不符、4 題缺檔、1 題找不到段落 | `npm run audit:servability-evidence` |
| 可由原文直接補標示 | **0** | 同上 |
| 已有結構裁決紀錄 | **0** | `release:gate`（`question_reviews.reason LIKE '結構裁決%'`） |
| 仍待教師裁決 | **97** | 同上 |

裁決流程測試（`tests/servability-adjudication.test.ts`，11 項，全通過）：
未登入 401、學生 403、四種非核准決策、理由必填、版本衝突 409、歷史保留、核准被 409 拒絕、修復後才可核准、`approve_after_verified_repair` 未修復 409／修復後 200、已有舊核准仍不能直接改狀態發布、**不在學科名單者不可核准（403）**。

`qb-JTH2ndEdFBQ09015`：Sprint 9 裁決紀錄未改動；`checkQuestionServable` 仍攔截；`recordQuestionReview(approved)` 及 `changeQuestionStatus(published)` 都回 409；沒有練習快照、0 次作答。【實測】

---

## 5. 623 題 provenance 風險的驗證方法與結果【實測】

**方法**：`npm run audit:provenance-risk` = `audit:review-provenance` 的 `automationOnly` 清單（623 題）∩ `audit:repair-provenance --full` 以 `materials/` 原文重建的逐題 diff。分級只採用可核實的分類，不採信修復腳本的文字說明。

| 等級 | 題數 | 判準 | 抽樣核對 |
| --- | --- | --- | --- |
| P0 | 0 | 答案映射或題目含義改變 | — |
| P1 | **530** | 多空格填充題補回其餘空格（題幹改變），考核空格及答案不變 | `qb-JTH2ndEdFBQ01002`：原文 2 個空格、現時題幹已填「信史時期」，考核答案仍為「史前時期」 |
| P2 | 0 | 沒有可比較的原始內容 | — |
| P3 | **93** | 只移除選項殘留項目符號（`FORMATTING_CHANGE_ONLY`），文字及答案相同 | 分類為 `FORMATTING_CHANGE_ONLY` 且逐字比較相同 |

多空格填充題的專項核對（`audit:repair-provenance` 逐題欄位）：`blankCountOriginal`／`blankCountCurrent`、`assessedBlankIndexOriginal／Current`、`originalCorrectAnswer／currentCorrectAnswer`、`originalOptions／currentOptions`、`classifications`。
**限制**：資料庫沒有保存舊版本內容，比較基準是「由原始試題檔可重建的內容」；因此 P1 的結論是「按現行解析器重建後，考核答案不變」，不是「歷史紀錄顯示答案未改」。P3 只代表覆核次序較後，**不代表已核准**。

---

## 6. Golden Dataset：授權、migration、核准與失效【實測】

| 檢查 | 結果 |
| --- | --- |
| 候選／pending／approved／rejected／stale | 42／42／**0**／0／0 |
| `golden:export -- --check` | 0 approved fixture（沒有真實教師核准） |
| `golden:eval` | `INSUFFICIENT_EVIDENCE` |
| 學科授權 | 名單外的 admin → **403**；名單未設定 → 教師亦 **403**；名單內教師 → 可裁決 |
| 核准內容驗證 | 缺 `fixture`（category／reasoning／預期 grading／distractorNotes）→ 400 |
| 版本衝突 | `expectedRevision` 不符 → 409，不寫入 |
| 版本／指紋失效 | 題目改動後候選狀態 `stale`，匯出 0，`invalidated` 說明原因 |
| migration 0022 | 由 0021 升級建立表＋索引；欄位齊全；既有 `question_reviews` 保留；重複套用冪等；主鍵重複寫入失敗（不覆蓋裁決） |
| 舊資料庫缺表時 | `release-gate` 的查詢有 try/catch，視為「0 筆裁決」（不會當成已通過） |

`tests/golden-approval.test.ts` 6 項既有 ＋ 2 項新增（合共 8 項）全通過；`tests/migration-safety.test.ts` 19 項全通過（含 2 項 0022 專項）。

---

## 7. 每一個 release gate 的狀態與證據【實測】

來源：`npm run release:gate`（15 項，讀取 `data/app.db` 唯讀 ＋ 報告檔）。

| # | Gate | 狀態 | 證據／分子分母 | 對學生派發的實際影響 |
| --- | --- | --- | --- | --- |
| 1 | question-isolation | PASS | 0／1880 待教師確認 | 無題目被旗標攔下 |
| 2 | question-servability | **FAIL** | 97／1880（96 羅馬數字、1 答案外洩） | 派發層已攔下；學生收不到 |
| 3 | answer-provenance | PASS | 0／18 未決 | 已完成教師裁決 |
| 4 | source-traceability | POLICY_PENDING | 877／1880 可定位 | 不影響派發 |
| 5 | explanation-quality | POLICY_PENDING | 1,334 佔位＋546 只列答案 | 不影響派發；教學品質 |
| 6 | metadata | POLICY_PENDING | 1,880 技能空白 | 推薦／篩選降級 |
| 7 | teacher-decisions | PASS | 0 待覆核、0 未結回報 | — |
| 8 | review-provenance | POLICY_PENDING | 623 只有自動修復證據 | 題目可派發，但未經教師逐題確認 |
| 9 | copyright | WARN | 12／36 可發布 | 未確認材料不顯示 |
| 10 | golden-evaluation | INSUFFICIENT_EVIDENCE | 0 fixture | 不影響派發 |
| 11 | servability-adjudication | POLICY_PENDING | 97 待裁決／0 可自動修復 | 已由派發層攔下 |
| 12 | provenance-risk | POLICY_PENDING | P1 530／P3 93 | 不影響派發 |
| 13 | golden-approval | INSUFFICIENT_EVIDENCE | 0 approved／42 候選 | 不影響派發 |
| 14 | tests | PASS | 16 條命令、0 失敗 | — |
| 15 | deployment | INSUFFICIENT_EVIDENCE | 無 staging／production 證據 | 未驗證正式環境 |

**Fail-closed 實證**：本 Sprint 一次 `release-evidence` 檔因編輯時加入 UTF-8 BOM 而無法解析，閘門立即把 `tests` 由 PASS 降為 `INSUFFICIENT_EVIDENCE`（輸出「沒有可重現的測試證據檔」），而不是當成通過；修正編碼後才回 PASS。【實測】
新增測試另證明：`audit.totals.questions === 0` 時，8 個內容閘門一律 `INSUFFICIENT_EVIDENCE`，整體 `NOT READY`（`tests/release-controls.test.ts`）。【實測】

---

## 8. 5 個 E2E 失敗的根因【實測】

執行方式：`%TEMP%` 暫存資料庫（`data/app.db` 複本）＋ 匿名示範模式 ＋ `LLM_PROVIDER=mock`。

| # | 測試名稱 | 原本結果 | 根因 | 本次處理 | 現況 |
| --- | --- | --- | --- | --- | --- |
| 1 | `回饋包含教材來源位置` | 失敗 | 練習首題是 `origin = school-paper`、`source_block_ids = []`；`source-visibility.ts` 依 Sprint 7.5 政策 **fail-closed** 不向學生顯示檔名／題號／節錄（`sourceWithheld=true`）。斷言與既定政策矛盾。 | 改為驗證政策一致性：顯示時必須有位置＋節錄；不顯示時兩者必須為空且 `sourceWithheld=true` | **已修正（更嚴格）** |
| 2 | `回饋包含教材原文節錄` | 失敗 | 同上 | 同上 | **已修正（更嚴格）** |
| 3 | `此分節有填充題可用` | 失敗 | E2E 選中的 `childSection`（`topic-5-renaissance-features` 主要特點）在資料庫中**只有選擇題**：`SELECT question_type, COUNT(*) ... = mc/basic 93 題、fill 0 題`（任何狀態） | 填充題改用父分節（`topic-5-renaissance`，含子分節；47 題 fill/basic），實際驗證自動評分 | **已修正（真正執行原本預期的功能）** |
| 4 | `OCR 完成（狀態為 done 或 partial）` | 失敗 | 暫存資料庫的 `material_documents.stored_path` 指向原始上載檔，但暫存上載目錄是空的；OCR 服務找不到原檔 → `failed` | 不改程式；用同一暫存 DB 把 `data/uploads` 複製到暫存上載目錄重跑 | **已證實為夾具環境**：有原檔時 OCR 完成 |
| 5 | `OCR 文字已寫入教材段落並標示來源` | 失敗 | 同上（OCR 未執行，所以 0 段） | 同上 | **已證實為夾具環境** |

**結果對照**（同一天、同一程式）：

| 情境 | 通過 | 失敗 |
| --- | --- | --- |
| 暫存 DB ＋ 空上載目錄 | **126** | **2**（只餘兩項 OCR，缺原檔） |
| 暫存 DB ＋ 複製 `data/uploads` | **128** | **0** |

**是否可能掩蓋真實缺陷**：這 5 項都不涉及授權、派題、審核或持久化（失敗在 assertion／資料準備）。§1–§7 的授權與派題契約另有 146 項 `authz-negative`、11 項 servability、8 項 Golden、19 項 migration 及新增 12 項 release-controls 測試覆蓋。
**未解決項**：`UNRESOLVED`＝E2E 預設（空上載）下 OCR 兩項仍會失敗；需要執行者提供與快照 DB 相符的原始上載目錄（本次已示範可行）。

---

## 9. 測試命令、退出碼與結果【實測】

| 命令 | 退出碼 | 結果 |
| --- | --- | --- |
| `npm test` | 0 | **88 檔；1,203 通過、4 略過（1,207）** |
| `npm run typecheck` | 0 | `next typegen` + `tsc --noEmit` 無錯誤 |
| `npm run lint` | 0 | ESLint 無錯誤 |
| `npm run build` | 0 | Next.js 建置成功（先清 `.next` 避 OneDrive EPERM） |
| `npm run audit:repair-provenance` | 0 | 877 語意不變／987 純格式／14 曾改考核答案（已裁決） |
| `npm run audit:content` | 0 | 來源 877／1,003／0／0；解釋 1,334／546／0／1,244 |
| `npm run audit:servability` | 0 | 97 題不可作答 |
| `npm run audit:servability-evidence` | 0 | 96 題核對；0 題可直接補標示 |
| `npm run audit:review-provenance` | 0 | 1,882 批次／1,266 自動修復／20 教師裁決；目前版本 16／1,241／623 |
| `npm run audit:provenance-risk` | 0 | P0 0／P1 530／P2 0／P3 93 |
| `npm run golden:candidates` | 0 | 42 候選 |
| `npm run golden:export -- --check` | 0 | 0 approved |
| `npm run golden:eval` | 0 | `INSUFFICIENT_EVIDENCE` |
| `npm run release:gate` | 0 | **NOT READY**（15 項） |
| E2E（空上載） | 1 | 126 通過／2 失敗（OCR 缺原檔） |
| E2E（複製原檔） | 0 | **128 通過／0 失敗** |
| `tests/migration-safety.test.ts`（含 0022） | 0 | 19 通過 |
| `tests/release-controls.test.ts`（新） | 0 | 4 通過 |
| `tests/authz-negative.test.ts` | 0 | 146 通過 |
| `tests/golden-approval.test.ts` | 0 | 8 通過 |
| `tests/servability-adjudication.test.ts` | 0 | 12 通過 |

只使用暫存資料庫（`tests/test-database.ts`）與暫存上載目錄；沒有連接正式資料庫。

---

## 10. 未解決的技術問題與政策決定

### 10.1 技術（本 Sprint 未能／不宜在現有環境解決）【未驗證】

1. **migration 回滾**：專案沒有回滾政策；只在暫存資料庫驗證「升級＋重複套用」，未測試降級（不應在正式環境測試）。`UNVERIFIED`。
2. **多執行個體併發**：條件式更新可防止單一 SQLite 檔案內的競態，但 Cloud Run 多執行個體共用 SQLite 的可行性未驗證（需要正式／staging 環境）。
3. **E2E 預設模式的 OCR**：需要與快照 DB 相符的原始上載目錄（本次以複製 `data/uploads` 示範可行）。
4. **1 題部分標示**（`qb-JTH2ndEdMCQ05173`：原文有 i–iii、缺 iv）：技術上可補，但屬內容判斷，保留教師裁決。
5. **`golden:export -- --check` 不是純唯讀**：它經 `getDb()` 套用未執行的 migration（本機開發資料庫因此在 Sprint 11 已套用 0022）。不影響內容正確性，但若要嚴格區分「檢查」與「初始化」，應改用唯讀連線；本 Sprint 只記錄，未修改（避免擴大變更範圍）。

### 10.2 政策（需科組／負責人）【未驗證】

完整清單及安全預設見 [docs/teacher-review/policy-decisions-2026-10-19.md](teacher-review/policy-decisions-2026-10-19.md)：96 題處置、`qb-JTH2ndEdFBQ09015`、P1 530／P3 93 覆核範圍、1,003 題來源核實、1,334＋546 解釋標準、1,880 技能標籤、36 份材料權利、Golden 審核者名單、部署驗收。

**需要填寫的設定**：`HISTORY_REVIEWER_EMAILS`（目前未設定 → 沒有人可以核准 Golden fixture 或「已修復並核准」）。這是刻意的 fail-closed 預設，需科組指定人選。

---

## 11. 為何仍是 NOT READY

阻止 READY 的具體原因（全部有證據）：

1. `question-servability` **FAIL**：97 題已發布但不可作答（派發層已攔下，但發布狀態仍是錯訊號）。
2. `review-provenance`／`provenance-risk`／`servability-adjudication` **POLICY_PENDING**：530＋93 題需覆核政策；97 題需教師裁決。
3. `source-traceability`／`explanation-quality`／`metadata` **POLICY_PENDING**：1,003、1,334＋546、1,880 的標準未定。
4. `golden-evaluation`／`golden-approval` **INSUFFICIENT_EVIDENCE**：0 approved fixture，且沒有指定歷史科教師。
5. `deployment` **INSUFFICIENT_EVIDENCE**：沒有 staging／production 驗證。
6. `copyright` **WARN**：逐份權利證據 12／36。

沒有為了讓結果變 READY 而刪除 gate、降低標準或改分類。

---

## 12. 環境聲明

- **沒有操作正式資料庫**：所有稽核以 `readOnly` 開啟 `data/app.db`；測試用 `%TEMP%` 暫存資料庫；E2E 只用 `data/app.db` 的**複本**。
- **沒有對正式環境執行 migration**：migration 0022 只在暫存資料庫（測試）及**本機開發資料庫**套用。實際核對（`sqlite_master`）：`data/app.db` **已有** `golden_fixture_reviews` 及 0022 套用紀錄——這是 Sprint 11 執行 `npm run golden:export` 時，匯出程式以可寫連線開啟開發資料庫而自動套用（內容沒有改變，只是新增表）。本 Sprint 的 `golden:export -- --check` 重跑為 no-op。
  - **已知副作用（本 Sprint 靜態發現）**：`golden:export -- --check` 名義上是檢查模式，但仍會經過 `getDb()` 套用未執行的 migration。對開發／部署資料庫而言這與應用啟動行為一致，因此不構成資料變更風險，但「唯讀」的描述不夠精確；已記錄為待改進項目（技術債，非本 Sprint 修復範圍）。
- **沒有部署、沒有 commit、沒有 push**：HEAD 仍為 `6895db9`，`origin/main` 未變。
- 沒有呼叫付費 AI API（`LLM_PROVIDER=mock`）。
- 結束時 `git status --short`：**63 項**（23 modified ＋ 40 untracked）。與起始相比：**+5 modified**（`.env.example`、`scripts/e2e-flow.mjs`、`tests/migration-safety.test.ts`、`tests/golden-approval.test.ts`、`tests/servability-adjudication.test.ts`）、**+4 untracked**（`src/server/auth/history-reviewer.ts`、`tests/release-controls.test.ts`、`docs/teacher-review/policy-decisions-2026-10-19.md`、`docs/sprint-12-report-2026-10-19.md`）；其餘 54 項為 Sprint 9–11 原有項目，逐項保留。
