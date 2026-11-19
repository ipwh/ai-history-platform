/**
 * 最小 SMTP 寄件器（只用 Node 內建模組，不新增依賴）。
 *
 * 支援：
 *   - 隱含 TLS（465，`secure: true`）；
 *   - STARTTLS 升級（587／25，伺服器有宣告 `STARTTLS` 時自動升級）；
 *   - `AUTH LOGIN`（Gmail／Workspace 應用程式密碼、多數學校 SMTP 均支援）；
 *   - 純文字正文（UTF-8，base64）及二進位附件（base64，76 字元換行）。
 *
 * 為甚麼不引入 nodemailer：`Dockerfile` 以 `npm ci` 安裝全部依賴，新增套件會令
 * 部署映像變大；本平台只需「一封信、一個附件」，規格固定，自行實作可完全控制
 * 連線與錯誤訊息，也避免第三方套件成為長期升級負擔。
 *
 * 明確限制：不支援 SMTPUTF8（非 ASCII 收件人地址）、不支援 OAuth2（XOAUTH2）。
 * 收件人必須是 ASCII 電郵地址；正文及附件名稱可以是中文。
 */
import net from "node:net";
import tls from "node:tls";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export interface SmtpConfig {
  host: string;
  port: number;
  /** true = 連線即 TLS（一般為 465）；false = 明文連線後按需要 STARTTLS（587／25） */
  secure: boolean;
  user: string;
  password: string;
  /** 允許在伺服器沒有 STARTTLS 時以明文傳送（只供本機測試，正式環境必須為 false） */
  allowPlaintext?: boolean;
  /** 連線及每次讀取的回應逾時（毫秒），預設 20 秒 */
  timeoutMs?: number;
}

export interface MailAttachment {
  filename: string;
  contentType: string;
  content: Buffer;
}

export interface MailMessage {
  from: string;
  to: string[];
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

/** RFC 2047：非 ASCII 標頭值以 base64 編碼（中文主旨／附件名） */
export function encodeHeaderValue(value: string): string {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function encodeQuotedPrintableName(value: string): string {
  return encodeHeaderValue(value);
}

function wrapBase64(value: Buffer): string {
  return value.toString("base64").replace(/(.{76})/g, "$1\r\n");
}

/** 產生 RFC 5322 訊息（匯出以便測試；不涉及網絡） */
export function buildMimeMessage(message: MailMessage, now: Date = new Date()): Buffer {
  const boundary = `=_history_${crypto.randomBytes(12).toString("hex")}`;
  const headers = [
    `From: ${message.from}`,
    `To: ${message.to.join(", ")}`,
    `Subject: ${encodeHeaderValue(message.subject)}`,
    `Date: ${now.toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
  ];
  const parts: string[] = [];
  parts.push(
    [
      `--${boundary}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrapBase64(Buffer.from(message.text, "utf8")),
    ].join("\r\n"),
  );
  for (const attachment of message.attachments ?? []) {
    parts.push(
      [
        `--${boundary}`,
        `Content-Type: ${attachment.contentType}; name="${encodeQuotedPrintableName(attachment.filename)}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${encodeQuotedPrintableName(attachment.filename)}"`,
        "",
        wrapBase64(attachment.content),
      ].join("\r\n"),
    );
  }
  parts.push(`--${boundary}--`, "");
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${parts.join("\r\n")}\r\n`, "utf8");
}

interface Connection {
  write(data: string): void;
  /** 讀取直到收到完整 SMTP 回應（支援多行 `250-`），回傳所有回應行 */
  readResponse(): Promise<string[]>;
  upgradeToTls(): Promise<Connection>;
  close(): void;
}

class SocketConnection implements Connection {
  private buffer = "";
  private pending: { resolve: (lines: string[]) => void; reject: (error: Error) => void } | null =
    null;
  private error: Error | null = null;

  constructor(
    private readonly socket: net.Socket | tls.TLSSocket,
    private readonly timeoutMs: number,
  ) {
    this.socket.setEncoding("utf8");
    this.socket.setTimeout(timeoutMs, () => {
      this.fail(new Error(`SMTP 連線逾時（${timeoutMs}ms）`));
    });
    this.socket.on("data", (chunk: string) => this.onData(chunk));
    this.socket.on("error", (error: Error) => this.fail(error));
    this.socket.on("close", () => this.fail(new Error("SMTP 連線被對方關閉")));
  }

  write(data: string): void {
    this.socket.write(data);
  }

  private fail(error: Error): void {
    this.error = error;
    if (this.pending) {
      const { reject } = this.pending;
      this.pending = null;
      reject(error);
    }
  }

  private completeLines(): string[] | null {
    const lines: string[] = [];
    let index = 0;
    while (true) {
      const end = this.buffer.indexOf("\r\n", index);
      if (end < 0) break;
      const line = this.buffer.slice(index, end);
      index = end + 2;
      lines.push(line);
      // 多行回應：`250-` 表示仍有後續；`250 ` 為最後一行
      if (/^\d{3} /.test(line)) {
        this.buffer = this.buffer.slice(index);
        return lines;
      }
    }
    if (lines.length > 0 && /^\d{3}-/.test(lines[lines.length - 1]!)) {
      return null;
    }
    return null;
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    if (!this.pending) return;
    const lines = this.completeLines();
    if (lines === null) return;
    const { resolve } = this.pending;
    this.pending = null;
    resolve(lines);
  }

  readResponse(): Promise<string[]> {
    if (this.error) return Promise.reject(this.error);
    const lines = this.completeLines();
    if (lines !== null) return Promise.resolve(lines);
    return new Promise<string[]>((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  async upgradeToTls(): Promise<Connection> {
    const plain = this.socket as net.Socket;
    const secured = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const upgraded = tls.connect(
        { socket: plain, servername: (plain as unknown as { servername?: string }).servername },
        () => resolve(upgraded),
      );
      upgraded.once("error", reject);
    });
    return new SocketConnection(secured, this.timeoutMs);
  }

  close(): void {
    this.socket.end();
  }
}

function expectCode(lines: string[], expected: number[], step: string): string {
  const last = lines[lines.length - 1] ?? "";
  const code = Number.parseInt(last.slice(0, 3), 10);
  if (!expected.includes(code)) {
    throw new Error(`${step} 失敗：${lines.join(" | ")}`);
  }
  return last;
}

async function connect(config: SmtpConfig): Promise<Connection> {
  const timeoutMs = config.timeoutMs ?? 20_000;
  if (config.secure) {
    const socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const secured = tls.connect(
        { host: config.host, port: config.port, servername: config.host },
        () => resolve(secured),
      );
      secured.once("error", reject);
      secured.setTimeout(timeoutMs, () => reject(new Error("SMTP TLS 連線逾時")));
    });
    return new SocketConnection(socket, timeoutMs);
  }
  const socket = await new Promise<net.Socket>((resolve, reject) => {
    const plain = net.connect({ host: config.host, port: config.port }, () => resolve(plain));
    plain.once("error", reject);
    plain.setTimeout(timeoutMs, () => reject(new Error("SMTP 連線逾時")));
  });
  (socket as unknown as { servername?: string }).servername = config.host;
  return new SocketConnection(socket, timeoutMs);
}

/** 寄出一封電郵；失敗時拋出錯誤（呼叫端應把排程標示為失敗） */
export async function sendMail(config: SmtpConfig, message: MailMessage): Promise<void> {
  if (message.to.length === 0) throw new Error("沒有收件人");
  if (!message.to.every((address) => /^[\x20-\x7e]+@[\x20-\x7e]+$/.test(address))) {
    throw new Error("收件人地址必須是 ASCII 電郵地址");
  }

  let connection = await connect(config);
  try {
    expectCode(await connection.readResponse(), [220], "連線歡迎訊息");
    const heloName = "history-self-study";
    connection.write(`EHLO ${heloName}\r\n`);
    let capabilities = await connection.readResponse();
    expectCode(capabilities, [250], "EHLO");

    const supportsStartTls = capabilities.some((line) => /STARTTLS/i.test(line));
    if (!config.secure && supportsStartTls) {
      connection.write("STARTTLS\r\n");
      expectCode(await connection.readResponse(), [220], "STARTTLS");
      connection = await connection.upgradeToTls();
      connection.write(`EHLO ${heloName}\r\n`);
      capabilities = await connection.readResponse();
      expectCode(capabilities, [250], "EHLO（TLS 後）");
    } else if (!config.secure && !supportsStartTls && config.allowPlaintext !== true) {
      throw new Error(
        "SMTP 伺服器未提供 STARTTLS；拒絕以明文傳送郵件。如確定安全（例如本機測試），可設定 allowPlaintext。",
      );
    }

    if (config.user.length > 0) {
      connection.write("AUTH LOGIN\r\n");
      expectCode(await connection.readResponse(), [334], "AUTH LOGIN");
      connection.write(`${Buffer.from(config.user, "utf8").toString("base64")}\r\n`);
      expectCode(await connection.readResponse(), [334], "AUTH LOGIN（使用者名稱）");
      connection.write(`${Buffer.from(config.password, "utf8").toString("base64")}\r\n`);
      expectCode(await connection.readResponse(), [235], "AUTH LOGIN（密碼）");
    }

    connection.write(`MAIL FROM:<${extractAddress(message.from)}>\r\n`);
    expectCode(await connection.readResponse(), [250], "MAIL FROM");
    for (const recipient of message.to) {
      connection.write(`RCPT TO:<${extractAddress(recipient)}>\r\n`);
      expectCode(await connection.readResponse(), [250, 251], "RCPT TO");
    }
    connection.write("DATA\r\n");
    expectCode(await connection.readResponse(), [354], "DATA");

    const mime = buildMimeMessage(message);
    // 逐字傳送並確保以 CRLF.CRLF 結束；正文本身不含單獨一行的「.」
    const dotSafe = mime.toString("binary").replace(/\r\n\./g, "\r\n..");
    connection.write(Buffer.from(`${dotSafe}\r\n.\r\n`, "binary").toString("binary"));
    expectCode(await connection.readResponse(), [250], "送出郵件");

    connection.write("QUIT\r\n");
    await connection.readResponse().catch(() => undefined);
  } finally {
    connection.close();
  }
}

function extractAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1]! : value).trim();
}

/** 讀取 `KEY=VALUE` 環境檔（略過註解及空行；不覆寫既有環境變數） */
export function loadEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const values: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

/** 由環境變數建立 SMTP 設定；缺少必要欄位時回傳說明（不是猜測預設值） */
export function smtpConfigFromEnv(
  env: Record<string, string | undefined>,
): { config: SmtpConfig } | { error: string } {
  const host = env.EXPORT_SMTP_HOST?.trim() ?? "";
  const portRaw = env.EXPORT_SMTP_PORT?.trim() ?? "";
  const user = env.EXPORT_SMTP_USER?.trim() ?? "";
  const password = env.EXPORT_SMTP_PASSWORD ?? "";
  const from = env.EXPORT_MAIL_FROM?.trim() ?? "";
  if (!host) return { error: "缺少 EXPORT_SMTP_HOST" };
  if (!from) return { error: "缺少 EXPORT_MAIL_FROM（寄件人地址）" };
  const port = Number.parseInt(portRaw || "587", 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65_535) {
    return { error: `EXPORT_SMTP_PORT 無效：${portRaw}` };
  }
  if ((user && !password) || (!user && password)) {
    return { error: "EXPORT_SMTP_USER 與 EXPORT_SMTP_PASSWORD 必須同時提供或同時留空" };
  }
  return {
    config: {
      host,
      port,
      // 465 一般為隱含 TLS；587／25 使用 STARTTLS
      secure: env.EXPORT_SMTP_SECURE ? env.EXPORT_SMTP_SECURE === "true" : port === 465,
      user,
      password,
      allowPlaintext: env.EXPORT_SMTP_ALLOW_PLAINTEXT === "true",
    },
  };
}

/** 檔名的 MIME 類型（只支援本平台會寄出的格式） */
export function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === ".xlsx") {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  }
  if (extension === ".csv") return "text/csv";
  return "application/octet-stream";
}
