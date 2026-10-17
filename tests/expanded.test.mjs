import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";
import {
  reportPeriod,
  summarizeRows,
  runSchedules,
} from "../server/insights.js";
import { ruleExtract } from "../server/extraction.js";
import { docxDocument } from "../server/report-document.js";

describe(
  "Expanded reporting and reconciliation",
  { concurrency: false },
  () => {
    let app, server, base, dir, db;
    const accounts = {};
    const secret = "expanded-line-secret";
    const oldSecret = process.env.LINE_CHANNEL_SECRET,
      oldGroup = process.env.LINE_REPORT_GROUP_ID;
    const password = "Expanded-password-2026!";
    let staffId, peerId, headId, unit, work, category, first, duplicate;
    async function req(path, { as = "staff", method = "GET", body } = {}) {
      const a = accounts[as];
      const response = await fetch(base + "/api" + path, {
        method,
        headers: {
          Origin: "http://localhost:5173",
          ...(a ? { Cookie: a.cookie, "X-CSRF-Token": a.csrf } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const type = response.headers.get("content-type") || "";
      return {
        status: response.status,
        body: type.includes("json")
          ? await response.json()
          : await response.arrayBuffer(),
        headers: response.headers,
      };
    }
    before(async () => {
      dir = await mkdtemp(join(tmpdir(), "rm-expanded-"));
      process.env.LINE_CHANNEL_SECRET = secret;
      process.env.LINE_REPORT_GROUP_ID = "C" + "b".repeat(32);
      app = createApp({ dataDir: dir, disableRateLimit: true });
      db = app.locals.db;
      unit = db
        .prepare("SELECT id FROM units WHERE name='ฝ่ายส่งเสริมสุขภาพ'")
        .get().id;
      work = db
        .prepare("SELECT id FROM works WHERE unit_id=? LIMIT 1")
        .get(unit).id;
      category = db.prepare("SELECT id FROM categories LIMIT 1").get().id;
      const hash = await hashPassword(password);
      for (const [name, roles, scopes] of [
        ["staff", ["staff"], []],
        ["peer", ["staff"], []],
        ["head", ["head"], [unit]],
        ["admin", ["admin"], []],
        ["exec", ["executive"], []],
        ["pr", ["pr"], []],
      ]) {
        const id = Number(
          db
            .prepare(
              "INSERT INTO users(username,name,password_hash,unit_id,work_id,roles,scopes) VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              name,
              name,
              hash,
              unit,
              work,
              JSON.stringify(roles),
              JSON.stringify(scopes),
            ).lastInsertRowid,
        );
        if (name === "staff") staffId = id;
        if (name === "peer") peerId = id;
        if (name === "head") headId = id;
      }
      server = app.listen(0, "127.0.0.1");
      await new Promise((r) => server.once("listening", r));
      base = "http://127.0.0.1:" + server.address().port;
      for (const name of ["staff", "peer", "head", "admin", "exec", "pr"]) {
        const r = await req("/auth/login", {
          as: null,
          method: "POST",
          body: { username: name, password },
        });
        assert.equal(r.status, 200);
        accounts[name] = {
          cookie: r.headers.get("set-cookie").split(";")[0],
          csrf: r.body.csrf,
        };
      }
    });
    after(async () => {
      await new Promise((r) => server.close(r));
      db.close();
      await rm(dir, { recursive: true, force: true });
      if (oldSecret === undefined) delete process.env.LINE_CHANNEL_SECRET;
      else process.env.LINE_CHANNEL_SECRET = oldSecret;
      if (oldGroup === undefined) delete process.env.LINE_REPORT_GROUP_ID;
      else process.env.LINE_REPORT_GROUP_ID = oldGroup;
    });
    const payload = (extra = {}) => ({
      title: "ประชุม อสม. ชุมชน ก",
      date: "2026-09-12",
      unit_id: unit,
      work_id: work,
      category_id: category,
      area: "ชุมชน ก",
      workers: "เจ้าหน้าที่",
      result: "ประชุมสำเร็จ ผู้เข้าร่วม 19 คน",
      metrics: [
        { label: "ผู้เข้าร่วม", value: 19, unit: "คน" },
        { label: "บริการรวม", value: 29, unit: "ครั้งบริการ" },
      ],
      status: "ready",
      ...extra,
    });
    it("uses real calendar and fiscal boundaries, including leap days", () => {
      assert.deepEqual(
        [
          reportPeriod({ period: "month", year: 2024, month: 2 }).from,
          reportPeriod({ period: "month", year: 2024, month: 2 }).to,
        ],
        ["2024-02-01", "2024-02-29"],
      );
      const q = reportPeriod({ period: "quarter", year: 2027, quarter: 1 });
      assert.equal(q.from, "2026-10-01");
      assert.equal(q.to, "2026-12-31");
      const y = reportPeriod({ period: "year", year: 2027 });
      assert.equal(y.to, "2027-09-30");
      assert.throws(() =>
        reportPeriod({
          period: "custom",
          from: "2026-09-30",
          to: "2026-09-01",
        }),
      );
    });
    it("normalizes only compatible units and applies configured max/latest rules", () => {
      const rows = [
        {
          id: 1,
          status: "ready",
          date: "2026-09-01",
          unit_id: 1,
          unit_name: "A",
          metrics: [
            { label: "ขยะที่เก็บ", value: 500, unit: "กิโลกรัม" },
            { label: "ระดับ", value: 8, unit: "แห่ง" },
          ],
        },
        {
          id: 2,
          status: "ready",
          date: "2026-09-02",
          unit_id: 1,
          unit_name: "A",
          metrics: [
            { label: "ปริมาณขยะ", value: 2, unit: "ตัน" },
            { label: "ระดับ", value: 4, unit: "แห่ง" },
          ],
        },
      ];
      const defs = [
        {
          active: true,
          unit_ids: [],
          metrics: [
            {
              label: "ปริมาณขยะ",
              aliases: ["ขยะที่เก็บ"],
              unit: "ตัน",
              aggregation: "sum",
            },
            {
              label: "ระดับ",
              aliases: [],
              unit: "แห่ง",
              aggregation: "latest",
            },
          ],
        },
      ];
      const out = summarizeRows(rows, defs);
      assert.equal(out.metrics.find((m) => m.unit === "ตัน").value, 2.5);
      assert.equal(out.metrics.find((m) => m.label === "ระดับ").value, 4);
    });
    it("keeps people, service counts, and waste quantities distinct and filters by actual dates", async () => {
      first = (await req("/activities", { method: "POST", body: payload() }))
        .body;
      duplicate = (
        await req("/activities", { method: "POST", body: payload() })
      ).body;
      await req("/activities", {
        method: "POST",
        body: payload({
          title: "เก็บขยะ",
          date: "2026-08-12",
          metrics: [{ label: "ปริมาณขยะ", value: 2, unit: "ตัน" }],
        }),
      });
      const r = await req("/insights?period=month&year=2026&month=9");
      assert.equal(r.status, 200);
      assert.equal(r.body.ready, 2);
      assert.equal(r.body.metrics.find((m) => m.unit === "คน").value, 38);
      assert.equal(
        r.body.metrics.find((m) => m.unit === "ครั้งบริการ").value,
        58,
      );
      assert(!r.body.metrics.some((m) => m.unit === "ตัน"));
      assert.equal(r.body.comparison.ready, 1);
      assert.equal(r.body.activities.length, 2);
    });
    it("permits shared reads and only owner/scoped head changes", async () => {
      assert.equal(
        (await req("/insights?period=month&year=2026&month=9", { as: "peer" }))
          .status,
        200,
      );
      assert.equal(
        (
          await req("/activities/" + first.id, {
            as: "peer",
            method: "PUT",
            body: { ...payload(), version: first.version },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await req("/report-settings", {
            as: "staff",
            method: "PUT",
            body: {},
          })
        ).status,
        403,
      );
      const t = await req("/report-templates");
      assert(t.body.length >= 5);
      const x = await req("/report-templates/" + t.body[0].id, {
        as: "admin",
        method: "PUT",
        body: { ...t.body[0], name: "แม่แบบแก้ไขได้จริง" },
      });
      assert.equal(x.status, 200);
      assert.equal(x.body.version, 2);
      assert.equal(
        (
          await req("/report-templates/" + t.body[0].id, {
            as: "admin",
            method: "PUT",
            body: t.body[0],
          })
        ).status,
        409,
      );
    });
    it("preserves duplicate source records, excludes duplicates from both dashboards, and restores safely", async () => {
      const merge = await req("/duplicates/merge", {
        method: "POST",
        body: {
          duplicate_id: duplicate.id,
          canonical_id: first.id,
          confirmed: true,
        },
      });
      assert.equal(merge.status, 200);
      assert.equal(
        (await req("/insights?period=month&year=2026&month=9")).body.ready,
        1,
      );
      assert.equal(
        (await req("/dashboard?from=2026-09-01&to=2026-09-30")).body.ready,
        1,
      );
      const source = await req("/activities/" + duplicate.id);
      assert.equal(source.status, 200);
      assert.equal(source.body.duplicate_of, first.id);
      assert.equal(
        (
          await req("/duplicates/" + duplicate.id + "/restore", {
            as: "peer",
            method: "POST",
            body: {},
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await req("/duplicates/" + duplicate.id + "/restore", {
            method: "POST",
            body: {},
          })
        ).status,
        200,
      );
      assert.equal(
        (await req("/insights?period=month&year=2026&month=9")).body.ready,
        2,
      );
    });
    it("makes immutable report snapshots and exports real DOCX bytes", async () => {
      const report = await req("/report-exports", {
        method: "POST",
        body: { period: "month", year: 2026, month: 9, unit: "", mine: "0" },
      });
      assert.equal(report.status, 201);
      const exportId = report.body.id;
      assert.equal(report.body.ready, 2);
      const current = (await req("/activities/" + first.id)).body;
      assert.equal(
        (
          await req("/activities/" + first.id, {
            method: "PUT",
            body: {
              ...payload(),
              version: current.version,
              metrics: [{ label: "ผู้เข้าร่วม", value: 99, unit: "คน" }],
            },
          })
        ).status,
        200,
      );
      assert.equal(
        (await req("/report-exports/" + exportId)).body.metrics.find(
          (m) => m.unit === "คน",
        ).value,
        38,
      );
      const doc = await req(
        "/report-exports/" + exportId + "/download?format=docx",
      );
      assert.equal(doc.status, 200);
      assert.equal(
        Buffer.from(doc.body).subarray(0, 4).toString("hex"),
        "504b0304",
      );
      assert(Buffer.from(doc.body).includes(Buffer.from("word/document.xml")));
      const html = await req(
        "/report-exports/" + exportId + "/download?format=html",
      );
      assert(
        Buffer.from(html.body)
          .toString()
          .includes("ฉบับที่ " + exportId),
      );
    });
    it("links existing reports to projects and computes only supported target ratios", async () => {
      const p = await req("/projects", {
        method: "POST",
        body: {
          name: "โครงการ อสม.",
          unit_id: unit,
          targets: [{ label: "ผู้เข้าร่วม", value: 200, unit: "คน" }],
        },
      });
      assert.equal(p.status, 201);
      assert.equal(
        (
          await req("/activities/" + first.id + "/project", {
            as: "peer",
            method: "PUT",
            body: { project_id: p.body.id },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await req("/activities/" + first.id + "/project", {
            method: "PUT",
            body: { project_id: p.body.id },
          })
        ).status,
        200,
      );
      const detail = await req("/projects/" + p.body.id, { as: "exec" });
      assert.equal(detail.body.summary.ready, 1);
      assert.equal(detail.body.progress[0].actual, 99);
      assert.equal(detail.body.progress[0].percent, 49.5);
    });
    it("locks reporting periods, blocks owner writes and merges, and audits head reopening", async () => {
      const lock = await req("/period-locks", {
        as: "head",
        method: "POST",
        body: {
          unit_id: unit,
          date_from: "2026-09-01",
          date_to: "2026-09-30",
          reason: "ตรวจยอดสิ้นเดือนแล้ว",
        },
      });
      assert.equal(lock.status, 201);
      const a = (await req("/activities/" + first.id)).body;
      assert.equal(a.locked, true);
      assert.equal(
        (
          await req("/activities/" + first.id, {
            method: "PUT",
            body: { ...payload(), version: a.version },
          })
        ).status,
        423,
      );
      assert.equal(
        (
          await req("/duplicates/merge", {
            method: "POST",
            body: {
              duplicate_id: duplicate.id,
              canonical_id: first.id,
              confirmed: true,
            },
          })
        ).status,
        423,
      );
      assert.equal(
        (
          await req("/period-locks/" + lock.body.id + "/reopen", {
            as: "staff",
            method: "POST",
            body: { reason: "แก้ผิด" },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await req("/period-locks/" + lock.body.id + "/reopen", {
            as: "head",
            method: "POST",
            body: { reason: "มีหลักฐานเพิ่มเติม" },
          })
        ).status,
        200,
      );
    });
    it("offers rules honestly, retains unknowns, and applies suggestions only as pending", async () => {
      const text =
        "วันที่ 12 กันยายน 2569 รายงานประชุม อสม.\nสถานที่: ชุมชน ก\nผู้เข้าร่วม 19 คน บริการรวม 29 ครั้งบริการ";
      const rule = ruleExtract(text, []);
      assert.equal(rule.activities[0].date, "2026-09-12");
      assert.equal(rule.activities[0].workers, "");
      assert.equal(rule.activities[0].metrics[1].value, 29);
      assert.equal(
        ruleExtract("รายงานประชุมวันที่ 12 กันยายน", []).activities[0].date,
        null,
      );
      const a = await req("/activities", {
        method: "POST",
        body: {
          title: "ต้นฉบับ",
          unit_id: unit,
          intake: true,
          source_text: text,
          status: "pending",
        },
      });
      assert.equal(a.status, 201);
      const extract = await req("/activities/" + a.body.id + "/extract", {
        method: "POST",
        body: {},
      });
      assert.equal(extract.status, 200);
      assert.equal(extract.body.engine, "rules");
      assert.equal(
        (
          await req("/activities/" + a.body.id + "/apply-extraction", {
            method: "POST",
            body: {
              run_id: extract.body.id,
              index: 0,
              version: a.body.version,
            },
          })
        ).status,
        200,
      );
      const saved = (await req("/activities/" + a.body.id)).body;
      assert.equal(saved.status, "pending");
      assert.equal(saved.metrics[0].value, 19);
      assert.equal(
        (await req("/activities/" + a.body.id + "/extractions", { as: "peer" }))
          .status,
        403,
      );
    });
    it("creates expiring LINE link codes without changing roles and safely accepts webhook redelivery", async () => {
      const link = await req("/me/line-link-code", {
        method: "POST",
        body: {},
      });
      assert.equal(link.status, 200);
      const lineId = "U" + "e".repeat(32);
      const event = {
        webhookEventId: "link-once",
        type: "message",
        timestamp: Date.now(),
        source: { type: "user", userId: lineId },
        message: { type: "text", text: link.body.command },
      };
      const send = async (ev) => {
        const raw = JSON.stringify({ events: [ev] });
        return fetch(base + "/api/line/webhook", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-line-signature": createHmac("sha256", secret)
              .update(raw)
              .digest("base64"),
          },
          body: raw,
        });
      };
      assert.equal((await send(event)).status, 200);
      assert.equal((await send(event)).status, 200);
      const user = db.prepare("SELECT * FROM users WHERE id=?").get(staffId);
      assert.equal(user.line_user_id, lineId);
      assert.equal(user.roles, '["staff"]');
      assert.equal(user.active, 1);
    });
    it("creates completed reporting periods once even after repeated scheduler runs", async () => {
      const r = await req("/report-settings", {
        as: "admin",
        method: "PUT",
        body: {
          fiscal_start_month: 10,
          scheduled_reports: true,
          report_periods: ["month", "quarter", "year"],
          line_reply_enabled: false,
        },
      });
      assert.equal(r.status, 200);
      const first = runSchedules(db, new Date("2026-10-01T02:00:00Z"));
      assert(first.created > 0);
      assert.equal(
        runSchedules(db, new Date("2026-10-01T02:00:00Z")).created,
        0,
      );
      assert(
        db
          .prepare(
            "SELECT id FROM report_exports WHERE schedule_key LIKE 'year:2025-10-01:2026-09-30:%'",
          )
          .get(),
      );
    });

    it("retains collaborators without duplicate totals and searches them", async () => {
      const a = (await req("/activities/" + first.id)).body;
      const before = (await req("/insights?period=month&year=2026&month=9"))
        .body.ready;
      const saved = await req("/activities/" + first.id, {
        method: "PUT",
        body: {
          ...a,
          collaborators: ["โรงพยาบาลขอนแก่น", "อสม. ชุมชน", "โรงพยาบาลขอนแก่น"],
        },
      });
      assert.equal(saved.status, 200);
      assert.equal(saved.body.collaborators.length, 2);
      assert(
        (
          await req("/activities?q=" + encodeURIComponent("โรงพยาบาลขอนแก่น"))
        ).body.items.some((x) => x.id === a.id),
      );
      assert.equal(
        (await req("/insights?period=month&year=2026&month=9")).body.ready,
        before,
      );
      const legacy = { ...saved.body };
      delete legacy.collaborators;
      assert.equal(
        (await req("/activities/" + a.id, { method: "PUT", body: legacy })).body
          .collaborators.length,
        2,
      );
      const cal = await req("/activity-calendar?month=2026-09");
      assert.equal(cal.status, 200);
      assert(cal.body.every((x) => x.date.startsWith("2026-09")));
      assert.equal((await req("/activity-calendar?month=2026-13")).status, 400);
    });
    it("keeps PR nomination separate from publishing and persists scoped discussion", async () => {
      assert.equal(
        (
          await req("/news-candidates", {
            as: "peer",
            method: "POST",
            body: { activity_id: first.id },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await req("/news-candidates", {
            method: "POST",
            body: { activity_id: first.id },
          })
        ).status,
        201,
      );
      const news = await req("/news", {
        as: "pr",
        method: "POST",
        body: {
          activity_id: first.id,
          title: "ข่าวจากรายงานยืนยัน",
          body: "ประชุม อสม. ตรวจข้อมูลก่อนเผยแพร่",
        },
      });
      assert.equal(news.status, 201);
      const id = news.body.id;
      assert.equal((await req("/news/" + id + "/discussion")).status, 404);
      assert.equal(
        (
          await req("/news/" + id + "/comments", {
            method: "POST",
            body: { body: "ก่อนเผยแพร่" },
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await req("/news/" + id + "/publish", {
            as: "pr",
            method: "POST",
            body: { version: news.body.version },
          })
        ).status,
        200,
      );
      for (let i = 0; i < 2; i++)
        assert.equal(
          (
            await req("/news/" + id + "/like", {
              method: "PUT",
              body: { liked: true },
            })
          ).status,
          200,
        );
      assert.equal((await req("/news/" + id + "/discussion")).body.likes, 1);
      const comment = await req("/news/" + id + "/comments", {
        method: "POST",
        body: { body: "ข้อความ <script> ไม่ถูกประมวลผลเป็น HTML" },
      });
      assert.equal(comment.status, 201);
      assert.equal(
        (
          await req("/news-comments/" + comment.body.id, {
            as: "peer",
            method: "DELETE",
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await req("/news-comments/" + comment.body.id, {
            as: "pr",
            method: "DELETE",
          })
        ).status,
        200,
      );
      assert.equal(
        (await req("/news/" + id + "/discussion")).body.comments.length,
        0,
      );
    });
    it("allows scoped heads to resolve amendment requests with audit and retains snapshot history", async () => {
      const lock = await req("/period-locks", {
        as: "head",
        method: "POST",
        body: {
          unit_id: unit,
          date_from: "2026-09-01",
          date_to: "2026-09-30",
          reason: "ปิดรอบสำหรับทดสอบคำขอ",
        },
      });
      assert.equal(lock.status, 201);
      assert.equal(
        (
          await req("/activities/" + first.id + "/amendment-requests", {
            as: "peer",
            method: "POST",
            body: { reason: "แก้ข้อมูลที่ไม่ใช่ของตน" },
          })
        ).status,
        403,
      );
      const request = await req(
        "/activities/" + first.id + "/amendment-requests",
        { method: "POST", body: { reason: "จำนวนผู้เข้าร่วมคลาดเคลื่อน" } },
      );
      assert.equal(request.status, 201);
      assert.equal(
        (
          await req("/activities/" + first.id + "/amendment-requests", {
            method: "POST",
            body: { reason: "ส่งคำขอเดิมซ้ำ" },
          })
        ).status,
        409,
      );
      const path = "/amendment-requests/" + request.body.id + "/resolve",
        body = { decision: "approve", reason: "ตรวจหลักฐานแล้วให้แก้ไข" };
      assert.equal(
        (await req(path, { as: "peer", method: "POST", body })).status,
        403,
      );
      assert.equal(
        (await req(path, { as: "head", method: "POST", body })).status,
        200,
      );
      assert.equal((await req("/activities/" + first.id)).body.locked, false);
      assert.equal(
        (await req(path, { as: "head", method: "POST", body })).status,
        409,
      );
      assert.equal(
        (await req("/amendment-requests", { as: "peer" })).body.length,
        0,
      );
    });
    it("reports actual admin state without exposing report text or credentials", async () => {
      assert.equal((await req("/system-status")).status, 403);
      const r = await req("/system-status", { as: "admin" });
      assert.equal(r.status, 200);
      assert.equal(r.body.accounts.total, 6);
      assert(!JSON.stringify(r.body).includes(secret));
      assert(!Object.hasOwn(r.body, "activities"));
    });
    it("validates AI draft references and requires owner review before immutable export", async () => {
      const snapshot = await req("/report-exports", {
        method: "POST",
        body: { period: "month", year: 2026, month: 9 },
      });
      assert.equal(snapshot.status, 201);
      const oldModel = process.env.OLLAMA_MODEL,
        oldBase = process.env.OLLAMA_BASE_URL;
      let bad = true;
      const mock = createServer(async (req, res) => {
        for await (const chunk of req) {
        }
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                sections: [
                  {
                    heading: "ผลการดำเนินงาน",
                    body: "สรุปกิจกรรมประชุม อสม. ตามรายงาน",
                    activity_ids: [bad ? 999999 : first.id],
                  },
                ],
              }),
            },
          }),
        );
      });
      mock.listen(0, "127.0.0.1");
      await new Promise((r) => mock.once("listening", r));
      try {
        delete process.env.OLLAMA_MODEL;
        assert.equal(
          (
            await req("/report-exports/" + snapshot.body.id + "/drafts", {
              method: "POST",
              body: {},
            })
          ).status,
          503,
        );
        process.env.OLLAMA_MODEL = "mock-contract-only";
        process.env.OLLAMA_BASE_URL = "http://127.0.0.1:" + mock.address().port;
        assert.equal(
          (
            await req("/report-exports/" + snapshot.body.id + "/drafts", {
              method: "POST",
              body: {},
            })
          ).status,
          422,
        );
        bad = false;
        const draft = await req(
          "/report-exports/" + snapshot.body.id + "/drafts",
          { method: "POST", body: {} },
        );
        assert.equal(draft.status, 201);
        const path = "/report-drafts/" + draft.body.id;
        assert.equal((await req(path + "/download")).status, 409);
        const body = {
          version: draft.body.version,
          sections: draft.body.sections,
          confirm: true,
        };
        assert.equal(
          (await req(path, { as: "peer", method: "PUT", body })).status,
          403,
        );
        assert.equal((await req(path, { method: "PUT", body })).status, 200);
        assert.equal((await req(path, { method: "PUT", body })).status, 409);
        const doc = await req(path + "/download?format=docx");
        assert.equal(doc.status, 200);
        assert.equal(Buffer.from(doc.body).subarray(0, 2).toString(), "PK");
        assert.deepEqual(
          (await req("/report-exports/" + snapshot.body.id)).body.metrics,
          snapshot.body.metrics,
        );
      } finally {
        await new Promise((r) => mock.close(r));
        if (oldModel === undefined) delete process.env.OLLAMA_MODEL;
        else process.env.OLLAMA_MODEL = oldModel;
        if (oldBase === undefined) delete process.env.OLLAMA_BASE_URL;
        else process.env.OLLAMA_BASE_URL = oldBase;
      }
    });
    it("supports custom units and budgets without mixing incompatible quantities", async () => {
      const saved = await req("/activities", {
        method: "POST",
        body: payload({
          date: "2026-10-03",
          metrics: [
            { label: "ค่าใช้จ่ายจริง", value: 1200, unit: "บาท" },
            { label: "ชุดอุปกรณ์", value: 3, unit: "ชุด" },
          ],
        }),
      });
      assert.equal(saved.status, 201);
      const totals = (await req("/insights?period=month&year=2026&month=10"))
        .body.metrics;
      assert.equal(totals.find((m) => m.unit === "บาท").value, 1200);
      assert.equal(totals.find((m) => m.unit === "ชุด").value, 3);
      assert.equal(
        (
          await req("/activities", {
            method: "POST",
            body: payload({
              metrics: [{ label: "ไม่ทราบหน่วย", value: 3, unit: "" }],
            }),
          })
        ).status,
        400,
      );
    });
  },
);
