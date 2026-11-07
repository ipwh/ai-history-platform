# Sprint 31 — 受控模型評估、教師覆核與發布證據

**日期**：2026-11-07
**判定**：`READY WITH DOCUMENTED LIMITATIONS`（維持不變）
**Live evaluation 授權**：**LIVE EVALUATION NOT AUTHORIZED — 0 次模型呼叫、0 美元成本**

> **三種證據必須分開閱讀（不可互相代替）**
>
> | 層次 | 本 Sprint 狀態 |
> | --- | --- |
> | Deterministic tests（自動測試／分類器／檢索） | ✅ 已執行（2,448 項通過） |
> | Live model evaluation（真實模型輸出） | ⛔ **未執行**（未獲授權） |
> | Human teacher review（歷史科教師裁決） | ⛔ **未執行**（0 條核准） |
>
> Deterministic tests ≠ live model evaluation ≠ teacher approval ≠ production verification。

## 1. Git baseline 與工作目錄

| 項目 | 值 |
| --- | --- |
| 分支 | `main` |
| `HEAD` | `7d05cb7d9a9b2e5b4b71de0880ff19f158afed82` |
| `origin/main` | 同上（本地與遠端同步） |
| 未提交變更 | Sprint 28–31 全部保留（32 個檔案：13 修改、19 新增） |
| 破壞性操作 | 沒有 `reset --hard`、`clean`、強制 checkout、覆蓋未提交檔案 |
| 提交／推送／部署 | **沒有** |

## 2. 本 Sprint 實際改動

| 檔案 | 改動 | 性質 |
| --- | --- | --- |
| [tests/fixtures/tutor-live-eval-dataset.ts](../tests/fixtures/tutor-live-eval-dataset.ts)（新） | 首輪 12 條評估案例，含期望狀態／證據政策／C 信心層級／披露要求／語言／評估重點／覆蓋類別 | 資料（不是功能） |
| [scripts/tutor-live-eval.ts](../scripts/tutor-live-eval.ts) | 改用固定資料集；導出 `buildPlan`／`clampCaseCount`／`loadProjectEnvFile`；按 `min(LLM_MAX_TOKENS, 深度上限)` 計 token；計劃記錄 `coverageClass`／`expectedEvidencePolicy`／`evaluationFocus`／`envLoadedFrom`；讀取 `.env.local` 只補未設定變數 | 評估工具硬化 |
| [tests/tutor-live-eval-dataset.test.ts](../tests/tutor-live-eval-dataset.test.ts)（新） | 資料集契約（10 類覆蓋、語言、無個人資料）、計劃零網絡、硬上限、token／成本、環境檔不覆寫 | 回歸測試 |
| [scripts/export-tutor-review-packet.ts](../scripts/export-tutor-review-packet.ts) | 套件加入 `evidenceLayers`（deterministic／liveModel／teacherDecision 分層）；BOM 容忍 | 教師套件 |
| 文件 | [評估計劃](tutor-live-evaluation-plan-2026-11-07.md) 更新授權狀態、資料集及安全檢查 | 文件 |

**沒有**改動學生實際使用的提示詞、模型設定、配額政策、API 或資料庫 schema。Sprint 30 的 12 個 `LIVE_EVAL_CASES` 由新資料集取代，但案例內容只擴充、不刪減（原 12 條概念全部保留在資料集或模擬矩陣）。

## 3. Live evaluation 授權狀態

檢查過：`.env.local` 有 `DEEPSEEK_API_KEY`、`LLM_MODEL=deepseek-flash`、`LLM_PROVIDER=deepseek`、`LLM_TIMEOUT_MS`、`LLM_MAX_TOKENS`；應用有 `reserveAiOperation`、每日／全域限額。

**這些都不構成授權。** 本 Sprint 訊息沒有明確批准付費呼叫，因此依規格：

- 只產生評估計劃與資料集；
- **0 次模型呼叫、0 次網絡請求**；
- 不繞過程式閘門、不直接呼叫供應商 API。

所需授權（缺一即 fail closed）：`--apply`、`TUTOR_EVAL_ALLOW_LIVE_CALLS=1`、`--budget-usd ≥ 0.04`；此外擁有者須指定模型（或確認沿用 `deepseek-flash`）、最大呼叫數（≤20，預設 12）並確認可用合成問題。即使三項齊備，本版本仍只提供計劃模式。

## 4. 實際模型呼叫次數及成本

| 項目 | 值 |
| --- | --- |
| 模型呼叫 | **0** |
| 網絡請求 | 0（測試以 `fetch` spy 斷言） |
| 成本 | **0.00 美元** |
| 計劃上限（若獲授權執行 12 條） | 17,000 輸出 token、**0.04 美元**（每百萬輸出 token 2.5 美元保守估算） |

## 5. 模型及 prompt version

| 項目 | 值 |
| --- | --- |
| Provider／Model（計劃記錄） | `deepseek`／`deepseek-flash` |
| Prompt version | `TUTOR_PROMPT_VERSION = 2026-11-07.2` |
| 環境來源 | `.env.local`（只補未設定變數；輸出不含任何憑證） |
| 每次呼叫 token 上限 | `min(LLM_MAX_TOKENS, 深度上限)`：standard 1,000／advanced 1,500／challenge 2,000 |

## 6. 每個案例的輸出及評估

**沒有輸出可評。** 12 條案例的期望契約已版本化（`tests/fixtures/tutor-live-eval-dataset.ts`），但 `actualAnswer` 全部不存在，因此第 5、6 階段的逐條評估無法進行。

分類器對這 12 條案例的預測（計劃模式、無模型呼叫）：

| 案例 | 覆蓋類別 | 分類器狀態 | 信心 |
| --- | --- | --- | --- |
| live-01 明治維新 | A | 取決於教材分佈（記錄於計劃） | — |
| live-02 法國參與美國革命 | B | 同上 | — |
| live-03 甘地不合作運動 | C1 | C-general-knowledge | C1 |
| live-04 冷戰結束的史學解釋 | C2 | C-general-knowledge | C2 |
| live-05 第 231 條原文 | C3 | C-general-knowledge | C3 |
| live-06 佢有咩影響？ | D | D-needs-clarification | — |
| live-07 昨晚場波 | out-of-scope | out-of-scope | — |
| live-08 英文多部分比較 | multi-part | 依教材分佈 | — |
| live-09 冷戰＋足球 | mixed | 依教材分佈 | — |
| live-10 冷戰追問「點解？」 | follow-up | 依上文／教材分佈 | — |
| live-11 種族隔離（簡體） | C2 | C-general-knowledge | C2 |
| live-12 1942 年參戰（錯誤前提） | B | 依教材分佈 | — |

> 上表是**計劃輸出**，不是模型行為證據。

## 7. C1／C2／C3 政策遵守情況

**未測。** 提示詞契約、分類邏輯及測試（C3 要求說明無法核實、C2 要求區分爭議、C1 要求標明一般知識）屬 deterministic 證據；模型是否遵守需 live evaluation。

## 8. A／B 證據忠實度

**未測（模型層）**。Deterministic 層面：A 只在 `evidenceSupport = direct` 時成立；關鍵詞齊全但片段無因果／比較／評價支持 → B。此規則有 5 個專項測試，但不代表模型會正確披露 B 的缺口。

## 9. 歷史準確性問題

**未能判斷。** 無模型輸出、無教師覆核，因此不能聲稱「沒有重大史實錯誤」。

## 10. 虛構教材出處統計

**未能判斷（0 個樣本）。** 結構上平台不採用模型自報出處（`sources` 由平台產生），提示詞明文禁止虛構段落／頁數／引文；實際遵守情況未測。

## 11. 教師覆核進度

| 項目 | 狀態 |
| --- | --- |
| 83 條教師矩陣 | 全部 `pending-human-review`；`teacher-approved` = 0 |
| 91 條模擬矩陣 | 全部 `pending-human-review` |
| 受控評估回覆 | 0 條（沒有回覆可合併） |
| 套件匯出 | 83 條；`answersIncluded = 0`；新增 `evidenceLayers` 分層；匯出前後 `data/app.db` SHA-256 不變 |
| 教師評分 | 0 條（需具體錯誤、證據缺口及教學問題，不接受整體滿意度） |

## 12. 全套測試結果

| 命令 | 結果 |
| --- | --- |
| `npx vitest run --maxWorkers=4` | **162 個測試檔；2,448 通過、4 略過、0 失敗** |
| 新增：`tests/tutor-live-eval-dataset.test.ts` | 12 項通過 |
| 既有：`tests/tutor-live-eval-plan.test.ts` | 3 項通過（授權 fail closed） |
| `npm run typecheck` | 通過 |
| `npm run lint` | 0 error；1 項既有 warning（`scripts/verify-questionbank-sync.ts` 未使用 `fs`） |
| `npm run build` / `npm run verify:build` | 通過／通過 |
| `npm run test:ui` | 22 通過、**9 略過**、0 失敗（略過者不可算作通過） |
| `npm run release:gate` | `READY WITH LIMITATIONS` |
| GitHub Actions | **未運行**（未推送） |

## 13. CI／正式環境驗證狀態

- 候選 commit CI：**未運行**（工作目錄未提交、未推送）。
- Cloud Run revision／traffic：**未核實**（`gcloud` 需互動式重新認證）。
- 授權學生帳戶的實際路線：**未驗證**（沒有授權帳戶）。
- 教師／學生權限隔離：本 Sprint 未改動授權層，既有 `authz-negative` 測試仍通過；正式環境未重驗。

## 14. 未解除風險

1. **模型行為未實測**：C1／C2／C3 與 A/B 政策是否被遵守、是否假拒絕／無據答案／虛構出處，全部未知。
2. **歷史內容未經教師覆核**：83 + 91 條案例零核准。
3. **評估工具仍為計劃模式**：實際執行需擁有者授權及另行啟用。
4. **CI 與正式環境證據缺失**。
5. **計劃樣本以本機教材分佈為準**：`stateFromClassifier` 可能與正式環境不同。
6. **B 狀態的證據忠實度仍是詞彙近似**（因果連接詞 ≠ 語意支持）。

## 15. 最終發布判定

**`READY WITH DOCUMENTED LIMITATIONS`**（維持，不上調）。

第 9 節列出的七項獨立發布條件中，只有「軟件正確性」「可答性正確性（deterministic）」有證據；「真實模型行為」「教師覆核」「CI」「正式環境」全部未完成。

**下一步（需擁有者決定）**：①明確授權 12 次、≤0.04 美元的付費評估（或指定其他上限）；②授權後執行並把回覆合併入教師套件；③歷史科教師完成必要案例覆核；④推送候選 commit 讓 CI 運行；⑤以授權帳戶核實正式環境。

**本 Sprint 到此停止，未提交、未推送、未部署。**
