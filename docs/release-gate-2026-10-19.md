# 發布就緒閘門（2026-10-19）

**結果：NOT READY**

> 唯讀檢查；未定義標準或沒有證據的項目不會當作通過。

| 閘門 | 狀態 | 證據摘要 | 分子／分母 |
| --- | --- | --- | --- |
| 隔離／待教師確認（question-isolation） | ✅ PASS | 沒有題目帶待教師確認標記 | 0／1880 |
| 題目結構可作答（question-servability） | ❌ FAIL | 97 題已發布但結構上不可作答（派發層會攔下，學生不會收到；仍需修正或改回草稿） | 97／1880 |
| 考核答案的改寫來源（answer-provenance） | ✅ PASS | 已裁決 18 題考核答案改寫（無未決項目） | 0／18 |
| 來源可追溯性（source-traceability） | ⏳ POLICY_PENDING | 可定位 877／1880；待核實 1003；無法追溯 0 | 877／1880 |
| 解釋品質（explanation-quality） | ⏳ POLICY_PENDING | 佔位 1334、只列答案 546、疑似矛盾 0 | 1880／1880 |
| 元數據完整性（metadata） | ⏳ POLICY_PENDING | 技能空白 1880；難度值 basic；阻擋級關聯錯誤 0 | 1880／1880 |
| 未處理的教師裁決（teacher-decisions） | ✅ PASS | 待目前版本覆核 0；未結回報 0 | 0／— |
| 版權與教材發行權（copyright） | ⚠️ WARN | 擁有者已確認版權；可向學生發布 12／36 份；逐份權利紀錄 12 份 | 12／36 |
| Golden evaluation dataset（golden-evaluation） | ❔ INSUFFICIENT_EVIDENCE | 資料集為空：評估證據不足（不是零錯誤） | 0／0 |
| 測試與建置證據（tests） | ✅ PASS | 測試、型別、lint、build 全部通過（證據檔） | 0／8 |
| 正式環境／部署驗證（deployment） | ❔ INSUFFICIENT_EVIDENCE | 沒有 Cloud Run／正式資料庫／備份還原證據 | —／— |

## 與上次報告比較

| 指標 | 上次 | 現在 | 變化 |
| --- | --- | --- | --- |
| 佔位解釋 | 1334 | 1334 | +0 |
| 只列答案解釋 | 548 | 546 | -2 |
| 技能空白 | 1882 | 1880 | -2 |
| 來源無法追溯 | 0 | 0 | +0 |

## 建議與未決政策

### 題目結構可作答（FAIL）

- 修正題幹／選項／答案，或把題目改回草稿；修正後重新覆核

### 來源可追溯性（POLICY_PENDING）

- 為校內試題建立文件紀錄（檔名、題號、雜湊）及匯入批次，或由教師確認來源

### 解釋品質（POLICY_PENDING）

- 由產品負責人決定佔位／只列答案的題目是否暫緩派發
- 疑似矛盾只進入教師覆核佇列，不自動裁定

### 元數據完整性（POLICY_PENDING）

- 教師提供技能標籤；不要在未經確認下填入預設值
- 修正無效課題／分節關聯

### 版權與教材發行權（WARN）

- 保留擁有者確認紀錄；如需逐份授權證明，另行補存
- 版權許可不等於歷史內容正確

### Golden evaluation dataset（INSUFFICIENT_EVIDENCE）

- 由歷史科教師建立至少一組已覆核樣本

### 正式環境／部署驗證（INSUFFICIENT_EVIDENCE）

- 部署後完成登入、權限、備份還原及健康檢查

## 資料來源

- database：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\data\app.db
- testsEvidence：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\docs\release-evidence-2026-10-19.json
- deploymentEvidence：（未提供）
- golden：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\docs\teacher-review\golden-questions.v1.json
- provenance：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\docs\teacher-review\repair-provenance-2026-10-19.json
- contentQueue：D:\OneDrive - PO CHIU CATHOLIC SECONDARY SCHOOL\AI\AI History Platform\docs\teacher-review\content-quality-queue-2026-10-19.json

