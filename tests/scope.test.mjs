import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { createApp } from "../server/app.js";
import { hashPassword, digest } from "../server/security.js";
import { publicUser } from "../server/db.js";
import { effectiveUser } from "../server/access.js";
import { runJobs } from "../server/jobs.js";
import { makeTextDocx } from "../server/report-docx.js";
import { readWord } from "../server/word-text.js";
import { extractWithAI } from "../server/ai-provider.js";
describe(
  "All-phase scope, role isolation, approvals and durable automation",
  { concurrency: false },
  () => {
    let app, db, dir, server, base;
    const users = {},
      sessions = {},
      works = {},
      password = "Scope-test-password-2026!";
    let a1, a2, peerReport, fileId, lockId, projectId, taskId;
    async function req(path, as = "staff", method = "GET", body) {
      const a = sessions[as];
      const r = await fetch(base + path, {
        method,
        headers: {
          Origin: "http://localhost:3001",
          ...(a ? { Cookie: a.cookie, "X-CSRF-Token": a.csrf } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const bytes = Buffer.from(await r.arrayBuffer());
      let data;
      try {
        data = JSON.parse(bytes.toString());
      } catch {}
      return { status: r.status, data, bytes, headers: r.headers };
    }
    async function login(name) {
      const r = await req("/auth/login", null, "POST", {
        username: name,
        password,
      });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      sessions[name] = {
        cookie: r.headers.get("set-cookie").split(";")[0],
        csrf: r.data.csrf,
      };
    }
    const body = (unit = 1) => ({
      title: "รายงานบริการ " + unit,
      date: "2026-10-05",
      unit_id: unit,
      work_id: works[unit],
      category_id: 1,
      area: "ชุมชนทดสอบ",
      workers: "เจ้าหน้าที่",
      result: "บริการ 85 ราย",
      metrics: [{ label: "ผู้รับบริการ", value: 85, unit: "ราย" }],
      status: "ready",
    });
    const setting = (k, v) =>
      db
        .prepare("UPDATE scope_settings SET value=? WHERE key=?")
        .run(JSON.stringify(v), k);
    before(async () => {
      dir = await mkdtemp(join(tmpdir(), "rm-scope-"));
      app = createApp({ dataDir: dir, disableRateLimit: true });
      db = app.locals.db;
      const hash = await hashPassword(password);
      for (const unit of [1, 2])
        works[unit] = db
          .prepare("SELECT id FROM works WHERE unit_id=? ORDER BY id LIMIT 1")
          .get(unit).id;
      for (const [name, roles, unit, scopes] of [
        ["staff", ["staff"], 1, []],
        ["peer", ["staff"], 1, []],
        ["outside", ["staff"], 2, []],
        ["head", ["head"], 1, [1]],
        ["head2", ["head"], 2, [2]],
        ["center", ["center_head"], 1, []],
        ["exec", ["executive"], null, []],
        ["pr", ["pr"], null, []],
        ["admin", ["admin"], null, []],
      ]) {
        users[name] = Number(
          db
            .prepare(
              "INSERT INTO users(username,name,password_hash,roles,unit_id,work_id,scopes,work_scopes,personnel_type) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .run(
              name,
              "ทดสอบ " + name,
              hash,
              JSON.stringify(roles),
              unit,
              unit ? works[unit] : null,
              JSON.stringify(scopes),
              name === "center" ? JSON.stringify([works[1]]) : "[]",
              "พนักงานจ้าง",
            ).lastInsertRowid,
        );
      }
      server = await new Promise((resolve, reject) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
        s.on("error", reject);
      });
      base = "http://127.0.0.1:" + server.address().port + "/api";
      for (const name of Object.keys(users)) await login(name);
      a1 = (await req("/activities", "staff", "POST", body())).data;
      a2 = (await req("/activities", "outside", "POST", body(2))).data;
      peerReport = (
        await req("/activities", "peer", "POST", {
          ...body(),
          title: "งานของเพื่อน",
        })
      ).data;
      fileId = Number(
        db
          .prepare(
            "INSERT INTO files(original_name,storage_name,mime,size,title,purpose,unit_id,work_id,owner_id,activity_id) VALUES('evidence.txt','scope.txt','text/plain',8,'หลักฐาน','evidence',1,?,?,?)",
          )
          .run(works[1], users.staff, a1.id).lastInsertRowid,
      );
      await writeFile(join(dir, "uploads", "scope.txt"), "evidence");
    });
    after(async () => {
      await app?.locals.waitLineJobs?.();
      if (server) await new Promise((r) => server.close(r));
      db?.close();
      if (dir) await rm(dir, { recursive: true, force: true });
    });
    it("limits list, detail, files, calendar, dashboard and exports; admin has no implicit report read", async () => {
      for (const as of ["peer", "outside", "admin", "pr"]) {
        assert.equal((await req("/activities/" + a1.id, as)).status, 404, as);
        assert.equal(
          (await req("/files/" + fileId + "/content", as)).status,
          404,
          as,
        );
        assert.ok(
          !(await req("/activities", as)).data.items.some(
            (a) => a.id === a1.id,
          ),
        );
        assert.ok(
          !(
            await req("/calendar?from=2026-10-01&to=2026-10-31", as)
          ).data.items.some((a) => a.id === a1.id),
        );
      }
      for (const as of ["staff", "head", "center", "exec"]) {
        assert.equal((await req("/activities/" + a1.id, as)).status, 200, as);
        assert.equal(
          (await req("/files/" + fileId + "/content", as)).status,
          200,
          as,
        );
      }
      assert.equal(
        (
          await req(
            "/reports/summary?period=month&anchor=2026-10-05&scope=all",
            "staff",
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/reports/export?period=month&anchor=2026-10-05&scope=all",
            "admin",
          )
        ).status,
        403,
      );
      assert.equal(
        (await req("/dashboard?period=month&anchor=2026-10-05", "admin")).data
          .ready,
        0,
      );
    });
    it("head and center scopes never imply access to another unit or sibling work", async () => {
      assert.equal((await req("/activities/" + a2.id, "head")).status, 404);
      assert.equal((await req("/activities/" + a2.id, "center")).status, 404);
      const sibling = db
        .prepare("SELECT id FROM works WHERE unit_id=1 AND id<>? LIMIT 1")
        .get(works[1]).id;
      const report = (
        await req("/activities", "head", "POST", {
          ...body(),
          work_id: sibling,
        })
      ).data;
      assert.equal(
        (await req("/activities/" + report.id, "center")).status,
        404,
      );
    });
    it("hands the original report to PR only through its queue, without duplicating a report", async () => {
      const before = db.prepare("SELECT COUNT(*) n FROM activities").get().n;
      assert.equal(
        (
          await req(
            "/activities/" + a1.id + "/news-candidate",
            "staff",
            "POST",
            {},
          )
        ).status,
        200,
      );
      assert.equal((await req("/activities/" + a1.id, "pr")).status, 200);
      assert.equal((await req("/activities/" + a2.id, "pr")).status, 404);
      assert.equal(
        (await req("/news-candidates", "pr")).data.items[0].activity_id,
        a1.id,
      );
      const n = await req("/news", "pr", "POST", {
        activity_id: a1.id,
        title: "ข่าวที่ตรวจแล้ว",
        body: "บริการ 85 ราย",
        image_ids: [],
      });
      assert.equal(n.status, 201, JSON.stringify(n.data));
      assert.equal(
        (
          await req("/news/" + n.data.id + "/publish", "pr", "POST", {
            version: n.data.version,
            privacy_reviewed: true,
          })
        ).status,
        200,
      );
      assert.equal((await req("/news?feed=1", "admin")).data.total, 1);
      assert.equal((await req("/activities/" + a1.id, "admin")).status, 404);
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM activities").get().n,
        before,
      );
    });
    it("separates contributor credit and owner numeric confirmation before personal exports", async () => {
      let a = (await req("/activities/" + a1.id)).data;
      const team = await req("/activities/" + a.id + "/team", "staff", "PUT", {
        version: a.version,
        people: [{ user_id: users.peer, work_role: "ร่วมลงพื้นที่" }],
        units: [2],
      });
      assert.equal(team.status, 200, JSON.stringify(team.data));
      assert.equal((await req("/activities/" + a.id, "peer")).status, 200);
      assert.equal(
        (await req("/activities/" + a.id + "/team/confirm", "peer", "POST", {}))
          .status,
        200,
      );
      assert.equal(
        (
          await req(
            "/activities/" + a.id + "/team/confirm",
            "outside",
            "POST",
            {},
          )
        ).status,
        404,
      );
      const t = await req("/hr-templates", "admin", "POST", {
        name: "แบบตามเอกสารทดสอบ",
        personnel_type: "พนักงานจ้าง",
        reference: "หนังสือทดสอบ อ.1",
        headings: ["ผลสัมฤทธิ์", "บทบาทที่ได้รับ"],
      });
      assert.equal(t.status, 201);
      const b = {
        template_id: t.data.id,
        from: "2026-10-01",
        to: "2026-10-31",
        narrative: { ผลสัมฤทธิ์: "ร่วมลงพื้นที่" },
      };
      let out = await req("/hr-exports", "peer", "POST", b);
      assert.equal(out.data.rows.length, 1);
      const saved = out.data.id;
      assert.match(
        readWord((await req("/hr-exports/" + saved + "/word", "peer")).bytes),
        /ร่วมลงพื้นที่/,
      );
      assert.equal((await req("/hr-exports/" + saved, "staff")).status, 404);
      a = (await req("/activities/" + a.id)).data;
      const edit = await req("/activities/" + a.id, "head", "PUT", {
        ...a,
        file_ids: [],
        inbox_ids: [],
        metrics: a.metrics,
        result: "แก้เป็นบริการ 86 ราย",
      });
      assert.equal(edit.status, 200, JSON.stringify(edit.data));
      assert.equal(
        (await req("/hr-exports", "peer", "POST", b)).data.rows.length,
        0,
      );
      const owner = await req(
        "/activities/" + a.id + "/owner-confirm",
        "staff",
        "POST",
        { version: edit.data.version },
      );
      assert.equal(owner.status, 200);
      await req("/activities/" + a.id + "/team/confirm", "peer", "POST", {});
      assert.equal(
        (await req("/hr-exports", "peer", "POST", b)).data.rows.length,
        1,
      );
      assert.equal(
        (await req("/hr-exports/" + saved, "peer")).data.rows[0].result,
        "บริการ 85 ราย",
      );
    });
    it("counts a shared activity in each participating unit and once in bureau totals", async () => {
      const r = (
        await req(
          "/reports/summary?period=month&anchor=2026-10-05&scope=unit&unit=2",
          "head2",
        )
      ).data;
      assert.ok(r.rows.some((a) => a.id === a1.id));
      const all = (
        await req(
          "/reports/summary?period=month&anchor=2026-10-05&scope=all",
          "exec",
        )
      ).data;
      assert.equal(
        all.ready,
        new Set(
          all.rows
            .filter((a) => a.status === "ready" && !a.duplicate_of)
            .map((a) => a.id),
        ).size,
      );
      assert.ok(all.units.find((u) => u.id === 2).count >= 2);
    });
    it("locks a period and grants a 24-hour amendment for one user and one report only", async () => {
      const lock = await req("/period-locks", "head", "POST", {
        unit_id: 1,
        date_from: "2026-10-01",
        date_to: "2026-10-31",
        reason: "ส่งฉบับรายเดือนแล้ว",
      });
      assert.equal(lock.status, 201);
      lockId = lock.data.id;
      let a = (await req("/activities/" + a1.id)).data;
      assert.equal(
        (
          await req("/activities/" + a.id, "staff", "PUT", {
            ...a,
            title: "แก้หลังปิด",
          })
        ).status,
        409,
      );
      const amendment = await req(
        "/activities/" + a.id + "/amendments",
        "staff",
        "POST",
        { reason: "แก้ชื่อเรื่องตามต้นฉบับ" },
      );
      assert.equal(amendment.status, 201);
      assert.equal(
        (
          await req(
            "/amendments/" + amendment.data.id + "/resolve",
            "outside",
            "POST",
            { approve: true, reason: "ทดสอบ" },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/amendments/" + amendment.data.id + "/resolve",
            "head",
            "POST",
            { approve: true, reason: "ตรวจต้นฉบับแล้ว" },
          )
        ).status,
        200,
      );
      assert.equal(
        (await req("/activities/" + a.id)).data.amendment_allowed,
        true,
      );
      assert.equal(
        (
          await req("/activities/" + a.id, "staff", "PUT", {
            ...a,
            title: "ชื่อแก้ไขตามต้นฉบับ",
          })
        ).status,
        200,
      );
      const p = (await req("/activities/" + peerReport.id, "peer")).data;
      assert.equal(
        (await req("/activities/" + p.id, "peer", "PUT", p)).status,
        409,
      );
      db.prepare("UPDATE period_locks SET active=0 WHERE id=?").run(lockId);
    });
    it("expires or revokes delegated access and rejects authority from a disabled grantor", async () => {
      assert.equal((await req("/activities/" + a2.id, "staff")).status, 404);
      const now = Date.now();
      const grant = await req("/delegations", "head2", "POST", {
        grantee_id: users.staff,
        unit_id: 2,
        work_id: null,
        starts_at: new Date(now - 1000).toISOString(),
        ends_at: new Date(now + 60000).toISOString(),
        reason: "รักษาการ",
      });
      assert.equal(grant.status, 201);
      assert.equal((await req("/activities/" + a2.id)).status, 200);
      const raw = publicUser(
        db.prepare("SELECT * FROM users WHERE id=?").get(users.staff),
      );
      assert.equal(
        effectiveUser(
          db,
          raw,
          new Date(now + 120000).toISOString(),
        ).scopes.includes(2),
        false,
      );
      db.prepare("UPDATE users SET active=0 WHERE id=?").run(users.head2);
      assert.equal((await req("/activities/" + a2.id)).status, 404);
      db.prepare("UPDATE users SET active=1 WHERE id=?").run(users.head2);
      await req(
        "/delegations/" + grant.data.id + "/revoke",
        "head2",
        "POST",
        {},
      );
      assert.equal((await req("/activities/" + a2.id)).status, 404);
    });
    it("tracks daily task updates, extensions, escalation and idempotent scheduled summaries", async () => {
      const p = await req("/projects", "center", "POST", {
        title: "โครงการศูนย์",
        unit_id: 1,
        work_id: works[1],
        description: "ติดตามงาน",
        due_date: "2026-11-30",
      });
      assert.equal(p.status, 201, JSON.stringify(p.data));
      projectId = p.data.id;
      const t = await req(
        "/projects/" + projectId + "/tasks",
        "center",
        "POST",
        {
          title: "งานลงพื้นที่",
          assignee_id: users.staff,
          due_date: "2026-10-30",
          version: p.data.version,
        },
      );
      assert.equal(t.status, 201, JSON.stringify(t.data));
      taskId = t.data.tasks[0].id;
      assert.equal(
        (await req("/tasks/" + taskId + "/update", "outside", "POST", {}))
          .status,
        403,
      );
      assert.equal(
        (await req("/tasks/" + taskId + "/update", "staff", "POST", {})).status,
        200,
      );
      const ext = await req(
        "/tasks/" + taskId + "/extensions",
        "staff",
        "POST",
        { date: "2026-11-02", reason: "รอประสาน" },
      );
      assert.equal(ext.status, 201);
      assert.equal(
        (
          await req(
            "/task-extensions/" + ext.data.id + "/resolve",
            "center",
            "POST",
            { approve: true },
          )
        ).status,
        200,
      );
      setting("reminders_enabled", true);
      setting("summaries_enabled", true);
      setting("skip_weekends", false);
      db.prepare(
        "UPDATE project_tasks SET last_update_at='2026-10-01T00:00:00.000Z' WHERE id=?",
      ).run(taskId);
      await runJobs(db, new Date("2026-11-01T03:00:00Z"));
      const n = db.prepare("SELECT COUNT(*) n FROM notifications").get().n,
        s = db.prepare("SELECT COUNT(*) n FROM scheduled_summaries").get().n;
      await runJobs(db, new Date("2026-11-01T03:01:00Z"));
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM notifications").get().n,
        n,
      );
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM scheduled_summaries").get().n,
        s,
      );
      assert.ok(n > 0 && s > 0);
      assert.ok(
        db
          .prepare(
            "SELECT 1 FROM notifications WHERE kind='escalation' AND user_id=?",
          )
          .get(users.exec),
      );
      const summary = (await req("/scheduled-summaries", "staff")).data
        .items[0];
      assert.equal(
        (await req("/scheduled-summaries/" + summary.id + "/word", "staff"))
          .status,
        200,
      );
      assert.equal(
        (await req("/scheduled-summaries/" + summary.id, "outside")).status,
        404,
      );
    });
    it("creates appointments from reviewed proposals, detects attendee collisions and cannot confirm twice", async () => {
      const text =
        "นัดหมายประชุม วันที่ 21 ตุลาคม 2569 เวลา 09.00 ถึง 10.00 ทดสอบ staff";
      const draft = await req("/workflow-proposals/analyze", "staff", "POST", {
        kind: "event",
        source_text: text,
      });
      assert.equal(draft.status, 201);
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM calendar_events").get().n,
        0,
      );
      const p = {
        ...draft.data.payload,
        title: "ประชุม 1",
        date: "2026-10-21",
        start_time: "09:00",
        end_time: "10:00",
        unit_id: 1,
        work_id: works[1],
        attendee_ids: [users.staff],
      };
      const done = await req(
        "/workflow-proposals/" + draft.data.id + "/confirm",
        "staff",
        "POST",
        p,
      );
      assert.equal(done.status, 200, JSON.stringify(done.data));
      assert.equal(
        (
          await req(
            "/workflow-proposals/" + draft.data.id + "/confirm",
            "staff",
            "POST",
            p,
          )
        ).status,
        409,
      );
      assert.equal(
        (
          await req("/events", "staff", "POST", {
            ...p,
            title: "ประชุม 2",
            start_time: "09:30",
            end_time: "10:30",
            source_text: "นัดทดสอบ",
          })
        ).status,
        201,
      );
      assert.equal(
        (await req("/events?from=2026-10-01&to=2026-10-31")).data.conflicts
          .length,
        1,
      );
      assert.equal(
        (await req("/events?from=2026-10-01&to=2026-10-31", "outside")).data
          .items.length,
        0,
      );
    });
    it("turns executive commands into explicit scoped assignments, not automatic orders", async () => {
      assert.equal(
        (
          await req("/workflow-proposals/analyze", "staff", "POST", {
            kind: "assignment",
            source_text: "มอบหมายงาน",
          })
        ).status,
        403,
      );
      const proposal = await req(
        "/workflow-proposals/analyze",
        "exec",
        "POST",
        {
          kind: "assignment",
          source_text: "มอบหมาย ทดสอบ staff วันที่ 28 ตุลาคม 2569 ลงพื้นที่",
        },
      );
      assert.equal(proposal.status, 201);
      const project = (await req("/projects/" + projectId, "exec")).data;
      const n = db.prepare("SELECT COUNT(*) n FROM project_tasks").get().n;
      const c = await req(
        "/workflow-proposals/" + proposal.data.id + "/confirm",
        "exec",
        "POST",
        {
          ...proposal.data.payload,
          title: "งานจากข้อเสนอ",
          date: "2026-10-28",
          unit_id: 1,
          project_id: projectId,
          assignee_id: users.staff,
          version: project.version,
        },
      );
      assert.equal(c.status, 200, JSON.stringify(c.data));
      assert.equal(
        db.prepare("SELECT COUNT(*) n FROM project_tasks").get().n,
        n + 1,
      );
    });
    it("stores referenced budgets and planned communities without invented targets", async () => {
      assert.equal((await req("/communities")).data.items.length, 0);
      const c = await req("/communities", "admin", "POST", {
        name: "ชุมชนตรวจจริง",
        district: 2,
        latitude: 16.43,
        longitude: 102.83,
      });
      assert.equal(c.status, 201);
      assert.equal(
        (
          await req("/community-targets", "head", "POST", {
            unit_id: 1,
            community_id: c.data.id,
            fiscal_year: 2570,
            reference: "แผนพื้นที่ ก.1",
          })
        ).status,
        201,
      );
      let a = (await req("/activities/" + a1.id)).data;
      assert.equal(
        (
          await req("/activities/" + a.id + "/community", "staff", "PUT", {
            community_id: c.data.id,
            version: a.version,
          })
        ).status,
        200,
      );
      const coverage = (
        await req("/coverage?period=year&anchor=2026-10-05&unit=1", "head")
      ).data;
      assert.equal(coverage.items[0].visited, true);
      assert.equal(coverage.items[0].planned, true);
      const plan = await req("/plans", "head", "POST", {
        title: "แผนงบทดสอบ",
        unit_id: 1,
        fiscal_year: 2570,
        approved_budget: 1000,
        reference: "อนุมัติ ก.2",
      });
      assert.equal(plan.status, 201);
      const project = (await req("/projects/" + projectId, "head")).data;
      assert.equal(
        (
          await req("/projects/" + projectId + "/plan", "head", "PUT", {
            plan_id: plan.data.id,
            version: project.version,
          })
        ).status,
        200,
      );
      assert.equal(
        (
          await req("/projects/" + projectId + "/expenses", "head", "POST", {
            amount: 12.345,
            date: "2026-10-05",
            description: "ทดสอบ",
            reference: "ใบสำคัญ",
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await req("/projects/" + projectId + "/expenses", "head", "POST", {
            amount: 150.25,
            date: "2026-10-05",
            description: "วัสดุ",
            reference: "ใบสำคัญ 1",
          })
        ).status,
        201,
      );
      assert.equal(
        (await req("/projects/" + projectId + "/budget", "head")).data
          .remaining,
        849.75,
      );
      assert.equal(
        (await req("/projects/" + projectId + "/budget", "outside")).status,
        404,
      );
    });
    it("counts project closures by their actual reporting period and separates unknown dates", async () => {
      const path = "/coverage?period=year&anchor=2026-10-05&unit=1";
      db.prepare(
        "UPDATE projects SET status='completed',completed_at=NULL WHERE id=?",
      ).run(projectId);
      let d = (await req(path, "head")).data;
      assert.equal(d.completed_projects, 0);
      assert.equal(d.completed_undated, 1);
      db.prepare(
        "UPDATE projects SET completed_at='2026-09-30T03:00:00.000Z' WHERE id=?",
      ).run(projectId);
      assert.equal((await req(path, "head")).data.completed_projects, 0);
      db.prepare(
        "UPDATE projects SET completed_at='2026-10-05T03:00:00.000Z' WHERE id=?",
      ).run(projectId);
      assert.equal((await req(path, "head")).data.completed_projects, 1);
      db.prepare(
        "UPDATE projects SET status='active',completed_at=NULL WHERE id=?",
      ).run(projectId);
    });
    it("reads actual Word contents, handles invalid archives, and never invents photo counts", () => {
      const b = makeTextDocx("หัวข้อจริง", [
        { heading: "ข้อมูล", text: "วันที่ 21 ตุลาคม 2569 บริการ 85 ราย" },
      ]);
      assert.match(readWord(b), /บริการ 85 ราย/);
      assert.throws(() => readWord(Buffer.from("notzip")));
      assert.throws(() => readWord(Buffer.alloc(22)));
    });
    it("validates model evidence and confidence instead of accepting unsupported AI values", async () => {
      const old = {
          model: process.env.OLLAMA_MODEL,
          base: process.env.OLLAMA_BASE_URL,
        },
        fetch0 = globalThis.fetch;
      process.env.OLLAMA_MODEL = "test";
      const data = {
        is_report: true,
        confidence: 0.95,
        title: { value: "ข่าวปลอม", quote: "รายงานบริการ" },
        date: null,
        area: null,
        workers: null,
        result: null,
        metrics: [
          {
            label: "ผู้รับบริการ",
            value: 999,
            unit: "ราย",
            quote: "ผู้รับบริการ 85 ราย",
          },
        ],
        questions: [],
      };
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({ message: { content: JSON.stringify(data) } }),
        );
      try {
        const r = await extractWithAI("รายงานบริการ ผู้รับบริการ 85 ราย");
        assert.deepEqual(r.fields, {});
        data.metrics[0].value = 85;
        data.metrics[0].quote = "ผู้รับบริการ 185 ราย";
        assert.deepEqual(
          (await extractWithAI("รายงานบริการ ผู้รับบริการ 185 ราย")).fields,
          {},
        );
        data.metrics[0].quote = "ผู้รับบริการ 85 ราย";
        assert.equal(
          (await extractWithAI("รายงานบริการ ผู้รับบริการ 85 ราย")).fields
            .metrics[0].value,
          85,
        );
        data.confidence = 0.3;
        data.title = { value: "รายงานบริการ", quote: "รายงานบริการ" };
        assert.deepEqual((await extractWithAI("รายงานบริการ")).fields, {});
      } finally {
        globalThis.fetch = fetch0;
        if (old.model === undefined) delete process.env.OLLAMA_MODEL;
        else process.env.OLLAMA_MODEL = old.model;
        if (old.base === undefined) delete process.env.OLLAMA_BASE_URL;
        else process.env.OLLAMA_BASE_URL = old.base;
      }
    });
    it("requires explicit privacy review and masks common direct identifiers before drafting news", async () => {
      const a = (
        await req("/activities", "peer", "POST", {
          ...body(),
          title: "รายงานสำหรับตรวจข้อมูลส่วนบุคคล",
          result:
            "ผู้รับบริการชื่อ นายทดสอบ ทดสอบ โทร 0891234567 เลขบัตร 1234567890123",
        })
      ).data;
      await req("/activities/" + a.id + "/news-candidate", "peer", "POST", {});
      const preview = (await req("/activities/" + a.id + "/news-preview", "pr"))
        .data;
      assert.ok(!preview.body.includes("0891234567"));
      assert.ok(!preview.body.includes("1234567890123"));
      const n = (
        await req("/news", "pr", "POST", {
          activity_id: a.id,
          title: "ตรวจข่าว",
          body: preview.body,
          image_ids: [],
        })
      ).data;
      assert.equal(
        (
          await req("/news/" + n.id + "/publish", "pr", "POST", {
            version: n.version,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await req("/news/" + n.id + "/publish", "pr", "POST", {
            version: n.version,
            privacy_reviewed: true,
          })
        ).status,
        200,
      );
    });
    it("keeps historical organization labels and records effective structural changes", async () => {
      const old = (await req("/activities/" + a2.id, "outside")).data;
      const unit = db.prepare("SELECT * FROM units WHERE id=2").get();
      assert.equal(
        (
          await req("/admin/units/2", "admin", "PUT", {
            ...unit,
            name: unit.name + " ปรับชื่อ",
            active: true,
          })
        ).status,
        200,
      );
      const current = (await req("/activities/" + a2.id, "outside")).data;
      assert.equal(current.unit_id, 2);
      assert.equal(current.unit_name, old.unit_name);
      assert.ok(
        (await req("/admin/organization-history", "admin")).data.items.some(
          (h) =>
            h.entity === "units" &&
            h.entity_id === 2 &&
            h.payload.name.endsWith("ปรับชื่อ"),
        ),
      );
    });
    it("purges expired original media and text only when enabled, preserving source metadata and audit identity", async () => {
      const old = Number(
        db
          .prepare(
            "INSERT INTO activities(title,unit_id,work_id,owner_id,source_text,created_at,status,source) VALUES('ข้อความครบอายุ',1,?,?,'ข้อมูลต้นฉบับทดสอบ','2020-01-01T00:00:00.000Z','pending','web')",
          )
          .run(works[1], users.staff).lastInsertRowid,
      );
      db.prepare("INSERT INTO activity_extractions VALUES(?,?)").run(
        old,
        JSON.stringify({ parts: [{ text: "ข้อความเดิม" }] }),
      );
      const file = Number(
        db
          .prepare(
            "INSERT INTO files(original_name,storage_name,mime,size,title,purpose,unit_id,work_id,owner_id,activity_id,description,created_at) VALUES('expired.txt','expired.txt','text/plain',7,'ไฟล์ครบอายุ','evidence',1,?,?,?,'คำอธิบายเดิม','2020-01-01T00:00:00.000Z')",
          )
          .run(works[1], users.staff, old).lastInsertRowid,
      );
      await writeFile(join(dir, "uploads", "expired.txt"), "expired");
      setting("retention_days", 30);
      assert.equal(
        (await req("/retention/run", "admin", "POST", {})).data.purged,
        0,
      );
      assert.ok(
        (await req("/retention/preview", "admin")).data.texts.some(
          (a) => a.id === old,
        ),
      );
      setting("retention_enabled", true);
      const result = (await req("/retention/run", "admin", "POST", {})).data;
      assert.ok(result.purged >= 1 && result.text_purged >= 1);
      const report = (await req("/activities/" + old)).data;
      assert.equal(report.source_text, "");
      assert.ok(report.source_purged_at);
      assert.equal(report.title, "ข้อความครบอายุ");
      assert.equal((await req("/files/" + file + "/content")).status, 410);
      assert.equal(
        db.prepare("SELECT description FROM files WHERE id=?").get(file)
          .description,
        "",
      );
      assert.equal(
        db
          .prepare("SELECT * FROM activity_extractions WHERE activity_id=?")
          .get(old),
        undefined,
      );
      setting("retention_enabled", false);
      setting("retention_days", null);
    });
    it("uses single-use OAuth state, PKCE and a verified matching nonce; a callback cannot bypass these checks", async () => {
      const keys = [
          "LINE_LOGIN_CHANNEL_ID",
          "LINE_LOGIN_CHANNEL_SECRET",
          "PUBLIC_BASE_URL",
        ],
        env = Object.fromEntries(keys.map((k) => [k, process.env[k]])),
        fetch0 = globalThis.fetch;
      Object.assign(process.env, {
        LINE_LOGIN_CHANNEL_ID: "scope-login",
        LINE_LOGIN_CHANNEL_SECRET: "scope-secret",
        PUBLIC_BASE_URL: "http://localhost:3001",
      });
      try {
        const start = await fetch0(base + "/auth/line/start", {
          redirect: "manual",
        });
        assert.equal(start.status, 302);
        const auth = new URL(start.headers.get("location")),
          state = auth.searchParams.get("state"),
          nonce = auth.searchParams.get("nonce"),
          cookie = start.headers.get("set-cookie").split(";")[0];
        assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
        assert.ok(auth.searchParams.get("code_challenge"));
        assert.ok(start.headers.get("set-cookie").includes("HttpOnly"));
        assert.equal(
          (
            await fetch0(
              base + "/auth/line/callback?state=" + state + "&code=code",
              { redirect: "manual" },
            )
          ).status,
          400,
        );
        let correct = false,
          expectedNonce = nonce;
        globalThis.fetch = async (url, init) => {
          if (String(url) === "https://api.line.me/oauth2/v2.1/token")
            return new Response(JSON.stringify({ id_token: "verified-token" }));
          if (String(url) === "https://api.line.me/oauth2/v2.1/verify") {
            assert.equal(init.body.get("nonce"), expectedNonce);
            return new Response(
              JSON.stringify({
                sub: "U" + "d".repeat(32),
                aud: "scope-login",
                nonce: correct ? expectedNonce : "wrong",
                exp: Math.floor(Date.now() / 1000) + 600,
                name: "บัญชี LINE ทดสอบ",
              }),
            );
          }
          return fetch0(url, init);
        };
        const wrong = await fetch0(
          base + "/auth/line/callback?state=" + state + "&code=code",
          { headers: { Cookie: cookie }, redirect: "manual" },
        );
        assert.equal(wrong.status, 401);
        assert.equal(
          (
            await fetch0(
              base + "/auth/line/callback?state=" + state + "&code=code",
              { headers: { Cookie: cookie }, redirect: "manual" },
            )
          ).status,
          400,
        );
        // Registration tokens are issued only after successful official token verification; wrong nonce never issues one.
        assert.equal(
          db
            .prepare("SELECT 1 FROM line_registrations WHERE line_user_id=?")
            .get("U" + "d".repeat(32)),
          undefined,
        );
        const next = await fetch0(base + "/auth/line/start", {
            headers: { Cookie: sessions.staff.cookie },
            redirect: "manual",
          }),
          params = new URL(next.headers.get("location")).searchParams;
        expectedNonce = params.get("nonce");
        correct = true;
        const callback = await fetch0(
          base +
            "/auth/line/callback?state=" +
            params.get("state") +
            "&code=code",
          {
            headers: {
              Cookie:
                next.headers.get("set-cookie").split(";")[0] +
                "; " +
                sessions.staff.cookie,
            },
            redirect: "manual",
          },
        );
        assert.equal(callback.status, 302);
        assert.match(
          callback.headers.get("location"),
          /#line-register\?token=/,
        );
        assert.ok(
          callback.headers
            .getSetCookie()
            .some((c) => c.startsWith("rm_session=;")),
        );
        assert.equal((await req("/auth/me", "staff")).status, 401);
        await login("staff");
      } finally {
        globalThis.fetch = fetch0;
        for (const k of keys) {
          if (env[k] === undefined) delete process.env[k];
          else process.env[k] = env[k];
        }
      }
    });
    it("checks LINE signatures, stays silent for chatter, processes one report and one confirmation only", async () => {
      const saved = {
          secret: process.env.LINE_CHANNEL_SECRET,
          token: process.env.LINE_CHANNEL_ACCESS_TOKEN,
        },
        fetch0 = globalThis.fetch,
        replies = [];
      process.env.LINE_CHANNEL_SECRET = "scope-secret";
      process.env.LINE_CHANNEL_ACCESS_TOKEN = "scope-token";
      setting("line_reply_enabled", true);
      db.prepare("UPDATE users SET line_user_id=? WHERE id=?").run(
        "U" + "b".repeat(32),
        users.staff,
      );
      globalThis.fetch = async (url, init) =>
        String(url).startsWith("https://api-data.line.me/")
          ? new Response(
              Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmBUAAAAASUVORK5CYII=",
                "base64",
              ),
              { headers: { "Content-Type": "image/png" } },
            )
          : String(url).startsWith("https://api.line.me/")
            ? (replies.push(JSON.parse(init.body)), new Response("{}"))
            : fetch0(url, init);
      let seq = 0;
      const hook = async (type, payload, override) => {
        const event = {
          webhookEventId: override || "scope-event-" + ++seq,
          timestamp: Date.now(),
          replyToken: "reply",
          source: { type: "user", userId: "U" + "b".repeat(32) },
          type,
          ...payload,
        };
        const b = JSON.stringify({ events: [event] });
        const response = await fetch0(base + "/line/webhook", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-line-signature": createHmac("sha256", "scope-secret")
              .update(b)
              .digest("base64"),
          },
          body: b,
        });
        assert.equal(response.status, 200);
        await app.locals.waitLineJobs();
        return event.webhookEventId;
      };
      try {
        const before = db.prepare("SELECT COUNT(*) n FROM activities").get().n;
        await hook("message", {
          message: { id: "m1", type: "text", text: "สวัสดี ขอบคุณค่ะ" },
        });
        assert.equal(replies.length, 0);
        assert.equal(
          db.prepare("SELECT COUNT(*) n FROM activities").get().n,
          before,
        );
        const id = await hook("message", {
          message: {
            id: "m2",
            type: "text",
            text: "รายงานกิจกรรมบริการ วันที่ 21 ตุลาคม 2569 ณ ชุมชนทดสอบ บริการผู้รับบริการ 85 ราย",
          },
        });
        const report = db
          .prepare(
            "SELECT a.* FROM inbox i JOIN activities a ON a.id=i.activity_id WHERE i.event_id=?",
          )
          .get(id);
        assert.ok(report);
        assert.equal(report.status, "pending");
        const ex = JSON.parse(
          db
            .prepare(
              "SELECT result_json FROM activity_extractions WHERE activity_id=?",
            )
            .get(report.id).result_json,
        );
        assert.ok(ex.suggestions);
        await hook(
          "message",
          { message: { id: "m2", type: "text", text: "รายงานกิจกรรมบริการ" } },
          id,
        );
        assert.equal(
          db.prepare("SELECT COUNT(*) n FROM activities").get().n,
          before + 1,
        );
        await hook("postback", {
          postback: { data: `rm=append&id=${report.id}&v=${report.version}` },
        });
        const appendEvent = await hook("message", {
          message: {
            id: "m3",
            type: "text",
            text: "รายละเอียดส่วนที่สอง: ดำเนินการร่วมกับเครือข่าย",
          },
        });
        assert.equal(
          db
            .prepare("SELECT activity_id FROM inbox WHERE event_id=?")
            .get(appendEvent).activity_id,
          report.id,
        );
        assert.match(
          db
            .prepare("SELECT source_text FROM activities WHERE id=?")
            .get(report.id).source_text,
          /รายละเอียดส่วนที่สอง/,
        );
        const imageEvent = await hook("message", {
          message: { id: "987654", type: "image" },
        });
        const linked = db
          .prepare("SELECT activity_id,file_id FROM inbox WHERE event_id=?")
          .get(imageEvent);
        assert.equal(linked.activity_id, report.id);
        assert.ok(linked.file_id);
        assert.equal(
          db
            .prepare("SELECT activity_id FROM files WHERE id=?")
            .get(linked.file_id).activity_id,
          report.id,
        );
        report.version = db
          .prepare("SELECT version FROM activities WHERE id=?")
          .get(report.id).version;
        db.prepare(
          "UPDATE activities SET category_id=1,date='2026-10-21',area='ชุมชน',workers='เจ้าหน้าที่',result='บริการ 85 ราย' WHERE id=?",
        ).run(report.id);
        await hook("postback", {
          postback: { data: `rm=confirm&id=${report.id}&v=${report.version}` },
        });
        const ready = db
          .prepare("SELECT * FROM activities WHERE id=?")
          .get(report.id);
        assert.equal(ready.status, "ready");
        assert.ok(ready.owner_confirmed_at);
        await hook("unfollow", {});
        assert.equal(
          db.prepare("SELECT active FROM users WHERE id=?").get(users.staff)
            .active,
          0,
        );
        assert.equal((await req("/auth/me", "staff")).status, 401);
        db.prepare("UPDATE users SET active=1 WHERE id=?").run(users.staff);
      } finally {
        globalThis.fetch = fetch0;
        if (saved.secret === undefined) delete process.env.LINE_CHANNEL_SECRET;
        else process.env.LINE_CHANNEL_SECRET = saved.secret;
        if (saved.token === undefined)
          delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
        else process.env.LINE_CHANNEL_ACCESS_TOKEN = saved.token;
        setting("line_reply_enabled", false);
      }
    });
    it("prevents login CSRF and registers only staff until a distinct authorized person approves", async () => {
      const raw = "c".repeat(64);
      db.prepare("INSERT INTO line_registrations VALUES(?,?,?,?,?)").run(
        digest(raw),
        "U" + "c".repeat(32),
        "ชื่อจาก LINE",
        null,
        Date.now() + 60000,
      );
      const r = await req("/auth/line/register", null, "POST", {
        registration_token: raw,
        name: "บุคลากรใหม่",
        unit_id: 1,
        work_id: works[1],
        position: "หัวหน้าศูนย์",
        personnel_type: "พนักงานจ้าง",
        requested_role: "center_head",
      });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      assert.deepEqual(r.data.user.roles, ["staff"]);
      const proposal = db
        .prepare("SELECT * FROM role_requests WHERE user_id=?")
        .get(r.data.user.id);
      assert.equal(
        (
          await req(
            "/role-requests/" + proposal.id + "/resolve",
            "outside",
            "POST",
            { approve: true, reason: "ทดสอบ" },
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await req(
            "/role-requests/" + proposal.id + "/resolve",
            "head",
            "POST",
            { approve: true, reason: "ตรวจตำแหน่งแล้ว" },
          )
        ).status,
        200,
      );
      assert.ok(
        JSON.parse(
          db.prepare("SELECT roles FROM users WHERE id=?").get(r.data.user.id)
            .roles,
        ).includes("center_head"),
      );
      assert.equal(
        (await req("/auth/line/callback?state=wrong&code=wrong", null)).status,
        503,
      );
      assert.equal(
        (
          await req("/auth/line/register", null, "POST", {
            registration_token: raw,
            name: "ซ้ำ",
            unit_id: 1,
            work_id: works[1],
            position: "ตำแหน่ง",
            personnel_type: "พนักงานจ้าง",
          })
        ).status,
        401,
      );
    });
  },
);
