/**
 * 名冊欄位偵測及資料正規化。
 *
 * 學校的名冊表格（Google Sheet）欄名寫法不一，這裡以「正規化後的欄名」比對常見寫法，
 * 找不到時才要求以環境變數（STUDENT_ROSTER_COLUMN_*）指定。
 * 所有函式皆為純函式，方便測試。
 */

export interface RosterColumns {
  email: number;
  studentNumber: number;
  className: number;
  name: number;
}

export interface RosterColumnOverrides {
  email: string | null;
  studentNumber: string | null;
  className: string | null;
  name: string | null;
}

export interface RosterStudent {
  /** 學校 Google 帳戶電郵（一律小寫） */
  email: string;
  /** 學號／班號（例如 s2024146 或 01） */
  studentNumber: string;
  /** 班別（例如 1A） */
  className: string;
  /** 姓名 */
  name: string;
  /** 班別是否在開放範圍內（未設定範圍時一律為 true） */
  inScope: boolean;
}

/** 班別範圍設定（空白 = 不設限） */
export interface ClassScope {
  classPrefixes: string[];
  classes: string[];
}

/**
 * 判斷班別是否在開放範圍內。
 *
 * - 未設定任何範圍 → 全部接受
 * - classPrefixes 以開頭比對（`1` 接受 `1A`、`1B`）
 * - classes 以完全相等比對（`1A` 只接受 `1A`）
 * - 班別空白時視為不在範圍內（無法確定級別時不應放行）
 */
export function isClassNameInScope(className: string, scope: ClassScope): boolean {
  if (scope.classPrefixes.length === 0 && scope.classes.length === 0) return true;

  const normalized = className.trim().toUpperCase();
  if (normalized.length === 0) return false;

  return (
    scope.classes.some((candidate) => candidate.trim().toUpperCase() === normalized) ||
    scope.classPrefixes.some((prefix) => normalized.startsWith(prefix.trim().toUpperCase()))
  );
}

/** 正規化欄名：去除空白、標點及大小寫差異，方便比對 */
export function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]/g, "")
    .replace(/[（）()［］\[\]{}:：、,，.。_\-/\\|]/g, "");
}

const HEADER_ALIASES: Record<keyof RosterColumns, string[]> = {
  email: [
    "email",
    "emailaddress",
    "e-mail",
    "電郵",
    "電子郵件",
    "電郵地址",
    "電子郵件地址",
    "學校電郵",
    "學校電郵地址",
    "學生電郵",
    "google電郵",
    "google帳戶",
    "googleaccount",
    "帳戶",
    "帳號",
    "郵箱",
  ],
  studentNumber: [
    "學號",
    "學生編號",
    "學生號碼",
    "學生證號碼",
    "學生證編號",
    "班號",
    "號數",
    "studentnumber",
    "studentno",
    "studentid",
    "studentcode",
    "classnumber",
    "classno",
    "schoolid",
  ],
  className: ["班別", "班級", "班", "class", "classname", "classcode", "組別", "grade", "level"],
  name: [
    "姓名",
    "學生姓名",
    "中文姓名",
    "英文姓名",
    "名字",
    "name",
    "studentname",
    "englishname",
    "chinesename",
  ],
};

function findColumn(
  headers: string[],
  field: keyof RosterColumns,
  override: string | null,
): number {
  if (override !== null) {
    const wanted = normalizeHeader(override);
    const exact = headers.findIndex((header) => normalizeHeader(header) === wanted);
    if (exact < 0) {
      throw new Error(`名冊找不到指定的欄位「${override}」，請檢查 STUDENT_ROSTER_COLUMN_* 設定`);
    }
    return exact;
  }

  const normalized = headers.map((header) => normalizeHeader(header));
  for (const alias of HEADER_ALIASES[field]) {
    const index = normalized.indexOf(alias);
    if (index >= 0) return index;
  }
  // 容錯：欄名包含關鍵詞（例如「學生電郵地址」「2024-2025 班別」）
  for (const alias of HEADER_ALIASES[field]) {
    if (alias.length < 2) continue;
    const index = normalized.findIndex((header) => header.includes(alias));
    if (index >= 0) return index;
  }
  return -1;
}

/**
 * 由表頭找出各欄位置；電郵欄可以不存在（屆時以學號 + 校內網域推導）。
 * 學號或姓名至少要有一欄，否則無法辨識學生身分。
 */
export function detectColumns(headers: string[], overrides: RosterColumnOverrides): RosterColumns {
  const columns: RosterColumns = {
    email: findColumn(headers, "email", overrides.email),
    studentNumber: findColumn(headers, "studentNumber", overrides.studentNumber),
    className: findColumn(headers, "className", overrides.className),
    name: findColumn(headers, "name", overrides.name),
  };

  if (columns.studentNumber < 0 && columns.email < 0) {
    throw new Error("名冊需要至少包含「學號」或「電郵」欄，請檢查表頭或設定 STUDENT_ROSTER_COLUMN_*");
  }
  return columns;
}

/** 學號形式：s 加 7 位數字（例如 s2024146） */
const STUDENT_NUMBER_PATTERN = /^[a-z]{0,2}\d{4,12}$/i;

/** 把儲存格內容整理成單行文字（Google Sheet 有時會回傳數字或含換行的文字） */
export function cleanCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

/** 從各式寫法抽出電郵（支援「姓名 <a@b.com>」及全形＠） */
export function extractEmail(value: string): string {
  const normalized = value.replace(/＠/g, "@").replace(/[＜<]\s*([^＞>]+)\s*[＞>]/g, "");
  const match = normalized.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  return match === null ? "" : match[0].toLowerCase();
}

export interface BuildRosterOptions {
  columns: RosterColumns;
  /** 校內網域，用於在名冊沒有電郵欄時以學號推導電郵 */
  schoolDomains: string[];
  /** 只開放的班別範圍（未設定時不設限） */
  scope?: ClassScope;
}

/**
 * 把表格資料轉為名冊學生清單。
 * - 沒有電郵欄時，以「學號 + 第一個校內網域」推導（例如 s2024146 → s2024146@pochiu.edu.hk）。
 * - 完全沒有電郵也沒有學號的列會被略過（例如標題下的空行或註解列）。
 * - 同一電郵重複出現時以第一筆為準（避免表尾的重複列覆蓋）。
 */
export function buildRoster(rows: string[][], options: BuildRosterOptions): RosterStudent[] {
  const { columns, schoolDomains } = options;
  const scope = options.scope ?? { classPrefixes: [], classes: [] };
  const students: RosterStudent[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const cell = (index: number) => (index >= 0 ? cleanCell(row[index]) : "");
    const studentNumber = cell(columns.studentNumber);
    const emailFromSheet = extractEmail(cell(columns.email));
    const derivedDomain = schoolDomains[0] ?? "";
    const email =
      emailFromSheet.length > 0
        ? emailFromSheet
        : studentNumber.length > 0 && derivedDomain.length > 0 &&
            STUDENT_NUMBER_PATTERN.test(studentNumber)
          ? `${studentNumber.toLowerCase()}@${derivedDomain.toLowerCase()}`
          : "";

    if (email.length === 0) continue;
    if (seen.has(email)) continue;
    seen.add(email);

    const className = cell(columns.className);
    students.push({
      email,
      studentNumber: studentNumber.toLowerCase(),
      className,
      name: cell(columns.name),
      inScope: isClassNameInScope(className, scope),
    });
  }

  return students;
}
