/**
 * 極簡 CSV 解析（只用於讀取名冊）。
 *
 * Google Sheet 的 CSV 匯出可能包含：
 *   - UTF-8 BOM
 *   - CRLF 換行
 *   - 以雙引號包住的欄位（內部雙引號以 "" 表示）
 *   - 欄位內含逗號或換行
 */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }
    if (char === ",") {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\r") {
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // 移除完全空白的尾列
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.every((cell) => cell.trim().length === 0)) {
      rows.pop();
    } else {
      break;
    }
  }

  return rows;
}
