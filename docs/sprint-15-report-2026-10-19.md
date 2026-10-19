# Sprint 15 報告：人類裁決工作流程與發布阻礙收斂

日期：2026-10-19
起始 HEAD：`6895db9`（`main`，`origin/main` 相同）→ 結束 HEAD 不變
整體發布狀態：**NOT READY**（維持；本 Sprint 不以此為成功條件）

> 標記：**【實測】**／**【靜態】**／**【未驗證】**／**【需決策】**

---

## 1. Git 狀態

| 項目 | 起始【實測】 | 結束【實測】 |
| --- | --- | --- |
| Branch | `main` | `main` |
| HEAD／`origin/main` | `6895db9` / `6895db9` | `6895db9` / `6895db9` |
| 未提交 | **80（24 modified + 56 untracked）** | **84（24 modified + 60 untracked）** |

起始與 Sprint 14 報告一致。Sprint 15 新增 4 個檔案（manifest CLI、manifest JSON＋MD、本報告）；`package.json`（已在 modified 清單）加入 1 個 script。**沒有修改任何題目、答案、審核記錄或既有 gate 邏輯**。

### 1.1 變更檔案清單（區分繼承 vs 本 Sprint）

**繼承自 Sprint 9–14（80 項，全部保留）**：`src/server/quality/*`、`src/server/services/{question-service,servability-adjudication,golden-approval,practice-service,source-visibility}.ts`、`src/server/db/connection.ts`、`src/server/repositories/*`、`scripts/audit-*.ts`、`scripts/golden-*.ts`、`scripts/export-golden-fixtures.ts`、`scripts/db-migrate.ts`、`tests/*`、`docs/quality/*`、`docs/sprint-10..14-report-*.md`、`docs/teacher-review/*`、`README.md`、`.env.example` 等。

**Sprint 15 新增**

| 檔案 | 用途 |
| --- | --- |
| `scripts/audit-review-priority-manifest.ts` | 623 題覆核優先次序 manifest（證據契約、P1／P3 清單、重疊標示） |
| `docs/quality/review-priority-manifest-2026-10-19.{json,md}` | 產出（唯讀報告） |
| `docs/sprint-15-report-2026-10-19.md` | 本報告 |

**Sprint 15 修改**

| 檔案 | 改動 |
| --- | --- |
| `src/server/services/golden-approval.ts` | 重複提交冪等（同版本／指紋／決定／理由回 `created:false`） |
| `src/app/api/teacher/golden/[questionId]/route.ts` | 回應加入 `created` |
| `tests/golden-approval.test.ts` | 新增冪等測試（9 項） |
| `tests/read-only-sidecar.test.ts` | 新增 manifest 唯讀與計數一致性測試（6 項） |
| `package.json` | `audit:review-manifest` |
| `docs/teacher-review/policy-decisions-2026-10-19.md` | 頂部 13 項決策包總覽 |
| `docs/audit-cli-contract-2026-10-19.md`、`README.md`、`docs/teacher-review/README.md`、`docs/audit-2026-10-18-platform-audit.md`、`docs/release-evidence-2026-10-19.json` | 同步 |

---

## 2. 基線重新核實【實測】

| 項目 | 本次實際值 | 來源 |
| --- | --- | --- |
| 題目總數／已發布 | 1,880／1,880 | `audit:content` |
| 不可作答（已發布） | **97**（96 Roman、1 答案外洩） | `audit:servability` |
| 96 題原文核對 | 81 標示不齊全、10 陳述不一致、4 缺檔、1 無法定位、**0 可自動補** | `audit:servability-evidence` |
| 覆核證據（目前版本） | 16 教師裁決／1,241 擁有者批次／623 只有自動修復 | `audit:review-provenance` |
| Provenance 風險 | P0 0／P1 530／P2 0／P3 93 | `audit:provenance-risk` |
| 來源 | 877 traceable／1,003 pending | `audit:content` |
| 解釋／技能 | 1,334 佔位＋546 只列答案／1,880 技能空白 | `audit:content` |
| Golden | 42 候選／0 approved／0 stale | `audit:golden-readiness`、`golden:export --check` |
| 決策清單 | 13 項，全部仍待決 | policy-decisions |
| Release gate | **NOT READY**（15 項） | `release:gate` |

Sprint 14 的報告全部是**未提交的新增檔案**（untracked），已保留，沒有被覆蓋。

---

## 3. 人類裁決工作流程

### 3.1 已具備（API／service，皆經測試）【實測＋靜態】

| 要求 | 現況 |
| --- | --- |
| 明確授權的歷史科審核者 | `HISTORY_REVIEWER_EMAILS`；admin 不足（Golden 全部裁決＋`approve_after_verified_repair`） |
| 名單缺失／無效 → 阻止核准 | 是（403；測試證明） |
| 不預填核准 | 是（API 需明確 `decision`；UI 無裁決表單可預填） |
| 版本／指紋綁定 | 是（`expectedRevision`，衝突 409） |
| 歷史記錄只新增 | 是（`question_reviews` 只 insert；Golden 亦然） |
| 非核准決定不會令題目可見 | 是（returned/rejected → draft；quarantine 設旗標） |
| 未經核准仍不可作答 | 是（`checkQuestionServable` 於核准及發布／派發／快照作答） |
| 不推測答案／史實 | 是（工作清單只建議；沒有自動改寫） |

### 3.2 尚未完成（如實）【靜態＋需決策】

- **教師端 UI 沒有 servability 裁決介面，也沒有 Golden 核准表單**。現階段裁決只能經
  `POST /api/teacher/questions/[id]/servability` 及 `POST /api/teacher/golden/[questionId]`（教師本人以授權電郵登入）。
  因此本報告**不宣稱人類裁決工作流程已完成**；這是明確待辦（需前端工作及 UI 測試）。
- `HISTORY_REVIEWER_EMAILS` 未設定 → 即使有 UI 也不能核准。

### 3.3 Sprint 15 修正的具體缺陷

| 缺陷 | 影響 | 修正 |
| --- | --- | --- |
| Golden 重複提交每次都新增裁決列 | 同一決定可能出現多筆看似「多次核准」的紀錄 | 同版本／指紋／決定／理由回 `created:false`，不新增；理由不同仍另立一筆（測試覆蓋） |

---

## 4. 97 題裁決工作清單（重新產生）【實測】

`npm run audit:adjudication-worklist` → [adjudication-worklist-2026-10-19.md](quality/adjudication-worklist-2026-10-19.md)

| 分類 | 題數 |
| --- | --- |
| 原卷可核對、Roman 標示不齊全 | **81** |
| 原卷存在但題目／選項陳述不一致 | **10** |
| 原卷缺失 | **4** |
| 原文段落無法定位 | **1** |
| **可自動補標示** | **0** |
| 答案外洩（`qb-JTH2ndEdFBQ09015`） | **1** |
| 全部標示「必須維持隔離」 | 97 |

每題的建議下一步均由證據狀態決定（缺檔→取得掃描或永久不派發；不一致→按原卷核對；標示不齊→教師按原卷補回或退回）。沒有重建 i／ii／iii、沒有推測省略句、沒有改答案。

`qb-JTH2ndEdFBQ09015`：原文與 Sprint 9 裁決歷史保留，仍在隔離，0 次作答。

---

## 5. 623 × 1,003 覆核優先次序 manifest【實測】

`npm run audit:review-manifest` → [review-priority-manifest-2026-10-19.md](quality/review-priority-manifest-2026-10-19.md)

| 指標 | 數量 |
| --- | --- |
| 題目（唯一）／重複列 | **623／0** |
| P1／P3 | **530／93** |
| 來源狀態 | traceable 499、pending_verification 124 |
| **與來源待核實重疊** | **124**（P1 31、P3 93）— 不另計為獨立組別 |
| 目前不可作答 | 21 |
| 已有教師逐題裁決 | **0** |

每題附證據契約：revision／fingerprint、修復分類與依據、來源狀態與缺失證據、需要核對的
`answer／acceptedAnswers／blankPositions／gradingPoints／gradingSemantics`、必要角色
（`history_reviewer`）、必要決定、目前可作答狀態。

- **P1（530）核對清單**：空格數量與位置、考核哪個空格、答案與空格映射／次序、可接受答案及正規化、grading points、前後端評分一致性、修復前後 fingerprint。
- **P3（93）核對清單**：題幹／選項／答案未變，只移除選項開頭殘留符號。**P3 只代表排序較後，不代表核准**。
- **抽樣 ≠ 逐題**：manifest 沒有把任何題目標記為已覆核；`changedFields.options` 等未保存的維度以 `null` 表示，如實反映證據限制。

---

## 6. Golden Dataset 準備度【實測】

`npm run audit:golden-readiness` → [golden-readiness-2026-10-19.md](teacher-review/golden-readiness-2026-10-19.md)

| 指標 | 數量 |
| --- | --- |
| 候選／approved／pending／stale | 42／**0**／42／0 |
| 版本＋指紋與候選一致 | 42 |
| 有來源且答案完整（可交教師審核） | 42 |
| 仍缺（必須教師提供） | 預期 grading、審核理由／類別、錯誤選項說明 |
| `HISTORY_REVIEWER_EMAILS` | **未設定**（核准 403） |
| `golden:eval` | `INSUFFICIENT_EVIDENCE` |

新增測試證明：未授權（admin）403、名單未設定 403、缺 fixture 內容 400、版本衝突 409、重複提交不新增、題目改動後 stale 且不匯出。**沒有建立任何假核准或測試身分的 production-like 證據**。

---

## 7. 政策決策包

[policy-decisions-2026-10-19.md](teacher-review/policy-decisions-2026-10-19.md) 頂部新增一頁總覽：13 項、每項含「決定、負責角色、影響閘門、未決安全預設、完成證據」。
**所有負責角色目前為 `UNASSIGNED`**（沒有虛構人名）；優先次序：
1. 歷史科審核者指派（`HISTORY_REVIEWER_EMAILS`）
2. 36 份材料版權（擁有者聲明 vs 逐份授權）
3. WAL sidecar 政策（A 已實作／B 未實作）
4. SQLite 部署拓撲與多執行個體
5. `export-production-snapshot`、`pilot-deepseek` 驗證責任
6. 其餘（96 題、Golden 教師安排、解釋／技能／來源政策、部署驗收）

沒有任何決定被假設為已完成。

---

## 8. Release gate 執行與阻礙【實測】

`npm run release:gate` → **NOT READY**（15 項）：

| 狀態 | 閘門 |
| --- | --- |
| PASS (4) | question-isolation、answer-provenance、teacher-decisions、tests（23 條命令） |
| **FAIL (1)** | question-servability 97/1880 |
| POLICY_PENDING (6) | source-traceability（877）、explanation-quality（1,334＋546）、metadata（1,880）、review-provenance（623）、servability-adjudication（97）、provenance-risk（530） |
| WARN (1) | copyright 12/36 |
| INSUFFICIENT_EVIDENCE (3) | golden-evaluation、golden-approval、deployment |

- `tests` PASS 只代表軟件檢查通過，**不**代表內容正確、版權、教師覆核或部署就緒（其他閘門仍 FAIL／PENDING）。
- 97 題在所有學生派題路徑仍被攔截（`tests/teacher-adjudication.test.ts`、`tests/release-controls.test.ts`）；舊快照未作答題目被隔離後回 409；批次候選排除；TOCTOU 條件更新仍在。
- 沒有新增未受測試保護的繞過。

---

## 9. 執行命令與結果【實測】

| 命令 | 退出碼 | 結果 |
| --- | --- | --- |
| `npm test` | 0 | **90 檔；1,217 通過、4 略過（1,221）** |
| `npm run typecheck` | 0 | 通過 |
| `npm run lint` | 0 | 通過（0 warning） |
| `npm run build` | 0 | 通過（先清 `.next`） |
| `npm run audit:content` | 0 | 1,880 題；來源 877／1,003 |
| `npm run audit:servability` | 0 | 97 題 |
| `npm run audit:servability-evidence` | 0 | 96 題；0 可自動補 |
| `npm run audit:review-provenance` | 0 | 16／1,241／623 |
| `npm run audit:repair-provenance` | 0 | 877／987／14 |
| `npm run audit:provenance-risk` | 0 | P0 0／P1 530／P2 0／P3 93 |
| `npm run audit:adjudication-worklist` | 0 | 97 題（81／10／4／1） |
| `npm run audit:source-crosswalk` | 0 | 重疊 124；需先補來源 31 |
| `npm run audit:golden-readiness` | 0 | 42／0／42 |
| `npm run audit:review-manifest` | 0 | 623 唯一、重疊 124、P1 530／P3 93（新增） |
| `npm run golden:candidates` | 0 | 42 候選 |
| `npx tsx scripts/export-golden-fixtures.ts --check` | 0 | 0 approved、無寫入 |
| `npm run golden:eval` | 0 | `INSUFFICIENT_EVIDENCE` |
| `npm run release:gate` | 0 | **NOT READY** |
| `node scripts/e2e-flow.mjs --start`（Sprint 15：暫存 DB + 複製 `data/uploads`） | 0 | **128 通過／0 失敗**（本次實測） |
| `tests/golden-approval.test.ts` | 0 | 9 通過 |
| `tests/read-only-sidecar.test.ts` | 0 | 6 通過 |

E2E 範圍：學生流程、後台教材／OCR、回報、教師覆核、練習記錄；**不覆蓋**教師 servability 裁決 UI（不存在）及 Golden UI（不存在）。

---

## 10. 未驗證項目【未驗證】

1. `export-production-snapshot`、`pilot-deepseek`（需正式環境／外部憑證）。
2. 政策 B（filesystem read-only）未實作。
3. CI（repo 無 `.github/`）、多執行個體 SQLite。
4. 人類裁決與 Golden 核准的 **UI** 流程（只有 API）。
5. 530 題 grading 語義的逐題確認（只有重建後「考核答案不變」證據）。

---

## 11. 需要教師／科組／負責人決定【需決策】

13 項（見 §7）。其中直接阻塞發布：歷史科審核者指派、Golden 教師安排、96 題處置、`qb-JTH2ndEdFBQ09015`、P1／P3 覆核政策、來源核實、解釋／技能標準、版權、部署驗收。

---

## 12. 資料庫、部署與版本控制聲明

- **沒有修改任何資料庫內容**：全部工具以 `readOnly`／`openReadOnlyDatabase()` 開啟；測試用 `%TEMP%` 隔離資料庫並比對雜湊、schema、migration、列數。
- **沒有執行 migration**（`db:migrate` 未執行）。
- **沒有部署、沒有 commit、沒有 push**（HEAD／`origin/main` 仍 `6895db9`）。
- 沒有呼叫付費 AI API（E2E 用 `LLM_PROVIDER=mock`；沒有真實教師身分被建立）。
- 原有 80 項未提交成果完整保留；結束時共 **84 項（24 modified + 60 untracked）**。
