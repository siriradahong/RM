import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";

async function openReviewFields(p) {
  for (const label of [
    "ชื่อกิจกรรม",
    "วันที่",
    "ฝ่าย/งาน",
    "ผลการดำเนินงาน",
    "ตัวเลขและหน่วยนับ",
  ]) {
    const button = p.getByRole("button", {
      name: "แก้ไข " + label,
      exact: true,
    });
    if (await button.count()) await button.click();
  }
  const extra = p.locator("details.review-extra");
  if (!(await extra.getAttribute("open"))) {
    if (!(await extra.evaluate((el) => el.open)))
      await extra.locator("summary").click();
  }
  for (const label of ["ประเภทงาน", "พื้นที่", "ผู้ปฏิบัติงาน"]) {
    const button = p.getByRole("button", {
      name: "แก้ไข " + label,
      exact: true,
    });
    if (await button.count()) await button.click();
  }
}
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
    JSON.stringify(["admin"]),
    "[]",
  );
const assignedWork = app.locals.db
  .prepare("SELECT id FROM works WHERE unit_id=1 AND name='งานสาธารณสุขชุมชน'")
  .get().id;
for (const role of ["head", "pr"])
  app.locals.db
    .prepare(
      "INSERT INTO users(username,name,password_hash,unit_id,work_id,roles,scopes) VALUES(?,?,?,?,?,?,?)",
    )
    .run(
      "flow." + role,
      "ทดสอบ " + role,
      await hashPassword(password),
      1,
      role === "head" ? null : assignedWork,
      JSON.stringify([role]),
      role === "head" ? "[1]" : "[]",
    );
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
  async function loginFlow(role) {
    await page.context().clearCookies();
    await page.goto(origin + "/");
    await page
      .getByLabel("ชื่อผู้ใช้", { exact: true })
      .fill(role === "admin" ? "browseradmin" : "flow." + role);
    await page.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "เข้าสู่ระบบ", exact: true })
      .click();
    await page
      .getByRole("heading", {
        name:
          role === "admin"
            ? "ดูแลระบบ"
            : role === "pr"
              ? "จัดการข่าวประชาสัมพันธ์"
              : role === "head"
                ? "แดชบอร์ดหน่วยงาน"
                : "รายงานของฉัน",
        exact: true,
      })
      .waitFor();
  }

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
  await page.getByRole("heading", { name: "ดูแลระบบ", exact: true }).waitFor();
  await page
    .getByRole("heading", { name: "บัญชีผู้ใช้งาน", exact: true })
    .waitFor();
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
  await page.getByLabel("ฝ่าย/กลุ่มงาน", { exact: true }).selectOption("1");
  await page
    .getByLabel("งานที่รับผิดชอบ *", { exact: true })
    .selectOption(String(assignedWork));
  await page.getByLabel("ฝ่าย/กลุ่มงาน", { exact: true }).selectOption("2");
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
  await page.getByLabel("ฝ่าย/กลุ่มงาน", { exact: true }).selectOption("1");
  await page
    .getByLabel("งานที่รับผิดชอบ *", { exact: true })
    .selectOption(String(assignedWork));
  await page.screenshot({
    path: "test-results/admin-assignment-form.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "บันทึกบัญชี", exact: true }).click();
  await page.getByText("staff.real", { exact: true }).waitFor();
  await page.screenshot({
    path: "test-results/admin-desktop.png",
    fullPage: true,
  });
  // One role determines the available division/work fields, with no role checkboxes.
  await page.getByRole("button", { name: "เพิ่มบัญชี", exact: true }).click();
  await page.getByLabel("ชื่อผู้ใช้ *", { exact: true }).fill("head.real");
  await page.getByLabel("ชื่อ–นามสกุล *", { exact: true }).fill("หัวหน้าทดสอบ");
  await page
    .getByLabel("รหัสผ่านอย่างน้อย 12 ตัวอักษร *", { exact: true })
    .fill("New-head-password!");
  await page
    .getByLabel("ตำแหน่ง/บทบาทหลัก *", { exact: true })
    .selectOption("head");
  assert.equal(
    await page.getByLabel("งานที่รับผิดชอบ *", { exact: true }).count(),
    0,
  );
  await page
    .getByLabel("ฝ่ายที่รับผิดชอบ *", { exact: true })
    .selectOption("2");
  await page.screenshot({
    path: "test-results/head-single-assignment-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/head-single-assignment-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "บันทึกบัญชี", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const headAccount = app.locals.db
    .prepare("SELECT * FROM users WHERE username='head.real'")
    .get();
  assert.equal(headAccount.unit_id, 2);
  assert.equal(headAccount.work_id, null);
  assert.deepEqual(JSON.parse(headAccount.roles), ["head"]);
  assert.deepEqual(JSON.parse(headAccount.scopes), [2]);
  await page
    .getByRole("row")
    .filter({ hasText: "head.real" })
    .getByRole("button", { name: "แก้ไข", exact: true })
    .click();
  await page
    .getByLabel("ตำแหน่ง/บทบาทหลัก *", { exact: true })
    .selectOption("pr");
  assert.equal(
    await page.getByLabel("ฝ่าย/กลุ่มงาน", { exact: true }).inputValue(),
    "",
  );
  await page.getByLabel("ฝ่าย/กลุ่มงาน", { exact: true }).selectOption("1");
  await page
    .getByLabel("งานที่รับผิดชอบ *", { exact: true })
    .selectOption(String(assignedWork));
  await page.getByRole("button", { name: "บันทึกบัญชี", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const reassigned = app.locals.db
    .prepare("SELECT * FROM users WHERE id=?")
    .get(headAccount.id);
  assert.deepEqual(JSON.parse(reassigned.roles), ["pr"]);
  assert.deepEqual(JSON.parse(reassigned.scopes), []);
  assert.equal(reassigned.unit_id, 1);
  assert.equal(reassigned.work_id, assignedWork);
  await loginFlow("head");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page
    .locator(".sidebar nav")
    .getByRole("button", { name: "เขียนรายงาน", exact: true })
    .click();
  await page.getByLabel("ข้อความรายงาน").fill("ประชุมเครือข่าย อสม.");
  await page.locator("input[type=file]").setInputFiles({
    name: "evidence.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
  });
  await page.getByRole("button", { name: "ส่งรายงาน", exact: true }).click();
  await page
    .getByRole("heading", { name: "ตรวจข้อมูลรายงาน", exact: true })
    .waitFor();
  await openReviewFields(page);
  assert.equal(
    await page.getByLabel("ชื่อเรื่อง *", { exact: true }).inputValue(),
    "ประชุมเครือข่าย อสม.",
  );
  await page
    .getByLabel("วันที่ปฏิบัติงาน", { exact: true })
    .fill(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }));
  const workSelect = page.getByLabel("งานตามฝ่าย/กลุ่มงาน", { exact: true });
  await workSelect.selectOption({ label: "งานสาธารณสุขชุมชน" });
  assert.equal(
    await page
      .getByLabel("ฝ่าย/กลุ่มงาน *", { exact: true })
      .locator('option[value="2"]')
      .count(),
    0,
    "A single-division head cannot select another division",
  );
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

  await page
    .getByRole("button", { name: "ยืนยันข้อมูลเพื่อสรุป", exact: true })
    .click();
  await page.getByText("เสร็จแล้ว · พร้อมสรุป", { exact: true }).waitFor();
  await page.goto(origin + "/#dashboard/mine");
  await page
    .getByRole("heading", { name: "รายงานของฉัน", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "ประชุมเครือข่าย อสม.", exact: true })
    .waitFor();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "ประชุมเครือข่าย อสม.", exact: true })
    .click();
  await page.locator("details.scope-activity summary").click();
  await page
    .getByRole("button", { name: "ส่งให้ประชาสัมพันธ์พิจารณา", exact: true })
    .click();
  await loginFlow("pr");
  await page.goto(origin + "/#news");
  await page.getByRole("button", { name: "จัดทำข่าว", exact: true }).click();
  await page
    .getByLabel("เนื้อหาข่าว *", { exact: true })
    .fill("ผลการประชุมเครือข่าย อสม. มีผู้เข้าร่วมจำนวน 32 คน");
  await page
    .getByRole("checkbox", {
      name: "ตรวจข้อมูลส่วนบุคคลในข้อความ สิทธิ์และความเหมาะสมของรูปภาพแล้ว",
    })
    .check();
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
  await loginFlow("head");
  for (const width of [390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(origin + "/#dashboard/mine");
    await page
      .getByRole("heading", { name: "รายงานของฉัน", exact: true })
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
      .getByRole("heading", { name: "ตรวจข้อมูลรายงาน", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "Detail page overflow at " + width,
    );
    await openReviewFields(page);
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
    await openReviewFields(page);
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
  await loginFlow("admin");
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
  await loginFlow("head");
  await page.goto(origin + "/#activity/1");
  await page.reload();
  await page
    .getByRole("heading", { name: "ตรวจข้อมูลรายงาน", exact: true })
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
    .getByRole("heading", { name: "รายงานของฉัน", exact: true })
    .waitFor();
  await staff.goto(origin + "/#import");
  await staff
    .getByLabel("ข้อความรายงาน")
    .fill("เยี่ยมบ้านผู้สูงอายุประจำเดือน");
  await staff.locator("input[type=file]").setInputFiles(
    ["first.pdf", "second.pdf"].map((name) => ({
      name,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
    })),
  );
  await staff.locator("input[type=file]").setInputFiles({
    name: "submitted-photo.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN7sAAAAASUVORK5CYII=",
      "base64",
    ),
  });

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
  await staff.getByRole("button", { name: "ส่งรายงาน", exact: true }).click();
  await staff
    .getByRole("heading", { name: "ตรวจข้อมูลรายงาน", exact: true })
    .waitFor();
  await staff.locator('.review-files img[alt="submitted-photo.png"]').waitFor();
  assert.equal(
    app.locals.db
      .prepare(
        "SELECT count(*) n FROM files WHERE activity_id=(SELECT id FROM activities WHERE title=?)",
      )
      .get("เยี่ยมบ้านผู้สูงอายุประจำเดือน").n,
    3,
  );
  await staff.reload();
  await staff
    .getByRole("button", { name: "ยืนยันข้อมูลเพื่อสรุป", exact: true })
    .waitFor();
  assert.equal(
    await staff.getByLabel("ชื่อเรื่อง *", { exact: true }).isVisible(),
    false,
  );
  await staff.screenshot({
    path: "test-results/intake-review-mobile.png",
    fullPage: true,
  });
  const bar = await staff.locator(".review-savebar").boundingBox();
  assert.ok(
    bar.y + bar.height <= 844 + 1,
    "save actions stay in mobile viewport",
  );
  assert.equal(
    await staff.getByLabel("สถานะข้อมูล", { exact: true }).count(),
    0,
  );
  await staff
    .getByRole("button", { name: "ยืนยันข้อมูลเพื่อสรุป", exact: true })
    .click();
  await staff
    .locator("#review-date .field-error")
    .getByText("กรุณายืนยันวันที่กิจกรรม", { exact: true })
    .waitFor();
  assert.equal(
    app.locals.db
      .prepare("SELECT status FROM activities WHERE title=?")
      .get("เยี่ยมบ้านผู้สูงอายุประจำเดือน").status,
    "pending",
  );

  await openReviewFields(staff);
  assert.equal(
    await staff.getByLabel("ชื่อเรื่อง *", { exact: true }).inputValue(),
    "เยี่ยมบ้านผู้สูงอายุประจำเดือน",
  );
  assert.ok(
    (await staff.locator("#review-assignment").textContent()).includes(
      "งานสาธารณสุขชุมชน",
    ),
  );
  assert.equal(
    await staff
      .getByRole("button", { name: "แก้ไข ฝ่าย/งาน", exact: true })
      .count(),
    0,
  );
  await staff.setViewportSize({ width: 1440, height: 1000 });
  await staff.screenshot({
    path: "test-results/staff-report-desktop.png",
    fullPage: true,
  });
  await staff
    .getByRole("button", { name: "บันทึกไว้ก่อน", exact: true })
    .click();
  await staff
    .getByText("บันทึกแล้ว — รอยืนยันข้อมูล", { exact: true })
    .waitFor();
  await staff.goto(origin + "/#dashboard/mine");
  await staff
    .getByRole("heading", { name: "รายงานของฉัน", exact: true })
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
  assert.equal(evidenceFiles.length, 3);
  for (const file of evidenceFiles) {
    assert.ok(
      ["first.pdf", "second.pdf", "submitted-photo.png"].includes(file.title),
    );
    assert.equal(file.work_id, assignedWork);
  }
  await staff.goto(origin + "/#import");
  await staff.locator("input[type=file]").setInputFiles({
    name: "file-only.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
  });
  await staff.getByRole("button", { name: "ส่งรายงาน", exact: true }).click();
  await staff
    .getByRole("button", { name: "ยืนยันข้อมูลเพื่อสรุป", exact: true })
    .waitFor();
  const fileOnly = app.locals.db
    .prepare("SELECT * FROM activities WHERE title='file-only.pdf'")
    .get();
  assert.equal(fileOnly.source_text, "");
  assert.equal(fileOnly.status, "pending");
  assert.equal(fileOnly.date, null);
  await staff
    .getByRole("button", { name: "เพิ่มไฟล์แนบ", exact: true })
    .click();
  await staff.getByLabel("เลือกไฟล์จากเครื่อง").setInputFiles({
    name: "extra-proof.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN7sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await staff
    .getByRole("button", { name: "อัปโหลดและแนบไฟล์", exact: true })
    .click();
  await staff.getByRole("dialog").waitFor({ state: "hidden" });
  await staff.reload();
  await staff.locator(".review-files img").waitFor();
  assert.equal(
    app.locals.db
      .prepare("SELECT count(*) n FROM files WHERE activity_id=?")
      .get(fileOnly.id).n,
    2,
  );

  await staff.goto(origin + "/#import");
  await staff.getByLabel("เก็บไว้ค้นหาเท่านั้น — ไม่รวมในสรุปผลงาน").check();
  await staff
    .getByLabel("ข้อความรายงาน")
    .fill("ข้อความประกอบไฟล์สำหรับค้นหาย้อนหลัง");
  await staff.getByLabel("เก็บไว้ค้นหาเท่านั้น — ไม่รวมในสรุปผลงาน").uncheck();
  assert.equal(
    await staff.getByLabel("ข้อความรายงาน").inputValue(),
    "ข้อความประกอบไฟล์สำหรับค้นหาย้อนหลัง",
  );
  await staff.getByLabel("เก็บไว้ค้นหาเท่านั้น — ไม่รวมในสรุปผลงาน").check();

  const countBefore = app.locals.db
    .prepare("SELECT count(*) n FROM activities")
    .get().n;
  await staff.locator("input[type=file]").setInputFiles({
    name: "archive-only.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
  });
  await staff
    .getByRole("button", { name: "ฝากไฟล์ไว้ค้นหา", exact: true })
    .click();
  await staff
    .getByRole("heading", { name: "คลังข้อมูล", exact: true })
    .waitFor();
  assert.equal(
    app.locals.db.prepare("SELECT count(*) n FROM activities").get().n,
    countBefore,
  );
  assert.equal(
    app.locals.db
      .prepare(
        "SELECT purpose FROM files WHERE original_name='archive-only.pdf'",
      )
      .get().purpose,
    "archive",
  );

  await staff.goto(origin + "/#activity/" + fileOnly.id);
  await staff
    .getByRole("button", { name: "เพิ่มไฟล์แนบ", exact: true })
    .click();
  await staff
    .getByRole("tab", { name: "เลือกจากคลังไฟล์", exact: true })
    .click();
  await staff.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await staff.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await staff.screenshot({
    path: "test-results/attachment-library-mobile.png",
    fullPage: false,
  });
  await staff
    .getByRole("dialog")
    .getByRole("button", { name: /archive-only.pdf/ })
    .click();
  await staff.getByRole("dialog").waitFor({ state: "hidden" });
  await staff.reload();
  await staff
    .locator(".review-files")
    .getByText("archive-only.pdf", { exact: true })
    .waitFor();
  assert.equal(
    app.locals.db
      .prepare("SELECT count(*) n FROM files WHERE activity_id=?")
      .get(fileOnly.id).n,
    3,
  );
  assert.equal(
    app.locals.db
      .prepare(
        "SELECT purpose FROM files WHERE original_name='archive-only.pdf' AND activity_id IS NULL",
      )
      .get().purpose,
    "archive",
  );

  const originalArchive = app.locals.db
    .prepare(
      "SELECT description FROM files WHERE original_name='archive-only.pdf' AND activity_id IS NULL",
    )
    .get();
  assert.equal(
    originalArchive.description,
    "ข้อความประกอบไฟล์สำหรับค้นหาย้อนหลัง",
  );
  await staff.goto(origin + "/#import");
  await staff.getByLabel("เก็บไว้ค้นหาเท่านั้น — ไม่รวมในสรุปผลงาน").check();
  await staff
    .getByLabel("ข้อความรายงาน")
    .fill("บันทึกข้อความอย่างเดียว\nใช้ค้นหาข้อมูลเก่า");
  const textCountBefore = app.locals.db
    .prepare("SELECT count(*) n FROM activities")
    .get().n;
  await staff
    .getByRole("button", { name: "บันทึกข้อความไว้ค้นหา", exact: true })
    .click();
  await staff
    .getByRole("button", { name: "บันทึกข้อความอย่างเดียว", exact: true })
    .click();
  await staff
    .getByRole("dialog")
    .getByText("บันทึกข้อความอย่างเดียว\nใช้ค้นหาข้อมูลเก่า", { exact: true })
    .waitFor();
  assert.equal(
    app.locals.db.prepare("SELECT count(*) n FROM activities").get().n,
    textCountBefore,
  );
  await staff.screenshot({
    path: "test-results/archive-text-mobile.png",
    fullPage: false,
  });
  await staffContext.close();
  // An admin-only account can manage settings and read audits, not author reports/news.
  app.locals.db
    .prepare(
      "INSERT INTO users(username,name,password_hash,roles) VALUES(?,?,?,?)",
    )
    .run(
      "onlyadmin",
      "แอดมินตรวจสิทธิ์",
      await hashPassword(password),
      '["admin"]',
    );
  app.locals.db
    .prepare(
      "INSERT INTO audits(actor_name,action,entity,entity_id,before_json,after_json) VALUES(?,?,?,?,?,?)",
    )
    .run(
      "แอดมินตรวจสิทธิ์",
      "ทดสอบการเปลี่ยนสถานะ",
      "user",
      1,
      JSON.stringify({ name: "ชื่อเดิม", active: true }),
      JSON.stringify({ name: "ชื่อเดิม", active: false }),
    );
  const adminContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const admin = await adminContext.newPage();
  admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto(origin);
  await admin.getByLabel("ชื่อผู้ใช้", { exact: true }).fill("onlyadmin");
  await admin.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await admin.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await admin.getByRole("heading", { name: "ดูแลระบบ", exact: true }).waitFor();
  assert.equal(await admin.getByRole("tab").count(), 3);
  assert.equal(
    await admin
      .getByRole("button", { name: "เพิ่มข้อมูล", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await admin
      .getByRole("button", { name: "จัดการข่าว", exact: true })
      .count(),
    0,
  );
  await admin
    .getByRole("tab", { name: "การเชื่อมต่อ LINE", exact: true })
    .click();
  await admin
    .getByRole("heading", { name: "กลุ่มรับรายงาน", exact: true })
    .waitFor();
  await admin.reload();
  await admin
    .getByRole("heading", { name: "กลุ่มรับรายงาน", exact: true })
    .waitFor();
  assert.equal(
    await admin
      .getByRole("tab", { name: "การเชื่อมต่อ LINE", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await admin.screenshot({
    path: "test-results/admin-line-desktop.png",
    fullPage: true,
  });
  await admin.setViewportSize({ width: 390, height: 844 });
  await admin.waitForFunction(
    () => document.querySelector(".sidebar").getBoundingClientRect().right <= 1,
  );
  assert.equal(
    await admin.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await admin.screenshot({
    path: "test-results/admin-line-mobile.png",
    fullPage: true,
  });
  await admin.goto(origin + "/#audit");
  await admin.getByLabel("ประเภทรายการ", { exact: true }).selectOption("user");
  await admin
    .getByRole("cell", { name: "ทดสอบการเปลี่ยนสถานะ", exact: true })
    .waitFor();
  await admin
    .getByRole("row")
    .filter({ hasText: "ทดสอบการเปลี่ยนสถานะ" })
    .getByRole("button", { name: "ดูรายละเอียด" })
    .click();
  const diff = admin.getByRole("dialog");
  await diff.getByRole("columnheader", { name: "ค่าเดิม" }).waitFor();
  assert.equal(await diff.locator("tbody tr").count(), 1);
  await diff
    .locator('td[data-label="ค่าเดิม"]')
    .filter({ hasText: /^เปิดใช้งาน$/ })
    .waitFor();
  await diff
    .locator('td[data-label="ค่าใหม่"]')
    .filter({ hasText: /^ปิดใช้งาน$/ })
    .waitFor();
  assert.equal(
    await admin.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await admin.screenshot({
    path: "test-results/admin-audit-mobile.png",
    fullPage: true,
  });
  await admin.setViewportSize({ width: 1440, height: 1000 });
  await admin.screenshot({
    path: "test-results/admin-audit-desktop.png",
    fullPage: true,
  });
  for (const route of ["import", "inbox", "news"]) {
    await admin.goto(origin + "/#" + route);
    await admin
      .getByRole("heading", { name: "ไม่มีสิทธิ์เข้าถึงหน้านี้", exact: true })
      .waitFor();
  }
  await adminContext.close();
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
