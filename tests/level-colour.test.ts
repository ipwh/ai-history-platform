/**
 * 年級配色：每個年級都必須有自己的一套顏色，而且用於首頁的主要元件。
 *
 * 2026-11-13 使用者回報「中二級及高中的顏色一樣」：高中（`data-level="4"`）在
 * `globals.css` 完全沒有配色規則，於是 `--level-accent` 未定義，橫額、選取中的
 * 年級分頁、統計數字及主要按鈕全部沿用預設藍色——與中二的藍色相同。
 *
 * 這裡直接讀取樣式表（不需啟動瀏覽器）：新增年級或有元件分組時，若漏了其中一級，
 * 測試會失敗，而不是等使用者發現顏色重複。
 */
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { SENIOR_SECONDARY_LEVEL } from "@/lib/types";

const css = fs.readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");

/** 該年級的 `--level-accent`（只比對「屬性選擇器後直接開括號」的調色盤區塊） */
function accentFor(level: number): string | null {
  const match = new RegExp(`\\[data-level="${level}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  if (match === null) return null;
  const accent = /--level-accent:\s*([^;]+);/.exec(match[1] ?? "");
  return accent?.[1]?.trim() ?? null;
}

/** 該年級是否被納入這個元件的選擇器組（選擇器可能以逗號接續另一級） */
function styled(level: number, component: string): boolean {
  const pattern = new RegExp(
    `\\[data-level="${level}"\\]\\s*${component.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[,{]`,
  );
  return pattern.test(css);
}

const LEVELS = [1, 2, 3, SENIOR_SECONDARY_LEVEL];

describe("年級配色", () => {
  it("中一至中三及高中各自有顏色", () => {
    for (const level of LEVELS) {
      expect(accentFor(level), `data-level="${level}" 沒有 --level-accent`).not.toBeNull();
    }
  });

  it("各年級顏色互不相同（避免兩個年級看起來一樣）", () => {
    const accents = LEVELS.map((level) => accentFor(level)?.toUpperCase());
    expect(new Set(accents).size).toBe(LEVELS.length);
  });

  it("每個年級都套用到首頁的主要元件（橫額、選取中的分頁、主要按鈕）", () => {
    for (const level of LEVELS) {
      for (const component of [
        ".home-hero",
        ".home-hero__eyebrow",
        ".home-cta--primary",
        '.level-tab[data-active="true"]',
        ".level-banner",
      ]) {
        expect(styled(level, component), `data-level="${level}" 未套用 ${component}`).toBe(true);
      }
    }
  });
});
