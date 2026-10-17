/**
 * 建立「教師覆核套件」（Sprint 8.6）。
 *
 * 用途：由本機（或指定的）資料庫抽出小量**真實生成題目**，為歷史科教師準備審題所需的
 * 所有資料：題幹、選項、標準答案、得分要點、解釋、來源位置及**逐字節錄**、
 * 生成時與**現在重算**的品質閘門結果、學習重點／認知要求，以及七項審題準則與空白決定欄位。
 *
 * 安全設計（重要）：
 *   - 資料庫以 **readOnly** 開啟：這個腳本不會寫入任何題目、覆核或學生資料。
 *   - 預設 dry-run（只印出摘要）；加 `--write` 才會寫出檔案。
 *   - 不會建立任何覆核紀錄、不會改動題目狀態；所有決定欄位一律留空（pending-review）。
 *   - 不呼叫任何 AI／網絡服務。
 *
 * 用法：
 *   npm run review:package                       # 乾跑：預覽會收錄哪幾題
 *   npm run review:package -- --write            # 寫入 docs/teacher-review/generated-question-sample-2026-10.json
 *   npm run review:package -- --database <path>  # 指定資料庫（預設 data/app.db；唯讀）
 *
 * 檔案位置在 `docs/`（不在 `public/`，Next.js 不會提供給任何請求），因此
 * 完整節錄只會出現在教師／管理員可讀的版控文件中，學生端仍然只會收到
 * 「已核實來源」的節錄（見 source-visibility.ts）。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { checkQuestionQuality } from "../src/server/llm/question-quality";
import type { MaterialUnit } from "../src/server/llm/provider";
import { joinTableRow, stripPageReferences } from "../src/server/materials/text-utils";
import { DIFFICULTY_LABELS, type Difficulty, type QuestionType } from "../src/lib/types";

const DEFAULT_DATABASE = path.join("data", "app.db");
const DEFAULT_OUTPUT = path.join(
  "docs",
  "teacher-review",
  "generated-question-sample-2026-10.json",
);

/** 代表性抽樣：兩種來源 × 三種題型 × 不同難度（每組取 id 最小的一題，可重現） */
const SAMPLE_TARGETS: { origin: string; questionType: QuestionType; difficulty: Difficulty }[] = [
  { origin: "material-ai", questionType: "mc", difficulty: "basic" },
  { origin: "material-ai", questionType: "mc", difficulty: "challenge" },
  { origin: "material-ai", questionType: "fill", difficulty: "advanced" },
  { origin: "material-ai", questionType: "fill", difficulty: "basic" },
  { origin: "material-ai", questionType: "short", difficulty: "advanced" },
  { origin: "material-mock", questionType: "mc", difficulty: "basic" },
  { origin: "material-mock", questionType: "fill", difficulty: "basic" },
  { origin: "material-mock", questionType: "short", difficulty: "basic" },
];

const REVIEW_CONTEXT_LIMIT = 400;

const REVIEW_CRITERIA = [
  { id: "learningObjective", label: "這題考核哪一項學習重點？是否在課程範圍之內？" },
  { id: "questionClarity", label: "學生只讀題目文字，是否可以清楚知道要答甚麼？" },
  { id: "historicalAccuracy", label: "題目、答案及解釋的史實是否正確？（須對照課本原文）" },
  { id: "answerCompleteness", label: "標準答案及得分要點是否完整回應題目的要求？" },
  { id: "distractorValidity", label: "錯誤選項是否同類、明確錯誤，而且不會同樣成立？" },
  { id: "explanationUsefulness", label: "解釋是否幫學生理解推理，而不是重複答案或抄錄課文？" },
  { id: "cognitiveDemand", label: "認知要求是否配合難度標示（基礎／進階／挑戰）？" },
] as const;

interface QuestionRow {
  id: string;
  topic_id: string;
  section_id: string;
  question_type: QuestionType;
  difficulty: Difficulty;
  question: string;
  options_json: string;
  correct_answer: string;
  accepted_answers_json: string;
  grading_points_json: string;
  explanation: string;
  knowledge_point: string;
  source_excerpt: string;
  source_location: string;
  source_block_ids_json: string;
  origin: string;
  status: string;
  source_verified: number;
  teacher_confirmation_required: number;
  revision: number;
  quality_warnings_json: string;
  skill: string | null;
  auto_validated_at: string | null;
  created_at: string;
}

interface BlockRow {
  id: string;
  document_id: string;
  section_id: string;
  sort_order: number;
  type: string;
  text: string;
  table_json: string | null;
  source_location: string;
}

function parseArgs(argv: string[]): { write: boolean; database: string; output: string } {
  let write = false;
  let database = DEFAULT_DATABASE;
  let output = DEFAULT_OUTPUT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--write") {
      write = true;
    } else if (arg === "--database") {
      const value = argv[index + 1];
      if (!value) throw new Error("--database 需要一個路徑");
      database = value;
      index += 1;
    } else if (arg === "--output") {
      const value = argv[index + 1];
      if (!value) throw new Error("--output 需要一個路徑");
      output = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        [
          "用法：npm run review:package [-- --write] [-- --database <path>] [-- --output <path>]",
          "",
          "  （乾跑）只列出抽樣結果，不寫檔、不改資料庫。",
          "  --write    寫出教師覆核套件（預設 docs/teacher-review/generated-question-sample-2026-10.json）",
          "  --database 指定資料庫路徑（一律以唯讀方式開啟，預設 data/app.db）",
        ].join("\n"),
      );
      process.exit(0);
    } else {
      throw new Error(`不認識的參數：${arg}`);
    }
  }
  return { write, database, output };
}

/** 把資料庫的段落列轉成與生成流程相同的教材單位（表格會重組為「｜」分隔的一列） */
function toUnits(rows: BlockRow[]): MaterialUnit[] {
  const units: MaterialUnit[] = [];
  for (const row of rows) {
    if (row.type === "heading") continue;
    if (row.type === "table" && row.table_json) {
      const table = JSON.parse(row.table_json) as { text: string }[][];
      table.forEach((cells, rowIndex) => {
        units.push({
          blockId: row.id,
          sourceLocation: `${row.source_location} · 表格第 ${rowIndex + 1} 列`,
          text: joinTableRow(cells.map((cell) => cell.text.trim())),
        });
      });
      continue;
    }
    const text = stripPageReferences(row.text).trim();
    if (text.length === 0) continue;
    units.push({ blockId: row.id, sourceLocation: row.source_location, text });
  }
  return units;
}

function truncate(text: string, limit: number): string {
  const value = text.trim();
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(options.database)) {
    throw new Error(`找不到資料庫：${options.database}`);
  }

  // 唯讀開啟：任何寫入嘗試都會失敗，確保腳本不可能改動題目或覆核紀錄
  const db = new DatabaseSync(options.database, { readOnly: true });
  try {
    const questions = db
      .prepare(
        `SELECT id, topic_id, section_id, question_type, difficulty, question, options_json,
                correct_answer, accepted_answers_json, grading_points_json, explanation,
                knowledge_point, source_excerpt, source_location, source_block_ids_json,
                origin, status, source_verified, teacher_confirmation_required, revision,
                quality_warnings_json, skill, auto_validated_at, created_at
           FROM questions
          WHERE origin IN ('material-ai', 'material-mock')
          ORDER BY id`,
      )
      .all() as unknown as QuestionRow[];

    const topics = new Map(
      (db.prepare(`SELECT id, title FROM topics`).all() as { id: string; title: string }[]).map(
        (row) => [row.id, row.title],
      ),
    );
    const sections = new Map(
      (db.prepare(`SELECT id, title FROM sections`).all() as { id: string; title: string }[]).map(
        (row) => [row.id, row.title],
      ),
    );

    const sampled: QuestionRow[] = [];
    for (const target of SAMPLE_TARGETS) {
      const match = questions.find(
        (row) =>
          row.origin === target.origin &&
          row.question_type === target.questionType &&
          row.difficulty === target.difficulty &&
          !sampled.includes(row),
      );
      if (match) sampled.push(match);
    }
    if (sampled.length === 0) {
      throw new Error(
        "資料庫內沒有可抽樣的生成題目（origin = material-ai／material-mock）。請確認 --database 是否正確。",
      );
    }

    const items = sampled.map((row) => {
      const blockIds = JSON.parse(row.source_block_ids_json ?? "[]") as string[];
      const sectionRows = db
        .prepare(
          `SELECT * FROM material_blocks
            WHERE topic_id = ? AND section_id = ?
              AND document_id IN (SELECT id FROM material_documents WHERE kind <> 'question-bank')
            ORDER BY document_id ASC, sort_order ASC`,
        )
        .all(row.topic_id, row.section_id) as unknown as BlockRow[];
      const citedRows = blockIds.length
        ? (db
            .prepare(
              `SELECT * FROM material_blocks WHERE id IN (${blockIds.map(() => "?").join(", ")})`,
            )
            .all(...blockIds) as unknown as BlockRow[])
        : [];

      const units = toUnits(sectionRows.length > 0 ? sectionRows : citedRows);
      const candidate = {
        questionType: row.question_type,
        question: row.question,
        options: JSON.parse(row.options_json ?? "[]") as string[],
        correctAnswer: row.correct_answer,
        explanation: row.explanation,
        sourceExcerpt: row.source_excerpt,
        sourceBlockIds: blockIds,
        gradingPoints: JSON.parse(row.grading_points_json ?? "[]") as string[],
      };
      // 以**現行**規則重算一次（與生成時的判定可能不同：規則已更新，或教材已重新匯入）
      const recomputed = checkQuestionQuality(candidate, units);

      return {
        questionId: row.id,
        provenance: {
          topicId: row.topic_id,
          topicTitle: topics.get(row.topic_id) ?? row.topic_id,
          sectionId: row.section_id,
          sectionTitle: sections.get(row.section_id) ?? null,
          origin: row.origin,
          status: row.status,
          difficulty: row.difficulty,
          difficultyLabel: DIFFICULTY_LABELS[row.difficulty] ?? row.difficulty,
          questionType: row.question_type,
          revision: row.revision,
          createdAt: row.created_at,
          sourceLocation: row.source_location,
          sourceBlockIds: blockIds,
          /**
           * 審題用的逐字節錄（教師需要對照課本原文才可判斷史實）。
           * 這個檔案在 docs/（不在 public/），不會經任何學生端路由提供；
           * 學生端是否顯示節錄仍由 source-visibility.ts 的既有規則決定。
           */
          sourceExcerpt: row.source_excerpt,
          sourceExcerptLength: row.source_excerpt.length,
          /**
           * 審題用的引用段落上下文（只供教師／管理員對照，檔案位於 docs/）。
           * 節錄可能只是清單中的一項，教師需要看到同一段落的其餘內容才可判斷
           * 題目是否問得合理、答案是否唯一；過長的段落會被截短並標明原文長度。
           */
          sourceContext: citedRows.map((block) => ({
            blockId: block.id,
            sourceLocation: block.source_location,
            type: block.type,
            textLength: block.text.length,
            text: truncate(block.text, REVIEW_CONTEXT_LIMIT),
          })),
          /** 是否已通過教材依據核對（節錄逐字出自引用段落） */
          sourceVerified: row.source_verified === 1,
        },
        learningObjective: {
          /** 生成器宣告的知識點（未經教師確認） */
          knowledgePoint: row.knowledge_point,
          /** 生成器宣告的歷史技能（未經教師確認；值必須在 HISTORY_SKILLS 之內） */
          skill: row.skill,
          intendedDifficulty: DIFFICULTY_LABELS[row.difficulty] ?? row.difficulty,
          note: "以上為生成器宣告，未經教師確認；審題時請以課程文件及課本為準。",
        },
        content: {
          question: row.question,
          options: JSON.parse(row.options_json ?? "[]") as string[],
          correctAnswer: row.correct_answer,
          acceptedAnswers: JSON.parse(row.accepted_answers_json ?? "[]") as string[],
          gradingPoints: JSON.parse(row.grading_points_json ?? "[]") as string[],
          explanation: row.explanation,
        },
        machineChecks: {
          /** 生成時的判定結果（由題目已儲存的欄位得知） */
          gateAtGeneration: {
            teacherConfirmationRequired: row.teacher_confirmation_required === 1,
            qualityWarnings: JSON.parse(row.quality_warnings_json ?? "[]") as string[],
            autoValidatedAt: row.auto_validated_at,
          },
          /** 以現行規則重算的結果（Sprint 8.6 校準用；不是教師判斷） */
          gateRecomputedNow: {
            outcome: recomputed.outcome,
            codes: recomputed.issues.map((issue) => issue.code),
            notes: recomputed.issues.map((issue) => issue.message),
            materialsChecked: units.length,
          },
          note:
            "機器判定只代表已定義的自動檢查結果，不代表史實正確或教學價值；" +
            "重算結果與生成時不同，可能反映規則更新或教材重新匯入。",
        },
        reviewChecklist: {
          learningObjective: null,
          questionClarity: null,
          historicalAccuracy: null,
          answerCompleteness: null,
          distractorValidity: null,
          explanationUsefulness: null,
          cognitiveDemand: null,
        },
        reviewComments: null,
        reviewerDecision: "pending-review",
        reviewer: null,
        reviewedAt: null,
        outstandingConcerns: [],
        notes: null,
      };
    });

    const file = {
      version: 3,
      reviewStatus: "pending-review",
      generatedBy: "npm run review:package -- --write（scripts/build-review-package.ts）",
      generatedFrom: {
        database: options.database,
        /** 只記錄相對路徑與筆數，不記錄絕對路徑（避免機器特定資訊進入版控） */
        sampledQuestions: items.length,
      },
      purpose:
        "Sprint 8.6：為小量**真實生成題目**準備完整的審題套件。系統提供題目、答案、解釋、逐字來源節錄、" +
        "所引用段落的上下文（Sprint 8.7）、機器檢查結果及審題欄位；史實、課程要求及教學價值的判斷一律由歷史科教師填寫。",
      disclaimer: [
        "每一項決定都是 pending-review：**沒有**任何教師或專家已覆核這些題目，程式不會代填。",
        "題目及教材節錄的版權屬原出版者。本檔案位於 docs/（不在 public/），只供教師／管理員審閱，**不會**經學生端路由提供；學生端是否顯示節錄仍由來源可見性規則決定。",
        "通過自動品質驗證只代表定義好的自動檢查全部通過，不代表史實正確、符合課程要求或具教學價值（見 README「自動準則與教師判斷的分工」）。",
        "machineChecks.gateRecomputedNow 是以**現行**規則重算的結果，與 gateAtGeneration 可能不同（規則更新或教材重新匯入），差異本身是校準資料，不是錯誤。",
        `provenance.sourceContext 是所引用段落的原文（每段最多 ${REVIEW_CONTEXT_LIMIT} 字，` +
          "超出時以「…」標示並在 textLength 記錄原文長度），用途只是讓教師判斷節錄是否被斷章取義；它不是題目的一部分，也不會提供給學生。",
      ],
      howToUse: [
        "1. 在平台教師介面（/teacher/questions）開啟同一題，對照課本原文（sourceLocation 指出檔名及段落；provenance.sourceContext 提供所引用段落的原文供快速對照）。",
        "2. 逐項填寫 reviewChecklist 的七個欄位（學習重點、題目清晰度、史實、答案完整性、錯誤選項、解釋可用性、認知要求）。",
        "3. 在 reviewComments 寫下具體意見；需要修改時在 outstandingConcerns 列出待辦項目。",
        "4. 填寫 reviewerDecision：approved（可用）、needs-revision（需修改）、reject（不可用）。",
        "5. 同時填寫 reviewer（姓名或代號）及 reviewedAt（ISO 日期）。測試會拒絕沒有覆核者的「已覆核」紀錄（不得偽造）。",
        "6. 決定要寫回平台時，於教師介面提交覆核；介面會帶同你正在審閱的題目版本，題目若已被修改會拒絕提交並要求重新載入（不會把決定記到你未看過的版本）。",
      ],
      sampleSelection:
        "由資料庫以唯讀方式抽出 origin 為 material-ai／material-mock 的題目，按既定組合（兩種來源 × 三種題型 × 不同難度，每組取 id 最小者）抽樣；不包括校內試題（school-paper）及手動題目。",
      reviewCriteria: REVIEW_CRITERIA.map((criterion) => ({ ...criterion })),
      items,
    };

    console.log(`抽樣題目：${items.length} 題（資料庫：${options.database}，唯讀）`);
    for (const item of items) {
      console.log(
        `- ${item.questionId} | ${item.provenance.questionType}/${item.provenance.difficulty} | ` +
          `${item.provenance.origin} | ${item.provenance.status} | ` +
          `生成時暫緩=${item.machineChecks.gateAtGeneration.teacherConfirmationRequired} | ` +
          `現時判定=${item.machineChecks.gateRecomputedNow.outcome}` +
          `${item.machineChecks.gateRecomputedNow.codes.length > 0 ? `（${item.machineChecks.gateRecomputedNow.codes.join("、")}）` : ""}`,
      );
      console.log(`  題幹：${truncate(item.content.question, 40)}`);
    }

    if (!options.write) {
      console.log(
        "\n（乾跑）沒有寫入任何檔案。要寫出教師覆核套件，請加 --write。" +
          `\n輸出路徑（如加 --write）：${options.output}`,
      );
      return;
    }

    fs.mkdirSync(path.dirname(options.output), { recursive: true });
    fs.writeFileSync(options.output, `${JSON.stringify(file, null, 2)}\n`);
    console.log(`\n已寫出：${options.output}`);
    console.log("提醒：所有決定欄位保持 pending-review；請勿代填教師身分或決定。");
  } finally {
    db.close();
  }
}

main();
