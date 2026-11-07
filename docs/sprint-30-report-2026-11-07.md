# Sprint 30 — 受控模型行為、可答性校準與歷史準確度驗證

**日期**：2026-11-07
**基準 Git**：`main`，`HEAD` = `origin/main` = `7d05cb7d9a9b2e5b4b71de0880ff19f158afed82`；工作目錄保留 Sprint 28／29 未提交變更及本 Sprint 變更（沒有 reset／clean／強制 checkout）。
**提示詞版本**：`TUTOR_PROMPT_VERSION = 2026-11-07.2`
**模型呼叫**：**0 次**（未取得付費呼叫授權；見第 3 節）
**提交／推送／部署**：**沒有**

> **結論來源標示（必讀）**
>
> | 來源 | 適用於本報告哪部分 |
> | --- | --- |
> | **確定性測試**（無模型呼叫） | 可答性狀態、C1／C2／C3 判斷、證據支持程度、非歷史邊界、深度、多輪上下文契約、提示詞內容、授權閘門 |
> | **實際模型輸出** | **完全沒有**：本輪 0 次模型呼叫，因此模型是否遵守政策**未經實測** |
> | **歷史科教師覆核** | **完全沒有**：83 條矩陣及 91 條模擬矩陣全部仍為 `pending-human-review` |

---

## 1. 執行摘要

Sprint 29 建立了「檢索失敗不等於拒絕」的四態架構。Sprint 30 的目標是**驗證模型是否真的遵守**，並修正兩個在審計中發現的結構性弱點：

1. **A 狀態原本只看關鍵詞重疊**：所有關鍵詞出現就標示「已對照課本教材」，即使片段只提供背景、沒有交代提問所問的因果／比較／評價。現在新增 `evidenceSupport`，只有 `direct` 可以是 A；`inferential`／`insufficient` 一律降為 B 並要求披露。
2. **C 狀態只有一種謹慎程度**：要求逐字引文或精確數字時，與「什麼是文藝復興」得到同一個政策。現在分為 C1（可靠）／C2（部分或爭議）／C3（無法核實），**C3 仍然必須作答**，只要求說明無法核實的部分及所需證據。

同時修正兩個邊界缺陷：`HISTORICAL_PERIODS` 內任何 4 位年份都令 `hasHistoricalSubjectShape` 返回 true（令「2022年世界盃冠軍係邊隊？」變成歷史提問）；「請引用第 231 條原文」因缺少問句形態而被要求澄清（應為 C3 作答）。

**模型行為驗證因未獲授權而沒有執行**：本輪產出有界的評估計劃與 fail-closed 授權閘門，但沒有呼叫任何付費模型。因此「模型是否遵守 C1／C2／C3 與 A/B 政策」仍屬**未驗證**。

## 2. Sprint 29 架構審計（決策點與拒絕路徑）

| 決策點 | 位置 | 會否造成拒絕 | 結論 |
| --- | --- | --- | --- |
| 歷史提問辨識 | `tutor-answerability.ts` `isHistoricalTutorQuestion` | 只在 `out-of-scope` 時 | 與檢索完全無關（不需資料庫） |
| 明確非歷史 | `tutor-query.ts` `isClearlyNonHistoryTutorQuery` | 是（固定引導句） | 只對明示非歷史（天氣、寫詩等）觸發 |
| 含糊／代詞無上文 | `hasExplicitVagueness`、`hasDanglingReferenceWithoutContext` | 是（澄清） | 語言問題，不是檢索問題 |
| 教材涵蓋 | `assessMaterialSupport` | **否** | 只影響 A／B／C |
| 模型呼叫閘門 | 路線 `answerability.state` | 只有 `D`／`out-of-scope` 會跳過模型 | 檢索失敗（C）**一定**呼叫模型 |
| 回覆標示 | `answerDeclaresNotCovered` 等 | 否 | 只影響標示與出處顯示 |
| 出處生成 | 平台由 `sources` 產生 | 否 | 模型不可自行編號 |

**驗證**：新增測試斷言「教材涵蓋程度為 none 的 91 條模擬案例中，除明確含糊者外全部不是 `out-of-scope` 或拒絕」，以及路線級測試確認 C 狀態會呼叫模型、`out-of-scope` 不會。

## 3. 授權檢查（未執行模型呼叫的原因）

- 已檢查：`.env.local` 有 `DEEPSEEK_API_KEY`、`LLM_MODEL`、`LLM_TIMEOUT_MS`、`LLM_MAX_TOKENS`；應用的每日／全域 AI 限額與 `reserveAiOperation` 均存在。
- **但**：這些是本機開發憑證，不是「授權為本 Sprint 進行付費模型評估」。規格要求無明確授權時只產出計劃及確定性 fixture。**因此沒有呼叫任何模型。**
- 執行所需條件（fail closed，缺一即拒絕）：`--apply`、`TUTOR_EVAL_ALLOW_LIVE_CALLS=1`、`--budget-usd ≥ 計劃上限`。三項齊備時，本版本仍只提供計劃模式，實際執行須擁有者另行啟用。

## 4. C 狀態校準（C1／C2／C3）

| 層級 | 確定性判斷 | 提示詞要求 | 測試 |
| --- | --- | --- | --- |
| C1 | 無引文／精確數字要求、非評價爭議題、有詞庫或課程錨點 | 直接作答並標明「以下屬一般歷史知識」 | 「什麼是明治維新？」「美國革命係幾時開始？」 |
| C2 | 評價／爭議題、史學解釋，或只有題材形態而無錨點 | 只答可靠部分；區分普遍接受與爭議；不可把爭議寫成定論 | 「歷史學家對冷戰結束有咩唔同解釋？」「蒙古帝國點解會分裂？」 |
| C3 | 要求逐字引文、頁／段編號、精確日期、精確數字 | 交代可確認背景 → 說明哪部分無法核實及所需證據 → 不虛構 | 「請引用《凡爾賽條約》第 231 條的原文。」「二戰實際死亡人數係幾多？要準確數字。」「Quote the exact wording…」 |

三者都保留「必須作答」「不可虛構課本段落」「不可聲稱這是教材的說法」。**沒有任何 C 層級轉為拒絕**（測試斷言 `allowGeneralKnowledge` 與 `requireDisclosure` 皆為 true）。

**未驗證**：模型是否真的依 C3 說明「無法核實」而不是自行編造，需實際模型輸出。

## 5. A 狀態證據忠實度

| 情境 | 修正前 | 修正後（測試） |
| --- | --- | --- |
| 關鍵詞齊全但片段沒有交代因果 | A（按標示「已對照課本教材」） | **B**，`evidenceSupport = inferential`，提示詞要求寫成「片段未有直接說明」 |
| 片段直接交代因果 | A | A，`direct` |
| 片段用不同術語（關鍵詞找不到） | B | B（`uncovered-terms`），要求披露 |
| 多部分提問只有一部分有支持 | A／B 不穩定 | B（`multi-part-partial`） |
| 片段只有背景、無提問要求的結論 | A | B（`inferential`） |

**限制（必須如實說明）**：這是詞彙層面的近似判斷（片段出現「因為／導致」等即視為有因果支持），不是語意推論，也不能證明片段內容在歷史上正確。真正的忠實度仍需模型評估及教師覆核。

## 6. 非歷史邊界

新增對照組（SIM-71 至 SIM-82，共 10 條 `not-history`）：體育賽果、天氣、娛樂、科學、數學、創作、近代年份單獨出現。歷史與非歷史混合題（「冷戰期間嘅足球比賽有咩政治意義？」）仍按歷史處理。

修正：`HISTORICAL_PERIODS` 不再把任何 4 位年份視為歷史題材形態；年份仍由 `hasHistoricalYearSignal` 以 1999 年界線處理。

## 7. 多輪對話

確定性路線測試（假模型）已覆蓋 Sprint 29 的五輪明治維新、冷戰轉向；本 Sprint 未新增真實模型多輪測試（未授權）。評估計劃已包含一條帶上文的追問樣本（`live-12`）。

## 8. 假拒絕與假答案統計

| 類別 | 本輪確定性結果 | 真實模型結果 |
| --- | --- | --- |
| 假拒絕 | 0（91 條模擬案例中，教材未涵蓋者全部為 C） | 未測 |
| 不必要澄清 | 0（有錨點＋明確問法的提問不會澄清） | 未測 |
| 錯誤離題 | 0（10 條對照組全部 `out-of-scope`） | 未測 |
| 無據答案 | 未能判斷（需模型輸出） | 未測 |
| 虛構教材出處 | 未能判斷（提示詞已禁止，平台不採用模型自報出處） | 未測 |
| 失實歷史陳述 | 未能判斷 | 未測 |
| 比較不完整 | 結構上已由 `topicEvidence` 缺口偵測，實際回覆未測 | 未測 |
| 難度不當 | 0（矩陣深度契約全綠） | 未測 |
| 證據與推論不分 | 提示詞已強制區分；實際回覆未測 | 未測 |

**不可只用「拒絕少了」作為成功指標**：本輪同時新增了 A→B 的降級（更保守）與 C3（更謹慎），並非單向放寬。

## 9. 教師覆核套件

- 83 條案例完整保留，狀態全部 `pending-human-review`；新增 `evidenceSupport`、`evidenceNotes`、`confidence`、`promptVersion`。
- 91 條模擬矩陣案例全部 `pending-human-review`。
- 套件支援 `--answers` 合併受控評估回覆，但**不會**改變覆核狀態；只有授權教師可填 `teacher-approved`／`teacher-rejected`／`requires-revision`。
- 本輪匯出：83 條、`A=30`、`B=23`、`C=5`（C1=2、C2=3）、`D=3`、`out-of-scope=22`；`answersIncluded=0`；匯出前後 `data/app.db` SHA-256 不變。

## 10. 測試與閘門

| 項目 | 結果 |
| --- | --- |
| `npx vitest run --maxWorkers=4` | **161 個測試檔通過；2,436 通過、4 略過、0 失敗** |
| `tests/tutor-answerability.test.ts` | 229 項通過（含 91 條矩陣逐條狀態／深度／信心層級、C1–C3 政策、A 證據忠實度五個情境、非歷史對照組） |
| `tests/tutor-answerability-route.test.ts` | 11 項通過（路線級、多輪、配額、注入） |
| `tests/tutor-live-eval-plan.test.ts` | 3 項通過（授權閘門 fail closed） |
| `npm run typecheck` | 通過 |
| `npm run lint` | 0 error；1 項既有 warning |
| `npm run build` / `verify:build` | 通過／通過 |
| `npm run test:ui` | 22 通過、9 略過、0 失敗 |
| `npm run release:gate` | `READY WITH LIMITATIONS` |
| GitHub Actions | **未執行**（未推送，沒有候選 commit 的 CI 證據） |

## 11. 安全與成本

- 本輪 0 次模型呼叫、0 次外部網絡請求（評估工具預設計劃模式）。
- 授權閘門以單元測試證明 fail closed；預算不足亦拒絕。
- 提示注入：既有規則及測試保留；本輪未改動授權、限額或 token 上限。
- 私隱：只用合成問題；沒有新增持久化或資料庫 migration。

## 12. 發布判定（分項）

| 面向 | 判定 | 依據 |
| --- | --- | --- |
| 1 軟件正確性 | **通過** | 2,436 項確定性測試、typecheck、lint、build、verify、Playwright |
| 2 可答性正確性 | **通過（確定性）** | 91 條矩陣逐條狀態與信心層級；C 不會變成拒絕 |
| 3 檢索正確性 | **部分** | 只驗證狀態映射與缺口偵測；真實教材召回率未重新量度 |
| 4 歷史準確性 | **未驗證** | 0 次模型呼叫、0 次教師覆核 |
| 5 教學質素 | **未驗證** | 需教師評分 |
| 6 教師核准 | **0 條** | 83 + 91 條全部 `pending-human-review` |
| 7 正式環境驗證 | **未執行** | 未重新認證 gcloud、未以授權帳戶測試登入學生 |

**整體判定：`READY WITH DOCUMENTED LIMITATIONS`（維持不變，不上調）。**
升級為 `READY` 至少需要：①授權後執行有界評估（計劃上限 ≤0.05 美元、12–20 次呼叫）並無重大史實／虛構出處問題；②歷史科教師完成逐題覆核並記錄決定；③候選 commit 的 CI（含 Playwright）通過；④正式環境 revision／流量及登入學生的行為經核實。

## 13. 交付清單

1. 本報告。
2. [受控模型評估計劃](tutor-live-evaluation-plan-2026-11-07.md)（含授權要求、成本上限、樣本）。
3. 實際模型呼叫證據：**無**（未授權）。
4. 歷史答案品質評估：**未執行**（無回覆可評）。
5. 假拒絕／假答案統計：確定性部分見第 8 節；真實模型部分未測。
6. A／B／C／D 校準發現：第 4、5 節。
7. 教師覆核套件：83 條（`tutor-review-packet-sprint30.json`，全部待覆核）。
8. 回歸測試：`tests/tutor-answerability.test.ts`（229）、`tests/tutor-answerability-route.test.ts`（11）、`tests/tutor-live-eval-plan.test.ts`（3）。
9. 文件：[可答性政策](tutor-answer-quality-policy.md)、[教師覆核流程](tutor-teacher-review-process.md)、README。
10. 未解除阻塞：模型行為未實測、歷史內容未覆核、CI 未跑、正式環境未驗證。
