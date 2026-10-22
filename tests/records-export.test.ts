/**
 * 練習記錄匯出（CSV／XLSX／DOCX／PDF）測試。
 *
 * 驗證：
 *   1. 四種格式都能產生，且 Content-Type／檔名正確。
 *   2. XLSX 是有效的 ZIP，含練習概況及逐題記錄兩張工作表，中文內容正確。
 *   3. DOCX 是有效的 ZIP，逐題內容以表格呈現。
 *   4. PDF 是有效文件，中文字可被抽取（證明字型已嵌入），大量記錄會分頁。
 *   5. 危險字元（`<`、`&`、控制字元）不會弄壞 XML，CSV 仍會阻擋公式注入。
 */
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import type { PracticeRecordSession } from "@/lib/types";
import {
  buildRecordsExport,
  hongKongDateTime,
  MAX_READABLE_SESSIONS,
  parseRecordsExportFormat,
} from "@/server/services/records-export";

function makeRecord(overrides: Partial<PracticeRecordSession> = {}): PracticeRecordSession {
  return {
    sessionId: "sess_1",
    learnerId: "school:s1234@pochiu.edu.hk",
    learnerLabel: "陳大文（4A・12）",
    learnerName: "陳大文",
    learnerClassName: "4A",
    learnerStudentNumber: "12",
    learnerEmail: "s1234@pochiu.edu.hk",
    topicId: "hs-topic-1",
    topicTitle: "高中・主題甲｜課題1：香港的現代化與蛻變",
    createdAt: "2026-10-21T06:40:42.068Z",
    completedAt: "2026-10-21T06:45:00.000Z",
    questionTypes: ["mc", "fill"],
    questionTypeLabels: ["選擇題", "填充題"],
    difficulty: "basic",
    difficultyLabel: "基礎",
    totalQuestions: 2,
    answeredCount: 2,
    correctCount: 1,
    wrongCount: 1,
    accuracy: 0.5,
    questions: [
      {
        questionId: "q1",
        questionType: "mc",
        questionTypeLabel: "選擇題",
        question: "下列哪一項是香港普及教育的發展？<小學> & 中學",
        sectionTitle: "1.1 香港的政治及行政轉變",
        studentAnswer: "推行九年免費教育",
        correctAnswer: "推行九年免費教育",
        isCorrect: true,
        selfAssessment: null,
        aiVerdict: null,
        answered: true,
      },
      {
        questionId: "q2",
        questionType: "fill",
        questionTypeLabel: "填充題",
        question: "香港在 ______ 年回歸中國。",
        sectionTitle: "1.1 香港的政治及行政轉變",
        studentAnswer: "1999",
        correctAnswer: "1997",
        isCorrect: false,
        selfAssessment: null,
        aiVerdict: null,
        answered: true,
      },
    ],
    ...overrides,
  };
}

async function unzip(buffer: Buffer): Promise<Record<string, string>> {
  const zip = await JSZip.loadAsync(buffer);
  const files: Record<string, string> = {};
  for (const name of Object.keys(zip.files)) {
    if (name.endsWith(".xml") || name.endsWith(".rels")) {
      files[name] = await zip.files[name].async("string");
    }
  }
  return files;
}

describe("匯出格式", () => {
  it("預設為 CSV，未知格式會被拒絕", () => {
    expect(parseRecordsExportFormat(null)).toBe("csv");
    expect(parseRecordsExportFormat("")).toBe("csv");
    expect(parseRecordsExportFormat("XLSX")).toBe("xlsx");
    expect(() => parseRecordsExportFormat("xls")).toThrow(/不支援的匯出格式/);
  });

  it("香港時間顯示與伺服器時區無關", () => {
    expect(hongKongDateTime("2026-10-21T06:40:00.000Z")).toBe("2026-10-21 14:40");
    expect(hongKongDateTime(null)).toBe("—");
  });

  it("CSV 保留原有欄位並阻擋公式注入", async () => {
    const danger = makeRecord({
      questions: [
        {
          ...makeRecord().questions[0],
          studentAnswer: "=1+1",
        },
      ],
      totalQuestions: 1,
      answeredCount: 1,
      correctCount: 1,
      wrongCount: 0,
    });
    const result = await buildRecordsExport([danger], {
      format: "csv",
      generatedAt: new Date("2026-10-22T02:00:00.000Z"),
    });
    expect(result.contentType).toContain("text/csv");
    expect(result.filename).toBe("practice-records-2026-10-22.csv");
    const text = result.body.toString("utf8");
    expect(text.startsWith("\uFEFF作答日期,")).toBe(true);
    expect(text).toContain("'=1+1");
  });
});

describe("XLSX 匯出", () => {
  it("產生有效活頁簿，含概況及逐題記錄兩張工作表", async () => {
    const result = await buildRecordsExport([makeRecord()], {
      format: "xlsx",
      filterSummary: "課題 hs-topic-1",
      generatedAt: new Date("2026-10-22T02:00:00.000Z"),
    });
    expect(result.contentType).toContain("spreadsheetml.sheet");
    expect(result.filename).toBe("practice-records-2026-10-22.xlsx");

    const files = await unzip(result.body);
    expect(files["[Content_Types].xml"]).toContain("/xl/workbook.xml");
    expect(files["xl/workbook.xml"]).toContain('name="練習概況"');
    expect(files["xl/workbook.xml"]).toContain('name="逐題記錄"');

    const detail = files["xl/worksheets/sheet3.xml"];
    expect(detail).toContain("推行九年免費教育");
    // `<` 與 `&` 必須轉義，否則 Excel 會判定檔案損毀
    expect(detail).toContain("&lt;小學&gt; &amp; 中學");
    expect(detail).not.toContain("<小學>");

    const overview = files["xl/worksheets/sheet2.xml"];
    expect(overview).toContain("<v>50</v>"); // 準確率（%）
    expect(overview).toContain("sess_1");
  });
});

describe("DOCX 匯出", () => {
  it("產生有效文件，逐題內容以表格呈現", async () => {
    const result = await buildRecordsExport([makeRecord()], {
      format: "docx",
      filterSummary: "學習者 陳大文・4A・12",
      generatedAt: new Date("2026-10-22T02:00:00.000Z"),
    });
    expect(result.contentType).toContain("wordprocessingml.document");
    expect(result.filename).toBe("practice-records-2026-10-22.docx");

    const files = await unzip(result.body);
    const document = files["word/document.xml"];
    expect(document).toContain("學生練習記錄");
    expect(document).toContain("陳大文（4A・12）");
    expect(document).toContain("<w:tbl>");
    expect(document).toContain("推行九年免費教育");
    expect(document).toContain("&lt;小學&gt; &amp; 中學");
    expect(document).toContain("學習者 陳大文・4A・12");
    expect(files["word/styles.xml"]).toContain('w:styleId="Heading1"');
  });

  it("沒有記錄時仍會產生可開啟的檔案並說明原因", async () => {
    const result = await buildRecordsExport([], { format: "docx" });
    const files = await unzip(result.body);
    expect(files["word/document.xml"]).toContain("目前沒有符合條件的練習記錄");
  });
});

describe("PDF 匯出", () => {
  it("嵌入中文字型並可被抽取，內容與篩選條件一致", async () => {
    const result = await buildRecordsExport([makeRecord()], {
      format: "pdf",
      filterSummary: "全部課題、全部學習者",
      generatedAt: new Date("2026-10-22T02:00:00.000Z"),
    });
    expect(result.contentType).toBe("application/pdf");
    expect(result.filename).toBe("practice-records-2026-10-22.pdf");
    expect(result.body.subarray(0, 5).toString("latin1")).toBe("%PDF-");

    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(result.body));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    expect(totalPages).toBeGreaterThanOrEqual(1);
    expect(text).toContain("學生練習記錄");
    expect(text).toContain("陳大文");
    expect(text).toContain("推行九年免費教育");
    expect(text).toContain("答錯");
  });

  it("大量記錄會自動分頁，並在超過上限時註明只列最近若干次", async () => {
    const many = Array.from({ length: MAX_READABLE_SESSIONS + 20 }, (_, index) =>
      makeRecord({ sessionId: `sess_${index}` }),
    );
    const result = await buildRecordsExport(many, { format: "pdf" });
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(result.body));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    expect(totalPages).toBeGreaterThan(1);
    expect(text).toContain(`本文件只包含最近 ${MAX_READABLE_SESSIONS} 次`);
    expect(totalPages).toBeLessThan(400);
  });
});
