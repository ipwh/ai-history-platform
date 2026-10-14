/**
 * 名冊來源：Google Sheet（服務帳戶 Sheets API）、已發布的 CSV 網址，或本機 CSV 檔案。
 *
 * 三種來源都只回傳「表格列」，欄位判讀交由 columns.ts 處理，方便測試及更換來源。
 * 服務帳戶憑證只在此模組內讀取，不會寫入日誌或回傳給前端。
 */
import fs from "node:fs/promises";
import { createSign } from "node:crypto";

import type { RosterConfig } from "../config";
import { parseCsv } from "./csv";

/** 名冊來源錯誤：訊息只說明原因，不包含憑證或學生資料 */
export class RosterSourceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "RosterSourceError";
    this.code = code;
  }
}

const REQUEST_TIMEOUT_MS = 15_000;
const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";

interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Sheets API 網址（可用 STUDENT_ROSTER_SHEETS_API_BASE 覆寫，方便本機以 stub 測試） */
function sheetsApiBase(): string {
  return (process.env.STUDENT_ROSTER_SHEETS_API_BASE ?? "").trim() || "https://sheets.googleapis.com";
}

/** Google Sheet CSV 匯出網址的前置網址 */
function csvBase(): string {
  return (process.env.STUDENT_ROSTER_CSV_BASE ?? "").trim() || "https://docs.google.com";
}

export interface RosterFetchOptions {
  fetchImpl?: typeof fetch;
}

function resolveFetch(options: RosterFetchOptions): typeof fetch {
  return options.fetchImpl ?? fetch;
}

/** 讀取服務帳戶 JSON（內容或檔案路徑皆可） */
export async function loadServiceAccount(
  value: string,
  readFile: (path: string) => Promise<string> = (path) => fs.readFile(path, "utf8"),
): Promise<ServiceAccount> {
  const trimmed = value.trim();
  let raw = trimmed;

  if (!trimmed.startsWith("{")) {
    try {
      raw = await readFile(trimmed);
    } catch {
      throw new RosterSourceError(
        "service_account_unreadable",
        "STUDENT_ROSTER_SERVICE_ACCOUNT_JSON 不是有效的 JSON，亦無法以檔案路徑讀取",
      );
    }
  }

  let parsed: { client_email?: unknown; private_key?: unknown; token_uri?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new RosterSourceError("service_account_invalid", "服務帳戶 JSON 格式不正確");
  }

  const clientEmail = typeof parsed.client_email === "string" ? parsed.client_email.trim() : "";
  const privateKeyRaw = typeof parsed.private_key === "string" ? parsed.private_key : "";
  if (clientEmail.length === 0 || privateKeyRaw.length === 0) {
    throw new RosterSourceError(
      "service_account_incomplete",
      "服務帳戶 JSON 缺少 client_email 或 private_key",
    );
  }

  return {
    clientEmail,
    // 以環境變數提供時，換行常被寫成 \n 字面值
    privateKey: privateKeyRaw.replace(/\\n/g, "\n"),
    tokenUri: typeof parsed.token_uri === "string" && parsed.token_uri.length > 0
      ? parsed.token_uri
      : DEFAULT_TOKEN_URI,
  };
}

/** 以服務帳戶簽署 JWT 並換取 access token */
export async function fetchAccessToken(
  account: ServiceAccount,
  options: RosterFetchOptions = {},
): Promise<string> {
  const fetchImpl = resolveFetch(options);
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = (process.env.STUDENT_ROSTER_OAUTH_TOKEN_URI ?? "").trim() || account.tokenUri;
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(
    JSON.stringify({
      iss: account.clientEmail,
      scope: SHEETS_SCOPE,
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  const signature = signer.sign(account.privateKey).toString("base64url");

  const response = await fetchImpl(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${signature}`,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new RosterSourceError(
      "token_failed",
      `無法以服務帳戶取得存取權杖（HTTP ${response.status}），請確認服務帳戶有效`,
    );
  }

  const payload = (await response.json()) as { access_token?: unknown };
  if (typeof payload.access_token !== "string" || payload.access_token.length === 0) {
    throw new RosterSourceError("token_missing", "Google 未回傳存取權杖");
  }
  return payload.access_token;
}

/** 由設定組出 CSV 匯出網址（Google Sheet 需開放為「知道連結的任何人可檢視」或已發布到網絡） */
export function buildCsvUrl(config: RosterConfig): string {
  if (config.csvUrl !== null) return config.csvUrl;
  if (config.spreadsheetId === null) {
    throw new RosterSourceError("csv_url_missing", "未設定 STUDENT_ROSTER_CSV_URL 或 STUDENT_ROSTER_SHEET_ID");
  }
  const url = new URL(`${csvBase()}/spreadsheets/d/${config.spreadsheetId}/gviz/tq`);
  url.searchParams.set("tqx", "out:csv");
  if (config.sheetName !== null) url.searchParams.set("sheet", config.sheetName);
  return url.toString();
}

/** sheets-api 讀取的 A1 範圍 */
export function buildRange(config: RosterConfig): string {
  if (config.range !== null) return config.range;
  if (config.sheetName !== null) return `'${config.sheetName}'!A1:Z2000`;
  return "A1:Z2000";
}

async function fetchCsvRows(url: string, options: RosterFetchOptions): Promise<string[][]> {
  const response = await resolveFetch(options)(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new RosterSourceError(
      "csv_unavailable",
      `無法讀取名冊 CSV（HTTP ${response.status}），請確認試算表已開放檢視權限`,
    );
  }
  return parseCsv(await response.text());
}

async function fetchSheetsRows(
  config: RosterConfig,
  options: RosterFetchOptions,
): Promise<string[][]> {
  if (config.serviceAccountJson === null) {
    throw new RosterSourceError(
      "service_account_missing",
      "使用 STUDENT_ROSTER_SOURCE=sheets-api 時需要設定 STUDENT_ROSTER_SERVICE_ACCOUNT_JSON",
    );
  }
  if (config.spreadsheetId === null) {
    throw new RosterSourceError("sheet_id_missing", "未設定 STUDENT_ROSTER_SHEET_ID");
  }

  const account = await loadServiceAccount(config.serviceAccountJson);
  const token = await fetchAccessToken(account, options);
  const range = buildRange(config);
  const url = `${sheetsApiBase()}/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`;

  const response = await resolveFetch(options)(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = await describeSheetsError(response);
    throw new RosterSourceError(
      "sheets_unavailable",
      `無法讀取 Google Sheet 名冊（HTTP ${response.status}${detail}）`,
    );
  }

  const payload = (await response.json()) as { values?: unknown };
  if (!Array.isArray(payload.values)) return [];
  return payload.values.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []));
}

async function describeSheetsError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: { status?: unknown; message?: unknown } };
    const status = typeof payload.error?.status === "string" ? payload.error.status : "";
    const message = typeof payload.error?.message === "string" ? payload.error.message.slice(0, 160) : "";
    const parts = [status, message].filter((part) => part.length > 0);
    return parts.length > 0 ? `：${parts.join(" - ")}` : "";
  } catch {
    return "";
  }
}

/** 讀取名冊的原始表格列（不含欄位判讀） */
export async function fetchRosterRows(
  config: RosterConfig,
  options: RosterFetchOptions = {},
): Promise<string[][]> {
  switch (config.source) {
    case "csv":
      return fetchCsvRows(buildCsvUrl(config), options);
    case "file": {
      if (config.filePath === null) {
        throw new RosterSourceError("file_missing", "未設定 STUDENT_ROSTER_FILE");
      }
      try {
        return parseCsv(await fs.readFile(config.filePath, "utf8"));
      } catch {
        throw new RosterSourceError("file_unreadable", `無法讀取名冊檔案：${config.filePath}`);
      }
    }
    case "sheets-api":
      return fetchSheetsRows(config, options);
    default:
      return [];
  }
}
