/**
 * Golden fixture 候選清單（唯讀）。
 *
 * 只挑選可測試不同錯誤模式的題目，並標示 `pending-review`；沒有教師裁決、
 * 沒有 approved fixture、沒有修改題目。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Question } from "../src/lib/types";
import { questionFingerprint } from "../src/server/quality/question-fingerprint";
import { checkQuestionServable } from "../src/server/services/question-servability";
import { classifyReviewKind } from "../src/server/quality/review-provenance";

type Row = {
  id: string;
  topic_id: string;
  section_id: string | null;
  question_type: string;
  difficulty: string;
  question: string;
  options_json: string | null;
  correct_answer: string;
  accepted_answers_json: string | null;
  explanation: string;
  knowledge_point: string;
  source_excerpt: string | null;
  source_location: string | null;
  source_block_ids_json: string | null;
  grading_points_json: string | null;
  origin: string;
  status: string;
  source_verified: number;
  quality_warnings_json: string | null;
  skill: string | null;
  revision: number;
  teacher_confirmation_required: number;
};

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

function parseArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
}

function toQuestion(row: Row): Question {
  return {
    id: row.id,
    topicId: row.topic_id,
    sectionId: row.section_id ?? "",
    questionType: row.question_type,
    difficulty: row.difficulty,
    question: row.question,
    options: parseArray(row.options_json),
    correctAnswer: row.correct_answer,
    acceptedAnswers: parseArray(row.accepted_answers_json),
    explanation: row.explanation,
    knowledgePoint: row.knowledge_point,
    sourceExcerpt: row.source_excerpt ?? "",
    sourceLocation: row.source_location ?? "",
    sourceBlockIds: parseArray(row.source_block_ids_json),
    gradingPoints: parseArray(row.grading_points_json),
    origin: row.origin,
    status: row.status,
    sourceVerified: row.source_verified !== 0,
    qualityWarnings: parseArray(row.quality_warnings_json),
    skill: row.skill,
    revision: row.revision,
    autoValidatedAt: null,
    autoValidatedRevision: null,
    autoValidatedFingerprint: null,
    teacherConfirmationRequired: row.teacher_confirmation_required !== 0,
    createdAt: "",
  } as unknown as Question;
}

function main(): void {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const databasePath = path.resolve(
    readArg(argv, "--database") ?? path.join(repo, "data", "app.db"),
  );
  const provenancePath = path.resolve(
    readArg(argv, "--provenance") ??
      path.join(repo, "docs", "teacher-review", "repair-provenance-2026-10-19.json"),
  );
  const servabilityPath = path.resolve(
    readArg(argv, "--servability") ??
      path.join(repo, "docs", "quality", "servability-remediation-2026-10-19.json"),
  );
  const outJson = path.resolve(
    readArg(argv, "--out-json") ??
      path.join(repo, "docs", "teacher-review", "golden-candidates-2026-10-19.json"),
  );
  const outMd = path.resolve(
    readArg(argv, "--out-md") ??
      path.join(repo, "docs", "teacher-review", "golden-candidates-2026-10-19.md"),
  );
  if (!fs.existsSync(databasePath)) throw new Error(`找不到資料庫：${databasePath}`);

  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT * FROM questions ORDER BY id ASC").all() as unknown as Row[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    const reviews = db
      .prepare("SELECT question_id, revision, decision, reviewer_role, reason FROM question_reviews")
      .all() as {
      question_id: string;
      revision: number;
      decision: string;
      reviewer_role: string;
      reason: string | null;
    }[];

    const teacherAdjudicated = new Set(
      reviews
        .filter((review) => {
          const row = byId.get(review.question_id);
          return (
            row !== undefined &&
            review.decision === "approved" &&
            review.revision === row.revision &&
            classifyReviewKind(review.reviewer_role, review.reason) === "teacher_adjudication"
          );
        })
        .map((review) => review.question_id),
    );

    const provenance = fs.existsSync(provenancePath)
      ? (JSON.parse(fs.readFileSync(provenancePath, "utf8")) as {
          affectedQuestionIds?: string[];
          affected?: { id: string }[];
        })
      : null;
    const answerMappingIds = (
      provenance?.affectedQuestionIds ?? provenance?.affected?.map((item) => item.id) ?? []
    ).filter((id) => byId.has(id));

    const servability = fs.existsSync(servabilityPath)
      ? (JSON.parse(fs.readFileSync(servabilityPath, "utf8")) as {
          items?: { id: string; issueCode: string }[];
        })
      : null;
    const unservableItems = servability?.items ?? [];

    const candidate = (row: Row, group: string, selectionReason: string) => {
      const question = toQuestion(row);
      return {
        group,
        selectionReason,
        questionId: row.id,
        questionRevision: row.revision,
        questionFingerprint: questionFingerprint(question),
        status: row.status,
        questionType: row.question_type,
        difficulty: row.difficulty,
        stem: question.question,
        options: question.options,
        correctAnswer: question.correctAnswer,
        acceptedAnswers: question.acceptedAnswers,
        explanation: question.explanation,
        knowledgePoint: question.knowledgePoint,
        evidence: {
          sourceExcerpt: question.sourceExcerpt,
          sourceLocation: question.sourceLocation,
          sourceBlockIds: question.sourceBlockIds,
          hasTraceableDocument: question.sourceBlockIds.length > 0,
        },
        servable: checkQuestionServable(question).ok,
        hasCurrentTeacherAdjudication: teacherAdjudicated.has(row.id),
        reviewStatus: "pending-review" as const,
        reviewer: null,
        reviewedAt: null,
        suggestedCategory: null,
      };
    };

    const groups: { group: string; description: string; items: ReturnType<typeof candidate>[] }[] =
      [];
    const addGroup = (
      group: string,
      description: string,
      items: ReturnType<typeof candidate>[],
    ): void => {
      const seen = new Set<string>();
      groups.push({
        group,
        description,
        items: items.filter((item) => {
          if (seen.has(item.questionId)) return false;
          seen.add(item.questionId);
          return true;
        }),
      });
    };

    addGroup(
      "teacher-adjudicated",
      "已由教師逐題裁決的題目（最有證據基礎的 fixture 候選）",
      [...teacherAdjudicated]
        .sort()
        .slice(0, 8)
        .map((id) => candidate(byId.get(id)!, "teacher-adjudicated", "目前版本有教師裁決紀錄")),
    );

    addGroup(
      "answer-mapping-changed",
      "考核答案曾因多空格正規化而改變的題目（測試答案映射）",
      answerMappingIds
        .slice(0, 8)
        .map((id) =>
          candidate(byId.get(id)!, "answer-mapping-changed", "自動修復曾改變被考核的空格"),
        ),
    );

    addGroup(
      "unservable",
      "結構上不可作答的題目（測試 servability 及修復契約）",
      unservableItems
        .slice(0, 8)
        .map((item) =>
          candidate(
            byId.get(item.id)!,
            "unservable",
            `目前不可作答：${item.issueCode}（未修正，只作 fixture 候選）`,
          ),
        ),
    );

    addGroup(
      "accepted-alternatives",
      "有可接受同義答案的填充題（測試 grading 契約）",
      rows
        .filter((row) => parseArray(row.accepted_answers_json).length > 0)
        .slice(0, 8)
        .map((row) =>
          candidate(row, "accepted-alternatives", "有多個可接受答案，需測試評分行為"),
        ),
    );

    addGroup(
      "traceable-mc",
      "有教材段落依據的選擇題（測試選項與答案映射）",
      rows
        .filter(
          (row) =>
            row.question_type === "mc" &&
            parseArray(row.source_block_ids_json).length > 0 &&
            checkQuestionServable(toQuestion(row)).ok,
        )
        .slice(0, 8)
        .map((row) => candidate(row, "traceable-mc", "有逐字教材段落，適合測試答案與選項")),
    );

    addGroup(
      "traceable-fill",
      "有教材段落依據的單空格填充題（測試答案映射及可接受答案）",
      rows
        .filter(
          (row) =>
            row.question_type === "fill" &&
            parseArray(row.source_block_ids_json).length > 0 &&
            checkQuestionServable(toQuestion(row)).ok,
        )
        .slice(0, 8)
        .map((row) => candidate(row, "traceable-fill", "有逐字教材段落，適合測試填充題 grading")),
    );

    const payload = {
      generatedAt: new Date().toISOString(),
      notice:
        "這是 fixture **候選**清單，不是 golden dataset，也不是教師裁決。所有項目維持 pending-review，沒有 reviewer。",
      sourceDatabase: path.relative(repo, databasePath).replace(/\\/g, "/"),
      groups,
      totals: groups.reduce(
        (accumulator, group) => {
          accumulator[group.group] = group.items.length;
          return accumulator;
        },
        {} as Record<string, number>,
      ),
    };

    fs.mkdirSync(path.dirname(outJson), { recursive: true });
    fs.writeFileSync(outJson, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

    const lines: string[] = [];
    lines.push("# Golden fixture 候選清單（2026-10-19）");
    lines.push("");
    lines.push(`> ${payload.notice}`);
    lines.push("");
    for (const group of groups) {
      lines.push(`## ${group.group}`);
      lines.push("");
      lines.push(group.description);
      lines.push("");
      lines.push("| 題目 | 版本 | 題型 | 可作答 | 教師裁決 | 選取原因 |");
      lines.push("| --- | --- | --- | --- | --- | --- |");
      for (const item of group.items) {
        lines.push(
          `| ${item.questionId} | ${item.questionRevision} | ${item.questionType} | ${item.servable ? "是" : "否"} | ${item.hasCurrentTeacherAdjudication ? "有" : "無"} | ${item.selectionReason} |`,
        );
      }
      lines.push("");
    }
    fs.mkdirSync(path.dirname(outMd), { recursive: true });
    fs.writeFileSync(outMd, `${lines.join("\n")}\n`, "utf8");

    console.log(payload.notice);
    console.log(`候選：${JSON.stringify(payload.totals)}`);
    console.log(`已寫入：${path.relative(repo, outJson)}`);
    console.log(`已寫入：${path.relative(repo, outMd)}`);
  } finally {
    db.close();
  }
}

main();
