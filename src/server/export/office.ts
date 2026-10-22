/**
 * 最小但完整的 Office Open XML 產生器（XLSX／DOCX）。
 *
 * XLSX 與 DOCX 本質上都是 ZIP 內含 XML，因此不需要額外的重量級套件，
 * 只用專案已有的 jszip 產生，部署映像不會因此膨脹。
 *
 * 兩個產生器都只實作本平台需要的功能（文字、數字、粗體、換行、凍結首列、
 * 篩選、表格），刻意不支援圖表、公式或巨集。
 */
import JSZip from "jszip";

export type CellValue = string | number | null | undefined;

export interface SheetSpec {
  /** 工作表名稱（Excel 上限 31 字元，且不可包含 []:*?/\） */
  name: string;
  columns: string[];
  /** 每列的值；null／undefined／空字串會留空 */
  rows: CellValue[][];
  /** 直欄寬度（字元數）；未提供時為 18 */
  widths?: number[];
}

export type DocxBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "note"; text: string }
  | { kind: "paragraph"; text: string; muted?: boolean }
  | { kind: "table"; columns: string[]; widths: number[]; rows: (string | null)[][] };

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const SPREADSHEET_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CONTENT_WIDTH_TWIPS = 9638;

/**
 * XML 文字轉義。
 *
 * 學生答案可能包含 `<`（例如比較大小的算式）、`&`（例如「A & B」）或控制字元，
 * 未轉義會令產生出來的檔案損壞（Excel／Word 會顯示「檔案已損毀」）。
 */
export function xmlEscape(value: string): string {
  return value
    // XML 1.0 不允許大部分控制字元，也不能出現在文字節點
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textNode(value: string): string {
  return `<is><t xml:space="preserve">${xmlEscape(value)}</t></is>`;
}

/** 0 → A、25 → Z、26 → AA（供 XLSX 的欄位編號使用） */
export function columnLetter(index: number): string {
  let remaining = index;
  let letters = "";
  while (remaining >= 0) {
    letters = String.fromCharCode(65 + (remaining % 26)) + letters;
    remaining = Math.floor(remaining / 26) - 1;
  }
  return letters;
}

function sanitizeSheetName(name: string, used: Set<string>): string {
  const base = (name.replace(/[[\]:*?/\\]/g, " ").trim() || "工作表").slice(0, 31);
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const tail = `（${suffix}）`;
    candidate = `${base.slice(0, 31 - tail.length)}${tail}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

const SHEET_STYLE_HEADER = 1;
const SHEET_STYLE_WRAP = 2;

function sheetXml(sheet: SheetSpec): string {
  const columnCount = Math.max(sheet.columns.length, ...sheet.rows.map((row) => row.length), 1);
  const rowCount = sheet.rows.length + 1;
  const lastRef = `${columnLetter(columnCount - 1)}${rowCount}`;

  const cols = Array.from({ length: columnCount }, (_, index) => {
    const width = sheet.widths?.[index] ?? 18;
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join("");

  const headerRow = `<row r="1">${sheet.columns
    .map(
      (header, index) =>
        `<c r="${columnLetter(index)}1" s="${SHEET_STYLE_HEADER}" t="inlineStr">${textNode(header)}</c>`,
    )
    .join("")}</row>`;

  const bodyRows = sheet.rows
    .map((row, rowIndex) => {
      const number = rowIndex + 2;
      const cells = row
        .map((value, index) => {
          const ref = `${columnLetter(index)}${number}`;
          if (value === null || value === undefined || value === "") return "";
          if (typeof value === "number" && Number.isFinite(value)) {
            return `<c r="${ref}" s="${SHEET_STYLE_WRAP}"><v>${value}</v></c>`;
          }
          return `<c r="${ref}" s="${SHEET_STYLE_WRAP}" t="inlineStr">${textNode(String(value))}</c>`;
        })
        .join("");
      return `<row r="${number}">${cells}</row>`;
    })
    .join("");

  return `${XML_DECLARATION}
<worksheet xmlns="${SPREADSHEET_NS}">
<dimension ref="A1:${lastRef}"/>
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${cols}</cols>
<sheetData>${headerRow}${bodyRows}</sheetData>
<autoFilter ref="A1:${lastRef}"/>
</worksheet>`;
}

const STYLES_XML = `${XML_DECLARATION}
<styleSheet xmlns="${SPREADSHEET_NS}">
<fonts count="2"><font><sz val="10"/><name val="Noto Sans TC"/></font><font><b/><sz val="10"/><name val="Noto Sans TC"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** 產生 XLSX 檔（每個 SheetSpec 一張工作表；首列凍結並可篩選） */
export async function buildXlsx(
  sheets: SheetSpec[],
  options: { title?: string } = {},
): Promise<Buffer> {
  if (sheets.length === 0) throw new Error("XLSX 至少需要一張工作表");
  const used = new Set<string>();
  const normalized = sheets.map((sheet) => ({ ...sheet, name: sanitizeSheetName(sheet.name, used) }));

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${XML_DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${normalized
  .map(
    (_sheet, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join("\n")}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `${XML_DECLARATION}
<Relationships xmlns="${PACKAGE_REL_NS}">
<Relationship Id="rId1" Type="${OFFICE_REL_NS}/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="${OFFICE_REL_NS}/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  );
  zip.file(
    "docProps/core.xml",
    `${XML_DECLARATION}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>${xmlEscape(options.title ?? "學生練習記錄")}</dc:title>
<dc:creator>香港中學歷史科自學互動網站</dc:creator>
</cp:coreProperties>`,
  );
  zip.file(
    "docProps/app.xml",
    `${XML_DECLARATION}
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>香港中學歷史科自學互動網站</Application></Properties>`,
  );
  zip.file(
    "xl/workbook.xml",
    `${XML_DECLARATION}
<workbook xmlns="${SPREADSHEET_NS}" xmlns:r="${OFFICE_REL_NS}">
<sheets>${normalized
      .map(
        (sheet, index) =>
          `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
      )
      .join("")}</sheets>
</workbook>`,
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `${XML_DECLARATION}
<Relationships xmlns="${PACKAGE_REL_NS}">
${normalized
  .map(
    (_sheet, index) =>
      `<Relationship Id="rId${index + 1}" Type="${OFFICE_REL_NS}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
  )
  .join("\n")}
<Relationship Id="rId${normalized.length + 1}" Type="${OFFICE_REL_NS}/styles" Target="styles.xml"/>
</Relationships>`,
  );
  zip.file("xl/styles.xml", STYLES_XML);
  normalized.forEach((sheet, index) => {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, sheetXml(sheet));
  });

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}

function docxRun(
  text: string,
  options: { bold?: boolean; size?: number; color?: string } = {},
): string {
  if (text.length === 0) return "";
  const properties = [
    options.bold ? "<w:b/>" : "",
    options.size ? `<w:sz w:val="${options.size}"/>` : "",
    options.color ? `<w:color w:val="${options.color}"/>` : "",
  ].join("");
  // 明確換行（\n）在 Word 是獨立的 <w:br/>，不可直接寫在 <w:t> 內
  const runs = text
    .split("\n")
    .map((line) => `<w:t xml:space="preserve">${xmlEscape(line)}</w:t>`)
    .join("<w:br/>");
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}${runs}</w:r>`;
}

function docxParagraph(
  text: string,
  options: { style?: string; bold?: boolean; size?: number; color?: string } = {},
): string {
  const paragraphProperties = options.style ? `<w:pStyle w:val="${options.style}"/>` : "";
  return `<w:p>${paragraphProperties ? `<w:pPr>${paragraphProperties}</w:pPr>` : ""}${docxRun(text, options)}</w:p>`;
}

function docxTable(block: Extract<DocxBlock, { kind: "table" }>): string {
  const borders =
    "<w:tblBorders>" +
    ["top", "left", "bottom", "right", "insideH", "insideV"]
      .map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`)
      .join("") +
    "</w:tblBorders>";
  const grid = block.widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("");
  const headerRow = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${block.columns
    .map(
      (column, index) =>
        `<w:tc><w:tcPr><w:tcW w:w="${block.widths[index]}" w:type="dxa"/></w:tcPr>${docxParagraph(column, {
          bold: true,
          size: 18,
        })}</w:tc>`,
    )
    .join("")}</w:tr>`;
  const bodyRows = block.rows
    .map(
      (row) =>
        `<w:tr>${row
          .map(
            (cell, index) =>
              `<w:tc><w:tcPr><w:tcW w:w="${block.widths[index]}" w:type="dxa"/></w:tcPr>${docxParagraph(
                cell ?? "",
                { size: 18 },
              )}</w:tc>`,
          )
          .join("")}</w:tr>`,
    )
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${CONTENT_WIDTH_TWIPS}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${headerRow}${bodyRows}</w:tbl>`;
}

const DOCX_STYLES_XML = `${XML_DECLARATION}
<w:styles xmlns:w="${WORD_NS}">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Noto Sans TC" w:eastAsia="Noto Sans TC" w:hAnsi="Noto Sans TC"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="80" w:line="264" w:lineRule="auto"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="160"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>
</w:styles>`;

/** 產生 DOCX 檔（A4 直向、2 公分邊界、表格標題列會跨頁重複） */
export async function buildDocx(
  blocks: DocxBlock[],
  options: { title?: string } = {},
): Promise<Buffer> {
  const body = blocks
    .map((block): string => {
      switch (block.kind) {
        case "title":
          return docxParagraph(block.text, { style: "Title" });
        case "heading":
          return docxParagraph(block.text, { style: "Heading1" });
        case "note":
          return docxParagraph(block.text, { size: 18, color: "595959" });
        case "table":
          return docxTable(block);
        case "paragraph":
          return docxParagraph(block.text, block.muted ? { size: 18, color: "595959" } : {});
      }
    })
    .join("");

  const sectionProperties =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="709" w:footer="709" w:gutter="0"/></w:sectPr>';

  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${XML_DECLARATION}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `${XML_DECLARATION}
<Relationships xmlns="${PACKAGE_REL_NS}">
<Relationship Id="rId1" Type="${OFFICE_REL_NS}/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="${OFFICE_REL_NS}/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
  );
  zip.file(
    "docProps/core.xml",
    `${XML_DECLARATION}
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:title>${xmlEscape(options.title ?? "學生練習記錄")}</dc:title>
<dc:creator>香港中學歷史科自學互動網站</dc:creator>
</cp:coreProperties>`,
  );
  zip.file(
    "docProps/app.xml",
    `${XML_DECLARATION}
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>香港中學歷史科自學互動網站</Application></Properties>`,
  );
  zip.file(
    "word/_rels/document.xml.rels",
    `${XML_DECLARATION}
<Relationships xmlns="${PACKAGE_REL_NS}">
<Relationship Id="rId1" Type="${OFFICE_REL_NS}/styles" Target="styles.xml"/>
</Relationships>`,
  );
  zip.file("word/styles.xml", DOCX_STYLES_XML);
  zip.file(
    "word/document.xml",
    `${XML_DECLARATION}
<w:document xmlns:w="${WORD_NS}" xmlns:r="${OFFICE_REL_NS}"><w:body>${body}${sectionProperties}</w:body></w:document>`,
  );

  return zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
}
