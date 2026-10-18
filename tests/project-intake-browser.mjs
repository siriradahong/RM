import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";
import { makeTextDocx } from "../server/report-docx.js";
const dir = await mkdtemp(join(tmpdir(), "rm-intake-browser-")),
  origin = "http://127.0.0.1:4180",
  app = createApp({ dataDir: dir, origins: origin, disableRateLimit: true }),
  db = app.locals.db;
const password = "Project-browser-password-2026!",
  hash = await hashPassword(password),
  work = db.prepare("SELECT id FROM works WHERE unit_id=1 LIMIT 1").get().id,
  users = {};
for (const [name, roles] of [
  ["head", ["head"]],
  ["staff", ["staff"]],
  ["peer", ["staff"]],
])
  users[name] = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,password_hash,roles,unit_id,work_id,scopes) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        name,
        "บุคลากร " + name,
        hash,
        JSON.stringify(roles),
        1,
        work,
        name === "head" ? "[1]" : "[]",
      ).lastInsertRowid,
  );
for (const name of ["head", "staff", "peer"])
  db.prepare(
    "INSERT INTO activities(title,date,unit_id,work_id,owner_id,status,source,source_text) VALUES(?, '2026-10-18',1,?,?,'ready','web','ข้อความสำหรับตรวจค้นหาตามสิทธิ์')",
  ).run("ค้นหาทดสอบ " + name, work, users[name]);
let browser, server;
const errors = [];
try {
  server = await new Promise((resolve, reject) => {
    const s = app.listen(4180, "127.0.0.1", () => resolve(s));
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
  await mkdir("test-results/project-intake", { recursive: true });
  async function login(name, mobile = false) {
    const context = await browser.newContext({
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      }),
      p = await context.newPage();
    p.setDefaultTimeout(10000);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(origin);
    await p.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(name);
    await p.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
    await p.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
    await p.locator(".sidebar").waitFor();
    return p;
  }
  async function shot(p, name) {
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      name + " overflow",
    );
    await p.screenshot({
      path: "test-results/project-intake/" + name + ".png",
      fullPage: true,
    });
  }
  const p = await login("head");
  assert.equal(
    await p
      .locator(".sidebar")
      .evaluate((e) => getComputedStyle(e).backgroundColor),
    "rgb(20, 65, 47)",
  );
  assert.equal(
    await p
      .locator(".sidebar nav")
      .getByRole("button", { name: "รายงานสรุป", exact: true })
      .count(),
    1,
  );
  for (const name of ["คลังข้อมูล", "พื้นที่งานของฉัน", "เขียนรายงาน"])
    assert.equal(
      await p
        .locator(".sidebar nav")
        .getByRole("button", { name, exact: true })
        .count(),
      0,
    );
  await p
    .locator(".sidebar nav")
    .getByRole("button", { name: "แดชบอร์ดของฉัน", exact: true })
    .click();
  await p.getByLabel("ค้นหางานของฉัน", { exact: true }).fill("ค้นหาทดสอบ");
  await p
    .getByRole("button", { name: "ค้นหาทดสอบ head", exact: true })
    .waitFor();
  assert.equal(await p.locator("tbody tr").count(), 1);
  assert.equal(
    await p
      .getByRole("button", { name: "ค้นหาทดสอบ peer", exact: true })
      .count(),
    0,
  );
  await shot(p, "my-search-desktop");
  await p
    .locator(".sidebar nav")
    .getByRole("button", { name: "ส่งรายงานทาง LINE", exact: true })
    .click();
  await p.getByRole("button", { name: "ดูรูปแนบ", exact: true }).click();
  await p.getByText("รูปเอกสาร / รูปกิจกรรม", { exact: true }).waitFor();
  await p.getByRole("button", { name: "ดูการยืนยัน", exact: true }).click();
  assert.equal(
    db.prepare("SELECT count(*) n FROM activities").get().n,
    3,
    "Example chat must never create reports",
  );
  await shot(p, "line-report-desktop");
  await p
    .locator(".sidebar nav")
    .getByRole("button", { name: "ติดตามโครงการ", exact: true })
    .click();
  await p
    .getByRole("button", { name: "รับโครงการและแจกงาน", exact: true })
    .click();
  const source =
    "ชื่อโครงการ: คัดกรองสุขภาพชุมชน\nสิ้นสุดโครงการ: 31/10/2569\n- เตรียมอุปกรณ์ | บุคลากร peer | 25/10/2569\n- ลงพื้นที่คัดกรอง | บุคลากร staff | 25/10/2569 | 09:00–11:00";
  await p.getByLabel("อ่านเอกสารโครงการจากเครื่อง").setInputFiles({
    name: "project.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: makeTextDocx("โครงการ", [{ heading: "กำหนดงาน", text: source }]),
  });
  await p.waitForFunction(() =>
    document
      .querySelector(".project-intake textarea")
      ?.value.includes("คัดกรองสุขภาพชุมชน"),
  );
  await p
    .getByRole("button", { name: "แยกงานจากโครงการ", exact: true })
    .click();
  await p.getByLabel("ชื่อโครงการ", { exact: true }).waitFor();
  assert.equal(
    await p.getByLabel("ชื่อโครงการ", { exact: true }).inputValue(),
    "คัดกรองสุขภาพชุมชน",
  );
  assert.equal(
    await p.getByLabel("ผู้รับผิดชอบ 2", { exact: true }).inputValue(),
    String(users.staff),
  );
  await shot(p, "intake-review-desktop");
  await p
    .getByRole("button", { name: "ยืนยันโครงการและแจกงาน", exact: true })
    .click();
  await p
    .getByRole("heading", { name: "คัดกรองสุขภาพชุมชน", exact: true })
    .waitFor();
  assert.equal(db.prepare("SELECT count(*) n FROM project_tasks").get().n, 2);
  const pid = db.prepare("SELECT id FROM projects").get().id;
  const eid = db
    .prepare(
      "INSERT INTO calendar_events(title,date,start_time,end_time,unit_id,owner_id) VALUES('ประชุมติดตามงาน','2026-10-25','10:00','12:00',1,?)",
    )
    .run(users.head).lastInsertRowid;
  db.prepare("INSERT INTO calendar_attendees VALUES(?,?)").run(
    eid,
    users.staff,
  );
  await p.getByRole("button", { name: "ดูงานในปฏิทิน", exact: true }).click();
  await p.getByRole("group", { name: "ปฏิทินรายเดือน" }).waitFor();
  await p
    .getByRole("button", { name: "2026-10-25 · 3 รายการ", exact: true })
    .click();
  await p
    .getByText("เวลาทับซ้อนกับงานหรือนัดหมายอื่นของผู้รับผิดชอบ", {
      exact: true,
    })
    .first()
    .waitFor();
  await shot(p, "calendar-desktop");
  await p
    .getByRole("button", { name: "เปิดโครงการ", exact: true })
    .first()
    .click();
  await p.locator("#project-" + pid).waitFor();
  const s = await login("staff", true);
  await s.getByRole("button", { name: "เปิดเมนู", exact: true }).click();
  assert.equal(
    await s
      .locator(".sidebar nav")
      .getByRole("button", { name: "แดชบอร์ดหน่วยงาน", exact: true })
      .count(),
    0,
  );
  await shot(s, "sidebar-mobile");
  await s
    .locator(".sidebar nav")
    .getByRole("button", { name: "ปฏิทิน", exact: true })
    .click();
  await s.getByLabel("เดือนในปฏิทิน", { exact: true }).fill("2026-10");
  await s
    .getByRole("button", { name: "2026-10-25 · 2 รายการ", exact: true })
    .click();
  assert.equal(
    await s
      .locator(".schedule-detail")
      .getByText("เตรียมอุปกรณ์", { exact: true })
      .count(),
    0,
  );
  await s.getByLabel("เฉพาะงานและนัดหมายของฉัน").check();
  await shot(s, "calendar-mobile");
  await s.getByRole("button", { name: "เปิดโครงการ", exact: true }).click();
  await s.locator("#project-" + pid).waitFor();
  assert.equal(await s.locator(".project-task").count(), 1);
  assert.equal(await s.getByText("ต้นฉบับโครงการ", { exact: true }).count(), 0);
  await s.goto(origin + "/#dashboard/mine");
  await s.getByLabel("ค้นหางานของฉัน", { exact: true }).fill("ค้นหาทดสอบ");
  await s
    .getByRole("button", { name: "ค้นหาทดสอบ staff", exact: true })
    .waitFor();
  assert.equal(await s.locator("tbody tr").count(), 1);
  await shot(s, "my-search-mobile");
  await s.getByRole("button", { name: "เปิดเมนู", exact: true }).click();
  await s
    .locator(".sidebar nav")
    .getByRole("button", { name: "ส่งรายงานทาง LINE", exact: true })
    .click();
  await s
    .getByRole("heading", { name: "ส่งรายงานทาง LINE", exact: true })
    .waitFor();
  await shot(s, "line-report-mobile");
  assert.deepEqual(errors, []);
  console.log(
    "Project intake + automatic assignments + linked calendar: desktop/mobile passed",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  db.close();
  await rm(dir, { recursive: true, force: true });
}
