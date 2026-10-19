# Sprint 10 報告：可作答性、審核來源與 Golden 基準（2026-10-19）

## A. Baseline

| 項目 | 內容 |
| --- | --- |
| Branch / HEAD（開始時） | `main` / `6895db97f5a4a589dc6267db2fecbe9d927532a2` |
| `origin/main` | 同上（Sprint 9 已推送） |
| 工作樹 | 乾淨；沒有未提交變更 |
| 保護方式 | 只新增檔案及針對性修改；沒有 `reset`／`clean`／強制 checkout；沒有覆蓋 Sprint 9 的報告或裁決 |
| 規範 | `AGENTS.md` 只有 Next.js 規則；無 `CLAUDE.md`；無 CI |

## B. 97 題處理結果（唯讀盤點，未修改）

| 指標 | 結果 |
| --- | --- |
| 掃描題目 | 1,880 |
| 不可作答 | **97（全部已發布）** |
| `MCQ_ROMAN_LABEL_MISSING` | **96** |
| `FILL_ANSWER_LEAKS` | **1**（`qb-JTH2ndEdFBQ09015`：教師在 Sprint 9 選擇保留「研發軍備」原文，答案「軍備」在題幹再次出現；裁決紀錄保留，但 servability 仍會攔下，未經教師改寫不會派發） |
| 建議 | **97 題 `teacher_review_required`**；沒有 `safe_automatic_repair_candidate` |
| 曾有學生作答 | **0** |
| 存在於練習快照 | **0** |
| 目前版本有人工證據 | 76 |
| 實際修改 | **0**（沒有改題、退草稿或隔離） |

完整逐題清單：[servability-remediation-2026-10-19.md](quality/servability-remediation-2026-10-19.md)。

沒有自動修復的原因：96 題需要在題幹加入 i／ii 標示（改變題幹排版及學生理解），1 題的答案外洩需改寫題幹或答案；兩者都涉及內容決定，不符合「來源確定、不改變答案／評分」的條件。

## C. 審核 provenance

| 來源 | 數量 |
| --- | --- |
| 擁有者批次 | 1,882 |
| 自動修復（理由前綴） | **1,266** |
| 教師裁決 | 20 |
| 合計 | 3,168 |

**Sprint 9 的 1,279 筆需要修正**：全部 3,168 筆的 `reviewer_role` 都是 `admin`；1,279 = 1,266 筆真正的自動修復 + **13 筆**「教師裁決（自動修復改變考核答案）…」被字串規則誤計。

目前版本（1,880 題）：

- 教師逐題裁決：**16**
- 只有擁有者批次：**1,241**
- 只有自動修復證據：**623**
- 完全沒有核准證據：**0**

原始紀錄全部保留；沒有改寫角色、時間、理由或指紋。完整報告：[review-provenance-2026-10-19.md](quality/review-provenance-2026-10-19.md)。

新流程防止再犯：修復腳本一律寫 `reviewer_role = automation`；分類器以**理由前綴**辨識來源，不以角色推測；`release:gate` 將「只有自動修復」列為 `POLICY_PENDING`。

## D. Golden evaluation

- Dataset：`docs/teacher-review/golden-questions.v2.json`（`datasetVersion: 2026-10-19.1`）。
- Schema：`draft`／`pending-review`／`approved`／`rejected`／`superseded`；approved／rejected 必須有 reviewer、reviewedAt；approved 另須題目 ID、版本、內容指紋及來源證據。
- 候選：`docs/teacher-review/golden-candidates-2026-10-19.json`，**42 個 `pending-review`**（教師裁決 8、答案映射 8、不可作答 8、可接受答案 2、MC 8、填充 8），全部沒有 reviewer。
- Approved／pending／rejected：**0／42／0**（候選不是 dataset fixture）。
- 評估 runner：`npm run golden:eval` → **`INSUFFICIENT_EVIDENCE`**（0 approved fixture），不是零錯誤。
- 沒有任何偽造的教師核准；沒有自動把候選加入 approved。

## E. Release gate（12 項）

| 閘門 | 狀態 | 證據 |
| --- | --- | --- |
| question-isolation | PASS | 0 題 |
| question-servability | **FAIL** | 97 題（96 羅馬數字、1 答案外洩；派發層攔下） |
| answer-provenance | PASS | 18 題已裁決 |
| source-traceability | POLICY_PENDING | 877／1,880 可定位；1,003 待核實 |
| explanation-quality | POLICY_PENDING | 1,334 佔位、546 只列答案 |
| metadata | POLICY_PENDING | 1,587 項需教師確認 |
| teacher-decisions | PASS | 0 待覆核、0 未結回報 |
| **review-provenance** | **POLICY_PENDING** | 623 題只有自動修復證據 |
| copyright | WARN | 擁有者確認；逐份 12／36 |
| golden-evaluation | INSUFFICIENT_EVIDENCE | 0 approved |
| tests | PASS | `docs/release-evidence-2026-10-19.json` |
| deployment | INSUFFICIENT_EVIDENCE | 未部署 |

**整體：NOT READY。**

- 97 題是否停止進入新練習：**是**（`checkQuestionServable` 在題庫、生成、錯題重練及生成補充路徑都會攔下；本 Sprint 重新核對）。
- 歷史成績與 snapshot：**沒有被修改**；97 題不在任何練習快照中（0 個）。
- 待決定事項：97 題的處置、623 題自動修復證據是否足夠、佔位解釋政策、來源文件紀錄、Golden dataset 的教師核准。

## F. 測試與環境

| 指令 | 結果 |
| --- | --- |
| `npm test` | **84 檔；1,152 通過、4 略過（1,156）** |
| `npm run typecheck` | 0 |
| `npm run lint` | 0（無錯誤、無警告） |
| `npm run build` | 0（首次因 OneDrive 鎖定 `.next` EPERM；清除後成功） |
| `npm run audit:repair-provenance` | 0（877／987／14） |
| `npm run audit:content` | 0 |
| `npm run audit:servability` | 0 |
| `npm run audit:review-provenance` | 0 |
| `npm run golden:candidates` | 0（42 候選） |
| `npm run golden:eval` | 0（`INSUFFICIENT_EVIDENCE`） |
| `npm run release:gate` | 0（NOT READY） |
| E2E（暫存 DB） | 121 通過／5 失敗（既有環境限制，逐項列明） |

未執行：正式環境部署、Cloud Run 併發、備份還原演練（需要授權及正式環境）。

- Migration：**沒有新增**。
- 正式資料庫：**沒有接觸**。
- 部署／commit／push：**沒有**（依指示，未獲另行授權）。
