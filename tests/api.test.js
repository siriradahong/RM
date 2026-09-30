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
      newsId;
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
      for (const [username, roles, unit, scopes] of [
        ["staff", ["staff"], 1, []],
        ["peer", ["staff"], 1, []],
        ["outside", ["staff"], 2, []],
        ["head", ["head"], 1, [1]],
        ["admin", ["admin"], null, []],
        ["pr", ["pr"], 1, []],
        ["executive", ["executive"], null, []],
        ["multi", ["staff", "pr"], 1, []],
      ])
        app.locals.db
          .prepare(
            "INSERT INTO users(username,name,password_hash,unit_id,roles,scopes) VALUES(?,?,?,?,?,?)",
          )
          .run(
            username,
            username,
            hash,
            unit,
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
    it("logout revokes the session", async () => {
      assert.equal(
        (await request("/auth/logout", { method: "POST", body: {} })).status,
        200,
      );
      assert.equal((await request("/auth/me")).status, 401);
    });
  },
);
