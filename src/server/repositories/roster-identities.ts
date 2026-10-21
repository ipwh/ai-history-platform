/**
 * 名冊身分快照（教師端監察用）。
 *
 * 名冊本身是 Google Sheet 的記憶體快取；這裡只保留教師辨識學生所需的
 * 電郵、姓名、班別及學號，並在每次名冊成功載入時整體替換。
 * 不會保存密碼、登入憑證或任何作答內容。
 */
import { getDb, isReadOnlyDatabaseMode, nowIso } from "../db/connection";
import type { RosterStudent } from "../roster/columns";

interface StoredRow {
  email: string;
  name: string;
  class_name: string;
  student_number: string;
  in_scope: number;
}

/** 以最新名冊整體替換快照（於名冊成功載入後呼叫） */
export function replaceStoredRosterStudents(students: RosterStudent[]): void {
  if (isReadOnlyDatabaseMode()) return;
  const db = getDb();
  const timestamp = nowIso();
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM roster_students").run();
    const insert = db.prepare(
      `INSERT INTO roster_students (email, name, class_name, student_number, in_scope, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const student of students) {
      insert.run(
        student.email,
        student.name,
        student.className,
        student.studentNumber,
        student.inScope ? 1 : 0,
        timestamp,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 讀取最後一次成功載入的名冊身分（沒有快照時回傳空陣列） */
export function listStoredRosterStudents(): RosterStudent[] {
  const rows = getDb()
    .prepare(
      `SELECT email, name, class_name, student_number, in_scope
       FROM roster_students ORDER BY class_name, student_number, email`,
    )
    .all() as unknown as StoredRow[];
  return rows.map((row) => ({
    email: row.email,
    name: row.name,
    className: row.class_name,
    studentNumber: row.student_number,
    inScope: row.in_scope === 1,
  }));
}
