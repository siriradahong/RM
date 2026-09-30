import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { resolve } from "node:path";

export const ROLES = {
  staff: "เจ้าหน้าที่ปฏิบัติงาน",
  head: "หัวหน้าฝ่าย",
  executive: "ผู้บริหารสำนัก",
  pr: "เจ้าหน้าที่ประชาสัมพันธ์",
  admin: "ผู้ดูแลระบบ",
};
export function openDatabase(dir = process.env.DATA_DIR || "./data") {
  const dataDir = resolve(dir);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  mkdirSync(resolve(dataDir, "uploads"), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(resolve(dataDir, "rm.sqlite"));
  chmodSync(resolve(dataDir, "rm.sqlite"), 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS units(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, parent_id INTEGER REFERENCES units(id), active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS categories(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL, unit_id INTEGER REFERENCES units(id), roles TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, line_user_id TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS login_attempts(key TEXT PRIMARY KEY, failures INTEGER NOT NULL DEFAULT 0, blocked_until INTEGER NOT NULL DEFAULT 0, last_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS activities(id INTEGER PRIMARY KEY, title TEXT NOT NULL, date TEXT, unit_id INTEGER NOT NULL REFERENCES units(id), category_id INTEGER REFERENCES categories(id), area TEXT NOT NULL DEFAULT '', workers TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '', metrics TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL CHECK(status IN ('pending','ready')), source TEXT NOT NULL CHECK(source IN ('web','line')), owner_id INTEGER NOT NULL REFERENCES users(id), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE INDEX IF NOT EXISTS activities_date_unit ON activities(date,unit_id,status);
    CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY, original_name TEXT NOT NULL, storage_name TEXT NOT NULL UNIQUE, mime TEXT NOT NULL, size INTEGER NOT NULL, title TEXT NOT NULL, keywords TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL CHECK(purpose IN ('archive','evidence')), unit_id INTEGER NOT NULL REFERENCES units(id), owner_id INTEGER NOT NULL REFERENCES users(id), activity_id INTEGER REFERENCES activities(id), created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS inbox(id INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, line_user_id TEXT NOT NULL, owner_id INTEGER REFERENCES users(id), group_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', message_id TEXT, file_id INTEGER REFERENCES files(id), activity_id INTEGER REFERENCES activities(id), received_at TEXT NOT NULL, error TEXT);
    CREATE TABLE IF NOT EXISTS news(id INTEGER PRIMARY KEY, activity_id INTEGER NOT NULL REFERENCES activities(id), title TEXT NOT NULL, body TEXT NOT NULL, image_ids TEXT NOT NULL DEFAULT '[]', cover_id INTEGER REFERENCES files(id), status TEXT NOT NULL CHECK(status IN ('draft','published')), author_id INTEGER NOT NULL REFERENCES users(id), published_by INTEGER REFERENCES users(id), published_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), version INTEGER NOT NULL DEFAULT 1, line_status TEXT NOT NULL DEFAULT 'not_sent', line_error TEXT, line_retry_key TEXT, line_sent_at TEXT);
    CREATE TABLE IF NOT EXISTS audits(id INTEGER PRIMARY KEY, actor_id INTEGER REFERENCES users(id), actor_name TEXT NOT NULL, action TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER, before_json TEXT, after_json TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    INSERT OR IGNORE INTO schema_migrations(version) VALUES(1);
  `);
  if (
    !db.prepare("SELECT version FROM schema_migrations WHERE version=2").get()
  ) {
    transaction(db, () => {
      db.exec(`ALTER TABLE news ADD COLUMN activity_date TEXT;
        ALTER TABLE news ADD COLUMN activity_area TEXT;
        ALTER TABLE news ADD COLUMN publication_unit_id INTEGER REFERENCES units(id);
        ALTER TABLE news ADD COLUMN publication_unit_name TEXT;
        INSERT INTO schema_migrations(version) VALUES(2);`);
    });
  }
  if (!db.prepare("SELECT id FROM units LIMIT 1").get()) {
    const insert = db.prepare("INSERT INTO units(name) VALUES(?)");
    [
      "ฝ่ายส่งเสริมสุขภาพ",
      "ฝ่ายป้องกันและควบคุมโรค",
      "ฝ่ายบริการสิ่งแวดล้อม",
    ].forEach((n) => insert.run(n));
    [
      "ประชุมและอบรม",
      "กิจกรรมส่งเสริมสุขภาพ",
      "เยี่ยมบ้าน",
      "ป้องกันและควบคุมโรค",
      "บริการสิ่งแวดล้อม",
    ].forEach((n) =>
      db.prepare("INSERT INTO categories(name) VALUES(?)").run(n),
    );
  }
  return { db, dataDir };
}
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
export function publicUser(row) {
  if (!row) return null;
  const { password_hash, ...user } = row;
  return {
    ...user,
    roles: JSON.parse(row.roles),
    scopes: JSON.parse(row.scopes),
    active: Boolean(row.active),
  };
}
export function writeAudit(db, user, action, entity, id, before, after) {
  db.prepare(
    "INSERT INTO audits(actor_id,actor_name,action,entity,entity_id,before_json,after_json) VALUES(?,?,?,?,?,?,?)",
  ).run(
    user?.id || null,
    user?.name || "ระบบ",
    action,
    entity,
    id || null,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
  );
}
