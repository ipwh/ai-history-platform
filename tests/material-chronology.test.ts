/**
 * 教材時序表示（Sprint 8.5）的邊界測試。
 *
 * 重點：`sortKey` 只用於排序，**不是**已核實的準確年份。世紀、約數與範圍必須保留
 * 教材文字支持的年份範圍，`exact` 才代表「教材寫出明確年份」。這一層是為了防止
 * 系統把「十八世紀」當成「1700 年」，或把教材沒有交代的先後當成已交代。
 *
 * 全部是確定性解析，不呼叫 AI。
 */
import { describe, expect, it } from "vitest";
import {
  analyseMaterial,
  formatPeriod,
  parseTimeExpression,
  parseTimePeriod,
  parseTimeRange,
  parseTimeSortKey,
  type MaterialPeriod,
} from "@/server/llm/material-analysis";

function periodOf(text: string): MaterialPeriod {
  const period = parseTimePeriod(text);
  expect(period, `無法解析時間：${text}`).not.toBeNull();
  return period!;
}

/** 建立一段合成教材單元 */
function unit(blockId: string, text: string) {
  return { blockId, sourceLocation: `合成教材 · ${blockId}`, text };
}

describe("時間寫法的解析（確定性）", () => {
  it("十七至二十世紀一律以 100 年範圍表示，不是單一年份", () => {
    const expectations: [string, number, number][] = [
      ["十七世紀", 1600, 1699],
      ["十八世紀", 1700, 1799],
      ["十九世紀", 1800, 1899],
      ["二十世紀", 1900, 1999],
      ["19世紀", 1800, 1899],
      ["20世紀", 1900, 1999],
    ];
    for (const [text, startYear, endYear] of expectations) {
      const period = periodOf(text);
      expect(period.kind, text).toBe("century");
      expect(period.startYear, text).toBe(startYear);
      expect(period.endYear, text).toBe(endYear);
      expect(period.exact, `${text} 不可當成明確年份`).toBe(false);
      expect(period.approximate, text).toBe(true);
      expect(period.sortKey, `${text} 的排序值為世紀開始年`).toBe(startYear);
    }
  });

  it("明確年份（包括世紀交界）標示為 exact", () => {
    const expectations: [string, number, string][] = [
      ["1700年", 1700, "year"],
      ["1801年", 1801, "year"],
      ["1900年", 1900, "year"],
      ["公元1453年", 1453, "year"],
      ["公元前221年", -221, "bce-year"],
    ];
    for (const [text, year, kind] of expectations) {
      const period = periodOf(text);
      expect(period.kind, text).toBe(kind);
      expect(period.startYear, text).toBe(year);
      expect(period.endYear, text).toBe(year);
      expect(period.exact, text).toBe(true);
      expect(period.approximate, text).toBe(false);
    }
  });

  it("「約」等約數寫法保留數值但標示為不準確", () => {
    const bce = periodOf("約公元前3,200年");
    expect(bce.kind).toBe("approximate");
    expect(bce.startYear).toBe(-3200);
    expect(bce.endYear).toBe(-3200);
    expect(bce.exact).toBe(false);
    expect(bce.approximate).toBe(true);

    const ce = periodOf("約1914年");
    expect(ce.kind).toBe("approximate");
    expect(ce.exact).toBe(false);
    expect(ce.startYear).toBe(1914);
  });

  it("世紀的修飾語收窄範圍，但仍不是明確年份", () => {
    expect(periodOf("十八世紀初").startYear).toBe(1700);
    expect(periodOf("十八世紀初").endYear).toBe(1719);
    const mid = periodOf("十八世紀中葉");
    expect([mid.startYear, mid.endYear]).toEqual([1730, 1769]);
    const late = periodOf("十九世紀末");
    expect([late.startYear, late.endYear]).toEqual([1880, 1899]);
    expect(late.exact).toBe(false);
  });

  it("跨世紀及跨年份的範圍以 range 表示", () => {
    const centuries = periodOf("十四至十七世紀");
    expect(centuries.kind).toBe("range");
    expect([centuries.startYear, centuries.endYear]).toEqual([1300, 1699]);
    expect(centuries.exact).toBe(false);

    const years = periodOf("1914至1918年");
    expect(years.kind).toBe("range");
    expect([years.startYear, years.endYear]).toEqual([1914, 1918]);
  });

  it("「前221年」等省略「公元」的寫法仍屬公元前，但複合詞（戰前1939年）不會被誤判", () => {
    const shortForm = periodOf("前221年");
    expect(shortForm.kind).toBe("bce-year");
    expect(shortForm.startYear).toBe(-221);
    expect(shortForm.sortKey).toBe(-221);

    // 「戰前」的「前」是複合詞的一部分：年份應保持為公元 1939 年
    const compound = periodOf("戰前1939年");
    expect(compound.kind).toBe("year");
    expect(compound.startYear).toBe(1939);
  });

  it("無法解析時回傳 null，不會猜測", () => {
    expect(parseTimeExpression("很久以前")).toBeNull();
    expect(parseTimeRange("十八世紀")).toBeNull();
    expect(parseTimePeriod("")).toBeNull();
    expect(parseTimeSortKey("中世紀")).toBeNull();
  });

  it("sortKey 的語意寫在型別上：世紀可用於排序，但不可當成準確年份", () => {
    const period = periodOf("十八世紀");
    expect(period.sortKey).toBe(1700);
    expect(period.exact).toBe(false);
    // 同一個時間寫法：排序值與「明確年份」是兩件事
    expect(parseTimeSortKey("十八世紀")).toBe(1700);
    expect(parseTimeSortKey("1700年")).toBe(1700);
    expect(parseTimeSortKey("18世紀")).toBe(1700);
  });

  it("提示詞用的時間說明會標示約數或不可當成準確年份", () => {
    const analysis = analyseMaterial({
      units: [unit("b1", "十八世紀，工業革命在英國展開。")],
    });
    const text = formatPeriod(analysis.events[0]!);
    expect(text).toContain("十八世紀");
    expect(text).toContain("不可當成準確年份");
    expect(text).toContain("1700–1799");
  });
});

describe("先後次序是否真的由教材交代", () => {
  it("相隔的兩個世紀可以判斷先後", () => {
    const analysis = analyseMaterial({
      units: [
        unit("b1", "十八世紀，工業革命在英國展開。"),
        unit("b2", "十九世紀，歐洲列強在亞洲爭奪據點。"),
      ],
    });
    expect(analysis.dimensions.chronology).toBe(true);
    expect(analysis.limitations.map((item) => item.code)).not.toContain("ambiguous-event-order");
    expect(analysis.events[0]!.time).toBe("十八世紀");
    expect(analysis.events[1]!.time).toBe("十九世紀");
  });

  it("範圍重疊的時間（同一世紀的不同寫法）不可用來排序", () => {
    const analysis = analyseMaterial({
      units: [
        unit("b1", "十九世紀，歐洲列強在亞洲爭奪據點。"),
        unit("b2", "十九世紀末，列強進一步取得領事裁判權。"),
      ],
    });
    expect(analysis.dimensions.chronology).toBe(false);
    expect(analysis.limitations.map((item) => item.code)).toContain("ambiguous-event-order");
    // 引用同一段落時，時序面向亦不成立
    expect(analysis.hasDimensionInBlocks("chronology", ["b1", "b2"])).toBe(false);
  });

  it("唯一一件帶年份的事件不可用來出時序題", () => {
    const analysis = analyseMaterial({
      units: [unit("b1", "十八世紀中葉，工業革命率先在英國的紡織業展開。")],
    });
    expect(analysis.dimensions.chronology).toBe(false);
    expect(analysis.limitations.map((item) => item.code)).toContain("single-dated-event");
  });

  it("兩個明確年份可以判斷先後", () => {
    const analysis = analyseMaterial({
      units: [
        unit("b1", "1914年，第一次世界大戰爆發。"),
        unit("b2", "1918年，第一次世界大戰結束。"),
      ],
    });
    expect(analysis.dimensions.chronology).toBe(true);
    expect(analysis.events.map((event) => event.time)).toEqual(["1914年", "1918年"]);
  });

  it("hasExactYearInBlocks 只認明確年份，不認世紀或約數", () => {
    const analysis = analyseMaterial({
      units: [
        unit("b1", "十八世紀，工業革命在英國展開。"),
        unit("b2", "約1914年，歐洲局勢日益緊張。"),
        unit("b3", "1918年，第一次世界大戰結束。"),
      ],
    });
    expect(analysis.hasExactYearInBlocks(["b1"])).toBe(false);
    expect(analysis.hasExactYearInBlocks(["b2"])).toBe(false);
    expect(analysis.hasExactYearInBlocks(["b3"])).toBe(true);
    expect(analysis.hasExactYearInBlocks([])).toBe(true);
  });
});
