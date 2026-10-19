/**
 * 97 題不可作答題目的裁決包（Sprint 18）。
 *
 * 只把既有唯讀工作清單（`docs/quality/adjudication-worklist-*.json`）轉成教師可直接
 * 使用的 CSV 及可列印 HTML。這裡**不讀資料庫、不寫資料庫、不作任何裁決**：
 * 所有欄位都是已記錄證據的搬運，`mustStayQuarantined` 一律保持 true。
 */
export interface WorklistReview {
  records: number;
  currentHumanReview: boolean;
  latestDecision: string | null;
  latestReviewer: string | null;
  latestReviewedAt: string | null;
}

export interface WorklistItem {
  questionId: string;
  revision: number;
  fingerprint: string;
  status: string;
  teacherConfirmationRequired: boolean;
  issueCode: string;
  issueCategory: string;
  structuralReason: string;
  questionType: "mc" | "fill" | string;
  correctAnswer: string | null;
  acceptedAnswers: string[];
  gradingPoints: string[];
  gradingMethod: string;
  sourceLocation: string | null;
  sourceBlockIds: string[];
  hasOriginalFile: boolean;
  evidenceStatus: string | null;
  evidenceCategory: string;
  evidenceCategoryLabel: string;
  evidenceLines: string[];
  missingEvidence: string[];
  provenance: { tier: string; riskClass: string; basis: string } | null;
  review: WorklistReview;
  suggestedNextStep: string;
  mustStayQuarantined: boolean;
  lastAuditedAt: string;
  dataSources: string[];
}

export interface WorklistReport {
  generatedAt: string;
  notice: string;
  totals: {
    questions: number;
    romanLabelMissing: number;
    answerLeak: number;
    autoRepairCandidates: number;
    mustStayQuarantined: number;
  };
  byEvidenceCategory: Record<string, number>;
  romanByEvidenceCategory: Record<string, number>;
  items: WorklistItem[];
}

export const PACKET_CATEGORIES = [
  "original_available",
  "original_inconsistent",
  "original_missing",
  "locator_missing",
  "machine_undecidable",
] as const;

export const CATEGORY_GUIDANCE: Record<string, string> = {
  original_available: "原卷可取得且可核對；教師核對後才可考慮「核准修復」。",
  original_inconsistent: "原卷存在但陳述數與選項指涉不一致；必須由教師按原卷核對。",
  original_missing: "原卷缺失；未能取得前只能維持隔離，或由科組決定永久不派發。",
  locator_missing: "原文段落無法定位；重新定位前維持隔離。",
  machine_undecidable: "機器無法可靠判斷；必須由教師按原卷裁決。",
};

export const DECISION_OPTIONS = [
  "已核對原卷並確認可補回標示：核准修復（仍需結構檢查通過）",
  "退回草稿（保留題目，暫不派發）",
  "要求補充證據（列明缺少的原卷或段落）",
  "永久不派發（標示不可用）",
] as const;

interface Column {
  header: string;
  read: (item: WorklistItem) => string;
}

const COLUMNS: Column[] = [
  { header: "題號", read: (item) => item.questionId },
  { header: "版本", read: (item) => String(item.revision) },
  { header: "內容指紋", read: (item) => item.fingerprint },
  { header: "目前狀態", read: (item) => item.status },
  { header: "題型", read: (item) => (item.questionType === "fill" ? "填充題" : "選擇題") },
  { header: "問題代碼", read: (item) => item.issueCode },
  { header: "結構原因", read: (item) => item.structuralReason },
  { header: "證據類別", read: (item) => item.evidenceCategoryLabel },
  { header: "原卷檔案（已上載）", read: (item) => (item.hasOriginalFile ? "有" : "未在本機上載紀錄") },
  {
    header: "原卷可核對",
    read: (item) =>
      item.evidenceCategory === "original_available" || item.evidenceCategory === "original_inconsistent"
        ? "是（依證據類別）"
        : "否",
  },
  { header: "原卷定位", read: (item) => item.sourceLocation ?? "（無）" },
  { header: "原卷段落", read: (item) => item.sourceBlockIds.join(" ") || "（無）" },
  {
    header: "原文證據",
    read: (item) => item.evidenceLines.join(" ／ ") || "（無核對紀錄）",
  },
  { header: "正確答案", read: (item) => item.correctAnswer ?? "（無）" },
  {
    header: "可接受答案",
    read: (item) => item.acceptedAnswers.join(" ｜ ") || "（無）",
  },
  { header: "評分方式", read: (item) => item.gradingMethod },
  { header: "評分要點", read: (item) => item.gradingPoints.join(" ｜ ") || "（無）" },
  {
    header: "缺少的證據",
    read: (item) => item.missingEvidence.join("；") || "（未記錄）",
  },
  {
    header: "Provenance 風險",
    read: (item) =>
      item.provenance ? `${item.provenance.tier}／${item.provenance.riskClass}` : "（不適用）",
  },
  {
    header: "覆核紀錄數（任何來源）",
    read: (item) => String(item.review.records),
  },
  {
    header: "最新覆核紀錄（未必是教師裁決）",
    read: (item) =>
      item.review.latestDecision
        ? `${item.review.latestDecision}（${item.review.latestReviewer ?? "?"}，${item.review.latestReviewedAt ?? "?"}）`
        : "沒有",
  },
  { header: "覆核紀錄數", read: (item) => String(item.review.records) },
  { header: "建議下一步", read: (item) => item.suggestedNextStep },
  { header: "必須維持隔離", read: (item) => (item.mustStayQuarantined ? "是" : "否") },
  { header: "最後稽核時間", read: (item) => item.lastAuditedAt },
  { header: "資料來源", read: (item) => item.dataSources.join(" ") },
];

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""').replace(/\r?\n/g, " ⏎ ")}"`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface AdjudicationPacket {
  csv: string;
  html: string;
  stats: {
    rows: number;
    byCategory: Record<string, number>;
    withReviewRecords: number;
    withVerifiableOriginal: number;
    mustStayQuarantined: number;
  };
}

export function buildAdjudicationPacket(report: WorklistReport): AdjudicationPacket {
  const items = report.items;
  const rows = items.map((item) => COLUMNS.map((column) => csvCell(column.read(item))).join(","));
  const csv = [COLUMNS.map((column) => csvCell(column.header)).join(","), ...rows].join("\r\n");

  const byCategory: Record<string, number> = {};
  for (const item of items) {
    byCategory[item.evidenceCategory] = (byCategory[item.evidenceCategory] ?? 0) + 1;
  }

  const summaryRows = PACKET_CATEGORIES.filter((category) => byCategory[category] !== undefined)
    .map(
      (category) =>
        `<tr><td>${escapeHtml(category)}</td><td>${escapeHtml(CATEGORY_GUIDANCE[category] ?? "")}</td><td class="num">${byCategory[category]}</td></tr>`,
    )
    .join("\n");

  const sections = PACKET_CATEGORIES.filter((category) => byCategory[category] !== undefined)
    .map((category) => {
      const group = items.filter((item) => item.evidenceCategory === category);
      const cards = group
        .map((item) => {
          const options = DECISION_OPTIONS.map(
            (label) => `<li><span class="box"></span>${escapeHtml(label)}</li>`,
          ).join("\n");
          const evidence =
            item.evidenceLines.length > 0
              ? item.evidenceLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")
              : "<li>（沒有原文核對紀錄）</li>";
          return `<article class="card">
  <h3>${escapeHtml(item.questionId)} <span class="muted">第 ${item.revision} 版｜${escapeHtml(item.status)}｜${escapeHtml(item.questionType === "fill" ? "填充題" : "選擇題")}</span></h3>
  <dl>
    <dt>結構原因</dt><dd>${escapeHtml(item.structuralReason)}</dd>
    <dt>內容指紋</dt><dd class="mono">${escapeHtml(item.fingerprint)}</dd>
    <dt>原卷檔案／定位</dt><dd>${item.hasOriginalFile ? "有原卷" : "原卷缺失"}｜${escapeHtml(item.sourceLocation ?? "（無定位）")}｜${escapeHtml(item.sourceBlockIds.join(" ") || "（無段落）")}</dd>
    <dt>原文證據</dt><dd><ul>${evidence}</ul></dd>
    <dt>答案／評分</dt><dd>${escapeHtml(item.correctAnswer ?? "（無）")}｜可接受：${escapeHtml(item.acceptedAnswers.join(" ｜ ") || "（無）")}｜${escapeHtml(item.gradingMethod)}</dd>
    <dt>缺少的證據</dt><dd>${escapeHtml(item.missingEvidence.join("；") || "（未記錄）")}</dd>
    <dt>最新覆核紀錄</dt><dd>${escapeHtml(item.review.latestDecision ?? "沒有")}${item.review.latestDecision ? `（${escapeHtml(item.review.latestReviewer ?? "?")}，${escapeHtml(item.review.latestReviewedAt ?? "?")}）` : ""}｜共 ${item.review.records} 筆紀錄（本文件不判斷紀錄是否為教師裁決，須以 release gate 的 review-provenance 為準）</dd>
    <dt>Provenance</dt><dd>${escapeHtml(item.provenance ? `${item.provenance.tier}／${item.provenance.riskClass}` : "（不適用）")}</dd>
    <dt>建議下一步</dt><dd>${escapeHtml(item.suggestedNextStep)}</dd>
  </dl>
  <p class="notice">必須維持隔離：${item.mustStayQuarantined ? "是（裁決前不得派發）" : "否"}</p>
  <p class="label">教師裁決（只能選一項，未勾選代表未裁決）</p>
  <ul class="options">${options}</ul>
  <p class="sign">教師姓名／日期：______________________　已核對原卷版本：____________</p>
</article>`;
        })
        .join("\n");

      return `<section>
  <h2>${escapeHtml(category)} — ${group.length} 題</h2>
  <p class="muted">${escapeHtml(CATEGORY_GUIDANCE[category] ?? "")}</p>
  ${cards}
</section>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="zh-Hant-HK">
<head>
<meta charset="utf-8">
<title>不可作答題目裁決包（${items.length} 題）</title>
<style>
  body { font-family: system-ui, "Microsoft JhengHei", sans-serif; margin: 24px; line-height: 1.5; }
  h1 { font-size: 20px; }
  h2 { font-size: 16px; margin-top: 28px; border-bottom: 1px solid #999; padding-bottom: 4px; }
  h3 { font-size: 14px; margin: 0 0 6px; }
  table { border-collapse: collapse; margin-top: 8px; }
  td, th { border: 1px solid #999; padding: 4px 8px; font-size: 12px; vertical-align: top; }
  .num { text-align: right; }
  .card { border: 1px solid #bbb; border-radius: 6px; padding: 10px 12px; margin: 10px 0; page-break-inside: avoid; }
  dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; font-size: 12px; margin: 6px 0; }
  dt { font-weight: 600; }
  dd { margin: 0; }
  ul { margin: 2px 0; padding-left: 18px; font-size: 12px; }
  .options { list-style: none; padding-left: 0; }
  .box { display: inline-block; width: 11px; height: 11px; border: 1px solid #333; margin-right: 6px; }
  .muted { color: #555; font-weight: normal; font-size: 12px; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 11px; }
  .notice { font-size: 12px; color: #8a2b2b; }
  .label { font-size: 12px; font-weight: 600; margin-bottom: 2px; }
  .sign { font-size: 12px; margin-top: 8px; }
</style>
</head>
<body>
<h1>不可作答題目裁決包（${items.length} 題）</h1>
<p class="notice">本文件只是證據匯總，不是核准。列印或勾選本文件不會改變題目狀態；所有裁決必須經由教師審核工作台（/teacher/review）在伺服器端記錄，並綁定題目版本及內容指紋。</p>
<p class="muted">資料時間：${escapeHtml(report.generatedAt)}｜產生來源：${escapeHtml(items[0]?.dataSources.join("、") ?? "")}</p>
<p class="muted">${escapeHtml(report.notice)}</p>
<table>
<thead><tr><th>證據類別</th><th>處理原則</th><th>題數</th></tr></thead>
<tbody>${summaryRows}</tbody>
</table>
${sections}
</body>
</html>
`;

  return {
    csv,
    html,
    stats: {
      rows: items.length,
      byCategory,
      withReviewRecords: items.filter((item) => item.review.records > 0).length,
      withVerifiableOriginal: items.filter(
        (item) =>
          item.evidenceCategory === "original_available" ||
          item.evidenceCategory === "original_inconsistent",
      ).length,
      mustStayQuarantined: items.filter((item) => item.mustStayQuarantined).length,
    },
  };
}
