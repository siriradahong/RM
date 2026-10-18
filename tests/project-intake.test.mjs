import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createApp } from "../server/app.js";
import { hashPassword } from "../server/security.js";
import { prepareProject } from "../server/project-intake.js";
import { makeTextDocx } from "../server/report-docx.js";

describe(
  "Project intake, automatic distribution and linked calendar",
  { concurrency: false },
  () => {
    let dir, app, db, server, base, pid;
    const users = {},
      sessions = {},
      password = "Project-test-password-2026!";
    async function req(path, as = "head", method = "GET", body) {
      const a = sessions[as];
      const form = body instanceof FormData;
      const r = await fetch(base + "/api" + path, {
        method,
        headers: {
          Origin: "http://localhost:3001",
          ...(a ? { Cookie: a.cookie, "X-CSRF-Token": a.csrf } : {}),
          ...(!form && body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? (form ? body : JSON.stringify(body)) : undefined,
      });
      return { status: r.status, data: await r.json(), headers: r.headers };
    }
    const task = (name = "staff") => ({
      title: "ลงพื้นที่ชุมชน",
      assignee_id: users[name],
      due_date: "2026-10-25",
      start_time: "09:00",
      end_time: "11:00",
      source_quote: "มอบหมายลงพื้นที่",
    });
    const project = (tasks = [task()]) => ({
      title: "โครงการคัดกรอง",
      unit_id: 1,
      due_date: "2026-10-31",
      source_text: "ต้นฉบับโครงการสำหรับหัวหน้า",
      tasks,
      submission_key: randomUUID(),
    });
    before(async () => {
      dir = await mkdtemp(join(tmpdir(), "rm-project-intake-"));
      app = createApp({ dataDir: dir, disableRateLimit: true });
      db = app.locals.db;
      const hash = await hashPassword(password);
      for (const [name, roles, unit, scopes] of [
        ["staff", ["staff"], 1, []],
        ["peer", ["staff"], 1, []],
        ["outside", ["staff"], 2, []],
        ["head", ["head"], 1, [1]],
        ["center", ["center_head"], 1, []],
        ["head2", ["head"], 2, [2]],
        ["exec", ["executive"], null, []],
        ["admin", ["admin"], null, []],
      ]) {
        const work = unit
          ? db.prepare("SELECT id FROM works WHERE unit_id=? LIMIT 1").get(unit)
              .id
          : null;
        users[name] = Number(
          db
            .prepare(
              "INSERT INTO users(username,name,password_hash,roles,unit_id,work_id,scopes) VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              name,
              "บุคลากร " + name,
              hash,
              JSON.stringify(roles),
              unit,
              work,
              JSON.stringify(scopes),
            ).lastInsertRowid,
        );
      }
      db.prepare(
        "UPDATE users SET work_scopes=json_array(work_id) WHERE id=?",
      ).run(users.center);
      server = await new Promise((resolve, reject) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
        s.on("error", reject);
      });
      base = "http://127.0.0.1:" + server.address().port;
      for (const name of Object.keys(users)) {
        const r = await req("/auth/login", null, "POST", {
          username: name,
          password,
        });
        assert.equal(r.status, 200);
        sessions[name] = {
          cookie: r.headers.get("set-cookie").split(";")[0],
          csrf: r.data.csrf,
        };
      }
    });
    after(async () => {
      await new Promise((r) => server.close(r));
      db.close();
      await rm(dir, { recursive: true, force: true });
    });
    it("extracts explicit assignments, Buddhist dates and times without inventing people", () => {
      const r = prepareProject(
        "ชื่อโครงการ: โครงการสุขภาพ\nสิ้นสุดโครงการ: 31/10/2569\n- ลงพื้นที่ | บุคลากร staff | 25/10/2569 | 09:00–11:00\n- สรุปผล | คนไม่อยู่ในระบบ | ยังไม่ระบุวันที่",
        [{ id: users.staff, name: "บุคลากร staff" }],
      );
      assert.equal(r.title, "โครงการสุขภาพ");
      assert.equal(r.due_date, "2026-10-31");
      assert.equal(r.tasks.length, 2);
      assert.equal(r.tasks[0].assignee_id, users.staff);
      assert.equal(r.tasks[0].start_time, "09:00");
      assert.equal(r.tasks[1].assignee_id, null);
      assert.equal(r.tasks[1].due_date, "");
      assert.equal(
        prepareProject("- วัตถุประสงค์พัฒนาชุมชน", []).tasks.length,
        0,
      );
      assert.equal(
        prepareProject("- งาน | บุคลากร staff เพิ่มเติม | 25/10/2569", [
          { id: users.staff, name: "บุคลากร staff" },
        ]).tasks[0].assignee_id,
        null,
      );

      assert.equal(
        prepareProject("ประชุมร่วมกับ บุคลากร staff เมื่อ 25/10/2569", [
          { id: users.staff, name: "บุคลากร staff" },
        ]).tasks.length,
        0,
      );
    });
    it("limits preparation and member discovery to the managing roles", async () => {
      const body = {
        unit_id: 1,
        source_text: "- ลงพื้นที่ | บุคลากร staff | 25/10/2569",
      };
      for (const as of ["staff", "admin", "head2"])
        assert.equal(
          (await req("/projects/prepare", as, "POST", body)).status,
          403,
        );
      assert.equal(
        (await req("/projects/prepare", "head", "POST", body)).data.tasks[0]
          .assignee_id,
        users.staff,
      );
      assert.equal((await req("/projects/members?unit=1", "exec")).status, 200);
    });
    it("limits center assignments to their work tree and rejects a recipient from another work", async () => {
      const root = db
        .prepare("SELECT work_id FROM users WHERE id=?")
        .get(users.center).work_id;
      const other = Number(
        db
          .prepare(
            "INSERT INTO works(name,unit_id) VALUES('งานนอกศูนย์ทดสอบ',1)",
          )
          .run().lastInsertRowid,
      );
      db.prepare("UPDATE users SET work_id=? WHERE id=?").run(
        other,
        users.peer,
      );
      const members = (
        await req("/projects/members?unit=1&work=" + root, "center")
      ).data.items;
      assert.ok(members.some((m) => m.id === users.staff));
      assert.ok(!members.some((m) => m.id === users.peer));
      assert.equal(
        (
          await req("/projects", "head", "POST", {
            ...project([task("peer")]),
            work_id: root,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await req("/projects/prepare", "center", "POST", {
            unit_id: 2,
            work_id:db.prepare("SELECT id FROM works WHERE unit_id=2 LIMIT 1").get().id,
            source_text: "- งาน | บุคลากร outside | 25/10/2569",
          })
        ).status,
        403,
      );
    });
    it("reads a real local DOCX without creating reports or projects", async () => {
      const invalid = new FormData();
      invalid.append("file", new Blob(["invalid"]), "bad.pdf");
      assert.equal(
        (await req("/projects/read", "head", "POST", invalid)).status,
        415,
      );
      const body = new FormData();
      body.append(
        "file",
        new Blob([
          makeTextDocx("ชื่อโครงการ: ทดสอบอ่านโครงการ", [
            {
              heading: "งาน",
              text: "- ลงพื้นที่ | บุคลากร staff | 25/10/2569",
            },
          ]),
        ]),
        "project.docx",
      );
      const r = await req("/projects/read", "head", "POST", body);
      assert.equal(r.status, 200, JSON.stringify(r.data));
      assert.match(r.data.text, /ทดสอบอ่านโครงการ/);
      assert.equal(db.prepare("SELECT count(*) n FROM projects").get().n, 0);
    });
    it("rejects bad recipients, dates and times atomically", async () => {
      for (const bad of [
        { ...task(), assignee_id: users.outside },
        { ...task(), due_date: "2026-11-01" },
        { ...task(), start_time: "12:00" },
        { ...task(), end_time: null },
      ]) {
        const r = await req(
          "/projects",
          "head",
          "POST",
          project([task(), bad]),
        );
        assert.equal(r.status, 400, JSON.stringify(r.data));
      }
      assert.equal(
        db.prepare("SELECT count(*) n FROM project_tasks").get().n,
        0,
      );
      assert.equal(db.prepare("SELECT count(*) n FROM projects").get().n, 0);
    });
    it("creates the project and assignments once and automatically links calendar entries", async () => {
      const body = project([
        task(),
        { ...task("peer"), title: "เตรียมพื้นที่" },
      ]);
      const r = await req("/projects", "head", "POST", body);
      assert.equal(r.status, 201, JSON.stringify(r.data));
      pid = r.data.id;
      assert.equal(r.data.tasks.length, 2);
      assert.equal((await req("/projects", "head", "POST", body)).data.id, pid);
      assert.equal(
        db.prepare("SELECT count(*) n FROM project_tasks").get().n,
        2,
      );
      assert.equal(
        db
          .prepare(
            "SELECT count(*) n FROM notifications WHERE kind='assignment'",
          )
          .get().n,
        2,
      );
      const c = await req("/events?from=2026-10-01&to=2026-10-31", "staff");
      assert.equal(c.data.items.length, 1);
      assert.equal(c.data.items[0].project_id, pid);
      assert.equal(c.data.items[0].assignee_id, users.staff);
      const own = await req("/projects/" + pid, "staff");
      assert.equal(own.data.source_text, undefined);
      assert.equal(own.data.tasks.length, 1);
      for (const as of ["outside", "head2", "admin"])
        assert.equal(
          (await req("/events?from=2026-10-01&to=2026-10-31", as)).data.items
            .length,
          0,
        );
      assert.equal(
        (await req("/events?from=2026-10-01&to=2026-10-31", "head")).data.items
          .length,
        2,
      );
    });
    it("detects real overlaps and immediately follows approved deadline extensions", async () => {
      const tid = db
        .prepare(
          "SELECT id FROM project_tasks WHERE project_id=? AND assignee_id=?",
        )
        .get(pid, users.staff).id;
      let r = await req("/events", "head", "POST", {
        title: "นัดประชุม",
        date: "2026-10-25",
        start_time: "10:00",
        end_time: "12:00",
        unit_id: 1,
        work_id: null,
        attendee_ids: [users.staff],
      });
      assert.equal(r.status, 201);
      let c = (await req("/events?from=2026-10-01&to=2026-10-31", "staff"))
        .data;
      assert.equal(c.conflicts.length, 1);
      assert.ok(c.conflicts[0].keys.includes("task-" + tid));
      r = await req("/tasks/" + tid + "/extensions", "staff", "POST", {
        date: "2026-10-26",
        reason: "เลื่อนวันลงพื้นที่",
      });
      assert.equal(r.status, 201, JSON.stringify(r.data));
      const ext = db
        .prepare("SELECT id FROM task_extensions WHERE task_id=?")
        .get(tid);
      assert.equal(
        (
          await req("/task-extensions/" + ext.id + "/resolve", "head", "POST", {
            approve: true,
          })
        ).status,
        200,
      );
      c = (await req("/events?from=2026-10-01&to=2026-10-31", "staff")).data;
      assert.equal(
        c.items.find((e) => e.key === "task-" + tid).date,
        "2026-10-26",
      );
      assert.equal(c.conflicts.length, 0);
      assert.equal(
        db.prepare("SELECT count(*) n FROM calendar_events").get().n,
        1,
      );
    });
  },
);
