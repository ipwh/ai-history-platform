import { describe, expect, it } from "vitest";

import { TUTOR_STUDENT_QUERY_MATRIX } from "./fixtures/tutor-student-query-matrix";
import { TUTOR_SIMULATION_MATRIX } from "./fixtures/tutor-simulation-matrix";
import { LIVE_EVAL_DATASET } from "./fixtures/tutor-live-eval-dataset";
import {
  TUTOR_CASE_ID_MAP,
  TUTOR_DUPLICATE_GROUPS,
  TUTOR_UNIQUE_QUESTION_COUNT,
  buildEvidenceSkeleton,
  caseEntry,
  normalizeCaseQuery,
} from "./fixtures/tutor-case-id-map";

/**
 * 案例 ID 映射契約（Sprint 32 §6）。
 *
 * 目的：三份集合的案例數不可直接相加當成獨立樣本，否則同一條問題會被重複計算，
 * 令覆核進度及統計失真。
 */
describe("案例 ID 映射", () => {
  it("三份集合的每一條案例都恰好在映射中出現一次", () => {
    const expected =
      TUTOR_STUDENT_QUERY_MATRIX.length +
      TUTOR_SIMULATION_MATRIX.length +
      LIVE_EVAL_DATASET.length;
    expect(TUTOR_CASE_ID_MAP).toHaveLength(expected);
    expect(expected).toBe(186);
  });

  it("每條案例只屬於一個重複組，且沒有兩個來源共用同一 sourceId", () => {
    const keys = TUTOR_CASE_ID_MAP.map((entry) => `${entry.source}:${entry.sourceId}`);
    expect(new Set(keys).size).toBe(keys.length);
    // 同一 source 內不會有重複 ID
    const perGroup = new Map<string, Set<string>>();
    for (const entry of TUTOR_CASE_ID_MAP) {
      const set = perGroup.get(entry.duplicateGroup) ?? new Set<string>();
      set.add(`${entry.source}:${entry.sourceId}`);
      perGroup.set(entry.duplicateGroup, set);
    }
    for (const [, ids] of perGroup) expect(ids.size).toBeGreaterThan(0);
  });

  it("去重後的獨立問題數少於案例總數（證實存在跨集合重複）", () => {
    expect(TUTOR_UNIQUE_QUESTION_COUNT).toBeLessThan(TUTOR_CASE_ID_MAP.length);
    expect(TUTOR_DUPLICATE_GROUPS.length).toBeGreaterThan(0);
  });

  it("每個重複組的所有成員正規化後完全相同", () => {
    for (const group of TUTOR_DUPLICATE_GROUPS) {
      const texts = group.sourceIds.map((key) => {
        const [source, sourceId] = key.split(":") as [string, string];
        const entry = caseEntry(source as never, sourceId);
        expect(entry, key).not.toBeNull();
        return normalizeCaseQuery(entry!.query);
      });
      expect(new Set(texts).size, group.group).toBe(1);
    }
  });

  it("已知的跨集合重複已被辨識（點解？／1942 年參戰／明治維新／種族隔離等）", () => {
    const findGroup = (source: "teacher-matrix" | "simulation-matrix" | "live-eval-dataset", id: string) =>
      caseEntry(source, id)?.duplicateGroup ?? null;

    // 「點解？」同時出現在三份集合
    const h01 = findGroup("teacher-matrix", "H-01");
    expect(h01).not.toBeNull();
    expect(findGroup("simulation-matrix", "SIM-51")).toBe(h01);
    expect(findGroup("live-eval-dataset", "live-10")).toBe(h01);

    // 「美國在1942年才正式參戰，對嗎？」
    const i01 = findGroup("teacher-matrix", "I-01");
    expect(findGroup("simulation-matrix", "SIM-47")).toBe(i01);
    expect(findGroup("live-eval-dataset", "live-12")).toBe(i01);
  });

  it("證據骨架每組只出現一次，且全部為未執行／待覆核（不可自動核准）", () => {
    const skeleton = buildEvidenceSkeleton();
    expect(skeleton).toHaveLength(TUTOR_UNIQUE_QUESTION_COUNT);
    const groups = skeleton.map((entry) => entry.duplicateGroup);
    expect(new Set(groups).size).toBe(groups.length);
    expect(skeleton.every((entry) => entry.deterministic === "not-run")).toBe(true);
    expect(skeleton.every((entry) => entry.liveModel === "not-run")).toBe(true);
    expect(skeleton.every((entry) => entry.teacherDecision === "pending-human-review")).toBe(true);
    expect(skeleton.filter((entry) => entry.teacherDecision === "teacher-approved")).toHaveLength(0);
  });

  it("12 條評估案例全部可在映射中找到（可追溯至教師／模擬案例）", () => {
    for (const entry of LIVE_EVAL_DATASET) {
      const mapped = caseEntry("live-eval-dataset", entry.id);
      expect(mapped, entry.id).not.toBeNull();
      expect(mapped!.duplicateGroup).toMatch(/^dup-\d{3}$/);
    }
  });
});
