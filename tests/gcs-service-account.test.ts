import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildSignedJwt,
  downloadGcsObject,
  getAccessToken,
  parseGsUri,
} from "../scripts/lib/gcs-service-account";

function temporaryKey(): { keyPath: string; publicKey: string; directory: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "gcs-key-"));
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const keyPath = path.join(directory, "key.json");
  fs.writeFileSync(
    keyPath,
    JSON.stringify({
      type: "service_account",
      project_id: "test-project",
      client_email: "reader@test-project.iam.gserviceaccount.com",
      private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      token_uri: "https://oauth2.googleapis.com/token",
    }),
  );
  return {
    keyPath,
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    directory,
  };
}

describe("服務帳戶下載 Cloud Storage 物件", () => {
  it("解析 gs:// URI", () => {
    expect(parseGsUri("gs://bucket-name/history/data/app.db")).toEqual({
      bucket: "bucket-name",
      object: "history/data/app.db",
    });
    expect(() => parseGsUri("https://example.com/app.db")).toThrow(/gs:\/\//);
  });

  it("JWT 以服務帳戶私鑰簽署且內容正確", () => {
    const { keyPath, publicKey, directory } = temporaryKey();
    try {
      const raw = JSON.parse(fs.readFileSync(keyPath, "utf8")) as {
        client_email: string;
        private_key: string;
        token_uri: string;
      };
      const jwt = buildSignedJwt(
        { client_email: raw.client_email, private_key: raw.private_key, token_uri: raw.token_uri },
        { now: new Date("2026-11-19T00:00:00Z") },
      );
      const [header, claim, signature] = jwt.split(".");
      expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
        alg: "RS256",
        typ: "JWT",
      });
      const claims = JSON.parse(Buffer.from(claim!, "base64url").toString()) as {
        iss: string;
        scope: string;
        aud: string;
        iat: number;
        exp: number;
      };
      expect(claims.iss).toBe("reader@test-project.iam.gserviceaccount.com");
      expect(claims.scope).toContain("devstorage.read_only");
      expect(claims.exp - claims.iat).toBe(3600);
      expect(
        crypto.verify(
          "RSA-SHA256",
          Buffer.from(`${header}.${claim}`),
          publicKey,
          Buffer.from(signature!, "base64url"),
        ),
      ).toBe(true);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("下載失敗時提供可行動的訊息（不靜默回傳空資料）", async () => {
    const { keyPath, directory } = temporaryKey();
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ access_token: "token" }), { status: 200 })) as unknown as typeof fetch;
      const failing = (async () => new Response("forbidden", { status: 403 })) as unknown as typeof fetch;
      await expect(
        downloadGcsObject("gs://bucket/app.db", keyPath, { fetchImpl: failing }),
      ).rejects.toThrow(/HTTP 403[\s\S]*objectViewer/);
    } finally {
      globalThis.fetch = original;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("成功時回傳原始位元組，並可取得存取權杖", async () => {
    const { keyPath, directory } = temporaryKey();
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ access_token: "token" }), { status: 200 })) as unknown as typeof fetch;
      const fileFetch = (async () =>
        new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch;
      const buffer = await downloadGcsObject("gs://bucket/app.db", keyPath, { fetchImpl: fileFetch });
      expect([...buffer]).toEqual([1, 2, 3]);
      await expect(getAccessToken(keyPath)).resolves.toBe("token");
    } finally {
      globalThis.fetch = original;
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
