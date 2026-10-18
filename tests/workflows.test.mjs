import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { digest, token } from "../server/security.js";
import { openDatabase } from "../server/db.js";
import { reportPeriod, periodLabel, csvCell } from "../shared/report-period.js";

it("uses Thai fiscal year boundaries and exact previous calendar periods", () => {
  assert.deepEqual(reportPeriod({ period: "year", anchor: "2026-10-17" }), {
    from: "2026-10-01",
    to: "2027-09-30",
    previous: { from: "2025-10-01", to: "2026-09-30" },
  });
  assert.equal(
    reportPeriod({ period: "year", anchor: "2026-09-30" }).from,
    "2025-10-01",
  );
  assert.deepEqual(reportPeriod({ period: "quarter", anchor: "2026-01-31" }), {
    from: "2026-01-01",
    to: "2026-03-31",
    previous: { from: "2025-10-01", to: "2025-12-31" },
  });
  assert.equal(
    periodLabel("quarter", "2026-10-01"),
    "ไตรมาส 1 ปีงบประมาณ 2570",
  );
  assert.equal(
    periodLabel("quarter", "2026-07-01"),
    "ไตรมาส 4 ปีงบประมาณ 2569",
  );
  assert.equal(
    reportPeriod({ period: "month", anchor: "2024-03-31" }).previous.to,
    "2024-02-29",
  );
  assert.deepEqual(
    reportPeriod({ period: "custom", from: "2026-10-10", to: "2026-10-12" })
      .previous,
    { from: "2026-10-07", to: "2026-10-09" },
  );
  assert.throws(() => reportPeriod({ period: "month", anchor: "2026-02-30" }));
  assert.throws(() =>
    reportPeriod({ period: "custom", from: "2026-10-10", to: "2026-01-01" }),
  );
  assert.equal(csvCell(" =SUM(A1)"), '"\' =SUM(A1)"');
  assert.equal(csvCell('hello,"world"'), '"hello,""world"""');
});
describe("Period reports and persistent project workflow", () => {
  let app,
    server,
    dir,
    base,
    cookies = {},
    ids = {},
    reports = {},
    projectId,
    taskId;
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "rm-workflows-"));
    app = createApp({ dataDir: dir, disableRateLimit: true });
    const db = app.locals.db;
    for (const [name, roles, unit, scopes] of [
      ["staff", ["staff"], 1, []],
      ["peer", ["staff"], 1, []],
      ["outside", ["staff"], 2, []],
      ["head", ["head"], 1, [1]],
      ["exec", ["executive"], null, []],
      ["admin", ["admin"], null, []],
    ]) {
      const work = unit
        ? db.prepare("SELECT id FROM works WHERE unit_id=? LIMIT 1").get(unit)
            .id
        : null;
      ids[name] = Number(
        db
          .prepare(
            "INSERT INTO users(username,name,password_hash,unit_id,work_id,roles,scopes) VALUES(?,?,?,?,?,?,?)",
          )
          .run(
            name,
            name,
            "unused",
            unit,
            work,
            JSON.stringify(roles),
            JSON.stringify(scopes),
          ).lastInsertRowid,
      );
      const raw = token(),
        csrf = token();
      cookies[name] = { raw, csrf };
      db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
        digest(raw),
        ids[name],
        csrf,
        Date.now() + 3600000,
      );
    }
    for (const [name, owner, unit, date, status, metrics] of [
      [
        "ready",
        "staff",
        1,
        "2026-10-02",
        "ready",
        [
          { label: "ผู้รับบริการ", value: 19, unit: "ราย" },
          { label: "ผู้รับบริการ", value: 29, unit: "ครั้งบริการ" },
        ],
      ],
      ["previous", "staff", 1, "2026-09-12", "ready", []],
      [
        "pending",
        "staff",
        1,
        null,
        "pending",
        [{ label: "ผู้รับบริการ", value: 999, unit: "ราย" }],
      ],
      ["peer", "peer", 1, "2026-10-03", "ready", []],
      ["outside", "outside", 2, "2026-10-04", "ready", []],
    ]) {
      reports[name] = Number(
        db
          .prepare(
            "INSERT INTO activities(title,date,unit_id,category_id,area,workers,result,metrics,status,source,owner_id,created_at) VALUES(?,?,?,1,'ชุมชน','ทีมปฏิบัติงาน','ผลตามต้นฉบับ',?,?,'web',?,'2026-10-02T00:00:00Z')",
          )
          .run(name, date, unit, JSON.stringify(metrics), status, ids[owner])
          .lastInsertRowid,
      );
    }
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    base = `http://127.0.0.1:${server.address().port}/api`;
  });
  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.locals.db.close();
    await rm(dir, { recursive: true, force: true });
  });
  async function req(path, as = "staff", method = "GET", body) {
    const c = cookies[as];
    const r = await fetch(base + path, {
      method,
      headers: {
        Cookie: `rm_session=${c.raw}`,
        Origin: "http://localhost:5173",
        "X-CSRF-Token": c.csrf,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      data: r.headers.get("content-type")?.includes("json")
        ? await r.json()
        : await r.text(),
    };
  }
  it("restricts summary and CSV scope while keeping pending numbers out of totals", async () => {
    const path = "/reports/summary?period=month&anchor=2026-10-17";
    const own = await req(path);
    assert.equal(own.status, 200);
    assert.equal(own.data.ready, 1);
    assert.equal(own.data.pending, 1);
    assert.equal(own.data.previous.ready, 1);
    assert.deepEqual(
      own.data.metrics.map((m) => [m.value, m.unit]),
      [
        [19, "ราย"],
        [29, "ครั้งบริการ"],
      ],
    );
    assert.equal((await req(path + "&scope=all")).status, 403);
    assert.equal((await req(path + "&scope=unit", "head")).data.ready, 2);
    assert.equal((await req(path + "&scope=unit&unit=2", "head")).status, 403);
    assert.equal((await req(path + "&scope=all", "exec")).data.ready, 3);
    assert.equal((await req(path, "admin")).status, 403);
    assert.equal((await req("/reports/summary?anchor=bad")).status, 400);
    const csv = await req("/reports/export?period=month&anchor=2026-10-17");
    assert.equal(csv.status, 200);
    assert.match(csv.data, /ครั้งบริการ/);
    assert.doesNotMatch(csv.data, /outside/);
    assert.equal(
      (await req("/reports/export?period=month&anchor=2026-10-17&scope=all"))
        .status,
      403,
    );
  });
  it("only a scoped head creates a project and assigns active staff in their unit", async () => {
    const body = {
      title: "ติดตามงานสุขภาพ",
      unit_id: 1,
      due_date: "2026-10-31",
    };
    assert.equal((await req("/projects", "staff", "POST", body)).status, 403);
    assert.equal(
      (await req("/projects", "head", "POST", { ...body, unit_id: 2 })).status,
      403,
    );
    const p = await req("/projects", "head", "POST", body);
    assert.equal(p.status, 201);
    projectId = p.data.id;
    assert.equal((await req("/projects/" + projectId)).status, 404);
    assert.equal((await req("/projects/members?unit=2", "head")).status, 403);
    const task = {
      title: "ติดตามชุมชน",
      assignee_id: ids.outside,
      due_date: "2026-10-20",
      version: 1,
    };
    assert.equal(
      (await req(`/projects/${projectId}/tasks`, "head", "POST", task)).status,
      400,
    );
    const assigned = await req(`/projects/${projectId}/tasks`, "head", "POST", {
      ...task,
      assignee_id: ids.staff,
    });
    assert.equal(assigned.status, 201);
    taskId = assigned.data.tasks[0].id;
    assert.equal((await req("/projects/" + projectId)).status, 200);
    assert.equal((await req("/projects/" + projectId, "peer")).status, 404);
    assert.equal((await req("/projects/" + projectId, "exec")).status, 200);
    assert.equal((await req("/projects", "admin")).status, 403);
    assert.equal(
      (
        await req("/projects/" + projectId, "head", "PATCH", {
          status: "completed",
          version: 2,
        })
      ).status,
      400,
    );
  });
  it("requires a confirmed owned report, prevents stale updates and locks accepted evidence", async () => {
    const path = `/project-tasks/${taskId}/action`;
    assert.equal(
      (
        await req(path, "staff", "POST", {
          action: "submit",
          activity_id: reports.pending,
          version: 1,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req(path, "staff", "POST", {
          action: "submit",
          activity_id: reports.peer,
          version: 1,
        })
      ).status,
      400,
    );
    assert.equal(
      (await req(path, "peer", "POST", { action: "start", version: 1 })).status,
      404,
    );
    assert.equal(
      (
        await req(path, "staff", "POST", {
          action: "submit",
          activity_id: reports.ready,
          version: 1,
        })
      ).status,
      200,
    );
    assert.equal(
      (await req(path, "head", "POST", { action: "approve", version: 1 }))
        .status,
      409,
    );
    assert.equal(
      (await req(path, "staff", "POST", { action: "approve", version: 2 }))
        .status,
      403,
    );
    assert.equal(
      (await req(path, "head", "POST", { action: "approve", version: 2 }))
        .status,
      200,
    );
    const accepted = await req("/activities/" + reports.ready);
    assert.equal(accepted.data.can_edit, false);
    assert.equal(accepted.data.locked_by_project, true);
    const before = app.locals.db
      .prepare("SELECT * FROM activities WHERE id=?")
      .get(reports.ready);
    const body = {
      ...before,
      status: "pending",
      metrics: JSON.parse(before.metrics),
      intake: false,
      news_requested: Boolean(before.news_requested),
      brief: Boolean(before.brief),
    };
    assert.equal(
      (await req("/activities/" + reports.ready, "staff", "PUT", body)).status,
      409,
    );
    let p = (await req("/projects/" + projectId, "head")).data;
    assert.equal(
      (
        await req("/projects/" + projectId, "head", "PATCH", {
          status: "completed",
          version: p.version,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await req(path, "head", "POST", {
          action: "return",
          note: "แก้ไขรายละเอียด",
          version: 3,
        })
      ).status,
      400,
    );
    p = (await req("/projects/" + projectId, "head")).data;
    await req("/projects/" + projectId, "head", "PATCH", {
      status: "active",
      version: p.version,
    });
    assert.equal(
      (
        await req(path, "head", "POST", {
          action: "return",
          note: "แก้ไขรายละเอียด",
          version: 3,
        })
      ).status,
      200,
    );
    assert.equal(
      (await req("/activities/" + reports.ready, "staff", "PUT", body)).status,
      200,
    );
    assert.ok(
      app.locals.db
        .prepare("SELECT COUNT(*) n FROM audits WHERE entity='project'")
        .get().n >= 6,
    );
  });
  it("keeps project records after reopening the database and does not add duplicate activity totals", async () => {
    const reopened = openDatabase(dir);
    assert.equal(
      reopened.db.prepare("SELECT COUNT(*) n FROM projects").get().n,
      1,
    );
    assert.equal(
      reopened.db.prepare("SELECT COUNT(*) n FROM project_tasks").get().n,
      1,
    );
    reopened.db.close();
    assert.equal(
      app.locals.db.prepare("SELECT COUNT(*) n FROM activities").get().n,
      5,
    );
  });
  it("requires a head and verified source for project targets and keeps metric units separate", async () => {
    const p = (await req("/projects/" + projectId, "head")).data;
    const body = {
      version: p.version,
      label: "ผู้รับบริการ",
      unit: "ราย",
      value: 100,
      source: "แผนโครงการ หน้า 2",
      verified: true,
    };
    assert.equal(
      (await req(`/projects/${projectId}/target`, "staff", "PUT", body)).status,
      403,
    );
    assert.equal(
      (
        await req(`/projects/${projectId}/target`, "head", "PUT", {
          ...body,
          verified: false,
        })
      ).status,
      400,
    );
    const r = await req(`/projects/${projectId}/target`, "head", "PUT", body);
    assert.equal(r.status, 200);
    const expected = r.data.performance.sources
      .flatMap((s) =>
        JSON.parse(s.metrics).filter(
          (m) => m.label === body.label && m.unit === body.unit,
        ),
      )
      .reduce((n, m) => n + m.value, 0);
    assert.equal(r.data.performance.actual, expected || null);
    assert.equal(
      (await req(`/projects/${projectId}/target`, "head", "PUT", body)).status,
      409,
    );
  });
});
