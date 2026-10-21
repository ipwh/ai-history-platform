# 2026-10-21 全題庫 AI 核對及發布紀錄

## 1. 授權原文

> 題目太多，沒可能做人工覆核。你用教材及網上權威資源查證題目及答案，替我覆核並發布。

授權人：`ipwh@pochiu.edu.hk`（擁有者／歷史科教師）。

## 2. 這次做了甚麼

| 步驟 | 內容 | 結果 |
| --- | --- | --- |
| 1 | 以正式快照 `data/exports/production-next.db` 為對象 | 2,082 題（已發布 2,056、草稿 26） |
| 2 | 建立逐題核對工具（教材段落檢索 + DeepSeek API + 確定性檢查） | 2,082 題全部完成；校準 20/20 抓到故意改錯的答案 |
| 3 | 逐題裁決所有被標示的題目（教材段落、需要時查權威網上資源） | 33 題修正、2 題刪除、3 題維持原答案（模型誤報） |
| 4 | 套用修正（`fix-question-content`）及刪除（`apply:question-queue`） | 每題 `revision` +1；沒有寫入任何覆核紀錄 |
| 5 | 修正後重新核對 33 題 | 全部 `correct`（信心 90–100） |
| 6 | 26 條待教師確認的草稿：逐題核對為 `correct`（信心 85–100）後解除暫緩 | 原暫緩理由保留在 `quality_warnings_json`，另附決定紀錄 |
| 7 | 發布全部 26 條草稿 | 2,080 題全部 `published`、`teacher_confirmation_required = 0` |
| 8 | 上載正式快照並重啟 Cloud Run | revision `history-self-study-00031-fxx`，100% 流量；`/api/health` 200、還原 13,256 KB |
| 9 | 由 bucket 重新下載正式資料庫核對內容 | 2,080 題全部已發布、0 條待確認、修正及刪除均已生效、`integrity_check = ok` |

## 3. 修正及刪除

- 33 題修正：完整新值、現值及理由見
  [answer-fixes-2026-10-21.json](../quality/answer-fixes-2026-10-21.json) 及
  [逐題核對報告](../quality/answer-verification-2026-10-21.md) 第 4 節。
- 2 題刪除（`qb-NJCMN0040000014`、`qb-NJCMN0040000023`）：題幹只寫「圖中…」，
  平台不支援題目附圖，學生無法作答；作答、回報及覆核紀錄均為 0。

主要錯誤類型：

1. **答案與教材矛盾**（例：`qb-JTH2ndEdMCQ05065` 科學革命始於十六世紀，原答案十七世紀；`qb-NJCMN0120000036` 四項均屬有利因素）。
2. **題幹與教材矛盾**（例：`qb-NJCFN0120000040` 房屋協會是民間組織；`qb-NJCFN0070000007` 殖民地法案由總督批准）。
3. **多於一個正確答案**（例：`qb-JTH2ndEdMCQ05069` 皇家學會與法國科學院；`qb-JTH2ndEdMCQ10007` 冷戰描述）。
4. **原卷術語與教材不一致**（例：`qb-NJCFN0070000056` 烏鴉法例／吉姆·克勞法；`qb-NJCFN0030000001` 基伯爾／加百列）。
5. **解釋與答案或教材矛盾**（例：`qb-NJCFN0120000063` 區域市政局 1986 年才成立；`qb-JTH2ndEdFBQ08015` 兩局年份倒置）。

## 4. 發布及紀錄

| 檔案 | 內容 |
| --- | --- |
| [answer-verification-2026-10-21.jsonl](../quality/answer-verification-2026-10-21.jsonl) | 2,082 題的逐題核對結果（已按題號去重，保留最後判定） |
| [answer-verification-2026-10-21-adjudication.json](../quality/answer-verification-2026-10-21-adjudication.json) | 校準、3 題維持原答案的裁決、權威網上資源 |
| [answer-fixes-2026-10-21-decisions.json](../quality/answer-fixes-2026-10-21-decisions.json) | 33 題修正的新值及理由 |
| [content-fixes-applied.json](../quality/content-fixes-applied.json) | 修正套用紀錄（含 revision 前後） |
| [owner-overrides-ai-2026-10-21.json](owner-overrides-ai-2026-10-21.json) | 26 題解除待教師確認的決定 |
| [owner-publication-overrides-ai-2026-10-21.json](owner-publication-overrides-ai-2026-10-21.json) | 26 題發布紀錄 |
| [answer-verification-2026-10-21.md](../quality/answer-verification-2026-10-21.md) | 完整報告 |

## 5. 明確不聲稱的事項

1. 這 2,080 題**沒有**教師逐題覆核紀錄；`question_reviews` 仍是 40 筆，本輪沒有新增。
   教師端會如實顯示「已發布（未經人工覆核）」。
2. AI 核對可能漏報；校準只證明「故意改錯的答案能被抓出」，不證明「沒有錯的題目一定正確」。
3. 教材段落檢索以字詞重疊排序，部分題目（尤其校內試題）未必抽到最相關段落。
4. 知識點欄位有少量匯入時留下的異常值；本輪沒有改動，因為修改會令既有教師覆核紀錄失效。
5. `release:gate` 的 `review-provenance` 及 `source-traceability` 仍會 FAIL；這是如實狀態，
   除非日後真的進行逐題教師覆核。

## 6. 回滾

| 回滾點 | 位置 |
| --- | --- |
| 上載前的正式資料庫 | `gs://pccss-ai-history-history-backup/history/data/app.db.pre-answer-verification-20261021T0806Z` |
| 本機修正前快照 | `data/backups/production-next-pre-answer-fixes.db` |
| 上一個 Cloud Run revision | `history-self-study-00030-4f6`（保留，可切回 100% 流量） |
