import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";
const dir = await mkdtemp(join(tmpdir(), "rm-usability-"));
const origin = "http://127.0.0.1:4178",
  app = createApp({ dataDir: dir, origins: origin, disableRateLimit: true }),
  db = app.locals.db;
const password = "Local-browser-test-2026!",
  work = db.prepare("SELECT id FROM works WHERE unit_id=1 LIMIT 1").get().id;
const user = Number(
  db
    .prepare(
      "INSERT INTO users(username,name,password_hash,unit_id,work_id,roles) VALUES(?,?,?,?,?,?)",
    )
    .run(
      "staff",
      "เจ้าหน้าที่ทดสอบ",
      await hashPassword(password),
      1,
      work,
      '["staff"]',
    ).lastInsertRowid,
);
for (let i = 0; i < 2; i++)
  db.prepare(
    "INSERT INTO activities(title,date,unit_id,work_id,category_id,owner_id,status,source,source_text,area,workers,result,metrics) VALUES('ตัวอย่าง ประชุมเครือข่าย อสม.','2026-10-02',1,?,1,?,'ready','web','ข้อความต้นฉบับประชุม มีผู้เข้าร่วม 19 คน','ชุมชนตัวอย่าง','เจ้าหน้าที่และ อสม.','ประชุมเครือข่าย ผู้เข้าร่วม 19 คน',?)",
  ).run(work, user, '[{"label":"ผู้เข้าร่วม","unit":"คน","value":19}]');
let browser, server;
try {
  server = await new Promise((resolve, reject) => {
    const s = app.listen(4178, "127.0.0.1", () => resolve(s));
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
  const p = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    }),
    errors = [];
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => errors.push(e.message));
  await mkdir("test-results/usability", { recursive: true });
  async function shot(name) {
    await p.screenshot({
      path: `test-results/usability/${name}.png`,
      fullPage: true,
    });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      name,
    );
  }
  await p.goto(origin);
  await p.getByLabel("ชื่อผู้ใช้", { exact: true }).fill("staff");
  await p.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await p.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await p.getByRole("heading", { name: "รายงานของฉัน", exact: true }).waitFor();
  assert.equal(await p.locator(".sidebar nav button").count(), 9);
  assert.equal(
    await p
      .locator(".sidebar nav")
      .getByRole("button", { name: "รายงานจาก LINE", exact: true })
      .count(),
    1,
  );
  await p.getByLabel("วันที่ในรอบรายงาน", { exact: true }).fill("2026-10-18");
  await p.getByLabel("รอบรายงาน", { exact: true }).selectOption("quarter");
  await p
    .locator(".range-label")
    .filter({ hasText: "ไตรมาส 1 ปีงบประมาณ 2570" })
    .waitFor();
  await p.getByLabel("รอบรายงาน", { exact: true }).selectOption("year");
  await p
    .locator(".range-label")
    .filter({ hasText: "ปีงบประมาณ 2570" })
    .waitFor();
  await p.getByLabel("รอบรายงาน", { exact: true }).selectOption("month");
  await p.goto(origin + "/#activity/2");
  await p.locator(".duplicate-review summary").click();
  await p.getByLabel("เลือกรายงานหลักที่ยืนยันแล้ว").selectOption("1");
  await p
    .getByLabel("เหตุผลการตรวจรายการซ้ำ")
    .fill("ตรวจแล้ว เป็นการส่งรายงานกิจกรรมเดียวกันสองครั้ง");
  await p
    .getByRole("button", { name: "ยืนยันว่าซ้ำ ไม่รวมยอด", exact: true })
    .click();
  await p.getByText("รายการซ้ำ · ไม่รวมยอด", { exact: true }).waitFor();
  await p.locator(".toast").waitFor({ state: "hidden" });
  await shot("duplicate-desktop");
  assert.equal(
    db.prepare("SELECT duplicate_of FROM activities WHERE id=2").get()
      .duplicate_of,
    1,
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM activities").get().n, 2);
  await p.goto(origin + "/#dashboard/mine");
  await p.waitForFunction(
    () =>
      document
        .querySelector(".concise-stats .stat strong")
        ?.textContent.replace(/\s+/g, "") === "1กิจกรรม",
  );
  assert.equal(
    await p.locator(".duplicate-review").count(),
    0,
    "review controls must unmount when navigating",
  );
  await shot("dashboard-desktop");
  await p.getByLabel("รอบรายงาน", { exact: true }).selectOption("custom");
  await p.getByLabel("ตั้งแต่", { exact: true }).fill("2026-10-02");
  await p.getByLabel("ถึง", { exact: true }).fill("2026-10-02");
  await p.locator(".trend-list button").first().click();
  await p.getByRole("heading", { name: "คลังข้อมูล", exact: true }).waitFor();
  assert.equal(
    await p.getByLabel("ตั้งแต่", { exact: true }).inputValue(),
    "2026-10-02",
  );
  assert.equal(
    await p.getByLabel("ถึง", { exact: true }).inputValue(),
    "2026-10-02",
  );
  await p.goto(origin + "/#dashboard/mine");
  await p.locator(".metric-grid button").first().waitFor();
  await p.locator(".metric-grid button").first().click();
  await p.getByRole("heading", { name: "คลังข้อมูล", exact: true }).waitFor();
  await p
    .getByRole("button", { name: "ตัวอย่าง ประชุมเครือข่าย อสม.", exact: true })
    .waitFor();
  assert.equal(await p.locator("tbody tr").count(), 1);
  await p.goto(origin + "/#dashboard/mine");
  await p.locator(".concise-stats .stat").first().waitFor();
  await p.locator(".concise-stats .stat").first().click();
  await p.getByRole("heading", { name: "คลังข้อมูล", exact: true }).waitFor();
  await p
    .getByRole("button", { name: "ตัวอย่าง ประชุมเครือข่าย อสม.", exact: true })
    .waitFor();
  assert.equal(await p.locator("tbody tr").count(), 1);
  await shot("library-desktop");
  await p.goto(origin + "/#dashboard/mine");
  await p.getByRole("button", { name: "ปฏิทินกิจกรรม", exact: true }).click();
  await p.getByLabel("เดือนในปฏิทิน").fill("2026-10");
  await p.locator(".calendar-day.has-events").waitFor();
  await shot("calendar-desktop");
  await p.setViewportSize({ width: 390, height: 844 });
  await shot("calendar-mobile");
  await p.getByRole("button", { name: "สรุปผลงาน", exact: true }).click();
  await p.locator(".concise-stats .stat").first().waitFor();
  await shot("dashboard-mobile");
  await p.goto(origin + "/#import");
  await p
    .getByLabel("ข้อความรายงาน")
    .fill("ตัวอย่างรายงานข้อความเดียวพร้อมแนบเอกสาร");
  await shot("intake-mobile");
  await p.getByLabel("เก็บไว้ค้นหาเท่านั้น — ไม่รวมในสรุปผลงาน").check();
  assert.equal(
    await p.getByLabel("ข้อความรายงาน").inputValue(),
    "ตัวอย่างรายงานข้อความเดียวพร้อมแนบเอกสาร",
  );
  assert.equal(await p.getByLabel("ข้อความรายงาน").isEnabled(), true);
  await p.getByRole("button", { name: "รับจาก LINE", exact: true }).click();
  await p
    .getByRole("heading", { name: "รายงานจาก LINE", exact: true })
    .waitFor();
  assert.ok(
    await p
      .getByText("ยังไม่ได้เชื่อมต่อกลุ่มรับรายงาน", { exact: false })
      .count(),
  );
  await p.goto(origin + "/#import");
  await p.setViewportSize({ width: 1440, height: 1000 });
  await shot("intake-desktop");
  await p.goto(origin + "/#activity/1");
  await p
    .getByRole("heading", { name: "ตรวจข้อมูลรายงาน", exact: true })
    .waitFor();
  await shot("review-desktop");
  await p.setViewportSize({ width: 768, height: 1024 });
  await shot("review-tablet");
  await p.setViewportSize({ width: 390, height: 844 });
  await shot("review-mobile");
  await p.reload();
  await p
    .getByRole("heading", { name: "ตรวจข้อมูลรายงาน", exact: true })
    .waitFor();
  assert.ok(
    await p
      .getByText("ประชุมเครือข่าย ผู้เข้าร่วม 19 คน", { exact: true })
      .count(),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: consolidated navigation, fiscal dashboard, duplicate confirmation and drill-down, real calendar, archive text, LINE status, persistence and desktop/tablet/mobile captures",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  db.close();
  await rm(dir, { recursive: true, force: true });
}
