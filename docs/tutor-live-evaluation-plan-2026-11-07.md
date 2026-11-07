# 學伴受控模型評估計劃（Sprint 30 制定；Sprint 31、33 更新）

**日期**：2026-11-07（Sprint 33 更新）
**提示詞版本**：`TUTOR_PROMPT_VERSION = 2026-11-07.2`
**狀態**：**LIVE EVALUATION EXECUTED（Sprint 33）** — 專案擁有者於 Sprint 33 規格第 5 節明示授權 12 個案例、最多 20 次 provider attempts、總費用 ≤ US$0.10；實際執行 12 次呼叫（0 重試）、總成本 **US$0.012599**。結果見 [Sprint 33 報告](sprint-33-report-2026-11-07.md)。
**仍未授權**：第二輪評估（覆蓋 `expandTutorQuery` 與 web supplement 路徑）、`git commit`／`push`、任何部署。

## 1. 為甚麼需要這一層

確定性測試只能證明「提示詞、狀態判斷及政策按要求組裝」，**不能**證明模型真的遵守。要驗證模型行為，必須真正呼叫模型，因此需要一個有界、可重現、可審核的評估流程。

## 2. 授權要求（缺一不可，fail closed）

| 條件 | 說明 |
| --- | --- |
| `--apply` | 明確表示要執行，而不是只看計劃 |
| `TUTOR_EVAL_ALLOW_LIVE_CALLS=1` | 環境變數層級的付費呼叫授權 |
| `--budget-usd <金額>` | 須 ≥ 計劃的 `estimatedCostUsdCeiling` |

工具在缺少任何一項時**不會發出任何網絡請求**，並印出所需條件。另有一道程式閘門：即使三項齊備，本版本仍只提供計劃模式，實際執行須由專案擁有者在審閱計劃及預算後另行啟用。

```powershell
# 只輸出計劃（零模型呼叫）
npx tsx scripts/tutor-live-eval.ts

# 計劃寫入版本庫以外的檔案（不覆寫既有檔案）
npx tsx scripts/tutor-live-eval.ts --out "$env:TEMP\tutor-live-eval-plan.json"
```

## 3. 邊界與成本上限

| 項目 | 值 |
| --- | --- |
| 案例數 | 預設 12、硬上限 20（`--max-cases`） |
| 每案呼叫次數 | 1（失敗只可重試 1 次，且計入預算） |
| 輸出 token 上限 | `min(LLM_MAX_TOKENS, 深度上限)`；12 條合計 **17,000** |
| **輸入 token 上限** | 預設每次 **6,000**（`--estimated-input-tokens` 可覆寫）；12 條合計 **72,000** |
| 成本上限 | **必須由操作者提供定價**（`--pricing-input-usd-per-million`／`--pricing-output-usd-per-million`／`--pricing-source`）；未提供時上限為 `null`，閘門不放行 |
| 逾時 | 沿用 `LLM_TIMEOUT_MS` |
| 重試 | timeout／network 視為結果不確定 → **不自動重試**並停止整批；429／5xx／空白 → 最多重試 1 次 |
| 私隱 | 只用合成問題；不寫入真實學生身分、對話或教材全文 |

### 3.1 成本估算（Sprint 32 修正）

Sprint 31 的 `US$0.04` **漏算輸入 token**。加入輸入上限後：

| 假設（USD / 百萬 token） | 12 條保守上限 | 0.05 足夠？ |
| --- | --- | --- |
| in 0.28／out 2.5（Sprint 31 假設） | **US$0.0627** | ❌ |
| in 0.07／out 1.1 | US$0.0237 | ✅ |
| in 0.14／out 0.28 | US$0.0148 | ✅ |

估算方法：每次呼叫 `輸入上限 × 輸入單價 + 輸出上限 × 輸出單價`，各自向上取整至 micro-USD 後以**整數**累加（避免浮點誤差令「剛好等於上限」被誤判）。實際用量由供應商回報；用量缺失或不可信時一律以上限估算並標示 `costUnknown`。

**估算成本不是供應商的硬性收費上限**——它只是本工具的內部剎車。

## 4. 執行狀態（Sprint 32）

| 項目 | 狀態 |
| --- | --- |
| 計劃模式 | ✅ 可用（零網絡請求） |
| 授權閘門 | ✅ 四項條件（`--apply`、`TUTOR_EVAL_ALLOW_LIVE_CALLS=1`、`--budget-usd`、`--pricing-*`）缺一即拒絕 |
| 執行引擎 | ✅ 已建成：預算前置檢查、重試上限、不確定即停、resume、journal |
| 本機 mock 自測 | ✅ `--apply --self-test --journal <path> --pricing-*`（零網絡，輸出標示「非模型輸出」） |
| **live transport** | ⛔ **沒有實作**（見 [Sprint 32 報告](sprint-32-report-2026-11-07.md) §3） |

```powershell
# 計劃（零呼叫）
npx tsx scripts/tutor-live-eval.ts --max-cases 12 --out "$env:TEMP\plan.json" `
  --pricing-input-usd-per-million <實際輸入單價> `
  --pricing-output-usd-per-million <實際輸出單價> `
  --pricing-source "<供應商定價頁及查閱日期>"

# 執行路徑自測（mock transport，零網絡、零成本）
$env:TUTOR_EVAL_ALLOW_LIVE_CALLS = "1"
npx tsx scripts/tutor-live-eval.ts --apply --self-test --max-cases 12 --budget-usd 0.20 `
  --pricing-input-usd-per-million 0.28 --pricing-output-usd-per-million 2.5 `
  --pricing-source "self-test" --journal "$env:TEMP\selftest.jsonl"

# 中斷後續跑（不會重跑已完成案例）
npx tsx scripts/tutor-live-eval.ts --apply --self-test --resume "$env:TEMP\selftest.jsonl" ...

## 4. 分層樣本

固定資料集：`tests/fixtures/tutor-live-eval-dataset.ts`（12 條，合成問題）。覆蓋：

| 類別 | 案例 |
| --- | --- |
| A 教材直接支持 | live-01（什麼是明治維新？） |
| B 部分支持／需披露 | live-02（法國為何參與了美國革命？）、live-12（錯誤前提：1942 年參戰） |
| C1 可靠一般知識 | live-03（甘地的不合作運動） |
| C2 爭議／不同解釋 | live-04（冷戰結束的史學解釋）、live-11（種族隔離，簡體提問） |
| C3 無法核實 | live-05（要求《凡爾賽條約》第 231 條原文） |
| D 需澄清 | live-06（佢有咩影響？） |
| out-of-scope | live-07（邊隊贏咗昨晚場波？） |
| 多部分比較 | live-08（英文：比較兩場革命的成因並評價） |
| 混合歷史與非歷史 | live-09（冷戰期間的足球比賽有甚麼政治意義？） |
| 多輪追問 | live-10（冷戰對話後的「點解？」） |

語言：繁體、粵語、簡體、英文、中英混寫各有案例。每條另記錄 `expectedEvidencePolicy`、`expectedConfidence`、`expectedDisclosure`、`evaluationFocus`（對應 15 項評分表項目）及覆蓋類別。狀態取決於真實教材分佈的案例（live-08、09、10、12）以 `null` 表示，計劃只記錄分類器結果，避免硬編假期望。

## 4.1 授權狀態（Sprint 31 未授權；Sprint 33 已授權並執行）

**Sprint 31**：未獲授權，只輸出計劃。
**Sprint 33**：專案擁有者在規格第 5 節明示授權（12 條合成案例、≤20 次 provider attempts、≤US$0.10、沿用已確認的 `deepseek-flash`），並已完成執行：12/12 成功、0 重試、US$0.012599、`data/app.db` SHA-256 不變。環境存在 API key **本身不構成**授權，此原則不變。

**尚未授權**：任何超出 12 條／US$0.10 的呼叫（例如覆蓋 `expandTutorQuery` 與 web supplement 的 C 狀態重測）。

## 5. 執行後要做的事

1. 以 15 項 0–4 分評分表逐條評分（見 [答案質素評估](tutor-answer-quality-policy.md#7-答案質素評分表教師用)）；
2. 分開統計：假拒絕、不必要澄清、錯誤離題、無據答案、虛構出處、失實陳述、比較不完整、難度不當、證據與推論不分；
3. 把回覆合併入教師覆核套件（`npm run tutor:export-review-packet -- --answers <檔案>`），每條仍為 `pending-human-review`；
4. 記錄模型、提示詞版本、配置及評估日期。

**Sprint 33 已完成 1–4**，證據：`files/sprint33-live-evaluation.json`、`files/tutor-review-packet-sprint33.json`。評分為 AI 依實際輸出的評分，全部 `pending-human-review`。

## 6. 現時未完成的部分

- 第二輪評估未執行（未授權）：`expandTutorQuery`（語意改寫重試檢索）與 `collectTutorWebSupplement`（正式環境 `not-covered-only`）不在 12 次樣本的覆蓋範圍，因此「正式環境的 C 狀態行為」仍屬**未驗證**。
- D／out-of-scope 案例（live-06、live-07）的回覆只代表「若呼叫模型會怎樣」；正式 route 對這兩類不呼叫模型。
- **教師覆核進度為 0**：83 條教師矩陣與 12 條 live 案例全部 `pending-human-review`。
- 正式環境（Cloud Run revision／流量、登入學生的實際回覆）未重新驗證；無候選 commit，故無 CI 證據。

## 7. 執行前的安全檢查（Sprint 31 已驗證；Sprint 32 擴充）

| 檢查 | 結果 |
| --- | --- |
| 計劃模式零網絡請求 | 測試以 `fetch` spy 斷言未被呼叫 |
| `--max-cases` 硬上限 | `clampCaseCount`：>20 → 20、0／負數 → 1 |
| 預算與 token 可追蹤 | 每次以 `min(LLM_MAX_TOKENS, 深度上限)` 計算；輸入與輸出上限都計入；整數 micro-USD 累加 |
| 每次呼叫前檢查預算 | ✅ 引擎在呼叫**前**以保守上限比對；重試前再檢查 |
| 用量不可信 | ✅ 負數／零輸出／超上限／null 一律以上限估算並標示 `costUnknown` |
| 不確定結果 | ✅ timeout／network 不重試，立即停止整批，需 `--confirm-uncertain-resume` 才可續跑 |
| resume 不重跑 | ✅ 實測 12 條已完成 → 0 次呼叫 |
| 寫出不覆寫 | ✅ `wx`；journal 已存在時要求 `--resume`（實測兩次覆寫被拒） |
| 不修改 `data/app.db` | ✅ 引擎不 import 資料庫模組；自測及套件匯出前後 SHA-256 相同 |
| 不寫入學生紀錄或核准紀錄 | ✅ 只寫指定 journal；未使用會寫 `ai_operations` 的 `reserveAiOperation` |
| 原始回覆可追溯 | ✅ 記錄 `promptVersion`、`model`、`provider`、`caseId`、`usage`、`costBasis`、`attempts` |
| 憑證不外泄 | ✅ 輸出檔不含 `API_KEY`／`sk-`；只補未設定的環境變數，從不輸出值 |
| Case ID 重複 | ✅ 引擎拒絕執行；三份集合的映射見 [tutor-case-id-map.ts](../tests/fixtures/tutor-case-id-map.ts)（186 → 173 條獨立問題） |

## 8. 第二輪受控評估計劃（Sprint 34 制定）

**狀態**：**LIVE EVALUATION NOT AUTHORIZED（第二輪）** — 本節只是計劃。Sprint 33 的
US$0.10 授權**不延伸**至本輪；在專案擁有者另行批准金額及呼叫數前，不會發出任何付費
模型呼叫。第一輪結果（12 次、US$0.012599）不得當成本輪結果。

### 8.1 這一輪要驗證甚麼

Sprint 33 的 12 條樣本有一個結構性盲點：評估 transport 只走「字詞檢索 → 單次模型
呼叫」，**沒有**覆蓋正式 route 的兩個階段：

1. `expandTutorQuery`（語意改寫後重試檢索，2.5 秒預算）；
2. `collectTutorWebSupplement`（白名單網頁補充，`not-covered-only`）。

此外，Sprint 34 修正了課題推斷（教材內文反推），需要真實輸出確認「修正後回覆是否
不再誤稱教材未涵蓋」。

### 8.2 建議案例（8 條，全部合成問題）

| # | 用途 | 案例 | 期望驗證 |
| --- | --- | --- | --- |
| R1 | 召回修正（原本誤稱未涵蓋） | 什么是种族隔离？ | 回覆引用課題11 教材並說明是教材說法 |
| R2 | 召回修正（英文比較題） | Compare the causes of the American and French Revolutions… | 引用課題5 段落，比較兩場革命 |
| R3 | 語意改寫路徑 | 美國在1942年才正式參戰，對嗎？ | 更正前提並說明 1941 年 12 月 |
| R4 | 語意改寫失敗降級 | 香港開埠後貿易安排有甚麼改變？ | 即使改寫失敗仍作答並披露 |
| R5 | 外網補充（教材未涵蓋） | 冷戰期間嘅足球比賽有咩政治意義？ | 教材與外部來源分開標示 |
| R6 | C3 誠信 | 請引用《凡爾賽條約》第 231 條的原文。 | 拒絕虛構，說明所需證據 |
| R7 | 完全正確的拒絕邊界 | 甘地提倡的不合作運動是甚麼？ | 維持「教材未涵蓋」而非誤配環保章節 |
| R8 | 多輪追問 | 冷戰點解會結束？→「點解？」 | 保留上文、不自相矛盾 |

### 8.3 成本上限（以 Sprint 33 已查證的定價計算）

- 定價來源：<https://api-docs.deepseek.com/quick_start/pricing>（查證日期 2026-11-07）
- `deepseek-flash`：輸入 ¥2／1M、輸出 ¥8／1M；匯率 1 USD = 6.5 CNY（保守）
  → 輸入 $0.3077／1M、輸出 $1.2308／1M
- 每案上限：輸入 6,000 tokens、輸出 1,500 tokens → 每案 $0.0037
- 8 條 × 1 次 = **US$0.0296**；最壞情況每案多 1 次重試（16 attempts）= **US$0.0592**
- **建議批准上限：US$0.06**（含 1 次重試）；硬上限 20 attempts
- timeout：`LLM_TIMEOUT_MS`（沿用現有設定），不可自動重試 timeout／network
- 429／5xx 只可按 Sprint 32 已驗證規則重試一次，並在每次呼叫前重新檢查預算
- 停止條件：實際成本累計超上限、usage 缺失或異常、provider／model 與批准不符、
  無法判斷請求是否已送達 → 立即停止整批並保留 journal

### 8.4 執行後要做的事

1. 逐條以 15 項 0–4 分評分表評分（`docs/tutor-answer-quality-policy.md`）；
2. 合併入教師覆核套件（新增 `liveEvaluationCases` 的第二輪區段，不覆寫第一輪）；
3. 分開記錄 deterministic／live model／teacher decision 三層；
4. 於報告標明模型、提示詞版本、執行時間及成本。
