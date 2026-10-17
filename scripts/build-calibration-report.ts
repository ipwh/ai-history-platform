/**
 * 由教師覆核套件產生「機器判定 vs 教師判斷」的校準報告（Sprint 8.7 第三階段）。
 *
 * 這個腳本**只讀**覆核套件 JSON，不接觸資料庫、不改任何題目或設定。
 * 它的用途是把未來的人類決定與機器結果並列，方便日後檢視規則的準確度；
 * 它不會、也不應該自動調整門檻，因為八題的樣本不足以支持任何數值結論。
 *
 * 用法：
 *   npm run review:calibration              （乾跑：只列出比較結果）
 *   npm run review:calibration -- --write   （寫出 docs/teacher-review/human-vs-machine-calibration-2026-10.json）
 *   npm run review:calibration -- --package <path> --output <path>
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_PACKAGE = path.join(
  "docs",
  "teacher-review",
  "generated-question-sample-2026-10.json",
);
const DEFAULT_OUTPUT = path.join(
  "docs",
  "teacher-review",
  "human-vs-machine-calibration-2026-10.json",
);

/**
 * 評估類別（Sprint 8.6 第五階段／Sprint 8.7 第三階段）。
 *
 * 這些是**待填的分類**，不是已填的結果：教師覆核時可在 `reviewCategories` 選用，
 * 報告只會統計實際被選用的類別。沒有資料時一律顯示 0，不會估算。
 */
const CATEGORIES = [
  {
    id: "machine-pass-teacher-reject",
    label: "機器判 pass，教師認為不可用",
    kind: "disagreement",
    description: "表示自動規則漏掉了教師認為重要的問題（史實、課程、教學價值）。",
  },
  {
    id: "machine-revise-teacher-accept",
    label: "機器判 revise，教師認為可用",
    kind: "disagreement",
    description: "可能是規則過嚴（例如只憑字面重疊就要求覆核），屬誤報。",
  },
  {
    id: "machine-reject-teacher-accept",
    label: "機器判 reject，教師認為可用",
    kind: "disagreement",
    description: "最嚴重的一類誤報，須逐題記錄理由，不可只調門檻了事。",
  },
  {
    id: "historical-inaccuracy",
    label: "史實錯誤",
    kind: "content",
    description: "題目、答案或解釋與課本／可靠史料不符。",
  },
  {
    id: "unsupported-inference",
    label: "教材未建立的推論或因果",
    kind: "content",
    description: "題目要求學生指出教材沒有建立的因果、比較或評價。",
  },
  {
    id: "incomplete-answer",
    label: "答案不完整或錯誤選項有問題",
    kind: "content",
    description: "標準答案未涵蓋題目要求，或有超過一個可辯護答案。",
  },
  {
    id: "explanation-quality",
    label: "解釋無助理解",
    kind: "pedagogy",
    description: "解釋只重複答案、抄錄課文或加入教材以外的說法。",
  },
  {
    id: "curriculum-mismatch",
    label: "難度或課程範圍不符",
    kind: "pedagogy",
    description: "認知要求與難度標示不符，或超出該分節的學習重點。",
  },
] as const;

type MachineOutcome = "pass" | "revise" | "reject";

interface PackageItem {
  questionId: string;
  provenance: { questionType: string; origin: string; status: string; difficulty: string };
  machineChecks: {
    gateAtGeneration: { teacherConfirmationRequired: boolean; qualityWarnings: string[] };
    gateRecomputedNow: { outcome: string; codes: string[] };
  };
  reviewerDecision: string;
  reviewer: string | null;
  reviewedAt: string | null;
  reviewCategories?: string[];
  outstandingConcerns?: unknown[];
}

interface PackageFile {
  version: number;
  reviewStatus: string;
  items: PackageItem[];
}

function parseArgs(argv: string[]): {
  write: boolean;
  packagePath: string;
  output: string;
} {
  let write = false;
  let packagePath = DEFAULT_PACKAGE;
  let output = DEFAULT_OUTPUT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--write") {
      write = true;
    } else if (arg === "--package") {
      const value = argv[index + 1];
      if (!value) throw new Error("--package 需要一個路徑");
      packagePath = value;
      index += 1;
    } else if (arg === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output 需要一個路徑");
      output = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "用法：npm run review:calibration [-- --write] [-- --package <path>] [-- --output <path>]",
          "",
          "  （乾跑）只列出比較結果，不寫檔。",
          "  --write     寫出校準報告（預設 docs/teacher-review/human-vs-machine-calibration-2026-10.json）",
          "  --package   指定教師覆核套件（預設 docs/teacher-review/generated-question-sample-2026-10.json）",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`不認識的參數：${arg}`);
    }
  }
  return { write, packagePath, output };
}

/** 教師決定是否通過（approved 才算通過；其餘非 pending 的決定都算不通過） */
function humanAcceptance(decision: string): "accepted" | "rejected" | null {
  if (decision === "pending-review") return null;
  return decision === "approved" ? "accepted" : "rejected";
}

function disagreementOf(
  machineOutcome: MachineOutcome,
  decision: string,
): string | null {
  const acceptance = humanAcceptance(decision);
  if (acceptance === null) return null;
  if (machineOutcome === "pass" && acceptance === "rejected") {
    return "machine-pass-teacher-reject";
  }
  if (machineOutcome === "revise" && acceptance === "accepted") {
    return "machine-revise-teacher-accept";
  }
  if (machineOutcome === "reject" && acceptance === "accepted") {
    return "machine-reject-teacher-accept";
  }
  return null;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.packagePath)) {
    throw new Error(`找不到覆核套件：${options.packagePath}`);
  }
  const pkg = JSON.parse(fs.readFileSync(options.packagePath, "utf8")) as PackageFile;

  const rows = pkg.items.map((item) => {
    const outcome = item.machineChecks.gateRecomputedNow.outcome as MachineOutcome;
    const categories = Array.isArray(item.reviewCategories) ? item.reviewCategories : [];
    return {
      questionId: item.questionId,
      questionType: item.provenance.questionType,
      origin: item.provenance.origin,
      difficulty: item.provenance.difficulty,
      publishedAtReview: item.provenance.status === "published",
      machineOutcome: outcome,
      machineCodes: item.machineChecks.gateRecomputedNow.codes,
      machineHeldAtGeneration: item.machineChecks.gateAtGeneration.teacherConfirmationRequired,
      /** 以下兩欄只會在真實教師覆核後才有值；程式永不代填 */
      humanDecision: item.reviewerDecision,
      humanCategories: categories,
      disagreement: disagreementOf(outcome, item.reviewerDecision),
      outstandingConcernCount: Array.isArray(item.outstandingConcerns)
        ? item.outstandingConcerns.length
        : 0,
    };
  });

  const pending = rows.filter((row) => row.humanDecision === "pending-review").length;
  const categoryCounts = CATEGORIES.map((category) => ({
    ...category,
    count: rows.filter((row) => row.humanCategories.includes(category.id)).length,
  }));
  const disagreementCounts = Object.fromEntries(
    CATEGORIES.filter((category) => category.kind === "disagreement").map((category) => [
      category.id,
      rows.filter((row) => row.disagreement === category.id).length,
    ]),
  );

  const report = {
    version: 2,
    date: new Date().toISOString().slice(0, 10),
    title: "機器判定與教師判斷的校準紀錄（Sprint 8.7／8.8）",
    status: pending === rows.length ? "awaiting-human-review" : "partially-reviewed",
    /**
     * 校準狀態（Sprint 8.8）：沒有已記錄的教師決定時，校準屬**未量度**。
     * 只有真實決定才可以把這欄變成 `measured-partially`，程式不會推算任何結果。
     */
    calibrationStatus: rows.length - pending === 0 ? "unmeasured" : "measured-partially",
    accuracyClaim: null,
    accuracyNote:
      "本報告刻意不含準確率、精確率或任何比率：沒有已完成的教師覆核，就沒有可計算的基準；" +
      "即使日後有決定，亦須累積具代表性樣本才可討論比率（見 limitations）。",
    generatedBy: "npm run review:calibration -- --write（scripts/build-calibration-report.ts）",
    sourcePackage: options.packagePath,
    sampleSize: rows.length,
    reviewedCount: rows.length - pending,
    pendingCount: pending,
    purpose:
      "把真實教師的覆核決定與機器判定並列，讓日後可以檢視自動規則漏報（false negative）及誤報（false positive）；" +
      "本報告不會調整任何門檻，也不會把結果回寫平台。",
    categories: categoryCounts,
    disagreementCounts,
    rows,
    limitations: [
      `樣本只有 ${rows.length} 題，屬方便抽樣（每種來源／題型／難度取 id 最小者），不代表整體題庫分佈。`,
      "在沒有任何教師完成覆核前，本報告只能證明流程可運作，不能證明規則準確；校準狀態會如實標示為 unmeasured。",
      "因此不提供準確率、精確率或任何比率數字；有真實覆核資料後亦須累積到具代表性樣本才可討論。",
      "不同意見只記錄事實與分類，不會自動改動品質閘門的門檻或通知路徑。",
      "機器結果採用覆核套件中的 gateRecomputedNow（以現行規則重算），非生成當日的判定。",
    ],
    howToUse: [
      "1. 教師在覆核套件（或平台教師介面）完成決定，並在 reviewCategories 選用上面的類別（可多選）。",
      "2. 重跑 npm run review:calibration -- --write 以更新本報告。",
      "3. 檢視 disagreementCounts：machine-pass-teacher-reject 與 machine-reject-teacher-accept 是最需要處理的兩類。",
      "4. 調整規則前必須先累積更多已覆核題目；單一題目不足以支持任何規則變更。",
    ],
  };

  console.log(
    `樣本：${rows.length} 題；已覆核：${report.reviewedCount}；待覆核：${pending}；` +
      `校準狀態：${report.calibrationStatus}`,
  );
  for (const row of rows) {
    console.log(
      `- ${row.questionId} | 機器=${row.machineOutcome}` +
        `${row.machineCodes.length > 0 ? `（${row.machineCodes.join("、")}）` : ""}` +
        ` | 教師=${row.humanDecision}` +
        `${row.disagreement ? ` | 分歧=${row.disagreement}` : ""}`,
    );
  }

  if (!options.write) {
    console.log("\n（乾跑）沒有寫入任何檔案。要寫出報告，請加 --write。");
    return;
  }
  fs.mkdirSync(path.dirname(options.output), { recursive: true });
  fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n已寫出：${options.output}`);
  console.log("提醒：不要因為樣本小而調整門檻；也不要代填教師決定。");
}

main();
