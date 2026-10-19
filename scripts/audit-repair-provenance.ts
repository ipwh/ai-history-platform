/**
 * 修復來源稽核（唯讀、可重複執行）。
 *
 * 目的：回答「`repair-question-bank.ts` 對現有題目做了甚麼、有沒有改變被考核的答案」。
 *
 * 方法：
 *   1. 由 `materials/` 內的校內試題檔（MCQ／填充題）以 `parseQuestionBank` 重建**原始**
 *      題目。該函式不做多空格正規化，`correctAnswer` 固定為第 1 個空格的答案，因此
 *      可以作為「修復前」的基準。
 *   2. 以唯讀方式讀取資料庫題目，逐題比較，並以與匯入／修復相同的規則重建預期結果。
 *   3. 只輸出統計及受影響題目；`--full` 才會輸出全部逐題比較。
 *
 * 用法：
 *   npx tsx scripts/audit-repair-provenance.ts
 *   npx tsx scripts/audit-repair-provenance.ts --out docs/teacher-review/repair-provenance-2026-10-19.json
 *   npx tsx scripts/audit-repair-provenance.ts --database "C:\\temp\\snapshot.db" --full
 *
 * 限制（必須如實說明）：
 *   - 只覆蓋 `materials/` 內仍存在的試題檔。來源檔已更新或題目已刪除時，無法重建原版。
 *   - 假設現行 `parseQuestionBank` 與當初匯入時的行為一致；若解析器曾改變，結果可能
 *     與真正的原版有差異，該類題目會標示為需要進一步核對。
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

async function main() {
  const repo = process.cwd();
  const argv = process.argv.slice(2);
  const readArg = (name: string): string | null => {
    const index = argv.indexOf(name);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
  };
  const full = argv.includes("--full");
  const databasePath = path.resolve(readArg("--database") ?? path.join(repo, "data", "app.db"));
  const outputPath = readArg("--out");

  const {
    blankAnswersFromExplanation,
    extractQuestionBankText,
    isQuestionBankFileName,
    parseQuestionBank,
    normaliseMultiBlankFill,
  } = await import("../src/server/materials/question-bank");

  const materialsDir = path.join(repo, "materials");
  const files: string[] = [];
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (isQuestionBankFileName(entry.name)) files.push(fullPath);
    }
  };
  walk(materialsDir);
  files.sort();

  interface Origin {
    sourceId: string;
    question: string;
    correctAnswer: string;
    options: string[];
    gradingPoints: string[];
    unitTitle: string;
    difficulty: string;
    explanation: string;
  }
  const origins = new Map<string, Origin>();
  for (const file of files) {
    const buffer = fs.readFileSync(file);
    const text = await extractQuestionBankText(buffer);
    const parsed = parseQuestionBank(text, path.basename(file));
    const occurrences = new Map<string, number>();
    for (const question of parsed.questions) {
      const occurrence = (occurrences.get(question.sourceId) ?? 0) + 1;
      occurrences.set(question.sourceId, occurrence);
      const id =
        occurrence === 1 ? `qb-${question.sourceId}` : `qb-${question.sourceId}-${occurrence}`;
      if (origins.has(id)) continue;
      origins.set(id, {
        sourceId: question.sourceId,
        question: question.question,
        correctAnswer: question.correctAnswer,
        options: question.options,
        gradingPoints: question.gradingPoints,
        unitTitle: question.unitTitle,
        difficulty: question.difficulty,
        explanation: question.explanation,
      });
    }
  }

  const db = new DatabaseSync(databasePath, { readOnly: true });
  const rows = db.prepare("SELECT * FROM questions ORDER BY topic_id, id").all();
  db.close();

  const norm = (value: string): string => value.replace(/\s+/g, " ").trim();
  const bulletStripped = (value: string): string => value.replace(/^[.．·•‧]\s*/, "").trim();

  const items: Record<string, unknown>[] = [];
  const counts: Record<string, number> = {};
  const countsByTopic: Record<string, Record<string, number>> = {};

  for (const row of rows) {
    const id = String(row.id);
    const topicId = String(row.topic_id);
    const orig = origins.get(id);
    const current = {
      question: String(row.question),
      correctAnswer: String(row.correct_answer ?? ""),
      options: JSON.parse(String(row.options_json ?? "[]")) as string[],
      explanation: String(row.explanation ?? ""),
      knowledgePoint: String(row.knowledge_point ?? ""),
      difficulty: String(row.difficulty ?? ""),
      revision: Number(row.revision),
      status: String(row.status),
      teacherConfirmationRequired: Number(row.teacher_confirmation_required) === 1,
    };

    const labels: string[] = [];
    const notes: string[] = [];
    let blankCountOriginal: number | null = null;
    let blankCountCurrent: number | null = null;
    let assessedBlankIndexOriginal: number | null = null;
    let assessedBlankIndexCurrent: number | null = null;

    if (!orig) {
      labels.push("INSUFFICIENT_ORIGINAL_EVIDENCE");
      notes.push("materials/ 內找不到對應的來源題目（來源檔可能已更新或題目已刪除）");
    } else {
      const origBlankCount = (orig.question.match(/[＿_]{2,}/g) ?? []).length;
      const curBlankCount = (current.question.match(/[＿_]{2,}/g) ?? []).length;
      blankCountOriginal = origBlankCount;
      blankCountCurrent = curBlankCount;

      const sameStem = norm(orig.question) === norm(current.question);
      const sameAnswer = norm(orig.correctAnswer) === norm(current.correctAnswer);
      const sameOptions =
        orig.options.length === current.options.length &&
        orig.options.every((option, index) => norm(option) === norm(current.options[index]));

      if (String(row.question_type) === "fill") {
        assessedBlankIndexOriginal = origBlankCount > 0 ? 1 : null;
        if (sameStem && sameAnswer) {
          labels.push("NO_SEMANTIC_CHANGE_CONFIRMED");
          assessedBlankIndexCurrent = assessedBlankIndexOriginal;
        } else if (origBlankCount > 1) {
          const answers = [orig.correctAnswer, ...orig.gradingPoints]
            .map((answer) => answer.trim())
            .filter((answer) => answer.length > 0);
          const expected =
            normaliseMultiBlankFill(orig.question, answers) ??
            normaliseMultiBlankFill(
              orig.question,
              blankAnswersFromExplanation(orig.explanation),
            );
          if (expected === null) {
            labels.push("INSUFFICIENT_ORIGINAL_EVIDENCE");
            notes.push("原始題目有多個空格，但無法以現行程式重建預期修復結果");
          } else {
            assessedBlankIndexCurrent = expected.assessedBlankIndex;
            const matchesRepair =
              norm(expected.question) === norm(current.question) &&
              norm(expected.correctAnswer) === norm(current.correctAnswer);
            if (!matchesRepair) {
              labels.push("QUESTION_MEANING_CHANGED");
              notes.push("現時內容與『由原始題目可重建的修復結果』不一致");
            } else if (expected.assessedBlankIndex === 1) {
              labels.push("NO_SEMANTIC_CHANGE_CONFIRMED");
              notes.push("題幹補回其餘空格的答案；仍考核原第 1 個空格，考核答案不變");
            } else {
              labels.push("ANSWER_MAPPING_CHANGED");
              notes.push(
                `考核空格由第 1 個改為第 ${expected.assessedBlankIndex} 個` +
                  `（答案由「${answers[0]}」變為「${expected.correctAnswer}」）`,
              );
            }
          }
        } else {
          labels.push("QUESTION_MEANING_CHANGED");
          notes.push("單空格填充題的題幹或答案與原始來源不同");
        }
      } else {
        const formattingOnly =
          orig.question === current.question &&
          norm(orig.correctAnswer) === norm(bulletStripped(current.correctAnswer)) &&
          orig.options.length === current.options.length &&
          orig.options.every(
            (option, index) => norm(option) === norm(bulletStripped(current.options[index])),
          );
        if (formattingOnly) {
          labels.push("FORMATTING_CHANGE_ONLY");
          notes.push("只移除選項開頭殘留的項目符號");
        } else if (sameStem && sameAnswer && sameOptions) {
          labels.push("NO_SEMANTIC_CHANGE_CONFIRMED");
        } else {
          labels.push("QUESTION_MEANING_CHANGED");
          notes.push("題幹、答案或選項與原始來源不同");
        }
      }

      if (labels.includes("ANSWER_MAPPING_CHANGED") || labels.includes("QUESTION_MEANING_CHANGED")) {
        labels.push("REQUIRES_HISTORY_TEACHER_REVIEW");
      }

      if (orig.unitTitle.trim().length > 0 && norm(orig.unitTitle) !== norm(current.knowledgePoint)) {
        notes.push("知識點與原始單元標題不同（可能是對應問題，非本次修復造成）");
      }
      if (current.explanation.trim().length === 0) notes.push("解釋為空白");
    }

    for (const label of labels) counts[label] = (counts[label] ?? 0) + 1;
    countsByTopic[topicId] ??= {};
    for (const label of labels) {
      countsByTopic[topicId][label] = (countsByTopic[topicId][label] ?? 0) + 1;
    }

    items.push({
      id,
      topicId,
      questionType: String(row.question_type),
      revision: current.revision,
      status: current.status,
      teacherConfirmationRequired: current.teacherConfirmationRequired,
      originalStem: orig?.question ?? null,
      currentStem: current.question,
      blankCountOriginal,
      blankCountCurrent,
      assessedBlankIndexOriginal,
      assessedBlankIndexCurrent,
      originalCorrectAnswer: orig?.correctAnswer ?? null,
      currentCorrectAnswer: current.correctAnswer,
      originalOptions: orig?.options ?? null,
      currentOptions: current.options,
      currentExplanation: current.explanation,
      classifications: labels,
      notes,
    });
  }

  const affected = items.filter((item) =>
    (item.classifications as string[]).includes("ANSWER_MAPPING_CHANGED"),
  );
  const report = {
    generatedAt: new Date().toISOString(),
    method:
      "以 materials/ 內的試題檔配合 parseQuestionBank（不做多空格正規化）重建原始內容，與資料庫現時內容逐題比較；資料庫以 readOnly 開啟。",
    limitations: [
      "只覆蓋 materials/ 內仍存在的試題檔；來源檔已更新或題目已刪除時無法重建。",
      "假設現行 parseQuestionBank 與當初匯入時的行為一致；解析器如有變更，結果可能與真正原版有差異。",
      "比較基準是『原始題目可重建的預期修復結果』，不是題目的歷史版本紀錄（資料庫沒有保存舊版本內容）。",
    ],
    totals: {
      databaseQuestions: rows.length,
      originalsParsed: origins.size,
      compared: items.length,
    },
    counts,
    countsByTopic,
    affectedQuestionIds: affected.map((item) => item.id),
    affected,
    ...(full ? { items } : {}),
  };

  const serialized = JSON.stringify(report, null, 1);
  if (outputPath) {
    fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    fs.writeFileSync(path.resolve(outputPath), serialized, "utf8");
    console.log(`報告已寫入 ${outputPath}`);
  }
  console.log("counts", counts);
  console.log("affected (answer mapping changed):", affected.length);
  for (const item of affected) console.log(`  ${item.id}｜${(item.notes as string[]).join("；")}`);
}

void main();
