import Database, { type Database as DB } from 'better-sqlite3';
import migration001 from './migrations/001_init.sql?raw';
import migration002 from './migrations/002_chats.sql?raw';
import migration003 from './migrations/003_agent_metadata.sql?raw';
import migration004 from './migrations/004_agent_tool_perms.sql?raw';
import migration005 from './migrations/005_license.sql?raw';
import migration006 from './migrations/006_audit_log.sql?raw';

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: 1, sql: migration001 },
  { version: 2, sql: migration002 },
  { version: 3, sql: migration003 },
  { version: 4, sql: migration004 },
  { version: 5, sql: migration005 },
  { version: 6, sql: migration006 },
];

const HELPER_PLACEHOLDER = '__WORKSPACE_PLACEHOLDER__';

export function openDatabase(path: string): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);

  const currentRow = db
    .prepare('SELECT MAX(version) AS v FROM schema_version')
    .get() as { v: number | null };
  const current = currentRow.v ?? 0;

  const insertVersion = db.prepare(
    'INSERT INTO schema_version (version, applied_at) VALUES (?, ?)',
  );

  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.transaction(() => {
      db.exec(m.sql);
      insertVersion.run(m.version, Date.now());
    })();
  }

  return db;
}

export function setHelperWorkspace(db: DB, absolutePath: string): void {
  db.prepare(
    "UPDATE agents SET workspace_path = ?, updated_at = ? WHERE id = 'agent-code-helper' AND workspace_path = ?",
  ).run(absolutePath, Date.now(), HELPER_PLACEHOLDER);
}
