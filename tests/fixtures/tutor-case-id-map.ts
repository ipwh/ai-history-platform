/**
 * 案例 ID 映射（Sprint 32）。
 *
 * ── 為甚麼需要 ────────────────────────────────────────────────────────
 * 三份集合的案例數量不能直接相加當成「已覆蓋的獨立問題」：
 *   - 教師覆核矩陣（83 條）；
 *   - 模擬矩陣（91 條）；
 *   - 受控評估資料集（12 條）。
 * 實測有 11 組跨集合重複（例如「點解？」同時出現在教師矩陣 H-01、模擬矩陣 SIM-51
 * 及評估集 live-10）。若直接相加，就會把同一條問題算成三個獨立樣本，令覆核進度
 * 及統計失真。
 *
 * 本模組由三份來源**推導**映射（不手寫清單，避免日後漂移），並為每組提供
 * `duplicateGroup`：同一組只算一條獨立問題。
 *
 * 正規化方式與測試中的其他比較一致：移除空白、標點及符號並轉小寫，令
 * 「什麼是明治維新？」與「什麼是明治維新」歸為同一組。
 */
import { TUTOR_STUDENT_QUERY_MATRIX } from "./tutor-student-query-matrix";
import { TUTOR_SIMULATION_MATRIX } from "./tutor-simulation-matrix";
import { LIVE_EVAL_DATASET } from "./tutor-live-eval-dataset";

export type TutorCaseSource = "teacher-matrix" | "simulation-matrix" | "live-eval-dataset";

export interface TutorCaseIdEntry {
  /** 來源集合內的 ID（例如 `A-01`、`SIM-01`、`live-01`） */
  sourceId: string;
  source: TutorCaseSource;
  /** 原始問題文字（保留標點及口語） */
  query: string;
  /** 重複組 ID；同一組代表同一條問題，只可計一次 */
  duplicateGroup: string;
}

export function normalizeCaseQuery(query: string): string {
  return query.replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
}

interface RawEntry {
  sourceId: string;
  source: TutorCaseSource;
  query: string;
}

function rawEntries(): RawEntry[] {
  return [
    ...TUTOR_STUDENT_QUERY_MATRIX.map((entry) => ({
      sourceId: entry.id,
      source: "teacher-matrix" as const,
      query: entry.query,
    })),
    ...TUTOR_SIMULATION_MATRIX.map((entry) => ({
      sourceId: entry.id,
      source: "simulation-matrix" as const,
      query: entry.query,
    })),
    ...LIVE_EVAL_DATASET.map((entry) => ({
      sourceId: entry.id,
      source: "live-eval-dataset" as const,
      query: entry.query,
    })),
  ];
}

function buildMap(): {
  entries: TutorCaseIdEntry[];
  uniqueQuestionCount: number;
  duplicateGroups: { group: string; sourceIds: string[] }[];
} {
  const byKey = new Map<string, RawEntry[]>();
  for (const entry of rawEntries()) {
    const key = normalizeCaseQuery(entry.query);
    byKey.set(key, [...(byKey.get(key) ?? []), entry]);
  }

  const entries: TutorCaseIdEntry[] = [];
  const duplicateGroups: { group: string; sourceIds: string[] }[] = [];
  let groupIndex = 0;
  for (const members of byKey.values()) {
    groupIndex += 1;
    const group = `dup-${String(groupIndex).padStart(3, "0")}`;
    for (const member of members) {
      entries.push({ ...member, duplicateGroup: group });
    }
    if (members.length > 1) {
      duplicateGroups.push({
        group,
        sourceIds: members.map((member) => `${member.source}:${member.sourceId}`),
      });
    }
  }

  return { entries, uniqueQuestionCount: byKey.size, duplicateGroups };
}

const built = buildMap();

export const TUTOR_CASE_ID_MAP: readonly TutorCaseIdEntry[] = built.entries;
/** 去重後的獨立問題數（三份集合不可直接相加） */
export const TUTOR_UNIQUE_QUESTION_COUNT = built.uniqueQuestionCount;
export const TUTOR_DUPLICATE_GROUPS = built.duplicateGroups;

export function caseEntry(source: TutorCaseSource, sourceId: string): TutorCaseIdEntry | null {
  return (
    TUTOR_CASE_ID_MAP.find(
      (entry) => entry.source === source && entry.sourceId === sourceId,
    ) ?? null
  );
}

/**
 * 三層證據的狀態欄位（刻意分開，不會互相升級）：
 *   - deterministic：自動測試／分類器結果；
 *   - liveModel：受控評估的模型回覆；
 *   - teacherDecision：歷史科教師裁決（只有這一層可以是 approved）。
 */
export interface TutorCaseEvidenceStatus {
  sourceId: string;
  source: TutorCaseSource;
  duplicateGroup: string;
  deterministic: "pass" | "fail" | "not-run";
  liveModel: "recorded" | "not-run";
  teacherDecision: "pending-human-review" | "teacher-approved" | "teacher-rejected" | "requires-revision";
}

/**
 * 以「每組只取第一條」建立證據狀態骨架，令統計不會重複計算同一條問題。
 * 現時所有案例都是 `not-run`／`pending-human-review`：本輪沒有模型呼叫，也沒有教師裁決。
 */
export function buildEvidenceSkeleton(): TutorCaseEvidenceStatus[] {
  const seen = new Set<string>();
  const result: TutorCaseEvidenceStatus[] = [];
  for (const entry of TUTOR_CASE_ID_MAP) {
    if (seen.has(entry.duplicateGroup)) continue;
    seen.add(entry.duplicateGroup);
    result.push({
      sourceId: entry.sourceId,
      source: entry.source,
      duplicateGroup: entry.duplicateGroup,
      deterministic: "not-run",
      liveModel: "not-run",
      teacherDecision: "pending-human-review",
    });
  }
  return result;
}
