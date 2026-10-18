import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";
const dir = await mkdtemp(join(tmpdir(), "rm-scope-browser-")),
  origin = "http://127.0.0.1:4179",
  app = createApp({ dataDir: dir, origins: origin, disableRateLimit: true }),
  db = app.locals.db,
  password = "Browser-scope-password-2026!",
  hash = await hashPassword(password),
  work = db.prepare("SELECT id FROM works WHERE unit_id=1 LIMIT 1").get().id,
  users = {};
for (const [name, roles] of [
  ["staff", ["staff"]],
  ["peer", ["staff"]],
  ["head", ["head"]],
  ["center", ["center_head"]],
  ["admin", ["admin"]],
  ["pr", ["pr"]],
])
  users[name] = Number(
    db
      .prepare(
        "INSERT INTO users(username,name,password_hash,unit_id,work_id,roles,scopes,work_scopes,personnel_type,position) VALUES(?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        name,
        "บุคลากร " + name,
        hash,
        1,
        work,
        JSON.stringify(roles),
        name === "head" ? "[1]" : "[]",
        name === "center" ? JSON.stringify([work]) : "[]",
        "พนักงานจ้าง",
        "ตำแหน่งทดสอบ",
      ).lastInsertRowid,
  );
const id = Number(
  db
    .prepare(
      "INSERT INTO activities(title,date,unit_id,work_id,owner_id,category_id,area,workers,result,metrics,status,source_text,owner_confirmed_at,source) VALUES('ติดตามผู้ช่วยคนพิการ','2026-10-05',1,?,?,1,'ชุมชนทดสอบ','เจ้าหน้าที่','ติดตามคนพิการ 85 ราย',?,'ready','ต้นฉบับลงพื้นที่ติดตามคนพิการ 85 ราย','2026-10-05T03:00:00Z','web')",
    )
    .run(work, users.staff, '[{"label":"คนพิการ","value":85,"unit":"ราย"}]')
    .lastInsertRowid,
);
let browser, server;
const errors = [];
try {
  server = await new Promise((resolve, reject) => {
    const s = app.listen(4179, "127.0.0.1", () => resolve(s));
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
  await mkdir("test-results/scope", { recursive: true });
  async function login(name, mobile = false) {
    const context = await browser.newContext({
        viewport: mobile
          ? { width: 390, height: 844 }
          : { width: 1440, height: 1000 },
        reducedMotion: "reduce",
      }),
      page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill(name);
    await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "เข้าสู่ระบบ", exact: true })
      .click();
    await page.locator(".sidebar").waitFor();
    return page;
  }
  async function shot(p, name) {
    await p.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo(0, 0);
    });
    await p.screenshot({
      path: "test-results/scope/" + name + ".png",
      fullPage: true,
    });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      name + " horizontal overflow",
    );
  }
  async function route(p, path) {
    await p.goto(origin + "/#" + path);
    await p.locator("main").waitFor();
  }
  const admin = await login("admin");
  await admin
    .getByRole("tab", { name: "หน่วยงานและหมวดข้อมูล", exact: true })
    .click();
  await admin
    .getByRole("button", { name: "ค่ามาตรฐานและงานอัตโนมัติ", exact: true })
    .click();
  await admin
    .getByRole("heading", { name: "ค่ามาตรฐานสำนัก", exact: true })
    .waitFor();
  await admin
    .getByRole("button", { name: "เพิ่มแบบจากเอกสารอ้างอิง", exact: true })
    .click();
  let dlg = admin.getByRole("dialog");
  await dlg
    .getByLabel("ชื่อแบบ", { exact: true })
    .fill("แบบสรุปตามเอกสารฝ่ายบุคคล");
  await dlg
    .getByLabel("ประเภทบุคลากร (ตรงกับบัญชีผู้ใช้)", { exact: true })
    .fill("พนักงานจ้าง");
  await dlg
    .getByLabel("หัวข้อตามแบบจริง (หนึ่งหัวข้อต่อบรรทัด)", { exact: true })
    .fill("ผลสัมฤทธิ์\nบทบาทการทำงาน");
  await dlg
    .getByLabel("ชื่อหรือเลขเอกสารแบบจริงที่อ้างอิง", { exact: true })
    .fill("เอกสารทดสอบเพื่อสาธิตหน้าจอ");
  await dlg.getByRole("button", { name: "บันทึก", exact: true }).click();
  await dlg.waitFor({ state: "hidden" });
  await admin
    .getByText("แบบสรุปตามเอกสารฝ่ายบุคคล · พนักงานจ้าง", { exact: false })
    .waitFor();
  await admin.getByRole("button", { name: "เพิ่มชุมชน", exact: true }).click();
  dlg = admin.getByRole("dialog");
  await dlg.getByLabel("ชื่อชุมชน", { exact: true }).fill("ชุมชนทดสอบพิกัด");
  await dlg.getByLabel("ละติจูด", { exact: true }).fill("16.43");
  await dlg.getByLabel("ลองจิจูด", { exact: true }).fill("102.83");
  await dlg.getByRole("button", { name: "บันทึก", exact: true }).click();
  await dlg.waitFor({ state: "hidden" });
  await shot(admin, "admin-settings-desktop");
  const staff = await login("staff");
  assert.equal(
    await staff
      .getByRole("button", { name: "ภาพรวมสำนัก", exact: true })
      .count(),
    0,
  );
  await route(staff, "activity/" + id);
  await staff.locator("details.scope-activity summary").click();
  await staff
    .getByRole("button", { name: "แก้ผู้ร่วมงานและหน่วยร่วม", exact: true })
    .click();
  dlg = staff.getByRole("dialog");
  await dlg
    .getByRole("textbox", { name: "ค้นหาชื่อผู้ร่วมงาน", exact: true })
    .fill("บุคลากร peer");
  await dlg.getByRole("button", { name: "ค้นหา", exact: true }).click();
  await dlg
    .getByRole("button", { name: "เพิ่ม บุคลากร peer", exact: true })
    .click();
  await dlg
    .getByLabel("บุคลากร peer", { exact: true })
    .fill("ลงพื้นที่ร่วมติดตาม");
  await dlg
    .getByRole("button", { name: "บันทึกผู้ร่วมงาน", exact: true })
    .click();
  await dlg.waitFor({ state: "hidden" });
  await staff.getByText("ลงพื้นที่ร่วมติดตาม", { exact: false }).waitFor();
  await staff
    .getByRole("button", { name: "ส่งให้ประชาสัมพันธ์พิจารณา", exact: true })
    .click();
  await staff
    .getByRole("button", {
      name: "ส่งเข้าคิวข่าวแล้ว · เสนออีกครั้ง",
      exact: true,
    })
    .waitFor();
  await shot(staff, "report-contributors-desktop");
  const peer = await login("peer");
  await route(peer, "activity/" + id);
  await peer.locator("details.scope-activity summary").click();
  await peer
    .getByRole("button", { name: "ยืนยันบทบาทการทำงานของฉัน", exact: true })
    .click();
  await peer.getByText("ยืนยันบทบาทแล้ว", { exact: false }).waitFor();
  await route(peer, "workspace/hr");
  await peer
    .getByRole("button", { name: "สร้างฉบับสรุป", exact: true })
    .click();
  dlg = peer.getByRole("dialog");
  await dlg
    .getByLabel("แบบสรุป", { exact: true })
    .selectOption({ label: "แบบสรุปตามเอกสารฝ่ายบุคคล" });
  await dlg.getByLabel("ตั้งแต่", { exact: true }).fill("2026-10-01");
  await dlg.getByLabel("ถึง", { exact: true }).fill("2026-10-31");
  await dlg
    .getByLabel("ผลสัมฤทธิ์", { exact: true })
    .fill("ลงพื้นที่ร่วมตรวจข้อเท็จจริง");
  await dlg
    .getByRole("button", {
      name: "สร้างฉบับสรุปจากกิจกรรมที่ยืนยันแล้ว",
      exact: true,
    })
    .click();
  await dlg.waitFor({ state: "hidden" });
  await peer.getByText("บทบาท ลงพื้นที่ร่วมติดตาม", { exact: false }).waitFor();
  await shot(peer, "personal-summary-desktop");
  await peer.emulateMedia({ media: "print" });
  assert.equal(
    await peer
      .getByRole("button", { name: "สร้างฉบับสรุป", exact: true })
      .isVisible(),
    false,
  );
  await peer.pdf({
    path: "test-results/scope/personal-summary.pdf",
    format: "A4",
    printBackground: true,
  });
  await peer.emulateMedia({ media: "screen" });

  const head = await login("head");
  await route(head, "workspace/proposals");
  await head
    .getByLabel("ข้อความต้นทาง", { exact: true })
    .fill("ประกาศนัดหมายประชุม วันที่ 21 ตุลาคม 2569 เวลา 09.00 ถึง 10.00");
  await head
    .getByRole("button", { name: "เตรียมให้ตรวจ", exact: true })
    .click();
  dlg = head.getByRole("dialog");
  await dlg.getByLabel("วันที่นัดหมาย", { exact: true }).fill("2026-10-21");
  await dlg.getByLabel("เวลาเริ่ม", { exact: true }).fill("09:00");
  await dlg.getByLabel("เวลาสิ้นสุด", { exact: true }).fill("10:00");
  await dlg
    .getByRole("button", { name: "ยืนยันและสร้างนัดหมาย", exact: true })
    .click();
  await dlg.waitFor({ state: "hidden" });
  await head.getByText("ยืนยันและสร้างแล้ว", { exact: false }).waitFor();
  await head
    .getByLabel("หัวข้อการทำงาน", { exact: true })
    .selectOption("events");
  await head.getByLabel("ตั้งแต่", { exact: true }).fill("2026-10-01");
  await head.getByLabel("ถึง", { exact: true }).fill("2026-10-31");
  await head.getByText("09:00–10:00", { exact: false }).waitFor();
  await shot(head, "calendar-desktop");
  await route(head, "workspace/plans");
  await head
    .getByRole("button", { name: "เพิ่มแผนอ้างอิง", exact: true })
    .click();
  dlg = head.getByRole("dialog");
  await dlg.getByLabel("ชื่อแผน", { exact: true }).fill("แผนงานสาธารณสุข");
  await dlg.getByLabel("งบที่อนุมัติ (บาท)", { exact: true }).fill("10000");
  await dlg
    .getByLabel("เลข/ชื่อเอกสารอนุมัติ", { exact: true })
    .fill("เอกสารแผนทดสอบ");
  await dlg.getByRole("button", { name: "บันทึก", exact: true }).click();
  await dlg.waitFor({ state: "hidden" });
  await head.getByText("แผนงานสาธารณสุข", { exact: true }).waitFor();
  const center = await login("center");
  await route(center, "import");
  await center
    .getByRole("textbox", { name: "ข้อความรายงาน", exact: true })
    .fill(
      "รายงานประชุม วันที่ 18 ตุลาคม 2569 ณ ห้องประชุม เจ้าหน้าที่ร่วมประชุม 10 คน",
    );
  await center.getByRole("button", { name: "ส่งรายงาน", exact: true }).click();
  await center
    .getByRole("heading", { name: "ตรวจข้อมูลรายงาน", exact: true })
    .waitFor();
  assert.ok(
    !(await center
      .getByText("ไม่มีสิทธิ์บันทึกข้อมูลในฝ่ายนี้", { exact: false })
      .count()),
  );
  const pr = await login("pr");
  await route(pr, "news");
  await pr.getByRole("button", { name: "จัดทำข่าว", exact: true }).click();
  await pr
    .getByLabel("เนื้อหาข่าว *", { exact: true })
    .fill("เจ้าหน้าที่ร่วมติดตามคนพิการ 85 ราย");
  await pr
    .getByRole("checkbox", {
      name: "ตรวจข้อมูลส่วนบุคคลในข้อความ สิทธิ์และความเหมาะสมของรูปภาพแล้ว",
    })
    .check();
  await pr
    .getByRole("button", { name: "Preview ก่อนเผยแพร่", exact: true })
    .click();
  await pr.getByRole("button", { name: "ยืนยันเผยแพร่", exact: true }).click();
  await pr.getByText("เผยแพร่บนฟีดภายในแล้ว", { exact: true }).waitFor();
  const mobile = await login("staff", true);
  await route(mobile, "workspace/coverage");
  await mobile.getByRole("heading", { name: "เขต 4", exact: true }).waitFor();
  await shot(mobile, "coverage-mobile");
  await route(mobile, "activity/" + id);
  await mobile
    .getByRole("heading", { name: "ตรวจข้อมูลรายงาน", exact: true })
    .waitFor();
  await shot(mobile, "report-mobile");
  await route(mobile, "workspace/notifications");
  await shot(mobile, "notifications-mobile");
  assert.deepEqual(errors, []);
  console.log(
    "Scope UI passed: admin settings → contributors → confirmed personal summary → reviewed calendar → plan → center intake → PR queue/publication; desktop and mobile.",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  await app.locals.waitLineJobs?.();
  db.close();
  await rm(dir, { recursive: true, force: true });
}
