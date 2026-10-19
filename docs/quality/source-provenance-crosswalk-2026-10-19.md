# Provenance 風險 × 來源可追溯性交叉分析（Sprint 14，唯讀）

產生時間：2026-10-19T07:44:03.731Z

## 總數

| 指標 | 數量 |
| --- | --- |
| provenanceQuestions | 623 |
| provenanceUniqueQuestions | 623 |
| provenanceDuplicateRows | 0 |
| sourcePendingQuestions | 1003 |
| sourceTraceableQuestions | 877 |
| overlapProvenanceAndSourcePending | 124 |
| automationOnlyWithinProvenance | 623 |
| teacherAdjudicatedWithinProvenance | 0 |
| humanEvidenceWithinProvenance | 0 |
| hasDiffButNoTraceableSource | 31 |
| noPreRepairSnapshot | 0 |
| needsSourceFirst | 31 |

### 重疊題目的等級分布

| 等級 | 題數 |
| --- | --- |
| P1 | 31 |
| P3 | 93 |

## 來源狀態 × provenance 等級

| 來源狀態 | P0 | P1 | P2 | P3 |
| --- | --- | --- | --- | --- |
| traceable | 0 | 499 | 0 | 0 |
| pending_verification | 0 | 31 | 0 | 93 |

## 解讀

- 623 題只有自動修復證據，其中 **124** 題同時屬於「來源待核實」。
- 其中 **31** 題有修復前後差異但來源不可追溯：需要先補來源，才可能有有效覆核。
- 這 623 題中沒有教師逐題裁決（0 題）；P3 只代表排序較後。
- 沒有修復前可比較內容（originalStem 為 null）：0 題。

## 限制

- 「重疊」＝同一題同時屬於 provenance 風險清單與來源待核實清單；兩份清單定義不同，重疊不代表同一種缺陷。
- automationOnly 由 review provenance 報告判定（目前版本只有自動修復證據）。
- 「有修復差異但來源不可追溯」＝P0／P1 且 sourceStatus ≠ traceable；這些題目需要先補來源才可能有有效覆核。

