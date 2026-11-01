/**
 * 學伴「白名單網頁補充」的主機白名單及位址防護（純函式，不做任何 I/O）。
 *
 * ── 為甚麼要獨立成一個模組 ─────────────────────────────────────────────
 * `config.ts` 需要預設白名單及正規化函式，`tutor-web-supplement.ts` 需要比對邏輯；
 * 若兩者互相 import 會形成循環依賴。這個模組不 import 任何伺服器設定或網絡模組，
 * 因此兩邊都可以安全引用，亦可以在單元測試中直接驗證判斷邏輯。
 *
 * ── 白名單設計 ────────────────────────────────────────────────────────
 *   1. **預設拒絕**：只有能匹配 allowlist 的 host 才會被抓取。
 *   2. **後綴匹配**：`www.bbc.co.uk` 會匹配 allowlist 中的 `bbc.co.uk`，
 *      但 `bbc.co.uk.evil.com` 不會（必須是 `.` 邊界）。
 *   3. **拒收 IP 字面值**：allowlist 內的 IP 條目一律忽略，避免有人以
 *      `TUTOR_WEB_ALLOWLIST=127.0.0.1` 繞過主機檢查。
 *   4. **硬性封鎖名單**：社交平台、論壇、共筆百科及內容農場即使在 allowlist 內
 *      亦不會被抓取（見 `TUTOR_WEB_BLOCKED_HOSTS`），令「明確排除」不依賴設定正確。
 */

/**
 * 預設白名單（**未設定 `TUTOR_WEB_ALLOWLIST` 時使用**；逗號分隔，不含協議）。
 *
 * 每一項都經 2026-11-01 以 `Resolve-DnsName` 核對過可解析：
 *   - 通史／百科：britannica.com、bbc.co.uk、bbc.com、history.com、worldhistory.org、
 *     khanacademy.org、education.nationalgeographic.org、nobelprize.org
 *   - 史料／文件：avalon.law.yale.edu、sourcebooks.fordham.edu、nationalarchives.gov.uk、
 *     archives.gov、loc.gov、un.org
 *   - 學術／博物館：ashmolean.org（Ashmolean Museum 官方域名；規格中的
 *     `ashmolian.com` 是錯字且無法解析，故以此取代）、britishmuseum.org、si.edu、
 *     iwm.org.uk、ushmm.org、jstor.org（大部分正文在付費牆後，抓不到時如實留空）
 *   - 香港／本地：edb.gov.hk、hk.history.museum（香港歷史博物館官方 host）、
 *     grs.gov.hk（政府檔案處 Government Records Service；規格中的 `pro.gov.hk`
 *     無法解析，故以實際官方 host 取代）、lcsd.gov.hk
 *
 * **刻意不包括**：`iwmi.yale.edu`（DNS 無記錄）、整個 `.edu.hk`（只放已確認的單一
 * host，不放整個網域）、`pro.gov.hk`／`ashmolian.com`（無 DNS 記錄）。
 * 亦不包括 wikipedia.org 等共筆百科（見 `TUTOR_WEB_BLOCKED_HOSTS`）。
 */
export const DEFAULT_TUTOR_WEB_ALLOWLIST: readonly string[] = [
  // A. 通史／百科
  "britannica.com",
  "bbc.co.uk",
  "bbc.com",
  "history.com",
  "worldhistory.org",
  "khanacademy.org",
  "education.nationalgeographic.org",
  "nobelprize.org",
  // B. 史料／文件
  "avalon.law.yale.edu",
  "sourcebooks.fordham.edu",
  "nationalarchives.gov.uk",
  "archives.gov",
  "loc.gov",
  "un.org",
  // C. 學術／博物館
  "ashmolean.org",
  "britishmuseum.org",
  "si.edu",
  "iwm.org.uk",
  "ushmm.org",
  "jstor.org",
  // D. 香港／本地（公營、教育向）
  "edb.gov.hk",
  "hk.history.museum",
  "grs.gov.hk",
  "lcsd.gov.hk",
];

/**
 * 硬性封鎖的 host 後綴：**即使在 `TUTOR_WEB_ALLOWLIST` 內亦不會抓取**。
 *
 * 原因不是技術問題，而是產品決定（見 README「學伴外部參考」）：
 *   - 共筆百科的內容隨時改動且可能被破壞，不宜作為「權威外部參考」自動引用；
 *   - 社交平台及論壇是個人意見，不是史料。
 * 教師仍可自行把網址給學生，平台只是不會自動引用。
 *
 * **刻意不列入**：blogspot.com、medium.com、baidu.com 等平台式網域。它們預設已被
 * 「預設拒絕」擋下，但若科組真的把某個具體網誌（例如 `某老師.blogspot.com`）正式
 * 加入白名單，這種「單域正式加入」應該可以生效；硬性封鎖會令該例外無法成立。
 */
export const TUTOR_WEB_BLOCKED_HOSTS: readonly string[] = [
  "wikipedia.org",
  "wikimedia.org",
  "wiktionary.org",
  "fandom.com",
  "reddit.com",
  "zhihu.com",
  "quora.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "weibo.com",
  "tieba.baidu.com",
];

/**
 * 正規化單一白名單條目。
 *
 * 接受 `bbc.co.uk`、`https://www.bbc.co.uk/`、`BBC.CO.UK` 等寫法（方便教師直接貼網址），
 * 但會拒絕：含路徑以外的奇怪字元、IP 字面值、單一標籤主機（例如 `localhost`）。
 * 無法解析的條目回傳 `null`，由呼叫方丟棄並在環境診斷中提示。
 */
export function normalizeTutorWebAllowlistEntry(entry: string): string | null {
  let value = entry.trim().toLowerCase();
  if (value.length === 0) return null;
  value = value.replace(/^[a-z]+:\/\//, "");
  value = value.replace(/[/?#].*$/, "");
  value = value.replace(/\.+$/, "");
  const host = value.replace(/:\d+$/, "");
  if (host.length === 0 || host.length > 253) return null;
  if (!/^[a-z0-9.-]+$/.test(host)) return null;
  if (host.startsWith(".") || host.includes("..")) return null;
  // IP 字面值不可作為白名單（否則 allowlist 就能指向內網）
  if (isIpLiteralHost(host)) return null;
  // 單一標籤（沒有點）視為本機或內部主機名，一律拒絕
  if (!host.includes(".")) return null;
  return host;
}

/** 正規化整份白名單：移除無效條目及重複項，保持原順序 */
export function normalizeTutorWebAllowlist(entries: readonly string[]): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    const host = normalizeTutorWebAllowlistEntry(entry);
    if (host === null) continue;
    if (!result.includes(host)) result.push(host);
  }
  return result;
}

/** host 是否屬硬性封鎖名單（含子網域） */
export function isTutorWebBlockedHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.+$/, "");
  if (host.length === 0) return true;
  return TUTOR_WEB_BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

/**
 * 比對 host 是否在白名單內；命中時回傳**對應的白名單條目**（作為顯示用站名）。
 *
 * 回傳條目而不是原始 host，是因為介面與提示詞都要顯示「來源站名」：用白名單條目
 * 可以保證站名一定來自事先核准的清單，不可能出現模型自行編造或搜尋結果帶來的
 * 偽冒站名（例如 `britannica.com.evil.example`）。
 */
export function matchTutorWebAllowlist(
  hostname: string,
  allowlist: readonly string[],
): string | null {
  const host = hostname.trim().toLowerCase().replace(/\.+$/, "");
  if (host.length === 0) return null;
  if (isIpLiteralHost(host)) return null;
  if (isTutorWebBlockedHost(host)) return null;
  for (const entry of allowlist) {
    if (host === entry || host.endsWith(`.${entry}`)) return entry;
  }
  return null;
}

/** 位址是否為 IP 字面值（IPv4 或 IPv6，IPv6 可含方括號及 zone id） */
export function isIpLiteralHost(hostname: string): boolean {
  const value = hostname.trim();
  if (value.includes(":") && /^\[?[0-9a-f:.]+\]?$/i.test(value)) {
    return expandIpv6(value) !== null;
  }
  return ipv4ToInt(value) !== null;
}

/**
 * 位址是否屬不可外連的範圍（私網、迴路、link-local、CGNAT、組播、保留區）。
 *
 * 無法解析的字串一律回傳 `true`（fail-closed）：寧可放棄一段外部參考，
 * 也不可在無法判斷的情況下連去未知位址。
 */
export function isBlockedWebAddress(address: string): boolean {
  const value = address.trim();
  const ipv4 = ipv4ToInt(value);
  if (ipv4 !== null) return isBlockedIpv4(ipv4);
  const ipv6 = expandIpv6(value);
  if (ipv6 !== null) return isBlockedIpv6(ipv6);
  return true;
}

/**
 * 不可外連的 IPv4 網段。
 *
 * `169.254.169.254`（雲端執行個體中繼資料服務）落在 `169.254.0.0/16`，
 * 是這個清單最重要的目標：只要它能經學伴連上，任何提問者都可以讀取執行個體的
 * 服務帳戶憑證。`100.64.0.0/10` 是 CGNAT／雲端內部網路。
 */
const BLOCKED_IPV4_RANGES: readonly (readonly [string, number])[] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

function ipv4ToInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function isBlockedIpv4(value: number): boolean {
  return BLOCKED_IPV4_RANGES.some(([base, bits]) => {
    const baseInt = ipv4ToInt(base);
    if (baseInt === null) return false;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return ((value & mask) >>> 0) === ((baseInt & mask) >>> 0);
  });
}

/** 展開 IPv6 為 8 組 16 位元整數；格式不正確回傳 null */
function expandIpv6(address: string): number[] | null {
  let value = address.trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  const zone = value.indexOf("%");
  if (zone >= 0) value = value.slice(0, zone);
  if (!value.includes(":")) return null;

  // 內嵌 IPv4（例如 ::ffff:127.0.0.1、64:ff9b::169.254.169.254）先換成兩組十六進位
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const tail = value.slice(lastColon + 1);
    const embedded = ipv4ToInt(tail);
    if (embedded === null) return null;
    const high = Math.floor(embedded / 0x10000).toString(16);
    const low = (embedded % 0x10000).toString(16);
    value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const doubleColon = value.indexOf("::");
  const head = doubleColon >= 0 ? value.slice(0, doubleColon) : value;
  const rest = doubleColon >= 0 ? value.slice(doubleColon + 2) : null;
  if (rest === null) {
    const groups = head.split(":");
    return groups.length === 8 ? parseIpv6Groups(groups) : null;
  }
  if (rest.includes("::")) return null;
  const headGroups = head.length > 0 ? head.split(":") : [];
  const restGroups = rest.length > 0 ? rest.split(":") : [];
  const missing = 8 - headGroups.length - restGroups.length;
  if (missing < 0) return null;
  const groups = [...headGroups, ...Array<string>(missing).fill("0"), ...restGroups];
  return parseIpv6Groups(groups);
}

function parseIpv6Groups(groups: string[]): number[] | null {
  const numbers: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    numbers.push(Number.parseInt(group, 16));
  }
  return numbers.length === 8 ? numbers : null;
}

function isBlockedIpv6(groups: number[]): boolean {
  const first = groups[0] ?? 0;
  const isV4Mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const isNat64 = first === 0x0064 && groups[1] === 0xff9b;
  if (isV4Mapped || isNat64) {
    const embedded = (groups[6] ?? 0) * 0x10000 + (groups[7] ?? 0);
    return isBlockedIpv4(embedded);
  }
  if (groups.every((group) => group === 0)) return true; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return true; // ::1
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 唯一本地位址
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 組播
  if (first === 0x2001 && groups[1] === 0x0db8) return true; // 2001:db8::/32 文件用位址
  return false;
}
