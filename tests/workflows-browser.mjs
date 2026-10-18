import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";
const dir = await mkdtemp(join(tmpdir(), "rm-workflows-browser-"));
const origin = "http://127.0.0.1:4176";
const app = createApp({
  dataDir: dir,
  origins: origin,
  disableRateLimit: true,
});
const db = app.locals.db,
  password = "Browser-test-only-2026!";
const work = db
  .prepare("SELECT id FROM works WHERE unit_id=1 LIMIT 1")
  .get().id;
const hash = await hashPassword(password);
for (const [name, display, roles, scopes] of [
  ["head", "หัวหน้าฝ่ายทดสอบ", ["head"], [1]],
  ["staff", "เจ้าหน้าที่ทดสอบ", ["staff"], []],
])
  db.prepare(
    "INSERT INTO users(username,name,password_hash,unit_id,work_id,roles,scopes) VALUES(?,?,?,1,?,?,?)",
  ).run(
    name,
    display,
    hash,
    work,
    JSON.stringify(roles),
    JSON.stringify(scopes),
  );
const owner = db
  .prepare("SELECT id FROM users WHERE username='staff'")
  .get().id;
db.prepare(
  "INSERT INTO activities(title,date,unit_id,work_id,category_id,area,workers,result,metrics,status,source,owner_id) VALUES('ติดตามผู้รับบริการในชุมชน','2026-10-02',1,?,1,'ชุมชนตัวอย่าง','เจ้าหน้าที่และ อสม.','ผู้รับบริการ 19 ราย รับบริการรวม 29 ครั้งบริการ',?,'ready','web',?)",
).run(
  work,
  JSON.stringify([
    { label: "ผู้รับบริการ", value: 19, unit: "ราย" },
    { label: "รับบริการ", value: 29, unit: "ครั้งบริการ" },
  ]),
  owner,
);
let browser, server;
try {
  server = await new Promise((resolve) => {
    const s = app.listen(4176, "127.0.0.1", () => resolve(s));
  });
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const p = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
    errors = [];
  p.on("pageerror", (e) => errors.push(e.message));
  p.setDefaultTimeout(10000);
  await mkdir("test-results", { recursive: true });
  async function login(page, username) {
    await page.goto(origin);
    await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
    await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "เข้าสู่ระบบ", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name: username === "head" ? "แดชบอร์ดหน่วยงาน" : "รายงานของฉัน",
        exact: true,
      })
      .waitFor();
  }
  await login(p, "head");
  await p.getByRole("button", { name: "ติดตามโครงการ", exact: true }).click();
  await p.getByRole("button", { name: "สร้างโครงการเอง", exact: true }).click();
  await p
    .getByLabel("ชื่อโครงการ", { exact: true })
    .fill("ติดตามสุขภาพชุมชน เดือนตุลาคม");
  await p.getByLabel("วันสิ้นสุดโครงการ").fill("2026-10-31");
  await p
    .getByLabel("รายละเอียดโครงการ")
    .fill("มอบหมายลงพื้นที่และนำรายงานที่ยืนยันแล้วมาตรวจรับ");
  await p.getByRole("button", { name: "บันทึกโครงการ", exact: true }).click();
  await p.getByRole("button", { name: "กำหนดเป้าหมาย", exact: true }).click();
  await p.getByLabel("ตัวชี้วัดตามเอกสาร").fill("ผู้รับบริการ");
  await p.getByLabel("เป้าหมาย", { exact: true }).fill("38");
  await p.getByLabel("หน่วยนับ", { exact: true }).selectOption("ราย");
  await p
    .getByLabel("เอกสารอ้างอิงและหน้าที่ระบุเป้าหมาย")
    .fill("แผนทดสอบ หน้า 1");
  await p.getByLabel("ตรวจค่าเป้าหมายกับเอกสารต้นทางแล้ว").check();
  await p
    .getByRole("button", { name: "บันทึกเป้าหมายที่ตรวจแล้ว", exact: true })
    .click();
  await p.getByRole("button", { name: "แก้เป้าหมาย", exact: true }).waitFor();
  await p.getByRole("button", { name: "มอบหมายงาน", exact: true }).click();
  await p.getByLabel("ชื่องานมอบหมาย").fill("ลงพื้นที่ติดตามผู้รับบริการ");
  await p
    .getByLabel("ผู้รับผิดชอบ", { exact: true })
    .selectOption(String(owner));
  await p.getByLabel("กำหนดส่ง", { exact: true }).fill("2026-10-20");
  await p
    .getByRole("button", { name: "บันทึกงานมอบหมาย", exact: true })
    .click();
  await p
    .getByRole("heading", { name: "ลงพื้นที่ติดตามผู้รับบริการ", exact: true })
    .waitFor();
  await p.screenshot({
    path: "test-results/projects-head-desktop.png",
    fullPage: true,
  });
  const c = await browser.newContext({ viewport: { width: 390, height: 844 } }),
    staff = await c.newPage();
  staff.on("pageerror", (e) => errors.push(e.message));
  await login(staff, "staff");
  await staff.goto(origin + "/#projects");
  await staff.getByRole("button", { name: "เริ่มงาน", exact: true }).click();
  await staff
    .getByRole("button", { name: "ส่งรายงานให้หัวหน้า", exact: true })
    .click();
  await staff.getByLabel("รายงานที่ยืนยันแล้ว").selectOption("1");
  await staff
    .getByRole("button", { name: "ยืนยันส่งรายงาน", exact: true })
    .click();
  await staff.getByText("รอหัวหน้าตรวจรับ", { exact: true }).waitFor();
  assert.equal(
    await staff.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await staff.screenshot({
    path: "test-results/projects-staff-mobile.png",
    fullPage: true,
  });
  await p.reload();
  await p.getByText("50.0% ของเป้าหมาย", { exact: true }).waitFor();
  await p.getByRole("button", { name: "ตรวจรับงาน", exact: true }).click();
  await p
    .getByLabel("สถานะโครงการ ติดตามสุขภาพชุมชน เดือนตุลาคม")
    .selectOption("completed");
  await p.getByRole("button", { name: "รายงานสรุป", exact: true }).click();
  await p.getByLabel("วันที่ในรอบรายงาน").fill("2026-10-17");
  await p.getByRole("heading", { name: "ตุลาคม 2569", exact: true }).waitFor();
  await p.getByText("29", { exact: true }).waitFor();
  const downloadPromise = p.waitForEvent("download");
  await p.getByRole("link", { name: "ดาวน์โหลด CSV" }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /2026-10-01-2026-10-31.csv/);
  await p.screenshot({
    path: "test-results/reports-desktop.png",
    fullPage: true,
  });
  await p.emulateMedia({ media: "print" });
  assert.equal(await p.locator(".sidebar").isVisible(), false);
  await p.screenshot({
    path: "test-results/reports-print.png",
    fullPage: true,
  });
  await p.emulateMedia({ media: "screen" });
  await p.getByLabel("รอบรายงาน", { exact: true }).selectOption("quarter");
  await p
    .getByRole("heading", { name: "ไตรมาส 1 ปีงบประมาณ 2570", exact: true })
    .waitFor();
  await p.getByLabel("รอบรายงาน", { exact: true }).selectOption("year");
  await p
    .getByRole("heading", { name: "ปีงบประมาณ 2570", exact: true })
    .waitFor();
  await staff.goto(origin + "/#reports");
  await staff.getByLabel("วันที่ในรอบรายงาน").fill("2026-10-17");
  await staff
    .getByRole("heading", { name: "ตุลาคม 2569", exact: true })
    .waitFor();
  assert.equal(
    await staff.getByLabel("ขอบเขตข้อมูล").locator("option").count(),
    1,
  );
  assert.equal(
    await staff.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await staff.screenshot({
    path: "test-results/reports-mobile.png",
    fullPage: true,
  });
  await staff
    .getByRole("button", { name: "ติดตามผู้รับบริการในชุมชน", exact: true })
    .click();
  await staff
    .getByRole("heading", { name: "ตรวจข้อมูลรายงาน", exact: true })
    .waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS: head assignment, staff submission, acceptance, closure, fiscal reports, CSV, print layout, mobile and source drill-down",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  await rm(dir, { recursive: true, force: true });
}
