# Sprint 28 follow-up — 學伴答案品質與發布覆核

**日期**：2026-11-07  
**基線**：`main`／`7d05cb7d9a9b2e5b4b71de0880ff19f158afed82`  
**結論**：本機程式驗證已完成；發布閘門為 **READY WITH LIMITATIONS**。教師歷史覆核、提問數量差異，以及正式環境現況仍未解決。本輪沒有提交、推送或部署。

## 完成項目

| 範圍 | 結果 |
| --- | --- |
| 跨課題檢索 | 明確比較多個課題時，選段按課題輪替；相鄰段落合併不跨課題，提示詞標出課題及逐課題命中／選段數。零段或不足以支持比較時，要求回答披露證據缺口。 |
| 間接比較追問 | 有上文時支援「比較兩者」等代詞追問；一般單課題問題不因上文提過其他課題而擴大檢索。 |
| 教師覆核 | 新增[教師覆核流程](tutor-teacher-review-process.md)及唯讀套件匯出 CLI。套件不呼叫模型、沒有實際答案，83 條案例全部保持 `pending-human-review`。 |
| 稽核與私隱 | 選段 audit 仍只存在於單次請求；沒有新增資料庫 migration。文件提出最小化持久化設計及審批前提。 |
| 發布證據 | Release gate 證據使用 UTF-8 寫入、預設時間戳檔名及拒絕覆寫；輸出驗證檔放在版本庫以外。 |

## 驗證結果

- `npx vitest run --maxWorkers=8`：158 個測試檔通過；2,192 項通過、4 項略過。
- 學伴／矩陣／release-output 目標測試：5 個檔案、59 項通過。
- `npm run typecheck`、`npm run build`、`npm run verify:build`：通過；確認沒有頁面被預先渲染。
- `npm run lint`：0 errors；有一項既有 warning：`scripts/verify-questionbank-sync.ts` 的未使用 `fs`。
- `npm run test:ui`：22 項通過、9 項略過，沒有失敗；包含學伴澄清及回覆深度 UI 流程。此工作流程在 GitHub Actions 只於手動選擇執行、且使用具 `content-database` 標籤的 self-hosted runner 時執行。
- 教師套件匯出：83 條案例的自動軟體檢查全部通過；58 條執行教材檢索、選入 192 段。實際答案為 0 條，83 條均待教師覆核。匯出前後 `data/app.db` 的 SHA-256 相同。
- 最終 `npm run release:gate`：**READY WITH LIMITATIONS**。警告包括 3,282 題中 1,917 題技能欄位空白，以及 3,282 題只有擁有者批次紀錄、沒有逐題教師裁決。不能視為所有 gate 已乾淨通過。

第一次未限制 worker 數的完整 Vitest 執行有 2 項名冊測試因 `fetch failed` 失敗；`tests/roster.test.ts` 單獨執行 23 項全通過，之後以受限 worker 完整重跑亦全數通過。沒有修改名冊程式碼。Build 另有非阻擋 Turbopack warning：`src/server/db/backup.ts` 的動態檔案存取令 tracing 涵蓋整個專案；UI `next start` 亦提示 standalone 輸出模式的啟動方式。兩者均未由本輪引入。

## 未解除的阻塞

1. **提問數量不一致**：驗收附件要求保留 73 條；版本控制中的矩陣實際有 83 條。本輪保留全部 83 條，沒有刪除任何案例；需要矩陣擁有者確認額外 10 條與附件清單的對應後，才能關閉數量驗收。
2. **教師歷史覆核未完成**：沒有核對實際模型回答；所有答案歷史正確性、材料充分度、教學適切性及語言品質仍待真人教師覆核。待覆核不是核准。
3. **正式環境未能重驗**：先前唯讀探測的公開 `/api/health` 為 200，匿名 `/tutor` 導向登入；但 `gcloud` 要求互動式重新認證，無法核實目前 Cloud Run revision／traffic，也沒有授權測試帳戶可驗證登入學生的完整行為。Release gate 的部署 PASS 是既有證據，不代表本輪未提交的程式已部署。
4. **CI 候選版本證據缺失**：基線 commit 的 GitHub Actions run `42337917761` 成功，但本輪變更未推送，故沒有候選 commit 的 CI 結果。

由於 gate 結果仍為 `READY WITH LIMITATIONS` 且上述覆核／正式環境證據不足，依驗收要求停止於本機驗證；不提交、不推送、不部署。
