import { before, after, it, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { token, digest } from "../server/security.js";
import { openDatabase } from "../server/db.js";

describe("Real dashboard periods, duplicate decisions and calendar", () => {
  let app, db, dir, server, url;
  const users = {},
    auth = {},
    ids = {};
  const source = "ต้นฉบับคำค้นเฉพาะ ห้ามหาย";
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "rm-insights-"));
    app = createApp({ dataDir: dir, disableRateLimit: true });
    db = app.locals.db;
    for (const [name, roles, unit, scopes] of [
      ["staff", ["staff"], 1, []],
      ["peer", ["staff"], 1, []],
      ["outside", ["staff"], 2, []],
      ["head", ["head"], 1, [1]],
      ["otherhead", ["head"], 2, [2]],
      ["admin", ["admin"], null, []],
      ["pr", ["pr"], null, []],
      ["exec", ["executive"], null, []],
    ]) {
      const work = unit
        ? db.prepare("SELECT id FROM works WHERE unit_id=? LIMIT 1").get(unit)
            .id
        : null;
      users[name] = Number(
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
      db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
        digest(raw),
        users[name],
        csrf,
        Date.now() + 60000,
      );
      auth[name] = { Cookie: `rm_session=${raw}`, "X-CSRF-Token": csrf };
    }
    const add = (
      key,
      title,
      date,
      metrics,
      owner = "staff",
      status = "ready",
      unit = 1,
    ) => {
      ids[key] = Number(
        db
          .prepare(
            "INSERT INTO activities(title,date,unit_id,work_id,category_id,owner_id,status,source,source_text,area,workers,result,metrics) VALUES(?,?,?,(SELECT id FROM works WHERE unit_id=? LIMIT 1),1,?,?,'web',?,'ชุมชน','ทีมงาน','ผลจากต้นฉบับ',?)",
          )
          .run(
            title,
            date,
            unit,
            unit,
            users[owner],
            status,
            source,
            JSON.stringify(metrics),
          ).lastInsertRowid,
      );
    };
    add("a", "ประชุมเครือข่าย", "2026-10-02", [
      { label: "ผู้เข้าร่วม", unit: "คน", value: 19 },
    ]);
    add("b", "ประชุม เครือข่าย", "2026-10-02", [
      { label: "ผู้เข้าร่วม", unit: "คน", value: 19 },
    ]);
    add("zero", "ติดตามผล", "2026-10-04", [
      { label: "ผู้เข้าร่วม", unit: "คน", value: 0 },
      { label: "รับบริการ", unit: "ครั้งบริการ", value: 29 },
    ]);
    add("old", "ปีก่อน", "2026-09-30", [
      { label: "ผู้เข้าร่วม", unit: "คน", value: 7 },
    ]);
    add(
      "outside",
      "ฝ่ายอื่น",
      "2026-10-02",
      [{ label: "ผู้เข้าร่วม", unit: "คน", value: 100 }],
      "outside",
      "ready",
      2,
    );
    add("pending", "ไม่มีวันที่", null, [], "staff", "pending");
    const config = {
      required_fields: ["date", "area", "result"],
      metrics: [
        { label: "ผู้เข้าร่วม", unit: "คน", method: "max", required: true },
      ],
      include_trend: true,
      include_projects: true,
      headings: { summary: "สรุป", problems: "ปัญหา", next_steps: "ต่อไป" },
    };
    db.prepare("UPDATE summary_templates SET config=?,active=1 WHERE id=1").run(
      JSON.stringify(config),
    );
    db.prepare("INSERT INTO activity_extractions VALUES(?,?)").run(
      ids.a,
      JSON.stringify({ parts: [{ text: "คำค้นจากเอกสารอ่านแล้ว" }] }),
    );
    db.prepare(
      "INSERT INTO files(original_name,storage_name,mime,size,title,purpose,unit_id,owner_id,activity_id,description) VALUES('a.pdf','not-served','application/pdf',10,'หลักฐาน','evidence',1,?,?,'ข้อความฝากค้น')",
    ).run(users.staff, ids.a);
    server = await new Promise((resolve, reject) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
      s.on("error", reject);
    });
    url = `http://127.0.0.1:${server.address().port}`;
  });
  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    db?.close();
    await rm(dir, { recursive: true, force: true });
  });
  const request = async (path, user = "staff", body) => {
    const res = await fetch(url + "/api" + path, {
      method: body ? "PUT" : "GET",
      headers: {
        ...auth[user],
        Origin: "http://localhost:5173",
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: await res.json() };
  };
  const decision = (id, target, user = "staff", version = 1) =>
    request(`/activities/${id}/duplicate`, user, {
      version,
      duplicate_of: target,
      reason: "ตรวจต้นฉบับแล้วเป็นกิจกรรมเดียวกัน",
    });
  it("uses fiscal ranges, real zero, central max rules and exact source IDs", async () => {
    const r = await request("/dashboard?period=year&anchor=2026-10-18&mine=1");
    assert.equal(r.status, 200);
    assert.equal(r.data.ready, 3);
    assert.deepEqual(r.data.range, { from: "2026-10-01", to: "2027-09-30" });
    assert.equal(r.data.metrics.find((m) => m.unit === "คน").value, 19);
    assert.equal(r.data.metrics.find((m) => m.unit === "คน").method, "max");
    assert.equal(
      r.data.metrics.find((m) => m.unit === "ครั้งบริการ").value,
      29,
    );
    assert.equal(
      (await request("/dashboard?period=month&anchor=2026-02-30")).status,
      400,
    );
    const drill = await request("/activities?ids=" + ids.zero);
    assert.deepEqual(
      drill.data.items.map((r) => r.id),
      [ids.zero],
    );
    assert.equal(drill.data.items[0].metrics[0].value, 0);
    const previous = (
      await request(
        "/reports/summary?scope=mine&period=month&anchor=2026-10-18",
      )
    ).data.previous;
    assert.equal(previous.metrics[0].value, 7);
  });
  it("finds source text and actual extracted document text in activities and attached files", async () => {
    assert.ok(
      (
        await request(
          "/activities?q=" + encodeURIComponent("ต้นฉบับคำค้นเฉพาะ"),
        )
      ).data.items.length,
    );
    assert.equal(
      (
        await request(
          "/activities?q=" + encodeURIComponent("คำค้นจากเอกสารอ่านแล้ว"),
        )
      ).data.items[0].id,
      ids.a,
    );
    assert.equal(
      (
        await request(
          "/files?q=" + encodeURIComponent("คำค้นจากเอกสารอ่านแล้ว"),
        )
      ).data.total,
      1,
    );
    assert.equal(
      (await request("/files?from=2000-01-01&to=2000-01-02")).data.total,
      0,
    );
  });
  it("reads shared calendar only from actual activity dates and retains undated sources", async () => {
    const r = await request("/calendar?from=2026-10-01&to=2026-10-31");
    assert.equal(r.status, 200);
    assert.equal(r.data.items.length, 4);
    assert.ok(!r.data.items.some((r) => r.id === ids.pending));
    assert.equal(
      (await request("/calendar?from=2026-10-01&to=2026-10-31&mine=1")).data
        .items.length,
      3,
    );
    assert.equal(
      (await request("/calendar?from=2026-02-30&to=2026-10-31")).status,
      400,
    );
    assert.equal(
      (await request("/calendar?from=2026-01-01&to=2026-12-31")).status,
      400,
    );
    assert.ok(
      db
        .prepare("SELECT source_text FROM activities WHERE id=?")
        .get(ids.pending),
    );
  });
  it("requires write permissions, valid canonical source and current version for duplicate decisions", async () => {
    assert.equal(
      (await request(`/activities/${ids.b}/duplicates`)).data.items[0].id,
      ids.a,
    );
    for (const name of ["peer", "outside", "otherhead", "admin", "pr", "exec"])
      assert.equal((await decision(ids.b, ids.a, name)).status, 403, name);
    assert.equal((await decision(ids.b, ids.a, "head", 99)).status, 409);
    assert.equal((await decision(ids.b, ids.b)).status, 400);
    assert.equal((await decision(ids.b, ids.outside)).status, 400);
    assert.equal((await decision(ids.b, ids.pending)).status, 400);
    assert.equal((await decision(ids.b, ids.a, "head")).status, 200);
    const kept = db.prepare("SELECT * FROM activities WHERE id=?").get(ids.b);
    assert.equal(kept.source_text, source);
    assert.equal(JSON.parse(kept.metrics)[0].value, 19);
    assert.equal(kept.status, "ready");
    assert.equal(kept.version, 2);
    assert.equal((await decision(ids.a, ids.b)).status, 400);
  });
  it("excludes confirmed duplicates consistently and preserves original rows and history", async () => {
    const dashboard = (
      await request("/dashboard?period=month&anchor=2026-10-18&mine=1")
    ).data;
    assert.equal(dashboard.ready, 2);
    assert.equal(dashboard.duplicates, 1);
    const report = (
      await request(
        "/reports/summary?scope=mine&period=month&anchor=2026-10-18",
      )
    ).data;
    assert.equal(report.ready, 2);
    assert.equal(report.duplicates, 1);
    assert.equal(report.rows.length, 4);
    const readiness = (
      await request(
        "/reports/readiness?scope=mine&period=month&anchor=2026-10-18",
      )
    ).data;
    assert.equal(readiness.rows.find((r) => r.id === ids.b).eligible, false);
    assert.equal(
      readiness.rows.find((r) => r.id === ids.a).duplicate_ids.length,
      0,
    );
    const metricSources = (
      await request(
        "/activities?mine=1&metric_label=" +
          encodeURIComponent("ผู้เข้าร่วม") +
          "&metric_unit=" +
          encodeURIComponent("คน") +
          "&metric_method=max&from=2026-10-01&to=2026-10-31",
      )
    ).data;
    assert.deepEqual(
      new Set(metricSources.items.map((r) => r.id)),
      new Set([ids.a, ids.zero]),
    );
    assert.equal(
      (await request("/activities?status=duplicate&mine=1")).data.items[0].id,
      ids.b,
    );
    assert.ok(
      db
        .prepare(
          "SELECT id FROM audits WHERE entity_id=? AND action='ยืนยันรายการซ้ำ ไม่รวมยอด'",
        )
        .get(ids.b),
    );
    assert.equal((await decision(ids.b, null, "staff", 2)).status, 200);
    assert.equal(
      (await request("/dashboard?period=month&anchor=2026-10-18&mine=1")).data
        .ready,
      3,
    );
    assert.equal((await decision(ids.b, ids.a, "staff", 3)).status, 200);
    const reopened = openDatabase(dir);
    assert.equal(
      reopened.db
        .prepare("SELECT duplicate_of FROM activities WHERE id=?")
        .get(ids.b).duplicate_of,
      ids.a,
    );
    reopened.db.close();
  });
});
