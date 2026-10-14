/**
 * 學生名冊測試（Google Sheet／CSV → 學生登入核對）。
 *
 * 驗證：
 *   1. CSV 解析（引號、BOM、CRLF、欄位內逗號及換行）。
 *   2. 欄名自動偵測（中文／英文）及以環境變數覆寫；缺少必要欄位時給出清楚錯誤。
 *   3. 沒有電郵欄時以學號 + 校內網域推導；空白列及重複列處理。
 *   4. 來源 provider：本機檔案、CSV 網址（本機 stub）、Sheets API（服務帳戶 JWT，以 stub 驗證簽章及權杖流程）。
 *   5. 名冊快取及讀取失敗時沿用舊快照。
 *   6. 登入整合：名冊內的學生取得班別及學號；教師不受名冊影響。
 *   7. 對外狀態不含任何學生個人資料。
 */
import { generateKeyPairSync, verify } from "node:crypto";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

process.env.APP_DATABASE_PATH = path.join(os.tmpdir(), `hist-test-roster-${process.pid}.db`);
process.env.AUTH_SECRET = "test-secret-0123456789abcdefghijklmnop";
process.env.AUTH_SCHOOL_DOMAINS = "pochiu.edu.hk";
process.env.AUTH_TEACHER_EMAILS = "teacher@example.com";
process.env.GOOGLE_CLIENT_ID = "test-client-id.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.LLM_PROVIDER = "mock";
delete process.env.ADMIN_TOKEN;

type RosterModule = typeof import("@/server/roster");
type ColumnsModule = typeof import("@/server/roster/columns");
type CsvModule = typeof import("@/server/roster/csv");
type SourceModule = typeof import("@/server/roster/source");
type ConfigModule = typeof import("@/server/config");
type RoleModule = typeof import("@/server/auth/role");

let roster: RosterModule;
let columns: ColumnsModule;
let csv: CsvModule;
let source: SourceModule;
let config: ConfigModule;
let role: RoleModule;

const ROSTER_CSV = [
  "班別,學號,姓名,電郵",
  "1A,s2024146,陳大文,s2024146@pochiu.edu.hk",
  "1A,s2024147,李小明,s2024147@pochiu.edu.hk",
  ",,,",
].join("\r\n");

const rosterFile = path.join(os.tmpdir(), `hist-roster-${process.pid}.csv`);

function clearRosterEnv(): void {
  for (const name of [
    "STUDENT_ROSTER_ENABLED",
    "STUDENT_ROSTER_ENFORCE",
    "STUDENT_ROSTER_SOURCE",
    "STUDENT_ROSTER_FILE",
    "STUDENT_ROSTER_CSV_URL",
    "STUDENT_ROSTER_SHEET_ID",
    "STUDENT_ROSTER_SHEET_NAME",
    "STUDENT_ROSTER_RANGE",
    "STUDENT_ROSTER_SERVICE_ACCOUNT_JSON",
    "STUDENT_ROSTER_CACHE_TTL_SECONDS",
    "STUDENT_ROSTER_FAIL_OPEN",
    "STUDENT_ROSTER_COLUMN_EMAIL",
    "STUDENT_ROSTER_COLUMN_STUDENT_NUMBER",
    "STUDENT_ROSTER_COLUMN_CLASS",
    "STUDENT_ROSTER_COLUMN_NAME",
    "STUDENT_ROSTER_SHEETS_API_BASE",
    "STUDENT_ROSTER_CSV_BASE",
    "STUDENT_ROSTER_OAUTH_TOKEN_URI",
  ]) {
    delete process.env[name];
  }
}

beforeAll(async () => {
  roster = await import("@/server/roster");
  columns = await import("@/server/roster/columns");
  csv = await import("@/server/roster/csv");
  source = await import("@/server/roster/source");
  config = await import("@/server/config");
  role = await import("@/server/auth/role");
  fs.writeFileSync(rosterFile, ROSTER_CSV, "utf8");
});

afterAll(() => {
  fs.rmSync(rosterFile, { force: true });
});

beforeEach(() => {
  clearRosterEnv();
  roster.resetRosterCache();
});

async function startServer(handler: (url: string, auth: string) => { status: number; body: string }): Promise<{
  server: Server;
  base: string;
  requests: { url: string; auth: string }[];
}> {
  const requests: { url: string; auth: string }[] = [];
  const server = createServer((request, response) => {
    const auth = request.headers.authorization ?? "";
    requests.push({ url: request.url ?? "", auth });
    let raw = "";
    request.on("data", (chunk) => {
      raw += String(chunk);
    });
    request.on("end", () => {
      const result = handler(`${request.url ?? ""}\n${raw}`, auth);
      response.writeHead(result.status, { "content-type": "application/json" });
      response.end(result.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return { server, base: `http://127.0.0.1:${port}`, requests };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe("名冊 CSV 解析與欄位偵測", () => {
  it("解析引號、BOM、CRLF 及欄位內的逗號與換行", () => {
    const text = '\uFEFF班別,姓名,備註\r\n1A,"陳大文, 別名大文","第一行\n第二行"\r\n';
    const rows = csv.parseCsv(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(["班別", "姓名", "備註"]);
    expect(rows[1]).toEqual(["1A", "陳大文, 別名大文", "第一行\n第二行"]);
  });

  it("自動偵測中文欄名並容許前後空白及全形符號", () => {
    const detected = columns.detectColumns([" 班別 ", "學號（英文）", "學生姓名", "學校電郵"], {
      email: null,
      studentNumber: null,
      className: null,
      name: null,
    });
    expect(detected).toEqual({ email: 3, studentNumber: 1, className: 0, name: 2 });
  });

  it("自動偵測英文欄名", () => {
    const detected = columns.detectColumns(["Class", "Student ID", "Name", "Email Address"], {
      email: null,
      studentNumber: null,
      className: null,
      name: null,
    });
    expect(detected).toEqual({ email: 3, studentNumber: 1, className: 0, name: 2 });
  });

  it("沒有電郵欄時以學號 + 校內網域推導電郵", () => {
    const detected = columns.detectColumns(["班別", "學號", "姓名"], {
      email: null,
      studentNumber: null,
      className: null,
      name: null,
    });
    const students = columns.buildRoster(
      [
        ["1A", "s2024146", "陳大文"],
        ["1A", "S2024147", "李小明"],
        ["", "", ""],
      ],
      { columns: detected, schoolDomains: ["pochiu.edu.hk"] },
    );
    expect(students.map((student) => student.email)).toEqual([
      "s2024146@pochiu.edu.hk",
      "s2024147@pochiu.edu.hk",
    ]);
    expect(students[0].className).toBe("1A");
    expect(students[0].studentNumber).toBe("s2024146");
  });

  it("缺少學號及電郵欄時給出清楚錯誤", () => {
    expect(() =>
      columns.detectColumns(["班別", "姓名"], {
        email: null,
        studentNumber: null,
        className: null,
        name: null,
      }),
    ).toThrowError(/學號.*電郵/);
  });

  it("以環境變數覆寫欄名，找不到時說明設定名稱", () => {
    expect(() =>
      columns.detectColumns(["班別", "學號", "姓名"], {
        email: null,
        studentNumber: "學生編號",
        className: null,
        name: null,
      }),
    ).toThrowError(/STUDENT_ROSTER_COLUMN_\*/);
  });
});

describe("名冊來源", () => {
  it("本機 CSV 檔案可用，且空白列及重複電郵不會產生重複學生", async () => {
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    const snapshot = await roster.getRosterSnapshot();
    expect(snapshot.loaded).toBe(true);
    expect(snapshot.students).toHaveLength(2);
    expect(snapshot.error).toBeNull();
    expect(roster.findStudentInSnapshot(snapshot, "S2024146@pochIU.edu.hk")?.name).toBe("陳大文");
    // 只填學號也能查到（容錯）
    expect(roster.findStudentInSnapshot(snapshot, "s2024147@pochiu.edu.hk")?.className).toBe("1A");
  });

  it("Google Sheet CSV 網址（配合已發布的試算表）", async () => {
    const stub = await startServer(() => ({ status: 200, body: ROSTER_CSV }));
    try {
      process.env.STUDENT_ROSTER_SOURCE = "csv";
      process.env.STUDENT_ROSTER_CSV_BASE = stub.base;
      process.env.STUDENT_ROSTER_SHEET_ID = "sheet-id-123";
      process.env.STUDENT_ROSTER_SHEET_NAME = "名冊";
      const snapshot = await roster.getRosterSnapshot();
      expect(snapshot.loaded).toBe(true);
      expect(snapshot.students).toHaveLength(2);
      expect(stub.requests[0].url).toContain("/spreadsheets/d/sheet-id-123/gviz/tq");
      expect(decodeURIComponent(stub.requests[0].url)).toContain("sheet=名冊");
    } finally {
      await closeServer(stub.server);
    }
  });

  it("CSV 網址回傳錯誤時，狀態會顯示原因且不會假裝成功", async () => {
    const stub = await startServer(() => ({ status: 403, body: "{}" }));
    try {
      process.env.STUDENT_ROSTER_SOURCE = "csv";
      process.env.STUDENT_ROSTER_CSV_BASE = stub.base;
      process.env.STUDENT_ROSTER_SHEET_ID = "sheet-id-123";
      const snapshot = await roster.getRosterSnapshot();
      expect(snapshot.loaded).toBe(false);
      expect(snapshot.error).toContain("HTTP 403");
    } finally {
      await closeServer(stub.server);
    }
  });

  it("Sheets API：以服務帳戶 JWT 換取權杖並讀取範圍", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const stub = await startServer((raw) => {
      if (raw.includes("/token")) {
        // 驗證 JWT 簽章及 claims，確保我們送出的 assertion 正確
        const params = new URLSearchParams(raw.split("\n")[1] ?? "");
        const assertion = params.get("assertion") ?? "";
        const [header, claims, signature] = assertion.split(".");
        const valid = verify(
          "RSA-SHA256",
          Buffer.from(`${header}.${claims}`),
          publicKey,
          Buffer.from(signature ?? "", "base64url"),
        );
        const payload = JSON.parse(Buffer.from(claims ?? "", "base64url").toString("utf8"));
        const claimsOk =
          payload.iss === "roster-bot@example.iam.gserviceaccount.com" &&
          payload.scope === "https://www.googleapis.com/auth/spreadsheets.readonly";
        return valid && claimsOk
          ? { status: 200, body: JSON.stringify({ access_token: "stub-token", expires_in: 3600 }) }
          : { status: 400, body: JSON.stringify({ error: "invalid_assertion" }) };
      }
      return {
        status: 200,
        body: JSON.stringify({
          values: [
            ["班別", "學號", "姓名", "電郵"],
            ["1A", "s2024146", "陳大文", "s2024146@pochiu.edu.hk"],
          ],
        }),
      };
    });

    try {
      const serviceAccount = JSON.stringify({
        client_email: "roster-bot@example.iam.gserviceaccount.com",
        private_key: privateKey,
        token_uri: `${stub.base}/token`,
      });
      process.env.STUDENT_ROSTER_SOURCE = "sheets-api";
      process.env.STUDENT_ROSTER_SHEET_ID = "sheet-id-123";
      process.env.STUDENT_ROSTER_SHEET_NAME = "名冊";
      process.env.STUDENT_ROSTER_SHEETS_API_BASE = stub.base;
      process.env.STUDENT_ROSTER_SERVICE_ACCOUNT_JSON = serviceAccount;

      const snapshot = await roster.getRosterSnapshot();
      expect(snapshot.loaded).toBe(true);
      expect(snapshot.students).toHaveLength(1);
      expect(snapshot.students[0].email).toBe("s2024146@pochiu.edu.hk");

      const valuesRequest = stub.requests.find((request) => request.url.includes("/values/"));
      expect(valuesRequest?.auth).toBe("Bearer stub-token");
      expect(decodeURIComponent(valuesRequest?.url ?? "")).toContain("'名冊'!A1:Z2000");
    } finally {
      await closeServer(stub.server);
    }
  });

  it("Sheets API 缺少服務帳戶時回報可理解的錯誤", async () => {
    process.env.STUDENT_ROSTER_SOURCE = "sheets-api";
    process.env.STUDENT_ROSTER_SHEET_ID = "sheet-id-123";
    const snapshot = await roster.getRosterSnapshot();
    expect(snapshot.loaded).toBe(false);
    expect(snapshot.error).toContain("STUDENT_ROSTER_SERVICE_ACCOUNT_JSON");
  });

  it("服務帳戶 JSON 格式錯誤時（含換行寫法）給出清楚訊息", async () => {
    await expect(source.loadServiceAccount("not-a-json-file-path")).rejects.toThrowError(
      /JSON|檔案路徑/,
    );
    await expect(source.loadServiceAccount("{ broken")).rejects.toThrowError(/格式不正確/);
    await expect(source.loadServiceAccount('{"client_email":"a@b.c"}')).rejects.toThrowError(
      /private_key/,
    );
  });

  it("快取有效期內不會重複讀取來源，並可強制更新", async () => {
    const stub = await startServer(() => ({ status: 200, body: ROSTER_CSV }));
    try {
      process.env.STUDENT_ROSTER_SOURCE = "csv";
      process.env.STUDENT_ROSTER_CSV_BASE = stub.base;
      process.env.STUDENT_ROSTER_SHEET_ID = "sheet-id-123";
      process.env.STUDENT_ROSTER_CACHE_TTL_SECONDS = "600";
      await roster.getRosterSnapshot();
      await roster.getRosterSnapshot();
      expect(stub.requests).toHaveLength(1);
      await roster.getRosterSnapshot({ force: true });
      expect(stub.requests).toHaveLength(2);
    } finally {
      await closeServer(stub.server);
    }
  });

  it("來源暫時失效時沿用上一次成功的名冊並記錄錯誤", async () => {
    const stub = await startServer(() => ({ status: 200, body: ROSTER_CSV }));
    try {
      process.env.STUDENT_ROSTER_SOURCE = "csv";
      process.env.STUDENT_ROSTER_CSV_BASE = stub.base;
      process.env.STUDENT_ROSTER_SHEET_ID = "sheet-id-123";
      const first = await roster.getRosterSnapshot();
      expect(first.loaded).toBe(true);

      // 令之後的請求失敗，然後強制更新
      await closeServer(stub.server);
      const second = await roster.getRosterSnapshot({ force: true });
      expect(second.loaded).toBe(true);
      expect(second.students).toHaveLength(2);
      expect(second.error).not.toBeNull();
    } finally {
      await closeServer(stub.server);
    }
  });
});

describe("登入整合", () => {
  it("名冊內的學生取得班別、學號及姓名；名冊未涵蓋的學生只取得基本資料", async () => {
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    const settings = config.getServerConfig().auth;

    const verified = role.buildSessionUserWithRoster(
      { email: "s2024146@pochiu.edu.hk", name: "Google 顯示名稱", pictureUrl: null },
      settings,
      { email: "s2024146@pochiu.edu.hk", studentNumber: "s2024146", className: "1A", name: "陳大文", inScope: true },
    );
    expect(verified.role).toBe("student");
    expect(verified.rosterVerified).toBe(true);
    expect(verified.className).toBe("1A");
    expect(verified.studentNumber).toBe("s2024146");
    expect(verified.name).toBe("陳大文");
    expect(verified.learnerId).toBe("school:s2024146@pochiu.edu.hk");

    const notListed = role.buildSessionUserWithRoster(
      { email: "s2099999@pochiu.edu.hk", name: "未在名冊", pictureUrl: null },
      settings,
      null,
    );
    expect(notListed.rosterVerified).toBe(false);
    expect(notListed.className).toBeNull();

    const teacher = role.buildSessionUserWithRoster(
      { email: "teacher@example.com", name: "陳老師", pictureUrl: null },
      settings,
      { email: "teacher@example.com", studentNumber: "s1", className: "1A", name: "不應套用", inScope: true },
    );
    expect(teacher.role).toBe("teacher");
    expect(teacher.className).toBeNull();
    expect(teacher.rosterVerified).toBe(false);
    expect(teacher.name).toBe("陳老師");
  });

  it("名冊狀態不含任何學生姓名或電郵", async () => {
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    const status = await roster.getRosterStatus();
    expect(status.enabled).toBe(true);
    expect(status.enforce).toBe(true);
    expect(status.source).toBe("file");
    expect(status.students).toBe(2);
    expect(JSON.stringify(status)).not.toContain("陳大文");
    expect(JSON.stringify(status)).not.toContain("pochiu.edu.hk");
  });

  it("未設定來源時名冊為停用狀態（維持原本的登入行為）", async () => {
    const settings = config.getServerConfig();
    expect(settings.roster.enabled).toBe(false);
    expect(settings.roster.source).toBe("none");
    const status = await roster.getRosterStatus();
    expect(status.loaded).toBe(false);
  });

  it("load=false 時不會主動讀取來源（供公開健康檢查使用）", async () => {
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    const status = await roster.getRosterStatus({ load: false });
    expect(status.enabled).toBe(true);
    expect(status.loaded).toBe(false);
    expect(status.students).toBeNull();
  });
});

describe("班別範圍（只開放中一至中三）", () => {
  it("以班別前綴比對：1、2、3 接受 1A-3D，拒絕 4A 及空白", () => {
    const scope = { classPrefixes: ["1", "2", "3"], classes: [] };
    expect(columns.isClassNameInScope("1A", scope)).toBe(true);
    expect(columns.isClassNameInScope("3d", scope)).toBe(true);
    expect(columns.isClassNameInScope("4A", scope)).toBe(false);
    expect(columns.isClassNameInScope("6B", scope)).toBe(false);
    expect(columns.isClassNameInScope("", scope)).toBe(false);
  });

  it("以完整班別比對時只接受列出的班別", () => {
    const scope = { classPrefixes: [], classes: ["1A", "2B"] };
    expect(columns.isClassNameInScope("1A", scope)).toBe(true);
    expect(columns.isClassNameInScope("2B", scope)).toBe(true);
    expect(columns.isClassNameInScope("1B", scope)).toBe(false);
  });

  it("未設定範圍時一律接受（維持原有行為）", () => {
    const scope = { classPrefixes: [], classes: [] };
    expect(columns.isClassNameInScope("6D", scope)).toBe(true);
    expect(columns.isClassNameInScope("", scope)).toBe(true);
  });

  it("buildRoster 會標示每名學生是否在開放範圍內", () => {
    const detected = columns.detectColumns(["班別", "班號", "姓名", "電郵"], {
      email: null,
      studentNumber: null,
      className: null,
      name: null,
    });
    const students = columns.buildRoster(
      [
        ["1A", "01", "陳大文", "s2024146@pochiu.edu.hk"],
        ["4B", "05", "黃小美", "s2024999@pochiu.edu.hk"],
      ],
      { columns: detected, schoolDomains: ["pochiu.edu.hk"], scope: { classPrefixes: ["1", "2", "3"], classes: [] } },
    );
    expect(students.map((student) => student.className)).toEqual(["1A", "4B"]);
    expect(students.map((student) => student.inScope)).toEqual([true, false]);
  });

  it("名冊狀態會分別回報總人數及開放人數（不含學生個資）", async () => {
    process.env.STUDENT_ROSTER_FILE = rosterFile;
    process.env.STUDENT_ROSTER_CLASS_PREFIXES = "1";
    const status = await roster.getRosterStatus();
    expect(status.students).toBe(2);
    expect(status.inScope).toBe(2);
    expect(status.classPrefixes).toEqual(["1"]);
    expect(JSON.stringify(status)).not.toContain("陳大文");
  });
});