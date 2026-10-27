/**
 * 學伴存取判斷測試。
 *
 * 契約：介面的判斷必須與 API 守衛（`requireRosterStudent`）一致，
 * 否則會出現「顯示對話框，但每次送出都收到 403」的情況（2026-10-27 實測：
 * 教師帳戶可進入 /tutor，但 API 回 403）。
 */
import { describe, expect, it } from "vitest";

import { tutorAccessState } from "@/lib/tutor-access";
import type { SessionUser } from "@/lib/types";

function user(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    email: "s2024146@pochiu.edu.hk",
    name: "測試學生",
    role: "student",
    learnerId: "school:s2024146@pochiu.edu.hk",
    pictureUrl: null,
    studentNumber: "s2024146",
    className: "1A",
    rosterVerified: true,
    ...overrides,
  };
}

describe("tutorAccessState", () => {
  it("已登入且在名冊內的學生可以使用", () => {
    expect(tutorAccessState(user())).toBe("allowed");
  });

  it("未登入視為 anonymous（正式環境由頁面守衛導向登入頁）", () => {
    expect(tutorAccessState(null)).toBe("anonymous");
  });

  it("教師及管理員可作測試，並取得 staff-preview 標示", () => {
    expect(
      tutorAccessState(user({ role: "teacher", learnerId: "teacher:t@example.com" })),
    ).toBe("staff-preview");
    expect(tutorAccessState(user({ role: "admin", learnerId: "admin:a@example.com" }))).toBe(
      "staff-preview",
    );
  });

  it("教師不需要名冊核對（教職員不在學生名冊內）", () => {
    expect(
      tutorAccessState(
        user({
          role: "teacher",
          learnerId: "teacher:t@example.com",
          rosterVerified: false,
          className: null,
          studentNumber: null,
        }),
      ),
    ).toBe("staff-preview");
  });

  it("名冊未核對的學生會看到說明，而不是對話框", () => {
    expect(
      tutorAccessState(user({ rosterVerified: false, className: null, studentNumber: null })),
    ).toBe("unverified");
  });
});
