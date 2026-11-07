# Sprint 32 — 執行路徑審計、成本安全與 Mock Provider 驗證

**日期**：2026-11-07
**判定**：`READY WITH DOCUMENTED LIMITATIONS`（維持不變）
**真實模型呼叫**：**0 次**（本 Sprint 明令禁止；亦未取得授權）
**提交／推送／部署**：沒有

---

## 0. 直接回答本 Sprint 的問題

> **「如果專案擁有者批准 12 次模型呼叫、預算上限 0.05 美元，現有工具是否真的能安全執行？」**

**不能。三個獨立阻塞：**

| # | 阻塞 | 說明 |
| --- | --- | --- |
| 1 | **沒有 live transport** | 授權齊備後，CLI 會以「沒有可用 live transport」拒絕並終止，**不會**發出任何呼叫。評估不能繞過既有 provider adapter，而該 adapter 並不存在（見 §3）。 |
| 2 | **0.05 美元不足以覆蓋 12 次呼叫（按 Sprint 31 假設的價格）** | Sprint 31 的 0.04 美元**漏算輸入 token**。加入輸入上限後，保守上限為 **US$0.0627**，比 0.05 高 25%。Sprint 31 的估算低估約 57%。 |
| 3 | **成本估算依賴未提供的定價** | 工具現時**強制**要求 `--pricing-*`；沒有定價時 `estimatedCostUsdCeiling` 為 `null`，授權閘門不放行。若真實定價較低（例如 in 0.07／out 1.1），上限為 **US$0.0237**，0.05 便足夠——所以答案取決於擁有者提供的實際價格，而非假設。 |

其餘執行安全機制（預算前置檢查、重試上限、不確定即停、resume 不重跑、journal 不覆寫、不寫資料庫）**已建成並以 31 項 mock 測試驗證**。

---

## 1. Git baseline 與工作目錄

| 項目 | 值 |
| --- | --- |
| 分支 | `main` |
| `HEAD` = `origin/main` | `7d05cb7d9a9b2e5b4b71de0880ff19f158afed82` |
| Sprint 28–31 工作 | **全部保留**（未 reset／clean／checkout／覆蓋） |
| 本 Sprint 新增檔案 | 4 個（引擎、2 個測試、1 個映射 fixture） |
| 本 Sprint 修改檔案 | 3 個（`scripts/tutor-live-eval.ts`、2 個既有測試 fixture 補欄位、評估計劃文件） |
| 學生可見的提示詞／模型／配額／授權 | **未改動** |

## 2. Sprint 28–31 工作保留情況

- 83 條教師矩陣：**未刪除、未修改**任何案例或覆核狀態。
- 91 條模擬矩陣：只新增 `expectedConfidence` 欄位（Sprint 30 遺留的一致性修正），案例數及內容不變。
- Sprint 30／31 評估計劃與報告：保留，並更新（不是取代）。

## 3. 真實 provider 執行路徑：**不存在**

| 檢查 | 結果 |
| --- | --- |
| 評估 CLI 有執行路徑？ | **沒有**。授權通過後只有一條錯誤訊息說明缺口。 |
| 學伴的模型呼叫在哪裡？ | 內嵌在 [src/app/api/tutor/chat/route.ts](../src/app/api/tutor/chat/route.ts) 的 `openUpstream()`（直接 `fetch`，SSE 串流）。 |
| 有可共用的 chat client？ | **沒有**。`src/server/llm/chat-client.ts` 只有 JSON 模式（`response_format: json_object`）的 `requestJsonCompletion`，不適合散文式串流回覆。 |
| `reserveAiOperation` 可復用？ | **不可**。它會 `recordAiOperation()` **寫入 `data/app.db`**，違反本 Sprint「不修改正式資料庫」及「不影響正式配額」。評估引擎因此自行記帳，不經配額表。 |
| 是否自行寫了新 provider？ | **沒有**（規格禁止）。 |

**可行做法（需擁有者決定其一）**：

- (a) 把路線的 `openUpstream` 抽成共用 `streamChatCompletion()`，讓評估與正式路線共用同一 adapter；
- (b) 明確批准一個獨立的評估 adapter（提供同樣的 timeout／usage／錯誤分類契約）。

兩者都會改動或新增伺服器端呼叫路徑，超出本 Sprint「不改動學生使用的模型設定」的授權範圍，因此**停在此處並報告**。

## 4. 授權閘門完整性

| 條件 | 檢查方式 | 缺一即拒絕 |
| --- | --- | --- |
| `--apply` | 旗標 | ✅ |
| `TUTOR_EVAL_ALLOW_LIVE_CALLS=1` | 環境變數 | ✅（實測：未設定時 `allowed: false`，零呼叫） |
| `--budget-usd` ≥ 保守上限 | 與 `estimatedCostUsdCeiling` 比較 | ✅ |
| `--pricing-*`（新增） | 三項齊全且為有限數 | ✅（無定價時上限為 null → 不放行） |
| 定價來源非空白 | `pricing.source` | ✅（引擎層拒絕） |

同一次執行完整確認：所有條件都在 `main()` 內以同一個 `authorization` 物件判斷，不存在「先通過、後改設定」的窗口。

## 5. 成本估算方法及限制

### 5.1 Sprint 31 的錯誤

Sprint 31 只計輸出 token：`17,000 × 2.5/M ≈ US$0.0425 → 四捨五入 $0.04`。**輸入 token 完全未計。**

### 5.2 現行方法（引擎 `tutor-eval-engine.ts`）

- 每次呼叫的保守成本 ＝ `estimatedInputTokens × 輸入單價 + maxOutputTokens × 輸出單價`，兩者**各自向上取整**至 micro-USD；
- `maxOutputTokens` 與路線封頂一致：`min(LLM_MAX_TOKENS, 深度上限)`；
- `estimatedInputTokens` 預設 6,000（系統提示＋上文＋問題的保守上限），可由 `--estimated-input-tokens` 覆寫；
- 12 條案例的輸出上限合計 **17,000**（standard 1,000 ×4、advanced 1,500 ×6、challenge 2,000 ×2）；輸入上限合計 **72,000**；
- 全部以整數 micro-USD 累加，避免浮點誤差令「剛好等於上限」被誤判為未超支；
- 已驗證：浮點情境下 `spentMicro ≤ budgetMicro` 恆成立。

### 5.3 不同定價下的 12 條上限

| 假設 | 輸入單價 | 輸出單價 | 保守上限 | 0.05 足夠？ |
| --- | --- | --- | --- | --- |
| Sprint 31 假設 | 0.28 | 2.5 | **US$0.0627** | ❌ |
| 較低價 | 0.07 | 1.1 | US$0.0237 | ✅ |
| 中價 | 0.14 | 0.28 | US$0.0148 | ✅ |

在輸入單價 0.28 下，0.05 預算可容許的輸出單價上限為 **1.755 USD/M**。**這些價格不是本報告的宣稱事實**：工具要求操作者填入供應商當期公布價格並記錄來源，否則拒絕執行。

### 5.4 記錄要求對照

| 類型 | 要求 | 實作 |
| --- | --- | --- |
| Estimated input cost | 必須計算 | ✅ `conservativeCostMicro` |
| Estimated output cost | 必須計算 | ✅ 同上 |
| Actual input tokens | 如提供 | ✅ `usage.inputTokens` |
| Actual output tokens | 如提供 | ✅ `usage.outputTokens` |
| Actual total cost | 如可取得 | ✅ `actualCostMicro`（`costBasis: "actual-usage"`） |
| Unknown cost | 明確標示 | ✅ `costUnknown: true` + `costBasis: "conservative-ceiling"` + `costUnknownCases[]` |

執行前及**每次呼叫前**都檢查剩餘預算（不是事後補算）；重試前再檢查一次。估算成本**不會**被當成供應商的硬性收費上限——引擎以上限作內部剎車，實際收費仍以供應商帳單為準。

## 6. Mock provider 測試結果（16 項要求，31 個測試）

全部使用 `tests/tutor-eval-engine.test.ts` 的注入式 mock transport；**沒有任何網絡請求**。

| # | 情境 | 結果 |
| --- | --- | --- |
| 1 | 正常完成 12 個案例 | ✅ 12 次呼叫、0 重試、12 成功、不超支、全部 `actual-usage` |
| 2 | 第 3 個案例失敗（不可重試） | ✅ 該案 `failed`、其餘繼續、共 5 次呼叫 |
| 3 | 第 3 個案例 timeout | ✅ 視為**結果不確定**：不重試、立即停止整批、其餘標 `not-run`（共 3 次呼叫） |
| 4 | 第 3 個案例 429 | ✅ 重試一次後成功：5 次呼叫、1 次重試、`attempts: 2` |
| 5 | 第 3 個案例 500 | ✅ 重試一次仍失敗：該案 `failed`、其餘成功 |
| 6 | retry 後成功 | ✅ `attempts: 2`、`retries` 正確累計 |
| 7 | retry 後仍失敗 | ✅ 最多 2 次嘗試，**不會無限循環** |
| 8 | 預算在第 3 個案例後不足 | ✅ 第 4 條**呼叫前**停止、`stopped-budget`、`spent ≤ budget`、3 條 `not-run`；預算連第一條都不夠時 **0 次呼叫** |
| 9 | token usage 缺失 | ✅ 以上限估算、標 `costUnknown`、成本**不是 0** |
| 10 | 異常 token usage（負數／零輸出／超上限兩倍／輸入暴增／null 欄位） | ✅ 全部判定不可信 → 以上限估算 |
| 11 | 輸出檔已存在 | ✅ CLI `wx` 拒絕；journal 已存在時要求 `--resume`（實測第二次執行被拒） |
| 12 | 執行中斷後重新啟動 | ✅ resume 跳過已完成案例（實測：12 條已完成 → **0 次呼叫**、journal 不變）；不完整 journal 行被忽略並計數 |
| 13 | 相同案例重複執行 | ✅ journal 重複行可解析；**案例 ID 重複時引擎拒絕執行**（結果無法對應教師矩陣） |
| 14 | 超過 20 個案例 | ✅ `clampCaseCount(500) = 20`；引擎本身不靜默截斷（由 CLI 攔截） |
| 15 | 授權條件缺少其中一項 | ✅ 逐項驗證；定價缺來源時引擎亦拒絕 |
| 16 | provider／model 與批准設定不一致 | ✅ transport 宣告值可與批准值比對（見 §12 風險） |

### CLI 端到端自測（本機 mock transport，零網絡）

```
SELF-TEST（transport=mock-selftest；非模型輸出）
狀態：completed
呼叫次數：12；重試：0
花費：US$0.028080／上限 US$0.20
已完成：12／12
journal：…/selftest-journal-20261107-144053.jsonl（12 行）
```

`data/app.db` 執行前後 SHA-256 **相同**。輸出明確標示 `transport=mock-selftest` 及「非模型輸出」，不會被當成模型行為證據。

## 7. retry／timeout／429／500 的處理

| 錯誤 | 可重試 | 結果不確定 | 行為 |
| --- | --- | --- | --- |
| timeout | ❌ | ✅ | 立即停止整批，等人工確認（供應商可能已收費） |
| network（請求已送出但無回覆） | ❌ | ✅ | 同上 |
| 429 | ✅（1 次） | ❌ | 重試前檢查預算；仍失敗則該案 `failed` |
| 5xx | ✅（1 次） | ❌ | 同上 |
| 空白回應 | ✅（1 次） | ❌ | 同上 |
| 其他（invalid-response） | ❌ | ❌ | 該案 `failed`，繼續下一條 |

每次重試都會增加 `calls` 及 `retries`，並計入預算——不會有「重試免費」的情況。

## 8. 中斷恢復及重複執行風險

| 問題 | 答案 |
| --- | --- |
| 保留已完成案例？ | ✅ 每完成一條即 append 一行 JSON 到 journal（`onCaseComplete`） |
| 識別未完成案例？ | ✅ journal 中沒有記錄的案例會被重新執行 |
| 重複呼叫已成功案例？ | ❌ 不會（`previous` 中 `status: "ok"` 直接沿用，不呼叫） |
| 識別不完整輸出？ | ✅ `parseJournal` 忽略無法解析的行並回報 `truncatedLines` |
| resume 需人工確認？ | ✅ 若上次有 `outcomeUncertain`，未加 `--confirm-uncertain-resume` 一律拒絕 |
| 假設重試一定安全？ | ❌ 不假設：timeout／network 一律當不確定，不自動重試 |

剩餘風險：**「請求已送達但本地沒有回覆」仍可能已在供應商端計費**。引擎以「停止 + 人工確認」處理，而非自動重跑；因此最壞情況是多付極少數（≤1 次）呼叫的費用，而不是無限重試。

## 9. Case ID 重疊分析

三份集合**不可以直接相加**：186 → **173 條獨立問題**（11 個重複組、13 條重複記錄）。映射由 [tests/fixtures/tutor-case-id-map.ts](../tests/fixtures/tutor-case-id-map.ts) 從三份來源推導（非手寫），並有 7 項契約測試。

| 集合 | 案例數 |
| --- | --- |
| 教師矩陣 | 83 |
| 模擬矩陣 | 91 |
| 受控評估集 | 12 |
| 合計（含重複） | 186 |
| **去重後獨立問題** | **173** |

已辨識的主要重複組（每組只可計一次）：

| 重複問題 | 來源 |
| --- | --- |
| 「點解？」 | `teacher:H-01`、`simulation:SIM-51`、`live:live-10` |
| 「美國在1942年才正式參戰，對嗎？」 | `teacher:I-01`、`simulation:SIM-47`、`live:live-12` |
| 「什麼是明治維新」 | `simulation:SIM-01`、`live:live-01` |
| 「什么是种族隔离」 | `simulation:SIM-58`、`live:live-11` |
| 「佢有咩影響」 | `simulation:SIM-61`、`live:live-06` |
| 「邊隊贏咗昨晚場波」 | `simulation:SIM-74`、`live:live-07` |
| 「冷戰期間嘅足球比賽有咩政治意義」 | `simulation:SIM-81`、`live:live-09` |
| 「請引用《凡爾賽條約》第 231 條的原文」 | `simulation:SIM-85`、`live:live-05` |
| 「什麼是文藝復興」 | `teacher:A-01`、`simulation:SIM-83` |
| 「即係點解」 | `teacher:H-02`、`simulation:SIM-54` |
| 「羅馬帝國為何滅亡」 | `teacher:L-03`、`simulation:SIM-60` |

`buildEvidenceSkeleton()` 每組只取一條，並把三層證據固定為 `not-run`／`not-run`／`pending-human-review`；有測試斷言**不存在** `teacher-approved`。

## 10. 私隱及資料庫完整性證據

| 檢查 | 證據 |
| --- | --- |
| 引擎不可能寫資料庫 | 測試以原始碼斷言：不 import `db/connection`、`repositories/*`、`llm/*`，不含 `fetch(` 或 `node:sqlite` |
| 引擎不發出請求 | 全部 31 項測試用注入式 mock；計劃模式測試以 `fetch` spy 斷言未呼叫 |
| 不寫學生對話／紀錄 | 引擎只回傳 `records`；`onCaseComplete` 只寫指定 journal |
| 不改配額 | 未使用 `reserveAiOperation`（它會寫 `ai_operations`） |
| 不覆寫舊結果 | 計劃／journal 皆 `wx`；resume 顯式要求 `--resume`（實測兩次覆寫均被拒） |
| `data/app.db` 不變 | 自測前後 SHA-256 相同；教師套件匯出前後亦相同 |
| 不輸出 secrets | 只補未設定的環境變數、**從不輸出值**；計劃 JSON 已檢查不含 `API_KEY`／`sk-` |
| 合成問題 | 資料集測試斷言無電郵、學號、電話 |
| 教材全文不外送 | 評估只送查詢＋提示詞；不含教材全文（教材節錄只留在本機教師套件） |

## 11. 全套測試結果

| 命令 | Passed | Failed | Skipped | Not run |
| --- | --- | --- | --- | --- |
| `npx vitest run --maxWorkers=4` | **2,486**（164 個檔案） | 0 | 4 | 0 |
| `tests/tutor-eval-engine.test.ts`（新） | 31 | 0 | 0 | 0 |
| `tests/tutor-case-id-map.test.ts`（新） | 7 | 0 | 0 | 0 |
| `npm run typecheck` | ✅ | 0 | — | — |
| `npm run lint` | 0 error（1 項既有 warning） | 0 | — | — |
| `npm run build` | ✅ | 0 | — | — |
| `npm run verify:build` | ✅ | 0 | — | — |
| `npm run test:ui` | 22 | 0 | **9**（不計為通過） | 0 |
| `npm run release:gate` | `READY WITH LIMITATIONS` | — | — | — |
| GitHub Actions CI | — | — | — | **未運行**（未推送） |

沒有為了取得綠燈而刪減或放寬任何既有測試；唯一的測試改動是為既有 plan fixture 補上新增欄位，以及把「計劃成本上限」測試改為要求提供定價（並同時斷言未提供時為 `null`）。

## 12. 未解除風險

1. **無 live transport**：在擁有者決定 (a) 或 (b) 之前，12 次評估**無法執行**。
2. **0.05 美元在 Sprint 31 假設下不足**（US$0.0627）；需提高至 ≥0.07 或降低 `maxOutputTokens`／案例數。
3. **定價未確認**：本報告不宣稱任何供應商現行價格；工具強制由操作者提供並記錄來源。
4. **provider／model 一致性只作比對，未強制**：引擎回傳 transport 宣告值，但未與批准值硬性綁定（未實作 live transport，暫無實際風險；實作時必須加入硬性檢查）。
5. **模型行為仍然未驗證**：本 Sprint 全部是引擎決策證據，不是模型輸出證據。
6. **教師覆核 0 條**：186 條來源案例（173 條獨立問題）全部 `pending-human-review`。
7. **CI 與正式環境證據缺失**（未推送、gcloud 需重新認證）。

## 13. 最終發布判定

**`READY WITH DOCUMENTED LIMITATIONS`** — 維持不變。

- 本 Sprint 完成的是**執行就緒性**（授權、預算、重試、恢復、記帳、私隱），而不是模型行為驗證。
- 「工具測試通過」**不等於**「模型行為已驗證」。
- 12 次 live evaluation 在擁有者就 §3 的 (a)/(b) 作出決定、並提供實際定價與 ≥必要上限的預算之前，**不應批准執行**。

**建議的下一步（需擁有者批准）**：
1. 決定 live transport 方案（抽取共用 client／批准獨立 adapter）；
2. 提供供應商當期定價及來源；
3. 批准預算（按上表，Sprint 31 假設需 ≥US$0.07）；
4. 以 `--apply --self-test` 的同一路徑改成 live transport 執行 12 條；
5. 把回覆合併入教師套件（`--answers`），由歷史科教師逐題裁決。

**本 Sprint 到此停止。未執行任何真實模型呼叫，未提交、未推送、未部署。**
