/**
 * 學生名冊服務：讀取 Google Sheet（或 CSV／本機檔案）、快取，並提供依電郵／學號查詢。
 *
 * 設計重點：
 *   1. 名冊只存放班別、學號、姓名、電郵，**不會**存放密碼；學生仍以學校 Google 帳戶登入。
 *   2. 讀取失敗時會沿用上一次成功的快照（並記錄錯誤），避免 Google 短暫故障導致全班無法登入。
 *   3. 對外只提供查詢結果及統計（人數、來源、更新時間），不提供整份名冊。
 */
import { getServerConfig, type RosterConfig } from "../config";
import { replaceStoredRosterStudents } from "../repositories/roster-identities";
import { buildRoster, detectColumns, type RosterStudent } from "./columns";
import { fetchRosterRows } from "./source";

export interface RosterSnapshot {
  /** 是否已成功載入名冊 */
  loaded: boolean;
  /** 名冊學生（依電郵索引） */
  students: RosterStudent[];
  loadedAt: string | null;
  /** 讀取失敗時的錯誤訊息（沿用舊快照時仍會顯示） */
  error: string | null;
}

export interface RosterStatus {
  enabled: boolean;
  enforce: boolean;
  source: RosterConfig["source"];
  /** 快照是否可用 */
  loaded: boolean;
  /** 名冊人數（未載入時為 null） */
  students: number | null;
  /** 其中班別在開放範圍內的人數（未設範圍時與 students 相同） */
  inScope: number | null;
  /** 開放的班別範圍（空白 = 不設限） */
  classPrefixes: string[];
  classes: string[];
  loadedAt: string | null;
  error: string | null;
}

interface RosterCache {
  students: RosterStudent[];
  byEmail: Map<string, RosterStudent>;
  byStudentNumber: Map<string, RosterStudent>;
  loadedAt: number;
  error: string | null;
}

let cache: RosterCache | null = null;
let inflight: Promise<RosterSnapshot> | null = null;

/** 測試或名冊變更後可清除快取 */
export function resetRosterCache(): void {
  cache = null;
  inflight = null;
}

function indexStudents(students: RosterStudent[]): Omit<RosterCache, "loadedAt" | "error"> {
  const byEmail = new Map<string, RosterStudent>();
  const byStudentNumber = new Map<string, RosterStudent>();
  for (const student of students) {
    byEmail.set(student.email, student);
    if (student.studentNumber.length > 0 && !byStudentNumber.has(student.studentNumber)) {
      byStudentNumber.set(student.studentNumber, student);
    }
  }
  return { students, byEmail, byStudentNumber };
}

/** 由原始表格列建立索引（同時供測試使用） */
export function buildRosterIndex(rows: string[][], config: RosterConfig): Omit<RosterCache, "loadedAt" | "error"> {
  const headerRow = rows[0] ?? [];
  const columns = detectColumns(headerRow, config.columns);
  const students = buildRoster(rows.slice(1), {
    columns,
    schoolDomains: getServerConfig().auth.schoolDomains,
    scope: config.scope,
  });
  return indexStudents(students);
}

/**
 * 取得名冊快照（含快取）。
 * 未啟用名冊時回傳空快照；讀取失敗且有舊快照時沿用舊資料並記錄錯誤。
 */
export async function getRosterSnapshot(options: { force?: boolean } = {}): Promise<RosterSnapshot> {
  const config = getServerConfig().roster;
  if (!config.enabled || config.source === "none") {
    return { loaded: false, students: [], loadedAt: null, error: null };
  }

  const now = Date.now();
  if (!options.force && cache !== null && now - cache.loadedAt < config.cacheTtlSeconds * 1000) {
    return snapshotFrom(cache);
  }
  if (inflight !== null) return inflight;

  inflight = (async () => {
    try {
      const rows = await fetchRosterRows(config);
      const indexed = buildRosterIndex(rows, config);
      try {
        // 教師端在名冊暫時不可用或已停用時，仍可顯示上次成功的姓名、班別及學號。
        // 只保存開放班別內的學生，避免把平台範圍外的名冊資料長期留存在資料庫。
        replaceStoredRosterStudents(
          indexed.students.filter((student) => student.inScope),
        );
      } catch (error) {
        console.warn(
          "[roster] 名冊身分快照寫入失敗，教師端只會使用即時名冊：",
          error instanceof Error ? error.message : error,
        );
      }
      cache = { ...indexed, loadedAt: Date.now(), error: null };
      return snapshotFrom(cache);
    } catch (error) {
      const message = error instanceof Error ? error.message : "讀取名冊失敗";
      if (cache !== null) {
        cache = { ...cache, error: message };
        console.warn("[roster] 名冊更新失敗，沿用上一次成功的名冊：", message);
        return snapshotFrom(cache);
      }
      console.warn("[roster] 名冊讀取失敗：", message);
      return { loaded: false, students: [], loadedAt: null, error: message };
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}

function snapshotFrom(current: RosterCache): RosterSnapshot {
  return {
    loaded: true,
    students: current.students,
    loadedAt: new Date(current.loadedAt).toISOString(),
    error: current.error,
  };
}

/**
 * 依學校帳戶電郵查詢學生。
 * 找不到時回傳 null；名冊未載入時回傳 undefined（呼叫端可據此決定是否拒絕登入）。
 */
export async function findRosterStudent(email: string): Promise<RosterStudent | null | undefined> {
  const snapshot = await getRosterSnapshot();
  if (!snapshot.loaded) return undefined;
  return findStudentInSnapshot(snapshot, email);
}

/** 純查詢：由快照的學生清單找出對應學生（電郵優先，其次比對學號） */
export function findStudentInSnapshot(
  snapshot: RosterSnapshot,
  email: string,
): RosterStudent | null {
  const normalized = email.trim().toLowerCase();
  if (normalized.length === 0) return null;

  const direct = snapshot.students.find((student) => student.email === normalized);
  if (direct !== undefined) return direct;

  // 容錯：名冊只填了學號，或電郵與學號大小寫不一致
  const localPart = normalized.includes("@") ? normalized.slice(0, normalized.indexOf("@")) : normalized;
  return (
    snapshot.students.find(
      (student) =>
        student.studentNumber.length > 0 &&
        (student.studentNumber === normalized || student.studentNumber === localPart),
    ) ?? null
  );
}

/**
 * 管理員端／健康檢查用的名冊狀態（不含任何學生個人資料）。
 *
 * load = false 時只回報設定及現有快取，不會主動讀取名冊（供公開健康檢查使用，
 * 避免健康檢查因為 Google Sheets 逾時而變慢）；管理員端預設會實際載入。
 */
export async function getRosterStatus(options: { load?: boolean } = {}): Promise<RosterStatus> {
  const config = getServerConfig().roster;
  const shouldLoad = options.load !== false;
  const snapshot = shouldLoad
    ? await getRosterSnapshot()
    : {
        loaded: cache !== null,
        students: cache?.students ?? [],
        loadedAt: cache !== null ? new Date(cache.loadedAt).toISOString() : null,
        error: cache?.error ?? null,
      };

  return {
    enabled: config.enabled,
    enforce: config.enforce,
    source: config.source,
    loaded: snapshot.loaded,
    students: snapshot.loaded ? snapshot.students.length : null,
    inScope: snapshot.loaded ? snapshot.students.filter((student) => student.inScope).length : null,
    classPrefixes: config.scope.classPrefixes,
    classes: config.scope.classes,
    loadedAt: snapshot.loadedAt,
    error: snapshot.error,
  };
}
