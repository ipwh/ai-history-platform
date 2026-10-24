# Sprint 27 — 歷史科教師主導的史實核查、內容治理補救與發布閘門重新評估

**日期**：2026-10-23
**角色**：香港中學歷史科教師／史實核查員／題目品質審核員／內容治理稽核員
**基準**：`main` = `origin/main` = `8e24b9183e487c796f218f78a1a349c0ed930e04`
**Sprint 26 判定**：`NOT READY`（本 Sprint 重新核實，不沿用數字）

> 本 Sprint **沒有** commit／push／部署／修改正式資料庫／呼叫付費 AI API／建立任何教師
> 批准紀錄。所有改動只在本機工作區。

---

## 1. 整體判定：**NOT READY**

| 面向 | 判定 |
| --- | --- |
| 史實正確性 | 兩題 P1：1 題**已確認部分錯誤**（太平洋戰爭年份），1 題**成立**但教材依據不足 |
| 教材來源追溯 | 1,384 題無段落 ID；42 題中 17 題所引段落已失效（`NOT VERIFIED`→已定位問題） |
| 版權與發布權利 | 24／46 份教材**未核實**，而 1,372 題衍生自其中 → `VERIFIED OPEN` |
| 教師覆核 | 517 題現行版本已覆核；1,372 題只有舊版批准（**內容已改動**）；66 題無任何證據 |
| 程式及權限 | 權限邊界**符合文件政策**（見 §7）；已補 2 個唯讀稽核工具；無新缺陷 |
| Release gates | 2 FAIL、3 POLICY_PENDING、1 WARN、1 INSUFFICIENT_EVIDENCE（見 §8） |
| 部署 | **禁止**（見 §10） |

**測試全部通過不等於 release gate 通過**：`release:gate` 的實際判定是 `NOT READY`。

---

## 2. 核實範圍與方法

| 項目 | 方法 | 資料 |
| --- | --- | --- |
| Git／CI | `git rev-parse`、`git status`、GitHub Actions run 48／49 | 見 §9 |
| 兩題 P1 | 讀取 `questions` 全文、`question_reviews`、`question_mutations`、所引 `material_blocks` 原文 | 本機快照 ＋ 同日正式備份 |
| 42 題待確認 | 逐題讀取題幹／選項／答案／解釋／所引 block／警告，並以規則標籤 | 同上 |
| 1,438 題缺口 | `questionFingerprint` 比對覆核指紋；交叉核對 `question_content_flags` | 新工具 `audit-approval-drift` |
| 教材版權 | `material_documents` 的 `student_distribution`／`rights_confirmed_*`／`content_reviewed_*` | 同上 |
| 史實（外部） | 美國國家檔案館、HISTORY.com、中國外交部、Wikipedia（兩來源交叉） | 連結見 P1 報告 |

---

## 3. 兩題 P1：核查結果

完整報告：[sprint-27-p1-fact-check-2026-10-23.md](./teacher-review/sprint-27-p1-fact-check-2026-10-23.md)

### `q_2753d4272a1b4291`（二戰時序，`published`，rev 2，0 覆核）

| 項目 | 結果 |
| --- | --- |
| 排序本身（相對指定教材） | ✅ 與教材 4.2 表格一致 |
| 「美、日展開太平洋戰爭」＝1942 年 | ❌ **不成立**（太平洋戰爭始於 1941-12-07 珍珠港；美國 1941-12-08 宣戰） |
| 教材層面 | 該表格本身有誤；平台另一課題（hs-topic-3）教材寫「1941 珍珠港觸發太平洋戰爭」→ **平台內部矛盾** |
| 題目建構 | 題幹列出的事件多於選項實際排序者（漏「德國敗走蘇聯」「原子彈」「日本投降」） |
| 判定 | **已確認部分錯誤（史實）＋ `CORRECTION_PROPOSED`（建構）** |

### `q_6e575d744fa24f5a`（改革開放時序，`published`，rev 2，0 覆核）

| 項目 | 結果 |
| --- | --- |
| 1977 恢復高考 → 1978 承包制 → 1980 加入世銀／IMF | ✅ **成立**（中國 1980-04-17 恢復 IMF 席位、1980-04-16 世界銀行代表權轉移） |
| 教材支持 | ❌ **不足**：所引段落只寫 1977；1978 在**另一段落**；1980 在該課題**完全沒有提及** |
| 判定 | **史實成立、`SOURCE_EVIDENCE_MISSING`（部分）** |

**兩題共同**：`auto_validated_revision = 1 ≠ revision 2`、`question_reviews` 0 列 →
**沒有任何教師對現行版本的決定**。本 Sprint 未自動批准、未補寫紀錄、未改狀態。

---

## 4. 42 題待教師確認

完整清單（含逐題標籤與原因）：[sprint-27-held-42-2026-10-23.md](./teacher-review/sprint-27-held-42-2026-10-23.md)

| 標籤 | 題數 |
| --- | --- |
| `AMBIGUOUS_OR_UNDERSUPPORTED` | 21 |
| `SOURCE_EVIDENCE_MISSING` | 17 |
| `TEACHER_DECISION_REQUIRED` | 2 |
| `CORRECTION_PROPOSED` | 1 |
| `FACTUALLY_SUPPORTED` | 1 |

**新發現（Sprint 27）**：42 題中有 **17 題**引用的 `blockId` 已不存在於 `material_blocks`
（教材重新匯入後失效）→ 教師目前**無法**在介面核對這些題目的教材依據。
另有 1 題（`q_0c14fa5e41e64d0d`）在題幹直接列出三個年份再要求排序，屬與 Sprint 20
同類的「年份已在題幹」缺陷。

42 題全部仍為 `draft`，**不影響學生**；但阻塞 `question-isolation` gate。

---

## 5. 1,438 題證據缺口：重新盤點

完整報告：[sprint-27-evidence-gaps-2026-10-23.md](./teacher-review/sprint-27-evidence-gaps-2026-10-23.md)

| 分類 | 數量 | 佔已發布 3,205 |
| --- | --- | --- |
| 現行版本有教師批准 | 517 | 16.1% |
| 只有現行版本自動驗證（非教師批准） | 1,250 | 39.0% |
| 只有舊版本批准（`stale-approval-only`） | 1,372 | 42.8% |
| 完全沒有現行版本證據 | 66 | 2.1% |

**決定性取證（`npm run audit:approval-drift`）**：

| 比對 | 題數 |
| --- | --- |
| 現行內容指紋與最後一次批准**相同** | **0** |
| 現行內容**已改動** | **1,372** |
| └ 其中同時帶 `explanation_rewritten` 旗標 | 1,281 |
| └ 未能以此解釋（須逐題查明） | 91 |

即：**「舊批准仍然有效」的說法在事實層面不成立**——沒有任何一題的內容仍與批准時相同。
已另排除「只改分節」的解釋（以 135 個歷史分節 ID 重算，0 題吻合）。

---

## 6. 首次批准的角色與性質（影響政策）

| 覆核理由 | 列數 |
| --- | --- |
| 「擁有者指示：本 session 上載的校內題庫題目一律覆核通過並發布」 | 1,877 |
| 「模擬學生使用後自動修復：只把多餘空格的答案填入題幹／移除排版」 | 712 |
| 「自動修復多空格填充題…」 | 548 |
| 其他（含 13 列「教師裁決（自動修復改變考核答案）」） | 約 93 |

`reviewer_role = admin`。即這 1,372 題的歷史批准屬**擁有者批次發布**與**自動修復後的紀錄**，
不是歷史科教師逐題裁決。政策草案：[sprint-27-batch-approval-policy-draft.md](./teacher-review/sprint-27-batch-approval-policy-draft.md)
（`POLICY DECISION REQUIRED`，**未執行**）。

---

## 7. 程式及權限完整性

### 7.1 已核實（`VERIFIED`）

| 檢查 | 結果 |
| --- | --- |
| 覆核 API 需登入且為教師／管理員（`requireTeacher`） | ✅ |
| `expectedRevision` 為必填樂觀鎖；版本不符回 409，不會把舊批准套到新版本 | ✅ `question-service.ts:662-668` |
| 覆核紀錄綁定 question ID／revision／fingerprint／reviewer／reason／時間 | ✅ `question_reviews` 結構 |
| 舊 revision 批准**不會**被當成現行版本批准 | ✅ `findApprovedReview(id, revision, fingerprint)` 三者同時比對 |
| 學科授權（`HISTORY_REVIEWER_EMAILS`）只約束 Golden fixture 及「已修復並核准」 | ✅ 與 `docs/teacher-review/README.md` §12.1 一致；一般覆核只需 teacher／admin（文件政策，非缺陷） |
| 待教師確認的題目不可被批次發布／批次覆核繞過 | ✅ `listOwnerPublicationCandidates`／`listOwnerApprovalCandidates` 排除 `teacher_confirmation_required` |
| 學生端不接收 `qualityWarnings`／`correctAnswer`／`explanation` | ✅ 既有測試 |

### 7.2 本 Sprint 的程式改動（全部唯讀工具，無產品行為改動）

| 檔案 | 改動 | 目的 |
| --- | --- | --- |
| `scripts/audit-governance-evidence.ts` | 新增 `contentMatchesApproved`（指紋比對）與 `staleApprovalBreakdown` 統計 | 讓「舊批准 vs 現行內容」可核查 |
| `scripts/audit-approval-drift.ts`（新） | 5 分類 ＋ 與 `explanation_rewritten` 交叉比對 | 回答「內容是否真的改動」 |
| `tests/governance-evidence.test.ts` | 新增指紋比對測試（相同／不同／無紀錄三種） | 鎖定分類語意 |
| `package.json` | 新增 `audit:approval-drift` script | 可重現命令 |
| `docs/teacher-review/sprint-27-*.md`（5 份） | 本 Sprint 交付文件 | 教師可用清單 |

**未改動**：任何題目、答案、解釋、狀態、`question_reviews`、`question_content_flags`、
`question_mutations`、資料庫 schema、migration、部署設定、權限、發布政策。

### 7.3 剩餘風險（`POLICY DECISION REQUIRED`）

`questionFingerprint` **包含 `sectionId`**，但 `moveQuestionToSection` 刻意不遞增 revision
（註解說明分節屬分類而非內容）。兩者不一致：一旦分節重整，指紋改變 → 既有覆核在
`findApprovedReview` 眼中失效，而 revision 沒有改變，介面不會顯示「需要重新覆核」。

- 本 Sprint **沒有**修改：改動指紋定義會令現有 3,230 列覆核全部失效（風險更大）。
- 建議方案（待決定）：新增一個「僅內容」指紋（不含 sectionId／skill），新覆核一律同時寫入，
  舊資料以一次性遷移補算；遷移需獨立 Sprint 及回滾方案。

---

## 8. Release gates（`npm run release:gate`，實際輸出）

**整體判定：`NOT READY`（退出碼 0，但 verdict 為 NOT READY）**

| Gate | 結果 | 數字 |
| --- | --- | --- |
| `question-isolation` | **FAIL** | 42 題仍待教師確認（42／3,247） |
| `question-servability` | PASS | 0／3,205 不可作答 |
| `answer-provenance` | PASS | 18 題已裁決改寫，無未決 |
| `source-traceability` | **POLICY_PENDING** | 可定位 1,559／3,247；待核實 1,688 |
| `explanation-quality` | PASS | 0／3,247 |
| `metadata` | **POLICY_PENDING** | 技能空白 1,915 |
| `teacher-decisions` | PASS | 0 待目前版本覆核（註：其定義與 §5 的 1,438 缺口不同，不可互相取代） |
| `review-provenance` | **FAIL** | 完全沒有證據 3,247（0／3,247） |
| `copyright` | **WARN** | 可向學生發布 22／46；逐份權利紀錄 22 份 |
| `golden-evaluation` | **INSUFFICIENT_EVIDENCE** | 資料集為空（0／0）——不是零錯誤 |
| `servability-adjudication` | PASS | 0 不可作答 |
| `provenance-risk` | **POLICY_PENDING** | P1 530、P3 93 |
| `golden-approval` | PASS | 1／42 已核准；41 待教師 |
| `tests` | PASS | — |
| `deployment` | PASS | 已提供正式環境證據 |

## 9. 測試與 Git 狀態

| 命令 | 退出碼 | 結果 |
| --- | --- | --- |
| `npm test` | 0 | 125 檔、**1,522 passed**、4 skipped |
| `npm run typecheck` | 0 | 無錯誤 |
| `npm run lint` | 0 | 0 error、1 warning（`scripts/verify-questionbank-sync.ts` `fs` 未使用，既有） |
| `npm run build` | 0 | 成功 |
| `npm run verify:build` | 0 | 「沒有頁面被預先渲染」 |
| `npm run test:ui`（Chromium＋WebKit） | 0 | **58 passed、0 failed、0 skipped** |
| `npm run audit:governance-evidence` | 0 | 見 §5 |
| `npm run audit:approval-drift` | 0 | 見 §5 |
| `npm run release:gate` | 0（verdict NOT READY） | 見 §8 |

**Git**

| 項目 | 值 |
| --- | --- |
| 開始 | `main` = `8e24b91`，工作區乾淨 |
| 結束 | 同上 HEAD；工作區有 **未提交** 的 Sprint 27 改動（依 §2.6 未 commit／push） |
| 未執行 | commit、push、fetch、pull、rebase、切換分支、reset／clean／restore／stash |
| 資料庫 | `data/app.db` 只以 `readOnly` 開啟，大小與 mtime 不變；未套用任何 migration |

## 10. 部署判定：**NOT READY — 禁止部署**

理由（全部有證據）：

1. `question-isolation` FAIL（42 題）；
2. `review-provenance` FAIL（1,438 題缺口，其中 1,372 題內容已改動）；
3. `copyright` WARN（24／46 份教材未核實，1,372 題衍生自其中）；
4. `source-traceability`／`metadata`／`provenance-risk` POLICY_PENDING；
5. `golden-evaluation` INSUFFICIENT_EVIDENCE；
6. 正式環境 schema 仍為 `0028`（`0029`／`0030` 未套用）；部署會自動套用兩支 migration
   （restore → 首個請求 `runMigrations`），需先建立 `app.db.pre-deploy-*` 回滾點；
7. iPad 第 8 代實機驗收仍未完成（無實機）。

## 11. 教師及管理層待辦

| # | 範圍 | 需要的決定／證據 | 負責人 | 完成後驗證 |
| --- | --- | --- | --- | --- |
| 1 | `q_2753d4272a1b4291` | 修正題幹事件描述並對齊選項，或退回草稿 | 歷史科教師 | `audit:governance-evidence` |
| 2 | `q_6e575d744fa24f5a` | 改換第三項事件／補教材依據 | 歷史科教師 | 同上 |
| 3 | 42 題（17 題 block 失效） | 重新指定教材段落或刪題 | 教師＋維運 | `question-isolation` 轉 PASS |
| 4 | 1,372 題 | 逐題重新確認，或批准批次政策 | 科主任＋產品負責人 | `audit:approval-drift` 缺口下降 |
| 5 | 91 題（非解釋改寫） | 逐題查明改動內容 | 歷史科教師 | 同上 |
| 6 | 66 題 AI／demo | 覆核／停用／標示示範 | 教師／產品負責人 | `no-current-evidence` 下降 |
| 7 | 24 份校內題庫 | 提供授權證據 | 學校／科主任 | `copyright` 轉 PASS |
| 8 | 教材 4.2 表格 | 確認 1942「太平洋戰爭」是否誤植 | 科主任 | 教材修訂紀錄 |
| 9 | 指紋 vs 分節契約 | 決定是否新增「僅內容」指紋 | 產品負責人 | 新 migration ＋ 測試 |

## 12. 下一階段建議

1. 先做第 1–3 項（題目層面、可控），令 `question-isolation` 有實質進展；
2. 第 4 項政策簽署前，不要動 1,372 題；
3. 第 7 項版權證據是部署的硬性前提；
4. 部署前必須：commit → push → 遠端 CI 綠燈 → 建立回滾備份 → 才可執行。

---

## 13. 交付物

| 文件 | 內容 |
| --- | --- |
| 本文件 | Sprint 27 總結報告 |
| [sprint-27-p1-fact-check-2026-10-23.md](./teacher-review/sprint-27-p1-fact-check-2026-10-23.md) | 兩題 P1 逐項史實核查 |
| [sprint-27-held-42-2026-10-23.md](./teacher-review/sprint-27-held-42-2026-10-23.md) | 42 題逐題標籤與原因 |
| [sprint-27-evidence-gaps-2026-10-23.md](./teacher-review/sprint-27-evidence-gaps-2026-10-23.md) | 1,438 題重新分類 ＋ 46 份教材版權 |
| [sprint-27-batch-approval-policy-draft.md](./teacher-review/sprint-27-batch-approval-policy-draft.md) | 批次覆核政策草案（待簽署） |
| `npm run audit:governance-evidence` / `npm run audit:approval-drift` | 可重現的唯讀稽核工具 |
