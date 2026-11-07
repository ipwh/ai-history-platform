import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { writeReleaseGateEvidence } from "@/server/quality/release-gate-output";

const temporaryDirectories: string[] = [];

function createTemporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "release-gate-output-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("release gate evidence output", () => {
  it("writes Unicode evidence as valid UTF-8 without changing its text", () => {
    const directory = createTemporaryDirectory();
    const jsonPath = path.join(directory, "report.json");
    const markdownPath = path.join(directory, "report.md");
    const jsonContent = '{"verdict":"待覆核","topic":"法國大革命"}\n';
    const markdownContent = "# 發布閘門\n\n待教師覆核：美國革命與法國大革命。\n";

    writeReleaseGateEvidence({
      jsonPath,
      jsonContent,
      markdownPath,
      markdownContent,
    });

    expect(fs.readFileSync(jsonPath, "utf8")).toBe(jsonContent);
    expect(fs.readFileSync(markdownPath, "utf8")).toBe(markdownContent);
  });

  it("refuses to overwrite existing evidence and creates neither partial output", () => {
    const directory = createTemporaryDirectory();
    const jsonPath = path.join(directory, "report.json");
    const markdownPath = path.join(directory, "report.md");
    const existing = "# 已有部署證據\n\n不得覆寫。\n";
    fs.writeFileSync(markdownPath, existing, "utf8");

    expect(() =>
      writeReleaseGateEvidence({
        jsonPath,
        jsonContent: '{"verdict":"READY"}\n',
        markdownPath,
        markdownContent: "# 新報告\n",
      }),
    ).toThrow(/already exists/i);
    expect(fs.existsSync(jsonPath)).toBe(false);
    expect(fs.readFileSync(markdownPath, "utf8")).toBe(existing);
  });
});
