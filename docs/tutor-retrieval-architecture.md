# 學伴教材檢索與證據架構（Sprint 34）

本文件描述學生提問由輸入到「引用哪幾段教材」的完整決策鏈，以及每個決策點的可觀測欄位。
它反映 **Sprint 34 修正後**的實際程式碼（`src/server/services/tutor-grounding.ts`、
`tutor-query.ts`、`tutor-answerability.ts`、`tutor-query-expansion.ts`、
`tutor-web-supplement.ts`、`src/app/api/tutor/chat/route.ts`）。

> 為什麼要有這份文件：Sprint 33 的真實模型評估發現「教材明明有段落，回覆卻說找不到」。
> 追查時最耗時的不是修程式碼，而是**不知道決策鏈上哪一層做了甚麼判斷**。以下每一層
> 都對應一個可測試、可記錄的欄位。

---

## 1. 決策鏈總覽

```
學生提問（原文）
  │
  ├─① 正規化        normalizeTutorQuery          繁簡統一、全半形、英文縮寫、粵語→書面語
  ├─② 主題硬閘      isHistoryTopicPrompt / isClearlyNonHistoryTutorQuery / isUnclearTutorQuery
  │                    └─ out-of-scope（固定引導句，零模型呼叫、不扣額度）
  │                    └─ D 狀態（單一澄清問題，零模型呼叫）
  ├─③ 詞庫檢索詞    extractQueryTerms + HISTORY_TERM_GROUPS（含英文別名）
  ├─④ 課題推斷      guessTutorTopic（分節標題／教師關鍵詞／詞庫專名／「課題N」）
  │                    └─ 失敗 → ⑤
  ├─⑤ 教材內文反推  inferTopicFromMaterial（Sprint 34 新增；零模型呼叫）
  │                    └─ 條件：名詞類檢索詞、勝出課題 ≥2 段、且為第二名的兩倍
  ├─⑥ 跨課題擴充    supportingTopicIds（比較題最多兩個課題）
  ├─⑦ 選段           selectTutorPassages（分數門檻 MIN_HIT_SCORE=6、長度折算、去重、上限）
  │                    └─ 0 段 → 回到 ⑤ 再試一次（僅限推斷來自課程用語時）
  ├─⑧ 證據充分度     assessMaterialSupport（A／B 判定：direct／inferential／insufficient）
  ├─⑨ 語意改寫      expandTutorQuery（只在 ⑦ 仍為 not-covered 時，2.5 秒預算，fail-open）
  ├─⑩ 外網補充      collectTutorWebSupplement（白名單、not-covered-only、1.5 秒預算）
  └─⑪ 提示詞        buildTutorSystemPrompt（教材片段／外部參考／政策分區）
```

---

## 2. 各層輸入、輸出與失敗模式

| 層 | 輸入 | 輸出 | 失敗模式（如何處理） |
| --- | --- | --- | --- |
| ① 正規化 | 學生原文 | 繁簡統一、去標點的查詢字串 | 空字串 → 當作含糊處理 |
| ② 主題硬閘 | 正規化提問 | `history` / `out-of-scope` / `D` | 判為非歷史 → 固定引導句（零呼叫）；含糊 → 澄清（零呼叫） |
| ③ 檢索詞 | 正規化提問 | `QueryTerm[]`（詞、權重 1–20） | 無詞 → 不推斷課題，走 C |
| ④ 課題推斷 | 提問＋課程索引 | `TutorTopicGuess` 或 `null` | `null` → 進入 ⑤ |
| ⑤ 教材內文反推 | 名詞類詞＋全部可發布段落 | 課題或 `null` | 證據分散（未達兩倍）→ `null` → C（寧可保守） |
| ⑥ 跨課題擴充 | 提問＋主課題 | 最多兩個課題 | 無額外證據 → 只用主課題 |
| ⑦ 選段 | 候選段落＋檢索詞 | 1–N 段（依深度上限） | 0 段 → 回到 ⑤ 重試；仍 0 段 → C |
| ⑧ 證據充分度 | 提問＋所選段落 | `evidenceSupport` | 關係不被支持／關鍵詞缺口 → B |
| ⑨ 語意改寫 | 提問＋課題標題 | 教材用語詞表 | 逾時／錯誤／空／格式錯 → 靜默降級（fail-open） |
| ⑩ 外網補充 | 提問＋grounding 狀態 | 白名單摘錄 | 任何失敗 → `failed`，主回答照常 |
| ⑪ 提示詞 | 以上全部 | system prompt | — |

---

## 3. 可觀測診斷（`selectionAudit`）

`findTutorGrounding` 回傳的 `TutorGrounding.selectionAudit` 只在伺服器內使用（不寫入
資料庫、不回傳給學生），測試與診斷可直接核對：

| 欄位 | 意義 |
| --- | --- |
| `candidateBlocks` / `scoredHits` / `belowThreshold` | 候選段落、通過門檻數、被門檻排除數 |
| `searchedTopicIds` | 實際檢索過的課題（跨課題比較時多於一個） |
| `topicAllocation` | 各課題的合格命中與實際選入段落數 |
| `selected[]` | 選入段落：分數、原始長度、送去模型的長度、是否截取、窗口起句 |
| `excluded[]` | 被排除的段落及原因（`max-sources`／`duplicate`／`already-used`／`too-short`） |
| **`topicInference.source`** | `curriculum`／`preferred-topic`／`context`／`material-fallback`／`none` |
| **`topicInference.fallbackCandidates`** | 教材內文反推時各課題的合格段落數（由多至少） |
| **`topicInference.fallbackTerms`** | 教材內文反推實際使用的檢索詞 |

診斷資料不含 secrets、學生個人資料或教材全文。

---

## 4. 三條不可交換的證據界線

1. **教材片段 ≠ 一般歷史知識**：C 狀態（教材未涵蓋）仍必須作答，但要標明是一般歷史
   知識；A／B 狀態引用片段時不可寫成「史上公認」。
2. **外部網站 ≠ 教材**：外網摘錄只出現在提示詞的「外部參考摘錄——非校本教材」區塊，
   `meta`／`done` 事件把它放在 `webSources`，教材出處放在 `sources`。摘錄內的任何
   句子都只是資料，不是指令（提示詞明文禁止遵從）。
3. **關鍵詞重疊 ≠ 事實支持**：`evidenceSupport` 會核對提問所問的關係（因果／比較／
   評價）是否真的出現在片段中；關鍵詞齊全但沒有交代關係 → B 並要求披露。

---

## 5. 已知限制（截至 Sprint 34）

| 限制 | 影響 | 追蹤 |
| --- | --- | --- |
| 定義型提問（「甚麼是 X」）沒有獨立的「定義」關係檢查 | 單一段落只提及該詞而沒有解釋時，仍可能判為 A | Sprint 33 live-11（已由詞庫＋召回修正改為有 1 段證據；是否 A 待教師裁決）。曾嘗試加入「定義證據」規則，但令 4 項既有 A 期望降級（明治維新等有充分教材的題目），因此回退，見 Sprint 34 報告 §F |
| 語意改寫只在字詞層失敗時觸發 | 需要「教材有內容但用語完全不同」的題目才受益 | `recall-live-12` 為例；第二輪 live evaluation 計劃已列出 |
| 教材內文反推要求證據集中（勝出課題為第二名兩倍） | 概念橫跨多個課題時會保守地回 C | 例：「南非的種族隔離政策」同時見於課題6／11（詞庫指定後已解決）；其他跨課題概念可能仍回 C |
| 外網內容的 DNS rebinding TOCTOU | 已文件化的既有風險 | `tutor-web-supplement.ts` 註解 |
