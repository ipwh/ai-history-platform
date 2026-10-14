import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { isUsableOcrText, normalizeOcrText, resolveLanguageSource } from "@/server/ocr/tesseract-provider";
import { mimeTypeForFileName, isOcrSupportedMime } from "@/server/ocr/provider";
import { encodeRawImageToPng } from "@/server/ocr/png-encoder";
import { buildOcrBlockText } from "@/server/ocr/sources";
import {
  extractOcrAnnotation,
  isGarbledOcrText,
  looksLikeOcrText,
  stripOcrAnnotation,
} from "@/server/services/ocr-text";
import { generateQuestionsFromMaterial } from "@/server/llm/mock-provider";

describe("OCR 文字正規化", () => {  it("移除中文字之間多餘的空格並整理空白行", () => {
    const raw = "常任 理事國\n\n非洲   亞洲\n  \n拉丁 美洲";
    expect(normalizeOcrText(raw)).toBe("常任理事國\n非洲亞洲\n拉丁美洲");
  });

  it("保留英文之間的空格", () => {
    expect(normalizeOcrText("United Nations Security Council")).toBe(
      "United Nations Security Council",
    );
  });

  it("沒有文字時回傳空字串", () => {
    expect(normalizeOcrText("   \n  \n")).toBe("");
  });

  it("處理全角空格及不斷行空格", () => {
    expect(normalizeOcrText("工業\u3000革命\u00a0時期")).toBe("工業革命時期");
  });

  it("連續交替的中文字與空格都能移除", () => {
    expect(normalizeOcrText("法 國 大 革 命")).toBe("法國大革命");
  });
});

describe("OCR 結果可用性判斷", () => {
  const minimums = { minChars: 8, minConfidence: 0.3 };

  it("接受有足夠中文字元且信心足夠的結果", () => {
    expect(isUsableOcrText("歐洲經濟共同體（1958年）", 0.72, minimums)).toBe(true);
  });

  it("拒絕字數太少的结果（雜訊）", () => {
    expect(isUsableOcrText("條 多", 0.9, minimums)).toBe(false);
    expect(isUsableOcrText("c 人 9", 0.9, minimums)).toBe(false);
  });

  it("拒絕信心過低的結果", () => {
    expect(isUsableOcrText("歐洲經濟共同體（1958年）", 0.12, minimums)).toBe(false);
  });

  it("沒有提供信心度時只按字數判斷", () => {
    expect(isUsableOcrText("歐洲經濟共同體（1958年）", null, minimums)).toBe(true);
    expect(isUsableOcrText("三", null, minimums)).toBe(false);
  });
});

describe("圖片格式判斷", () => {
  it("辨識可進行 OCR 的格式", () => {
    expect(isOcrSupportedMime("image/png")).toBe(true);
    expect(isOcrSupportedMime("image/jpeg")).toBe(true);
    expect(isOcrSupportedMime("image/tiff")).toBe(true);
  });

  it("不支援向量或特殊格式（需如實回報而非猜測）", () => {
    expect(isOcrSupportedMime("image/emf")).toBe(false);
    expect(isOcrSupportedMime("image/wmf")).toBe(false);
    expect(isOcrSupportedMime("image/vnd.ms-photo")).toBe(false);
  });

  it("由檔名推斷 MIME 類型", () => {
    expect(mimeTypeForFileName("word/media/image1.png")).toBe("image/png");
    expect(mimeTypeForFileName("word/media/image2.jpeg")).toBe("image/jpeg");
    expect(mimeTypeForFileName("word/media/image3.emf")).toBe("image/emf");
  });
});

describe("PNG 編碼（PDF 掃描頁用）", () => {
  it("把原始像素編碼成有效的 PNG 檔頭", () => {
    const width = 4;
    const height = 3;
    const data = new Uint8ClampedArray(width * height * 3).fill(200);
    const png = encodeRawImageToPng({ data, width, height, channels: 3 });

    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.subarray(12, 16).toString("ascii")).toBe("IHDR");
    expect(png.subarray(png.length - 8, png.length - 4).toString("ascii")).toBe("IEND");
    // IHDR 內記錄的寬高必須正確
    expect(png.readUInt32BE(16)).toBe(width);
    expect(png.readUInt32BE(20)).toBe(height);
  });

  it("像素資料不足時會回報錯誤，而不是產生壞檔", () => {
    expect(() =>
      encodeRawImageToPng({
        data: new Uint8ClampedArray(10),
        width: 100,
        height: 100,
        channels: 3,
      }),
    ).toThrow(/像素資料長度不足/);
  });
});

describe("OCR 段落的來源說明", () => {
  it("加入及移除 OCR 來源說明", () => {
    const text = buildOcrBlockText("HNC2A2E_T5_SN_TE.docx · word/media/image12.png", "歐洲經濟共同體");
    expect(text).toContain("歐洲經濟共同體");
    expect(text).toContain("以上文字由 OCR 從圖片擷取");
    expect(stripOcrAnnotation(text)).toBe("歐洲經濟共同體");
    expect(extractOcrAnnotation(text)).toContain("image12.png");
    expect(looksLikeOcrText(text)).toBe(true);
  });

  it("一般教材文字不會被誤認為 OCR", () => {
    expect(stripOcrAnnotation("文藝復興是十四至十七世紀的革新運動。")).toBe(
      "文藝復興是十四至十七世紀的革新運動。",
    );
    expect(looksLikeOcrText("文藝復興")).toBe(false);
    expect(extractOcrAnnotation("文藝復興")).toBeNull();
  });
});

describe("OCR 雜訊判斷", () => {
  it("零散單字視為雜訊", () => {
    expect(isGarbledOcrText("俄國\n德國\n: 況\n奧匈\n法國 全")).toBe(true);
    expect(isGarbledOcrText("圖鉛 泊 ‧ 主要 城市 現今國 界")).toBe(true);
  });

  it("完整句子或專有名詞不會被視為雜訊", () => {
    expect(isGarbledOcrText("歐洲經濟共同體在1958年成立，最初有六個成員國。")).toBe(false);
    expect(isGarbledOcrText("耶穌基督的誕生")).toBe(false);
    expect(isGarbledOcrText("民族主義\n帝國主義\n軍備競賽")).toBe(false);
  });

  it("規則式生成不會用雜訊 OCR 文字出題", () => {
    const questions = generateQuestionsFromMaterial({
      topicTitle: "課題9",
      sectionTitle: "兩次世界大戰",
      questionTypes: ["mc"],
      difficulty: "basic",
      count: 2,
      materialUnits: [
        {
          blockId: "blk_noise",
          sourceLocation: "教材 · OCR 擷取",
          text: "俄國\n德國\n: 況\n奧匈\n法國 全",
          fromOcr: true,
        },
      ],
    });

    expect(questions).toEqual([]);
  });

  it("可用的 OCR 文字仍可出題", () => {
    const questions = generateQuestionsFromMaterial({
      topicTitle: "課題9",
      sectionTitle: "兩次世界大戰",
      questionTypes: ["mc", "fill"],
      difficulty: "basic",
      count: 3,
      materialUnits: [
        {
          blockId: "blk_ocr",
          sourceLocation: "教材 · OCR 擷取",
          text: "國際聯盟：第一次世界大戰後成立的國際組織，目的是維持世界和平。",
          fromOcr: true,
        },
        {
          blockId: "blk_ocr2",
          sourceLocation: "教材 · OCR 擷取",
          text: "聯合國：第二次世界大戰後成立的國際組織，取代國際聯盟。",
          fromOcr: true,
        },
        {
          blockId: "blk_ocr3",
          sourceLocation: "教材 · OCR 擷取",
          text: "華盛頓會議：1921年召開的國際會議，討論海軍軍備限制。",
          fromOcr: true,
        },
      ],
    });

    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((question) => question.sourceExcerpt.length > 0)).toBe(true);
    expect(questions[0].sourceBlockIds).toEqual(["blk_ocr"]);
    expect(questions[0].sourceExcerpt).toContain("國際聯盟");
  });
});

describe("OCR 語言資料來源判斷（容器／離線部署用）", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hist-ocr-lang-"));

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("目錄內是未壓縮的 .traineddata 時會設定 gzip: false", () => {
    const plainDir = path.join(tempDir, "plain");
    fs.mkdirSync(plainDir, { recursive: true });
    fs.writeFileSync(path.join(plainDir, "chi_tra.traineddata"), "stub");
    expect(resolveLanguageSource(plainDir, ["chi_tra"])).toEqual({
      langPath: plainDir,
      gzip: false,
    });
  });

  it("目錄內是壓縮的 .traineddata.gz 時沿用預設（不覆寫 gzip）", () => {
    const gzipDir = path.join(tempDir, "gzip");
    fs.mkdirSync(gzipDir, { recursive: true });
    fs.writeFileSync(path.join(gzipDir, "chi_tra.traineddata.gz"), "stub");
    expect(resolveLanguageSource(gzipDir, ["chi_tra"])).toEqual({ langPath: gzipDir });
  });

  it("未設定語言資料目錄時不加入任何選項（改由 tesseract.js 下載並快取）", () => {
    expect(resolveLanguageSource(undefined, ["chi_tra"])).toEqual({});
    expect(resolveLanguageSource("", ["chi_tra"])).toEqual({});
  });

  it("兩種檔案都不存在時保留原設定，交由 tesseract.js 回報缺少語言資料", () => {
    const emptyDir = path.join(tempDir, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });
    expect(resolveLanguageSource(emptyDir, ["chi_tra"])).toEqual({ langPath: emptyDir });
  });

  it("多語言時需要全部語言都有檔案才切換 gzip 設定，否則沿用預設", () => {
    const mixedDir = path.join(tempDir, "mixed");
    fs.mkdirSync(mixedDir, { recursive: true });
    fs.writeFileSync(path.join(mixedDir, "chi_tra.traineddata"), "stub");
    expect(resolveLanguageSource(mixedDir, ["chi_tra", "eng"])).toEqual({ langPath: mixedDir });
  });
});