import { createInterface } from "node:readline/promises";
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
import { openDatabase, writeAudit, publicUser } from "../server/db.js";
import { hashPassword } from "../server/security.js";
const { db } = openDatabase();
try {
  let username = process.env.ADMIN_USERNAME,
    name = process.env.ADMIN_NAME;
  if (!username) {
    const input = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    username = await input.question("ชื่อผู้ใช้แอดมิน (a-z, 0-9, . _ -): ");
    name = await input.question("ชื่อ–นามสกุล: ");
    input.close();
  }
  if (!/^[a-zA-Z0-9._-]{3,60}$/.test(username) || !name?.trim())
    throw Error("ชื่อผู้ใช้หรือชื่อ–นามสกุลไม่ถูกต้อง");
  const password =
    process.env.ADMIN_PASSWORD || randomBytes(18).toString("base64url");
  if (password.length < 12 || password.length > 128)
    throw Error("รหัสผ่านต้องยาว 12–128 ตัวอักษร");
  if (!process.env.ADMIN_PASSWORD && existsSync(".first-admin.txt"))
    throw Error(
      "ไฟล์ .first-admin.txt มีอยู่แล้ว กรุณาเก็บไฟล์เดิมให้ปลอดภัยก่อนสร้างบัญชีใหม่",
    );
  const hash = await hashPassword(password);
  const id = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,password_hash,roles,scopes) VALUES(?,?,?,'[\"admin\"]','[]')",
      )
      .run(username, name.trim(), hash).lastInsertRowid,
  );
  writeAudit(
    db,
    null,
    "สร้างผู้ดูแลระบบผ่าน CLI",
    "user",
    id,
    null,
    publicUser(db.prepare("SELECT * FROM users WHERE id=?").get(id)),
  );
  if (!process.env.ADMIN_PASSWORD) {
    writeFileSync(
      ".first-admin.txt",
      `บัญชีผู้ดูแลระบบ\nชื่อผู้ใช้: ${username}\nรหัสผ่าน: ${password}\n\nเปลี่ยนรหัสผ่านหลังเข้าสู่ระบบ และลบไฟล์นี้เมื่อบันทึกไว้ปลอดภัยแล้ว\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.log(
      "สร้างบัญชีแล้ว ข้อมูลเข้าสู่ระบบอยู่ใน .first-admin.txt (ไฟล์ส่วนตัว ไม่ขึ้น GitHub)",
    );
  } else console.log("สร้างบัญชีผู้ดูแลระบบแล้ว");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  db.close();
}
