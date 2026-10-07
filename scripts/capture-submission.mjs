// Capture real UI flows against a disposable database; never modifies local user data.
import { chromium } from "@playwright/test";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { seedDemo } from "./seed-demo.mjs";
import { createApp } from "../server/app.js";
const output = resolve("docs/submission/screenshots");
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(join(tmpdir(), "rm-submission-"));
const origin = "http://127.0.0.1:4186";
// This capture must never communicate with LINE, even if run from a configured environment.
for (const key of [
  "LINE_CHANNEL_SECRET",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_REPORT_GROUP_ID",
  "LINE_NEWS_GROUP_ID",
])
  delete process.env[key];
let app, server, browser;
const captures = [],
  errors = [];
try {
  const seeded = await seedDemo({
    dataDir,
    today: "2026-10-04",
    backupExisting: false,
  });
  const privateText = await readFile(seeded.accountsPath, "utf8");
  const password = privateText.match(/รหัสผ่านร่วม[^`]+`([^`]+)`/)[1];
  app = createApp({ dataDir, origins: origin, disableRateLimit: true });
  server = await new Promise((resolve) => {
    const s = app.listen(4186, "127.0.0.1", () => resolve(s));
  });
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.CHROME_PATH ||
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  const context = async () =>
    browser.newContext({
      viewport: { width: 1440, height: 960 },
      reducedMotion: "reduce",
    });
  async function login(username) {
    const ctx = await context();
    const p = await ctx.newPage();
    p.setDefaultTimeout(15000);
    p.on("pageerror", (e) => {
      errors.push(e.message);
      console.error("BROWSER", e.message);
    });
    await p.goto(origin);
    await p.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(username);
    await p.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
    await p.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
    await p.locator(".demo-notice").waitFor();
    return p;
  }
  async function route(p, hash) {
    await p.goto(origin + "/#" + hash);
    await p.reload();
    await p.waitForLoadState("networkidle");
  }
  async function capture(p, id, title, screen, flow) {
    await p.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    await p.waitForFunction(() => !document.querySelector(".loading"));
    await p.waitForLoadState("networkidle");
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: join(output, id + ".png"), fullPage: false });
    captures.push({
      id,
      title,
      screen,
      flow,
      route: new URL(p.url()).hash,
      viewport: p.viewportSize(),
    });
  }
  const anon = await (await context()).newPage();
  await anon.goto(origin);
  await capture(anon, "01-login", "เข้าสู่ระบบ", "S01", "ร่วมทุก Flow");
  const staff = await login("demo.staff.health-promotion");
  await route(staff, "import");
  await staff.getByRole("button", { name: /อัปโหลดไฟล์/ }).click();
  await staff
    .locator("input[type=file]")
    .setInputFiles([
      resolve("scripts/demo-assets/health-report.pdf"),
      resolve("scripts/demo-assets/health-outreach.png"),
    ]);
  await capture(
    staff,
    "06a-import-files",
    "เลือกไฟล์หลักฐานสองไฟล์",
    "S06",
    "A",
  );
  await staff.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await capture(
    staff,
    "06b-import-purpose",
    "เลือกวัตถุประสงค์การนำเข้า",
    "S06",
    "A",
  );
  await staff
    .getByRole("button", { name: /จัดข้อมูลเพื่อนำไปสรุปผลงาน/ })
    .click();
  await staff.getByRole("button", { name: "ถัดไป", exact: true }).click();
  const title = "[สาธิตส่งงาน] กิจกรรมขยับกายและเรียนรู้การดูแลสุขภาพ";
  await staff.getByLabel("ชื่อเรื่อง *", { exact: true }).fill(title);
  await capture(
    staff,
    "06c-import-review",
    "ชื่อเรื่องและสังกัดก่อนนำเข้า",
    "S06",
    "A",
  );
  await staff
    .getByRole("button", { name: "จัดเก็บและตรวจข้อมูล", exact: true })
    .click();
  await staff
    .getByRole("heading", { name: "สร้างรายการงาน", exact: true })
    .waitFor();
  assert.equal(
    await staff.getByLabel("ชื่อเรื่อง *", { exact: true }).inputValue(),
    title,
  );
  await staff
    .getByLabel("วันที่ปฏิบัติงาน", { exact: true })
    .fill("2026-10-02");
  await staff
    .getByLabel("ประเภทงาน", { exact: true })
    .selectOption({ label: "กิจกรรมส่งเสริมสุขภาพ" });
  await staff
    .getByLabel("พื้นที่", { exact: true })
    .fill("ศูนย์กิจกรรมชุมชนสาธิต A");
  await staff
    .getByLabel("ผู้ปฏิบัติงานตามข้อมูลต้นทาง", { exact: true })
    .fill("ทีมเจ้าหน้าที่สาธิตสุขภาพและอาสาสมัครสาธิต");
  await staff
    .getByLabel("ผลการดำเนินงาน", { exact: true })
    .fill(
      "ข้อมูลสมมติสำหรับทดสอบ: ผู้ร่วมกิจกรรม 120 คน อาสาสมัคร 15 คน จุดกิจกรรม 3 แห่ง ตามหลักฐานตัวอย่าง",
    );
  for (const [i, label, value, unit] of [
    [1, "ผู้เข้าร่วมกิจกรรม", 120, "คน"],
    [2, "อาสาสมัคร", 15, "คน"],
    [3, "จุดจัดกิจกรรม", 3, "แห่ง"],
  ]) {
    await staff.getByRole("button", { name: "เพิ่มผล", exact: true }).click();
    await staff.getByLabel("ชื่อผล " + i, { exact: true }).fill(label);
    await staff.getByLabel("จำนวน " + i, { exact: true }).fill(String(value));
    await staff.getByLabel("หน่วยนับ " + i, { exact: true }).selectOption(unit);
  }
  await staff
    .getByLabel("สถานะข้อมูล", { exact: true })
    .selectOption("pending");
  await capture(staff, "07a-report-edit", "ตรวจข้อมูลและหลักฐาน", "S07", "A");
  await staff
    .getByRole("button", { name: "บันทึกข้อมูล", exact: true })
    .click();
  await staff
    .getByRole("heading", { name: "ข้อมูลที่ฉันนำเข้า", exact: true })
    .waitFor();
  const report = app.locals.db
    .prepare("SELECT * FROM activities WHERE title=?")
    .get(title);
  assert.ok(report);
  const head = await login("demo.head");
  await route(head, "activity/" + report.id);
  await head.getByLabel("สถานะข้อมูล", { exact: true }).selectOption("ready");
  await head.getByRole("button", { name: "บันทึกข้อมูล", exact: true }).click();
  await head
    .getByRole("heading", { name: "ข้อมูลที่ฉันนำเข้า", exact: true })
    .waitFor();
  assert.equal(
    app.locals.db
      .prepare("SELECT status FROM activities WHERE id=?")
      .get(report.id).status,
    "ready",
  );
  await route(staff, "dashboard/mine");
  await capture(
    staff,
    "02-dashboard-mine",
    "ข้อมูลที่ฉันนำเข้า หลังบันทึกและตรวจข้อมูล",
    "S02",
    "A",
  );
  await route(head, "dashboard/unit");
  await head.getByLabel("หน่วยงาน", { exact: true }).selectOption("1");
  await capture(
    head,
    "03-dashboard-unit",
    "แดชบอร์ดฝ่ายส่งเสริมสุขภาพ",
    "S03",
    "B",
  );
  await head.locator("button.stat").first().click();
  await capture(head, "05a-library", "รายการที่มาของยอดสรุป", "S05", "B");
  await head.getByRole("button", { name: title, exact: true }).click();
  await capture(
    head,
    "07b-report-ready",
    "รายงานพร้อมสรุปและหลักฐานเดียวกัน",
    "S07",
    "B",
  );
  const executive = await login("demo.executive");
  await route(executive, "dashboard/overview");
  await executive.getByLabel("ตั้งแต่").fill("2026-09-01");
  await capture(
    executive,
    "04-dashboard-overview",
    "ภาพรวมสำนัก แยกกิจกรรมและหน่วยนับ",
    "S04",
    "B",
  );
  await route(executive, "activity/" + report.id);
  assert.equal(
    await executive
      .getByRole("button", { name: "บันทึกข้อมูล", exact: true })
      .count(),
    0,
  );
  await capture(
    executive,
    "07c-report-readonly",
    "ผู้บริหารอ่านรายงานเดียวกัน",
    "S07",
    "B",
  );
  await route(executive, "library");
  await executive
    .getByRole("tab", { name: "ไฟล์และเอกสาร", exact: true })
    .click();
  await capture(executive, "05b-files", "คลังไฟล์และเอกสาร", "S05", "A/B");
  const pr = await login("demo.pr");
  await capture(
    pr,
    "09-news-manager",
    "เลือกรายงานต้นทางเพื่อจัดทำข่าว",
    "S09",
    "C",
  );
  // Select the source through the visible source list, paging if needed.
  for (
    let attempt = 0;
    attempt < 4 &&
    !(await pr.getByRole("heading", { name: title, exact: true }).count());
    attempt++
  ) {
    const next = pr.getByRole("button", { name: "ถัดไป", exact: true });
    if (await next.isDisabled()) break;
    await next.click();
    await pr.waitForLoadState("networkidle");
  }
  await pr
    .locator("article")
    .filter({ hasText: title })
    .getByRole("button", { name: "จัดทำข่าว", exact: true })
    .click();
  await pr
    .getByLabel("เนื้อหาข่าว *", { exact: true })
    .fill(
      "ข้อมูลสมมติสำหรับส่งงานเท่านั้น: กิจกรรมวันที่ 2 ตุลาคม 2569 ณ ศูนย์กิจกรรมชุมชนสาธิต A มีผู้ร่วมกิจกรรม 120 คน อาสาสมัคร 15 คน และจุดจัดกิจกรรม 3 แห่ง ข่าวนี้จัดทำจากรายงานและหลักฐานเดียวกัน โดยไม่ได้ส่งออกไปยัง LINE",
    );
  await pr.locator(".image-picker input[type=checkbox]").first().check();
  const imageId = app.locals.db
    .prepare("SELECT id FROM files WHERE activity_id=? AND mime='image/png'")
    .get(report.id).id;
  await pr.getByLabel("รูปปก", { exact: true }).selectOption(String(imageId));
  await capture(
    pr,
    "10a-news-edit",
    "ตรวจแก้ข่าวและเลือกภาพจากหลักฐาน",
    "S10",
    "C",
  );
  await pr.getByRole("button", { name: "บันทึกฉบับร่าง", exact: true }).click();
  await pr.waitForLoadState("networkidle");
  await pr
    .getByRole("button", { name: "Preview ก่อนเผยแพร่", exact: true })
    .click();
  await capture(pr, "10b-news-preview", "ดูข่าวก่อนยืนยันเผยแพร่", "S10", "C");
  await pr.getByRole("button", { name: "ยืนยันเผยแพร่", exact: true }).click();
  await pr
    .getByRole("heading", { name: "ข่าวที่เผยแพร่แล้ว", exact: true })
    .waitFor();
  await capture(
    pr,
    "10c-news-published",
    "สถานะเว็บและ LINE แยกกัน",
    "S10",
    "C",
  );
  const news = app.locals.db
    .prepare("SELECT * FROM news WHERE activity_id=?")
    .get(report.id);
  assert.equal(news.status, "published");
  assert.equal(news.line_status, "not_sent");
  await route(executive, "feed");
  await capture(
    executive,
    "08-feed",
    "ข่าวเดียวกันปรากฏบนฟีดภายใน",
    "S08",
    "C",
  );
  const admin = await login("demo.admin");
  await capture(admin, "11a-admin-users", "ผู้ใช้งานและสิทธิ์", "S11", "D");
  await admin
    .getByRole("row")
    .filter({ hasText: "demo.staff.health-promotion" })
    .getByRole("button", { name: "แก้ไข", exact: true })
    .click();
  await admin
    .getByLabel("ชื่อ–นามสกุล *", { exact: true })
    .fill("[สาธิตส่งงาน] เจ้าหน้าที่สุขภาพ");
  await capture(admin, "11d-admin-edit", "กำหนดฝ่ายและงานตามบทบาท", "S11", "D");
  await admin.getByRole("button", { name: "บันทึกบัญชี", exact: true }).click();
  await admin.getByRole("dialog").waitFor({ state: "hidden" });
  await route(admin, "admin/master");
  await admin
    .locator("summary")
    .filter({ hasText: "ฝ่ายบริการสาธารณสุข" })
    .click();
  await capture(
    admin,
    "11b-admin-master",
    "ส่วน ฝ่าย และงานในสังกัด",
    "S11",
    "D",
  );
  await route(admin, "admin/line");
  await capture(
    admin,
    "11c-admin-line",
    "สถานะ LINE ที่ยังไม่ได้เชื่อมบริการจริง",
    "S11",
    "ข้อจำกัด",
  );
  await route(admin, "audit");
  await admin.getByLabel("ประเภทรายการ", { exact: true }).selectOption("user");
  await capture(
    admin,
    "12a-audit-list",
    "ค้นหาและกรองประวัติการแก้ไข",
    "S12",
    "D",
  );
  await admin
    .getByRole("button", { name: "ดูรายละเอียด", exact: true })
    .first()
    .click();
  await capture(
    admin,
    "12b-audit-diff",
    "ค่าเดิมและค่าใหม่หลังแก้บัญชี",
    "S12",
    "D",
  );
  await executive.setViewportSize({ width: 390, height: 844 });
  await route(executive, "dashboard/overview");
  assert.equal(
    await executive.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await capture(
    executive,
    "M01-mobile-dashboard",
    "แดชบอร์ดบนมือถือ",
    "S04",
    "B",
  );
  await admin.setViewportSize({ width: 390, height: 844 });
  await capture(
    admin,
    "M02-mobile-audit",
    "ค่าเดิมและค่าใหม่บนมือถือ",
    "S12",
    "D",
  );
  await route(head, "inbox");
  await capture(
    head,
    "L01-line-simulation",
    "ข้อความ LINE จำลองสำหรับจัดรายงาน",
    "ส่วนเสริม",
    "ข้อจำกัด",
  );
  assert.equal(
    app.locals.db
      .prepare("SELECT COUNT(*) n FROM files WHERE activity_id=?")
      .get(report.id).n,
    2,
  );
  assert.deepEqual(errors, []);
  const manifest = {
    date: "2026-10-04",
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    isolatedDatabase: true,
    noExternalMessages: true,
    activity: {
      id: report.id,
      title,
      date: report.date,
      unit_id: report.unit_id,
      files: 2,
      status: "ready",
      metrics: JSON.parse(report.metrics),
    },
    news: {
      id: news.id,
      activity_id: news.activity_id,
      status: news.status,
      line_status: news.line_status,
    },
    checks: [
      "Flow A: upload 2 files, title carry, save pending",
      "Head: update pending to ready",
      "Flow B: dashboard to list to evidence",
      "Executive: read-only report",
      "Flow C: source to draft to preview to internal publication",
      "Flow D: edit user and inspect audit",
      "Mobile: no horizontal page overflow",
    ],
    captures,
  };
  await writeFile(
    resolve("docs/submission/capture-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      screenshots: captures.length,
      activityId: report.id,
      newsId: news.id,
      checks: manifest.checks,
    }),
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  app?.locals.db.close();
  await rm(dataDir, { recursive: true, force: true });
}
