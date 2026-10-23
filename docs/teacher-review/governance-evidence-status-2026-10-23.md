# 內容治理證據狀態（2026-10-23 稽核）

本文件是**稽核結果摘要**，不是教師決定，也不是內容正確性或版權的證據。

---

## 1. 如何重跑

```bash
npx tsx scripts/audit-governance-evidence.ts                 # 終端摘要（唯讀）
npx tsx scripts/audit-governance-evidence.ts --json          # 機器可讀摘要
npx tsx scripts/audit-governance-evidence.ts --out <dir>     # 另存完整清單（md + json）
```

工具只以 `readOnly: true` 開啟資料庫，不寫入任何題目、覆核、診斷或發布狀態，
亦不會產生教師決定。完整清單（1,438 題的逐一表格）刻意**不納入版本控制**，
以免與資料庫現況脫節；需要時即時產生。

---

## 2. 判定的定義

已發布題目要通過發布關卡，必須有**現行 revision** 的其中一項：

| 證據 | 意思 | 是否等於教師批准 |
| --- | --- | --- |
| `question_reviews` 的 `approved`（`revision` = 目前版本） | 教師（或授權覆核者）確認過**這一版** | 是（人的決定） |
| `auto_validated_revision` = 目前版本 | 機器品質驗證通過（教材依據、答案一致、結構可作答） | **否**（不是史實核對） |

因此本文件把「有現行版本 approved 覆核」與「只有自動驗證」嚴格分開，
並把「兩者都沒有」與「只有舊 revision 的批准」列為**證據缺口**。

**證據缺口不代表內容錯誤或侵權**，只代表沒有可追溯的目前版本證據。

---

## 3. 2026-10-23 本機快照結果（與同日 08:00Z 正式備份快照一致）

| 分類 | 數量 |
| --- | --- |
| 題目總數 | 3,247 |
| 已發布 | 3,205 |
| 草稿 | 42 |
| `teacher_confirmation_required = 1` | 42 |
| 覆核紀錄列數 | 3,234（`approved` 3,230） |

已發布題目的現行版本證據：

| 狀態 | 數量 | 佔已發布 |
| --- | --- | --- |
| `auto-validated-at-current-revision` | 1,250 | 39.0% |
| `approved-at-current-revision` | 517 | 16.1% |
| `stale-approval-only`（只有舊 revision 批准） | 1,372 | 42.8% |
| `no-current-evidence` | 66 | 2.1% |
| **合計證據缺口** | **1,438** | **44.9%** |

按來源：

| 來源 | 缺口 | 狀態 |
| --- | --- | --- |
| `school-paper` | 1,372 | 全部 `stale-approval-only` |
| `material-ai` | 34 | 全部 `no-current-evidence` |
| `demo` | 32 | 全部 `no-current-evidence` |

來源追溯（已發布題目）：沒有教材段落 ID **1,384**、沒有來源節錄 **0**、
`source_verified = 0` **1,381**。

---

## 4. 兩題 P1（`q_2753d4272a1b4291`、`q_6e575d744fa24f5a`）

本機快照與正式備份（2026-10-23T08:00:22Z）**一致**：

| 項目 | 值 |
| --- | --- |
| `status` | `published` |
| `revision` | 2 |
| `auto_validated_revision` | 1（**不是**目前版本） |
| `teacher_confirmation_required` | 0 |
| `question_reviews` | **0 列** |
| `question_mutations` | 0 列（正式環境無此表，見 §6） |

**判定：`VERIFIED OPEN`。** 兩題沒有任何教師覆核紀錄，也沒有現行版本的自動驗證。
依政策不得自動批准、不得補寫覆核紀錄；處理方式只有：

1. 由歷史科教師在「教師審核」對**目前版本**作出覆核決定；或
2. 教師修正內容（`revision` 會遞增）後重新覆核；或
3. 若暫時不宜供學生使用，教師把狀態改為 `draft`（既有安全流程，需教師操作）。

---

## 5. 42 題待教師確認

全部 42 題：`status = draft`、`teacher_confirmation_required = 1`、
`question_reviews` **0 列**、`question_content_flags` **0 列**、`question_mutations` **0 列**。

即：**沒有任何教師決策紀錄**，負責人所說的「已完成覆核」並未反映在這批題目上。

主要原因分類（每題可能有多項，此處為首項警告的分類計數近似值）：

| 原因類別 | 出現次數 |
| --- | --- |
| 解釋使用「唯一」等排他寫法，但教材未明確比較 | 12 |
| 題目／答案以「因此」連結因果，但教材未交代該因果 | 11 |
| 干擾項含教材未交代的名稱 | 4 |
| 題目／答案以「因為」連結因果 | 4 |
| 題目要求「比較」，但教材沒有提供比較依據 | 3 |
| 解釋使用「首先」等排序寫法 | 3 |
| 標準答案未被教材逐字支持 | 7 |
| AI 節錄非原文（系統已改用原文句子） | 2 |
| 填充題答案未符合歷史元素要求 | 2 |

處理方式：教師逐題在「教師審核」工作台確認（可用 `npm run resolve:teacher-confirmation`
的逐題理由檔流程，但**必須由教師提供理由**，不可自行生成）。

---

## 6. 正式環境狀態（同日備份快照，唯讀）

證據來源：`gs://pccss-ai-history-history-backup/history/data/app.db`，
物件時間 **2026-10-23T08:00:22Z**，25,051,136 bytes，下載後以 `readOnly` 開啟。

| 項目 | 結果 |
| --- | --- |
| 已套用 migration（最後四項） | `0025`、`0026`、`0027`、`0028` |
| `0029-question-mutations` | **未套用**（`question_mutations` 表不存在） |
| `0030-question-quality-findings` | 未套用（預期） |
| 題目／已發布／待確認 | 與本機一致；證據缺口同為 1,438（1,372 / 34 / 32） |
| 兩題 P1 | 與本機一致（published、revision 2、0 覆核） |

**部署含義**：目前程式碼在啟動時會自動執行 `runMigrations`（見
[src/server/db/connection.ts](../src/server/db/connection.ts)），因此部署後
正式環境會自動套用 `0029` 與 `0030`。這不是「可選」步驟，而是部署的一部分；
回滾必須依靠部署前備份物件（bucket 內另有 `app.db.pre-*` 系列）。

---

## 7. 候選版本與部署閘門（Sprint 26 記錄）

| 項目 | 狀態 |
| --- | --- |
| 候選版本 commit | `4c893f91251381d4d0ed82795d02ed2f3523fa47`（`chore(release): Sprints 20-26 release candidate`） |
| Push | 已推送到 `origin/main`（`354c36f..4c893f9`） |
| 遠端 CI（run #48，`CI` workflow） | **success** — job「Test, typecheck, lint, build」在 `ubuntu-latest` 乾淨 checkout 上完成 `npm ci`、測試、typecheck、lint、build 及 `verify:build` |
| Playwright job | **skipped**（需要 self-hosted runner 與內容資料庫；本機已另行執行 40 passed） |
| `npm run release:gate` | **NOT READY**：`question-isolation` FAIL（42 題待確認）、`review-provenance` FAIL、`source-traceability`／`metadata`／`provenance-risk` POLICY_PENDING、`copyright` WARN、`golden-evaluation` INSUFFICIENT_EVIDENCE |
| 正式環境 migration | 備份快照顯示只到 `0028`；`0029`、`0030` **未套用** |
| 部署 | **未執行**（內容、版權、覆核 gate 仍開啟） |

### 部署會發生甚麼（由程式碼確認）

1. 容器啟動 → `src/instrumentation.ts` 的 `restoreOnStartup()` 由 GCS 下載 `history/data/app.db`（目前 schema `0028`）；
2. 第一個請求 → `getDb()` → `runMigrations()` **自動套用 `0029` 與 `0030`**（見
   [src/server/db/connection.ts](../src/server/db/connection.ts) 第 72 行）。

即：部署**必然**會改動正式環境 schema，不是可選步驟。兩支 migration 都只是
`CREATE TABLE`／`CREATE INDEX`（新增、不改既有表），因此舊版本程式碼可以忽略新表，
image 回滾在 schema 層面安全；若要回到舊 schema，需還原 bucket 內的
`app.db.pre-*` 物件。

### 部署前仍缺的證據

- 42 題待教師確認（41 題 + 1 題 golden 候選相關）未解決；
- 1,438 題缺現行版本證據；
- 版權 gate 為 WARN（22／46 份教材獲准向學生發布）；
- `review-provenance` FAIL；
- 部署前備份物件未建立（bucket 內最新 `app.db` 為執行期自動上載，需在部署前另存
  `app.db.pre-deploy-<timestamp>` 作為回滾點）；
- iPad 第 8 代實機驗收未完成。

## 8. 建議的補齊方式（依來源）
| 來源 | 建議 | 為何不可自動化 |
| --- | --- | --- |
| `school-paper`（1,372） | 這些題目有**舊 revision** 的教師批准。需要教師決定：現行版本的改動是否屬「不影響學生作答」的技術性修正。若屬，應以**批次教師決策**記錄（範圍、依據、排除條件、負責人、適用版本），並由教師在介面逐批確認 | 批次決策必須由教師發出；系統不可代為決定哪些改動「無關痛癢」 |
| `material-ai`（34） | 逐一覆核，或先修正內容再重新驗證 | 自動驗證不等於教師批准 |
| `demo`（32） | 示範題可考慮停用或標示為示範（不影響自學內容） | 需要產品決定，不可自行下架 |
| 42 題待確認 | 教師逐題確認，理由必須由教師提供 | 不可虛構理由 |
| 來源追溯 1,384 題無段落 ID | 需要教材與題目的對應證據；匯入時的原卷來源需由教師／管理層提供 | 無資料可推導 |

---

## 9. 這些結果**不是**甚麼

- 不是內容錯誤的證明，也不是侵權的證明；
- 不是教師批准的替代品；
- 不是「測試通過」的延伸（工程測試與內容治理是兩條獨立的閘門）。
