# Sprint 33 — Tutor Live Evaluation, Staging Verification & Release Readiness

**日期**：2026-11-07
**基線**：`main` @ `7d05cb7`（工作目錄含 Sprint 28–33 未提交工作，共 13 個修改、31 個新增）
**Live evaluation 授權**：本次規格第 5 節明示授權 12 個案例、最多 20 次 provider attempts、總費用 ≤ US$0.10
**最終判定**：
- LIVE EVALUATION：**`LIVE EVALUATION VERIFIED`**
- MODEL QUALITY：**`QUALITY REQUIRES FIXES`**
- STAGING：**`READY FOR STAGING VALIDATION`**
- PRODUCTION：**`NOT READY FOR PRODUCTION`**
- 整體發布判定維持：**`READY WITH DOCUMENTED LIMITATIONS`**

---

## 1. Executive verdict

Sprint 33 打通了真正的 live transport，並在授權範圍內完成 12 次真實模型呼叫（0 重試、總成本 **US$0.012599**、12/12 成功、`data/app.db` SHA-256 不變）。**這是本專案第一次有真實模型輸出作為證據**，之前的 Sprint 30–32 全部只有 deterministic／mock 證據。

真實輸出證明：模型在**證據紀律**上表現良好——A 狀態忠實引用教材、C3 拒絕虛構條文、C2 以立場光譜陳述爭議、B 狀態主動披露「片段沒有交代」、錯誤前提（「美國 1942 年才參戰」）被更正、追問能保留上文並主動更正自己上一則回覆的證據層級。

但真實輸出同時暴露一個**deterministic 層的嚴重缺口**：12 條中有 4 條（33%）模型宣稱「教材找不到這部分的內容」，而教材**實際有**相關段落（種族隔離 9 段、珍珠港 7 段、第二次世界大戰 97 段、美國革命 44 段、法國大革命 59 段）。缺口不在教材、不在模型，而在 **問題→課題推斷與跨語言詞彙對應**（`findTutorGrounding` 回 `not-covered`，模型於是如實轉述我們的錯誤）。

因此：**工具與流程已可安全執行真實評估（VERIFIED）；模型輸出的歷史準確性良好，但答案層的「教材覆蓋陳述」不可靠（REQUIRES FIXES）；不可進入正式環境（NOT READY FOR PRODUCTION）。**

---

## 2. Sprint 28–32 工作保留情況

| 項目 | 狀態 |
| --- | --- |
| Sprint 28 跨課題檢索與選段平衡 | 保留（`src/server/services/tutor-grounding.ts` 未回退） |
| Sprint 29 可答性四態 | 保留（`tutor-answerability.ts`／`tutor-answerability-prompt.ts`，229 項測試） |
| Sprint 30 `evidenceSupport` 與 C1／C2／C3 | 保留（`tutor-depth.ts`、`tutor-query.ts`、`tutor.ts`） |
| Sprint 31 12 條評估資料集與教師套件 | 保留（`tests/fixtures/tutor-live-eval-dataset.ts`、`scripts/export-tutor-review-packet.ts`） |
| Sprint 32 評估引擎 | 保留（`src/server/quality/tutor-eval-engine.ts`，31 項 mock 測試） |

沒有執行 `git reset --hard`、`git clean`、強制 checkout，沒有覆蓋任何未提交檔案。

---

## 3. Git baseline／working tree

- branch：`main`，HEAD `7d05cb7`。
- 修改（13）：`README.md`、`package.json`、`scripts/release-gate.ts`、`src/app/api/tutor/chat/route.ts`、`src/server/services/tutor-{depth,grounding,query}.ts`、`src/server/services/tutor.ts`、`tests/tutor-{grounding-api,language-regression,retrieval-regression,student-query-matrix,topic-scope-regression}.test.ts`。
- 新增（31）：Sprint 28–33 的文件、fixture、測試與 2 個 release-gate 證據檔。
- 未 commit、未 push、未 deploy。

---

## 4. Live transport 架構變更（方案 A）

新增 `src/server/llm/stream-chat-completion.ts`，把原本內嵌在 `src/app/api/tutor/chat/route.ts` 的上游串流邏輯抽出成**同一個** server-side adapter：

- `openChatStream()`：建請求、送上游、**在開始串流前**檢查狀態碼（保留 route 既有的「上游 5xx → HTTP 503」行為，3 項既有回歸測試仍然通過）。
- `consume()`：讀 SSE、抽取 delta、抽取 usage。
- 錯誤分類：`missing-api-key`／`timeout`／`network`／`rate-limited`／`server-error`／`invalid-response`／`empty`／`aborted`，並以 `outcomeUncertain` 標示「已送出但未確認」的情況（禁止自動重試）。
- `includeUsage` 預設 `false`：正式 route 的請求 body 完全不變，只有評估模式要求 provider 回報 usage。

正式 route 改用 `openChatStream` ＋ `upstream.consume({ signal, onDelta })`，以 `AbortController` 取代原本的 `streamReader`；學生可見行為不變。

評估側 `scripts/lib/tutor-live-transport.ts` 以**同一個** `buildTutorSystemPrompt()` 組提示詞，並硬性比對 provider／model 與批准設定一致，不一致即拒絕執行。沒有第二套 ad-hoc provider fetch。

---

## 5. 正式 Tutor route regression evidence

| 檢查 | 結果 |
| --- | --- |
| 上游 5xx → HTTP 503（串流前） | 通過（`tests/tutor-simulation.test.ts` 3 項） |
| 澄清／離題分支不呼叫主回答模型 | 通過（`tutor-answerability-route.test.ts` 11 項） |
| 串流正常完成／中途失敗／429／500／timeout／abort／usage 存在．缺失．異常／格式不符／缺 API key／model 不一致 | 通過（`tests/stream-chat-completion.test.ts` 25 項） |
| 全套 Vitest | 167 檔 / 2,524 通過 / 4 略過 / 0 失敗 |

---

## 6. Provider／model 官方定價來源

| 項目 | 值 |
| --- | --- |
| Provider | DeepSeek（`LLM_PROVIDER=deepseek`） |
| Model ID | `deepseek-flash`（`LLM_MODEL`，與 `cloudbuild.yaml` 一致） |
| 官方定價頁 | <https://api-docs.deepseek.com/quick_start/pricing> |
| 查證日期 | 2026-11-07 |
| 官方定價（高峰時段、快取未命中） | 輸入 ¥2／1M tokens；輸出 ¥8／1M tokens |
| 換算假設 | 1 USD = 6.5 CNY（人民幣走強方向，屬保守高估） |
| 換算後 | 輸入 $0.3077／1M；輸出 $1.2308／1M |
| 額外收費 | 無最低消費；快取命中價較低（本評估一律以未命中價計算，屬上界） |

`scripts/lib/provider-pricing.ts` 對未知模型直接拋錯（`pricingForModel`），不會默默用示例價。

---

## 7. 12-case 實際執行結果

| # | 案例 | 語言 | 期望 | 分類器實判 | 深度 | 教材片段 | attempts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| live-01 | 什麼是明治維新？ | zh-Hant | A | A | standard | grounded／3 | 1 |
| live-02 | 法國為何介入美國獨立戰爭？ | zh-Hant | B | A | advanced | grounded／4 | 1 |
| live-03 | 甘地提倡的不合作運動是甚麼？ | zh-Hant | C1 | C2 | advanced | not-covered／0 | 1 |
| live-04 | 史家對冷戰結束原因的解釋 | zh-Hant-yue | C2 | B | challenge | grounded／5 | 1 |
| live-05 | 引用《凡爾賽條約》第 231 條原文 | zh-Hant | C3 | B | advanced | grounded／4 | 1 |
| live-06 | 佢有咩影響？ | zh-Hant-yue | D | D | advanced | not-covered／0 | 1 |
| live-07 | 邊隊贏咗昨晚場波？ | zh-Hant-yue | out-of-scope | out-of-scope | standard | not-covered／0 | 1 |
| live-08 | Compare the causes of the American and French Revolutions… | en | — | C2 | challenge | not-covered／0 | 1 |
| live-09 | 冷戰期間嘅足球比賽有咩政治意義？ | mixed | — | B | advanced | grounded／4 | 1 |
| live-10 | 點解？（冷戰結束追問） | zh-Hant-yue | — | A | standard | grounded／3 | 1 |
| live-11 | 什么是种族隔离？ | zh-Hans | C2 | C2 | standard | not-covered／0 | 1 |
| live-12 | 美國在1942年才正式參戰，對嗎？ | zh-Hant | — | C2 | advanced | not-covered／0 | 1 |

A/B/C1/C2/C3/D/out-of-scope、多部分比較、中英混合、粵語追問、繁體、英文、簡體全部覆蓋。

---

## 8. 實際 input／output tokens

Journal：`files/live-eval-journal-20261107-161539.jsonl`（版本庫外）

| 項目 | 值 |
| --- | --- |
| 案例數 | 12（12 成功、0 失敗） |
| Provider HTTP attempts | 12（重試 0） |
| Input tokens | 20,778 |
| Output tokens | 5,044 |
| `costBasis` | 全部 `actual-usage` |
| 缺 usage／異常 usage 案例 | 無 |

---

## 9. 每題成本及總成本

- 總成本：**US$0.012599**（12,599 micro-USD）。
- 授權上限：US$0.10 → 使用率 12.6%。
- 執行前保守上限估算：US$0.0431（輸入 72,000 × $0.3077/M ＋ 輸出 17,000 × $1.2308/M）；最壞情況（每案多 1 次重試，共 24 次呼叫）約 US$0.086，仍 ≤ US$0.10。
- 全部金額以整數 micro-USD 計算，無浮點誤差。
- **此為內部估算，不等同供應商帳單的硬性上限。**

逐題用量與成本：

| 案例 | Input tokens | Output tokens | 成本（USD） |
| --- | --- | --- | --- |
| live-01 | 1,674 | 255 | $0.000829 |
| live-02 | 2,215 | 611 | $0.001434 |
| live-03 | 1,518 | 511 | $0.001096 |
| live-04 | 2,556 | 715 | $0.001666 |
| live-05 | 2,485 | 275 | $0.001103 |
| live-06 | 1,287 | 210 | $0.000654 |
| live-07 | 901 | 106 | $0.000407 |
| live-08 | 1,511 | 703 | $0.001330 |
| live-09 | 2,318 | 624 | $0.001481 |
| live-10 | 1,668 | 239 | $0.000807 |
| live-11 | 1,124 | 236 | $0.000636 |
| live-12 | 1,521 | 559 | $0.001156 |
| **合計** | **20,778** | **5,044** | **$0.012599** |

---

## 10. Retry／timeout／usage missing 處理

- 12 次全部首次成功，未觸發重試；因此「429／5xx 重試後仍失敗」「重試後成功」在真實路徑**未被實際觸發**（只有 31 項 mock 測試覆蓋）。
- timeout／network 依政策**不自動重試**（`outcomeUncertain`）。
- usage 缺失時以保守上限記帳並標示 `cost-unknown`；本次未出現。

---

## 11. 每題模型輸出品質評估

維度各 0–4；分數由 AI 依實際輸出評分，**只作教師覆核輸入，不構成教師裁決**。完整理由見 `files/sprint33-live-evaluation.json`。

| # | 歷史準確 | 證據忠實 | 可答性 | 教學質素 | 語言 | 追問延續 |
| --- | --- | --- | --- | --- | --- | --- |
| live-01 | 4 | 4 | 4 | 4 | 4 | — |
| live-02 | 4 | 4 | 4 | 4 | 4 | — |
| live-03 | 3 | 2 | 2 | 3 | 4 | — |
| live-04 | 4 | 3 | 4 | 4 | 4 | — |
| live-05 | 4 | 4 | 4 | 4 | 4 | — |
| live-06 | 4 | 4 | 4 | 4 | 4 | — |
| live-07 | 4 | 4 | 4 | 4 | 4 | — |
| live-08 | 4 | 2 | 2 | 4 | 3 | — |
| live-09 | 4 | 4 | 4 | 4 | 4 | — |
| live-10 | 4 | 4 | 4 | 4 | 4 | 4 |
| live-11 | 4 | 2 | 2 | 4 | 3 | — |
| live-12 | 4 | 2 | 2 | 4 | 4 | — |
| **平均** | **3.92** | **3.25** | **3.33** | **3.92** | **3.83** | **4.00** |

### 主要發現

1. **歷史準確性高（3.92）**：無捏造史實、無混淆事件。所有具體年份（1868、1773、1774、1775、1776、1939、1941-12、1991）皆正確。
2. **證據忠實度是弱項（3.25）**：4 條「教材找不到」屬錯誤陳述（見第 14 節）。
3. **C3 完全合規**：live-05 明確拒絕引用第 231 條原文，並聲明「不可自行背出條文充當教材內容」，只提供「戰爭罪責條款」這一可靠背景及所需證據。教材中「231」0 段，拒絕屬正確。
4. **C2 合規**：live-04 以「立場甲／乙＋弱點」呈現史學爭議，明言「沒有公認定論」；live-11 披露「史學界對個別政策影響程度仍有不同評價」。
5. **B 狀態披露良好**：live-02、live-09 明確列出「片段支持甚麼、找不到甚麼」。
6. **錯誤前提處理優秀**：live-12 更正為 1941 年 12 月珍珠港事件後正式參戰，並區分「正式參戰」與「全面投入作戰」。
7. **追問延續優秀（4.0）**：live-10 保留冷戰上文，並**主動更正**自己上一則回覆：「我上一則回覆提到『經濟壓力與軍備競賽』，那屬於一般背景補充，並非教材片段內容」——這是本批輸出中最有價值的證據紀律表現。
8. **詞彙變體**：live-04、live-10 用「戈巴契夫」，教材用「戈巴卓夫」（教材 80 段，前者 0 段）。非虛構史實，但會令學生對照課本時困惑，屬教學用語問題。
9. **語言一致性**：live-08（英文提問）正文為英文，結尾卻接中文樣板句；live-11 簡體提問以繁體作答（香港校內可接受，交由教師裁決）。

### 缺陷統計（12 條樣本）

| 類別 | 次數 |
| --- | --- |
| False refusal | 0 |
| Unnecessary clarification | 0 |
| Incorrect out-of-scope classification | 0 |
| Unsupported historical claim | 0 |
| Fabricated textbook reference | 0 |
| Fabricated quotation | 0 |
| Fabricated exact date or number | 0 |
| **Incorrect material-coverage claim** | **4** |
| B state presented as direct evidence | 0 |
| C3 failed to disclose | 0 |
| C2 presented as settled | 0 |
| Incomplete answer | 2（live-03、live-08） |
| Incorrect premise accepted | 0 |
| Difficulty mismatch | 1（live-03） |
| Language mismatch | 2（live-08、live-11） |
| Follow-up context loss | 0 |

**沒有為減少拒答而犧牲準確性，也沒有為提高準確性而變成拒答機器**：12 條全部作答（除 D／out-of-scope 的正當澄清），0 假拒絕。

---

## 12. 案例映射及審核狀態（186 → 173 → 12）

| 來源集合 | 數量 | 說明 |
| --- | --- | --- |
| 教師矩陣（`tutor-student-query-matrix`） | 83 | 全部保留，未被覆蓋 |
| 模擬矩陣（`tutor-simulation-matrix`） | 91 | 全部保留 |
| 受控評估資料集（`tutor-live-eval-dataset`） | 12 | 本 Sprint 新執行 |
| 合計 | 186 | 去重後 **173** 個獨立問題（`tests/fixtures/tutor-case-id-map.ts`，7 項測試） |

三層證據嚴格分開，不合併成單一通過狀態：

- **deterministic**：分類器狀態、深度、選段、`evidenceSupport`。
- **liveModel**：實際回覆、provider、model、prompt version、時間、tokens、成本。
- **teacherDecision**：一律 `pending-human-review`。

`teacher-approved` = **0**。

---

## 13. Teacher review package

`files/tutor-review-packet-sprint33.json`（版本庫外，`wx` 防覆寫）：

- 83 條教師矩陣（`review.status` 全部 `pending-human-review`）。
- **新增 `liveEvaluationCases` 共 12 條**，每條含 `expected`／`deterministic`／`liveModel`／`teacherDecision` 四段，以及 `duplicateGroup` 追溯。
- `liveEvaluationAnswersIncluded = 12`。
- `promptVersion = "2026-11-07.2"`。
- 匯出前後 `data/app.db` SHA-256 相同：`B7ED64EC…F9E22C6`（28,688,384 bytes，mtime 未變）。
- 未輸出任何 secret、學生個人資料或教材全文。

教師評分將可指出具體歷史錯誤、證據缺口及教學問題（每條已附 `reviewerNotes`），而非只給整體滿意度。流程見 `docs/tutor-teacher-review-process.md`。

---

## 14. 檢索召回缺口（本 Sprint 最重要的缺陷）

| 案例 | 模型宣稱 | 教材實際 | 分類器 | 可救回方式（deterministic 驗證） |
| --- | --- | --- | --- | --- |
| live-11 什么是种族隔离？ | 找不到 | 「種族隔離」9 段、「南非」9 段 | not-covered | `preferredTopicId=topic-11` → grounded（1 段） |
| live-12 美國在1942年才正式參戰，對嗎？ | 找不到 | 「珍珠港」7 段、「第二次世界大戰」97 段 | not-covered | `extraTerms=[珍珠港, 第二次世界大戰]` → grounded（topic-9，3 段） |
| live-08 英文比較美國／法國革命 | 找不到 | 「美國革命」44 段、「法國大革命」59 段 | not-covered | `extraTerms=[美國革命, 法國大革命]` → grounded（topic-7，3 段） |
| live-03 甘地提倡的不合作運動是甚麼？ | 找不到 | 「不合作」4 段（hs-topic-5） | not-covered | **未解決**：補 `extraTerms` 仍 not-covered |

**性質**：這是 deterministic 層的召回缺口（問題→課題推斷、跨語言詞彙對應），模型只是如實轉述「沒有片段」。它屬於「保守錯誤」而非虛構，但會令學生誤以為課本沒有涵蓋已涵蓋的內容，並且使期望 A／B 的案例被降為 C。

**未在本 Sprint 修正的理由**：Sprint 33 授權範圍是評估與證據；在 live 評估完成後改動可答性判定會令本報告 12 條證據失效。已用 `tests/tutor-retrieval-recall-gap.test.ts`（6 項特徵測試）把現狀固定，修正時必須同步更新該檔。

**修正計劃**：擴充課題關鍵詞／別名表（人物、地名、制度詞）→ 英文查詢先做中文詞彙對應 → `hs-topic-5` 納入課題索引 → 更新特徵測試。

---

## 15. 完整測試結果

| 項目 | Passed | Failed | Skipped | Not run |
| --- | --- | --- | --- | --- |
| Vitest（全套） | **2,524**（167 檔） | 0 | 4 | 0 |
| Typecheck（`next typegen && tsc --noEmit`） | 通過 | 0 | — | — |
| Lint（`eslint`） | 0 error | 0 | — | 1 warning（`tests/…:29 'fs' is defined but never used`，既有） |
| Build（`next build`） | 通過 | 0 | — | — |
| verify（`verify:build`） | 通過（0 頁被預先渲染） | 0 | — | — |
| Playwright | **22** | 0 | **9** | 0 |
| release gate | `READY WITH LIMITATIONS` | 0 | — | — |
| Tutor streaming adapter | 25 | 0 | 0 | 0 |
| Live evaluation engine（mock） | 31 | 0 | 0 | 0 |
| 授權閘門／預算 | 31（含於上列） | 0 | 0 | 0 |
| Resume／journal | 31（含於上列） | 0 | 0 | 0 |
| 檢索召回缺口（新增特徵測試） | 6 | 0 | 0 | 0 |

Release gate WARN（與 Sprint 32 相同，未解決）：`metadata` 技能空白 1,917 題；`review-provenance` 教師逐題裁決 0。

---

## 16. CI 狀態

**NOT RUN**。本 Sprint 未 commit、未 push，因此沒有候選 commit，也沒有遠端 CI 執行。這是發布條件之一，尚未滿足。

---

## 17. Production 狀態

`NOT READY FOR PRODUCTION`。

Staging readiness 稽核（只讀，未部署、未改任何設定）：

| 檢查 | 結果 |
| --- | --- |
| Build | 通過（`next build`、`verify:build`） |
| 環境變數鍵名（未讀值） | `.env.local` 29 個鍵；`.env.example` 沒有任何 assignment（見風險 R5） |
| 部署設定 | `cloudbuild.yaml`：`LLM_PROVIDER=deepseek`、`LLM_MODEL=deepseek-flash`、`LLM_THINKING=disabled`、`LLM_MAX_TOKENS=8192` 與本機一致 |
| Secrets | `--set-secrets` 注入 `AUTH_SECRET`、`DEEPSEEK_API_KEY`、roster service account、Google OAuth；未寫入任何 log 或檔案 |
| 角色隔離 | 既有 e2e／模擬腳本覆蓋（未在本次重跑） |
| Tutor API authorization | `AUTH_REQUIRE_SIGN_IN=true`、校域限制 |
| 配額隔離 | `tutorDailyUsage`（15 次／日）＋ `reserveAiOperation`；評估模式**不經**這條路徑，不扣學生額度 |
| 串流／timeout／abort | 25 項 adapter 測試通過 |
| 資料庫 migration | `APP_DATABASE_PATH=/tmp/data/app.db`（每次啟動由 backup 還原後跑 migration）；本次只讀檢查，未執行任何正式 migration |
| Cloud Run revision／traffic | **未讀取**（本環境未認證 gcloud）；`gcloud run deploy` 未帶 `--no-traffic`，部署即切流量 |
| Health checks／rollback | 未驗證 |

**正式環境與評估的關鍵差異（必須計入判定）**：正式 route 在 `not-covered` 時還有兩段評估**未覆蓋**的流程——`expandTutorQuery`（語意改寫後重試檢索，2.5 秒）與 `collectTutorWebSupplement`（`TUTOR_WEB_SUPPLEMENT_ENABLED=true`、`not-covered-only`，1.5 秒）。因此第 14 節的「教材找不到」在正式環境**有可能**被改寫重試救回；本報告不作「產品必然誤稱未涵蓋」的結論。

---

## 18. 未解除風險

| # | 風險 | 嚴重度 | 說明 |
| --- | --- | --- | --- |
| R1 | 檢索召回缺口導致錯誤的「教材未有涵蓋」陳述 | **高** | 樣本中 33%（4/12）；期望 A／B 被降為 C；未修正 |
| R2 | 評估未覆蓋 `expandTutorQuery` 與 web supplement | 中 | 12 次授權不足以覆蓋；正式行為可能不同 |
| R3 | 教師覆核進度為 0 | 高 | 83 條教師矩陣與 12 條 live 案例全部 `pending-human-review` |
| R4 | 「戈巴契夫／戈巴卓夫」用語不一致 | 低 | 不影響史實正確性，影響課本對照 |
| R5 | `.env.example` 無任何 assignment | 低 | 新環境無法由範本推導所需設定 |
| R6 | Release gate 2 項 WARN（技能空白 1,917、教師逐題裁決 0） | 中 | 與 Sprint 32 相同，未解決 |
| R7 | 無候選 commit，因此無 CI 證據 | 高 | 發布條件未滿足 |
| R8 | `gcloud run deploy` 無 `--no-traffic` | 中 | 部署即切流量，回滾需人工執行 |
| R9 | 真實路徑未實際觸發 429／5xx 重試 | 低 | 只有 mock 證據 |
| R10 | 成本為內部估算 | 低 | 不等同供應商帳單硬上限 |

---

## 19. 明確下一步

1. **修正 R1**：擴充課題關鍵詞／別名表與跨語言對應，令 `種族隔離`、`珍珠港`、`二戰`、英文革命比較題可命中；同步更新 `tests/tutor-retrieval-recall-gap.test.ts`。
2. **補做授權範圍內的第二輪 live 評估**（需 owner 另行批准，例如 8 條 × 最多 2 次呼叫 ≈ US$0.02），覆蓋 `expandTutorQuery` 與 web supplement 路徑，特別是 C 狀態與 D／out-of-scope 的產品行為。
3. **教師覆核**：由歷史科教師就 12 條 live 輸出作裁決（重點：live-03 的完整性、live-08／live-11 的語言、live-04／live-10 的「戈巴卓夫」用語），並更新 `teacherDecision`。
4. **修正 R4／R5**（低風險、可與其他工作一併處理）。
5. **修正後重跑**：Vitest、typecheck、lint、build、verify、Playwright、release gate。
6. **候選 commit ＋ CI**：需要 owner 明確授權 commit／push，才能取得第 16 節缺失的 CI 證據。
7. **Staging 驗證**：在確認目標為 staging、資料隔離、具部署權限後，以 `--no-traffic` 部署並核對 revision、health、rollback。

---

## 20. 仍需要 owner／歷史科教師批准的工作

| 項目 | 需要誰批准 |
| --- | --- |
| 第二輪 live 模型評估（額外呼叫與預算） | 專案 owner |
| `git commit`／`git push`／CI 執行 | 專案 owner |
| Staging 部署（含 `--no-traffic` 政策） | 專案 owner |
| Production 部署、流量切換、正式學生 rollout | 專案 owner（本 Sprint 未授權） |
| 任何歷史內容的 `teacher-approved` | **只可由獲授權的歷史科教師** |

---

## 附錄：證據分層聲明

| 結論 | 依據 |
| --- | --- |
| 12 次真實呼叫成功、成本 US$0.012599、0 重試 | **實際模型輸出**（journal ＋ `sprint33-live-evaluation.json`） |
| 歷史準確性 3.92、無捏造史實／引文／年份 | **AI 依實際輸出的評分**，`pending-human-review`，**不是**教師裁決 |
| 4 條錯誤「教材找不到」陳述 | **實際模型輸出** ＋ **deterministic** 教材查詢與檢索探針 |
| 召回缺口可被 `preferredTopicId`／`extraTerms` 救回 | **deterministic** 探針（`tests/tutor-retrieval-recall-gap.test.ts`） |
| 串流 adapter、429／500／timeout／usage 處理 | **deterministic**（mock，25 項） |
| 預算、重試、resume、journal 行為 | **deterministic**（mock，31 項） |
| 83 條教師矩陣、91 條模擬、173 去重 | **deterministic** |
| 教師核准 0、發佈仍需教師裁決 | **人類歷史科教師**（尚未發生） |
| CI、Cloud Run revision／traffic、health、rollback | **未驗證**（NOT RUN／未讀取） |

> 本 Sprint 沒有把 mock execution、plan-only 或 deterministic tests 描述成 live model verification；反之，也沒有把 12 次成功的 live 輸出描述成教師核准或 production 驗證。
