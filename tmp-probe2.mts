import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const copy = path.join(os.tmpdir(), `tutor-probe2-${process.pid}.db`);
fs.copyFileSync(path.join("data", "app.db"), copy);
process.env.APP_DATABASE_PATH = copy;
process.env.BACKUP_ENABLED = "false";

const { findTutorGrounding } = await import("@/server/services/tutor-grounding");
const { answeredTurnsOnly } = await import("@/server/services/tutor");

const orphanHistory = [
  { role: "user" as const, content: "凡爾賽條約如何約束德國？" },
  { role: "user" as const, content: "我想知道文藝復興如何導致宗教革命的出現。" },
];

for (const label of ["沒有上文", "有上文（含失敗提問）"]) {
  const context =
    label === "沒有上文"
      ? []
      : answeredTurnsOnly(orphanHistory).filter((turn) => turn.role === "user").map((turn) => turn.content);
  const grounding = findTutorGrounding("我想知道文藝復興如何導致宗教革命的出現。", context);
  console.log(`\n=== ${label} → status=${grounding.status} topic=${grounding.topicTitle ?? "-"}`);
  for (const passage of grounding.passages) {
    console.log(`    · ${passage.documentLabel} ${passage.location}`);
    console.log(`      ${passage.excerpt}`);
  }
}

console.log("\nansweredTurnsOnly:", JSON.stringify(answeredTurnsOnly(orphanHistory)));
console.log("probe database:", copy);
