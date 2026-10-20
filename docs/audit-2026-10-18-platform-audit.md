# 平台稽核報告：歷史科自學網站（2026-10-18）

| 項目 | 內容 |
| --- | --- |
| 稽核日期 | 2026-10-18（Asia/Hong_Kong） |
| 稽核基準 | `main` @ `0454aaefdf96abc20f01ee6388e9e2e728953420`（稽核開始時工作樹乾淨） |
| 稽核範圍 | 學生／教師／管理員權限、登入流程、題目生成與批改、發布完整性、學生流程、課程編排、測試與建置 |
| 資料來源 | 專案程式碼、測試、文件；**唯讀**本機開發資料庫快照（`data/app.db`，1,882 條已發布題目） |
| 未執行 | 沒有接觸正式資料庫、沒有部署、沒有更改 Cloud Run 流量、沒有輪換憑證、沒有呼叫付費 AI provider |
| 覆核證據 | 擁有者確認：**題目上載前已由科組核對歷史事實**。倉庫紀錄只覆蓋部分批次，無法逐題重建該次核對的完整範圍（見 §7.3、AU-04） |
| 更正 | 2026-10-19 更正初版把「黃金題庫為空」誤讀為「從未核對史實」的錯誤結論（見 §1.1） |
| 修復稽核 | 2026-10-19：877 題語意不變、987 題純格式、**18 題考核答案已改變**（已隔離；見 §7.5） |
| 裁決衝刺 | 2026-10-19：18 題逐題裁決完成（16 核准、2 拒絕並刪除、0 仍隔離）；修正 4 條會令隔離失效或不可稽核的路徑；結果見 [repair-adjudication-results-2026-10-19.md](teacher-review/repair-adjudication-results-2026-10-19.md)（§7.6） |
| 後續變更（2026-10-20） | 學生閱讀教材頁 `/learn/[topicId]` 及 `GET /api/topics/[topicId]/lesson` **已移除**（平台不再向學生顯示教材全文）；練習設定只列出課題下的主題（不再按分節分組）；資料題（DBQ）已從匯入流程完全移除。§5 的 API 表第 5 項及相關「閱讀頁」描述只反映稽核當時的狀態 |

---

## 1. 執行摘要（Executive verdict）

### 結論：**NOT READY**（不建議正式向學生發布）

範圍界定：

- **本機開發／示範**（`npm run dev`）：可用。核心學生流程、教師流程、管理員流程在同機端對端測試中通過。
- **正式部署給學生使用**：**未達發布門檻**。原因不是單一程式錯誤，而是多項互相獨立的缺口同時存在：
  1. **覆核可追溯性**：擁有者確認題目上載前已由科組核對史實；但系統內全部 1,882 題的「覆核通過」紀錄由一次擁有者授權的批次動作及自動修復腳本寫入（AU-04），無法逐題重建「誰在哪一版核對了哪一題」。**這不代表沒有核對**，而是核對的範圍與版本無法由倉庫紀錄獨立證明。
  2. **黃金評估題庫仍為空**（`docs/teacher-review/golden-questions.v1.json`，`reviewStatus: pending-review`）：這是獨立的品質保證（QA）缺口，用於量度機器閘門與教師判斷的一致度，**不是**「是否曾核對史實」的證明。
  3. **解釋質量**：71%（1,334／1,882）已發布題目的「解釋」是同一句佔位文字「答案依校內試題檔的評卷參考。」，不構成解釋，更不支撐答案（要求 3.9）。
  4. **未決的歷史／答案鍵疑點**：附錄 B 的 12 項抽樣疑點仍須歷史科教師逐題裁決。另有 **18 題的考核答案在自動修復後已改變**（§7.5.2）：已於 2026-10-19 逐題裁決並記錄——16 題核准、2 題拒絕並刪除、0 題仍隔離（§7.6.6）。本報告不作歷史裁決。
  5. **版權、正式環境及部署驗證**：見第 10 節，全部未完成。

本次稽核同時**修正**兩個會直接影響學生的缺陷：

- 97 條結構上無法作答的已發布題目原本會派給學生（AU-01）；
- 任何非 Cloud Run 的正式部署，在未設定 Google 登入時會把教師端及管理員端完全開放給公眾（AU-02）。

2026-10-19 的修復來源稽核另外確認：**18 條已發布題目的考核答案在自動修復後被改變**，而舊紀錄的理由寫成「考核的答案不變」。程式已改為不再自動改寫這類題目（改為標示待教師確認），並提供 `--quarantine` 隔離既有 18 題（見 §7.5）。同日完成的裁決衝刺已在本機資料集隔離全部 18 題，並修正兩條會令隔離失效的路徑：擁有者批次覆核 (`approve:questions`) 原本會覆核並發布待確認題目，重做錯題（wrong-only）原本會再次派發已隔離的題目（見 §7.6、AU-26、AU-27）。

發布關卡：**未滿足**（見第 10 節）。

### 1.1 更正記錄（2026-10-19）

**初版錯誤結論**：初版第 1 節寫「平台沒有任何一題經過歷史科教師確認史實」，並在 §7.3、§10.4、§11 以同一推論分類發布關卡。

**為何錯誤**：初版把「`golden-questions.v1.json` 的 `questions` 陣列為空」當成「題目從未經史實核對」的證據。這個推論不成立——該檔案只是**一份評估用資料集**，它為空只表示這份資料集尚未建立，不能反推題目的核對歷史。

**更正依據**：

1. **擁有者確認**（2026-10-19）：題目在上載前已由科組核對歷史事實。
2. **倉庫內的書面證據**：[`docs/teacher-review/owner-publication-overrides.json`](teacher-review/owner-publication-overrides.json) 2026-10-15T08:41:22Z 的決定理由為「擁有者指示：科組已審閱課本及校內試卷題目，授權上線前批次發布（未逐題留下覆核紀錄）」，涉及 143 題。這是上載前核對存在的直接紀錄。
3. **推論錯誤的性質**：屬於「以缺失的紀錄證明否定事實」（absence of evidence treated as evidence of absence）；紀錄缺失只支持「無法追溯」，不支持「沒有發生」。

**更正範圍**：本報告 §1、§7.1、§7.3、AU-04、§10.4、§11 及新增 §7.5；另同步修正 [docs/teacher-review/README.md](teacher-review/README.md) §5 及 `golden-questions.v1.json` 的說明文字（不改動任何題目或覆核紀錄）。

**仍然成立的結論**：**NOT READY**。發布關卡未滿足的原因已改為「可追溯性、黃金資料集、解釋質量、未決史實疑點、版權、正式環境及部署驗證」各自獨立把關（第 10 節），而不是「史實從未核對」。

---

## 2. 方法

1. 讀取 `AGENTS.md`、`README.md`、`docs/release-preflight-2026-10.md`、`docs/teacher-review/README.md`、`package.json`、`next.config.ts` 及已安裝的 Next.js 文件。
2. 建立完整 API 路由清單（31 個 route handler、40 個 HTTP 方法），逐條核對守衛、讀寫效果及擁有權檢查（第 5 節）。
3. 對本機開發資料庫做**唯讀**稽核：題目結構、答案鍵、選項、解釋、知識點、難度、技能、覆核紀錄、發布狀態。
4. 以專案自身的 `checkQuestionServable()` 重算「實際可派給學生」的題目集合。
5. 執行單元／整合測試、型別檢查、lint、正式建置，並以隔離資料庫及上載目錄執行 HTTP 端對端測試。
6. 以隔離資料庫啟動正式建置，實測未設定登入時的後台拒絕行為及安全標頭。
7. **2026-10-19 更正**：重讀 `docs/teacher-review/owner-publication-overrides.json`、`golden-questions.v1.json`、`docs/teacher-review/README.md`、`question-bank-import-service.ts` 及 `repair-question-bank.ts`，把「上載前的史實核對」、「黃金評估題庫」及「系統內逐題覆核紀錄」分開評估（§1.1、§7.3、AU-04、§7.5）。

`CLAUDE.md` 在此倉庫不存在，因此沒有額外的代理指示可讀。

除錯與驗證腳本均為臨時檔案，已從工作樹移除。

---

## 3. 基線與工作樹

**稽核開始時**：`main`，HEAD `0454aaef`，`git status` 乾淨，無暫存或未追蹤變更。

**稽核結束時**：工作樹只有本次修正（未提交、未推送、未部署）：

| 檔案 | 變更 |
| --- | --- |
| [src/server/services/question-servability.ts](../../src/server/services/question-servability.ts) | 新增羅馬數字選項／答案欄損壞的結構檢查 |
| [src/server/services/grading.ts](../../src/server/services/grading.ts) | 支援「甲 / 乙」同義答案、排版領導符 |
| [src/server/services/practice-service.ts](../../src/server/services/practice-service.ts) | 未發布課題不可建立練習；生成題目套用結構安全網 |
| [src/server/services/question-service.ts](../../src/server/services/question-service.ts) | 教師端回報每題是否可派給學生及原因 |
| [src/lib/types.ts](../../src/lib/types.ts) | `QuestionReviewStatus` 新增 `studentServable`／`studentServableReason` |
| [src/components/QuestionManager.tsx](../../src/components/QuestionManager.tsx) | 顯示「學生無法作答（不會派發）」標記 |
| [src/server/config.ts](../../src/server/config.ts) | `isUnsafeDemoModeAllowed()` 改為所有正式建置 fail-closed |
| [src/server/auth/guards.ts](../../src/server/auth/guards.ts) | 改用上述判斷；訊息改為「正式環境」 |
| [src/server/config-diagnostics.ts](../../src/server/config-diagnostics.ts) | 診斷訊息配合正式建置語意 |
| [src/server/services/admin-dashboard.ts](../../src/server/services/admin-dashboard.ts) | `staffApiOpen` 與守衛使用同一判斷 |
| [src/server/auth/session.ts](../../src/server/auth/session.ts) | 損毀百分比編碼 cookie 不再拋出 |
| [src/server/http.ts](../../src/server/http.ts) | 匯出 `privateResponseHeaders` |
| [src/app/api/teacher/records/export/route.ts](../../src/app/api/teacher/records/export/route.ts) | CSV 加入 `no-store`／`Vary: Cookie` |
| [src/app/api/auth/sign-out/route.ts](../../src/app/api/auth/sign-out/route.ts) | 加入 `no-store` |
| [next.config.ts](../../next.config.ts) | 新增 `X-Frame-Options`、`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy` |
| [scripts/e2e-flow.mjs](../../scripts/e2e-flow.mjs) | 測試啟動的子程序明確允許示範模式 |
| `README.md` | 更新示範模式說明 |
| 6 個測試檔 | 新增／調整回歸測試 |

**2026-10-19 更正時另有以下變更（只涉及文件及測試，沒有改動題目或覆核紀錄）**：

| 檔案 | 變更 |
| --- | --- |
| [docs/audit-2026-10-18-platform-audit.md](audit-2026-10-18-platform-audit.md) | 更正「從未核對史實」的錯誤推論；新增 §1.1、§7.3.1–7.3.3、§7.5；重寫 AU-04 及 §10.4 |
| [docs/teacher-review/README.md](teacher-review/README.md) | §5 改為分開陳述批次紀錄、上載前核對及黃金題庫 |
| [docs/teacher-review/golden-questions.v1.json](teacher-review/golden-questions.v1.json) | **只改 `notes` 說明文字**；`questions` 仍為空、`reviewStatus` 仍為 `pending-review`，沒有新增任何題目或覆核 |
| [tests/golden-questions.test.ts](../../tests/golden-questions.test.ts) | 新增 4 個測試固定「資料集為空 ≠ 從未核對」的語意界線 |

**2026-10-19 修復來源稽核（Phase C/D）另有以下變更**：

| 檔案 | 變更 |
| --- | --- |
| [src/server/services/question-repair.ts](../../src/server/services/question-repair.ts) | 新增：修復規劃的單一事實來源（答案對應、準確理由、隔離標記、automation 警告命名空間） |
| [src/server/materials/question-bank.ts](../../src/server/materials/question-bank.ts) | `FillNormalisation` 新增 `assessedBlankIndex`、`originalAnswer`；`ParsedBankQuestion` 新增 `requiresTeacherReview` |
| [src/server/services/question-bank-import-service.ts](../../src/server/services/question-bank-import-service.ts) | 改變考核答案的匯入題目標示 `teacherConfirmationRequired` 及明確警告 |
| [scripts/repair-question-bank.ts](../../scripts/repair-question-bank.ts) | 只安全改寫；答案會改變時不改寫並隔離；準確理由；`reviewer_role = automation`；新增 `--quarantine` |
| [scripts/audit-repair-provenance.ts](../../scripts/audit-repair-provenance.ts) | 新增：唯讀、可重複的修復來源稽核（以原始試題檔重建修復前內容） |
| [docs/teacher-review/repair-provenance-2026-10-19.json](teacher-review/repair-provenance-2026-10-19.json) | 稽核報告：分類統計、18 題完整證據及限制 |
| [tests/repair-provenance.test.ts](../../tests/repair-provenance.test.ts) | 新增 26 個測試（答案對應、理由準確性、idempotency、歷史作答快照、匯入標示、隔離標記不被清除） |
| `package.json` | 新增 `audit:repair-provenance` 指令 |

**沒有修改**：資料庫、題目狀態、覆核紀錄、發布狀態、教材版權設定、任何環境變數檔。

---

## 4. 發現清單

嚴重度：P0 = 立即阻斷發布或可直接被利用；P1 = 高影響正確性／完整性；P2 = 中影響或可繞過部分閘門；P3 = 低影響加固。

### P0

#### AU-01 已發布但結構上無法作答的題目會派給學生（**已修正**）

- **證據**：以專案的 `checkQuestionServable()` 重算 1,882 條已發布題目，修正前 **1,882／1,882 全部通過**。其中：
  - **96 條選擇題**的選項是「i、ii及iii」這類羅馬數字組合，但題幹只剩幾句**沒有 i／ii／iii 標示**的文字（DOCX 表格／分欄在轉換時遺失標示）。學生無法得知哪一句是 i、哪一句是 ii。
    例：`qb-JTH2ndEdMCQ01023`「下列哪些屬於一手資料？ 日記 錄像 事件發生時的報章報道 學術論文」，選項 `i、ii和iii`。
  - **1 條填充題** `qb-JTH2ndEdFBQ09028` 的 `correct_answer` 是 72 字、包含兩個空格標記及完整句子的亂碼：
    `阿爾薩斯—洛林 1919年，第一次世界大戰的戰勝國召開______________，並與德國簽訂《______________條約》。 巴黎和會`
- **位置**：[question-servability.ts](../../src/server/services/question-servability.ts) 修正前只檢查空格數、選項重複、答案是否在選項內及答案外洩。
- **影響**：學生在練習中遇到無法作答的題目；答錯的知識點會進入「需要重溫」，污染學習紀錄。
- **重現**：`node -e` 讀取 `data/app.db`，對每條 `status='published'` 題目呼叫 `checkQuestionServable()`（修正前全部回 `ok: true`）；或在 `/practice/new` 選擇課題9、題數30，即有機會抽到該類題目。
- **修正**：新增兩項 fail-closed 檢查（[question-servability.ts:63](../../src/server/services/question-servability.ts:63)、[:130](../../src/server/services/question-servability.ts:130)）：
  1. 選項指涉的每個羅馬數字都必須在題幹有對應標示；
  2. 填充題答案不得含空格標記、句末標點，長度不得超過 40 字。
- **修正後實測**：97 條被攔下（附錄 A 完整 ID），其餘 1,785 條可派發；以 4 個課題各 30 題建立練習，**被攔下的題目洩漏 0 條**。
- **回歸測試**：[tests/question-servability.test.ts](../../tests/question-servability.test.ts)、[tests/practice-flow.test.ts](../../tests/practice-flow.test.ts)（新增 3 個測試）。

#### AU-02 非 Cloud Run 的正式部署會公開教師／管理員功能（**已修正**）

- **證據**：修正前 `isUnsafeDemoModeAllowed()` 只檢查 `K_SERVICE`：
  ```ts
  const onCloudRun = (process.env.K_SERVICE ?? "").trim().length > 0;
  if (!onCloudRun) return true;   // 任何非 Cloud Run 主機 → 後台完全開放
  ```
- **影響**：以 `npm run build` + `npm start` 部署到學校伺服器、其他雲端或 Docker，而忘記設定 Google 憑證時，任何能連上網站的人都可以：讀取全部學生練習記錄、下載 CSV、發布／刪除題目、上載／刪除教材、啟動 OCR。這是完整的橫向權限提升，不只是介面外露。
- **重現**：修正前以 `NODE_ENV=production`、清空 `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET`、不設 `HISTORY_ALLOW_UNSAFE_DEMO_MODE` 啟動，`GET /api/admin/system/health` 回 200，`/teacher` 可開啟。
- **修正**：[config.ts:614](../../src/server/config.ts:614) 改為「`NODE_ENV=production` 或 Cloud Run 一律 fail-closed，必須明確設定 `HISTORY_ALLOW_UNSAFE_DEMO_MODE=true`」。
- **修正後實測**（正式建置、隔離資料庫）：`GET /api/admin/system/health` → **403**，`/teacher` → **307 `/login?error=not_configured`**，`GET /api/topics?publishedOnly=true` → 200（公開資料不受影響）。
- **回歸測試**：[tests/access-control.test.ts](../../tests/access-control.test.ts) 新增「正式建置未設定示範開關時後台一律拒絕」。

### P1

#### AU-03 71% 已發布題目沒有實質解釋（**未修正：需內容決定**）

- **證據**：1,882 條已發布題目中，**1,334 條（70.9%）**的 `explanation` 完全相同，為佔位文字「答案依校內試題檔的評卷參考。」。其餘 548 條的解釋長度多為 26–37 字，部分仍只是答案改寫。
- **位置**：`questions.explanation`；匯入端 [question-bank-import-service.ts](../../src/server/services/question-bank-import-service.ts) 在評卷參考沒有解釋時寫入此字串。
- **影響**：學生答錯後得不到任何說明；不符合要求 3.9（解釋須支撐答案且不杜撰）。自動品質閘門的 `explanation-restates-answer` 只覆蓋生成題，不覆蓋匯入的校內試題。
- **重現**：`SELECT COUNT(*) FROM questions WHERE explanation = '答案依校內試題檔的評卷參考。'` → 1334。
- **建議**：由歷史科教師補寫解釋，或在匯入時把「沒有解釋」標為 `teacher_confirmation_required`，令這些題目暫緩派發。**本次沒有改動**：攔下 71% 題目屬產品決定，需擁有者批准。

#### AU-04 三種不同性質的「通過」共用同一種紀錄（**未修正：需 schema 決定**）

**這項發現不是「沒有核對史實」的證據，而是「紀錄無法區分核對的性質與範圍」。**

- **證據**（唯讀查詢 `question_reviews` 及 `docs/teacher-review/owner-publication-overrides.json`）：

| 出處 | 系統表現 | 性質 |
| --- | --- | --- |
| **上載前的科組審核**（擁有者確認） | **沒有**逐題寫入 `question_reviews`。倉庫內的書面證據是 [`owner-publication-overrides.json`](teacher-review/owner-publication-overrides.json) 2026-10-15T08:41:22Z 的授權決定，理由明言「科組已審閱課本及校內試卷題目，授權上線前批次發布（未逐題留下覆核紀錄）」，涉 143 題 | 人類審閱；範圍與逐題結論不在倉庫內 |
| **擁有者授權批次發布** | `question_reviews` 1,882 筆，理由「擁有者指示：本 session 上載的校內題庫題目一律覆核通過並發布」，`reviewer_role = admin` | 一次批准整個批次，不是逐題審閱 |
| **自動修復後補記** | `question_reviews` 1,266 筆，理由「模擬學生使用後自動修復…」「自動修復多空格填充題…」，由 [scripts/repair-question-bank.ts:230](../../scripts/repair-question-bank.ts:230) 以 `recordQuestionReview({ actor: { email: ownerEmail, role } })` 寫入 | 機器改寫內容後由腳本以擁有者身分補記；不是新的教師判斷 |

- **影響**：教師介面、`reviewStateFor()` 及 `isStudentPracticeEligible()` 都會把三者一律顯示為「已人工覆核」。系統目前**沒有欄位**區分它們，因此無法回答「這一版內容，是誰在何時核對的」。這既可能誇大 AI／批次題目的覆核程度，也可能低估已在平台外完成的科組審核——兩個方向都是錯的。
- **建議**：新增 `question_reviews.actor_kind`（`human`／`owner-batch`／`automation`）及對應 migration；教師端分開顯示；既有 3,148 筆按理由重新分類（**不可**默默假設為 `human`）；上載前的科組審核應另行記錄為一份可追溯的批次紀錄，而不是回填成逐題教師覆核。
- **2026-10-19 已做的部分**：修復腳本新寫入的覆核一律用 `reviewer_role = automation` 及 `[automation]` 理由前綴，並只會在**考核答案不變**時補記；改變考核內容的題目不再補記覆核。既有 3,148 筆保持不變（不改寫歷史紀錄），`actor_kind` migration 仍建議進行。

#### AU-05 正確的同義答案被判錯（**已修正**）

- **證據**：10 條填充題的標準答案以「甲 / 乙」列出同義寫法，例如：
  - `qb-JTH2ndEdFBQ05046`「路德宗 / 信義宗」
  - `qb-JTH2ndEdFBQ05164`「德國 / 德意志」
  - `qb-JTH2ndEdFBQ08009`「香港總督 / 港督」
  - `qb-NJCFN0020000038`「尤利烏斯․ 凱撒」（U+2024 一點領導符）
  `normalizeAnswer()` 會移除「/」但保留 U+2024，令「路德宗」正規化後不等於「路德宗信義宗」，且長度差 3 字元不屬「近似答案」→ 直接判錯。另有 2 條答案含排版空白／領導符，同樣影響輸入比對。
- **影響**：學生答對卻被扣分，且不獲「待教師覆核」標示。
- **修正**：[grading.ts:32](../../src/server/services/grading.ts:32) 新增 `answerAlternatives()`，填充題逐一同義寫法接受；`normalizeAnswer()` 加入 U+2024–U+2027。選擇題不受影響（避免「X光 / 射線」被拆成兩個正確答案）。
- **回歸測試**：[tests/grading.test.ts](../../tests/grading.test.ts) 新增 3 個測試。

#### AU-06 即時生成題目繞過最後結構安全網（**已修正**）

- **證據**：題庫路徑有 `.filter(... checkQuestionServable(item).ok)`（[practice-service.ts:488](../../src/server/services/practice-service.ts:488)），但 `questionSource: "ai"` 及「題庫不足時即時生成」兩條路徑只過濾 `teacherConfirmationRequired`。
- **影響**：生成流程本身的驗證與匯入題目的檢查範圍不同；排版類缺陷（例如這次發現的羅馬數字選項）可經生成路徑直接進入練習快照。
- **修正**：兩條生成路徑都套用 `checkQuestionServable()`，並在略過題目時如實通知學生（[practice-service.ts:482](../../src/server/services/practice-service.ts:482)）。

#### AU-07 未發布課題仍可建立練習（**已修正**）

- **證據**：`createPractice()` 只檢查課題存在（`if (!topic) 404`），沒有檢查 `topic.published`；閱讀頁 `getLessonView()` 則會對未發布課題回 404。
- **影響**：學生若知道 `topicId`，可直接 POST `/api/practice` 使用未發布課題的已發布題目，並消耗 AI 額度；與「課程發布狀態」的意圖不一致。
- **修正**：[practice-service.ts:437](../../src/server/services/practice-service.ts:437) 未發布課題一律 404。**行為變更**：教師亦不能在未發布課題上測試學生練習（與閱讀頁一致）。
- **回歸測試**：[tests/practice-flow.test.ts](../../tests/practice-flow.test.ts) 新增「未發布的課題不可建立新練習」。

### P2

| ID | 發現 | 證據／位置 | 影響 | 狀態 |
| --- | --- | --- | --- | --- |
| AU-08 | 學生練習記錄 CSV 沒有 `no-store`，可能被共用快取保存 | [export/route.ts:23](../../src/app/api/teacher/records/export/route.ts:23) 原本只設 `Content-Type`／`Content-Disposition` | 學生姓名、班別、作答結果可能留在中介快取 | 已修正，並加入 [authz-negative.test.ts](../../tests/authz-negative.test.ts) 回歸 |
| AU-09 | 未發布課題的結構及摘要可由公開 API 讀取 | `GET /api/topics` 的 `publishedOnly` 由呼叫端決定；`GET /api/topics/[topicId]` 沒有發布檢查 | 學生可列舉未完成課程的標題、分節、題目數 | 未修正（屬產品決定） |
| AU-10 | 所有題目 `skill` 為 null，技能進度功能形同空轉 | `SELECT COUNT(*) FROM questions WHERE skill IS NOT NULL` → 0；`getSkillProgress()` 只計有技能標示的題目 | 「歷史技能」進度永遠顯示 0，學生得不到訊號 | 未修正（需教師標示） |
| AU-11 | 所有題目難度均為 `basic` | `SELECT difficulty, COUNT(*) …` → basic 1,882 | 難度選擇沒有作用；選 medium／hard 會靜默加入 basic 題 | 未修正（需教師標示） |
| AU-12 | 知識點欄位含排版殘留及錯配 | `A. 國家W`（85 題）、`B. 米開蘭基羅`（33 題，多為宗教改革題）、`D. iii、iv`（37 題）、`校內試題`（多題） | 「需要重溫的知識點」指向錯誤主題，誤導學生 | 未修正（需重新對應） |
| AU-13 | 4 組題幹完全相同的題目 | `qb-JTH2ndEdMCQ05142`／`05140`、`qb-NJCMN0060000043`／`0040`、`qb-NJCMN0070000044`／`0043`、`qb-JTH2ndEdMCQ08018`／`08009` | 同一練習可出現近乎重複的題目；選項不同，非完全重複 | 未修正（低風險） |
| AU-14 | 覆核與狀態更新不是同一個交易 | [question-service.ts](../../src/server/services/question-service.ts) `insertQuestionReview()` 後才 `setQuestionStatus()`，沒有 BEGIN/COMMIT | 中途失敗可留下「已批准但仍是草稿」或「已發布但標記未清」 | 未修正（單程序 SQLite，機率低） |
| AU-15 | 沒有 CI 工作流程 | 倉庫沒有 `.github/`；只有 `cloudbuild.yaml` | 測試、型別、lint、建置沒有自動把關，回歸只能靠本機 | 未修正（建議新增） |
| AU-16 | 除 AI 用量上限外沒有速率限制 | `ai-limits.ts` 只限制 generation／grading | 登入起點、題目回報、練習建立可被大量請求 | 未修正 |
| AU-17 | 文件與現況不一致 | [docs/teacher-review/README.md](teacher-review/README.md) §5 寫「642 條已發布題目」「17 筆覆核通過」；現時 1,882 條、3,148 筆紀錄（批次 1,882、自動修復補記 1,266）。同一節的「沒有一題經歷史科教師確認史實」亦屬錯誤推論，已於 2026-10-19 更正 | 讀者會誤判覆核覆蓋率及核對歷史 | §5 文字已同步更正；數字仍待更新 |
| AU-18 | 1,003 條校內試題沒有教材依據 | `source_verified = 0` 且 `source_block_ids_json = '[]'` | 這些題目只能靠原卷可信度；無法核對節錄 | 已知設計（`school-paper` 不計入未核對數），但仍是發布風險 |
| AU-19 | OCR 依賴容器內的原始檔案 | 帳號端對端測試以「資料庫快照 + 空上載目錄」執行時，OCR 回「找不到這份教材的原始檔案」 | 容器重建後資料庫已還原，但原始教材檔遺失，OCR 無法再執行（README 已列為限制） | 未修正（需 Cloud Storage） |

### 裁決衝刺新增（2026-10-19）

| ID | 嚴重度 | 發現 | 證據／位置 | 影響 | 狀態 |
| --- | --- | --- | --- | --- | --- |
| AU-26 | **P0** | 擁有者批次覆核 (`npm run approve:questions`) 列出指定來源的**全部**題目，沒有過濾 `teacher_confirmation_required`，逐題寫入 `approved` | [scripts/approve-questions.ts](../../scripts/approve-questions.ts) 原本使用 `listQuestions()`；[question-service.ts](../../src/server/services/question-service.ts) `recordQuestionReview` 核准時會清除標記並發布 | 自動／批次操作可清除「待教師確認」，令隔離失效 | **已修正**：新增 `listOwnerApprovalCandidates()`，批次腳本只處理 `approvable`，`held` 原樣保留並列出 |
| AU-27 | **P1** | 重做錯題（`mode: "wrong-only"`）只檢查快照的結構可作答性，沒有查核題庫的 `teacher_confirmation_required` | [practice-service.ts](../../src/server/services/practice-service.ts) `collectQuestionsFromWrongAttempts()` | 已隔離的題目可經「重做錯題」再次派給學生 | **已修正**：查核現行題庫標記；被抽起時以繁中通知說明；有錯題但全部待確認時回 409 而非誤稱「不在所選主題」 |
| AU-28 | **P1** | `changeQuestionStatus("published")` 只要求「有對應版本的覆核紀錄」，即使題目帶待確認標記仍可發布 | [question-service.ts](../../src/server/services/question-service.ts) | 較早的批次核准（在疑問出現之前）可以授權發布被隔離的題目 | **已修正**：標記未清除前一律 409，須由教師重新覆核 |
| AU-29 | **P1** | 同一版本先後兩次相同的覆核決定被唯一索引吞掉；教師在隔離後重新確認時，系統沿用舊紀錄（沒有新時間戳），`created: false` 仍會清除標記 | `question_reviews` 唯一索引（migration 0015） | 「誰在何時解除隔離」無法稽核 | **已修正**：migration 0021 移除唯一索引，冪等改由 `insertQuestionReview()` 在題目**沒有**待確認標記時維持；有標記時寫入新紀錄 |
| AU-30 | P2 | 早期自動修復以 `reviewer_role = admin` 寫入覆核（理由含「自動修復」），令角色欄不能單獨證明是否人工覆核 | 18 題全部含此類紀錄（見裁決套件） | 可能把機器動作誤讀為教師決定 | **不改寫歷史**；[QuestionManager.tsx](../../src/components/QuestionManager.tsx) 已為 `reviewer_role = automation` 加註「自動記錄」，裁決套件亦按理由標示；新紀錄一律用 `automation` |

### P3

| ID | 發現 | 證據 | 狀態 |
| --- | --- | --- | --- |
| AU-20 | `/api/health` 公開回報維護、備份及名冊狀態（含 `lastError`） | [health/route.ts](../../src/app/api/health/route.ts) | 未修正（Cloud Run 探測需要公開端點；建議只保留 `ok`／`version`／`database`） |
| AU-21 | 沒有 `Content-Security-Policy` | [next.config.ts:104](../../next.config.ts:104) 只加四個標頭 | 未修正（需 nonce 機制，屬獨立工作） |
| AU-22 | `X-Forwarded-Host` 被信任以產生對外網址 | [google.ts](../../src/server/auth/google.ts) `resolvePublicOrigin()` | 未修正（瀏覽器無法在導航時設定；只有直接暴露且代理未剝除標頭時才可武器化） |
| AU-23 | 損毀百分比編碼 cookie 令回呼 500 | [session.ts](../../src/server/auth/session.ts) `decodeURIComponent` 無 try/catch | 已修正，並加入 [auth.test.ts](../../tests/auth.test.ts) 回歸 |
| AU-24 | 登出回應沒有 `no-store` | [sign-out/route.ts](../../src/app/api/auth/sign-out/route.ts) | 已修正 |
| AU-25 | 教材來源位置可指向 `data/uploads` 的絕對路徑（只在教師端顯示） | `material_documents.stored_path` | 未見外洩；只列作觀察 |

---

## 5. API／角色矩陣

角色判定：`resolveSignInRole()`（[role.ts](../../src/server/auth/role.ts)）以**已驗證**的 Google 電郵決定；學號形式一律學生；網域不授予教師權限。

守衛：`requireTeacher`（教師＋管理員）、`requireAdmin`（只限管理員）、`resolveLearnerId`／`resolveOptionalLearnerId`（學習者一律由工作階段推導）。學習者擁有權在服務層再檢查（`session.learnerId !== learnerId → 403`）。

| # | Method | 路徑 | 必要角色 | 實作 | 讀／寫 | 擁有權檢查 | 測試 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | GET | `/api/health` | 公開 | 無（只回狀態） | 讀 | — | e2e |
| 2 | POST | `/api/health` | 教師／管理員 | `requireTeacher` | 讀 | — | authz-negative |
| 3 | GET | `/api/topics` | 公開（示範）／已登入 | `resolveOptionalLearnerId` | 讀 | — | authz-negative、e2e |
| 4 | GET | `/api/topics/[topicId]` | 同上 | `resolveOptionalLearnerId` | 讀 | — | e2e |
| 5 | GET | `/api/topics/[topicId]/lesson` | 同上 | `resolveOptionalLearnerId` + 發布／版權閘門 | 讀 | — | lesson-service、e2e |
| 6 | GET | `/api/progress` | 學生（登入） | `resolveOptionalLearnerId` | 讀 | 只用自己的 learnerId | authz-negative、e2e |
| 7 | POST | `/api/practice` | 學生／教師 | `requireSignInBeforeBody` + `resolveLearnerId` | 寫 | 只建立自己的練習 | authz-negative、practice-flow |
| 8 | GET | `/api/practice/[sessionId]` | 學生（登入） | `resolveLearnerId` | 讀 | 服務層 403 | authz-negative、e2e |
| 9 | POST | `/api/practice/[sessionId]/answers` | 學生（登入） | `requireSignInBeforeBody` + `resolveLearnerId` | 寫 | 服務層 403 | authz-negative、e2e |
| 10 | POST | `/api/practice/[sessionId]/complete` | 學生（登入） | 同上 | 寫 | 服務層 403 | authz-negative |
| 11 | GET | `/api/practice/[sessionId]/result` | 學生（登入） | `resolveLearnerId` | 讀 | 服務層 403 | authz-negative |
| 12 | POST | `/api/reports` | 學生／教師 | `requireSignInBeforeBody` + `resolveLearnerId` | 寫 | 回報須對應自己的作答 | access-control、e2e |
| 13 | GET | `/api/auth/session` | 公開 | 無 | 讀 | — | authz-negative |
| 14 | GET | `/api/auth/google/start` | 公開 | state＋PKCE cookie | 寫 cookie | — | auth |
| 15 | GET | `/api/auth/google/callback` | 公開 | 簽署 state／PKCE／`email_verified`／名冊 | 寫 cookie | — | auth、login-roster |
| 16 | POST | `/api/auth/sign-out` | 公開 | 清除 cookie | 寫 | — | — |
| 17 | GET | `/api/teacher/overview` | 教師／管理員 | `requireTeacher` | 讀 | — | authz-negative |
| 18 | GET | `/api/teacher/questions` | 教師／管理員 | `requireTeacher` | 讀 | — | authz-negative |
| 19 | POST | `/api/teacher/questions` | 教師／管理員 | `requireTeacher` | 寫 | — | authz-negative |
| 20 | PATCH | `/api/teacher/questions/[questionId]` | 教師／管理員 | `requireTeacher` + 發布閘門 | 寫 | — | authz-negative、publication-safety |
| 21 | DELETE | `/api/teacher/questions/[questionId]` | 教師／管理員 | `requireTeacher` | 寫 | — | authz-negative |
| 22 | GET | `/api/teacher/questions/[questionId]/review` | 教師／管理員 | `requireTeacher` | 讀 | — | authz-negative |
| 23 | POST | `/api/teacher/questions/[questionId]/review` | 教師／管理員 | `requireTeacher` + 樂觀鎖 + 部署環境必須有真實工作階段 | 寫 | — | teacher-review-workflow-integrity |
| 24 | POST | `/api/teacher/questions/generate` | 教師／管理員 | `requireTeacher` | 寫（題庫） | — | authz-negative、e2e |
| 25 | GET | `/api/teacher/records` | 教師／管理員 | `requireTeacher` | 讀（全部學生） | 角色即權限 | authz-negative、e2e |
| 26 | GET | `/api/teacher/records/export` | 教師／管理員 | `requireTeacher` | 讀（全部學生，CSV） | 角色即權限 | authz-negative、e2e |
| 27 | GET | `/api/teacher/reports` | 教師／管理員 | `requireTeacher` | 讀 | — | authz-negative |
| 28 | PATCH | `/api/teacher/reports` | 教師／管理員 | `requireTeacher` | 寫 | — | authz-negative |
| 29 | GET | `/api/admin/materials` | 管理員 | `requireAdmin` | 讀 | — | authz-negative |
| 30 | POST | `/api/admin/materials` | 管理員 | `requireAdmin` + Content-Length／格式／大小 | 寫（檔案） | — | authz-negative、e2e |
| 31 | GET | `/api/admin/materials/import` | 管理員 | `requireAdmin` | 讀 | — | authz-negative |
| 32 | POST | `/api/admin/materials/import` | 管理員 | `requireAdmin` | 寫 | — | authz-negative |
| 33 | GET | `/api/admin/materials/[documentId]` | 管理員 | `requireAdmin` | 讀 | — | authz-negative |
| 34 | PATCH | `/api/admin/materials/[documentId]` | 管理員 | `requireAdmin` + 版權／內容確認 | 寫 | — | authz-negative、e2e |
| 35 | DELETE | `/api/admin/materials/[documentId]` | 管理員 | `requireAdmin` | 寫 | — | authz-negative |
| 36 | GET | `/api/admin/materials/[documentId]/ocr` | 管理員 | `requireAdmin` | 讀 | — | authz-negative |
| 37 | POST | `/api/admin/materials/[documentId]/ocr` | 管理員 | `requireAdmin` | 寫（背景工作） | — | authz-negative、e2e |
| 38 | PATCH | `/api/admin/materials/blocks/[blockId]` | 管理員 | `requireAdmin` | 寫 | — | authz-negative |
| 39 | PATCH | `/api/admin/sections/[sectionId]` | 管理員 | `requireAdmin` | 寫 | — | authz-negative |
| 40 | PATCH | `/api/admin/topics/[topicId]` | 管理員 | `requireAdmin` | 寫 | — | authz-negative |
| 41 | GET | `/api/admin/system/health` | 管理員 | `requireAdmin` | 讀 | — | authz-negative、e2e |
| 42 | GET | `/api/admin/system/overview` | 管理員 | `requireAdmin` | 讀 | — | authz-negative、e2e |

頁面守衛：`guardStudentPage`（12 個學生頁）、`guardTeacherPage`（4 個教師頁）、`guardAdminPage`（4 個管理員頁）；`/admin/questions`、`/teacher/materials`、`/teacher/settings` 為舊路徑重新導向頁，導向已受守衛的頁面。

---

## 6. 安全回歸測試結果

`tests/authz-negative.test.ts` 對 **33 個後台路由**逐一驗證：

| 情境 | 預期 | 結果 |
| --- | --- | --- |
| 未登入 → 教師／管理員 API | 401 | 通過 |
| 學生 → 教師 API | 403 | 通過 |
| 學生 → 管理員 API | 403 | 通過 |
| 教師 → 管理員 API | 403 | 通過 |
| 教師 → 教師 API | 200 | 通過 |
| 學生改 `learnerId` 讀他人進度／練習 | 只回自己的資料／403 | 通過 |
| 未登入冒用 `school:`／`teacher:`／`admin:` learnerId | 401 | 通過 |
| 偽造／過期 session cookie | 無效 | 通過 |
| 所有 API 回應 `no-store` + `Vary: Cookie` | 是 | 通過（新增 CSV 個案） |
| 上載超過大小上限 | 413（讀取內容前） | 通過 |
| 結構上無法作答的題目進入練習 | 不出現 | 通過（新增） |
| 未發布課題建立練習 | 404 | 通過（新增） |

其他已驗證的登入設計（[tests/auth.test.ts](../../tests/auth.test.ts)、[tests/login-roster.test.ts](../../tests/login-roster.test.ts)、[tests/session-secret.test.ts](../../tests/session-secret.test.ts)）：HMAC 簽署、30 天到期、角色每次重新判定（降權即時、升權需重新登入）、OAuth state＋PKCE S256、`email_verified` 必須為 true、`AUTH_SECRET` 過短時正式環境 fail-closed、開放轉址防護（反斜線／`//`）。

**未發現**：學生可經任何路由建立教師覆核、發布題目、修改課程可見性、上載教材或啟動 OCR。`ADMIN_TOKEN` 只在長度 ≥32 且固定時間比較下生效；`HISTORY_ALLOW_UNSAFE_DEMO_MODE` 現已無法在正式建置「意外」開啟。

---

## 7. 題目質量稽核

### 7.1 資料集

| 項目 | 數量 |
| --- | --- |
| 已發布題目 | 1,882（MC 987／填充 895） |
| 來源 | 全部 `school-paper`（校內試題匯入） |
| 教材依據成立（`source_verified = 1`） | 879（46.7%） |
| 沒有教材依據（校內試卷本身為來源） | 1,003（53.3%） |
| 有逐字來源段落（`source_block_ids` 非空） | 879 |
| 上載前史實核對 | 擁有者確認已完成；倉庫內只有一次批次授權紀錄（143 題，明言「未逐題留下覆核紀錄」） |
| `question_reviews` 通過紀錄 | 3,148 筆／1,882 題（批次 1,882 筆、自動修復後補記 1,266 筆；見 AU-04） |
| 黃金評估題庫（`golden-questions.v1.json`） | 0 題（`pending-review`）；屬獨立的 QA 缺口，不是「未核對」的證明 |
| 自動品質驗證紀錄 | 0 |
| 待教師確認（`teacher_confirmation_required = 1`） | **0**（2026-10-19 全部裁決：16 題核准、2 題拒絕並刪除；見 §7.6.6） |

### 7.2 機器檢查結果（全部 1,882 題）

| 檢查 | 結果 |
| --- | --- |
| 選項數不是 4 | 0 |
| 空白選項 | 0 |
| 重複選項（正規化後） | 0 |
| 標準答案不在選項內 | 0 |
| 標準答案原文出現在題幹（≥3 字） | 0 |
| 填充題答案空白／含多空格／含排版殘留 | 0（1 條答案長 72 字，見 AU-01） |
| 填充題題幹空格數 ≠ 1 | 0 |
| 題幹重複（同課題） | 4 組 |
| 解釋少於 25 字或為佔位文字 | **1,335** |
| 知識點空白 | 0（但有錯配，AU-12） |
| 技能維度空白 | **1,882** |
| 難度非 basic | **0** |
| 選項以羅馬數字指涉題幹但題幹無標示 | **96**（已攔下） |
| 答案為「以上皆是／全部皆是」 | 15（多數題幹有正確標示，屬有效題型） |

### 7.3 歷史準確性

**本報告本身沒有、也不能確認任何一題史實正確。** 機器檢查只能證明結構與來源文字一致，不能證明歷史陳述為真。以下三件事必須分開評估。

#### 7.3.1 上載前史實核對 vs. 黃金評估題庫 vs. 逐題覆核紀錄

| 層次 | 現有證據 | 可以據此說甚麼 | 不可以據此說甚麼 |
| --- | --- | --- | --- |
| **上載前的史實核對** | 擁有者確認題目上載前已由科組核對歷史事實；倉庫內的書面證據是 [`owner-publication-overrides.json`](teacher-review/owner-publication-overrides.json) 2026-10-15T08:41:22Z 的授權理由「科組已審閱課本及校內試卷題目，授權上線前批次發布（未逐題留下覆核紀錄）」（143 題） | 上載前確有歷史科人員核對史實；該次核對在平台外進行，並非由 AI 或程式代替 | **不可以**說「從未核對史實」；亦**不可以**說「每一題都有可追溯的逐題教師批准紀錄」 |
| **黃金評估題庫（golden dataset）** | `docs/teacher-review/golden-questions.v1.json` 的 `questions` 為空、`reviewStatus: pending-review` | 這份**評估資料集**尚未建立，因此無法量度機器閘門與教師判斷的一致度、也無法用它做回歸比較 | 不可以把「資料集為空」當成「題目未經核對」或「平台沒有任何教師參與」的證據 |
| **系統內的逐題覆核紀錄** | `question_reviews` 3,148 筆，全部由同一管理員帳號、以批次發布或自動修復的名義寫入（AU-04） | 每一題都有一個綁定版本的「通過」紀錄，發布關卡因此不會攔下它們 | 不可以把這些紀錄等同逐題人類審閱；也不可以反推「沒有人核對過」 |

#### 7.3.2 為甚麼倉庫證據無法重建完整範圍

1. 上載前的核對在平台之外進行（科組審閱課本及校內試卷），沒有逐題寫入 `question_reviews`；授權紀錄本身明言「未逐題留下覆核紀錄」。
2. 現有 1,882 題中，679 題仍為第 1 版，1,203 題已是第 2–7 版；其中只有 **641 題**在現有 `question_reviews` 留有自動修復補記，其餘 **562 題**的第 2 版以後**沒有可追溯的改寫原因**（可能來自較早的匯入／修復流程，相關紀錄已被取代）。改寫後的版本沒有新的教師判斷紀錄。
3. 因此可以確認的是「上載前曾核對」；**無法**確認的是「現時每一版的內容都曾被同一位教師逐題看過」。這是**可追溯性缺口**，不是「未核對」的證明。

> 本節的界線：擁有者的陳述是關於「上載前核對」這一事實；倉庫紀錄只能證明「核對曾經在某批次被授權」，不能證明其覆蓋範圍。兩者都**不足以**支持「全部 1,882 題在現行版本已獲史實批准」。

#### 7.3.3 仍然需要教師判斷的項目

以下抽樣屬 `NEEDS_HISTORY_TEACHER_REVIEW`（附錄 B）：疑點包括答案鍵可辯駁、題幹與選項語意不清、知識點錯配。抽樣方式為每課題按固定間隔取 3 題（共 36 題）人工閱讀，另加全部被攔下的 97 題結構覆核。

這些疑點與上載前的核對並不矛盾：它們是抽樣中仍然需要裁決的個別項目（包括上載後被自動改寫的版本），應由歷史科教師確認，而非由本報告裁定。未經逐題裁決前，不得把任何題目標示為「史實已核實」。

### 7.4 發布完整性

- 草稿、`teacherConfirmationRequired` 題目不會進入新練習（題庫及生成路徑都過濾）。
- 教師「退回」或「不可用」會把題目改回 `draft`，立即停止派發。
- 覆核綁定 `revision` + 內容指紋；修改內容後舊覆核自動失效（`stale-approval`）。
- 重複提交相同覆核不會產生重複紀錄（由 `insertQuestionReview()` 維持冪等，見 §7.6.3）；但題目帶待確認標記時的重新確認屬**新決定**，會留下新紀錄。
- 帶 `teacherConfirmationRequired` 的題目不可只切換狀態發布（409，AU-28）；擁有者批次覆核與批次發布都不會處理它們（AU-26）。
- 練習快照完整凍結題幹、選項、答案、解釋；題目日後被修改或下架，未完成的練習仍以原快照批改（一致性通過）。
- 擁有者批次腳本預設 dry-run，`--apply` 需要 `--owner-email` 及理由；但批次覆核本身仍是一次批准大量題目（AU-04）。
- **未執行**任何發布、下架、刪除或狀態變更；隔離（`teacher_confirmation_required` + 一則警告）已在本機資料集執行，沒有改動題目內容或覆核紀錄。

### 7.5 自動修復的實際影響（`repair-question-bank.ts`）

#### 7.5.1 改動了甚麼（程式行為）

| 欄位 | 會否改動 | 證據 |
| --- | --- | --- |
| 填充題題幹（`question`） | **會** —— 把其餘空格的答案填回題幹，只保留一個空格 | [question-bank.ts:691](../../src/server/materials/question-bank.ts:691) `normaliseMultiBlankFill()` |
| 填充題標準答案（`correctAnswer`） | **會，而且可能改為考核另一個空格** —— 逐個空格嘗試，取第一個不會令答案外洩的空格（`correctAnswer: cleaned[keep]`）；匯入時原本固定為 `answers[0]`（[question-bank.ts:505](../../src/server/materials/question-bank.ts:505)） | 同上 |
| 選擇題選項／答案 | **會** —— 只移除開頭殘留的項目符號（`. i和ii` → `i和ii`），語意不變 | [question-repair.ts](../../src/server/services/question-repair.ts) `cleanBullet()` |
| 解釋（`explanation`） | 不會 | 以 `...question` 展開，只覆寫題幹、答案、選項及兩個標記欄位 |
| 課題／分節對應、難度、知識點、技能、來源節錄 | 不會 | 同上 |
| `qualityWarnings`、`teacherConfirmationRequired` | 會（加／減自動檢查標記） | 同上 |

#### 7.5.2 對現有 1,882 題的實際影響（唯讀稽核）

方法：`npm run audit:repair-provenance` 以 `materials/` 內的原始試題檔配合 `parseQuestionBank`（不做多空格正規化）重建修復前內容，再與資料庫逐題比較；資料庫以 `readOnly` 開啟。完整報告見 [repair-provenance-2026-10-19.json](teacher-review/repair-provenance-2026-10-19.json)。

| 分類 | 數量 | 說明 |
| --- | --- | --- |
| `NO_SEMANTIC_CHANGE_CONFIRMED` | **877** | 347 題本來就是單一空格；530 題補回其餘空格的答案，但仍考核原第 1 個空格，考核答案相同 |
| `FORMATTING_CHANGE_ONLY` | **987** | 選擇題只移除選項開頭的項目符號 |
| `ANSWER_MAPPING_CHANGED` | **18** | 保留的空格由第 1 個改為第 2／3 個，被考核的答案已改變 |
| `QUESTION_MEANING_CHANGED` | 0 | 未發現無法由「多空格改寫／移除項目符號」解釋的改動 |
| `INSUFFICIENT_ORIGINAL_EVIDENCE` | 0 | 全部 1,882 題都能對應到來源檔 |
| `REQUIRES_HISTORY_TEACHER_REVIEW` | **18** | 與 `ANSWER_MAPPING_CHANGED` 重疊（同一批題目） |

**18 題考核答案已改變的題目**（完整證據見報告）：

`qb-JTH2ndEdFBQ05113`（中產階級→工人階級）、`qb-JTH2ndEdFBQ05161`（民族→殖民）、`qb-NJCFN0060000057`（美洲→印第安人）、`qb-NJCFN0070000033`（阿拉斯加→阿拉斯加購買案）、`qb-JTH2ndEdFBQ08014`（官守→非官守）、`qb-JTH2ndEdFBQ08028`（船塢→黃埔船塢）、`qb-JTH2ndEdFBQ09015`（軍備→軍隊）、`qb-JTH2ndEdFBQ09016`（戰爭→好戰）、`qb-JTH2ndEdFBQ09028`（德國→損壞的答案字串）、`qb-JTH2ndEdFBQ10014`（社會→1922）、`qb-JTH2ndEdFBQ10078`（U-2偵察機→1960）、`qb-JTH2ndEdFBQ10113`（西歐→北約）、`qb-JTH2ndEdFBQ10125`（市場→國有）、`qb-JTH2ndEdFBQ10140`（俄羅斯→聯合體）、`qb-JTH2ndEdFBQ10156`（市場→高科技）、`qb-NJCFN0110000009`（愛滋病→聯合國愛滋病規劃署）、`qb-NJCFN0110000060`（科技→國家利益）、`qb-NJCFN0120000013`（新界→新界鄉議局）。

這 18 題的舊覆核理由寫成「考核的答案不變」，與實際情況不符。歷史紀錄**不會被改寫**（避免偽造）；影響範圍就是這 18 題，已可透過 `--quarantine` 隔離。

**裁決後重跑（2026-10-19 稍後）**：`ANSWER_MAPPING_CHANGED` 由 18 降至 **14**——2 題已拒絕並刪除，2 題（`09015`、`09028`）按教師指示改回考核原第 1 個空格；其餘 14 題仍與重建原卷的考核空格不同，但已由教師逐題核准（見 §7.6.6）。這個數字下降不代表「所有題目已回復原狀」，只代表已裁決的題目不再屬於未決差異。

#### 7.5.3 已修正的程式行為

1. 匯入及修復只會在**仍考核原第 1 個空格**時自動改寫；會改變考核答案的題目**不改寫**，標示 `teacher_confirmation_required`，學生不會收到。
2. 修復理由按實際改動生成（「仍考核第 1 個空格；考核答案及題意不變」或「移除項目符號」）。
3. 腳本補記的覆核一律以 `reviewer_role = automation` 及 `[automation]` 理由寫入，不會冒充教師或管理員。
4. `--delete-unusable` 只刪除結構上無法作答的題目；待教師確認考核內容的題目不會被刪除。
5. `--quarantine <報告>` 可隔離已被證實改變考核答案的題目（預設模擬、需 `--apply`、不改寫內容、不新增覆核）。

#### 7.5.4 稽核限制

- 假設 `materials/` 內的來源檔與當初匯入時一致，且現行 `parseQuestionBank` 行為未變；若來源檔曾被更新，重建結果可能與真正原版有差異。
- 資料庫沒有保存舊版本內容，因此「原版」是**由來源檔重建**，不是歷史版本紀錄。
- 上述限制適用於所有分類；`INSUFFICIENT_ORIGINAL_EVIDENCE` 為 0 只代表「能對應到來源檔」，不代表來源檔本身從未改動。

### 7.6 教師裁決與隔離（2026-10-19）

#### 7.6.1 18 題裁決套件（**不是覆核紀錄**）

由 `npm run review:adjudication`（[build-teacher-adjudication.ts](../../scripts/build-teacher-adjudication.ts)）以唯讀方式產生，內容包括：原始與現行題幹並列、空格數目／位置／次序、每個空格的答案、選項、可接受答案、解釋、知識點、來源節錄、標記原因、現有覆核紀錄及證據限制。所有 `decision` 欄位一律為 `unset`。

- [repair-adjudication-2026-10-19.md](teacher-review/repair-adjudication-2026-10-19.md)（教師閱讀）
- [repair-adjudication-2026-10-19.json](teacher-review/repair-adjudication-2026-10-19.json)（機器可讀）

**沒有**提出替代答案或歷史解釋：保留原本被考核的空格會令答案在題幹其他地方出現（洩題），改考另一個空格則改變考核重點，兩者都需要教師按教學意圖決定；因此 `proposedCorrection` 全部為 `null` 並附原因。

#### 7.6.2 隔離狀態（裁決前，本機資料集實測 2026-10-19 11:26）

```
npm run repair:questions -- --quarantine docs/teacher-review/repair-provenance-2026-10-19.json --apply --owner-email <owner>
```

| 檢查 | 結果 |
| --- | --- |
| 18 題 `teacher_confirmation_required` | **18／18 已隔離** |
| 仍可派發（published 且未隔離） | **0** |
| `question_reviews` 總數 | 3,148（隔離**沒有**新增或改寫任何覆核紀錄） |
| 隔離對版本的影響 | `updateQuestion` 會令版本遞增（18 題現為第 5–8 版），因此隔離前的核准自動失效（`stale-approval`），須由教師重新覆核 |

隔離只寫入標記及一則 `平台自動檢查（隔離）：…` 警告，不改動題幹、答案、解釋、知識點或任何覆核紀錄。

#### 7.6.3 裁決如何在系統內記錄（無需新增裁決欄位）

現有 `question_reviews` 已可安全記錄逐題裁決，不需要 migration 來新增「裁決」欄位：

| 教師決定 | 系統動作 | 對隔離的作用 |
| --- | --- | --- |
| 核准（approved） | 寫入綁定 `revision` + 內容指紋的紀錄，狀態設為 `published` | 清除標記（只在核准時） |
| 退回（returned）＝ 需要修正 | 寫入紀錄，狀態回到 `draft` | 保留標記 |
| 拒絕（rejected）＝ 內容不可用 | 寫入紀錄，狀態回到 `draft` | 保留標記 |
| 未能裁決（unresolved） | **不寫入任何紀錄** | 保留標記 |

覆核者身分只取自伺服器端工作階段（[review/route.ts](../../src/app/api/teacher/questions/[questionId]/review/route.ts)），`expectedRevision` 是必填樂觀鎖；對已改變的版本提交會被拒絕（409）。核准只對當時版本有效，內容一改即失效。

**Migration 0021（`review-decision-events`）**：移除 `question_reviews` 的唯一索引，令「疑問出現之後的重新確認」可以留下帶新時間戳的獨立紀錄；冪等改由 `insertQuestionReview()` 在題目**沒有**待確認標記時維持（同一版本、同一決定、同一指紋的重複提交回傳既有紀錄）。原因：舊索引會吞掉隔離後的重新確認，令「誰在何時解除隔離」不可稽核（AU-29）。此 migration 未在正式環境執行。

#### 7.6.4 題目可派發／可發布路徑矩陣

| # | 路徑 | 入口 | 是否檢查 `teacher_confirmation_required` | 證據／測試 |
| --- | --- | --- | --- | --- |
| 1 | 匯入校內試題 | [question-bank-import-service.ts](../../src/server/services/question-bank-import-service.ts) | 會設定（考核答案被改寫時），不發布 | repair-provenance |
| 2 | 既有題庫（建立練習） | [practice-service.ts](../../src/server/services/practice-service.ts) `createPractice` | **會**（`statuses: ["published"]` + `!teacherConfirmationRequired`） | practice-flow、teacher-adjudication |
| 3 | AI 即時生成 | 同上 `questionSource: "ai"` | 會（生成階段已攔下未確定題目，練習層再過濾結構） | practice-ai-mode |
| 4 | 題庫不足時即時生成 | 同上 `generateQuestions` | **會**（`withheld` 計數及通知） | practice-flow |
| 5 | 重做錯題（wrong-only） | 同上 `collectQuestionsFromWrongAttempts` | **會**（AU-27 修正；查核現行題庫標記） | teacher-adjudication |
| 6 | 自動修復／重複修復 | [repair-question-bank.ts](../../scripts/repair-question-bank.ts)、[question-repair.ts](../../src/server/services/question-repair.ts) | **不會清除**（隔離警告屬獨立命名空間；重跑不會解除） | repair-provenance（26 項） |
| 7 | 自動品質驗證 | [question-service.ts](../../src/server/services/question-service.ts) `revalidateQuestion`／`publishAutoGeneratedQuestion` | **會**（帶標記時回 `awaiting-teacher-confirmation`；自動發布拒絕） | question-review、publication-safety |
| 8 | 擁有者批次覆核 | [approve-questions.ts](../../scripts/approve-questions.ts) | **會**（AU-26 修正：只處理 `approvable`，列出 `held`） | teacher-adjudication |
| 9 | 擁有者批次發布 | [publish-draft-questions.ts](../../scripts/publish-draft-questions.ts) | **會**（`listOwnerPublicationCandidates` 分出 `held`） | publication-safety |
| 10 | 教師逐題覆核 | `/api/teacher/questions/[id]/review` | 核准＝教師決定（清除標記）；退回／拒絕保留 | teacher-adjudication |
| 11 | 教師／管理員狀態切換 | `/api/teacher/questions/[id]` `PATCH status` | **會**（AU-28 修正：帶標記一律 409） | teacher-adjudication、publication-safety |
| 12 | 既有練習與快照 | `getPracticeView`／`getPracticeResult` | 不重新派發；以原本快照批改（歷史不變） | validation-freshness、repair-provenance |
| 13 | 重新開啟的練習 | 快照（`practice_sessions.questions_json`） | 只讀；撤回或隔離不會追溯改寫已派發的試卷 | validation-freshness |
| 14 | 學生端任何請求 | `/api/practice*` | 學生路由沒有覆核／發布／隔離的寫入路徑 | authz-negative、access-control |

**仍然存在的界線**（不是缺陷，但必須如實記錄）：已在學生手上的凍結快照仍可作答及查看，即使題目後來被隔離或撤回；這是「歷史不變」的既有設計，所以隔離只阻止**新的**派發。

#### 7.6.5 仍待補的可追溯性

- 早期自動修復紀錄以 `admin` 角色寫入（AU-30），不能單靠角色欄區分人／機器；未改寫歷史。
- 擁有者 2026-10-15 的 143 題批次授權仍是「科組已審閱」的整體聲明，**不是**逐題裁決；本次 18 題的逐題決定已另行寫入（§7.6.6）。

#### 7.6.6 裁決結果（2026-10-19）

擁有者以 `ipwh@pochiu.edu.hk`（`admin`）逐題決定，經 `recordQuestionReview()` 寫入（伺服器時間、版本＋指紋綁定）；只套用於本機 `data/app.db`，沒有接觸正式資料庫或部署。完整逐題理由見 [repair-adjudication-results-2026-10-19.md](teacher-review/repair-adjudication-results-2026-10-19.md)。

| 結果 | 數量 | 說明 |
| --- | --- | --- |
| 核准 | **16** | 隔離標記清除、隔離警告移除、維持／回復已發布；審核只對當時版本有效 |
| 拒絕並刪除 | **2** | `qb-NJCFN0110000060`、`qb-JTH2ndEdFBQ09016`；記錄「拒絕」後刪除（0 次作答、0 個快照、0 份回報），舊覆核紀錄保留 |
| 退回後修正再核准 | 2（計入核准） | `qb-JTH2ndEdFBQ09015` 改為考核「軍備」（第 6 版）；`qb-JTH2ndEdFBQ09028` 補上「阿爾薩斯—洛林」、改為考核「德國」（第 6 版） |
| 仍隔離 | **0** | — |

其他變更：`qb-NJCFN0120000013` 按教師指示新增可接受答案「鄉議局」（第 6 版後核准）。`question_reviews` 由 3,148 增至 **3,168**（新增 20 筆：16 核准、2 拒絕、2 退回）。

**已知限制（不掩飾）**：`qb-JTH2ndEdFBQ09015` 的答案「軍備」在題幹「研發軍備」中再次出現；教師在知悉後選擇保留原文，理由已寫入覆核紀錄。

### 7.7 內容品質稽核與發布閘門（Sprint 9，2026-10-19）

兩個新工具都是**唯讀**：`npm run audit:content` 及 `npm run release:gate`；不修改題目、覆核或發布狀態。

#### 7.7.1 來源可追溯性（釐清舊指標）

| 狀態 | 題數 | 說明 |
| --- | --- | --- |
| `traceable` | **877** | `source_block_ids` 全部解析到現存段落及文件 |
| `pending_verification` | **1,003** | 校內試題：有「檔名 · 第 N 題 · 知識點」文字位置，但沒有文件紀錄、雜湊或匯入批次 |
| `partial` | 0 | — |
| `unknown` | 0 | — |

舊報告的「580 題來源不可追溯」實為**改寫來源不可追溯**（revision > 1 而沒有可追溯的修復紀錄），不是來源文件不可追溯；本節以另一指標量度，兩者不可混淆。平台現時**沒有匯入批次表**，這是 schema 層面的已知缺口（未在本 Sprint 新增 migration）。

#### 7.7.2 解釋品質

| 分類 | 題數 |
| --- | --- |
| `placeholder`（佔位文字） | **1,334** |
| `answer_only`（只列答案） | **546** |
| `insufficient`（短且無說明） | 0 |
| `potentially_inconsistent`（疑似矛盾） | 0 |
| `not_assessed`（未發現模板或矛盾） | 0 |

有人工覆核但仍屬低品質：**1,244** 題（「有覆核」不等於「解釋合格」）。另有 **1,279** 筆以非 `automation` 角色寫入的自動修復紀錄（AU-30），角色欄不能單獨證明是人類覆核。

#### 7.7.3 元數據

| 問題 | 題數 |
| --- | --- |
| 技能空白 | **1,880** |
| 知識點排版殘留 | **122** |
| 知識點通用標籤「校內試題」 | **587** |
| 知識點與分節標題對不上 | **878** |
| 無效課題／分節關聯（阻擋級） | **0** |
| 難度值 | 只有 `basic`（1,880） |

#### 7.7.4 政策分類與發布閘門

| 閘門 | 狀態 | 證據 |
| --- | --- | --- |
| 隔離／待教師確認 | **PASS** | 0 題 |
| 題目結構可作答 | **FAIL** | 97 題已發布但不可作答（派發層會攔下，學生不會收到；仍需修正或改回草稿） |
| 考核答案改寫來源 | **PASS** | 18 題已裁決，0 未決 |
| 來源可追溯性 | **POLICY_PENDING** | 877／1,880 可定位；1,003 待核實 |
| 解釋品質 | **POLICY_PENDING** | 1,334 佔位、546 只列答案；是否暫緩派發未有政策 |
| 元數據完整性 | **POLICY_PENDING** | 1,587 項需教師確認；0 阻擋級 |
| 未處理教師裁決 | **PASS** | 0 |
| 版權 | **WARN** | 擁有者已確認；逐份權利紀錄 12／36 |
| Golden dataset | **INSUFFICIENT_EVIDENCE** | 空 |
| 測試／建置證據 | **INSUFFICIENT_EVIDENCE** | 見 §9（證據檔） |
| 部署驗證 | **INSUFFICIENT_EVIDENCE** | 未部署 |

**結果：NOT READY。** 沒有因本次新增工具而改變任何題目、答案、覆核或發布狀態；也沒有把未定義標準當成通過。

### 7.8 可作答性、審核來源與 Golden 基準（Sprint 10，2026-10-19）

#### 7.8.1 97 題結構不可作答（唯讀盤點，未修改）

`npm run audit:servability`（[報告](quality/servability-remediation-2026-10-19.md)）：

| 問題代碼 | 題數 | 說明 |
| --- | --- | --- |
| `MCQ_ROMAN_LABEL_MISSING` | **96** | 選項以羅馬數字指涉題幹，但題幹沒有 i／ii 標示 |
| `FILL_ANSWER_LEAKS` | **1** | `qb-JTH2ndEdFBQ09015`：教師在 Sprint 9 選擇保留「研發軍備」原文，答案「軍備」在題幹再次出現；裁決紀錄保留，但 servability 仍會攔下 |

全部 97 題均為已發布、**0 次作答、0 個練習快照**；建議一律 `teacher_review_required`（沒有符合「來源確定、不改變答案／評分」的自動修復）。**沒有修改、退回或隔離任何題目**。

#### 7.8.2 審核紀錄來源：修正 1,279 筆的說法

`npm run audit:review-provenance`（[報告](quality/review-provenance-2026-10-19.md)）：

| 來源 | 數量 |
| --- | --- |
| 擁有者批次 | 1,882 |
| 自動修復 | **1,266** |
| 教師裁決 | 20 |

全部 3,168 筆 `reviewer_role` 都是 `admin`。Sprint 9 的 1,279 = 1,266 筆自動修復 + **13 筆**被字串規則誤判的教師裁決（理由含「自動修復改變考核答案」）。目前版本：16 題有教師裁決、1,241 題只有擁有者批次、623 題只有自動修復證據、0 題完全沒有證據。原始紀錄全部保留，沒有改寫。

#### 7.8.3 Golden evaluation v2

[golden-questions.v2.json](teacher-review/golden-questions.v2.json) 已建立 schema（`draft`／`pending-review`／`approved`／`rejected`／`superseded`）、版本及 runner；[候選清單](teacher-review/golden-candidates-2026-10-19.md) 42 個 `pending-review` 候選。**approved fixture 仍為 0，評估結果 `INSUFFICIENT_EVIDENCE`**，沒有教師確認前不會建立 approved fixture。

#### 7.8.4 發布閘門更新

| 閘門 | 狀態 | 證據 |
| --- | --- | --- |
| 隔離 | PASS | 0 題 |
| 可作答性 | **FAIL** | 97 題（96 羅馬數字、1 答案外洩；派發層攔下） |
| 答案改寫來源 | PASS | 18 題已裁決 |
| 來源可追溯性 | POLICY_PENDING | 877／1,880 |
| 解釋品質 | POLICY_PENDING | 1,334 ＋ 546 |
| 元數據 | POLICY_PENDING | 1,587 項需覆核 |
| 教師裁決 | PASS | 0 |
| **審核證據來源** | **POLICY_PENDING** | 623 題只有自動修復證據 |
| 版權 | WARN | 擁有者確認；逐份 12／36 |
| Golden dataset | INSUFFICIENT_EVIDENCE | 0 approved |
| 測試／建置 | PASS | 見 §9 |
| 部署 | INSUFFICIENT_EVIDENCE | 未部署 |

**整體：NOT READY。**

---

### 7.9 教師裁決流程、修復證據與 Golden 核准（Sprint 11，2026-10-19）

完整報告：[sprint-11-report-2026-10-19.md](sprint-11-report-2026-10-19.md)。

#### 7.9.1 96 題羅馬數字題目：0 題可由原文確定修復

`npm run audit:servability-evidence`（唯讀，[報告](quality/servability-evidence-2026-10-19.md)）在 `materials/` 找回原始 DOCX 並逐題比對：

| 結果 | 題數 |
| --- | --- |
| 原文標示不齊全（80 題完全無編號、1 題只有 i–iii） | **81** |
| 原文陳述數與選項指涉不符 | **10** |
| 原始檔缺失 | **4** |
| 找不到題幹段落 | **1** |
| 原文有標示、可直接補上 | **0** |

原文本身已失去編號（表格／分欄在轉存時被拆散），按選項順序補上 i／ii／iii 屬推測，Sprint 明確禁止。因此 **96 題全部需要教師裁決**，沒有一題可以自動修復。

#### 7.9.2 教師裁決 API 與「核准不能繞過可作答性」

- `POST /api/teacher/questions/[questionId]/servability`：`return_to_draft`／`keep_quarantined`／`request_more_evidence`／`reject`；需要真實教師或管理員工作階段（未登入 401、學生 403）；裁決綁定版本＋指紋，衝突回 409。
- `recordQuestionReview(approved)` 現在會先執行 `checkQuestionServable()`；結構不可作答時回 409，**不會**因為有人按下「通過」而重新派發。`changeQuestionStatus(published)` 亦有同樣檢查（舊核准紀錄不能令不可作答的題目變成已發布）。這是 Sprint 11 修正的兩條繞過途徑。
- Sprint 9 對 `qb-JTH2ndEdFBQ09015`（「研發軍備」保留原文）的裁決紀錄不變；該題仍然被閘門攔下，不能派發。

#### 7.9.3 623 題只有自動修復證據的風險分布

`npm run audit:provenance-risk`（[報告](quality/provenance-risk-2026-10-19.md)）：

| 等級 | 題數 | 判準 |
| --- | --- | --- |
| P0 | 0 | 答案映射或題目含義改變 |
| P1 | **530** | 多空格填充題補回其餘空格；考核空格及答案不變 |
| P2 | 0 | 無可比較原始內容 |
| P3 | **93** | 只移除選項殘留項目符號 |

P3 只代表覆核次序較後，不是已核准。

#### 7.9.4 Golden Dataset v2 人工核准

`GET /api/teacher/golden`、`POST /api/teacher/golden/[questionId]`、`npm run golden:export`。核准必須附上教師評估內容（category、reasoning、預期 grading、distractorNotes）；裁決寫入 `golden_fixture_reviews`（migration 0022，只新增），綁定版本＋指紋，題目改動即失效。**approved fixture 仍為 0**，`golden:eval` 為 `INSUFFICIENT_EVIDENCE`。

#### 7.9.5 發布閘門（15 項）

新增 `servability-adjudication`（POLICY_PENDING，97 題待裁決）、`provenance-risk`（POLICY_PENDING，P1 530）、`golden-approval`（INSUFFICIENT_EVIDENCE，0 approved）。其餘閘門與 §7.8.4 相同，`question-servability` 仍為 FAIL。**整體：NOT READY。**

---

### 7.10 發布控制加固與學科授權（Sprint 12，2026-10-19）

完整報告：[sprint-12-report-2026-10-19.md](sprint-12-report-2026-10-19.md)。

本次以程式碼建立寫入／核准／發布／派發路徑矩陣（35 個 route 檔、45 個方法），並修正以下有證據支持的問題：

| 問題 | 影響 | 修正 |
| --- | --- | --- |
| 狀態更新是先讀後寫（TOCTOU） | 理論上舊核准可發布已被修改的新版本 | `setQuestionStatusIfRevision()`：`UPDATE ... WHERE revision = ?`，不符回 409 |
| 舊練習快照可為被隔離題目提交新作答 | 隔離題目仍可被作答 | `submitAnswer()` 檢查題庫題目的隔離／可作答性（已作答者仍可看歷史回饋） |
| 批次發布／批次覆核候選未過濾不可作答題目 | 批次腳本會被 409 中斷，或把不可作答題目列入候選 | `listOwnerPublicationCandidates()`／`listOwnerApprovalCandidates()` 排除並列入 held |
| admin 可核准 Golden fixture 及「已修復並核准」 | 平台角色被當成學科資格 | 新增 `HISTORY_REVIEWER_EMAILS` 名單，未設定即 fail-closed（403） |
| 0 題資料時內容閘門 PASS | 空資料庫／錯 DB 會被當成「沒有問題」 | `evaluateReleaseGates()` 覆寫為 `INSUFFICIENT_EVIDENCE` |

**重新核實的數字**（與 Sprint 11 一致）：97 題不可作答（96 羅馬數字、1 答案外洩）、96 題原文核對 **0 題可自動補標示**、623 題 provenance（P0 0／P1 530／P2 0／P3 93）、Golden 0 approved／42 候選、來源 877／1,003／0／0、解釋 1,334＋546、技能空白 1,880、覆核紀錄 3,168（16 教師裁決／1,241 擁有者批次／623 只有自動修復）。

**E2E 5 項失敗已逐項定位**：2 項為與 fail-closed 政策矛盾的過時斷言（已改為驗證政策）、1 項為 E2E 選中只有選擇題的分節（改用父分節，實際驗證填充題評分）、2 項為暫存上載目錄缺少原始檔案（複製 `data/uploads` 後 128 項全部通過）。

---

### 7.11 唯讀稽核完整性與 migration 責任（Sprint 13，2026-10-19）

完整報告：[sprint-13-report-2026-10-19.md](sprint-13-report-2026-10-19.md)；CLI 契約：[audit-cli-contract-2026-10-19.md](audit-cli-contract-2026-10-19.md)。

| 問題 | 影響 | 修正 |
| --- | --- | --- |
| `golden:export -- --check` 經 `getDb()` 自動執行 migration | 一個「檢查」動作會改 schema（Sprint 11 曾對開發資料庫套用 0022） | `enableReadOnlyDatabaseMode()`／`openReadOnlyDatabase()`；CLI 在匯入 service 前啟用；缺 DB／缺 0022 → exit 2 |
| migration 與一般資料讀取混在一起 | 無法保證 audit 唯讀 | 獨立命令 `db:migrate -- --database <path>`（沒有預設值） |
| audit CLI 從 `question-service` 匯入指紋 | 模組圖含 repositories，難以靜態證明唯讀 | 抽出純函式 `quality/question-fingerprint.ts` |
| 退出碼與內容狀態混用 | CI 可能把「工具成功」當成「內容合格」 | 契約：audit exit 0＝報告已產生；`release:gate --fail-on-not-ready` 才以 exit 1 阻擋 |

驗證：`tests/read-only-cli.test.ts` 以 SHA-256 檔案雜湊證明 7 種情境下主資料庫不變；`golden:export --check` 在 `data/app.db` 複本上實測雜湊不變。已知限制：WAL sidecar 檔案可能被建立（內容不變）。

---

### 7.12 裁決工作分流、交叉分析與 Golden 準備度（Sprint 14，2026-10-19）

完整報告：[sprint-14-report-2026-10-19.md](sprint-14-report-2026-10-19.md)。

| 產出 | 內容 |
| --- | --- |
| `audit:adjudication-worklist` | 97 題逐題工作清單：Roman 96 題分為原卷可核對但標示不齊全 **81**、陳述不一致 **10**、原卷缺失 **4**、段落無法定位 **1**；答案外洩 1；**0 題可自動補標示**；全部維持隔離 |
| `audit:source-crosswalk` | 623 題 provenance 與 1,003 題來源待核實**重疊 124**（P1 31、P3 93）；**31 題有修復差異但來源不可追溯**；重複列 0 |
| `audit:golden-readiness` | 42 候選全部版本／指紋一致、有來源及答案；仍缺教師提供的預期 grading／理由／錯誤選項說明；`HISTORY_REVIEWER_EMAILS` 未設定 → 0 approved |
| WAL sidecar | 只宣稱政策 A（內容唯讀，允許 `-wal`／`-shm`）；政策 B（檔案系統唯讀）未實作，待負責人決定 |

以上工具全部唯讀（`openReadOnlyDatabase()`），並由 `tests/read-only-sidecar.test.ts` 以主檔雜湊、`sqlite_master`、`schema_migrations` 及資料列比對驗證。

---

### 7.13 覆核優先次序 manifest 與決策包（Sprint 15，2026-10-19）

完整報告：[sprint-15-report-2026-10-19.md](sprint-15-report-2026-10-19.md)。

| 產出 | 內容 |
| --- | --- |
| `audit:review-manifest` | 623 題逐題證據契約（revision／fingerprint、修復分類、來源狀態、需核對欄位、必要決定、可作答狀態）；P1 530／P3 93；重疊 124（不另計）；重複列 0 |
| Golden 冪等 | 同版本／指紋／決定／理由的重複提交回 `created:false`，不新增裁決列 |
| 決策包 | 13 項一頁總覽（角色多為 `UNASSIGNED`、影響閘門、安全預設、完成證據） |
| 裁決 UI | **尚未實作**：servability 與 Golden 目前只有 API／CLI，教師端 UI 只有一般覆核；報告如實標示，不視為流程完成 |

全部 manifest 產出由 `tests/read-only-sidecar.test.ts` 驗證：623 唯一、重疊 124、資料庫雜湊與 schema 不變。

---

## 8. 已實施修正

| 修正 | 檔案 | 回歸測試 |
| --- | --- | --- |
| 羅馬數字選項無標示 → 不派發 | [question-servability.ts](../../src/server/services/question-servability.ts) | question-servability、practice-flow |
| 填充題答案欄損壞 → 不派發 | 同上 | question-servability、practice-flow |
| 同義答案「甲 / 乙」及 U+2024 | [grading.ts](../../src/server/services/grading.ts) | grading |
| 生成題目套用結構安全網 | [practice-service.ts](../../src/server/services/practice-service.ts) | practice-flow、practice-ai-mode |
| 未發布課題不可建立練習 | 同上 | practice-flow |
| 正式建置後台 fail-closed | [config.ts](../../src/server/config.ts)、[guards.ts](../../src/server/auth/guards.ts) | access-control |
| CSV `no-store` | [export/route.ts](../../src/app/api/teacher/records/export/route.ts) | authz-negative |
| 損毀 cookie 不再 500 | [session.ts](../../src/server/auth/session.ts) | auth |
| 登出 `no-store` | [sign-out/route.ts](../../src/app/api/auth/sign-out/route.ts) | — |
| 安全標頭 | [next.config.ts](../../next.config.ts) | 以 curl 實測 |
| 教師端顯示「學生無法作答」 | [question-service.ts](../../src/server/services/question-service.ts)、[QuestionManager.tsx](../../src/components/QuestionManager.tsx) | e2e 題目清單 |
| 多空格填充題的答案對應（2026-10-19） | [question-repair.ts](../../src/server/services/question-repair.ts)、[question-bank.ts](../../src/server/materials/question-bank.ts)、[repair-question-bank.ts](../../scripts/repair-question-bank.ts) | repair-provenance（26 項） |
| 匯入時改變考核答案 → 待教師確認 | [question-bank-import-service.ts](../../src/server/services/question-bank-import-service.ts) | repair-provenance |
| 修復理由準確性及 automation 身分 | [question-repair.ts](../../src/server/services/question-repair.ts)、[repair-question-bank.ts](../../scripts/repair-question-bank.ts) | repair-provenance |
| 既有 18 題的隔離能力 | [audit-repair-provenance.ts](../../scripts/audit-repair-provenance.ts)、`--quarantine` | 以暫存資料庫副本實測（18 題隔離、0 題洩漏、覆核數目不變） |
| 批次覆核不可清除待確認標記（AU-26） | [approve-questions.ts](../../scripts/approve-questions.ts)、[question-service.ts](../../src/server/services/question-service.ts) `listOwnerApprovalCandidates` | teacher-adjudication |
| 重做錯題不可再派已隔離題目（AU-27） | [practice-service.ts](../../src/server/services/practice-service.ts) | teacher-adjudication |
| 帶標記的題目不可只切換狀態發布（AU-28） | [question-service.ts](../../src/server/services/question-service.ts) `changeQuestionStatus` | teacher-adjudication、publication-safety |
| 隔離後的重新確認留下新紀錄（AU-29） | [migrations.ts](../../src/server/db/migrations.ts) 0021、[questions.ts](../../src/server/repositories/questions.ts) `insertQuestionReview` | teacher-adjudication、migration-safety |
| 自動修復紀錄的顯示（AU-30） | [QuestionManager.tsx](../../src/components/QuestionManager.tsx) | teacher-adjudication（套件標示） |

---

## 9. 測試與建置記錄（實際執行）

| 指令 | 退出碼 | 結果 |
| --- | --- | --- |
| `npm test`（修正前基線） | 0 | 77 檔通過；**1,045 通過、4 略過（1,049）** |
| `npm test`（全部修正後） | 0 | 77 檔通過；**1,055 通過、4 略過（1,059）** |
| `npm test`（2026-10-19 更正後，含 4 個新增的語意界線測試） | 0 | 77 檔通過；**1,059 通過、4 略過（1,063）** |
| `npm test`（2026-10-19 修復來源稽核後，含 26 個新增的修復測試） | 0 | 78 檔通過；**1,085 通過、4 略過（1,089）** |
| `npm test`（2026-10-19 裁決衝刺後，含 7 個裁決測試） | 0 | 79 檔通過；**1,092 通過、4 略過（1,096）** |
| `npm run review:adjudication` | 0 | 18 題套件（JSON + MD）；18 題已隔離；決定欄全部 `unset` |
| `npm run review:content-queue` | 0 | 分類佇列（附錄 B 12、佔位解釋 1,334、只列答案 548、知識點殘留 122、通用標籤 588、待確認對應 879、技能空白 1,882、來源不可追溯 580、教材發行權） |
| `repair:questions --quarantine … --apply`（本機 `data/app.db`，先備份至 `%TEMP%`） | 0 | 18 題隔離；寫入 0 筆覆核；`question_reviews` 維持 3,148 |
| `npm test`（Sprint 9：新增 38 個品質／閘門測試） | 0 | 82 檔通過；**1,131 通過、4 略過（1,135）** |
| `npm run audit:content`（唯讀） | 0 | 來源 877／1,003／0／0；解釋 1,334／546；技能空白 1,880；政策 hard 97、teacher 3,834、warning 1,880、pending 1,880 |
| `npm run release:gate`（唯讀，含 evidence 檔） | 0 | **NOT READY**（PASS 4、FAIL 1、POLICY_PENDING 3、WARN 1、INSUFFICIENT 2） |
| `node scripts/e2e-flow.mjs --start`（暫存 DB） | 1 | 121 通過／5 失敗（與上次相同的環境限制） |
| `npm test`（Sprint 10：新增 21 個可作答性／來源／golden 測試） | 0 | 84 檔通過；**1,152 通過、4 略過（1,156）** |
| `npm run audit:servability`（唯讀） | 0 | 97 題不可作答（96 羅馬數字、1 答案外洩）；0 次作答、0 個快照 |
| `npm run audit:review-provenance`（唯讀） | 0 | 1,882 批次、**1,266 自動修復**、20 教師裁決；1,279 為 1,266＋13 誤判 |
| `npm run golden:candidates`／`golden:eval`（唯讀） | 0 | 42 個候選；0 approved → `INSUFFICIENT_EVIDENCE` |
| `npm run release:gate`（Sprint 10 更新） | 0 | **NOT READY**（12 個閘門） |
| `npm test`（Sprint 11：新增 22 個裁決／風險／Golden 測試） | 0 | 87 檔通過；**1,193 通過、4 略過（1,197）** |
| `npm run audit:servability-evidence`（唯讀） | 0 | 96 題核對：81 題原文標示不齊全（80 完全無編號、1 只有 i–iii）、10 題陳述數不符、4 缺檔、1 找不到段落、**0 題可直接補標示** |
| `npm run audit:provenance-risk`（唯讀） | 0 | 623 題：P0 0、P1 530、P2 0、P3 93 |
| `npm run golden:export -- --check`（唯讀） | 0 | 0 approved fixture（尚無教師裁決） |
| `npm run release:gate`（Sprint 11 更新） | 0 | **NOT READY**（15 個閘門） |
| `npm test`（Sprint 12：新增 4 組發布控制測試 + 學科授權／migration 0022） | 0 | 88 檔通過；**1,203 通過、4 略過（1,207）** |
| `npm run typecheck`／`lint`／`build`（Sprint 12） | 0 | 全部通過 |
| `node scripts/e2e-flow.mjs --start`（Sprint 12，空上載目錄） | 1 | 126 通過／2 失敗（只餘 OCR 缺原檔） |
| `node scripts/e2e-flow.mjs --start`（Sprint 12，複製 `data/uploads`） | 0 | **128 通過／0 失敗** |
| `npm run release:gate`（Sprint 12 更新） | 0 | **NOT READY**（15 個閘門；0 題資料時內容閘門為 INSUFFICIENT_EVIDENCE） |
| `npm test`（Sprint 13：新增 7 項唯讀 CLI 契約測試） | 0 | 89 檔通過；**1,210 通過、4 略過（1,214）** |
| `npx tsx scripts/export-golden-fixtures.ts --check`（Sprint 13） | 0 | schema 可用、0 approved；不寫 DB、不寫檔（主檔 SHA-256 不變） |
| `npx tsx scripts/release-gate.ts --fail-on-not-ready`（Sprint 13） | **1** | `NOT READY` 正確阻擋 |
| `npm run db:migrate` | — | **未執行**（只以程式碼確認缺 `--database` 時 exit 1） |
| `npm test`（Sprint 14：新增 5 項 sidecar／唯讀報告測試） | 0 | 90 檔通過；**1,215 通過、4 略過（1,219）** |
| `npm run audit:adjudication-worklist`（Sprint 14） | 0 | 97 題；Roman 81／10／1／4；0 可自動補標示 |
| `npm run audit:source-crosswalk`（Sprint 14） | 0 | 重疊 124（P1 31、P3 93）；需先補來源 31；重複列 0 |
| `npm run audit:golden-readiness`（Sprint 14） | 0 | 42 候選、0 approved、42 待教師審核 |
| `node scripts/e2e-flow.mjs --start`（Sprint 14，暫存 DB + 複製 `data/uploads`） | 0 | **128 通過／0 失敗** |
| `npm run audit:repair-provenance` | 0 | 1,882 題全部可與來源比對；877 語意不變、987 純格式、18 考核答案改變 |
| `repair:questions --quarantine`（暫存資料庫副本） | 0 | 18 題隔離；0 題可派發、0 題洩漏；覆核紀錄維持 3,148 筆（沒有新增） |
| `repair:questions --apply`（同一副本，連續兩次） | 0 | 兩次結果相同（idempotent）；沒有為被阻擋的題目補記覆核 |
| `npm run typecheck` | 0 | `next typegen` + `tsc --noEmit` 無錯誤 |
| `npm run lint` | 0 | ESLint 無錯誤 |
| `npm run build` | 0 | Next.js 16.4.0 正式建置成功 |
| `node scripts/e2e-flow.mjs --start`（隔離 DB，空教材） | 1 | 84 通過／16 失敗（全部因未匯入教材） |
| 同上（隔離 DB，1,882 題快照） | 1 | **121 通過／5 失敗**（4 項因該練習抽到無教材節錄的校內試卷題；1 項因快照缺少上載原檔令 OCR 失敗） |
| 同上（2026-10-19 裁決衝刺後，18 題已隔離的快照） | 1 | **121 通過／5 失敗**，失敗項目與上一列相同（已核對：沒有任何分節因隔離而失去最後一條基礎填充題） |
| 正式建置實測（無登入、無示範開關） | — | `/api/admin/system/health` 403；`/teacher` 307 至登入頁；公開課題 API 200；四個安全標頭存在 |
| 派發閘門實測 | — | 4 個課題 × 30 題；被攔下的 97 題**洩漏 0 條** |

測試隔離：每個測試檔使用 `tests/test-database.ts` 產生獨立暫存資料庫；上載使用 `tests/setup-uploads.ts`／`APP_UPLOADS_DIR`；端對端使用 `%TEMP%` 內的資料庫及上載目錄，沒有寫入專案的 `data/`。

**已知環境限制**：端對端 5 項失敗不是程式缺陷，而是「快照資料庫 + 空上載目錄」及「抽到沒有節錄的校內試卷題」造成；已逐項核對原因。

---

## 10. 發布檢核清單

### 10.1 本機證據（已完成）

- [x] `npm test` 全綠（1,152 通過）
- [x] `npm run typecheck`、`npm run lint`、`npm run build` 通過
- [x] 修復來源稽核（1,882 題全部可比對；18 題考核答案改變已列明）
- [x] 隔離指令實測（本機 `data/app.db`：18 題隔離、0 題可派發、覆核數目不變）
- [x] 教師裁決套件已產生（18 題，決定欄全部未設定，沒有假造裁決）
- [x] 題目可派發／可發布路徑矩陣逐條核對（14 條，見 §7.6.4）
- [x] 確認並修正 4 條會令隔離失效或不可稽核的路徑（AU-26 至 AU-29）
- [x] HTTP 端對端（隔離資料庫）核心流程通過
- [x] 學生／教師／管理員負向權限測試通過
- [x] 結構上無法作答的題目不再派發（實測 0 洩漏）
- [x] 正式建置後台 fail-closed（實測 403）
- [x] 安全標頭實測
- [x] 內容稽核（唯讀）：來源 877 可定位／1,003 待核實；解釋 1,334 佔位／546 只列答案；元數據及政策分類（§7.7）
- [x] 發布閘門（唯讀）：`NOT READY`，11 個閘門的狀態及證據見 §7.7.4
- [x] 版權：擁有者確認紀錄（[copyright-owner-attestation-2026-10-19.md](teacher-review/copyright-owner-attestation-2026-10-19.md)）
- [x] 不可作答題目逐題盤點（97 題，唯讀；[報告](quality/servability-remediation-2026-10-19.md)）
- [x] 審核紀錄來源逐筆分類（3,168 筆；[報告](quality/review-provenance-2026-10-19.md)）
- [x] Golden dataset v2 schema、候選清單及 runner（approved 0 → `INSUFFICIENT_EVIDENCE`）

### 10.2 需要正式環境證據（**未完成**）

- [ ] Cloud Run 部署後的 `/api/health` 版本及資料庫狀態
- [ ] 正式環境 `AUTH_*` 設定（Google 憑證、`AUTH_SECRET` 由 Secret Manager 注入、**沒有** `HISTORY_ALLOW_UNSAFE_DEMO_MODE`）
- [ ] 正式環境學生／教師／管理員各一次登入及權限抽查
- [ ] 正式資料庫備份與還原演練（包括教材原檔）
- [ ] Cloud Run 多執行個體下的 SQLite 併發行為（單檔資料庫不支援多寫者）

### 10.3 版權批准（**部分完成**）

- [x] 擁有者確認版權（2026-10-19，[紀錄](teacher-review/copyright-owner-attestation-2026-10-19.md)）——這是擁有者聲明，不是逐份出版社授權
- [ ] 逐份書面授權證據（`material_documents.rights_confirmed_at` 仍為 12／36；沒有批次回填）
- [ ] 校內試題（1,003 題）的再使用授權逐份證據（如需要）

### 10.4 歷史內容與覆核（**部分完成；其餘項目仍然阻塞**）

#### 10.4.1 上載前的史實核對（**擁有者確認已完成**）

- [x] 擁有者確認：題目在上載前已由科組核對歷史事實
- [x] 倉庫內有一次相關的授權紀錄（[`owner-publication-overrides.json`](teacher-review/owner-publication-overrides.json)，2026-10-15，143 題，理由載明「科組已審閱課本及校內試卷題目」）
- [ ] 該次核對的逐題範圍、參與者及結論（倉庫內沒有；需要擁有者／科組另行提供，或按第 11 節補記）
- [ ] 第 2–7 版的 1,203 題（其中 641 題有自動修復補記、562 題改寫來源不可追溯）：確認改寫後的題幹及被考核空格仍符合原審核結論
- [x] **18 題已證實改變考核答案**（見 §7.5.2）：已在本機資料集以 `--quarantine` 隔離（18／18、0 題可派發）
- [x] **18 題的逐題裁決**：2026-10-19 完成——16 題核准、2 題拒絕並刪除、0 題仍隔離；退回的 2 題按教師指示修正後於第 6 版核准（見 §7.6.6、[結果報告](teacher-review/repair-adjudication-results-2026-10-19.md)）

#### 10.4.2 覆核可追溯性（**未完成**）

- [ ] 在 `question_reviews` 區分 `human`／`owner-batch`／`automation`
- [ ] 為上載前的科組核對建立可追溯的批次紀錄（不逐題回填成教師覆核）

#### 10.4.3 黃金評估題庫（**未完成：獨立 QA 缺口**）

- [ ] 至少一位歷史科教師完成黃金題庫樣本（7 類 × 2 題），作為日後閘門校準的基準

#### 10.4.4 解釋質量（**未完成**）

- [ ] 1,334 條沒有實質解釋的題目：補寫解釋或暫緩派發（暫緩屬產品決定，需擁有者批准）

#### 10.4.5 未決疑點與課程標示（**未完成**）

- [ ] 附錄 B 的疑似答案鍵問題逐題裁決
- [ ] 知識點、難度、技能維度重新標示

### 10.5 部署驗證（**未完成**）

- [ ] 部署後學生完整流程（登入→選題→作答→成績→重溫）
- [ ] 部署後教師覆核及發布一次（含版本鎖衝突）
- [ ] 部署後教材上載＋OCR＋版權閘門
- [ ] 監控：AI 用量、429 次數、5xx、備份狀態

**發布關卡：未滿足。**

---

## 11. 剩餘阻塞與下一步

1. **附錄 B 的 12 項答案鍵疑點（最高優先）**：18 題自動修復疑點已於 2026-10-19 逐題裁決（16 核准、2 刪除，見 §7.6.6）；附錄 B 屬另一批抽樣疑點，仍須歷史科教師逐題裁決。同時處理答案鍵損壞題目（`qb-JTH2ndEdFBQ09028` 已於裁決中修正）。
2. **確認第 2 版以後的內容**：1,203 題已是第 2–7 版（641 題有自動修復補記，580 題找不到對應現行版本的修復紀錄），應由歷史科教師確認改寫後的題幹及被考核空格仍符合上載前的審核結論（分類佇列見 [content-quality-queue-2026-10-19.md](teacher-review/content-quality-queue-2026-10-19.md)）。
3. **補足可追溯性（文件與 schema）**：把上載前的科組核對記錄為批次紀錄（不逐題假裝成教師覆核）；並在 `question_reviews` 引入 `actor_kind`，令批次與自動化通過不再與人類覆核共用同一種顯示（AU-04、AU-30）。
4. **決策：是否暫緩沒有解釋的題目**：需要擁有者批准，因會令可用題目由 1,783 降至約 451（佔位解釋 1,334 題；另有 546 題只列出答案）。此項在 `release:gate` 顯示 `POLICY_PENDING`，不會當作通過。
5. **知識點／難度／技能重新標示**：可由 `scripts/apply-question-queue.ts` 的 manifest 流程處理，但需教師提供正確值（殘留值 122 題、通用標籤「校內試題」587 題、待確認對應 878 題；技能空白 1,880 題）。
6. **版權與教材發行權**：擁有者已於 2026-10-19 確認版權（[紀錄](teacher-review/copyright-owner-attestation-2026-10-19.md)）；逐份權利紀錄仍為 12／36，未有批次回填。12 份可向學生發布、24 份不可。
7. **來源文件紀錄（schema／工具）**：1,003 題校內試題只有「檔名 · 第 N 題」文字位置；建議新增文件紀錄（檔名、題號、SHA-256）及匯入批次，令來源可由系統核實。平台現時沒有匯入批次表。
8. **97 題已發布但結構上不可作答**：已完成唯讀逐題盤點（96 題羅馬數字標示缺失、1 題答案外洩；全部 0 次作答、0 個快照），但**未修改**。派發層會攔下（學生不會收到），仍需教師逐題修正或授權改回草稿，令 `question-servability` 不再 FAIL。
9. **623 題只有自動修復審核證據**：需要負責人決定「內容不變的自動修復」是否足以支持目前版本，或需教師逐題確認；未決定前 `review-provenance` 維持 `POLICY_PENDING`。
10. **Golden evaluation**：v2 schema、runner 及 42 個候選已建立，但 approved fixture 為 0；需歷史科教師逐題核准並填寫 reviewer／reviewedAt／版本／指紋／來源證據。

### Sprint 11 更新（2026-10-19）

- 第 8 項：已建立教師裁決 API（`POST /api/teacher/questions/[questionId]/servability`），但 **97 題仍待裁決**；96 題已核對原文，**0 題可由原文確定補上 i／ii／iii**。同時修正繞過：`recordQuestionReview(approved)` 現在會拒絕結構不可作答的題目。
- 第 9 項：623 題已按可核實 diff 分級（P0 0、P1 530、P2 0、P3 93），仍需負責人決定是否需教師逐題確認。
- 第 10 項：Golden 核准 API、版本／指紋檢查及匯出已建立；approved fixture 仍為 0，必須由真實歷史科教師逐題核准（不能用 admin 代替）。

### Sprint 12 更新（2026-10-19）

- 上述第 8–10 項狀態不變（97 題仍待裁決、623 題仍待政策、Golden 仍 0 approved）。
- 新增阻塞：**歷史科學科授權名單 `HISTORY_REVIEWER_EMAILS` 未設定**，因此 Golden 核准及「已修復並核准」目前沒有人可以執行（fail-closed）。需要科組指定人選（見 [policy-decisions-2026-10-19.md](teacher-review/policy-decisions-2026-10-19.md) 第 9 項）。
- 已修正：TOCTOU 條件式更新、舊快照未作答題目攔截、批次候選過濾、0 題資料時閘門 fail-closed（§7.10）。
- 十項待決政策已整理成負責人可用清單：[docs/teacher-review/policy-decisions-2026-10-19.md](teacher-review/policy-decisions-2026-10-19.md)。

### Sprint 13 更新（2026-10-19）

- `golden:export -- --check` 已改為真正唯讀（不 migration、不寫 DB、不寫檔）；migration 改為獨立命令 `npm run db:migrate -- --database <path>`。
- 已驗證所有 audit／export／evaluation CLI 的副作用契約（[audit-cli-contract-2026-10-19.md](audit-cli-contract-2026-10-19.md)）；`export-production-snapshot` 及 `pilot-deepseek` 仍為 `UNVERIFIED`。
- 97 題、623 題、Golden（42／0／0）與 reviewer 授權狀態**不變**；`HISTORY_REVIEWER_EMAILS` 仍未設定（學科授權阻塞）。
- 退出碼契約：audit exit 0 只代表報告已產生；`release:gate --fail-on-not-ready` 實測 exit 1（NOT READY）。

### Sprint 14 更新（2026-10-19）

- 新增三份唯讀證據報告：97 題裁決工作清單、provenance × 來源交叉分析（重疊 124、需先補來源 31）、Golden 準備度（42 候選、0 approved）。
- WAL sidecar 政策：只宣稱 A（內容唯讀）；B（檔案系統唯讀）未實作，列為待決（政策第 12 項）。
- `golden:export --check`、三個新報告工具及 `release:gate` 的唯讀副作用均有執行期測試（主檔雜湊、schema、`schema_migrations`、資料列）。
- 97 題、623 題、42 候選、`HISTORY_REVIEWER_EMAILS` 狀態**不變**；gate 仍 `NOT READY`。
7. **CI**：新增 GitHub Actions（`npm ci` → `typecheck` → `lint` → `test` → `build`）。
8. **正式環境併發**：確認 Cloud Run 執行個體數與 SQLite 的關係；如需多執行個體，應改用 Cloud SQL／Postgres。
9. **安全加固（非阻塞）**：CSP with nonce、`/api/health` 精簡、發送速率限制。
10. **其餘文件仍有同類措辭待更新**（本次未改動，避免擴大變更範圍）：`README.md` 第 274、1695、1736、1865 行及 `docs/release-preflight-2026-10.md` 第 19、76 行仍以「黃金題庫 0 條 → 沒有任何已人工覆核題目」的框架描述現況；`docs/teacher-review/historical-accuracy-sample-audit.md` 的開頭亦同。這些句子應按 §7.3 的三層區分改寫，數值亦應更新為 1,882 題／3,148 筆紀錄。

---

## 附錄 A：修正後不會派給學生的 97 條題目

| 課題 | 數量 | 題目 ID |
| --- | --- | --- |
| topic-1 | 1 | qb-JTH2ndEdMCQ01023 |
| topic-2 | 6 | qb-NJCMN0020000002, qb-NJCMN0020000004, qb-NJCMN0020000011, qb-NJCMN0020000013, qb-NJCMN0020000023, qb-NJCMN0020000024 |
| topic-5 | 2 | qb-JTH2ndEdMCQ05129, qb-JTH2ndEdMCQ05173 |
| topic-6 | 4 | qb-NJCMN0060000037, qb-NJCMN0060000039, qb-NJCMN0060000042, qb-NJCMN0060000045 |
| topic-8 | 5 | qb-JTH2ndEdMCQ08026, qb-JTH2ndEdMCQ08031, qb-JTH2ndEdMCQ08032, qb-JTH2ndEdMCQ08037, qb-JTH2ndEdMCQ08046 |
| topic-9 | 31 | qb-JTH2ndEdFBQ09028（答案欄損壞）, qb-JTH2ndEdMCQ09017, qb-JTH2ndEdMCQ09021, qb-JTH2ndEdMCQ09022, qb-JTH2ndEdMCQ09024, qb-JTH2ndEdMCQ09028, qb-JTH2ndEdMCQ09050, qb-JTH2ndEdMCQ09058, qb-JTH2ndEdMCQ09059, qb-JTH2ndEdMCQ09066, qb-JTH2ndEdMCQ09068, qb-JTH2ndEdMCQ09070, qb-JTH2ndEdMCQ09078, qb-JTH2ndEdMCQ09083, qb-JTH2ndEdMCQ09086, qb-JTH2ndEdMCQ09088, qb-JTH2ndEdMCQ09094, qb-JTH2ndEdMCQ09099, qb-JTH2ndEdMCQ09100, qb-JTH2ndEdMCQ09107, qb-JTH2ndEdMCQ09108, qb-JTH2ndEdMCQ09110, qb-JTH2ndEdMCQ09111, qb-JTH2ndEdMCQ09115, qb-JTH2ndEdMCQ09124, qb-JTH2ndEdMCQ09125, qb-JTH2ndEdMCQ09126, qb-JTH2ndEdMCQ09186, qb-JTH2ndEdMCQ09189, qb-JTH2ndEdMCQ09192, qb-JTH2ndEdMCQ09196 |
| topic-10 | 32 | qb-JTH2ndEdMCQ10008, qb-JTH2ndEdMCQ10010, qb-JTH2ndEdMCQ10013, qb-JTH2ndEdMCQ10033, qb-JTH2ndEdMCQ10041, qb-JTH2ndEdMCQ10048, qb-JTH2ndEdMCQ10054, qb-JTH2ndEdMCQ10068, qb-JTH2ndEdMCQ10070, qb-JTH2ndEdMCQ10071, qb-JTH2ndEdMCQ10072, qb-JTH2ndEdMCQ10076, qb-JTH2ndEdMCQ10084, qb-JTH2ndEdMCQ10091, qb-JTH2ndEdMCQ10095, qb-JTH2ndEdMCQ10099, qb-JTH2ndEdMCQ10100, qb-JTH2ndEdMCQ10102, qb-JTH2ndEdMCQ10104, qb-JTH2ndEdMCQ10123, qb-JTH2ndEdMCQ10127, qb-JTH2ndEdMCQ10128, qb-JTH2ndEdMCQ10132, qb-JTH2ndEdMCQ10144, qb-JTH2ndEdMCQ10152, qb-JTH2ndEdMCQ10153, qb-JTH2ndEdMCQ10159, qb-JTH2ndEdMCQ10165, qb-JTH2ndEdMCQ10168, qb-JTH2ndEdMCQ10169, qb-JTH2ndEdMCQ10178, qb-JTH2ndEdMCQ10181 |
| topic-11 | 6 | qb-NJCMN0110000006, qb-NJCMN0110000015, qb-NJCMN0110000020, qb-NJCMN0110000026, qb-NJCMN0110000031, qb-NJCMN0110000033 |
| topic-12 | 10 | qb-NJCMN0120000013, qb-NJCMN0120000021, qb-NJCMN0120000024, qb-NJCMN0120000027, qb-NJCMN0120000030, qb-NJCMN0120000033, qb-NJCMN0120000047, qb-NJCMN0120000048, qb-NJCMN0120000052, qb-NJCMN0120000056 |

全部 96 條選擇題的攔截原因相同：選項以 i／ii／iii／iv 指涉題幹陳述，但題幹沒有對應標示。

---

## 附錄 B：NEEDS_HISTORY_TEACHER_REVIEW

以下是抽樣中**疑似**答案鍵或史實問題。**本報告不作出歷史裁決**，只列出讓教師優先處理的證據。

| 題目 ID | 觀察 | 為甚麼需要教師 |
| --- | --- | --- |
| qb-NJCMN0110000060 | 「以下哪項有關聯合國的描述並不正確？」答案標示為「聯合國成功對南非實施制裁」。 | 聯合國確實對南非實施制裁並促成改變；若此陳述為真，則它不應是「不正確」的答案。 |
| qb-JTH2ndEdMCQ08019 | 「十九世紀下半葉的香港…並不正確？」答案為「早期定例局與議政局的非官守議員以香港商人為主」。 | 早期非官守議員多為英資商人；「香港商人」語意不清，可能有多於一個可辯護答案。 |
| qb-NJCMN0120000115 | 「以下哪項有關二十世紀香港房屋計劃的配對並不正確？」答案為「自置居所貸款計劃：提供貸款予全港公屋人士置業」。 | 自置居所貸款計劃的對象及內容與選項描述相近，需確認教材寫法。 |
| qb-JTH2ndEdMCQ05077 | 「啟蒙運動於何時展開？」答案為「十七世紀」，選項另有「十八世紀」。 | 一般把啟蒙運動定於十八世紀；十七世紀通常指科學革命。 |
| qb-JTH2ndEdMCQ05065 | 「科學革命於何時開始？」答案為「十七世紀」。 | 學界多以 1543（十六世紀）為起點，教材寫法需確認。 |
| qb-NJCMN0020000020 | 「基督宗教世界在甚麼時候出現？」答案為「中古時代」。 | 「基督宗教」與「基督宗教世界」不同；前者起源於古代。 |
| qb-NJCMN0020000019 | 「下列哪項有關中古時代的描述是正確的？」答案為「公元1453年結束」。 | 「分為三段時期」亦屬常見且可辯護的描述，題目可能有多個正確答案。 |
| qb-JTH2ndEdMCQ01059 | 「下列哪項有關古埃及人的描述並不正確？」答案為「他們懂得建造階梯式蓄水池」。 | 需確認教材是否明言古埃及沒有這項技術；「生產各種合金」亦可辯駁。 |
| qb-JTH2ndEdMCQ05142 | 「工業革命的技術發明在十九世紀中期被帶到亞洲」被標為「並不正確」。 | 工業技術在十九世紀已傳入亞洲（例如日本、印度）；知識點亦錯配為「A. 國家W」。 |
| qb-JTH2ndEdMCQ05058 | 馬丁路德題目的知識點為「B. 米開蘭基羅」。 | 知識點與題目不符，會令「需要重溫」指向錯誤主題。 |
| qb-JTH2ndEdMCQ05073 | 血液循環題目的知識點為「D. iii、iv」。 | 知識點是排版殘留，不是課題名稱。 |
| qb-NJCFN0020000038 | 答案「尤利烏斯․ 凱撒」含 U+2024 排版字元；題幹稱「公元前60年成功控制羅馬」。 | 史實表述（前三頭同盟 vs 獨裁官）需確認；排版字元已由評分正規化處理。 |

另：15 條答案為「以上皆是／全部皆是」的題目屬有效題型，但其中 13 條同時被附錄 A 攔下（題幹缺少標示），其餘 2 條的陳述是否全部成立，需教師確認。


