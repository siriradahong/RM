import { backup } from "node:sqlite";
import { mkdir, cp } from "node:fs/promises";
import { resolve } from "node:path";
import { openDatabase } from "../server/db.js";
const { db, dataDir } = openDatabase();
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
