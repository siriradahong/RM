import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";
const dir = await mkdtemp(join(tmpdir(), "rm-drafts-browser-")),
  origin = "http://127.0.0.1:4177";
const app = createApp({
    dataDir: dir,
    origins: origin,
    disableRateLimit: true,
  }),
  db = app.locals.db;
const password = "Test-browser-only-2026!",
  hash = await hashPassword(password),
  work = db.prepare("SELECT id FROM works WHERE unit_id=1 LIMIT 1").get().id;
for (const [username, roles, name] of [
  ["admin", ["admin"], "ผู้ดูแลทดสอบ"],
  ["staff", ["staff"], "เจ้าหน้าที่ทดสอบ"],
])
  db.prepare(
    "INSERT INTO users(username,name,password_hash,unit_id,work_id,roles,scopes) VALUES(?,?,?,1,?,?,?)",
  ).run(username, name, hash, work, JSON.stringify(roles), "[]");
let browser, server;
try {
  server = await new Promise((resolve) => {
    const s = app.listen(4177, "127.0.0.1", () => resolve(s));
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
  async function login(page, name) {
    await page.goto(origin);
    await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(name);
    await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "เข้าสู่ระบบ", exact: true })
      .click();
    await page
      .getByRole("button", { name: "ฟีดข่าวภายใน", exact: true })
      .waitFor();
  }
  await login(p, "admin");
  await p
    .getByRole("tab", { name: "หน่วยงานและหมวดข้อมูล", exact: true })
    .click();
  await p.getByRole("button", { name: "รูปแบบรายงาน", exact: true }).click();
  await p
    .getByRole("button", {
      name: "แก้แม่แบบ แบบทดลอง ประชุมและอบรม",
      exact: true,
    })
    .click();
  await p.getByLabel("ใช้กับฝ่าย", { exact: true }).selectOption("1");
  await p.getByLabel("เปิดใช้แม่แบบนี้", { exact: true }).check();
  await p.getByRole("button", { name: "บันทึกแม่แบบ", exact: true }).click();
  await p
    .getByRole("button", {
      name: "แก้แม่แบบ แบบทดลอง ประชุมและอบรม",
      exact: true,
    })
    .waitFor();
  await p
    .locator(".template-panel")
    .screenshot({ path: "test-results/templates-admin.png" });
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
    }),
    s = await context.newPage();
  s.on("pageerror", (e) => errors.push(e.message));
  s.setDefaultTimeout(10000);
  await login(s, "staff");
  // Enter an original report through the existing one-box intake and confirm source facts.
  await s
    .getByRole("button", { name: "เพิ่มข้อมูล", exact: true })
    .first()
    .click();
  const text = s.locator("textarea").first();
  await text.fill(
    "ประชุมเครือข่าย อสม.\nวันที่ 2 ตุลาคม 2569 ณ ชุมชนตัวอย่าง เจ้าหน้าที่และ อสม. ประชุมร่วมกัน ผู้เข้าร่วม 19 คน",
  );
  await s.getByRole("button", { name: "ส่งรายงาน", exact: true }).click();
  await s
    .getByRole("heading", { name: "ตรวจข้อมูลรายงาน", exact: true })
    .waitFor();
  for (const label of ["วันที่", "ผลการดำเนินงาน", "ตัวเลขและหน่วยนับ"])
    await s
      .getByRole("button", { name: "แก้ไข " + label, exact: true })
      .click();
  await s.getByLabel("วันที่ปฏิบัติงาน", { exact: true }).fill("2026-10-02");
  await s
    .getByLabel("ผลการดำเนินงาน", { exact: true })
    .fill("ประชุมเครือข่าย มีผู้เข้าร่วม 19 คน");
  // Use API to finish only the source fields after exercising the actual intake UI; draft workflow remains UI driven.
  const activityId = Number(s.url().split("/").at(-1));
  await s.evaluate(async (id) => {
    const me = await (await fetch("/api/auth/me")).json();
    const a = await (await fetch("/api/activities/" + id)).json();
    const r = await fetch("/api/activities/" + id, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrf },
      body: JSON.stringify({
        ...a,
        date: "2026-10-02",
        category_id: 1,
        area: "ชุมชนตัวอย่าง",
        workers: "เจ้าหน้าที่และ อสม.",
        result: "ประชุมเครือข่าย มีผู้เข้าร่วม 19 คน",
        metrics: [{ label: "ผู้เข้าร่วม", unit: "คน", value: 19 }],
        status: "ready",
        file_ids: [],
        inbox_ids: [],
      }),
    });
    if (!r.ok) throw Error(await r.text());
  }, activityId);
  await s.goto(origin + "/#reports");
  await s
    .getByRole("button", { name: "สร้างร่างรายงานสรุปผล", exact: true })
    .click();
  await s.getByLabel("วันที่ในช่วงรายงาน").fill("2026-10-02");
  await s
    .getByRole("button", { name: "แสดงรายงานในช่วงนี้", exact: true })
    .click();
  await s.getByText("เลือกอัตโนมัติ 1", { exact: true }).waitFor();
  await s.screenshot({
    path: "test-results/draft-select-desktop.png",
    fullPage: true,
  });
  await s
    .getByRole("button", { name: "ต่อไป: ตรวจร่างรายงาน", exact: true })
    .click();
  await s
    .getByRole("heading", { name: "ตรวจร่างรายงานสรุปผล", exact: true })
    .waitFor();
  await s
    .getByLabel("เนื้อหา ปัญหาและอุปสรรค", { exact: true })
    .fill("ยังไม่มีข้อมูลปัญหาเพิ่มเติม");
  await s.getByRole("button", { name: "ผู้เข้าร่วม", exact: true }).click();
  await s
    .getByLabel("ตรวจข้อความ ตัวเลข ข้อมูลที่ขาด และสิทธิ์ใช้รูปภาพแล้ว")
    .check();
  await s
    .getByRole("button", { name: "ยืนยันฉบับรายงาน", exact: true })
    .click();
  await s
    .getByRole("heading", { name: "ฉบับรายงานที่ยืนยันแล้ว", exact: true })
    .waitFor();
  assert.equal(await s.locator("textarea").count(), 0);
  const download = s.waitForEvent("download");
  await s.getByRole("link", { name: "ส่งออก Word", exact: true }).click();
  assert.match((await download).suggestedFilename(), /\.docx$/);
  await s.screenshot({
    path: "test-results/draft-confirmed-desktop.png",
    fullPage: true,
  });
  await s.setViewportSize({ width: 390, height: 844 });
  await s.waitForFunction(
    () => document.querySelector(".sidebar").getBoundingClientRect().right <= 0,
  );
  await s.evaluate(() => document.fonts.ready);
  assert.equal(
    await s
      .locator(".draft-document table")
      .evaluate((el) => el.getBoundingClientRect().right <= innerWidth),
    true,
  );
  assert.equal(
    await s.evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
  );
  await s.screenshot({
    path: "test-results/draft-confirmed-mobile.png",
    fullPage: true,
  });
  await s.emulateMedia({ media: "print" });
  assert.equal(await s.locator(".sidebar").isVisible(), false);
  await s.pdf({
    path: "test-results/draft-confirmed.pdf",
    format: "A4",
    printBackground: true,
  });
  await s.emulateMedia({ media: "screen" });
  db.prepare("UPDATE activities SET version=version+1,result=? WHERE id=?").run(
    "เปลี่ยนต้นฉบับ",
    activityId,
  );
  await s.reload();
  await s.getByText(/เปลี่ยนหลังจัดทำ/).waitFor();
  await s.getByRole("cell", { name: "19", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    "PASS templates, text intake, readiness, draft editing, confirmation, Word download, preserved totals, desktop/mobile",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  await rm(dir, { recursive: true, force: true });
}
