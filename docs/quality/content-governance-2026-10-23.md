# 內容治理狀態報告（2026-10-23）

本報告只做**唯讀**分析與建議。**沒有**修改任何題目內容、答案、選項、解釋、技能標籤，
亦沒有改動任何發布狀態、覆核紀錄或產品政策預設。

## 一、資料來源與方法

| 項目 | 說明 |
| --- | --- |
| 資料庫 | `data/app.db`（以 `readOnly: true` 開啟，只讀） |
| 發布閘門 | `npx tsx scripts/release-gate.ts --database data/app.db --out-json … --out-md …`（輸出只寫入暫存目錄，未覆寫 `docs/release-gate-2026-10-19.*`） |
| 題目可作答性 | 以 `checkQuestionServable()` 逐一核對 2,148 題已發布題目（唯讀，不寫入） |

## 二、發布閘門結果：**NOT READY**（2026-10-23 修正後重跑）

| 閘門 | 狀態 | 摘要 |
| --- | --- | --- |
| 隔離／待教師確認 | ❌ FAIL | 17 題仍待教師確認（17／2,179） |
| 題目結構可作答 | ✅ **PASS** | 所有已發布題目均可作答（0／2,144） |
| 考核答案的改寫來源 | ✅ PASS | 已裁決 18 題，無未決項目 |
| 來源可追溯性 | ⏳ POLICY_PENDING | 可定位 1,181／2,179；待核實 998；無法追溯 0 |
| 解釋品質 | ✅ PASS | 佔位 0、只列答案 0、疑似矛盾 0 |
| 元數據完整性 | ⏳ POLICY_PENDING | 技能空白 1,877；阻擋級關聯錯誤 0 |
| 未處理的教師裁決 | ❌ FAIL | 4 筆未結回報 |
| 審核證據來源 | ❌ FAIL | 完全沒有逐題證據 2,179 題（只有批次／自動修復紀錄不可當成教師逐題覆核） |
| 版權與教材發行權 | ⚠️ WARN | 可向學生發布 1／36 份；逐份權利紀錄 12 份 |
| Golden evaluation | ❔ INSUFFICIENT_EVIDENCE | 資料集為空（不是零錯誤） |
| 結構不可作答題目的處置 | ✅ **PASS** | 不可作答 0 題（原 4 題已修正並回到草稿） |
| 自動修復證據的風險分布 | ⏳ POLICY_PENDING | P0 0；P1 530；P2 0；P3 93 |
| Golden Dataset 人工核准 | ❔ INSUFFICIENT_EVIDENCE | 已核准 0；待教師核准候選 42 |
| 測試與建置證據 | ✅ PASS | 測試、型別、lint、build 全部通過 |
| 正式環境／部署驗證 | ✅ PASS | 已提供正式環境證據 |

與上次報告比較：佔位解釋 1,334 → **0**；只列答案解釋 548 → **0**；技能空白 1,882 → 1,877；
來源無法追溯 0 → 0。

### 稽核摘要

- 題目總數 2,179（已發布 2,144、草稿 35）
- 難度分佈：basic 1,899／advanced 129／challenge 137（2026-10-23 補題前）
- 政策分類：hard_block 23、teacher_review 2,566、warning 1,877、policy_pending 0；
  有 hard block 的題目 21 題；教師覆核級 1,825 題；可發布 338 題

## 三、4 題已發布但結構上不可作答 —— **已於 2026-10-23 修正**

擁有者 2026-10-23 指示「替我刪去年份」。已由 `npm run fix:chronology-stem`（清單驅動、
預設模擬、`--apply` 需 `--actor`）套用，清單見
[docs/teacher-review/chronology-stem-fixes-2026-10-23.json](../teacher-review/chronology-stem-fixes-2026-10-23.json)。

- **只改題幹**：答案、選項、解釋、知識點及教材依據完全沒有改動。
- 4 題套用後**回到草稿**、`revision` 由 1 → 2（舊覆核紀錄隨之失效）。
- 修正後即時再跑 `checkQuestionServable`：**已發布題目 2,144 題全部可作答（0 題不可作答）**。

| question_id | 課題 | 處理 |
| --- | --- | --- |
| `q_50f32ae95b34472e` | topic-3 | 刪去 610／622／630 年 |
| `q_7844cb66c67345a1` | topic-7 | 刪去 1854／1860／1861 年，並把題幹列出的事件次序打亂（原本次序＝正確答案） |
| `q_8835fdb1acbf4e00` | topic-8 | 刪去 1866／1870／1882 年，並把三個團體的列出次序打亂（原本次序＝正確答案） |
| `q_68d1f356d1f94dd4` | topic-9 | 刪去 1933／1935／1938／1942 年 |

> 套用時工具自動攔下了兩個原本會「改完仍然有問題」的個案（刪去年份後題幹的列出次序
> 與正確答案完全相同＝答案外洩），補上打亂次序後才寫入。這類判斷不會由程式自動猜測，
> 必須逐題寫在清單內。

**待教師處理**：這 4 題現在是草稿，需在 `/teacher/questions` 覆核後重新發布（未修正前
它們本來就派不到學生，因此對學生沒有影響）。

## 三之二、2026-10-23 補題（草稿）

按第二節的缺口，已為 `topic-6`、`topic-9` 補選擇題（`--types mc --count 6 --draft-only`）：

| 課題 | 新增草稿 | 進階 | 挑戰 |
| --- | ---: | ---: | ---: |
| topic-6 | 4 | +3 | +1 |
| topic-9 | 10 | +6 | +4 |
| topic-11 | 0（兩個分節已達每難度 2 題目標） | — | — |

生成時使用本地示範生成（`LLM_PROVIDER` 未載入，`mock`），全部為**草稿**，需教師逐題覆核後
才可在題目管理發布；本報告沒有自動發布任何題目。

> ⚠️ 過程中發現並修正一個程式缺陷：`--draft-only` 原本只停用「示範模式自動發布」，
> 通過自動品質驗證的題目仍會被 `recordAutoValidationAndPublish()` **直接發布**。
> 本次 14 題因此一度被自動發布，已全部改回草稿；修正見 `question-service.ts`
> （新增 `autoPublish` 選項）及 `question-bank.ts`，並補上回歸測試
> （`tests/question-bank-difficulty.test.ts`：`draftOnly 只建立草稿`）。

## 四、其他待處理項目

- **17 題待教師確認**：不會派給學生（三條發布路徑均會攔下），需教師在題目管理覆核。
- **35 題草稿**：包括第三節修正後的 4 題、第三之二節新增的 14 題補題，以及原有的 17 題待確認。
- **4 筆未結回報**：學生回報待處理，見 `/teacher/reviews`（教師端）。
- **技能空白 1,877 題**：見下方建議，維持空白。
- **Golden 資料集為空**：評估證據不足（不是零錯誤）。

## 五、產品建議（維持現狀，**不改預設**）

1. **`EXPLANATION_HOLD_POLICY` 維持 `off`。**
   現時解釋品質已達標（佔位 0、只列答案 0、疑似矛盾 0），無需以 hold 作為品質閘門；
   若開啟 `placeholder-or-answer-only`，可派發題目會由 1,875 題減至 **0 題**，學生將完全
   無法練習。此為政策選擇，維持現狀最符合現有證據。
2. **解釋內容：抽樣確認即可，不必重審全庫。**
   閘門已無佔位／只列答案的解釋。建議每課題抽取 5–10 題（全庫約 60–120 題）由教師確認
   「有實質推理」，而不是重審 2,148 題。
3. **技能標籤：維持 NULL 為主。**
   若要試行，只選**單一課題**、由教師逐題確認後才寫入；不要在未經確認下以推測值填滿。
   現有選擇題／填充題實際上只能考核 9 項技能中的 1–2 項，補標籤不會令題目考核更多技能。
4. **Golden Dataset：先做一課題 20–40 題的試點。**
   不自動填入、不把 pending 當 approved；題目內容一改，相關裁決須重新核准。
5. **高中課題：只在教材與題目齊備後才用既有 `publish:senior` 發布。**
   學生端目前不會看到未發布課題（模擬已核對：`hs-topic-*` 不在課題清單，直接以 API
   建立練習回 404）。

## 六、批次工具的安全界線（已核對，無需修改文件）

- `npm run flag:content-improvement`：**預設模擬且唯讀**；`--apply` 必須另加 `--actor <電郵>`；
  只寫 `question_content_flags`，不改題目、答案或發布狀態。
- `npm run explanation:apply`：**預設模擬且唯讀**；`--apply` 必須另加 `--actor`；
  **只改 `explanation`**（答案／選項／題幹不變）、保留發布狀態、`revision` +1、
  不寫 `question_reviews`。
- `npm run fix:chronology-stem`：**預設模擬且唯讀**；`--apply` 必須另加 `--actor`；
  **只改題幹**、題目回到草稿、`revision` +1。
- 三者的說明已完整記錄於 `README.md`，本輪**沒有**執行任何大批 `--apply`。

## 六之二、把本機內容同步到正式環境（**本輪未執行**）

本輪已部署程式碼（rev `history-self-study-00048-lsr`，Next.js 16.4.1，見
[deployment-evidence-2026-10-23.json](../deployment-evidence-2026-10-23.json)），
但**沒有**上載資料庫快照：正式資料庫（46 份教材文件、26,599 段）比本機（36 份）新，
直接上載本機 `data/app.db` 會令正式環境遺失較新的教材內容。

因此本輪的內容修正（4 題題幹、14 題補題草稿）目前只在本機 `data/app.db`。要同步，請在
**非上課時段**（沒有學生正在作答）按以下順序執行，並全程以正式快照為起點：

```powershell
# 1. 先下載正式環境最新的資料庫快照（不要用本機的 app.db 作起點）
gcloud storage cp gs://pccss-ai-history-history-backup/history/data/app.db .\prod-snapshot.db

# 2. 在快照副本上套用同一份清單（預設模擬，確認後加 --apply）
npx tsx scripts/fix-chronology-stem-years.ts --manifest docs/teacher-review/chronology-stem-fixes-2026-10-23.json --database .\prod-snapshot.db
npx tsx scripts/fix-chronology-stem-years.ts --manifest docs/teacher-review/chronology-stem-fixes-2026-10-23.json --database .\prod-snapshot.db --apply --actor ipwh@pochiu.edu.hk

# 3. 上載並立即以新 revision 重新啟動，令容器由新快照還原
gcloud storage cp .\prod-snapshot.db gs://pccss-ai-history-history-backup/history/data/app.db
gcloud run services update history-self-study --project pccss-ai-history --region asia-east2 --update-env-vars DEPLOY_MARKER=<時間戳>

# 4. 重新下載核對（例如已發布但不可作答的題目應為 0）
npx tsx scripts/audit-servability.ts --database .\prod-snapshot.db
```

注意：舊 revision 每 60–300 秒可能寫入自己的備份，因此第 3 步的上載與重新啟動必須連續完成；
14 題補題草稿亦要由教師在正式環境逐題覆核後才可發布。

## 七、本輪沒有做的事

- 沒有改寫任何 `correct_answer`、選項、`explanation` 或技能標籤（第三節只刪題幹的年份）。
- 沒有把任何題目由草稿發布、或把待確認題目標成已確認（補題一律留在草稿）。
- 沒有偽造 Golden 或覆核紀錄。
- 沒有改動 `EXPLANATION_HOLD_POLICY` 等政策預設。
- 沒有對 `data/app.db` 執行 migration／flag／apply／publish；本輪只按擁有者指示刪去 4 題題幹的
  年份（經清單工具，預設模擬、`--apply` 需 `--actor`）及產生 14 題**草稿**。
