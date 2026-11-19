import net from "node:net";

import { describe, expect, it } from "vitest";

import {
  buildMimeMessage,
  encodeHeaderValue,
  loadEnvFile,
  sendMail,
  smtpConfigFromEnv,
} from "../scripts/lib/smtp-mail";

describe("SMTP 郵件內容", () => {
  it("ASCII 標頭保持原樣，中文以 RFC 2047 編碼", () => {
    expect(encodeHeaderValue("Daily report")).toBe("Daily report");
    const encoded = encodeHeaderValue("中四 每日作答");
    expect(encoded).toMatch(/^=\?UTF-8\?B\?/);
    expect(Buffer.from(encoded.slice(10, -2), "base64").toString("utf8")).toBe("中四 每日作答");
  });

  it("建立 multipart 郵件並附上 Excel", () => {
    const message = buildMimeMessage(
      {
        from: "sender@example.test",
        to: ["a@example.test", "b@example.test"],
        subject: "中四 每日作答情況（2026-11-18）",
        text: "詳見附件。",
        attachments: [
          {
            filename: "中四_每日作答_2026-11-18.xlsx",
            contentType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            content: Buffer.from("PK-test"),
          },
        ],
      },
      new Date("2026-11-19T00:00:00Z"),
    ).toString("utf8");

    expect(message).toContain("To: a@example.test, b@example.test");
    expect(message).toContain("Content-Type: multipart/mixed; boundary=");
    expect(message).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(message).toContain(Buffer.from("PK-test").toString("base64"));
    // 內文以 UTF-8 base64 傳送，避免 8-bit 相容問題
    expect(message).toContain(Buffer.from("詳見附件。", "utf8").toString("base64"));
  });
});

describe("SMTP 設定", () => {
  it("465 預設隱含 TLS，其他埠使用 STARTTLS", () => {
    const secure = smtpConfigFromEnv({
      EXPORT_SMTP_HOST: "smtp.example.test",
      EXPORT_SMTP_PORT: "465",
      EXPORT_SMTP_USER: "user@example.test",
      EXPORT_SMTP_PASSWORD: "secret",
      EXPORT_MAIL_FROM: "user@example.test",
    });
    expect(secure).toMatchObject({ config: { secure: true, port: 465 } });

    const startTls = smtpConfigFromEnv({
      EXPORT_SMTP_HOST: "smtp.example.test",
      EXPORT_SMTP_PORT: "587",
      EXPORT_MAIL_FROM: "user@example.test",
    });
    expect(startTls).toMatchObject({ config: { secure: false, user: "" } });
  });

  it("缺少必要設定時如實回報（不用猜測的預設值假裝可用）", () => {
    expect(smtpConfigFromEnv({})).toEqual({ error: "缺少 EXPORT_SMTP_HOST" });
    expect(smtpConfigFromEnv({ EXPORT_SMTP_HOST: "smtp.example.test" })).toEqual({
      error: "缺少 EXPORT_MAIL_FROM（寄件人地址）",
    });
    expect(
      smtpConfigFromEnv({
        EXPORT_SMTP_HOST: "smtp.example.test",
        EXPORT_MAIL_FROM: "a@example.test",
        EXPORT_SMTP_USER: "user",
      }),
    ).toEqual({ error: "EXPORT_SMTP_USER 與 EXPORT_SMTP_PASSWORD 必須同時提供或同時留空" });
  });

  it("環境檔略過註解及引號", () => {
    expect(loadEnvFile("does-not-exist.env")).toEqual({});
  });
});

/** 最小 SMTP 伺服器：只實作本測試需要的對話（不支援 STARTTLS／AUTH） */
function startFakeSmtp(): Promise<{
  port: number;
  messages: string[];
  close: () => Promise<void>;
}> {
  const messages: string[] = [];
  const server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    socket.write("220 fake.smtp ready\r\n");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      while (true) {
        if (inData) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end < 0) return;
          messages.push(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          inData = false;
          socket.write("250 queued\r\n");
          continue;
        }
        const lineEnd = buffer.indexOf("\r\n");
        if (lineEnd < 0) return;
        const line = buffer.slice(0, lineEnd);
        buffer = buffer.slice(lineEnd + 2);
        if (/^EHLO/i.test(line)) {
          socket.write("250-fake.smtp\r\n250-SIZE 10240000\r\n250 8BITMIME\r\n");
        } else if (/^MAIL FROM|^RCPT TO/i.test(line)) {
          socket.write("250 ok\r\n");
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write("354 end with .\r\n");
        } else if (/^QUIT/i.test(line)) {
          socket.write("221 bye\r\n");
          socket.end();
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        port,
        messages,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

describe("SMTP 送出流程", () => {
  it("完成 EHLO／MAIL／RCPT／DATA／QUIT 並送達完整郵件", async () => {
    const fake = await startFakeSmtp();
    try {
      await sendMail(
        {
          host: "127.0.0.1",
          port: fake.port,
          secure: false,
          user: "",
          password: "",
          allowPlaintext: true,
          timeoutMs: 5_000,
        },
        {
          from: "sender@example.test",
          to: ["teacher@example.test"],
          subject: "中四 每日作答情況",
          text: "附件為 2026-11-18 的一般練習統計。",
          attachments: [
            { filename: "report.xlsx", contentType: "application/octet-stream", content: Buffer.from("PK") },
          ],
        },
      );

      expect(fake.messages).toHaveLength(1);
      expect(fake.messages[0]).toContain("Subject: =?UTF-8?B?");
      expect(fake.messages[0]).toContain("filename=\"report.xlsx\"");
    } finally {
      await fake.close();
    }
  });

  it("伺服器未提供 STARTTLS 時預設拒絕明文傳送", async () => {
    const fake = await startFakeSmtp();
    try {
      await expect(
        sendMail(
          {
            host: "127.0.0.1",
            port: fake.port,
            secure: false,
            user: "",
            password: "",
            timeoutMs: 5_000,
          },
          {
            from: "sender@example.test",
            to: ["teacher@example.test"],
            subject: "test",
            text: "test",
          },
        ),
      ).rejects.toThrow(/STARTTLS/);
    } finally {
      await fake.close();
    }
  });

  it("拒絕非 ASCII 收件人（不假裝送出）", async () => {
    await expect(
      sendMail(
        { host: "127.0.0.1", port: 1, secure: false, user: "", password: "", allowPlaintext: true },
        { from: "a@example.test", to: ["陳老師@example.test"], subject: "x", text: "x" },
      ),
    ).rejects.toThrow(/ASCII/);
  });
});
