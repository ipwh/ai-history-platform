/**
 * 明確的資料庫 migration 命令（Sprint 13）。
 *
 * 為什麼需要獨立命令：
 *   `getDb()` 在一般應用程式啟動時會自動套用 migration；但 audit／export／evaluation
 *   CLI 承諾唯讀，不應該因為「順便開個連線」而改動 schema（Sprint 11 的
 *   `golden:export --check` 就是這樣對開發資料庫套用了 0022）。現在 migration 變成
 *   一個**明確、需要指定資料庫**的操作。
 *
 * 用法：
 *   npm run db:migrate -- --database "C:\\temp\\copy.db"
 *
 * 安全限制：
 *   - 必須明確提供 `--database`（沒有預設值），避免誤對 data/app.db 執行；
 *   - 只會套用 `MIGRATIONS` 內尚未套用的項目，重複執行是冪等的；
 *   - 不會刪除、回滾或修改既有資料。
 */
import fs from "node:fs";
import path from "node:path";

function readArg(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : null;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const databasePath = readArg(argv, "--database");
  if (!databasePath) {
    console.error(
      "缺少 --database。這個命令會寫入 schema，必須明確指定目標資料庫，例如：\n" +
        '  npm run db:migrate -- --database "C:\\temp\\copy.db"',
    );
    return 1;
  }
  const resolved = path.resolve(databasePath);

  const { MIGRATIONS, runMigrations } = await import("../src/server/db/migrations");
  const { createDatabase } = await import("../src/server/db/connection");

  const existed = fs.existsSync(resolved);
  console.log(`${existed ? "開啟既有資料庫" : "建立新資料庫"}：${resolved}`);
  const db = createDatabase(resolved);
  try {
    const applied = new Set(
      (
        db.prepare("SELECT id FROM schema_migrations").all() as unknown as { id: string }[]
      ).map((row) => row.id),
    );
    const pending = MIGRATIONS.filter((migration) => !applied.has(migration.id));
    if (pending.length === 0) {
      console.log(`schema 已是最新（${MIGRATIONS.length} 個 migration 全部套用）。`);
      return 0;
    }
    // createDatabase 已套用；這裡列出「本次之前未套用」的項目，令輸出可稽核。
    runMigrations(db);
    console.log(`已套用 ${pending.length} 個 migration：`);
    for (const migration of pending) console.log(`  - ${migration.id}`);
    return 0;
  } finally {
    db.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
