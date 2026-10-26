import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";
const dir = await mkdtemp(join(tmpdir(), "rm-primary-ui-")),
  origin = "http://127.0.0.1:4182",
  app = createApp({ dataDir: dir, origins: origin, disableRateLimit: true }),
  db = app.locals.db,
  password = "Primary-ui-password-2026!",
  hash = await hashPassword(password),
  works = {};
for (const u of [1, 2])
  works[u] = db
    .prepare("SELECT id FROM works WHERE unit_id=? LIMIT 1")
    .get(u).id;
for (const [name, roles] of [
  ["admin", ["admin"]],
  ["legacy", ["staff", "pr"]],
])
  db.prepare(
    "INSERT INTO users(username,name,password_hash,roles,unit_id,work_id) VALUES(?,?,?,?,?,?)",
  ).run(
    name,
    "ผู้ใช้ทดสอบ " + name,
    hash,
    JSON.stringify(roles),
    name === "admin" ? null : 1,
    name === "admin" ? null : works[1],
  );
const legacy = db.prepare("SELECT * FROM users WHERE username='legacy'").get();
let browser, server;
const errors = [];
try {
  server = await new Promise((resolve, reject) => {
    const s = app.listen(4182, "127.0.0.1", () => resolve(s));
    s.on("error", reject);
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROME_PATH
      ? { executablePath: process.env.CHROME_PATH }
      : process.platform === "darwin"
        ? {
            executablePath:
              "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          }
        : {}),
  });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    }),
    p = await context.newPage();
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => errors.push(e.message));
  await mkdir("test-results/single-role", { recursive: true });
  async function login(name) {
    await p.goto(origin);
    await p.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(name);
    await p.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
    await p.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  }
  const shot = async (name) => {
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      name + " overflow",
    );
    await p.screenshot({
      path: "test-results/single-role/" + name + ".png",
      fullPage: true,
    });
  };
  await login("legacy");
  await p
    .getByRole("heading", { name: "รอกำหนดตำแหน่งหลัก", exact: true })
    .waitFor();
  await shot("legacy-review");
  await p.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
  await login("admin");
  await p
    .getByRole("heading", { name: "บัญชีผู้ใช้งาน", exact: true })
    .waitFor();
  await p
    .getByRole("row")
    .filter({ hasText: "ผู้ใช้ทดสอบ legacy" })
    .getByRole("button", { name: "แก้ไข", exact: true })
    .click();
  let dlg = p.getByRole("dialog");
  const role = dlg.getByLabel("ตำแหน่ง/บทบาทหลัก *", { exact: true });
  assert.equal(await role.inputValue(), "");
  assert.equal(await role.getAttribute("multiple"), null);
  assert.equal(await dlg.getByRole("checkbox").count(), 1);
  await role.selectOption("head");
  await dlg.getByLabel("ฝ่ายที่รับผิดชอบ *", { exact: true }).selectOption("2");
  assert.equal(
    await dlg.getByLabel("งานที่รับผิดชอบ *", { exact: true }).count(),
    0,
  );
  await shot("head-single-division-desktop");
  await role.selectOption("center_head");
  assert.equal(
    await dlg.getByLabel("ฝ่าย/กลุ่มงาน", { exact: true }).inputValue(),
    "",
  );
  await dlg.getByLabel("ฝ่าย/กลุ่มงาน", { exact: true }).selectOption("1");
  await dlg
    .getByLabel("งาน/ศูนย์ที่รับผิดชอบ *", { exact: true })
    .selectOption(String(works[1]));
  await dlg.getByLabel("ฝ่าย/กลุ่มงาน", { exact: true }).selectOption("2");
  assert.equal(
    await dlg
      .getByLabel("งาน/ศูนย์ที่รับผิดชอบ *", { exact: true })
      .inputValue(),
    "",
  );
  assert.equal(
    await dlg
      .getByLabel("งาน/ศูนย์ที่รับผิดชอบ *", { exact: true })
      .locator('option[value="' + works[1] + '"]')
      .count(),
    0,
  );
  await dlg
    .getByLabel("งาน/ศูนย์ที่รับผิดชอบ *", { exact: true })
    .selectOption(String(works[2]));
  await p.setViewportSize({ width: 390, height: 844 });
  await shot("center-single-work-mobile");
  await role.selectOption("executive");
  assert.equal(
    await dlg.getByLabel("ฝ่าย/กลุ่มงาน", { exact: true }).count(),
    0,
  );
  assert.equal(
    await dlg.getByLabel("งาน/ศูนย์ที่รับผิดชอบ *", { exact: true }).count(),
    0,
  );
  await role.selectOption("pr");
  await dlg.getByLabel("ฝ่าย/กลุ่มงาน", { exact: true }).selectOption("1");
  await dlg
    .getByLabel("งานที่รับผิดชอบ *", { exact: true })
    .selectOption(String(works[1]));
  await shot("pr-single-role-mobile");
  await dlg.getByRole("button", { name: "บันทึกบัญชี", exact: true }).click();
  await dlg.waitFor({ state: "hidden" });
  const saved = db.prepare("SELECT * FROM users WHERE id=?").get(legacy.id);
  assert.deepEqual(JSON.parse(saved.roles), ["pr"]);
  assert.deepEqual(JSON.parse(saved.scopes), []);
  assert.deepEqual(JSON.parse(saved.work_scopes), []);
  assert.equal(saved.unit_id, 1);
  assert.equal(saved.work_id, works[1]);
  await context.clearCookies();
  await p.setViewportSize({ width: 1440, height: 1000 });
  await login("legacy");
  await p
    .getByRole("heading", { name: "จัดการข่าวประชาสัมพันธ์", exact: true })
    .waitFor();
  await p
    .locator(".sidebar nav")
    .getByRole("button", { name: "เขียนรายงาน", exact: true })
    .click();
  await p.getByLabel("ข้อความรายงาน").waitFor();
  await p
    .getByText("รายงานในฐานะ: เจ้าหน้าที่ประชาสัมพันธ์", { exact: false })
    .waitFor();
  await shot("pr-can-report-desktop");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: single-role dropdown, one division/work, dependent resets, legacy admin review and PR reporting; desktop/mobile",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  db.close();
  await rm(dir, { recursive: true, force: true });
}
