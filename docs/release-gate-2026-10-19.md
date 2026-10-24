# 發布就緒閘門（2026-10-19）

**結果：READY WITH LIMITATIONS**

> 唯讀檢查；未定義標準或沒有證據的項目不會當作通過。

| 閘門 | 狀態 | 證據摘要 | 分子／分母 |
| --- | --- | --- | --- |
| 隔離／待教師確認（question-isolation） | ✅ PASS | 沒有題目帶待教師確認標記 | 0／3282 |
| 題目結構可作答（question-servability） | ✅ PASS | 所有已發布題目均可作答 | 0／3282 |
| 考核答案的改寫來源（answer-provenance） | ✅ PASS | 已裁決 18 題考核答案改寫（無未決項目） | 0／18 |
| 來源可追溯性（source-traceability） | ✅ PASS | 可定位 3282／3282；待核實 0；無法追溯 0 | 3282／3282 |
| 解釋品質（explanation-quality） | ✅ PASS | 佔位 0、只列答案 0、疑似矛盾 0 | 0／3282 |
| 元數據完整性（metadata） | ⚠️ WARN | 技能空白 1917；難度值 basic／advanced／challenge；阻擋級關聯錯誤 0 | 1917／3282 |
| 未處理的教師裁決（teacher-decisions） | ✅ PASS | 待目前版本覆核 0；未結回報 0 | 0／— |
| 審核證據來源（review-provenance） | ⚠️ WARN | 教師逐題裁決 0；只有擁有者批次 3282；只有自動修復 0；完全沒有證據 0 | 0／3282 |
| 版權與教材發行權（copyright） | ✅ PASS | 擁有者已確認版權；可向學生發布 22／46 份；逐份權利紀錄 46 份 | 46／46 |
| Golden evaluation dataset（golden-evaluation） | ✅ PASS | 已覆核 15／15（2026-10-19.1） | 15／15 |
| 結構不可作答題目的處置（servability-adjudication） | ✅ PASS | 不可作答 0 題；已核對原始證據 95 題；可直接由原文補標示的修復候選 0 題；已有教師裁決 0 題；仍待教師裁決 0 題 | 0／0 |
| 自動修復證據的風險分布（provenance-risk） | ✅ PASS | P0（可能改變答案／評分）0；P1（題幹改變但考核答案不變）0；P2（原始證據不足）0；P3（純格式／內容相同）0 | 0／0 |
| Golden Dataset 人工核准（golden-approval） | ✅ PASS | 已核准 fixture 15；待教師核准候選 41；裁決因題目改動而失效 0 | 15／56 |
| 測試與建置證據（tests） | ✅ PASS | 測試、型別、lint、build 全部通過（證據檔） | 0／24 |
| 正式環境／部署驗證（deployment） | ✅ PASS | 已提供正式環境證據 | —／— |

## 與上次報告比較

| 指標 | 上次 | 現在 | 變化 |
| --- | --- | --- | --- |
| 佔位解釋 | 1334 | 0 | -1334 |
| 只列答案解釋 | 548 | 0 | -548 |
| 技能空白 | 1882 | 1917 | +35 |
| 來源無法追溯 | 0 | 0 | +0 |

## 建議與未決政策

### 元數據完整性（WARN）

- 教師提供技能標籤；不要在未經確認下填入預設值
- 修正無效課題／分節關聯

### 審核證據來源（WARN）

- 由負責人決定：內容不變的自動修復紀錄是否足以支持目前版本，或需教師逐題確認
- 不得把 admin 角色或批次授權當成逐題教師審核
- 保留原始紀錄，不重新標記歷史

## 資料來源

- database：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\data\app.db
- testsEvidence：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\docs\release-evidence-2026-10-19.json
- deploymentEvidence：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\docs\deployment-evidence-2026-10-19.json
- golden：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\docs\teacher-review\golden-questions.v2.json
- provenance：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\docs\teacher-review\repair-provenance-2026-10-19.json
- contentQueue：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\docs\teacher-review\content-quality-queue-2026-10-19.json
- servabilityEvidence：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\docs\quality\servability-evidence-2026-10-19.json
- provenanceRisk：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\docs\quality\provenance-risk-2026-10-19.json
- goldenCandidates：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\docs\teacher-review\golden-candidates-2026-10-19.json

