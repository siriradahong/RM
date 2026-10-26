import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../server/app.js";
import { hashPassword, digest } from "../server/security.js";

describe(
  "One primary role and conditional organizational assignment",
  { concurrency: false },
  () => {
    let dir, app, db, server, base;
    const ids = {},
      sessions = {},
      works = {},
      password = "Single-role-password-2026!";
    async function req(path, as = "admin", method = "GET", body) {
      const a = sessions[as];
      const r = await fetch(base + "/api" + path, {
        method,
        headers: {
          Origin: "http://localhost:3001",
          ...(a ? { Cookie: a.cookie, "X-CSRF-Token": a.csrf } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json(), headers: r.headers };
    }
    async function login(name) {
      const r = await req("/auth/login", null, "POST", {
        username: name,
        password,
      });
      assert.equal(r.status, 200);
      sessions[name] = {
        cookie: r.headers.get("set-cookie").split(";")[0],
        csrf: r.data.csrf,
      };
      return r;
    }
    const body = (role = "staff") => ({
      username: "new." + role,
      name: "บุคลากร " + role,
      password,
      roles: [role],
      unit_id: ["staff", "pr", "center_head", "head"].includes(role) ? 1 : null,
      work_id: ["staff", "pr", "center_head"].includes(role) ? works[1] : null,
      scopes: [],
      work_scopes: [],
      active: true,
    });
    before(async () => {
      dir = await mkdtemp(join(tmpdir(), "rm-primary-role-"));
      app = createApp({ dataDir: dir, disableRateLimit: true });
      db = app.locals.db;
      const hash = await hashPassword(password);
      for (const unit of [1, 2])
        works[unit] = db
          .prepare("SELECT id FROM works WHERE unit_id=? LIMIT 1")
          .get(unit).id;
      for (const [name, roles, unit, scopes] of [
        ["admin", ["admin"], null, []],
        ["staff", ["staff"], 1, []],
        ["pr", ["pr"], 1, []],
        ["legacy", ["staff", "pr"], 1, []],
        ["oldhead", ["head"], 1, [1, 2]],
        ["oldadmin", ["admin", "staff"], 1, []],
      ])
        ids[name] = Number(
          db
            .prepare(
              "INSERT INTO users(username,name,password_hash,roles,unit_id,work_id,scopes) VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              name,
              "ทดสอบ " + name,
              hash,
              JSON.stringify(roles),
              unit,
              unit ? works[unit] : null,
              JSON.stringify(scopes),
            ).lastInsertRowid,
        );
      server = await new Promise((resolve, reject) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
        s.on("error", reject);
      });
      base = "http://127.0.0.1:" + server.address().port;
      for (const name of Object.keys(ids)) await login(name);
    });
    after(async () => {
      await new Promise((r) => server.close(r));
      db.close();
      await rm(dir, { recursive: true, force: true });
    });
    it("rejects multiple roles, multiple divisions and conflicting conditional fields", async () => {
      for (const b of [
        { ...body(), roles: ["staff", "pr"] },
        { ...body("head"), scopes: [1, 2] },
        { ...body("center_head"), work_scopes: [works[1], works[2]] },
        { ...body("head"), scopes: [2] },
        { ...body("head"), work_id: works[1] },
        { ...body("staff"), scopes: [1] },
        { ...body("executive"), unit_id: 1 },
        { ...body("pr"), work_id: null },
      ])
        assert.equal(
          (await req("/admin/users", "admin", "POST", b)).status,
          400,
          JSON.stringify(b),
        );
    });
    it("creates one role and derives exactly one head/center scope from the selected affiliation", async () => {
      for (const role of [
        "staff",
        "pr",
        "head",
        "center_head",
        "executive",
        "admin",
      ]) {
        const r = await req("/admin/users", "admin", "POST", body(role));
        assert.equal(r.status, 201, JSON.stringify(r.data));
        assert.deepEqual(r.data.roles, [role]);
        assert.deepEqual(r.data.scopes, role === "head" ? [1] : []);
        assert.deepEqual(
          r.data.work_scopes,
          role === "center_head" ? [works[1]] : [],
        );
        assert.equal(r.data.assignment_review_required, false);
      }
      assert.equal(
        (
          await req("/admin/users", "admin", "POST", {
            ...body(),
            username: "wrong.work",
            work_id: works[2],
          })
        ).status,
        400,
      );
    });
    it("blocks legacy combined authority without changing their stored roles or old report ownership", async () => {
      const original = db
        .prepare("SELECT roles,unit_id,work_id FROM users WHERE id=?")
        .get(ids.legacy);
      const report = db
        .prepare(
          "INSERT INTO activities(title,unit_id,work_id,owner_id,source,status) VALUES('รายงานเดิม',1,?,?,'web','pending')",
        )
        .run(works[1], ids.legacy).lastInsertRowid;
      const auth = await login("legacy");
      assert.deepEqual(auth.data.user.roles, []);
      assert.equal(auth.data.user.assignment_review_required, true);
      for (const path of ["/activities", "/news", "/dashboard", "/projects"])
        assert.equal((await req(path, "legacy")).status, 403);
      assert.equal((await req("/activities/" + report, "legacy")).status, 403);
      assert.equal((await req("/meta", "legacy")).status, 200);
      assert.deepEqual(
        db
          .prepare("SELECT roles,unit_id,work_id FROM users WHERE id=?")
          .get(ids.legacy),
        original,
      );
      assert.equal((await req("/activities", "oldhead")).status, 403);
    });
    it("lets an admin explicitly resolve the legacy role without moving historical reports", async () => {
      const r = await req("/admin/users/" + ids.legacy, "admin", "PUT", {
        ...body("pr"),
        username: "legacy",
        password: undefined,
      });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.deepEqual(r.data.roles, ["pr"]);
      assert.equal(r.data.assignment_review_required, false);
      const auth = await login("legacy");
      assert.deepEqual(auth.data.user.roles, ["pr"]);
      assert.equal((await req("/activities", "legacy")).status, 200);
      assert.equal(
        db
          .prepare("SELECT owner_id FROM activities WHERE title='รายงานเดิม'")
          .get().owner_id,
        ids.legacy,
      );
    });
    it("allows the single PR role to submit its own reports while forbidding other-unit writes and other-person edits", async () => {
      const r = await req("/activities", "pr", "POST", {
        title: "รายงานของประชาสัมพันธ์",
        unit_id: 1,
        work_id: works[1],
        status: "pending",
      });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.equal(
        (
          await req("/activities", "pr", "POST", {
            title: "ข้ามฝ่าย",
            unit_id: 2,
            work_id: works[2],
            status: "pending",
          })
        ).status,
        403,
      );
      const other = await req("/activities", "staff", "POST", {
        title: "รายงานของเจ้าหน้าที่",
        unit_id: 1,
        work_id: works[1],
        status: "pending",
      });
      assert.equal(other.status, 201);
      assert.equal(
        (
          await req("/activities/" + other.data.id, "pr", "PUT", {
            ...other.data,
            title: "ห้ามแก้แทน",
          })
        ).status,
        403,
      );
      assert.deepEqual(
        db.prepare("SELECT roles FROM users WHERE id=?").get(ids.pr).roles,
        '["pr"]',
      );
    });
    it("keeps a legacy administrator able to resolve their primary role without mixed report privileges", async () => {
      const auth = await login("oldadmin");
      assert.deepEqual(auth.data.user.roles, ["admin"]);
      assert.equal(auth.data.user.assignment_review_required, true);
      assert.equal((await req("/admin/users", "oldadmin")).status, 200);
      assert.equal((await req("/activities", "oldadmin")).status, 403);
      const fixed = await req(
        "/admin/users/" + ids.oldadmin,
        "oldadmin",
        "PUT",
        { ...body("admin"), username: "oldadmin", password: undefined },
      );
      assert.equal(fixed.status, 200);
      assert.equal(fixed.data.assignment_review_required, false);
      assert.deepEqual(fixed.data.roles, ["admin"]);
    });
    it("allows a PR request only after approval and replaces the temporary staff role", async () => {
      const raw = "a".repeat(64);
      db.prepare("INSERT INTO line_registrations VALUES(?,?,?,?,?)").run(
        digest(raw),
        "U" + "a".repeat(32),
        "ขอประชาสัมพันธ์",
        null,
        Date.now() + 60000,
      );
      const signup = await req("/auth/line/register", null, "POST", {
        registration_token: raw,
        name: "ผู้ขอประชาสัมพันธ์",
        unit_id: 1,
        work_id: works[1],
        position: "ตามเอกสารบุคลากร",
        personnel_type: "พนักงานจ้าง",
        requested_role: "pr",
      });
      assert.equal(signup.status, 201);
      assert.deepEqual(signup.data.user.roles, ["staff"]);
      const proposal = db
        .prepare("SELECT id FROM role_requests WHERE user_id=?")
        .get(signup.data.user.id);
      assert.equal(
        (
          await req(
            "/role-requests/" + proposal.id + "/resolve",
            "admin",
            "POST",
            { approve: true, reason: "ตรวจหน้าที่หลักแล้ว" },
          )
        ).status,
        200,
      );
      const saved = db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(signup.data.user.id);
      assert.deepEqual(JSON.parse(saved.roles), ["pr"]);
      assert.deepEqual(JSON.parse(saved.scopes), []);
      assert.equal(saved.work_id, works[1]);
    });
    it("replaces the previous role on promotion and invalidates the old session", async () => {
      const raw = "f".repeat(64);
      db.prepare("INSERT INTO line_registrations VALUES(?,?,?,?,?)").run(
        digest(raw),
        "U" + "f".repeat(32),
        "ผู้ขอรับรอง",
        null,
        Date.now() + 60000,
      );
      const signup = await req("/auth/line/register", null, "POST", {
        registration_token: raw,
        name: "ผู้ขอรับรอง",
        unit_id: 1,
        work_id: works[1],
        position: "หัวหน้าศูนย์ตามเอกสาร",
        personnel_type: "พนักงานจ้าง",
        requested_role: "center_head",
      });
      assert.equal(signup.status, 201);
      const request = db
        .prepare("SELECT id FROM role_requests WHERE user_id=?")
        .get(signup.data.user.id);
      assert.equal(
        (
          await req(
            "/role-requests/" + request.id + "/resolve",
            "admin",
            "POST",
            { approve: true, reason: "ตรวจหน้าที่หลักแล้ว" },
          )
        ).status,
        200,
      );
      const u = db
        .prepare("SELECT * FROM users WHERE id=?")
        .get(signup.data.user.id);
      assert.deepEqual(JSON.parse(u.roles), ["center_head"]);
      assert.deepEqual(JSON.parse(u.work_scopes), [works[1]]);
      assert.equal(u.work_id, works[1]);
      assert.equal(
        db.prepare("SELECT count(*) n FROM sessions WHERE user_id=?").get(u.id)
          .n,
        0,
      );
    });
  },
);
