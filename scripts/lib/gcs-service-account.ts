/**
 * 由服務帳戶金鑰直接下載 Cloud Storage 物件（不需要 `gcloud auth login`）。
 *
 * 為甚麼不用 `gcloud storage cp`：排程任務在背景執行，`gcloud` 的使用者憑證會過期，
 * 需要定期互動登入；屆時排程只會靜默失敗。改用服務帳戶金鑰後，憑證不會過期
 * （除非金鑰被撤銷），亦不需要任何互動。
 *
 * 只用 Node 內建模組（`node:crypto`、`fetch`），不新增依賴：
 *   1. 以 RS256 簽署 JWT（`aud` = Google OAuth token 端點）；
 *   2. 以 JWT 換取短期 access token（scope：`devstorage.read_only`）；
 *   3. 以 `storage.googleapis.com/storage/v1/...?alt=media` 下載物件。
 *
 * 權限：服務帳戶只需該 bucket 的 `roles/storage.objectViewer`。本模組唯讀，
 * 不會列出、修改或刪除任何物件。
 */
import crypto from "node:crypto";
import fs from "node:fs";

const TOKEN_URI = "https://oauth2.googleapis.com/token";
const READ_ONLY_SCOPE = "https://www.googleapis.com/auth/devstorage.read_only";

export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function base64url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function readKey(keyPath: string): ServiceAccountKey {
  const raw = fs.readFileSync(keyPath, "utf8").replace(/^\uFEFF/, "");
  const parsed = JSON.parse(raw) as Partial<ServiceAccountKey>;
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(`服務帳戶金鑰格式不正確（缺少 client_email 或 private_key）：${keyPath}`);
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    token_uri: parsed.token_uri || TOKEN_URI,
  };
}

/** 建立已簽署的 JWT assertion（匯出以便測試） */
export function buildSignedJwt(
  key: ServiceAccountKey,
  options: { now?: Date; scope?: string; lifetimeSeconds?: number } = {},
): string {
  const now = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: options.scope ?? READ_ONLY_SCOPE,
      aud: key.token_uri ?? TOKEN_URI,
      iat: now,
      exp: now + (options.lifetimeSeconds ?? 3600),
    }),
  );
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const signature = base64url(signer.sign(key.private_key));
  return `${header}.${claim}.${signature}`;
}

/** 以服務帳戶金鑰換取短期 access token */
export async function getAccessToken(keyPath: string): Promise<string> {
  const key = readKey(keyPath);
  const assertion = buildSignedJwt(key);
  const response = await fetch(key.token_uri || TOKEN_URI, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `未能以服務帳戶取得存取權杖（HTTP ${response.status}）：${detail.slice(0, 300)}`,
    );
  }
  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("權杖回應沒有 access_token");
  return payload.access_token;
}

/** 解析 `gs://bucket/object` */
export function parseGsUri(uri: string): { bucket: string; object: string } {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri.trim());
  if (!match) throw new Error(`不是有效的 gs:// URI：${uri}`);
  return { bucket: match[1]!, object: match[2]! };
}

/** 下載整個物件（回傳原始位元組，可能是 gzip） */
export async function downloadGcsObject(
  gsUri: string,
  keyPath: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<Buffer> {
  const { bucket, object } = parseGsUri(gsUri);
  const token = await getAccessToken(keyPath);
  const doFetch = options.fetchImpl ?? fetch;
  const url =
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}` +
    `/o/${encodeURIComponent(object)}?alt=media`;
  const response = await doFetch(url, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `未能下載 ${gsUri}（HTTP ${response.status}）：${detail.slice(0, 300)}。` +
        "請確認服務帳戶對該 bucket 有 roles/storage.objectViewer。",
    );
  }
  return Buffer.from(await response.arrayBuffer());
}
