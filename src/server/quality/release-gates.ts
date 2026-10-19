/**
 * 發布就緒閘門（純函式）。
 *
 * 原則：
 *   - 只有具備明確證據且符合既定標準的項目才可 `PASS`；
 *   - 未定義標準或未有證據的項目不可當作通過（`POLICY_PENDING`／`INSUFFICIENT_EVIDENCE`）；
 *   - 任何 `FAIL`、`POLICY_PENDING` 或 `INSUFFICIENT_EVIDENCE` 都令結果為 `NOT READY`；
 *   - 只有當全部閘門 `PASS` 或（容許的）`WARN` 時，才可能得出 `READY`／`READY WITH LIMITATIONS`。
 */
import type { ContentAuditPayload } from "./content-audit";

export const GATE_STATUSES = [
  "PASS",
  "FAIL",
  "WARN",
  "POLICY_PENDING",
  "INSUFFICIENT_EVIDENCE",
] as const;

export type GateStatus = (typeof GATE_STATUSES)[number];

export type ReleaseVerdict = "READY" | "READY WITH LIMITATIONS" | "NOT READY";

export interface GateResult {
  id: string;
  title: string;
  status: GateStatus;
  summary: string;
  numerator: number | null;
  denominator: number | null;
  evidence: string[];
  recommendations: string[];
}

export interface ReleaseGateInput {
  audit: ContentAuditPayload;
  answerProvenance: { affected: number; unresolved: number; reportFound: boolean };
  teacherDecisions: { pendingCurrentRevision: number; openReports: number };
  reviewProvenance: {
    teacherAdjudicated: number;
    ownerBatchOnly: number;
    automationOnly: number;
    noEvidence: number;
  };
  servabilityIssues: Record<string, number>;
  /** Sprint 11：結構不可作答題目的原始證據核對及教師裁決進度 */
  servabilityAdjudication: {
    unservable: number;
    originalEvidenceChecked: number;
    labelsOnlyRepairCandidates: number;
    teacherDecisions: number;
    awaitingTeacherDecision: number;
  };
  /** Sprint 11：只有自動化修復證據的題目風險分布 */
  provenanceRisk: {
    reportFound: boolean;
    p0: number;
    p1: number;
    p2: number;
    p3: number;
  };
  /** Sprint 11：Golden Dataset 人工核准進度 */
  goldenApproval: { approved: number; pending: number; stale: number };
  copyright: {
    documents: number;
    distributable: number;
    rightsRecorded: number;
    ownerAttestation: boolean;
  };
  golden: { questions: number; reviewed: number; datasetVersion?: string | null };
  tests: {
    evidenceProvided: boolean;
    failures: number;
    skipped: number;
    commands: string[];
  };
  deployment: { evidenceProvided: boolean; notes: string[] };
  previous: {
    label: string;
    placeholderExplanations: number;
    answerOnlyExplanations: number;
    skillMissing: number;
    sourceUnknown: number;
  } | null;
}

export interface ReleaseGateReport {
  verdict: ReleaseVerdict;
  gates: GateResult[];
  deltas: {
    label: string;
    metric: string;
    previous: number;
    current: number;
    change: number;
  }[];
}

export function evaluateReleaseGates(input: ReleaseGateInput): ReleaseGateReport {
  const { audit } = input;
  const publishedNotServable = audit.questions.filter(
    (question) => question.status === "published" && !question.servable,
  ).length;
  const policyPendingExplanations =
    audit.explanation.counts.placeholder + audit.explanation.counts.answer_only;
  const sourceUnknown = audit.source.counts.unknown;
  const sourcePending =
    audit.source.counts.pending_verification + audit.source.counts.partial;

  const gates: GateResult[] = [
    {
      id: "question-isolation",
      title: "隔離／待教師確認",
      status: audit.totals.teacherConfirmationRequired === 0 ? "PASS" : "FAIL",
      summary:
        audit.totals.teacherConfirmationRequired === 0
          ? "沒有題目帶待教師確認標記"
          : `${audit.totals.teacherConfirmationRequired} 題仍待教師確認`,
      numerator: audit.totals.teacherConfirmationRequired,
      denominator: audit.totals.questions,
      evidence: ["questions.teacher_confirmation_required"],
      recommendations: ["先完成教師裁決，再考慮發布"],
    },
    {
      id: "question-servability",
      title: "題目結構可作答",
      status: publishedNotServable === 0 ? "PASS" : "FAIL",
      summary:
        publishedNotServable === 0
          ? "所有已發布題目均可作答"
          : `${publishedNotServable} 題已發布但結構上不可作答（派發層會攔下，學生不會收到；仍需修正或改回草稿）${Object.keys(input.servabilityIssues).length > 0 ? `：${Object.entries(input.servabilityIssues)
              .map(([code, count]) => `${code} ${count}`)
              .join("、")}` : ""}`,
      numerator: publishedNotServable,
      denominator: audit.totals.published,
      evidence: ["checkQuestionServable()"],
      recommendations: ["修正題幹／選項／答案，或把題目改回草稿；修正後重新覆核"],
    },
    {
      id: "answer-provenance",
      title: "考核答案的改寫來源",
      status: !input.answerProvenance.reportFound
        ? "INSUFFICIENT_EVIDENCE"
        : input.answerProvenance.unresolved === 0
          ? "PASS"
          : "FAIL",
      summary: !input.answerProvenance.reportFound
        ? "找不到修復來源報告：無法確認考核答案改寫是否已裁決"
        : input.answerProvenance.unresolved === 0
          ? `已裁決 ${input.answerProvenance.affected} 題考核答案改寫（無未決項目）`
          : `${input.answerProvenance.unresolved} 題考核答案改寫仍未裁決`,
      numerator: input.answerProvenance.unresolved,
      denominator: input.answerProvenance.affected,
      evidence: [
        "repair-provenance-2026-10-19.json",
        "repair-adjudication-results-2026-10-19.json",
      ],
      recommendations: ["維持隔離並由歷史科教師逐題裁決"],
    },
    {
      id: "source-traceability",
      title: "來源可追溯性",
      status:
        sourceUnknown === 0 && sourcePending === 0 ? "PASS" : "POLICY_PENDING",
      summary: `可定位 ${audit.source.counts.traceable}／${audit.totals.questions}；待核實 ${sourcePending}；無法追溯 ${sourceUnknown}`,
      numerator: audit.source.counts.traceable,
      denominator: audit.totals.questions,
      evidence: [
        "source_location",
        "source_block_ids",
        "material_blocks",
        "material_documents",
      ],
      recommendations: [
        sourcePending > 0
          ? "為校內試題建立文件紀錄（檔名、題號、雜湊）及匯入批次，或由教師確認來源"
          : "維持來源連結",
        sourceUnknown > 0 ? "無法追溯的題目須由教師確認來源" : "",
      ].filter((value) => value.length > 0),
    },
    {
      id: "explanation-quality",
      title: "解釋品質",
      status:
        policyPendingExplanations > 0
          ? "POLICY_PENDING"
          : audit.explanation.counts.potentially_inconsistent > 0
            ? "FAIL"
            : "PASS",
      summary: `佔位 ${audit.explanation.counts.placeholder}、只列答案 ${audit.explanation.counts.answer_only}、疑似矛盾 ${audit.explanation.counts.potentially_inconsistent}`,
      numerator: policyPendingExplanations,
      denominator: audit.totals.questions,
      evidence: ["explanation 分類（placeholder／answer_only／potentially_inconsistent）"],
      recommendations: [
        "由產品負責人決定佔位／只列答案的題目是否暫緩派發",
        "疑似矛盾只進入教師覆核佇列，不自動裁定",
      ],
    },
    {
      id: "metadata",
      title: "元數據完整性",
      status:
        audit.metadata.blockingReferences > 0
          ? "FAIL"
          : audit.metadata.bySeverity.needs_review > 0
            ? "POLICY_PENDING"
            : audit.metadata.skillMissing > 0
              ? "WARN"
              : "PASS",
      summary: `技能空白 ${audit.metadata.skillMissing}；難度值 ${Object.keys(audit.metadata.difficulty).join("／") || "（無）"}；阻擋級關聯錯誤 ${audit.metadata.blockingReferences}`,
      numerator: audit.metadata.skillMissing,
      denominator: audit.totals.questions,
      evidence: ["skill", "difficulty", "knowledge_point", "topics", "sections"],
      recommendations: [
        "教師提供技能標籤；不要在未經確認下填入預設值",
        "修正無效課題／分節關聯",
      ],
    },
    {
      id: "teacher-decisions",
      title: "未處理的教師裁決",
      status:
        input.teacherDecisions.pendingCurrentRevision === 0 &&
        input.teacherDecisions.openReports === 0
          ? "PASS"
          : "FAIL",
      summary: `待目前版本覆核 ${input.teacherDecisions.pendingCurrentRevision}；未結回報 ${input.teacherDecisions.openReports}`,
      numerator:
        input.teacherDecisions.pendingCurrentRevision + input.teacherDecisions.openReports,
      denominator: null,
      evidence: ["question_reviews", "question_reports"],
      recommendations: ["完成覆核或回報處理"],
    },
    {
      id: "review-provenance",
      title: "審核證據來源",
      status:
        input.reviewProvenance.noEvidence > 0
          ? "FAIL"
          : input.reviewProvenance.automationOnly > 0
            ? "POLICY_PENDING"
            : input.reviewProvenance.ownerBatchOnly > 0
              ? "WARN"
              : "PASS",
      summary: `教師逐題裁決 ${input.reviewProvenance.teacherAdjudicated}；只有擁有者批次 ${input.reviewProvenance.ownerBatchOnly}；只有自動修復 ${input.reviewProvenance.automationOnly}；完全沒有證據 ${input.reviewProvenance.noEvidence}`,
      numerator: input.reviewProvenance.automationOnly,
      denominator: audit.totals.questions,
      evidence: ["docs/quality/review-provenance-2026-10-19.json", "question_reviews"],
      recommendations: [
        "由負責人決定：內容不變的自動修復紀錄是否足以支持目前版本，或需教師逐題確認",
        "不得把 admin 角色或批次授權當成逐題教師審核",
        "保留原始紀錄，不重新標記歷史",
      ],
    },
    {
      id: "copyright",
      title: "版權與教材發行權",
      status: !input.copyright.ownerAttestation
        ? "POLICY_PENDING"
        : input.copyright.rightsRecorded < input.copyright.documents
          ? "WARN"
          : "PASS",
      summary: input.copyright.ownerAttestation
        ? `擁有者已確認版權；可向學生發布 ${input.copyright.distributable}／${input.copyright.documents} 份；逐份權利紀錄 ${input.copyright.rightsRecorded} 份`
        : "未記錄版權確認",
      numerator: input.copyright.rightsRecorded,
      denominator: input.copyright.documents,
      evidence: ["docs/teacher-review/copyright-owner-attestation-2026-10-19.md"],
      recommendations: [
        "保留擁有者確認紀錄；如需逐份授權證明，另行補存",
        "版權許可不等於歷史內容正確",
      ],
    },
    {
      id: "golden-evaluation",
      title: "Golden evaluation dataset",
      status:
        input.golden.questions === 0
          ? "INSUFFICIENT_EVIDENCE"
          : input.golden.reviewed < input.golden.questions
            ? "WARN"
            : "PASS",
      summary:
        input.golden.questions === 0
          ? "資料集為空：評估證據不足（不是零錯誤）"
          : `已覆核 ${input.golden.reviewed}／${input.golden.questions}（${input.golden.datasetVersion ?? "未標示版本"}）`,
      numerator: input.golden.reviewed,
      denominator: input.golden.questions,
      evidence: ["docs/teacher-review/golden-questions.v1.json"],
      recommendations: ["由歷史科教師建立至少一組已覆核樣本"],
    },
    {
      id: "servability-adjudication",
      title: "結構不可作答題目的處置",
      status:
        input.servabilityAdjudication.unservable === 0 ||
        input.servabilityAdjudication.awaitingTeacherDecision === 0
          ? "PASS"
          : "POLICY_PENDING",
      summary: `不可作答 ${input.servabilityAdjudication.unservable} 題；已核對原始證據 ${input.servabilityAdjudication.originalEvidenceChecked} 題；可直接由原文補標示的修復候選 ${input.servabilityAdjudication.labelsOnlyRepairCandidates} 題；已有教師裁決 ${input.servabilityAdjudication.teacherDecisions} 題；仍待教師裁決 ${input.servabilityAdjudication.awaitingTeacherDecision} 題`,
      numerator: input.servabilityAdjudication.awaitingTeacherDecision,
      denominator: input.servabilityAdjudication.unservable,
      evidence: [
        "docs/quality/servability-remediation-2026-10-19.json",
        "docs/quality/servability-evidence-2026-10-19.json",
        "POST /api/teacher/questions/[questionId]/servability",
      ],
      recommendations: [
        "逐題由歷史科教師裁決：依原文修復、退回草稿、保留隔離或不可用",
        "原文沒有 i／ii／iii 標示時，不得由程式按選項順序補上",
        "不可作答題目即使被核准，`recordQuestionReview` 仍會拒絕發布",
      ],
    },
    {
      id: "provenance-risk",
      title: "自動修復證據的風險分布",
      status: !input.provenanceRisk.reportFound
        ? "INSUFFICIENT_EVIDENCE"
        : input.provenanceRisk.p0 + input.provenanceRisk.p1 + input.provenanceRisk.p2 === 0
          ? "PASS"
          : "POLICY_PENDING",
      summary: `P0（可能改變答案／評分）${input.provenanceRisk.p0}；P1（題幹改變但考核答案不變）${input.provenanceRisk.p1}；P2（原始證據不足）${input.provenanceRisk.p2}；P3（純格式／內容相同）${input.provenanceRisk.p3}`,
      numerator: input.provenanceRisk.p0 + input.provenanceRisk.p1 + input.provenanceRisk.p2,
      denominator:
        input.provenanceRisk.p0 +
        input.provenanceRisk.p1 +
        input.provenanceRisk.p2 +
        input.provenanceRisk.p3,
      evidence: ["docs/quality/provenance-risk-2026-10-19.json", "audit:repair-provenance"],
      recommendations: [
        "由負責人決定：這些題目是否需教師逐題確認，或現有自動修復證據足以支持目前版本",
        "P0 優先；P3 只代表覆核次序較後，不代表已核准",
      ],
    },
    {
      id: "golden-approval",
      title: "Golden Dataset 人工核准",
      status:
        input.goldenApproval.approved > 0
          ? input.goldenApproval.stale > 0
            ? "FAIL"
            : "PASS"
          : "INSUFFICIENT_EVIDENCE",
      summary: `已核准 fixture ${input.goldenApproval.approved}；待教師核准候選 ${input.goldenApproval.pending}；裁決因題目改動而失效 ${input.goldenApproval.stale}`,
      numerator: input.goldenApproval.approved,
      denominator: input.goldenApproval.approved + input.goldenApproval.pending,
      evidence: [
        "golden_fixture_reviews",
        "POST /api/teacher/golden/[questionId]",
        "docs/teacher-review/golden-questions.v2.json",
      ],
      recommendations: [
        "由歷史科教師逐題核准，並提供 category、reasoning 及預期 grading",
        "題目內容改變後必須重新核准；不得把 pending 當成 approved",
      ],
    },
    {
      id: "tests",
      title: "測試與建置證據",
      status: !input.tests.evidenceProvided
        ? "INSUFFICIENT_EVIDENCE"
        : input.tests.failures > 0
          ? "FAIL"
          : "PASS",
      summary: input.tests.evidenceProvided
        ? input.tests.failures > 0
          ? `${input.tests.failures} 項失敗`
          : "測試、型別、lint、build 全部通過（證據檔）"
        : "沒有可重現的測試證據檔",
      numerator: input.tests.failures,
      denominator: input.tests.commands.length,
      evidence: input.tests.commands,
      recommendations: ["重新執行並更新 evidence 檔"],
    },
    {
      id: "deployment",
      title: "正式環境／部署驗證",
      status: input.deployment.evidenceProvided ? "PASS" : "INSUFFICIENT_EVIDENCE",
      summary: input.deployment.evidenceProvided
        ? "已提供正式環境證據"
        : "沒有 Cloud Run／正式資料庫／備份還原證據",
      numerator: null,
      denominator: null,
      evidence: input.deployment.notes,
      recommendations: ["部署後完成登入、權限、備份還原及健康檢查"],
    },
  ];

    // Sprint 12：沒有題目資料時不得當作「沒有問題」。若資料庫讀取失敗、指向空資料庫或
    // schema 不匹配，`audit.totals.questions` 會是 0；此時所有內容閘門必須是
    // INSUFFICIENT_EVIDENCE，而不是因為「0 題不可作答」而 PASS。
    if (audit.totals.questions === 0) {
      const contentGateIds = new Set([
        "question-isolation",
        "question-servability",
        "answer-provenance",
        "source-traceability",
        "explanation-quality",
        "metadata",
        "teacher-decisions",
        "review-provenance",
      ]);
      for (const gate of gates) {
        if (!contentGateIds.has(gate.id)) continue;
        gate.status = "INSUFFICIENT_EVIDENCE";
        gate.summary = `沒有讀到任何題目資料（0 題），無法判斷：${gate.summary}`;
        gate.numerator = null;
        gate.denominator = null;
        gate.recommendations = [
          "確認 --database 指向正確的題目資料庫，且 migration 已套用",
          "在沒有題目資料的情況下，發布檢查一律視為證據不足",
          ...gate.recommendations,
        ];
      }
    }

    const hasBlocker = gates.some(
    (gate) =>
      gate.status === "FAIL" ||
      gate.status === "POLICY_PENDING" ||
      gate.status === "INSUFFICIENT_EVIDENCE",
  );  const hasWarning = gates.some((gate) => gate.status === "WARN");
  const verdict: ReleaseVerdict = hasBlocker
    ? "NOT READY"
    : hasWarning
      ? "READY WITH LIMITATIONS"
      : "READY";

  const deltas = input.previous
    ? [
        {
          label: input.previous.label,
          metric: "佔位解釋",
          previous: input.previous.placeholderExplanations,
          current: audit.explanation.counts.placeholder,
          change:
            audit.explanation.counts.placeholder - input.previous.placeholderExplanations,
        },
        {
          label: input.previous.label,
          metric: "只列答案解釋",
          previous: input.previous.answerOnlyExplanations,
          current: audit.explanation.counts.answer_only,
          change:
            audit.explanation.counts.answer_only - input.previous.answerOnlyExplanations,
        },
        {
          label: input.previous.label,
          metric: "技能空白",
          previous: input.previous.skillMissing,
          current: audit.metadata.skillMissing,
          change: audit.metadata.skillMissing - input.previous.skillMissing,
        },
        {
          label: input.previous.label,
          metric: "來源無法追溯",
          previous: input.previous.sourceUnknown,
          current: sourceUnknown,
          change: sourceUnknown - input.previous.sourceUnknown,
        },
      ]
    : [];

  return { verdict, gates, deltas };
}
