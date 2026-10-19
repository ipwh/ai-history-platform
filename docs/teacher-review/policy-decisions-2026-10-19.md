# 內容治理政策決定清單（Sprint 12–15，2026-10-19）

## 決策包（Sprint 15）：一頁總覽

| # | 決定 | 負責角色 | 影響的閘門 | 未決時的安全預設 | 完成證據 |
| --- | --- | --- | --- | --- | --- |
| 1 | 96 題 Roman numeral 題目如何處置 | **UNASSIGNED**（歷史科科主任） | question-servability、servability-adjudication | 維持不可派發 | 每題教師裁決紀錄或原卷證據 |
| 2 | `qb-JTH2ndEdFBQ09015` 後續處置 | **UNASSIGNED**（歷史科教師） | question-servability | 維持原文且不可派發 | 裁決紀錄或修訂後重新覆核 |
| 3 | P1 530／P3 93 provenance 覆核政策 | **UNASSIGNED**（科主任＋擁有者） | review-provenance、provenance-risk | 不宣稱已覆核；題目維持可派發但不當作教師確認 | 書面政策＋逐題／抽樣紀錄 |
| 4 | 1,003 題來源待核實如何處理 | **UNASSIGNED**（擁有者＋科組） | source-traceability | 不把「有位置文字」當已核實 | 文件紀錄（檔名、題號、雜湊、批次） |
| 5 | 1,334 佔位＋546 只列答案的解釋標準 | **UNASSIGNED**（科主任＋擁有者） | explanation-quality | 保留題目，不當作合格 | 標準文件＋按標準重算 |
| 6 | 1,880 題技能標籤是否發布必要條件 | **UNASSIGNED**（科組） | metadata | 不猜測、不填預設值 | 政策＋實際標示 |
| 7 | 36 份材料權利證據（現 12/36） | **UNASSIGNED**（擁有者／校方） | copyright | 未確認＝不發布 | 逐份權利紀錄或授權範圍文件 |
| 8 | `HISTORY_REVIEWER_EMAILS` 名單及責任人 | **DECIDED（本機，2026-10-19；staging／production 仍 UNASSIGNED）** | golden-approval、servability-adjudication | 名單為空 → 核准一律 403（本機已設定，其餘環境仍為空） | 名單設定＋至少一個真實教師核准 |
| 9 | Golden Dataset 教師核准安排 | **UNASSIGNED**（科主任） | golden-approval、golden-evaluation | 0 approved、`INSUFFICIENT_EVIDENCE` | 真實教師核准的 fixture（含 grading／理由） |
| 10 | `export-production-snapshot`、`pilot-deepseek` 驗證責任 | **UNASSIGNED**（技術負責人） | deployment（間接） | 標 `UNVERIFIED`，不得對正式 DB 執行 | 隔離環境實測紀錄 |
| 11 | CLI 唯讀契約與 migration 責任 | **UNASSIGNED**（技術負責人＋擁有者） | tests（工具契約） | 未宣告的 CLI 視為可能寫入 | 每個 CLI 有測試／靜態證據 |
| 12 | WAL sidecar 政策（A 內容唯讀 vs B 檔案系統唯讀） | **UNASSIGNED**（技術負責人＋擁有者） | 不直接影響 gate；影響營運期待 | 只宣稱 A | 政策文件＋按政策調整測試 |
| 13 | 正式部署前 staging／production 驗收證據 | **UNASSIGNED**（擁有者） | deployment | 不部署 | 部署後登入／權限／備份還原證據 |

> 沒有授權審核者或政策負責人時，相關閘門維持阻塞；本文件不假設任何決定已作出。
> 詳細事實、風險、選項見以下各節。

> 本文件把**需要科組／負責人決定**的項目集中列出，並說明每項目前事實、風險、可選項、
> 對學生派題及發布閘門的影響、需要誰批准、完成條件，以及**未決定前系統採用的安全預設**。
> 平台不會代替科組作學術、版權或教師資格判斷；以下數字全部來自可重現的唯讀稽核
> （見 [sprint-12 報告](../sprint-12-report-2026-10-19.md) 第 7 節）。

---

## 1. 96 題羅馬數字標示缺失

- **目前事實**：96 題已發布但結構不可作答（`MCQ_ROMAN_LABEL_MISSING`）。`npm run audit:servability-evidence` 已核對 `materials/` 原文：81 題原文標示不齊全（80 題完全無編號、1 題只有 i–iii）、10 題陳述數與選項不符、4 題原始檔缺失、1 題找不到段落；**0 題可由原文直接確定補上標示**。
- **風險**：若按選項順序自動補 i／ii／iii，等於以推測改寫試題；若直接刪除，會失去可修復的校內試題。
- **可選決策**：
  1. 科組提供原卷掃描／PDF，逐題核對後由教師以 `approve_after_verified_repair` 核准；
  2. 逐題退回草稿（`return_to_draft`），由課程設計者重寫；
  3. 保留隔離（`keep_quarantined`）並永久不派發；
  4. 標示不可用（`reject`）。
- **影響**：在完成前 `question-servability` 維持 FAIL、`servability-adjudication` 維持 POLICY_PENDING；學生不會收到這 96 題（派發層已攔下）。
- **需要誰批准**：歷史科科主任（內容）＋ 擁有者（是否接受永久缺題）。
- **完成條件**：每題都有教師裁決紀錄（綁定 revision／fingerprint）或原卷證據；閘門分子歸零。
- **安全預設**：**維持不可派發**，不改寫、不刪除、不自動核准。

## 2. `qb-JTH2ndEdFBQ09015`（答案外洩）

- **目前事實**：題幹含「研發軍備」，正確答案「軍備」；Sprint 9 教師決定保留原文，`checkQuestionServable()` 仍會攔下，`FILL_ANSWER_LEAKS` 1 題。
- **風險**：改寫題幹可能改變考核重點；以同義詞替換只是掩蓋答案外洩。
- **可選決策**：保留原文且維持不可派發（現狀）；依原卷修訂題幹；退回課程設計者重寫；標示不可用。
- **影響**：`question-servability` 仍 FAIL 直至處理；學生不受影響。
- **需要誰批准**：歷史科教師（內容）＋ 擁有者（是否保留）。
- **完成條件**：教師裁決紀錄，或修訂後重新通過可作答性及覆核。
- **安全預設**：**維持現狀（不可派發）**；Sprint 9 裁決歷史不動。

## 3. 530 題 P1 provenance 風險

- **目前事實**：623 題只有自動修復證據；`audit:provenance-risk` 以可核實 diff 分級：P0 0、**P1 530**（多空格填充題補回其餘空格，考核空格及答案不變）、P2 0、P3 93。
- **風險**：考核答案未變，但題幹已被改寫（補上其他空格的答案），可能影響題目難度或語文表達。
- **可選決策**：接受「考核答案不變」為足夠證據（抽樣覆核）；要求教師逐題確認；只覆核特定課題。
- **影響**：`review-provenance`／`provenance-risk` 維持 POLICY_PENDING；不影響派發（題目本身可作答）。
- **需要誰批准**：歷史科科主任（覆核範圍）＋ 擁有者（資源分配）。
- **完成條件**：明確覆核政策 + 抽樣／逐題紀錄。
- **安全預設**：保留現有題目（可派發），但**不宣稱**已由教師確認。

## 4. 93 題 P3 provenance 風險

- **目前事實**：只移除選項開頭殘留項目符號（`FORMATTING_CHANGE_ONLY`），題幹、選項文字及答案與原文相同。
- **風險**：極低，但「格式修復」仍不是教師核准。
- **可選決策**：定義可驗證的抽查比例（例如每課題抽 10%）；或接受自動化證據並在報告標明。
- **影響**：閘門維持 POLICY_PENDING（除非政策明確接受）。
- **需要誰批准**：歷史科科主任。
- **完成條件**：書面抽查政策 + 抽查紀錄。
- **安全預設**：排在覆核次序較後，不當作已核准。

## 5. 1,003 題來源待核實

- **目前事實**：877 題可定位；**1,003 題**只有「檔名 · 第 N 題」文字位置（未核實、無文件紀錄／雜湊／匯入批次），0 題完全無法追溯；`materials/` 內部分原檔已缺失。
- **風險**：無法證明題目對應哪一份文件版本；來源存在 ≠ 內容正確 ≠ 版權許可。
- **可選決策**：建立文件紀錄（檔名、題號、SHA-256、匯入批次）並逐批核實；只核實即將派發的課題；接受現狀並在報告標明。
- **影響**：`source-traceability` 維持 POLICY_PENDING。
- **需要誰批准**：擁有者（是否投入建立文件紀錄）＋ 科組（原檔是否仍存在）。
- **完成條件**：每題指向可核實的文件紀錄或明確標為不可核實。
- **安全預設**：不把「有位置文字」當成已核實來源。

## 6. 1,334 題佔位解釋及 546 題只列答案

- **目前事實**：`audit:content` 分類：佔位 1,334、只列答案 546、疑似矛盾 0。佔位文字例如「答案依校內試題檔的評卷參考。」
- **風險**：學生看到的「解釋」沒有解釋作用；若全部暫緩，可用題目會大幅減少。
- **可選決策**：定義最低解釋標準（例如必須說明答案理由）；只暫緩特定課題；接受現狀但標示。
- **影響**：`explanation-quality` 維持 POLICY_PENDING；若決定暫緩，派題數量下降。
- **需要誰批准**：歷史科科主任 ＋ 擁有者（接受派題量下降）。
- **完成條件**：書面標準 + 分類報告按新標準重算。
- **安全預設**：保留題目（不自動刪除），不把「有 explanation」當成合格。

## 7. 1,880 題技能標籤缺失

- **目前事實**：全部 1,880 題 `skill` 為空白；難度只有 `basic`。
- **風險**：推薦／篩選無法按技能運作；若自動填入猜測值，會製造虛假的學習分析。
- **可選決策**：技能標籤是否為發布必要條件；由教師逐批標示；維持空白並以安全 fallback 運作。
- **影響**：`metadata` 目前 POLICY_PENDING（needs_review）。
- **需要誰批准**：科組（課程技能對應）＋ 擁有者（是否阻塞發布）。
- **完成條件**：政策 + 實際標示資料。
- **安全預設**：不猜測、不填入預設值；學生功能在缺少技能時安全降級。

## 8. 36 份材料的權利證據

- **目前事實**：36 份材料；12 份可向學生發布且已記錄權利確認；24 份未開放；擁有者已於 2026-10-19 確認版權（[紀錄](./copyright-owner-attestation-2026-10-19.md)）。
- **風險**：擁有者聲明是**概括授權**，不等於每份材料都有個別授權證據；發行權一旦開啟即向學生顯示內容。
- **可選決策**：維持 12 份可發布；要求逐份授權證據後才開放其餘；永久不開放部分材料。
- **影響**：`copyright` 目前 WARN（12／36）。
- **需要誰批准**：擁有者／校方（版權）。
- **完成條件**：逐份權利紀錄或明確的概括授權範圍文件。
- **安全預設**：**未確認＝不發布**（fail-closed）。

## 9. Golden Dataset 的審核者

- **目前事實**：42 個 `pending-review` 候選、**0 approved fixture**；`golden_fixture_reviews` 表已建立（migration 0022）；核准 API 需要 `HISTORY_REVIEWER_EMAILS` 名單內的帳戶，名單未設定時 fail-closed（admin 亦不可）。
- **風險**：若用 admin 冒充學科教師，Golden 基準會失去意義；若一直沒有名單，評估永遠 `INSUFFICIENT_EVIDENCE`。
- **可選決策**：由科組指定 1–2 位歷史科教師加入 `HISTORY_REVIEWER_EMAILS`；或正式建立科目級角色資料表（較大工程）。
- **影響**：`golden-approval`／`golden-evaluation` 維持 INSUFFICIENT_EVIDENCE。
- **需要誰批准**：科主任／校長（教師資格與授權）。
- **完成條件**：名單或角色資料 + 至少一個真實教師核准的 fixture（含 category、reasoning、預期 grading）。
- **安全預設**：**0 approved**，不以測試資料或其他角色代替。

### 決策記錄（2026-10-19，負責人 `ipwh@pochiu.edu.hk`）

| 項目 | 決定 |
| --- | --- |
| 審核者名單 | `ipwh@pochiu.edu.hk`（單一） |
| 適用環境 | **只限本機**（`.env.local`，不提交版本控制）。staging／production 未設定，仍 fail closed |
| 日後增減責任人 | `ipwh@pochiu.edu.hk` |
| 雙人覆核 | **不需要**（現行設計允許單一授權審核者記錄裁決） |
| 撤銷方式 | 由 `.env.local` 移除或清空 `HISTORY_REVIEWER_EMAILS`，即回到「所有人核准一律 403」 |

已驗證（唯讀，未寫入任何資料庫）：名單解析為 `["ipwh@pochiu.edu.hk"]`；該帳戶（大小寫／空白 variations 亦同）回 `true`；同網域其他帳戶、未登入、空字串回 `false`；移除變數後連負責人亦回 `false`。涵蓋測試：`tests/authz-negative.test.ts`、`tests/golden-approval.test.ts`、`tests/servability-adjudication.test.ts`（171 passed）。

**未改變的事實**：`golden-approval` 仍為 `INSUFFICIENT_EVIDENCE`（0 approved／42 候選），`golden-evaluation` 仍為 `INSUFFICIENT_EVIDENCE`，`servability-adjudication` 仍為 `POLICY_PENDING`（0 題教師裁決）。設定名單**不會**自動核准任何 fixture，也沒有因此實際提交任何裁決。

**注意（職責分離）**：本機環境的同一個帳戶同時是平台管理員及歷史科審核者。核准權來自 `HISTORY_REVIEWER_EMAILS` 的**明確列名**，不是來自 admin 角色（admin 未列名時仍然被拒）。正式環境若不希望由管理員兼任學科審核者，需在該環境另設名單——這是尚未決定的項目。

## 10. 正式部署驗證

- **目前事實**：只在本機驗證（測試、typecheck、lint、build、暫存資料庫 E2E）；無 staging／production 證據、無 Cloud Run 併發或備份還原演練。
- **風險**：本機 build 成功不代表部署後登入、權限、健康檢查、備份可用。
- **可選決策**：建立 staging 驗收清單並指定負責人；或接受在首日觀察。
- **影響**：`deployment` 維持 INSUFFICIENT_EVIDENCE。
- **需要誰批准**：擁有者（部署授權）。
- **完成條件**：部署後登入／角色／派題／備份還原證據。
- **安全預設**：不部署、不改正式環境設定。

## 11. CLI 唯讀契約與 migration 責任（Sprint 13）

- **目前事實**：`golden:export -- --check` 原本會經 `getDb()` 自動套用 migration（Sprint 11 曾因此對本機開發資料庫套用 0022）。Sprint 13 已改為唯讀模式：不建檔、不 migration、不寫 DB；`--check` 亦不寫檔。migration 改為獨立命令 `npm run db:migrate -- --database <path>`。矩陣與退出碼見 [audit-cli-contract-2026-10-19.md](../audit-cli-contract-2026-10-19.md)。
- **風險**：若日後新增的 CLI 直接呼叫 `getDb()`，會再次帶來隱性 migration；`export-production-snapshot` 及 `pilot-deepseek` 尚未驗證。
- **可選決策**：
  1. 所有新 CLI 必須先宣告模式（唯讀／寫入），並在 PR 檢查 import 圖；
  2. 為寫入型 CLI 加上 `--apply`／`--database` 明確開關（現有多數已如此）；
  3. 在 CI 加一條「audit script 不得 import repositories」的靜態檢查。
- **影響**：不影響派題；影響「唯讀承諾」能否被證明。
- **需要誰批准**：技術負責人（工具契約）＋ 擁有者（是否加 CI 檢查）。
- **完成條件**：每個 CLI 都有測試或靜態證據；`UNVERIFIED` 項目清零。
- **安全預設**：未宣告的 CLI 視為**可能寫入**，不得在正式資料庫上執行。

## 12. SQLite WAL sidecar 的唯讀政策

- **目前事實**：Sprint 13 的唯讀 CLI 以 `readOnly: true` 開啟 WAL 模式的資料庫；主檔的 SHA-256、schema 及資料列不變（`tests/read-only-cli.test.ts`、`tests/read-only-sidecar.test.ts`），但 SQLite 可能在資料庫旁建立或更新 `-wal`／`-shm` sidecar（Sprint 13 實測：`app.db-shm` 32 KB、`app.db-wal` 0 bytes）。
- **風險**：若把「資料庫內容唯讀」誤當成「檔案系統完全唯讀」，在只讀掛載或受監控目錄上執行 CLI 會出現非預期檔案或告警。
- **兩種政策**：
  - **A. Database-content read-only**（目前實作）：不得改變 schema 或資料，允許 SQLite 建立必要 sidecar。
  - **B. Filesystem read-only**：連 sidecar 都不得建立（需要 `immutable=1` 或複本快照，可能要改連線方式及測試）。
- **可選決策**：接受 A 並在文件寫明；或要求 B（較大工程，且對「資料庫正被使用」的環境未必可行）。
- **影響**：不影響派題或 gate 判定；影響 CI／備份環境對「唯讀」的期待。
- **需要誰批准**：技術負責人＋擁有者（營運環境限制）。
- **完成條件**：政策寫入契約文件，測試按所選政策驗證（A 已驗證；B 未實作）。
- **安全預設**：只宣稱 A；文件與報告不得把 A 說成 B。

## 13. `export-production-snapshot`、`pilot-deepseek` 的驗證責任

- **目前事實**：兩者仍為 `UNVERIFIED`（前者需正式環境設定，後者需外部 LLM 憑證）；未在本機執行。
- **風險**：若日後以它們處理正式資料，副作用（寫檔／寫 DB／呼叫外部服務）未經驗證。
- **可選決策**：指定負責人在隔離環境驗證並補契約矩陣；或停用直至驗證完成。
- **影響**：不影響目前派題；影響「所有工具都有可測試契約」的完成度。
- **需要誰批准**：技術負責人。
- **完成條件**：兩者在隔離環境完成一次實測並記錄於契約文件。
- **安全預設**：未驗證前不得在正式資料庫執行（契約文件已標 `UNVERIFIED`）。

---

## 相關文件

- [Sprint 12 報告](../sprint-12-report-2026-10-19.md)
- [發布閘門報告](../release-gate-2026-10-19.md)
- [教師覆核流程](./README.md)
