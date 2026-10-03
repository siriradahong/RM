import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";

const dir = await mkdtemp(join(tmpdir(), "rm-browser-"));
const origin = "http://127.0.0.1:4175";
const app = createApp({
  dataDir: dir,
  origins: origin,
  disableRateLimit: true,
});
const password = "Browser-test-password!";
app.locals.db
  .prepare(
    "INSERT INTO users(username,name,password_hash,unit_id,roles,scopes) VALUES(?,?,?,?,?,?)",
  )
  .run(
    "browseradmin",
    "ผู้ทดสอบระบบ",
    await hashPassword(password),
    1,
    JSON.stringify(["admin", "staff", "head", "executive", "pr"]),
    "[1,2]",
  );
const assignedWork = app.locals.db
  .prepare("SELECT id FROM works WHERE unit_id=1 AND name='งานสาธารณสุขชุมชน'")
  .get().id;
app.locals.db
  .prepare("UPDATE users SET work_id=? WHERE username=?")
  .run(assignedWork, "browseradmin");
let browser, server;
try {
  server = await new Promise((resolve, reject) => {
    const s = app.listen(4175, "127.0.0.1", (err) =>
      err ? reject(err) : resolve(s),
    );
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
  const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    }),
    errors = [];
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir("test-results", { recursive: true });
  await page.goto(origin);
  await page
    .getByRole("heading", { name: "เข้าสู่ระบบ", exact: true })
    .waitFor();
  await page.screenshot({
    path: "test-results/login-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("ชื่อผู้ใช้", { exact: true }).fill("browseradmin");
  await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await page
    .getByRole("heading", { name: "ภาพรวมสำนัก", exact: true })
    .waitFor();
  await page.getByText("ยังไม่มีกิจกรรมพร้อมสรุป", { exact: true }).waitFor();
  await page.screenshot({
    path: "test-results/dashboard-empty-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "ดูแลระบบ", exact: true }).click();
  await page.getByRole("button", { name: "เพิ่มบัญชี", exact: true }).click();
  await page.getByLabel("ชื่อผู้ใช้ *", { exact: true }).fill("staff.real");
  await page
    .getByLabel("ชื่อ–นามสกุล *", { exact: true })
    .fill("เจ้าหน้าที่ทดสอบ");
  await page
    .getByLabel("รหัสผ่านอย่างน้อย 12 ตัวอักษร *", { exact: true })
    .fill("New-staff-password!");
  await page.getByLabel("สังกัด", { exact: true }).selectOption("1");
  await page
    .getByLabel("งานที่รับผิดชอบ *", { exact: true })
    .selectOption(String(assignedWork));
  await page.getByLabel("สังกัด", { exact: true }).selectOption("2");
  assert.equal(
    await page.getByLabel("งานที่รับผิดชอบ *", { exact: true }).inputValue(),
    "",
  );
  assert.equal(
    await page
      .getByLabel("งานที่รับผิดชอบ *", { exact: true })
      .locator("option")
      .filter({ hasText: "งานสาธารณสุขชุมชน" })
      .count(),
    0,
  );
  await page.getByLabel("สังกัด", { exact: true }).selectOption("1");
  await page
    .getByLabel("งานที่รับผิดชอบ *", { exact: true })
    .selectOption(String(assignedWork));
  await page.getByRole("button", { name: "บันทึกบัญชี", exact: true }).click();
  await page.getByText("staff.real", { exact: true }).waitFor();
  await page.screenshot({
    path: "test-results/admin-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "นำเข้าข้อมูล", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "evidence.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
  });
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page
    .getByRole("button", { name: /จัดข้อมูลเพื่อนำไปสรุปผลงาน/ })
    .click();
  await page.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await page
    .getByLabel("ชื่อเรื่อง *", { exact: true })
    .fill("ประชุมเครือข่าย อสม.");
  await page
    .getByRole("button", { name: "จัดเก็บและตรวจข้อมูล", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "สร้างรายการงาน", exact: true })
    .waitFor();
  assert.equal(
    await page.getByLabel("ชื่อเรื่อง *", { exact: true }).inputValue(),
    "ประชุมเครือข่าย อสม.",
  );
  await page
    .getByLabel("วันที่ปฏิบัติงาน", { exact: true })
    .fill(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }));
  const workSelect = page.getByLabel("งานตามฝ่าย/กลุ่มงาน", { exact: true });
  await workSelect.selectOption({ label: "งานสาธารณสุขชุมชน" });
  await page.getByLabel("ฝ่าย/กลุ่มงาน *", { exact: true }).selectOption("2");
  assert.equal(await workSelect.inputValue(), "");
  assert.equal(
    await workSelect
      .locator("option")
      .filter({ hasText: "งานสาธารณสุขชุมชน" })
      .count(),
    0,
  );
  await workSelect.selectOption({ label: "งานป้องกันโรคติดต่อ" });
  await page.getByLabel("ฝ่าย/กลุ่มงาน *", { exact: true }).selectOption("1");
  assert.equal(await workSelect.inputValue(), String(assignedWork));
  await page
    .getByRole("button", { name: "เพิ่มประเภทงาน", exact: true })
    .click();
  await page
    .getByLabel("ชื่อประเภทงาน *", { exact: true })
    .fill("ลงพื้นที่ชุมชน");
  await page
    .getByRole("button", { name: "เพิ่มและเลือกประเภทงาน", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    await page
      .getByLabel("ประเภทงาน", { exact: true })
      .locator("option:checked")
      .textContent(),
    "ลงพื้นที่ชุมชน",
  );
  assert.equal(
    await page.getByLabel("ชื่อเรื่อง *", { exact: true }).inputValue(),
    "ประชุมเครือข่าย อสม.",
  );
  await page
    .getByRole("button", { name: "เพิ่มประเภทงาน", exact: true })
    .click();
  await page
    .getByLabel("ชื่อประเภทงาน *", { exact: true })
    .fill("ลงพื้นที่ชุมชน");
  await page
    .getByRole("button", { name: "เพิ่มและเลือกประเภทงาน", exact: true })
    .click();
  await page
    .getByRole("alert")
    .filter({ hasText: "มีประเภทงานชื่อนี้แล้ว" })
    .waitFor();
  await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
  await page.screenshot({
    path: "test-results/organization-form-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("พื้นที่", { exact: true }).fill("ชุมชนทดสอบ");
  await page
    .getByLabel("ผู้ปฏิบัติงานตามข้อมูลต้นทาง", { exact: true })
    .fill("เจ้าหน้าที่และเครือข่าย อสม.");
  await page
    .getByLabel("ผลการดำเนินงาน", { exact: true })
    .fill("ประชุม 1 ครั้ง ผู้เข้าร่วม 32 คน");
  await page.getByRole("button", { name: "เพิ่มผล", exact: true }).click();
  await page.getByLabel("ชื่อผล 1", { exact: true }).fill("ผู้เข้าร่วม");
  await page.getByLabel("จำนวน 1", { exact: true }).fill("32");
  await page.getByLabel("สถานะข้อมูล", { exact: true }).selectOption("ready");
  await page.getByRole("button", { name: "บันทึกข้อมูล", exact: true }).click();
  await page
    .getByRole("heading", { name: "ข้อมูลที่ฉันนำเข้า", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "ประชุมเครือข่าย อสม.", exact: true })
    .waitFor();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "จัดการข่าว", exact: true }).click();
  await page.getByRole("button", { name: "จัดทำข่าว", exact: true }).click();
  await page
    .getByLabel("เนื้อหาข่าว *", { exact: true })
    .fill("ผลการประชุมเครือข่าย อสม. มีผู้เข้าร่วมจำนวน 32 คน");
  await page
    .getByRole("button", { name: "Preview ก่อนเผยแพร่", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ยืนยันเผยแพร่", exact: true })
    .click();
  await page.getByText("เผยแพร่บนฟีดภายในแล้ว", { exact: true }).waitFor();
  await page.getByRole("button", { name: "ฟีดข่าวภายใน", exact: true }).click();
  await page
    .getByRole("heading", { name: "ประชุมเครือข่าย อสม.", exact: true })
    .waitFor();
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(origin + "/#dashboard/overview");
    await page
      .getByRole("heading", { name: "ภาพรวมสำนัก", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "ประชุมเครือข่าย อสม.", exact: true })
      .waitFor();
    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    assert.equal(overflows, false, "Dashboard page overflow at " + width);
    await page.screenshot({
      path: `test-results/dashboard-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("button", { name: "เปิดเมนู", exact: true }).click();
    await page.getByRole("button", { name: "คลังข้อมูล", exact: true }).click();
    await page
      .getByRole("button", { name: "ประชุมเครือข่าย อสม.", exact: true })
      .click();
    await page
      .getByRole("heading", { name: "รายละเอียดและตรวจแก้ข้อมูล", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "Detail page overflow at " + width,
    );
    assert.equal(
      await page
        .getByLabel("งานตามฝ่าย/กลุ่มงาน", { exact: true })
        .locator("option:checked")
        .textContent(),
      "งานสาธารณสุขชุมชน",
    );
    assert.equal(
      await page
        .getByLabel("ประเภทงาน", { exact: true })
        .locator("option:checked")
        .textContent(),
      "ลงพื้นที่ชุมชน",
    );
    if (width === 390) {
      await page
        .getByRole("button", { name: "เพิ่มประเภทงาน", exact: true })
        .click();
      await page
        .getByLabel("ชื่อประเภทงาน *", { exact: true })
        .fill("ติดตามผลในชุมชน");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: "test-results/category-mobile.png",
        fullPage: false,
      });
      await page
        .getByRole("button", { name: "เพิ่มและเลือกประเภทงาน", exact: true })
        .click();
      await page.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal(
        await page
          .getByLabel("ประเภทงาน", { exact: true })
          .locator("option:checked")
          .textContent(),
        "ติดตามผลในชุมชน",
      );
      // Restore the saved type: this check exercises adding on mobile without changing the report.
      await page
        .getByLabel("ประเภทงาน", { exact: true })
        .selectOption({ label: "ลงพื้นที่ชุมชน" });
    }
    await page.screenshot({
      path: `test-results/detail-${width}.png`,
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(origin + "/#admin");
  await page
    .getByRole("tab", { name: "หน่วยงานและหมวดข้อมูล", exact: true })
    .click();
  await page
    .locator("summary")
    .filter({ hasText: "ฝ่ายบริการสาธารณสุข" })
    .click();
  await page
    .locator(".master-list span")
    .filter({ hasText: /^งานเภสัชกรรม/ })
    .waitFor();
  await page.screenshot({
    path: "test-results/organization-admin-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "test-results/organization-admin-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "เพิ่มประเภทงาน", exact: true })
    .click();
  await page.getByLabel("ชื่อ *", { exact: true }).fill("ประเภทจากผู้ดูแลระบบ");
  await page.getByRole("button", { name: "บันทึก", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByText("ประเภทจากผู้ดูแลระบบ", { exact: true }).waitFor();
  await page.goto(origin + "/#activity/1");
  await page.reload();
  await page
    .getByRole("heading", { name: "รายละเอียดและตรวจแก้ข้อมูล", exact: true })
    .waitFor();
  // A real staff session receives its assignment from the administrator, never a selector.
  const staffContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const staff = await staffContext.newPage();
  staff.setDefaultTimeout(12000);
  staff.on("pageerror", (e) => errors.push(e.message));
  await staff.goto(origin);
  await staff.getByLabel("ชื่อผู้ใช้", { exact: true }).fill("staff.real");
  await staff
    .getByLabel("รหัสผ่าน", { exact: true })
    .fill("New-staff-password!");
  await staff.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await staff
    .getByRole("heading", { name: "ข้อมูลที่ฉันนำเข้า", exact: true })
    .waitFor();
  await staff.goto(origin + "/#import");
  await staff
    .locator("input[type=file]")
    .setInputFiles(
      ["first.pdf", "second.pdf"].map((name) => ({
        name,
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
      })),
    );
  await staff.getByRole("button", { name: "ถัดไป", exact: true }).click();
  await staff
    .getByRole("button", { name: /จัดข้อมูลเพื่อนำไปสรุปผลงาน/ })
    .click();
  await staff.getByRole("button", { name: "ถัดไป", exact: true }).click();
  assert.equal(
    await staff.getByLabel("ฝ่าย/กลุ่มงาน", { exact: true }).inputValue(),
    "ฝ่ายส่งเสริมสุขภาพ",
  );
  assert.equal(
    await staff.getByLabel("งานที่รับผิดชอบ", { exact: true }).inputValue(),
    "งานสาธารณสุขชุมชน",
  );
  assert.equal(
    await staff
      .getByLabel("งานที่รับผิดชอบ", { exact: true })
      .getAttribute("readonly"),
    "",
  );
  assert.equal(await staff.getByLabel("คำสำคัญ", { exact: true }).count(), 0);
  await staff
    .getByLabel("ชื่อเรื่อง *", { exact: true })
    .fill("เยี่ยมบ้านผู้สูงอายุประจำเดือน");
  assert.equal(
    await staff.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await staff.screenshot({
    path: "test-results/staff-import-mobile.png",
    fullPage: true,
  });
  await staff
    .getByRole("button", { name: "จัดเก็บและตรวจข้อมูล", exact: true })
    .click();
  await staff
    .getByRole("heading", { name: "สร้างรายการงาน", exact: true })
    .waitFor();
  assert.equal(
    await staff.getByLabel("ชื่อเรื่อง *", { exact: true }).inputValue(),
    "เยี่ยมบ้านผู้สูงอายุประจำเดือน",
  );
  await staff.reload();
  await staff
    .getByRole("heading", { name: "สร้างรายการงาน", exact: true })
    .waitFor();
  assert.equal(
    await staff.getByLabel("ชื่อเรื่อง *", { exact: true }).inputValue(),
    "เยี่ยมบ้านผู้สูงอายุประจำเดือน",
  );
  assert.equal(
    await staff.getByLabel("งานที่รับผิดชอบ", { exact: true }).inputValue(),
    "งานสาธารณสุขชุมชน",
  );
  assert.equal(
    await staff
      .getByLabel("ฝ่าย/กลุ่มงาน", { exact: true })
      .getAttribute("readonly"),
    "",
  );
  await staff.setViewportSize({ width: 1440, height: 1000 });
  await staff.screenshot({
    path: "test-results/staff-report-desktop.png",
    fullPage: true,
  });
  await staff
    .getByRole("button", { name: "บันทึกข้อมูล", exact: true })
    .click();
  await staff
    .getByRole("heading", { name: "ข้อมูลที่ฉันนำเข้า", exact: true })
    .waitFor();
  await staff
    .getByRole("button", {
      name: "เยี่ยมบ้านผู้สูงอายุประจำเดือน",
      exact: true,
    })
    .waitFor();
  const savedStaffReport = app.locals.db
    .prepare("SELECT * FROM activities WHERE title=?")
    .get("เยี่ยมบ้านผู้สูงอายุประจำเดือน");
  assert.equal(savedStaffReport.work_id, assignedWork);
  const evidenceFiles = app.locals.db
    .prepare("SELECT title,work_id FROM files WHERE activity_id=?")
    .all(savedStaffReport.id);
  assert.equal(evidenceFiles.length, 2);
  for (const file of evidenceFiles) {
    assert.equal(file.title, savedStaffReport.title);
    assert.equal(file.work_id, assignedWork);
  }
  await staffContext.close();
  assert.deepEqual(errors, [], "Browser runtime errors");
  console.log(
    "PASS: desktop login, account creation, real upload, activity save, dashboard, news publication, persistent session, mobile/tablet navigation and layout.",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((resolve) => server.close(resolve));
  app.locals.db.close();
  await rm(dir, { recursive: true, force: true });
}
