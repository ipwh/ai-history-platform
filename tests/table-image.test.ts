import { describe, expect, it } from "vitest";

import { buildPracticeTableHtml } from "../scripts/lib/table-image";

const image = {
  title: "中四 本週累計",
  subtitle: "統計期間：2026-11-16 至 2026-11-20（香港時間）",
  summary: ["名冊學生：135 位", "準確率：67.49%"],
  columns: ["班別班號", "姓名", "練習", "獲派", "作答", "答對", "答錯", "準確率", "最後練習"],
  rows: [
    ["4A-01", "歐咏怡", "3", "30", "22", "17", "5", "77.27%", "11-20"],
    ["4C-30", "黃柏皓", "3", "30", "26", "6", "20", "23.08%", "11-19"],
  ],
  notes: ["只列有練習紀錄的學生。"],
};

describe("表格 JPG 的 HTML", () => {
  it("包含標題、摘要、全部欄名及學生資料", () => {
    const html = buildPracticeTableHtml(image);
    expect(html).toContain("<title>中四 本週累計</title>");
    expect(html).toContain("統計期間：2026-11-16 至 2026-11-20");
    expect(html).toContain("<th>班別班號</th>");
    expect(html).toContain("<th>最後練習</th>");
    expect(html).toContain("<td>歐咏怡</td>");
    expect(html).toContain("<td>11-20</td>");
    // 摘要的「名稱：數值」會分開強調顯示
    expect(html).toContain("<strong>67.49%</strong>");
  });

  it("準確率低於 60% 的列加上標示，其餘不加", () => {
    const html = buildPracticeTableHtml(image);
    const lowRows = html.match(/<tr class="low">/g) ?? [];
    expect(lowRows).toHaveLength(1);
    // 低分列必然是黃柏皓（23.08%）
    expect(html).toMatch(/<tr class="low">([\s\S]*?)黃柏皓[\s\S]*?<\/tr>/);
  });

  it("轉義 HTML 避免學生姓名或題目內容破壞版面", () => {
    const html = buildPracticeTableHtml({
      ...image,
      title: `<script>alert(1)</script>`,
      rows: [["4A-99", `陳<大文> & "同學"`, "1", "1", "1", "0", "1", "0.00%", "11-19"]],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("陳&lt;大文&gt; &amp; &quot;同學&quot;");
  });
});
