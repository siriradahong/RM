import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server/app.js";
import { digest, token } from "../server/security.js";
import { calculate, inspectRows } from "../server/summary-engine.js";
// Generated, non-personal illustration for testing image preservation and document layout.
const fixtureImage = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAlgAAADwCAIAAABT1I0hAAAEF0lEQVR4nO3dsW2DUBRAUTtiBmZywybegNobZBM3mYnSjdsUGSCKjfKd3HN60BMUVw+QOG63+wEAqt5GDwAAIwkhAGlCCECaEAKQJoQApAkhAGlCCECaEAKQJoQApAkhAGlCCECaEAKQJoQApAkhAGlCCECaEAKQJoQApAkhAGlCCEDa9MzB8+m83yQA8Ljt4/2xA22EAKQJIQBpQghA2lPvCHd5OAsAAz9VsRECkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpQghAmhACkCaEAKQJIQBpu/2PEODLfLnWLsW2LqNH4HE2QgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDSptEDwM/Ml2vtkm3rMnoE+M9shACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkCSEAaUIIQJoQApAmhACkTaMHeC3z5XqI2dZl9AgAI9kIAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDShBCANCEEIE0IAUgTQgDSptEDvJZtXUaPwDfco9fnHvG32AgBSBNCANKEEIA0IQQgTQgBSNvtq9H5dN7rVADwa2yEAKQJIQBpQghA2nG73UfPAADD2AgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCANKEEIA0IQQgTQgBSBNCAA5ln/0rHHN1XXKdAAAAAElFTkSuQmCC",
  "base64",
);
it("template calculations keep units distinct, allow zero and detect possible duplicates without merging", () => {
  const t = {
    id: 1,
    category_id: 1,
    unit_id: null,
    config: {
      required_fields: ["date"],
      metrics: [
        { label: "ผู้เข้าร่วม", unit: "คน", method: "sum", required: true },
        { label: "ปริมาณ", unit: "ตัน", method: "max", required: false },
      ],
    },
  };
  const base = {
    unit_id: 1,
    category_id: 1,
    title: "ประชุม อสม.",
    date: "2026-10-02",
    status: "ready",
  };
  const rows = [
    {
      ...base,
      id: 1,
      metrics: [
        { label: "ผู้เข้าร่วม", unit: "คน", value: 0 },
        { label: "ปริมาณ", unit: "ตัน", value: 2 },
      ],
    },
    {
      ...base,
      id: 2,
      metrics: [
        { label: "ผู้เข้าร่วม", unit: "คน", value: 19 },
        { label: "ผู้เข้าร่วม", unit: "ครั้งบริการ", value: 29 },
        { label: "ปริมาณ", unit: "ตัน", value: 3 },
      ],
    },
  ];
  const inspected = inspectRows(rows, [t]);
  assert.equal(inspected[0].missing.length, 0);
  assert.equal(inspected[0].eligible, true);
  assert.equal(inspected[0].auto_include, false);
  assert.deepEqual(inspected[0].duplicate_ids, [2]);
  assert.equal(inspectRows([rows[0]], [])[0].auto_include, false);
  assert.deepEqual(
    calculate(rows, t).map((m) => m.value),
    [2, 19, 3],
  );
});
describe("Templates, report snapshots and confirmation", () => {
  let app,
    server,
    dir,
    base,
    accounts = {},
    ids = {},
    tid,
    draft,
    imageId,
    unrelatedImageId,
    report;
  const filters = { scope: "mine", period: "month", anchor: "2026-10-02" };
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "rm-drafts-"));
    app = createApp({ dataDir: dir, disableRateLimit: true });
    const db = app.locals.db;
    for (const [name, roles, unit, scopes] of [
      ["admin", ["admin"], null, []],
      ["staff", ["staff"], 1, []],
      ["peer", ["staff"], 1, []],
      ["head", ["head"], 1, [1]],
      ["outside", ["head"], 2, [2]],
      ["exec", ["executive"], null, []],
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
      accounts[name] = { raw, csrf };
      db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
        digest(raw),
        ids[name],
        csrf,
        Date.now() + 3600000,
      );
    }
    report = Number(
      db
        .prepare(
          "INSERT INTO activities(title,date,unit_id,category_id,area,workers,result,metrics,status,source,owner_id) VALUES('ประชุมเครือข่าย อสม.','2026-10-02',1,1,'ชุมชนตัวอย่าง','เจ้าหน้าที่และ อสม.','มีผู้เข้าร่วม 19 คน',?,'ready','web',?)",
        )
        .run(
          JSON.stringify([{ label: "ผู้เข้าร่วม", unit: "คน", value: 19 }]),
          ids.staff,
        ).lastInsertRowid,
    );
    await mkdir(join(dir, "uploads"), { recursive: true });
    await writeFile(join(dir, "uploads", "fixture.png"), fixtureImage);
    const insertImage = db.prepare(
      "INSERT INTO files(original_name,storage_name,mime,size,title,purpose,unit_id,owner_id,activity_id) VALUES(?,?,'image/png',?,?,'evidence',1,?,?)",
    );
    imageId = Number(
      insertImage.run(
        "fixture.png",
        "fixture.png",
        fixtureImage.length,
        "ภาพประกอบทดสอบ ไม่ใช่หลักฐานกิจกรรมจริง",
        ids.staff,
        report,
      ).lastInsertRowid,
    );
    unrelatedImageId = Number(
      insertImage.run(
        "other.png",
        "other.png",
        fixtureImage.length,
        "ภาพที่ไม่ได้เลือกรายงาน",
        ids.peer,
        null,
      ).lastInsertRowid,
    );
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
  async function req(path, { as = "staff", method = "GET", body } = {}) {
    const a = accounts[as];
    const r = await fetch(base + path, {
      method,
      headers: {
        Cookie: `rm_session=${a.raw}`,
        Origin: "http://localhost:5173",
        "X-CSRF-Token": a.csrf,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: r.status,
      data: r.headers.get("content-type").includes("json")
        ? await r.json()
        : Buffer.from(await r.arrayBuffer()),
    };
  }
  it("only admins configure real templates and reject stale or conflicting settings", async () => {
    assert.equal((await req("/admin/summary-templates")).status, 403);
    const seed = (await req("/admin/summary-templates", { as: "admin" })).data
      .items;
    assert.ok(seed.length >= 2);
    assert.equal(seed[0].active, false);
    const t = { ...seed[0], active: true, unit_id: 1 };
    tid = t.id;
    assert.equal(
      (
        await req("/admin/summary-templates/" + tid, {
          as: "admin",
          method: "PUT",
          body: t,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await req("/admin/summary-templates/" + tid, {
          as: "admin",
          method: "PUT",
          body: t,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await req("/admin/summary-templates", {
          as: "admin",
          method: "POST",
          body: { ...t, id: undefined, version: undefined },
        })
      ).status,
      409,
    );
    const ready = await req(
      "/reports/readiness?scope=mine&period=month&anchor=2026-10-02",
    );
    assert.equal(ready.data.automatic, 1);
    assert.equal(ready.data.groups[0].metrics[1].value, 19);
  });
  it("checks permissions, missing metrics and duplicates before creating a snapshot", async () => {
    const preview = () =>
      req("/report-drafts/preview", {
        method: "POST",
        body: { template_id: tid, filters },
      });
    let p = (await preview()).data;
    assert.equal(p.rows.length, 1);
    assert.equal(
      (
        await req("/report-drafts/preview", {
          as: "outside",
          method: "POST",
          body: { template_id: tid, filters: { ...filters, scope: "unit" } },
        })
      ).status,
      403,
    );
    const changed = app.locals.db.prepare(
      "UPDATE activities SET version=version+1 WHERE id=?",
    );
    changed.run(report);
    let body = {
      template_id: tid,
      filters,
      selected_ids: [report],
      preview_token: p.preview_token,
    };
    assert.equal(
      (await req("/report-drafts", { method: "POST", body })).status,
      409,
    );
    p = (await preview()).data;
    body.preview_token = p.preview_token;
    assert.equal(
      (
        await req("/report-drafts", {
          method: "POST",
          body: { ...body, image_ids: [unrelatedImageId] },
        })
      ).status,
      400,
    );
    body.image_ids = [imageId];
    assert.equal(
      (await req("/report-drafts", { as: "peer", method: "POST", body }))
        .status,
      409,
    );
    const created = await req("/report-drafts", { method: "POST", body });
    assert.equal(created.status, 201);
    draft = created.data.id;
    assert.equal(
      (await req("/report-drafts/" + draft, { as: "peer" })).status,
      403,
    );
    assert.equal(
      (await req("/report-drafts/" + draft, { as: "outside" })).status,
      403,
    );
    assert.equal(
      (await req("/report-drafts/" + draft, { as: "head" })).status,
      200,
    );
    assert.equal((await req("/report-drafts/" + draft + "/docx")).status, 400);
    app.locals.db
      .prepare("UPDATE activities SET metrics='[]' WHERE id=?")
      .run(report);
    p = (await preview()).data;
    assert.equal(p.rows[0].eligible, false);
    assert.equal(
      (
        await req("/report-drafts", {
          method: "POST",
          body: { ...body, preview_token: p.preview_token },
        })
      ).status,
      400,
    );
    app.locals.db
      .prepare("UPDATE activities SET metrics=? WHERE id=?")
      .run(
        JSON.stringify([{ label: "ผู้เข้าร่วม", unit: "คน", value: 30 }]),
        report,
      );
    app.locals.db
      .prepare(
        "INSERT INTO activities(title,date,unit_id,category_id,area,workers,result,metrics,status,source,owner_id) SELECT title,date,unit_id,category_id,area,workers,result,metrics,status,source,owner_id FROM activities WHERE id=?",
      )
      .run(report);
    p = (await preview()).data;
    assert.equal(p.rows[0].auto_include, false);
    assert.equal(
      (
        await req("/report-drafts", {
          method: "POST",
          body: { ...body, preview_token: p.preview_token },
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await req("/report-drafts", {
          method: "POST",
          body: {
            ...body,
            preview_token: p.preview_token,
            reviewed_duplicate_ids: [report],
          },
        })
      ).status,
      201,
    );
  });
  it("preserves old totals and template version after source edits, locks confirmed editions and exports native Word", async () => {
    const before = (await req("/report-drafts/" + draft)).data;
    assert.equal(before.snapshot.metrics[1].value, 19);
    assert.deepEqual(
      Buffer.from(before.snapshot.images[0].base64, "base64"),
      fixtureImage,
    );
    await writeFile(join(dir, "uploads", "fixture.png"), "changed later");
    app.locals.db
      .prepare(
        "UPDATE activities SET result='เปลี่ยนผลภายหลัง',version=version+1 WHERE id=?",
      )
      .run(report);
    app.locals.db
      .prepare(
        "UPDATE summary_templates SET name=?,version=version+1 WHERE id=?",
      )
      .run("แม่แบบรุ่นใหม่", tid);
    const current = (await req("/report-drafts/" + draft)).data;
    assert.deepEqual(current.changed_source_ids, [report]);
    assert.notEqual(current.snapshot.template.name, "แม่แบบรุ่นใหม่");
    const body = {
      version: current.version,
      title: current.title,
      narrative: {
        summary: "ประชุมเครือข่ายมีผู้เข้าร่วม 19 คน [1]",
        problems: "ไม่มีปัญหาที่ได้รับรายงาน",
        next_steps: "ติดตามผลการประชุมครั้งถัดไป",
      },
      confirm: true,
      reviewed: true,
    };
    assert.equal(
      (await req("/report-drafts/" + draft, { method: "PUT", body })).status,
      409,
    );
    const confirmed = await req("/report-drafts/" + draft, {
      method: "PUT",
      body: { ...body, accept_source_changes: true },
    });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.data.snapshot.metrics[1].value, 19);
    assert.equal(confirmed.data.content_hash.length, 64);
    assert.equal(
      (
        await req("/report-drafts/" + draft, {
          method: "PUT",
          body: { ...body, version: confirmed.data.version },
        })
      ).status,
      403,
    );
    const word = await req("/report-drafts/" + draft + "/docx");
    assert.equal(word.status, 200);
    assert.equal(word.data.readUInt32LE(0), 0x04034b50);
    assert.ok(word.data.includes(Buffer.from("19")));
    assert.ok(!word.data.includes(Buffer.from("เปลี่ยนผลภายหลัง")));
    assert.ok(
      word.data.includes(fixtureImage),
      "Word must embed the original image saved with the edition",
    );
    assert.equal(
      (await req("/report-drafts/" + draft + "/docx", { as: "peer" })).status,
      403,
    );
    if (process.env.DRAFT_QA_OUTPUT) {
      await mkdir(process.env.DRAFT_QA_OUTPUT, { recursive: true });
      await writeFile(
        join(process.env.DRAFT_QA_OUTPUT, "summary.docx"),
        word.data,
      );
    }
  });
});
