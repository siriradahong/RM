import { backup, DatabaseSync } from "node:sqlite";
import { mkdir, cp } from "node:fs/promises";
import { resolve } from "node:path";
// A backup must capture the current schema before any pending migration runs.
const dataDir = resolve(process.env.DATA_DIR || "./data");
const db = new DatabaseSync(resolve(dataDir, "rm.sqlite"), { readOnly: true });
const destination = resolve(
  "backups",
  new Date().toISOString().replaceAll(":", "-"),
);
try {
  await mkdir(destination, { recursive: true, mode: 0o700 });
  await backup(db, resolve(destination, "rm.sqlite"));
  await cp(resolve(dataDir, "uploads"), resolve(destination, "uploads"), {
    recursive: true,
  });
  console.log(`สำรองฐานข้อมูลและไฟล์แนบแล้ว: ${destination}`);
} finally {
  db.close();
}
