import fs from "node:fs";
import path from "node:path";

import { UI_TEST_IDENTITIES, UI_TEST_SECRET, uiTestPaths } from "./test-env";

/**
 * 產生瀏覽器測試用的登入 cookie。
 *
 * 由 global-setup 以子程序執行（tsx），確保與 Next 伺服器使用同一套簽署邏輯及
 * 同一個 AUTH_SECRET；測試行程本身不需要載入伺服器模組。
 */
async function main() {
  process.env.AUTH_SECRET = UI_TEST_SECRET;
  const { encodeSession } = await import("../../src/server/auth/session");
  const now = Date.now();

  const cookies = {
    student: encodeSession(
      {
        email: UI_TEST_IDENTITIES.student,
        name: "UI 學生",
        role: "student",
        learnerId: "ui-student-0000001",
        studentNumber: null,
        className: null,
        rosterVerified: false,
      },
      now,
    ),
    // 只供學伴 UI 測試：以簽署的已核對名冊狀態測試頁面守衛，不改動正式 auth／guards。
    tutorStudent: encodeSession(
      {
        email: UI_TEST_IDENTITIES.tutorStudent,
        name: "已核對名冊的 UI 測試學生",
        role: "student",
        learnerId: `school:${UI_TEST_IDENTITIES.tutorStudent}`,
        studentNumber: "s2024001",
        className: "1A",
        rosterVerified: true,
      },
      now,
    ),
    teacher: encodeSession(
      {
        email: UI_TEST_IDENTITIES.teacher,
        name: "UI 教師",
        role: "teacher",
        learnerId: "ui-teacher",
      },
      now,
    ),
    admin: encodeSession(
      {
        email: UI_TEST_IDENTITIES.admin,
        name: "UI 管理員",
        role: "admin",
        learnerId: "ui-admin",
      },
      now,
    ),
    reviewer: encodeSession(
      {
        email: UI_TEST_IDENTITIES.reviewer,
        name: "UI 歷史科審核者",
        role: "teacher",
        learnerId: "ui-reviewer",
      },
      now,
    ),
  };

  const paths = uiTestPaths();
  fs.mkdirSync(path.dirname(paths.cookiesFile), { recursive: true });
  fs.writeFileSync(paths.cookiesFile, JSON.stringify(cookies), "utf8");
}

main().catch((error: unknown) => {
  console.error("[ui-test] 無法建立測試登入 cookie", error);
  process.exit(1);
});
