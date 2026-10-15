import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { getServerConfig } from "@/server/config";
import { getDb } from "@/server/db/connection";
import { parseDocx } from "@/server/materials/docx";
import { parsePdf } from "@/server/materials/pdf";
import { IMAGE_BLOCK_TEXT } from "@/server/materials/html-to-blocks";
import { importMaterial } from "@/server/materials/import-service";
import { resolveMaterialPath } from "@/server/materials/material-files";
import { mapBlocksToSections } from "@/server/materials/section-mapper";
import { listBlocksByDocument, listBlocksByTopic, listDocuments } from "@/server/repositories/materials";
import { listQuestions } from "@/server/repositories/questions";
import { listSections } from "@/server/repositories/topics";
import { seedDemoQuestionBank, seedTopicStructureOnly } from "@/server/seed";

import { freshTestDatabasePath } from "./test-database";

// 使用獨立暫存資料庫，不會影響本機示範資料
const testDbPath = freshTestDatabasePath("materials");
process.env.APP_DATABASE_PATH = testDbPath;

const { materialsDir } = getServerConfig();
// 書本內容以課題分資料夾存放，路徑由共用解析器找出（相容舊的檔名寫法）
const pilotPath = resolveMaterialPath(materialsDir, "課題5 近代歐洲的興起/課題5 近代歐洲的興起.docx");
// PDF 解析用倉庫內自製的最小樣本，不依賴 materials/ 內具版權的教材
const pdfFixturePath = fileURLToPath(new URL("./fixtures/sample-guideline.pdf", import.meta.url));
const hasPilot = pilotPath !== null;
const pilotFileName = pilotPath ? path.basename(pilotPath) : "";

describe.skipIf(!hasPilot)("試點 DOCX 解析", () => {
  it("擷取到大量段落、表格及圖片標示", async () => {
    const result = await parseDocx(fs.readFileSync(pilotPath as string), pilotFileName);

    expect(result.blocks.length).toBeGreaterThan(500);
    expect(
      result.blocks.filter((block) => block.type === "table").length,
    ).toBeGreaterThanOrEqual(10);
    expect(result.imageCount).toBeGreaterThan(0);
    expect(
      result.blocks.some((block) => block.type === "image" && block.text === IMAGE_BLOCK_TEXT),
    ).toBe(true);
    expect(result.limitationNote).toContain("圖片內容未能自動擷取");

    const combined = result.blocks.map((block) => block.text).join("\n");
    expect(combined).toContain("馬丁路德");
    expect(combined).toContain("瓦特");
  });

  it("匯入教材後大部分段落能對應分節，示範題目亦全部通過教材依據核對", async () => {
    getDb();
    seedTopicStructureOnly();

    const buffer = fs.readFileSync(pilotPath as string);
    const outcome = await importMaterial({
      fileName: path.basename(pilotPath as string),
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: buffer.byteLength,
      buffer,
      topicId: "topic-5",
      kind: "demo",
    });

    expect(outcome.document.status).toBe("ready");
    expect(outcome.blocks.length).toBeGreaterThan(500);
    expect(outcome.detectedTopic?.id).toBe("topic-5");

    const sections = listSections("topic-5");
    const parsed = await parseDocx(buffer, path.basename(pilotPath as string));
    const assignment = mapBlocksToSections(parsed.blocks, sections);
    const assigned = assignment.sectionIds.filter((id) => id !== null).length;
    expect(assigned / parsed.blocks.length).toBeGreaterThan(0.9);
    expect(assignment.matchedSectionIds.length).toBeGreaterThanOrEqual(15);

    const report = seedDemoQuestionBank();
    expect(report.materialBlockCount).toBeGreaterThan(500);
    expect(report.totalQuestions).toBeGreaterThan(20);
    expect(report.unverifiedQuestions).toEqual([]);
    expect(report.verifiedQuestions).toBe(report.totalQuestions);
    expect(listBlocksByTopic("topic-5").length).toBeGreaterThan(500);
  });

  it("重新匯入同名教材會取代舊版本，並重新核對題目的教材依據", async () => {
    getDb();
    seedTopicStructureOnly();

    const fileName = path.basename(pilotPath as string);
    const buffer = fs.readFileSync(pilotPath as string);
    const first = await importMaterial({
      fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: buffer.byteLength,
      buffer,
      topicId: "topic-5",
      kind: "demo",
    });
    seedDemoQuestionBank();

    const before = listQuestions({ topicId: "topic-5" });
    expect(before.length).toBeGreaterThan(20);
    const oldBlockIds = new Set(listBlocksByDocument(first.document.id).map((block) => block.id));

    const second = await importMaterial({
      fileName,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      sizeBytes: buffer.byteLength,
      buffer,
      topicId: "topic-5",
      kind: "demo",
    });

    // 同名教材只會有一份，不會產生重複教材
    expect(listDocuments().filter((document) => document.fileName === fileName)).toHaveLength(1);

    const newBlockIds = new Set(
      listBlocksByDocument(second.document.id).map((block) => block.id),
    );
    const after = listQuestions({ topicId: "topic-5" });
    expect(after).toHaveLength(before.length);

    // 題目的教材依據段落 ID 已更新為新版本的段落，並保持「已核對」
    const reanchored = after.filter((question) =>
      question.sourceBlockIds.some((blockId) => oldBlockIds.has(blockId) === false),
    );
    expect(reanchored.length).toBeGreaterThan(0);
    for (const question of after) {
      expect(question.sourceVerified).toBe(true);
      expect(question.sourceBlockIds.every((blockId) => newBlockIds.has(blockId))).toBe(true);
    }
  });

  it("不支援的檔案格式會回報可理解的錯誤，而不會令網站出錯", async () => {
    const outcome = await importMaterial({
      fileName: "舊教材.doc",
      mimeType: "application/msword",
      sizeBytes: 10,
      buffer: Buffer.from("not a real doc"),
      topicId: "topic-5",
      kind: "uploaded",
    });

    expect(outcome.document.status).toBe("failed");
    expect(outcome.document.errorMessage).toContain(".docx");
    expect(outcome.blocks).toHaveLength(0);
  });
});

describe("PDF 解析", () => {
  it("可以擷取文字層並回報限制", async () => {
    const result = await parsePdf(fs.readFileSync(pdfFixturePath), "sample-guideline.pdf");

    expect(result.pageCount).toBe(3);
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.blocks.every((block) => block.text.length > 0)).toBe(true);
    expect(result.imageCount).toBe(0);
    expect(result.limitationNote).toContain("文字層");
  });
});
