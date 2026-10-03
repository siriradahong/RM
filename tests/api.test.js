import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";
import { openDatabase } from "../server/db.js";

describe(
  "Persistent API, authorization and reporting flows",
  { concurrency: false },
  () => {
    let app,
      server,
      base,
      dir,
      accounts = {},
      activityId,
      fileId,
      newsId,
      assignedWorks = {};
    const password = "Test-password-2026!";
    async function request(
      path,
      {
        as = "staff",
        method = "GET",
        body,
        csrf = true,
        origin = "http://localhost:5173",
      } = {},
    ) {
      const a = accounts[as];
      const headers = {
        ...(a ? { Cookie: a.cookie } : {}),
        Origin: origin,
        ...(csrf && a ? { "X-CSRF-Token": a.csrf } : {}),
      };
      if (body && !(body instanceof FormData))
        headers["Content-Type"] = "application/json";
      const response = await fetch(base + path, {
        method,
        headers,
        body: body
          ? body instanceof FormData
            ? body
            : JSON.stringify(body)
          : undefined,
      });
      const json = await response.json().catch(() => null);
      return { status: response.status, json, headers: response.headers };
    }
    async function login(username) {
      const r = await request("/auth/login", {
        as: null,
        method: "POST",
        body: { username, password },
      });
      assert.equal(r.status, 200);
      accounts[username] = {
        cookie: r.headers.get("set-cookie").split(";")[0],
        csrf: r.json.csrf,
      };
      return r;
    }
    function uploadForm(unit = 1, work, title = "ชื่อเรื่องจากหน้านำเข้า") {
      const form = new FormData();
      form.append(
        "file",
        new Blob(["%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"], {
          type: "application/pdf",
        }),
        "assignment.pdf",
      );
      form.append("unit_id", String(unit));
      if (work !== undefined) form.append("work_id", String(work));
      form.append("purpose", "evidence");
      form.append("title", title);
      return form;
    }
    const payload = () => ({
      title: "ประชุมเครือข่าย อสม.",
      date: "2026-09-18",
      unit_id: 1,
      category_id: 1,
      area: "ชุมชนตัวอย่าง",
      workers: "เจ้าหน้าที่และ อสม.",
      result: "จัดประชุม 1 ครั้ง มีผู้เข้าร่วม 32 คน",
      metrics: [
        { label: "จัดประชุม", value: 1, unit: "ครั้ง" },
        { label: "ผู้เข้าร่วม", value: 32, unit: "คน" },
      ],
      status: "ready",
    });
    before(async () => {
      dir = await mkdtemp(join(tmpdir(), "rm-api-"));
      app = createApp({ dataDir: dir, disableRateLimit: true });
      const hash = await hashPassword(password);
      for (const unit of [1, 2])
        assignedWorks[unit] = app.locals.db
          .prepare("SELECT id FROM works WHERE unit_id=? ORDER BY id LIMIT 1")
          .get(unit).id;
      for (const [username, roles, unit, scopes] of [
        ["staff", ["staff"], 1, []],
        ["peer", ["staff"], 1, []],
        ["outside", ["staff"], 2, []],
        ["head", ["head"], 1, [1]],
        ["admin", ["admin"], null, []],
        ["pr", ["pr"], 1, []],
        ["executive", ["executive"], null, []],
        ["multi", ["staff", "pr"], 1, []],
        ["hybrid", ["staff", "head"], 1, [2]],
        ["legacy", ["staff"], 1, []],
      ])
        app.locals.db
          .prepare(
            "INSERT INTO users(username,name,password_hash,unit_id,work_id,roles,scopes) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            username,
            username,
            hash,
            unit,
            roles.includes("staff") && username !== "legacy"
              ? assignedWorks[unit]
              : null,
            JSON.stringify(roles),
            JSON.stringify(scopes),
          );
      server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
      });
      base = `http://127.0.0.1:${server.address().port}/api`;
      for (const u of [
        "staff",
        "peer",
        "outside",
        "head",
        "admin",
        "pr",
        "executive",
        "multi",
        "hybrid",
        "legacy",
      ])
        await login(u);
    });
    after(async () => {
      await new Promise((resolve) => server.close(resolve));
      app.locals.db.close();
      await rm(dir, { recursive: true, force: true });
      delete process.env.LINE_CHANNEL_SECRET;
      delete process.env.LINE_REPORT_GROUP_ID;
    });
    it("provides the complete organization and preserves original unit IDs", async () => {
      const { json: meta } = await request("/meta");
      assert.equal(meta.units.filter((u) => u.kind === "section").length, 2);
      assert.equal(meta.units.filter((u) => u.kind === "division").length, 8);
      assert.equal(meta.units.filter((u) => u.kind === "group").length, 1);
      assert.equal(meta.works.length, 30);
      assert.equal(
        meta.units.find((u) => u.id === 1).name,
        "ฝ่ายส่งเสริมสุขภาพ",
      );
      assert.equal(
        meta.units.find((u) => u.id === 2).name,
        "ฝ่ายป้องกันและควบคุมโรค",
      );
      assert.equal(
        meta.units.find((u) => u.id === 3).name,
        "ฝ่ายบริการสิ่งแวดล้อม",
      );
      const pharmacy = meta.works.find((w) => w.name === "งานเภสัชกรรม");
      assert.equal(
        meta.works.find((w) => w.id === pharmacy.parent_id).name,
        "งานศูนย์บริการสาธารณสุขที่ 3",
      );
      const reopened = openDatabase(dir);
      assert.equal(
        reopened.db.prepare("SELECT count(*) n FROM works").get().n,
        30,
      );
      reopened.db.close();
    });
    it("allows writers to add shared categories, prevents duplicates and restricts management", async () => {
      for (const as of ["staff", "head", "admin"]) {
        const created = await request("/categories", {
          as,
          method: "POST",
          body: { name: "  ประเภทใหม่  " + as + "  ", active: false },
        });
        assert.equal(created.status, 201);
        assert.equal(created.json.name, "ประเภทใหม่ " + as);
        assert.equal(created.json.active, 1);
        assert.equal(
          (
            await request("/categories", {
              as,
              method: "POST",
              body: { name: "ประเภทใหม่ " + as.toUpperCase() },
            })
          ).status,
          409,
        );
        assert.ok(
          app.locals.db
            .prepare(
              "SELECT id FROM audits WHERE entity='categories' AND entity_id=?",
            )
            .get(created.json.id),
        );
      }
      for (const as of ["pr", "executive"])
        assert.equal(
          (
            await request("/categories", {
              as,
              method: "POST",
              body: { name: "ไม่มีสิทธิ์" },
            })
          ).status,
          403,
        );
      assert.equal(
        (
          await request("/admin/categories/1", {
            as: "staff",
            method: "PUT",
            body: { name: "เปลี่ยนชื่อ" },
          })
        ).status,
        403,
      );
      assert.equal(
        (await request("/categories", { method: "POST", body: { name: "  " } }))
          .status,
        400,
      );
    });
    it("saves work under its own division, rejects mismatches, and retains inactive historical assignments", async () => {
      const { json: meta } = await request("/meta");
      const work = meta.works.find((w) => w.id === assignedWorks[1]);
      const wrong = meta.works.find((w) => w.unit_id === 2);
      for (const work_id of [wrong.id, 999999])
        assert.equal(
          (
            await request("/activities", {
              as: "head",
              method: "POST",
              body: { ...payload(), work_id },
            })
          ).status,
          400,
        );
      const created = await request("/activities", {
        method: "POST",
        body: { ...payload(), work_id: work.id },
      });
      assert.equal(created.status, 201);
      const record = (await request("/activities/" + created.json.id)).json;
      assert.equal(record.work_name, work.name);
      assert.equal(
        (await request("/activities?work=" + work.id)).json.total,
        1,
      );
      assert.equal(
        (await request("/activities?work=" + wrong.id)).json.total,
        0,
      );
      assert.equal(
        (
          await request("/admin/works/" + work.id, {
            as: "admin",
            method: "PUT",
            body: { ...work, active: false },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request("/activities", {
            as: "head",
            method: "POST",
            body: { ...payload(), work_id: work.id },
          })
        ).status,
        400,
      );
      for (const [path, body] of [
        ["/activities", payload()],
        ["/files", uploadForm()],
      ]) {
        const denied = await request(path, { method: "POST", body });
        assert.equal(denied.status, 403);
        assert.match(JSON.stringify(denied.json), /ผู้ดูแลระบบ/);
      }
      assert.equal(
        (
          await request("/activities/" + record.id, {
            method: "PUT",
            body: {
              ...record,
              title: "แก้ไขงานเก่า",
              file_ids: [],
              inbox_ids: [],
            },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request("/admin/works/" + work.id, {
            as: "admin",
            method: "PUT",
            body: { ...work, unit_id: 2, active: true },
          })
        ).status,
        400,
      );
      await request("/admin/works/" + work.id, {
        as: "admin",
        method: "PUT",
        body: { ...work, active: true },
      });
      app.locals.db.prepare("DELETE FROM activities WHERE id=?").run(record.id);
    });
    it("validates work parents and limits organization changes to admins", async () => {
      const { json: meta } = await request("/meta");
      const work = meta.works.find((w) => w.id === assignedWorks[1]);
      assert.equal(
        (
          await request("/admin/works", {
            method: "POST",
            body: { name: "งานใหม่", unit_id: 1 },
          })
        ).status,
        403,
      );
      const created = await request("/admin/works", {
        as: "admin",
        method: "POST",
        body: { name: "งานใหม่", unit_id: 1, parent_id: work.id },
      });
      assert.equal(created.status, 201);
      assert.equal(
        (
          await request("/admin/works/" + work.id, {
            as: "admin",
            method: "PUT",
            body: { ...work, active: true, parent_id: created.json.id },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/admin/works", {
            as: "admin",
            method: "POST",
            body: { name: "ผิดฝ่าย", unit_id: 2, parent_id: work.id },
          })
        ).status,
        400,
      );
      const section = meta.units.find((u) => u.kind === "section");
      assert.equal(
        (
          await request("/admin/works", {
            as: "admin",
            method: "POST",
            body: { name: "ผิดระดับ", unit_id: section.id },
          })
        ).status,
        400,
      );
      app.locals.db
        .prepare("DELETE FROM works WHERE id=?")
        .run(created.json.id);
    });
    it("requires a session and never leaks password hashes", async () => {
      assert.equal((await request("/activities", { as: null })).status, 401);
      const me = await request("/auth/me");
      assert.equal(me.json.user.password_hash, undefined);
      assert.equal((await request("/admin/users")).status, 403);
    });
    it("rejects invalid password, forged roles, foreign origins and missing CSRF", async () => {
      assert.equal(
        (
          await request("/auth/login", {
            as: null,
            method: "POST",
            body: { username: "staff", password: "wrong" },
          })
        ).status,
        401,
      );
      assert.equal(
        (
          await request("/activities", {
            method: "POST",
            csrf: false,
            body: payload(),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/activities", {
            method: "POST",
            origin: "https://evil.example",
            body: payload(),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/admin/users", {
            method: "POST",
            body: { roles: ["admin"] },
          })
        ).status,
        403,
      );
    });
    it("starts with zero real work, no demonstration totals", async () => {
      const r = await request("/dashboard");
      assert.equal(r.json.ready, 0);
      assert.equal(r.json.pending, 0);
      assert.equal(r.json.archives, 0);
    });
    it("creates an activity and separates metrics by unit", async () => {
      const r = await request("/activities", {
        method: "POST",
        body: payload(),
      });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      activityId = r.json.id;
      const d = (await request("/dashboard?from=2026-09-01&to=2026-09-30"))
        .json;
      assert.equal(d.ready, 1);
      assert.deepEqual(
        d.metrics.map((m) => [m.value, m.unit]),
        [
          [1, "ครั้ง"],
          [32, "คน"],
        ],
      );
    });
    it("permits internal reads while blocking edits by peers, executives, PR and admin", async () => {
      for (const as of ["peer", "executive", "pr", "admin"]) {
        const r = await request("/activities/" + activityId, { as });
        assert.equal(r.status, 200);
        assert.equal(r.json.can_edit, false);
        assert.equal(
          (
            await request("/activities/" + activityId, {
              as,
              method: "PUT",
              body: { ...payload(), version: 1 },
            })
          ).status,
          403,
        );
      }
      assert.equal(
        (
          await request("/activities", {
            as: "executive",
            method: "POST",
            body: payload(),
          })
        ).status,
        403,
      );
    });
    it("allows responsible head, prevents cross-unit writes and stale overwrites", async () => {
      assert.equal(
        (
          await request("/activities/" + activityId, {
            as: "head",
            method: "PUT",
            body: { ...payload(), version: 1 },
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await request("/activities/" + activityId, {
            method: "PUT",
            body: { ...payload(), version: 1 },
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await request("/activities", {
            as: "head",
            method: "POST",
            body: { ...payload(), unit_id: 2 },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/activities", {
            as: "staff",
            method: "POST",
            body: { ...payload(), unit_id: 2 },
          })
        ).status,
        403,
      );
    });
    it("rejects incomplete ready activities and impossible dates", async () => {
      assert.equal(
        (
          await request("/activities", {
            method: "POST",
            body: { ...payload(), date: "2026-02-30" },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/activities", {
            method: "POST",
            body: { ...payload(), area: "" },
          })
        ).status,
        400,
      );
    });
    it("persists pending activities but excludes them from ready summaries", async () => {
      assert.equal(
        (
          await request("/activities", {
            method: "POST",
            body: { title: "รอตรวจ", unit_id: 1, status: "pending" },
          })
        ).status,
        201,
      );
      const d = (await request("/dashboard")).json;
      assert.equal(d.ready, 1);
      assert.equal(d.pending, 1);
    });
    it("stores actual uploaded bytes, archives never add activities, protected download", async () => {
      const form = new FormData();
      form.append(
        "file",
        new Blob(["%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"], {
          type: "application/pdf",
        }),
        "evidence.pdf",
      );
      form.append("unit_id", "1");
      form.append("purpose", "archive");
      const r = await request("/files", { method: "POST", body: form });
      assert.equal(r.status, 201, JSON.stringify(r.json));
      fileId = r.json.id;
      const data = await fetch(base + "/files/" + fileId + "/content", {
        headers: { Cookie: accounts.staff.cookie },
      });
      assert.equal(data.status, 200);
      assert.match(await data.text(), /%PDF-1.4/);
      assert.equal(
        (await fetch(base + "/files/" + fileId + "/content")).status,
        401,
      );
      const d = (await request("/dashboard")).json;
      assert.equal(d.archives, 1);
      assert.equal(d.ready, 1);
    });
    it("rejects executable content disguised as a PDF and unauthorized uploads", async () => {
      const f = new FormData();
      f.append("file", new Blob(["<html>evil content</html>"]), "evil.pdf");
      f.append("unit_id", "1");
      f.append("purpose", "archive");
      assert.equal(
        (await request("/files", { method: "POST", body: f })).status,
        415,
      );
      const f2 = new FormData();
      f2.append("file", new Blob(["%PDF-1.4 test"]), "x.pdf");
      assert.equal(
        (await request("/files", { as: "admin", method: "POST", body: f2 }))
          .status,
        403,
      );
    });
    it("does not link archive-only files as activity evidence", async () => {
      assert.equal(
        (
          await request("/activities", {
            method: "POST",
            body: { ...payload(), file_ids: [fileId] },
          })
        ).status,
        403,
      );
    });
    it("PR draft is private until explicit publication; report remains unchanged", async () => {
      assert.equal(
        (
          await request("/news", {
            method: "POST",
            body: { activity_id: activityId, title: "ข่าว", body: "เนื้อหา" },
          })
        ).status,
        403,
      );
      const r = await request("/news", {
        as: "pr",
        method: "POST",
        body: {
          activity_id: activityId,
          title: "ข่าวการประชุม",
          body: "ข่าวผู้เข้าร่วม 32 คน",
        },
      });
      assert.equal(r.status, 201);
      newsId = r.json.id;
      assert.equal((await request("/news?feed=1")).json.total, 0);
      assert.equal((await request("/news/" + newsId)).status, 404);
      assert.equal(
        (
          await request("/news/" + newsId + "/publish", {
            as: "admin",
            method: "POST",
            body: { version: 1 },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/news/" + newsId + "/publish", {
            as: "pr",
            method: "POST",
            body: { version: 1 },
          })
        ).status,
        200,
      );
      assert.equal((await request("/news?feed=1")).json.total, 1);
      assert.equal(
        (await request("/activities/" + activityId)).json.title,
        payload().title,
      );
      assert.equal(
        (
          await request("/news/" + newsId + "/send-line", {
            as: "pr",
            method: "POST",
            body: {},
          })
        ).status,
        503,
      );
    });
    it("supports combined roles but does not grant broader editing rights", async () => {
      assert.equal(
        (
          await request("/activities", {
            as: "multi",
            method: "POST",
            body: { title: "งานหลายบทบาท", unit_id: 1, status: "pending" },
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await request("/news", {
            as: "multi",
            method: "POST",
            body: { activity_id: activityId, title: "ร่าง", body: "ข้อความ" },
          })
        ).status,
        201,
      );
      assert.equal(
        (
          await request("/activities/" + activityId, {
            as: "multi",
            method: "PUT",
            body: { ...payload(), version: 2 },
          })
        ).status,
        403,
      );
    });
    it("validates head scopes, invalidates sessions on user disable and protects self-admin", async () => {
      const users = (await request("/admin/users", { as: "admin" })).json;
      const peer = users.find((u) => u.username === "peer"),
        admin = users.find((u) => u.username === "admin");
      assert.equal(
        (
          await request("/admin/users/" + peer.id, {
            as: "admin",
            method: "PUT",
            body: { ...peer, roles: ["head"], scopes: [] },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/admin/users/" + admin.id, {
            as: "admin",
            method: "PUT",
            body: { ...admin, roles: ["staff"], unit_id: 1 },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request("/admin/users/" + peer.id, {
            as: "admin",
            method: "PUT",
            body: { ...peer, active: false },
          })
        ).status,
        200,
      );
      assert.equal((await request("/auth/me", { as: "peer" })).status, 401);
    });
    it("records read-only audit diffs without passwords or sessions", async () => {
      const r = await request("/admin/audits", { as: "admin" });
      assert.ok(r.json.total >= 5);
      assert.ok(!JSON.stringify(r.json).includes("password_hash"));
      assert.ok(!JSON.stringify(r.json).includes(password));
      const filtered = await request("/admin/audits?entity=user", {
        as: "admin",
      });
      assert.equal(filtered.status, 200);
      assert.equal(
        filtered.json.total,
        app.locals.db
          .prepare("SELECT COUNT(*) n FROM audits WHERE entity='user'")
          .get().n,
      );
      assert.ok(filtered.json.total > 0);
      assert.ok(filtered.json.items.every((entry) => entry.entity === "user"));
      assert.equal(
        (
          await request("/admin/audits", {
            as: "admin",
            method: "POST",
            body: {},
          })
        ).status,
        404,
      );
    });
    it("restricts LINE settings to admins and exposes group IDs without credentials", async () => {
      const values = {
        LINE_CHANNEL_SECRET: "private-line-secret",
        LINE_CHANNEL_ACCESS_TOKEN: "private-line-token",
        LINE_REPORT_GROUP_ID: "report-group",
        LINE_NEWS_GROUP_ID: "news-group",
      };
      const previous = Object.fromEntries(
        Object.keys(values).map((key) => [key, process.env[key]]),
      );
      try {
        Object.assign(process.env, values);
        for (const as of ["staff", "head", "pr", "executive"]) {
          assert.equal((await request("/admin/line", { as })).status, 403);
          assert.equal((await request("/admin/audits", { as })).status, 403);
        }
        const r = await request("/admin/line", { as: "admin" });
        assert.equal(r.status, 200);
        assert.equal(r.json.reportGroupId, "report-group");
        assert.equal(r.json.newsGroupId, "news-group");
        assert.equal(r.json.receiveConfigured, true);
        assert.equal(r.json.sendConfigured, true);
        assert.equal(r.json.lastReceived, null);
        assert.equal(r.json.lastSent, null);
        assert.ok(!JSON.stringify(r.json).includes(values.LINE_CHANNEL_SECRET));
        assert.ok(
          !JSON.stringify(r.json).includes(values.LINE_CHANNEL_ACCESS_TOKEN),
        );
        delete process.env.LINE_CHANNEL_SECRET;
        delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
        const partial = await request("/admin/line", { as: "admin" });
        assert.equal(partial.json.receiveConfigured, false);
        assert.equal(partial.json.sendConfigured, false);
      } finally {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
      }
    });
    it("checks LINE webhook HMAC, allowed group and event deduplication", async () => {
      process.env.LINE_CHANNEL_SECRET = "test-secret";
      process.env.LINE_REPORT_GROUP_ID = "allowed-group";
      const body = JSON.stringify({
        events: [
          {
            type: "message",
            webhookEventId: "evt-1",
            timestamp: Date.now(),
            source: { groupId: "allowed-group", userId: "U" + "a".repeat(32) },
            message: { id: "1234", type: "text", text: "รายงานจริง" },
          },
        ],
      });
      assert.equal(
        (
          await fetch(base + "/line/webhook", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-line-signature": "wrong",
            },
            body,
          })
        ).status,
        401,
      );
      for (let i = 0; i < 2; i++) {
        const r = await fetch(base + "/line/webhook", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-line-signature": createHmac("sha256", "test-secret")
              .update(body)
              .digest("base64"),
          },
          body,
        });
        assert.equal(r.status, 200);
      }
      assert.equal((await request("/inbox")).json.total, 1);
      assert.equal((await request("/inbox")).json.items[0].can_edit, false);
    });
    it("persists work across a separate database connection", async () => {
      const { db } = openDatabase(dir);
      assert.equal(
        db.prepare("SELECT title FROM activities WHERE id=?").get(activityId)
          .title,
        payload().title,
      );
      assert.equal(
        db.prepare("SELECT status FROM news WHERE id=?").get(newsId).status,
        "published",
      );
      db.close();
    });
    it("published news keeps its original metadata after source edits", async () => {
      const original = (await request("/news/" + newsId)).json;
      const source = (await request("/activities/" + activityId)).json;
      const changed = await request("/activities/" + activityId, {
        method: "PUT",
        body: {
          ...source,
          area: "พื้นที่ที่แก้ไขภายหลัง",
          file_ids: [],
          inbox_ids: [],
        },
      });
      assert.equal(changed.status, 200);
      const published = (await request("/news/" + newsId)).json;
      assert.equal(published.area, original.area);
      assert.equal(published.date, original.date);
    });
    it("requires admins to assign exactly one active work in the staff member's division", async () => {
      const account = {
        username: "new_assignment",
        name: "บัญชีกำหนดงาน",
        password,
        roles: ["staff"],
        unit_id: 1,
      };
      for (const work_id of [
        undefined,
        null,
        [],
        [assignedWorks[1]],
        assignedWorks[2],
        999999,
      ]) {
        const rejected = await request("/admin/users", {
          as: "admin",
          method: "POST",
          body: { ...account, work_id },
        });
        assert.equal(rejected.status, 400, JSON.stringify(rejected.json));
      }
      const inactive = await request("/admin/works", {
        as: "admin",
        method: "POST",
        body: { name: "งานที่ปิดรับสมาชิก", unit_id: 1, active: false },
      });
      assert.equal(inactive.status, 201);
      assert.equal(
        (
          await request("/admin/users", {
            as: "admin",
            method: "POST",
            body: { ...account, work_id: inactive.json.id },
          })
        ).status,
        400,
      );
      const created = await request("/admin/users", {
        as: "admin",
        method: "POST",
        body: { ...account, work_id: assignedWorks[1] },
      });
      assert.equal(created.status, 201, JSON.stringify(created.json));
      assert.equal(created.json.unit_id, 1);
      assert.equal(created.json.work_id, assignedWorks[1]);
      assert.equal(created.json.password_hash, undefined);
      const signedIn = await login(account.username);
      assert.equal(signedIn.json.user.work_id, assignedWorks[1]);
      for (const work_id of [null, assignedWorks[2], inactive.json.id])
        assert.equal(
          (
            await request("/admin/users/" + created.json.id, {
              as: "admin",
              method: "PUT",
              body: { ...created.json, work_id },
            })
          ).status,
          400,
        );
      assert.equal(
        (
          await request("/admin/users/" + created.json.id, {
            as: account.username,
            method: "PUT",
            body: { ...created.json, unit_id: 2, work_id: assignedWorks[2] },
          })
        ).status,
        403,
      );
      const transferred = await request("/admin/users/" + created.json.id, {
        as: "admin",
        method: "PUT",
        body: { ...created.json, unit_id: 2, work_id: assignedWorks[2] },
      });
      assert.equal(transferred.status, 200);
      assert.equal(
        (await request("/auth/me", { as: account.username })).status,
        401,
      );
      assert.equal(
        (await login(account.username)).json.user.work_id,
        assignedWorks[2],
      );
    });
    it("defaults staff reports and uploads to the admin assignment and rejects tampering", async () => {
      const otherWork = app.locals.db
        .prepare(
          "SELECT id FROM works WHERE unit_id=1 AND id!=? AND active=1 LIMIT 1",
        )
        .get(assignedWorks[1]).id;
      for (const assignment of [
        { unit_id: 1, work_id: otherWork },
        { unit_id: 2, work_id: assignedWorks[2] },
      ]) {
        assert.equal(
          (
            await request("/activities", {
              method: "POST",
              body: { ...payload(), ...assignment },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request("/files", {
              method: "POST",
              body: uploadForm(assignment.unit_id, assignment.work_id),
            })
          ).status,
          403,
        );
      }
      const created = await request("/activities", {
        method: "POST",
        body: payload(),
      });
      assert.equal(created.status, 201);
      const record = (await request("/activities/" + created.json.id)).json;
      assert.equal(record.unit_id, 1);
      assert.equal(record.work_id, assignedWorks[1]);
      for (const assignment of [
        { unit_id: 1, work_id: otherWork },
        { unit_id: 1, work_id: null },
        { unit_id: 2, work_id: assignedWorks[2] },
      ])
        assert.equal(
          (
            await request("/activities/" + record.id, {
              method: "PUT",
              body: { ...record, ...assignment },
            })
          ).status,
          403,
        );
      const uploaded = await request("/files", {
        method: "POST",
        body: uploadForm(),
      });
      assert.equal(uploaded.status, 201);
      assert.equal(uploaded.json.unit_id, 1);
      assert.equal(uploaded.json.work_id, assignedWorks[1]);
      assert.equal(uploaded.json.title, "ชื่อเรื่องจากหน้านำเข้า");
      const found = await request(
        "/files?q=" + encodeURIComponent("ชื่อเรื่องจากหน้านำเข้า"),
      );
      assert.ok(found.json.items.some((f) => f.id === uploaded.json.id));
    });
    it("asks legacy unassigned staff to contact an admin before creating reports or uploading", async () => {
      const me = await request("/auth/me", { as: "legacy" });
      assert.equal(me.status, 200);
      assert.equal(me.json.user.work_id, null);
      for (const [path, body] of [
        ["/activities", payload()],
        ["/activities", { ...payload(), work_id: assignedWorks[1] }],
        ["/files", uploadForm()],
      ]) {
        const denied = await request(path, {
          as: "legacy",
          method: "POST",
          body,
        });
        assert.equal(denied.status, 403);
        assert.match(JSON.stringify(denied.json), /ผู้ดูแลระบบ/);
      }
      const assigned = await request("/admin/users/" + me.json.user.id, {
        as: "admin",
        method: "PUT",
        body: { ...me.json.user, work_id: assignedWorks[1] },
      });
      assert.equal(assigned.status, 200);
      assert.equal((await request("/auth/me", { as: "legacy" })).status, 401);
      await login("legacy");
      assert.equal(
        (
          await request("/activities", {
            as: "legacy",
            method: "POST",
            body: payload(),
          })
        ).status,
        201,
      );
    });
    it("retains a staff owner's historical assignment after an admin transfers them", async () => {
      const created = await request("/activities", {
        as: "legacy",
        method: "POST",
        body: payload(),
      });
      assert.equal(created.status, 201);
      const record = (await request("/activities/" + created.json.id)).json;
      const user = (await request("/auth/me", { as: "legacy" })).json.user;
      assert.equal(
        (
          await request("/admin/users/" + user.id, {
            as: "admin",
            method: "PUT",
            body: { ...user, unit_id: 2, work_id: assignedWorks[2] },
          })
        ).status,
        200,
      );
      await login("legacy");
      const { work_id, ...withoutWork } = record;
      const edited = await request("/activities/" + record.id, {
        as: "legacy",
        method: "PUT",
        body: { ...withoutWork, title: "แก้เรื่องเก่าหลังย้ายฝ่าย" },
      });
      assert.equal(edited.status, 200, JSON.stringify(edited.json));
      const saved = (await request("/activities/" + record.id)).json;
      assert.equal(saved.unit_id, 1);
      assert.equal(saved.work_id, work_id);
      assert.equal(saved.can_edit, false);
      assert.equal(
        (await request("/activities/" + record.id, { as: "legacy" })).json
          .can_edit,
        true,
      );
      assert.equal(
        (
          await request("/activities/" + record.id, {
            as: "legacy",
            method: "PUT",
            body: { ...saved, unit_id: 2, work_id: assignedWorks[2] },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request("/activities", {
            as: "legacy",
            method: "POST",
            body: payload(),
          })
        ).status,
        403,
      );
      const next = await request("/activities", {
        as: "legacy",
        method: "POST",
        body: { ...payload(), unit_id: 2 },
      });
      assert.equal(next.status, 201);
      assert.equal(
        (await request("/activities/" + next.json.id)).json.work_id,
        assignedWorks[2],
      );
    });
    it("keeps head scope authority additive for staff with both roles", async () => {
      const targetWork = app.locals.db
        .prepare(
          "SELECT id FROM works WHERE unit_id=2 AND id!=? AND active=1 LIMIT 1",
        )
        .get(assignedWorks[2]).id;
      const created = await request("/activities", {
        as: "hybrid",
        method: "POST",
        body: { ...payload(), unit_id: 2, work_id: targetWork },
      });
      assert.equal(created.status, 201, JSON.stringify(created.json));
      assert.equal(
        (await request("/activities/" + created.json.id)).json.work_id,
        targetWork,
      );
      const uploaded = await request("/files", {
        as: "hybrid",
        method: "POST",
        body: uploadForm(2, targetWork),
      });
      assert.equal(uploaded.status, 201);
      assert.equal(uploaded.json.unit_id, 2);
      assert.equal(uploaded.json.work_id, targetWork);
      const own = await request("/activities", {
        as: "hybrid",
        method: "POST",
        body: payload(),
      });
      assert.equal(own.status, 201);
      assert.equal(
        (await request("/activities/" + own.json.id)).json.work_id,
        assignedWorks[1],
      );
      assert.equal(
        (
          await request("/activities", {
            as: "hybrid",
            method: "POST",
            body: { ...payload(), unit_id: 3 },
          })
        ).status,
        403,
      );
    });
    it("logout revokes the session", async () => {
      assert.equal(
        (await request("/auth/logout", { method: "POST", body: {} })).status,
        200,
      );
      assert.equal((await request("/auth/me")).status, 401);
    });
  },
);
