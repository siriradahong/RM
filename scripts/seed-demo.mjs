import { backup } from "node:sqlite";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  openDatabase,
  publicUser,
  transaction,
  writeAudit,
} from "../server/db.js";
import { hashPassword } from "../server/security.js";
import { activitySchema } from "../server/validation.js";
import {
  buildDemoScenarios,
  buildDemoNews,
  buildDemoInbox,
  demoUnitAccounts,
} from "./demo-scenarios.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const datasetKey = "rm-demo-v1";
const assetNames = [
  "health-outreach.png",
  "dengue-survey.png",
  "waste-sorting.png",
  "health-report.pdf",
  "sanitation-checklist.pdf",
  "activity-summary.xlsx",
];
const mimeFor = (name) =>
  name.endsWith(".png")
    ? "image/png"
    : name.endsWith(".pdf")
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function seedDemo({
  dataDir,
  today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }),
  backupExisting = true,
} = {}) {
  if (process.env.NODE_ENV === "production")
    throw Error("ใช้ข้อมูลสาธิตเฉพาะเครื่องพัฒนาหรือเครื่องสำหรับนำเสนอ");
  const opened = openDatabase(dataDir),
    db = opened.db;
  const privateDir = resolve(opened.dataDir, "demo");
  const accountsPath = resolve(privateDir, "accounts.md");
  const createdPaths = [];
  let accountFileCreated = false,
    committed = false;
  try {
    // The marker is committed with all rows, so a repeat run cannot duplicate data.
    db.exec(
      "CREATE TABLE IF NOT EXISTS demo_datasets(key TEXT PRIMARY KEY, manifest_json TEXT NOT NULL)",
    );
    const existing = db
      .prepare("SELECT manifest_json FROM demo_datasets WHERE key=?")
      .get(datasetKey);
    if (existing)
      return {
        alreadySeeded: true,
        manifest: JSON.parse(existing.manifest_json),
        accountsPath,
      };
    const scenarios = buildDemoScenarios(today),
      newsScenarios = buildDemoNews(scenarios),
      inboxScenarios = buildDemoInbox(scenarios);
    const assets = Object.fromEntries(
      await Promise.all(
        assetNames.map(async (name) => [
          name,
          await readFile(resolve(here, "demo-assets", name)),
        ]),
      ),
    );
    const definitions = demoUnitAccounts.map((a) => ({
      ...a,
      username: "demo.staff." + a.key,
      roles: ["staff"],
    }));
    definitions.push(
      {
        key: "head",
        username: "demo.head",
        displayName: "[สาธิต] หัวหน้าฝ่ายสำหรับตรวจรายงาน",
        roles: ["head"],
      },
      {
        key: "executive",
        username: "demo.executive",
        displayName: "[สาธิต] ผู้บริหารสำนัก",
        roles: ["executive"],
      },
      {
        key: "pr",
        username: "demo.pr",
        displayName: "[สาธิต] เจ้าหน้าที่ประชาสัมพันธ์",
        roles: ["pr"],
      },
      {
        key: "admin",
        username: "demo.admin",
        displayName: "[สาธิต] ผู้ดูแลระบบ",
        roles: ["admin"],
      },
    );
    for (const a of definitions)
      if (db.prepare("SELECT id FROM users WHERE username=?").get(a.username))
        throw Error("มีชื่อบัญชี " + a.username + " อยู่แล้ว จึงไม่เขียนทับ");
    if (existsSync(accountsPath))
      throw Error("มีไฟล์บัญชีสาธิตอยู่แล้ว จึงไม่เขียนทับ: " + accountsPath);
    const unitRecords = new Map(
      demoUnitAccounts.map((a) => {
        const unit = db
          .prepare(
            "SELECT * FROM units WHERE name=? AND active=1 AND kind!='section'",
          )
          .get(a.unitName);
        const work =
          unit &&
          db
            .prepare(
              "SELECT * FROM works WHERE unit_id=? AND name=? AND active=1",
            )
            .get(unit.id, a.workName);
        if (!unit || !work)
          throw Error(
            "ไม่พบฝ่าย/งานที่เปิดใช้: " + a.unitName + " / " + a.workName,
          );
        return [a.unitName, { unit, work }];
      }),
    );
    let backupPath = null;
    if (backupExisting) {
      backupPath = resolve(
        "backups",
        "before-demo-" + new Date().toISOString().replaceAll(":", "-"),
      );
      await mkdir(backupPath, { recursive: true, mode: 0o700 });
      await backup(db, resolve(backupPath, "rm.sqlite"));
      await cp(
        resolve(opened.dataDir, "uploads"),
        resolve(backupPath, "uploads"),
        { recursive: true },
      );
    }
    const password = randomBytes(18).toString("base64url");
    const passwordHash = await hashPassword(password);
    await mkdir(privateDir, { recursive: true, mode: 0o700 });
    const credentials = [
      "# บัญชีสำหรับลองระบบ (ข้อมูลสาธิต)",
      "",
      "รหัสผ่านร่วมของบัญชีสาธิตในเครื่องนี้: `" + password + "`",
      "",
      "ไฟล์นี้เป็นข้อมูลส่วนตัว ไม่ขึ้น GitHub บัญชีเหล่านี้เข้าสู่ระบบจริงและมีสิทธิ์ตามบทบาท",
      "",
      "| ชื่อผู้ใช้ | บทบาท | ฝ่าย / งาน |",
      "| --- | --- | --- |",
      ...definitions.map(
        (a) =>
          `| ${a.username} | ${a.roles.join(", ")} | ${a.unitName || (a.key === "head" ? "รับผิดชอบทุกฝ่ายสาธิต" : "ส่วนกลาง")} ${a.workName || ""} |`,
      ),
      "",
      "เริ่มดูภาพรวมด้วย demo.executive; ลองนำเข้าและแก้รายงานด้วยบัญชี demo.staff.*; ลองตรวจรายงานด้วย demo.head; ลองข่าวด้วย demo.pr; ลองจัดบัญชีและดูประวัติด้วย demo.admin.",
      "",
      "รายการ LINE เป็นข้อมูลจำลองในเครื่อง ไม่ได้เชื่อมบริการ LINE หรือส่งข้อความออกจริง.",
      "ข้อมูลที่ขึ้นต้น [สาธิต] เป็นข้อมูลสมมติ และรวมในตัวเลขสรุปของเว็บด้วย.",
      "บัญชีและข้อมูลเดิมของผู้ใช้งานยังอยู่ครบ ไม่ได้ถูกแก้ไขหรือเปลี่ยนรหัสผ่าน.",
      "",
    ].join("\n");
    await writeFile(accountsPath, credentials, { mode: 0o600, flag: "wx" });
    accountFileCreated = true;
    const manifest = transaction(db, () => {
      const users = new Map(),
        staffByUnit = new Map(),
        reportRows = new Map(),
        fileIds = [],
        newsIds = [],
        inboxIds = [],
        auditStart = db
          .prepare("SELECT COALESCE(MAX(id),0) id FROM audits")
          .get().id;
      const now = new Date().toISOString();
      for (const a of definitions) {
        const assignment = a.unitName ? unitRecords.get(a.unitName) : null;
        const id = Number(
          db
            .prepare(
              "INSERT INTO users(username,name,password_hash,unit_id,work_id,roles,scopes,created_at) VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              a.username,
              a.displayName.startsWith("[สาธิต]")
                ? a.displayName
                : "[สาธิต] " + a.displayName,
              passwordHash,
              assignment?.unit.id || null,
              assignment?.work.id || null,
              JSON.stringify(a.roles),
              JSON.stringify(
                a.key === "head"
                  ? [...unitRecords.values()].map((v) => v.unit.id)
                  : [],
              ),
              now,
            ).lastInsertRowid,
        );
        const user = publicUser(
          db.prepare("SELECT * FROM users WHERE id=?").get(id),
        );
        users.set(a.key, user);
        if (a.unitName) staffByUnit.set(a.unitName, user);
      }
      const admin = users.get("admin"),
        head = users.get("head"),
        pr = users.get("pr");
      for (const user of users.values())
        writeAudit(
          db,
          admin,
          "[สาธิต] เพิ่มบัญชีและกำหนดฝ่าย/งาน",
          "user",
          user.id,
          null,
          user,
        );
      function addFile(assetName, title, owner, purpose, reportId = null) {
        const bytes = assets[assetName],
          storage = "demo-" + randomUUID() + "." + assetName.split(".").at(-1);
        const path = resolve(opened.dataDir, "uploads", storage);
        writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
        createdPaths.push(path);
        const id = Number(
          db
            .prepare(
              "INSERT INTO files(original_name,storage_name,mime,size,title,keywords,purpose,unit_id,work_id,owner_id,activity_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              "[สาธิต] " + assetName,
              storage,
              mimeFor(assetName),
              bytes.length,
              title,
              "สาธิต ข้อมูลสมมติ",
              purpose,
              owner.unit_id,
              owner.work_id,
              owner.id,
              reportId,
              now,
            ).lastInsertRowid,
        );
        fileIds.push(id);
        writeAudit(db, owner, "[สาธิต] นำเข้าไฟล์ตัวอย่าง", "file", id, null, {
          title,
          purpose,
          activity_id: reportId,
          original_name: "[สาธิต] " + assetName,
        });
        return id;
      }
      const linkedReportKeys = new Set(
        inboxScenarios.map((i) => i.activityKey).filter(Boolean),
      );
      for (const r of scenarios) {
        const owner = staffByUnit.get(r.unitName),
          assignment = unitRecords.get(r.unitName);
        const category = db
          .prepare("SELECT id FROM categories WHERE name=? AND active=1")
          .get(r.categoryName);
        if (!owner || !category || assignment.work.name !== r.workName)
          throw Error("ข้อมูลสาธิตไม่ตรงกับโครงสร้าง: " + r.key);
        const input = activitySchema.parse({
          ...r,
          unit_id: owner.unit_id,
          work_id: owner.work_id,
          category_id: category.id,
        });
        const timestamp = input.date + "T03:00:00.000Z";
        const id = Number(
          db
            .prepare(
              "INSERT INTO activities(title,date,unit_id,work_id,category_id,area,workers,result,metrics,status,source,owner_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              input.title,
              input.date,
              input.unit_id,
              input.work_id,
              input.category_id,
              input.area,
              input.workers,
              input.result,
              JSON.stringify(input.metrics),
              input.status,
              linkedReportKeys.has(r.key) ? "line" : "web",
              owner.id,
              timestamp,
              timestamp,
            ).lastInsertRowid,
        );
        const row = db.prepare("SELECT * FROM activities WHERE id=?").get(id);
        reportRows.set(r.key, row);
        writeAudit(
          db,
          owner,
          "[สาธิต] สร้างรายการงานตัวอย่าง",
          "activity",
          id,
          null,
          row,
        );
        if (input.status === "ready")
          writeAudit(
            db,
            head,
            "[สาธิต] ตัวอย่างหัวหน้าตรวจข้อมูลพร้อมสรุป",
            "activity",
            id,
            { ...row, status: "pending" },
            row,
          );
      }
      const covers = new Map();
      for (const [key, report] of reportRows) {
        const owner = [...staffByUnit.values()].find(
          (u) => u.id === report.owner_id,
        );
        const scenario = scenarios.find((r) => r.key === key);
        // Evidence matches the figures in these specific fictional reports.
        if (key === "health-promotion-1")
          addFile(
            "health-report.pdf",
            report.title,
            owner,
            "evidence",
            report.id,
          );
        if (key === "food-sanitation-1")
          addFile(
            "sanitation-checklist.pdf",
            report.title,
            owner,
            "evidence",
            report.id,
          );
        if (newsScenarios.some((n) => n.activityKey === key)) {
          const imageName =
            scenario.unitName === "ฝ่ายส่งเสริมสุขภาพ"
              ? "health-outreach.png"
              : scenario.unitName === "ฝ่ายป้องกันและควบคุมโรค"
                ? "dengue-survey.png"
                : scenario.unitName === "ฝ่ายส่งเสริมสิ่งแวดล้อม"
                  ? "waste-sorting.png"
                  : null;
          if (imageName)
            covers.set(
              key,
              addFile(
                imageName,
                report.title + " — ภาพประกอบสาธิต",
                owner,
                "evidence",
                report.id,
              ),
            );
        }
      }
      const primaryStaff = staffByUnit.get("ฝ่ายส่งเสริมสุขภาพ");
      addFile(
        "sanitation-checklist.pdf",
        "[สาธิต] แบบตรวจสุขาภิบาลสำหรับฝึกนำเข้า",
        primaryStaff,
        "archive",
      );
      addFile(
        "activity-summary.xlsx",
        "[สาธิต] ตารางสรุปกิจกรรมสำหรับค้นหาและดาวน์โหลด",
        primaryStaff,
        "archive",
      );
      addFile(
        "health-outreach.png",
        "[สาธิต] ภาพประกอบกิจกรรมในคลังเอกสาร",
        primaryStaff,
        "archive",
      );
      addFile(
        "sanitation-checklist.pdf",
        "[สาธิต] หลักฐานรอเชื่อมกับรายงานใหม่",
        primaryStaff,
        "evidence",
      );
      for (const n of newsScenarios) {
        const report = reportRows.get(n.activityKey),
          cover = covers.get(n.activityKey) || null;
        if (report?.status !== "ready")
          throw Error("ข่าวสาธิตต้องอ้างอิงรายงานพร้อมสรุป");
        const published = n.status === "published";
        const unitName = scenarios.find(
          (r) => r.key === n.activityKey,
        ).unitName;
        const id = Number(
          db
            .prepare(
              "INSERT INTO news(activity_id,title,body,image_ids,cover_id,status,author_id,published_by,published_at,activity_date,activity_area,publication_unit_id,publication_unit_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(
              report.id,
              n.title,
              n.body,
              JSON.stringify(cover ? [cover] : []),
              cover,
              n.status,
              pr.id,
              published ? pr.id : null,
              published ? now : null,
              published ? report.date : null,
              published ? report.area : null,
              published ? report.unit_id : null,
              published ? unitName : null,
              now,
              now,
            ).lastInsertRowid,
        );
        newsIds.push(id);
        writeAudit(
          db,
          pr,
          published
            ? "[สาธิต] เผยแพร่ข่าวตัวอย่างบนฟีดภายใน"
            : "[สาธิต] จัดทำฉบับร่างข่าว",
          "news",
          id,
          null,
          { ...n, line_status: "not_sent" },
        );
      }
      for (const i of inboxScenarios) {
        const owner = staffByUnit.get(i.unitName),
          report = i.activityKey ? reportRows.get(i.activityKey) : null;
        if (!owner) throw Error("ไม่พบบัญชีผู้รายงานจำลอง");
        const lineId =
          "U" +
          createHash("sha256")
            .update("local-only-demo:" + owner.username)
            .digest("hex")
            .slice(0, 32);
        const id = Number(
          db
            .prepare(
              "INSERT INTO inbox(event_id,line_user_id,owner_id,group_id,kind,text,activity_id,received_at) VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              "demo:" + datasetKey + ":" + i.key,
              lineId,
              owner.id,
              "demo-local-simulation",
              "text",
              i.text,
              report?.id || null,
              i.reportedAt || now,
            ).lastInsertRowid,
        );
        inboxIds.push(id);
        writeAudit(
          db,
          admin,
          "[สาธิต] เพิ่มข้อความ LINE จำลองในเครื่อง (ไม่มีการรับส่งจริง)",
          "inbox",
          id,
          null,
          { text: i.text, activity_id: report?.id || null },
        );
      }
      const manifest = {
        key: datasetKey,
        createdAt: now,
        today,
        userIds: [...users.values()].map((u) => u.id),
        activityIds: [...reportRows.values()].map((r) => r.id),
        fileIds,
        newsIds,
        inboxIds,
        auditStart,
        credentialsFile: "demo/accounts.md",
        backupPath,
        counts: {
          accounts: users.size,
          activities: reportRows.size,
          ready: scenarios.filter((r) => r.status === "ready").length,
          pending: scenarios.filter((r) => r.status === "pending").length,
          files: fileIds.length,
          publishedNews: newsScenarios.filter((n) => n.status === "published")
            .length,
          draftNews: newsScenarios.filter((n) => n.status === "draft").length,
          simulatedInbox: inboxIds.length,
          unlinkedInbox: inboxScenarios.filter((i) => !i.activityKey).length,
        },
      };
      db.prepare(
        "INSERT INTO demo_datasets(key,manifest_json) VALUES(?,?)",
      ).run(datasetKey, JSON.stringify(manifest));
      return manifest;
    });
    committed = true;
    return { alreadySeeded: false, manifest, accountsPath, backupPath };
  } catch (error) {
    if (!committed) {
      for (const path of createdPaths) await rm(path, { force: true });
      if (accountFileCreated) await rm(accountsPath, { force: true });
    }
    throw error;
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await seedDemo();
    console.log(
      result.alreadySeeded
        ? "มีชุดสาธิตนี้แล้ว ไม่เพิ่มซ้ำหรือเขียนทับข้อมูล"
        : "เพิ่มข้อมูลสาธิตเรียบร้อยแล้ว",
    );
    console.log(JSON.stringify(result.manifest.counts));
    console.log("บัญชีและรหัสผ่านส่วนตัว: " + result.accountsPath);
    if (result.backupPath)
      console.log("ชุดสำรองก่อนเพิ่มข้อมูล: " + result.backupPath);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
