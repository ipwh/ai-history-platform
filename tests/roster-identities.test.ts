import { beforeAll, describe, expect, it } from "vitest";

import { freshTestDatabasePath } from "./test-database";

process.env.APP_DATABASE_PATH = freshTestDatabasePath("roster-identities");
process.env.STUDENT_ROSTER_SOURCE = "none";

type RosterIdentityRepository = typeof import("@/server/repositories/roster-identities");

let repository: RosterIdentityRepository;

beforeAll(async () => {
  repository = await import("@/server/repositories/roster-identities");
});

describe("名冊身分快照", () => {
  it("每次成功載入名冊時整體替換，不會留下已離校學生", () => {
    repository.replaceStoredRosterStudents([
      { email: "a@pochiu.edu.hk", name: "甲同學", className: "1A", studentNumber: "01", inScope: true },
      { email: "b@pochiu.edu.hk", name: "乙同學", className: "1A", studentNumber: "02", inScope: true },
    ]);
    expect(repository.listStoredRosterStudents()).toHaveLength(2);

    repository.replaceStoredRosterStudents([
      { email: "b@pochiu.edu.hk", name: "乙同學", className: "1B", studentNumber: "02", inScope: true },
    ]);
    expect(repository.listStoredRosterStudents()).toEqual([
      { email: "b@pochiu.edu.hk", name: "乙同學", className: "1B", studentNumber: "02", inScope: true },
    ]);
  });

  it("沒有快照時回傳空清單，教師端可如實提示未能配對", () => {
    repository.replaceStoredRosterStudents([]);
    expect(repository.listStoredRosterStudents()).toEqual([]);
  });
});
