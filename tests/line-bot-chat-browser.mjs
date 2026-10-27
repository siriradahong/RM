import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";
const dir = await mkdtemp(join(tmpdir(), "rm-line-chat-")),
  origin = "http://127.0.0.1:4183",
  app = createApp({ dataDir: dir, origins: origin, disableRateLimit: true }),
  db = app.locals.db,
  password = "Line-chat-browser-password-2026!",
  hash = await hashPassword(password),
  work = db.prepare("SELECT id FROM works WHERE unit_id=1 LIMIT 1").get().id;
const owner = Number(
  db
    .prepare(
      "INSERT INTO users(username,name,password_hash,roles,unit_id,work_id) VALUES('staff','ผู้รายงานทดสอบ',?,'[\"staff\"]',1,?)",
    )
    .run(hash, work).lastInsertRowid,
);
db.prepare(
  "INSERT INTO inbox(event_id,line_user_id,owner_id,group_id,kind,text,received_at) VALUES('test-chat','U00000000000000000000000000000000',?,'test-group','text','ข้อความรับเข้าทดสอบ','2026-10-27T02:00:00Z')",
).run(owner);
let browser, server;
const errors = [],
  writes = [];
try {
  server = await new Promise((resolve, reject) => {
    const s = app.listen(4183, "127.0.0.1", () => resolve(s));
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
  });
  p.setDefaultTimeout(10000);
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("request", (r) => {
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(r.method()) &&
      !r.url().endsWith("/auth/login")
    )
      writes.push(r.url());
  });
  await mkdir("test-results/line-bot-chat", { recursive: true });
  async function shot(name) {
    await p.evaluate(() => window.scrollTo(0, 0));
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      name + " overflow",
    );
    await p.screenshot({
      path: "test-results/line-bot-chat/" + name + ".png",
      fullPage: true,
    });
  }
  const active = (label) =>
    p
      .locator(".line-bot-options button:enabled")
      .filter({ hasText: new RegExp("^" + label + "$") });
  const count = () => p.getByLabel("จำนวนรายงานตัวอย่าง", { exact: true });
  await p.goto(origin);
  await p.getByLabel("ชื่อผู้ใช้", { exact: true }).fill("staff");
  await p.getByLabel("รหัสผ่าน", { exact: true }).fill(password);
  await p.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await p
    .locator(".sidebar nav")
    .getByRole("button", { name: "LINE Bot Chat", exact: true })
    .click();
  await p
    .getByRole("heading", { name: "ส่งรายงานทาง LINE", exact: true })
    .waitFor();
  assert.equal(await count().textContent(), "0");
  await shot("initial-desktop");
  await p
    .getByRole("button", { name: "ส่งรายงานเป็นข้อความ", exact: true })
    .click();
  await active("แก้ไข").click();
  await p
    .getByLabel("ข้อความที่ต้องการแก้ไข")
    .fill(
      "ชื่อกิจกรรม: คัดกรองสุขภาพที่แก้ไข\nวันที่: 7 ก.ย. 2569\nสถานที่: ชุมชนตัวอย่าง\nผู้เข้าร่วม: 25 คน\nบริการรวม: 31 ครั้ง",
    );
  await p.getByRole("button", { name: "ส่งรายละเอียด", exact: true }).click();
  await active("ใช่ ถูกต้อง").waitFor();
  const summary = await p.locator(".line-bot-message dl").last().textContent();
  assert.match(summary, /25 คน/);
  assert.match(summary, /31 ครั้ง/);
  await active("ใช่ ถูกต้อง").click();
  await active("ใช้เป็นข่าว").waitFor();
  await p.waitForFunction(
    () =>
      document.querySelector('[aria-label="จำนวนรายงานตัวอย่าง"]')
        .textContent === "1",
  );
  await active("ใช้เป็นข่าว").click();
  await p
    .getByText(
      "ส่งตัวอย่างเข้าคิวประชาสัมพันธ์แล้วค่ะ รอเจ้าหน้าที่ตรวจข้อความและรูปก่อนเผยแพร่",
      { exact: true },
    )
    .waitFor();
  await p.locator(".line-bot-kpi summary").click();
  await p.getByText("ตัวอย่างเสนอเป็นข่าว", { exact: true }).waitFor();
  assert.equal(await count().textContent(), "1");
  await shot("text-confirmed-desktop");
  await p
    .getByRole("button", { name: "ส่งรูปอย่างเดียว", exact: true })
    .click();
  await active("คัดกรองสุขภาพ").click();
  await active("ประมาณ 20").click();
  await active("ยืนยัน").waitFor();
  assert.equal(await p.locator(".line-bot-photos i").count(), 6);
  assert.equal(await count().textContent(), "1");
  assert.match(
    await p.locator(".line-bot-message dl").last().textContent(),
    /ประมาณ 20 คน/,
  );
  await active("ยืนยัน").click();
  await active("ไม่ใช้").click();
  await p
    .getByText("เก็บเป็นรายงานตัวอย่างอย่างเดียวค่ะ", { exact: true })
    .waitFor();
  assert.equal(await count().textContent(), "2");
  await p
    .getByRole("button", { name: "เริ่มตัวอย่างใหม่", exact: true })
    .click();
  assert.equal(await count().textContent(), "0");
  await p.setViewportSize({ width: 390, height: 844 });
  await p
    .getByRole("button", { name: "ส่งรูปอย่างเดียว", exact: true })
    .click();
  await active("ประชุม").click();
  await active("ไม่ทราบ").click();
  await active("เพิ่มรายละเอียด").click();
  await p
    .getByLabel("ข้อความที่ต้องการแก้ไข")
    .fill(
      "ชื่อกิจกรรม: ประชุมจากรูป\nวันที่: ยังไม่ระบุ\nสถานที่: ยังไม่ระบุ\nผู้เข้าร่วม: ไม่ทราบ",
    );
  await p.getByRole("button", { name: "ส่งรายละเอียด", exact: true }).click();
  await active("ยืนยัน").waitFor();
  assert.match(
    await p.locator(".line-bot-message dl").last().textContent(),
    /ยังไม่ทราบ/,
  );
  await shot("image-questions-mobile");
  await active("ยืนยัน").click();
  await active("ไม่ใช้").click();
  await p
    .getByText("เก็บเป็นรายงานตัวอย่างอย่างเดียวค่ะ", { exact: true })
    .waitFor();
  assert.equal(await count().textContent(), "1");
  await p
    .getByRole("button", { name: "เริ่มตัวอย่างใหม่", exact: true })
    .click();
  await p
    .getByRole("button", { name: "ส่งรายงานเป็นข้อความ", exact: true })
    .click();
  await p
    .getByRole("button", { name: "เริ่มตัวอย่างใหม่", exact: true })
    .click();
  await p.waitForTimeout(600);
  assert.equal(await p.locator(".line-bot-message").count(), 1);
  assert.equal(await count().textContent(), "0");
  await p.locator("details.line-bot-received > summary").click();
  await p.getByText("ข้อความรับเข้าทดสอบ", { exact: true }).waitFor();
  await p
    .getByText("ยังไม่ได้เชื่อมต่อกลุ่มรับรายงาน", { exact: false })
    .waitFor();
  for (const table of ["activities", "news", "files"])
    assert.equal(
      db.prepare("SELECT count(*) n FROM " + table).get().n,
      0,
      "Chat examples must not write " + table,
    );
  assert.equal(db.prepare("SELECT count(*) n FROM inbox").get().n, 1);
  assert.deepEqual(writes, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: HTML-style text/image conversations, inline correction, confirmation, news choice, reset, live sample count, preserved real inbox and zero production writes; desktop/mobile",
  );
} finally {
  await browser?.close();
  if (server) await new Promise((r) => server.close(r));
  db.close();
  await rm(dir, { recursive: true, force: true });
}
