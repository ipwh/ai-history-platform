/**
 * 主題分配規劃：把「一個分節包含整個課題」的過粗主題，按時期拆成多個主題。
 *
 * 背景（2026-10-22 用家回報）：課題9「兩次世界大戰」只有一個 176 題的分節，
 * 學生想集中複習第一次世界大戰時，抽到的題目大部分屬兩戰之間或第二次世界大戰。
 * 練習設定頁的「主題」就是分節，所以問題出在分節粒度，而不是出題邏輯。
 *
 * 這支腳本只做**確定性**分類（規則見 src/server/quality/topic-focus.ts）：
 *   - 題目：以題幹及教材節錄的關鍵詞判斷時期；同時命中多個時期而分數相同 → 留在「綜合」。
 *   - 教材段落：先按段落文字判斷；沒有命中的段落沿用**同一文件內前一段**的時期
 *     （筆記的短段落及標題本身沒有時期關鍵詞，但承接上文）。
 *
 * 用法：
 *   npm run plan:topic-focus -- --topic topic-9                       # 模擬（預設，唯讀）
 *   npm run plan:topic-focus -- --topic topic-9 --manifest out.json   # 模擬並輸出清單
 *   npm run plan:topic-focus -- --topic topic-9 --apply \
 *     --owner-email you@school.edu.hk --manifest out.json             # 真正寫入
 *   npm run plan:topic-focus -- --audit                               # 全課題主題粗細稽核
 *   npm run plan:topic-focus -- --topup                               # 每個主題還差多少題
 *
 * 安全設計（與其他內容腳本一致）：
 *   - 正式環境拒絕執行；預設只模擬，並以**唯讀**方式開啟資料庫（不會執行 migration）。
 *   - `--apply` 必須提供 `--owner-email`，每次改動都會記錄在清單內。
 *   - 只改分節（分類），不改題目內容、不改 revision，因此既有覆核紀錄不會失效。
 */
import fs from "node:fs";
import path from "node:path";

import { isProductionRuntime } from "../src/server/config";
import { enableReadOnlyDatabaseMode } from "../src/server/db/connection";
import {
  assignFocusByDocumentOrder,
  classifyQuestionFocus,
  focusSourceSectionIds,
  focusTargetFor,
  TOPIC_FOCUS_PLANS,
  type FocusClassification,
  type TopicFocusPlan,
} from "../src/server/quality/topic-focus";
import { listDocuments, listBlocksByTopic, moveBlocksToSection } from "../src/server/repositories/materials";
import { countQuestions, listQuestions, moveQuestionToSection } from "../src/server/repositories/questions";
import {
  deleteSection,
  getTopic,
  listSections,
  listTopics,
  setSectionOrder,
  upsertSection,
} from "../src/server/repositories/topics";
import { warnIfNpmSwallowedApply } from "./lifecycle-hints";

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : null;
}

interface PlannedQuestion {
  id: string;
  questionType: string;
  difficulty: string;
  status: string;
  classification: FocusClassification;
  targetSectionId: string;
  /** 題幹沒有時期關鍵詞，但引用的教材段落屬單一時期，因而歸入該時期 */
  inferredFromSource?: boolean;
}

interface PlannedBlock {
  id: string;
  documentId: string;
  classification: FocusClassification;
  inherited: boolean;
  targetSectionId: string;
}
function loadPlan(topicId: string): TopicFocusPlan {
  const plan = TOPIC_FOCUS_PLANS[topicId];
  if (!plan) {
    const available = Object.keys(TOPIC_FOCUS_PLANS).join("、") || "（沒有）";
    throw new Error(`課題 ${topicId} 未有主題分配方案。已規劃的課題：${available}`);
  }
  return plan;
}

/** 把分類結果對應到方案內的主題；找不到時退回「綜合」主題 */
function targetIdFor(plan: TopicFocusPlan, classification: FocusClassification): string {
  return focusTargetFor(plan, classification.key).id;
}

/**
 * 教材段落分類：見 assignFocusByDocumentOrder（共用規則，可獨立測試）。
 */
function classifyBlocks(
  blocks: { id: string; documentId: string; text: string; sortOrder: number }[],
  plan: TopicFocusPlan,
): { id: string; documentId: string; classification: FocusClassification; inherited: boolean }[] {
  return assignFocusByDocumentOrder(blocks, plan).map((assignment) => ({
    id: assignment.id,
    documentId: assignment.documentId,
    classification: { key: assignment.key, scores: {}, ambiguous: assignment.ambiguous },
    inherited: assignment.inherited,
  }));
}

/**
 * 全課題主題粗細稽核：列出每個課題的「主題數」及每個主題的題目／段落數，
 * 標示過粗（題目過多、需再分）及過細（題目太少、可能與其他主題合併）的主題。
 *
 * 這個模式不需要預先寫好拆分方案，用來定期檢查匯入新教材後的主題分佈。
 */
interface ThemeRow {
  topicId: string;
  topicTitle: string;
  level: number;
  themeCount: number;
  title: string;
  sectionId: string;
  questions: number;
  mcBasic: number;
  mcAdvanced: number;
  mcChallenge: number;
  fillBasic: number;
  blocks: number;
  visibleBlocks: number;
}

/** 集合每個主題（練習設定頁的一個選項）的題目數、題型分佈及教材段落數。 */
function collectThemeRows(): ThemeRow[] {
  const topics = listTopics();
  const rows: ThemeRow[] = [];
  for (const topic of topics) {
    const sections = listSections(topic.id);
    const parents = sections.filter((section) => section.parentId === null);
    const themes = parents.flatMap((parent) => {
      const children = sections.filter((section) => section.parentId === parent.id);
      return children.length > 0 ? children : [parent];
    });
    const blocks = listBlocksByTopic(topic.id);
    const studentDocuments = new Set(
      listDocuments()
        .filter((document) => document.topicId === topic.id && document.studentDistribution)
        .map((document) => document.id),
    );

    for (const theme of themes) {
      const published = countQuestions({ sectionIds: [theme.id], statuses: ["published"] });
      const themeBlocks = blocks.filter((block) => block.sectionId === theme.id);
      rows.push({
        topicId: topic.id,
        topicTitle: topic.title,
        level: topic.level,
        themeCount: themes.length,
        title: theme.title,
        sectionId: theme.id,
        questions: published,
        mcBasic: countQuestions({
          sectionIds: [theme.id],
          statuses: ["published"],
          questionTypes: ["mc"],
          difficulties: ["basic"],
        }),
        mcAdvanced: countQuestions({
          sectionIds: [theme.id],
          statuses: ["published"],
          questionTypes: ["mc"],
          difficulties: ["advanced"],
        }),
        mcChallenge: countQuestions({
          sectionIds: [theme.id],
          statuses: ["published"],
          questionTypes: ["mc"],
          difficulties: ["challenge"],
        }),
        fillBasic: countQuestions({
          sectionIds: [theme.id],
          statuses: ["published"],
          questionTypes: ["fill"],
          difficulties: ["basic"],
        }),
        blocks: themeBlocks.length,
        visibleBlocks: themeBlocks.filter((block) => studentDocuments.has(block.documentId)).length,
      });
    }
  }
  return rows;
}

/**
 * 全課題主題粗細稽核：列出每個課題的「主題數」及每個主題的題目／段落數，
 * 標示過粗（題目過多、需再分）及過細（題目太少、可能與其他主題合併）的主題。
 *
 * 這個模式不需要預先寫好拆分方案，用來定期檢查匯入新教材後的主題分佈。
 */
function auditThemes(databasePath: string, coarseThreshold: number, thinThreshold: number): void {
  console.log(`資料庫：${databasePath}`);
  console.log("模式：稽核（唯讀，不會寫入）");
  console.log(`判準：主題 ≥ ${coarseThreshold} 題＝過粗；< ${thinThreshold} 題＝過細`);
  console.log("");

  const rows = collectThemeRows();

  const coarse = rows.filter((row) => row.questions >= coarseThreshold);
  console.log(`過粗的主題（≥ ${coarseThreshold} 題）：${coarse.length} 個`);
  for (const row of coarse.sort((left, right) => right.questions - left.questions)) {
    console.log(
      `  ${row.questions.toString().padStart(3)} 題｜${row.topicId}｜${row.title}` +
        `（選擇題 基/進/挑 ${row.mcBasic}/${row.mcAdvanced}/${row.mcChallenge}；填充題 基 ${row.fillBasic}）`,
    );
  }

  const thin = rows.filter((row) => row.questions > 0 && row.questions < thinThreshold);
  console.log("");
  console.log(`過細的主題（> 0 且 < ${thinThreshold} 題）：${thin.length} 個`);
  for (const row of thin.sort((left, right) => left.questions - right.questions)) {
    console.log(`  ${row.questions.toString().padStart(3)} 題｜${row.topicId}｜${row.title}`);
  }

  const fewThemes = new Map<string, ThemeRow[]>();
  for (const row of rows) {
    const list = fewThemes.get(row.topicId) ?? [];
    list.push(row);
    fewThemes.set(row.topicId, list);
  }
  console.log("");
  console.log("每個課題的主題數及最大主題：");
  const topicSummaries = [...fewThemes.entries()]
    .map(([topicId, list]) => ({
      topicId,
      themeCount: list[0]!.themeCount,
      biggest: list.reduce((left, right) => (right.questions > left.questions ? right : left)),
    }))
    .sort((left, right) => right.biggest.questions - left.biggest.questions);
  for (const summary of topicSummaries) {
    console.log(
      `  ${summary.themeCount} 個主題｜最大 ${summary.biggest.questions
        .toString()
        .padStart(3)} 題｜${summary.topicId}｜${summary.biggest.title}`,
    );
  }
}

/**
 * 補題建議：把每個主題的題目數與「可獨立自學」的目標分佈比較，列出還差多少題。
 *
 * 目標分佈的理由：學生選一個主題自學時，會連續做多輪練習；同一輪內不應重複，
 * 而進階／挑戰級題目在各主題普遍只有 3 題，等於一輪就做完，無法再練。
 */
function topupThemes(
  databasePath: string,
  target: { total: number; advanced: number; challenge: number; fill: number },
): void {
  console.log(`資料庫：${databasePath}`);
  console.log("模式：補題建議（唯讀，不會寫入）");
  console.log(
    `目標：每個主題 ≥ ${target.total} 題，其中選擇題進階 ≥ ${target.advanced}、` +
      `挑戰 ≥ ${target.challenge}、填充題 ≥ ${target.fill}`,
  );
  console.log("");

  const rows = collectThemeRows();
  const empty = rows.filter((row) => row.questions === 0);
  const needs = rows
    .filter((row) => row.questions > 0)
    .map((row) => {
      const adv = Math.max(0, target.advanced - row.mcAdvanced);
      const challenge = Math.max(0, target.challenge - row.mcChallenge);
      const fill = Math.max(0, target.fill - row.fillBasic);
      const basic = Math.max(0, target.total - (row.questions + adv + challenge + fill));
      return { row, adv, challenge, fill, basic, deficit: basic + adv + challenge + fill };
    })
    .filter((entry) => entry.deficit > 0)
    .sort((left, right) => right.deficit - left.deficit);

  let lastTopic = "";
  for (const entry of needs) {
    const { row } = entry;
    if (row.topicId !== lastTopic) {
      console.log(`${row.topicId}｜${row.topicTitle}（${row.themeCount} 個主題）`);
      lastTopic = row.topicId;
    }
    const parts: string[] = [];
    if (entry.basic > 0) parts.push(`選擇題基本 ${entry.basic}`);
    if (entry.adv > 0) parts.push(`選擇題進階 ${entry.adv}`);
    if (entry.challenge > 0) parts.push(`選擇題挑戰 ${entry.challenge}`);
    if (entry.fill > 0) parts.push(`填充題 ${entry.fill}`);
    console.log(
      `  現有 ${row.questions.toString().padStart(3)} 題（選 基/進/挑 ${row.mcBasic}/${row.mcAdvanced}/${row.mcChallenge}；` +
        `填 基 ${row.fillBasic}）→ 需補 ${entry.deficit} 題：${parts.join("、")}｜${row.title}`,
    );
  }

  if (empty.length > 0) {
    const byTopic = new Map<string, { topicTitle: string; themes: string[] }>();
    for (const row of empty) {
      const entry = byTopic.get(row.topicId) ?? { topicTitle: row.topicTitle, themes: [] };
      entry.themes.push(row.title);
      byTopic.set(row.topicId, entry);
    }
    console.log("");
    console.log(`完全沒有題目的主題：${empty.length} 個（${byTopic.size} 個課題）`);
    for (const [topicId, entry] of byTopic) {
      console.log(`  ${topicId}｜${entry.topicTitle}：${entry.themes.length} 個主題均為 0 題`);
    }
  }

  console.log("");
  console.log(
    `需要補題的主題：${needs.length} 個；建議總共補 ${needs.reduce((sum, entry) => sum + entry.deficit, 0)} 題。`,
  );
}

function main(): void {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  warnIfNpmSwallowedApply(apply);

  const topicId = readArg("--topic")?.trim() || "topic-9";
  const databasePath = path.resolve(
    readArg("--database") ?? process.env.APP_DATABASE_PATH ?? path.join("data", "app.db"),
  );
  const ownerEmail = readArg("--owner-email")?.trim() ?? "";
  const manifestPath = readArg("--manifest");
  const audit = argv.includes("--audit");
  const topup = argv.includes("--topup");
  const coarseThreshold = Number.parseInt(readArg("--threshold") ?? "60", 10) || 60;
  const thinThreshold = Number.parseInt(readArg("--thin") ?? "10", 10) || 10;
  const targetProfile = {
    total: Number.parseInt(readArg("--target") ?? "24", 10) || 24,
    advanced: Number.parseInt(readArg("--target-advanced") ?? "5", 10) || 5,
    challenge: Number.parseInt(readArg("--target-challenge") ?? "5", 10) || 5,
    fill: Number.parseInt(readArg("--target-fill") ?? "8", 10) || 8,
  };

  if (!fs.existsSync(databasePath)) {
    console.error(`找不到資料庫：${databasePath}`);
    process.exit(1);
  }
  if (isProductionRuntime()) {
    console.error(
      "正式環境（Cloud Run / NODE_ENV=production）不可執行此指令，請在離線快照上規劃後再匯入。",
    );
    process.exit(1);
  }
  if (apply && ownerEmail.length === 0) {
    console.error("--apply 必須同時提供 --owner-email（記錄這次改動由誰決定）。");
    process.exit(1);
  }

  // 稽核及模擬均以唯讀方式開啟：保證不會執行 migration，也不可能寫入。
  if (!apply) enableReadOnlyDatabaseMode();
  process.env.APP_DATABASE_PATH = databasePath;

  if (audit) {
    auditThemes(databasePath, coarseThreshold, thinThreshold);
    return;
  }
  if (topup) {
    topupThemes(databasePath, targetProfile);
    return;
  }

  const plan = loadPlan(topicId);
  const topic = getTopic(topicId);
  if (!topic) {
    console.error(`資料庫內找不到課題：${topicId}`);
    process.exit(1);
  }
  const sections = listSections(topicId);
  const sourceSectionIds = focusSourceSectionIds(plan);
  const existingSources = sourceSectionIds.filter((id) =>
    sections.some((section) => section.id === id),
  );

  const blocks: PlannedBlock[] =
    existingSources.length > 0
      ? classifyBlocks(
          listBlocksByTopic(topicId)
            .filter((block) => block.sectionId !== null && existingSources.includes(block.sectionId))
            .map((block) => ({
              id: block.id,
              documentId: block.documentId,
              text: block.text,
              sortOrder: block.order,
            })),
          plan,
        ).map((block) => ({
          ...block,
          targetSectionId: targetIdFor(plan, block.classification),
        }))
      : [];

  /** 教材段落 → 主題鍵（供題目在題幹沒有關鍵詞時，按其引用的段落判斷） */
  const blockKeys = new Map(blocks.map((block) => [block.id, block.classification.key] as const));

  /**
   * 題目分類的第二步：題幹及節錄都沒有關鍵詞時，改看它引用的教材段落。
   *
   * 這些題目多數是「挖空式」填充題（例如「奧匈帝國瓦解後，分裂為……」），題幹本身
   * 沒有「一戰」「巴黎和會」等字眼，但引用的段落明顯屬某一主題。若只看題幹，
   * 它們會全部留在「綜合」主題，令各主題的題目偏少。
   * 只在一題引用的段落**全部屬同一主題**時才採用，否則維持「綜合」。
   */
  function keyFromSourceBlocks(sourceBlockIds: string[]): string | null {
    const keys = new Set(
      sourceBlockIds
        .map((id) => blockKeys.get(id))
        .filter((key): key is string => typeof key === "string" && key !== plan.overviewKey),
    );
    if (keys.size !== 1) return null;
    return [...keys][0]!;
  }

  const questions: PlannedQuestion[] =
    existingSources.length > 0
      ? listQuestions({ topicId, sectionIds: existingSources }).map((question) => {
          const classification = classifyQuestionFocus(question, plan);
          if (classification.key === null && !classification.ambiguous) {
            const fromSource = keyFromSourceBlocks(question.sourceBlockIds);
            if (fromSource !== null) {
              const inferred: FocusClassification = { ...classification, key: fromSource };
              return {
                id: question.id,
                questionType: question.questionType,
                difficulty: question.difficulty,
                status: question.status,
                classification: inferred,
                targetSectionId: targetIdFor(plan, inferred),
                inferredFromSource: true,
              };
            }
          }
          return {
            id: question.id,
            questionType: question.questionType,
            difficulty: question.difficulty,
            status: question.status,
            classification,
            targetSectionId: targetIdFor(plan, classification),
          };
        })
      : [];

  const studentVisibleDocuments = new Map(
    listDocuments()
      .filter((document) => document.topicId === topicId)
      .map((document) => [document.id, document.studentDistribution] as const),
  );

  console.log(`資料庫：${databasePath}`);
  console.log(`課題：${topic.title}（${topicId}）`);
  console.log(`來源分節：${existingSources.join("、")}`);
  console.log(`模式：${apply ? "寫入（--apply）" : "模擬（預設，不會寫入）"}`);
  console.log("");

  if (existingSources.length === 0) {
    console.log("來源分節已不存在（可能已拆分），沒有需要處理的題目。");
    return;
  }

  const header = ["主題", "題目", "選擇題", "填充題", "基本／進階／挑戰", "段落", "學生可見"] as const;
  const rows = plan.targets.map((target) => {
    const targetQuestions = questions.filter((item) => item.targetSectionId === target.id);
    const targetBlocks = blocks.filter((item) => item.targetSectionId === target.id);
    const mc = targetQuestions.filter((item) => item.questionType === "mc").length;
    const fill = targetQuestions.filter((item) => item.questionType === "fill").length;
    const diff = (["basic", "advanced", "challenge"] as const).map(
      (level) => targetQuestions.filter((item) => item.difficulty === level).length,
    );
    const visible = targetBlocks.filter((item) => studentVisibleDocuments.get(item.documentId) === true).length;
    return [
      `${target.title}（${target.id}）`,
      String(targetQuestions.length),
      String(mc),
      String(fill),
      diff.join("／"),
      String(targetBlocks.length),
      String(visible),
    ];
  });

  const widths = header.map((_, index) =>
    Math.max(header[index]!.length, ...rows.map((row) => row[index]!.length)),
  );
  const format = (cells: string[]) =>
    cells.map((cell, index) => (index === 0 ? cell : cell.padStart(widths[index]!))).join("｜");
  console.log(format([...header]));
  console.log(widths.map((width) => "─".repeat(width)).join("┼"));
  for (const row of rows) console.log(format(row));
  console.log("");

  const overviewId = focusTargetFor(plan, null).id;
  const ambiguous = questions.filter((item) => item.classification.ambiguous);
  const unclassified = questions.filter(
    (item) => item.classification.key === null && !item.classification.ambiguous,
  );
  console.log(
    `留在「綜合」主題：${questions.filter((item) => item.targetSectionId === overviewId).length} 題` +
      `（同時命中多個主題 ${ambiguous.length} 題；沒有任何主題關鍵詞 ${unclassified.length} 題）`,
  );
  const inheritedBlocks = blocks.filter((item) => item.inherited).length;
  console.log(
    `教材段落：按段落文字判斷 ${blocks.length - inheritedBlocks} 段，沿用前一段主題 ${inheritedBlocks} 段`,
  );
  const fromSource = questions.filter((item) => item.inferredFromSource === true).length;
  if (fromSource > 0) {
    console.log(`題目：其中 ${fromSource} 題的題幹沒有時期關鍵詞，按其引用的教材段落判斷時期`);
  }

  const thin = plan.targets.filter((target) => {
    const count = questions.filter((item) => item.targetSectionId === target.id).length;
    return target.key !== plan.overviewKey && target.classifyKeywords.length > 0 && count < 10;
  });
  if (thin.length > 0) {
    console.log("");
    console.log("提醒：以下主題題目少於 10 題，拆分後需補題（AI 生成或教師輸入）：");
    for (const target of thin) console.log(`  - ${target.title}`);
  }

  if (!apply) {
    console.log("");
    console.log("模擬完成，沒有寫入任何內容。確認數字合理後可加 --apply --owner-email <電郵> 寫入。");
    return;
  }

  let createdSections = 0;
  for (const target of plan.targets) {
    upsertSection({
      id: target.id,
      topicId,
      title: target.title,
      summary: target.summary,
      matchKeywords: target.matchKeywords,
      order: target.sortOrder,
    });
    if (target.create) createdSections += 1;
  }
  for (const override of plan.orderOverrides ?? []) {
    setSectionOrder(override.id, override.sortOrder);
  }

  const movedQuestions: Record<string, number> = {};
  for (const target of plan.targets) {
    const ids = questions.filter((item) => item.targetSectionId === target.id).map((item) => item.id);
    let moved = 0;
    for (const id of ids) {
      if (moveQuestionToSection(id, target.id)) moved += 1;
    }
    movedQuestions[target.id] = moved;
  }

  const movedBlocks: Record<string, number> = {};
  for (const target of plan.targets) {
    const ids = blocks.filter((item) => item.targetSectionId === target.id).map((item) => item.id);
    movedBlocks[target.id] = moveBlocksToSection(ids, target.id);
  }

  // 合併過細的主題後，刪除已無題目及教材段落的舊分節（否則學生會見到 0 題的選項）
  const removedSections: string[] = [];
  const keptSections: string[] = [];
  for (const sectionId of plan.removeEmptySectionIds ?? []) {
    const questionCount = countQuestions({ sectionIds: [sectionId] });
    const blockCount = listBlocksByTopic(topicId).filter(
      (block) => block.sectionId === sectionId,
    ).length;
    if (questionCount === 0 && blockCount === 0) {
      deleteSection(sectionId);
      removedSections.push(sectionId);
    } else {
      keptSections.push(`${sectionId}（仍有 ${questionCount} 題、${blockCount} 段）`);
    }
  }

  console.log("");
  console.log(`已建立／更新 ${plan.targets.length} 個主題（新建立 ${createdSections} 個）：`);
  for (const target of plan.targets) {
    console.log(
      `  ${target.title}：題目 ${movedQuestions[target.id] ?? 0} 題、教材段落 ${movedBlocks[target.id] ?? 0} 段`,
    );
  }
  if (removedSections.length > 0) {
    console.log(`已刪除空白分節：${removedSections.join("、")}`);
  }
  if (keptSections.length > 0) {
    console.log(`保留仍有內容的分節（未刪除）：${keptSections.join("；")}`);
  }

  if (manifestPath) {
    const resolved = path.isAbsolute(manifestPath)
      ? manifestPath
      : path.join(process.cwd(), manifestPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(
      resolved,
      JSON.stringify(
        {
          topicId,
          sourceSectionId: plan.sourceSectionId,
          sourceSectionIds: existingSources,
          removedSectionIds: removedSections,
          generatedAt: new Date().toISOString(),
          applied: true,
          actorEmail: ownerEmail,
          targets: plan.targets,
          questions: questions.map((item) => ({
            id: item.id,
            sectionId: item.targetSectionId,
            theme: item.classification.key,
            ambiguous: item.classification.ambiguous,
            scores: item.classification.scores,
          })),
          // 教材段落只記錄每個主題的段數：逐段清單可由再次執行模擬重新產生，
          // 沒有必要把數千個 block id 寫進版本庫。
          blockCounts: Object.fromEntries(
            plan.targets.map((target) => [
              target.id,
              blocks.filter((item) => item.targetSectionId === target.id).length,
            ]),
          ),
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`清單已寫入：${resolved}`);
  }
}

main();
