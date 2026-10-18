import { canRead as sourceReadable } from "./access.js";
import { manages } from "./access.js";
import { draftWithAI } from "./ai-provider.js";
import { z } from "zod";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { httpError } from "./security.js";
import { transaction, writeAudit } from "./db.js";
import { buildReport, reportingScope } from "./report-routes.js";
import {
  parseTemplate,
  activeTemplates,
  inspectRows,
  calculate,
  fingerprint,
  metricUnits,
} from "./summary-engine.js";
import { makeReportDocx } from "./report-docx.js";
const id = z.number().int().positive();
const config = z
  .object({
    required_fields: z
      .array(z.enum(["date", "area", "workers", "result"]))
      .max(4),
    metrics: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(100),
          unit: z.enum(metricUnits),
          method: z.enum(["sum", "max"]),
          required: z.boolean(),
        }),
      )
      .max(12),
    include_trend: z.boolean(),
    include_projects: z.boolean(),
    headings: z.object({
      summary: z.string().trim().min(1).max(100),
      problems: z.string().trim().min(1).max(100),
      next_steps: z.string().trim().min(1).max(100),
    }),
  })
  .refine(
    (c) =>
      new Set(c.metrics.map((m) => JSON.stringify([m.label, m.unit]))).size ===
      c.metrics.length,
    "ตัวชี้วัดชื่อและหน่วยเดียวกันต้องไม่ซ้ำ",
  );
const templateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  unit_id: id.nullable(),
  category_id: id,
  config,
  active: z.boolean(),
  version: id.optional(),
});
const filterSchema = z.object({
  period: z.enum(["month", "quarter", "year", "custom"]),
  anchor: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  scope: z.enum(["mine", "unit", "all"]),
  unit: z.string().optional(),
  work: z.string().optional(),
  category: z.string().optional(),
});
const createSchema = z.object({
  template_id: id,
  filters: filterSchema,
  selected_ids: z.array(id).min(1).max(500),
  reviewed_duplicate_ids: z.array(id).max(500).default([]),
  image_ids: z.array(id).max(4).default([]),
  preview_token: z.string().length(64),
});
const narrativeSchema = z.object({
  summary: z.string().max(10000),
  problems: z.string().max(5000),
  next_steps: z.string().max(5000),
});
function canRead(db, user, row, snapshot) {
  if (user.roles.includes("executive")) return true;
  return (
    snapshot.rows.every((r) => sourceReadable(db, user, r)) &&
    (row.owner_id === user.id ||
      user.roles.includes("head") ||
      user.roles.includes("center_head") ||
      user.delegated)
  );
}
export function registerDraftRoutes(app, db, dataDir) {
  const admin = (req, res, next) =>
    req.user.roles.includes("admin")
      ? next()
      : next(httpError(403, "เฉพาะผู้ดูแลระบบ"));
  app.get("/api/reports/readiness", (req, res) => {
    const d = buildReport(db, req),
      templates = activeTemplates(db),
      rows = inspectRows(d.rows, templates);
    res.json({
      rows,
      automatic: rows.filter((r) => r.template_id && r.auto_include).length,
      review: rows.filter((r) => !r.auto_include).length,
      groups: templates
        .filter((t) => rows.some((r) => r.template_id === t.id))
        .map((t) => ({
          id: t.id,
          name: t.name,
          metrics: calculate(
            rows.filter((r) => r.template_id === t.id && r.auto_include),
            t,
          ),
        })),
      note: `ใช้แม่แบบตามฝ่ายและประเภทงานอัตโนมัติ มี ${rows.filter((r) => !r.template_id).length} รายการยังไม่มีแม่แบบ ตัวเลขส่วนนี้ไม่รวมรายการขาดหรืออาจซ้ำจนกว่าจะตรวจเลือกในร่าง`,
    });
  });
  app.get("/api/summary-templates", (req, res) => {
    reportingScope(req.user);
    res.json({
      items: db
        .prepare("SELECT * FROM summary_templates WHERE active=1 ORDER BY name")
        .all()
        .map(parseTemplate),
    });
  });
  app.get("/api/admin/summary-templates", admin, (req, res) =>
    res.json({
      items: db
        .prepare("SELECT * FROM summary_templates ORDER BY id")
        .all()
        .map(parseTemplate),
    }),
  );
  function saveTemplate(req, res) {
    const input = templateSchema.parse(req.body),
      old = req.params.id
        ? db
            .prepare("SELECT * FROM summary_templates WHERE id=?")
            .get(Number(req.params.id))
        : null;
    if (req.params.id && !old) throw httpError(404, "ไม่พบแม่แบบ");
    if (old && input.version !== old.version)
      throw httpError(409, "แม่แบบถูกแก้ไขแล้ว กรุณาโหลดใหม่");
    if (
      !db
        .prepare("SELECT id FROM categories WHERE id=? AND active=1")
        .get(input.category_id)
    )
      throw httpError(400, "ประเภทงานไม่พร้อมใช้งาน");
    if (
      input.unit_id &&
      !db
        .prepare(
          "SELECT id FROM units WHERE id=? AND active=1 AND kind!='section'",
        )
        .get(input.unit_id)
    )
      throw httpError(400, "ฝ่ายไม่พร้อมใช้งาน");
    if (
      input.active &&
      db
        .prepare(
          "SELECT id FROM summary_templates WHERE active=1 AND COALESCE(unit_id,0)=? AND category_id=? AND id!=?",
        )
        .get(input.unit_id || 0, input.category_id, old?.id || 0)
    )
      throw httpError(409, "ฝ่ายและประเภทงานนี้มีแม่แบบเปิดใช้งานแล้ว");
    const templateId = transaction(db, () => {
      let result = old?.id;
      if (old)
        db.prepare(
          "UPDATE summary_templates SET name=?,unit_id=?,category_id=?,config=?,active=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        ).run(
          input.name,
          input.unit_id,
          input.category_id,
          JSON.stringify(input.config),
          +input.active,
          old.id,
        );
      else
        result = Number(
          db
            .prepare(
              "INSERT INTO summary_templates(name,unit_id,category_id,config,active) VALUES(?,?,?,?,?)",
            )
            .run(
              input.name,
              input.unit_id,
              input.category_id,
              JSON.stringify(input.config),
              +input.active,
            ).lastInsertRowid,
        );
      writeAudit(
        db,
        req.user,
        "บันทึกแม่แบบสรุปผล",
        "summary_template",
        result,
        old ? parseTemplate(old) : null,
        input,
      );
      return result;
    });
    res.json(
      parseTemplate(
        db
          .prepare("SELECT * FROM summary_templates WHERE id=?")
          .get(templateId),
      ),
    );
  }
  app.post("/api/admin/summary-templates", admin, saveTemplate);
  app.put("/api/admin/summary-templates/:id", admin, saveTemplate);
  function preview(req, input) {
    const t = db
      .prepare("SELECT * FROM summary_templates WHERE id=? AND active=1")
      .get(input.template_id);
    if (!t) throw httpError(400, "แม่แบบไม่พร้อมใช้งาน");
    const template = parseTemplate(t),
      filters = { ...input.filters, category: String(t.category_id) };
    if (t.unit_id) filters.unit = String(t.unit_id);
    const d = buildReport(db, { user: req.user, query: filters });
    const rows = inspectRows(d.rows, [template]).map((r) => ({
      ...r,
      files: db
        .prepare(
          "SELECT id,title,mime,size FROM files WHERE activity_id=? ORDER BY id",
        )
        .all(r.id),
    }));
    // Include all candidate versions and attachment metadata so selection cannot silently use a stale preview.
    const preview_token = fingerprint({ template, filters, rows });
    return {
      ...d,
      template,
      filters,
      rows,
      preview_token,
      quality: {
        pending: rows.filter((r) => r.status !== "ready").length,
        missing: rows.filter((r) => r.missing.length).length,
        possible_duplicates: rows.filter((r) => r.duplicate_ids.length).length,
        automatic: rows.filter((r) => r.auto_include).length,
      },
    };
  }
  app.post("/api/report-drafts/preview", (req, res) => {
    const input = z
      .object({ template_id: id, filters: filterSchema })
      .parse(req.body);
    res.json(preview(req, input));
  });
  app.post("/api/report-drafts", async (req, res) => {
    const input = createSchema.parse(req.body);
    reportingScope(req.user, input.filters.scope);
    const d = preview(req, input);
    if (d.preview_token !== input.preview_token)
      throw httpError(
        409,
        "ข้อมูลหรือแม่แบบเปลี่ยนหลังเปิดตัวอย่าง กรุณาตรวจรายการใหม่",
      );
    const selected = [...new Set(input.selected_ids)],
      rows = d.rows.filter((r) => selected.includes(r.id));
    if (rows.length !== selected.length || rows.some((r) => !r.eligible))
      throw httpError(
        400,
        "เลือกได้เฉพาะรายการที่ยืนยันและครบตามแม่แบบในขอบเขตนี้",
      );
    if (
      rows.some(
        (r) =>
          r.duplicate_ids.length &&
          !input.reviewed_duplicate_ids.includes(r.id),
      )
    )
      throw httpError(
        400,
        "กรุณาตรวจรายการอาจซ้ำและยืนยันแต่ละรายการที่ต้องการรวม",
      );
    const images = [];
    for (const fileId of [...new Set(input.image_ids)]) {
      const f = db.prepare("SELECT * FROM files WHERE id=?").get(fileId);
      if (
        !f ||
        !rows.some((r) => r.id === f.activity_id) ||
        !["image/jpeg", "image/png"].includes(f.mime)
      )
        throw httpError(400, "เลือกรูป JPEG/PNG จากรายงานที่รวมเท่านั้น");
      if (f.size > 3 * 1024 * 1024)
        throw httpError(400, "รูปสำหรับรายงานต้องไม่เกิน 3 MB ต่อรูป");
      const bytes = await readFile(resolve(dataDir, "uploads", f.storage_name));
      images.push({
        id: f.id,
        title: f.title,
        mime: f.mime,
        activity_id: f.activity_id,
        base64: bytes.toString("base64"),
        hash: fingerprint(bytes.toString("base64")),
      });
    }
    // Awaiting file reads can allow edits in other requests; recheck before taking a snapshot.
    if (preview(req, input).preview_token !== input.preview_token)
      throw httpError(409, "ข้อมูลเปลี่ยนระหว่างจัดทำ กรุณาตรวจรายการใหม่");
    const months = new Map();
    for (const r of rows)
      months.set(r.date.slice(0, 7), (months.get(r.date.slice(0, 7)) || 0) + 1);
    const projects = d.template.config.include_projects
      ? db
          .prepare(
            `SELECT DISTINCT p.id,p.title,t.activity_id FROM projects p JOIN project_tasks t ON t.project_id=p.id WHERE t.activity_id IN (${rows.map(() => "?").join(",")}) ORDER BY p.id`,
          )
          .all(...rows.map((r) => r.id))
      : [];
    const snapshot = {
      template: d.template,
      filters: d.filters,
      range: d.range,
      period_title: d.title,
      cutoff_at: new Date().toISOString(),
      rows,
      metrics: calculate(rows, d.template),
      months: [...months]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, count]) => ({ month, count })),
      projects,
      images,
      exclusions: d.rows
        .filter((r) => !selected.includes(r.id))
        .map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          missing: r.missing,
          duplicate_ids: r.duplicate_ids,
        })),
      reviewed_duplicate_ids: input.reviewed_duplicate_ids,
      generation: "database_rules_no_ai",
    };
    const narrative = {
      summary:
        `ช่วง ${d.range.from} ถึง ${d.range.to} มีรายงานที่เลือกและยืนยันแล้ว ${rows.length} กิจกรรม\n` +
        rows
          .slice(0, 8)
          .map((r) => `[${r.id}] ${r.title}: ${r.result.slice(0, 300)}`)
          .join("\n") +
        (rows.length > 8
          ? "\nรายละเอียดเพิ่มเติมดูรายการข้อมูลอ้างอิงท้ายรายงาน"
          : ""),
      problems: "ยังไม่มีข้อมูลปัญหาและอุปสรรค กรุณาตรวจสอบและเติมจากต้นทาง",
      next_steps:
        "ยังไม่มีข้อมูลแนวทางดำเนินงานต่อไป กรุณาตรวจสอบและเติมจากต้นทาง",
    };
    const draftId = transaction(db, () => {
      const draftId = Number(
        db
          .prepare(
            "INSERT INTO summary_drafts(title,owner_id,author_name,snapshot_json,narrative_json) VALUES(?,?,?,?,?)",
          )
          .run(
            `รายงานผลการดำเนินงาน ${d.title}`,
            req.user.id,
            req.user.name,
            JSON.stringify(snapshot),
            JSON.stringify(narrative),
          ).lastInsertRowid,
      );
      writeAudit(
        db,
        req.user,
        "สร้างร่างรายงานสรุป",
        "summary_draft",
        draftId,
        null,
        {
          template_id: d.template.id,
          source_ids: selected,
          cutoff_at: snapshot.cutoff_at,
        },
      );
      return draftId;
    });
    res.status(201).json({ id: draftId });
  });
  function readDraft(req) {
    reportingScope(req.user);
    const row = db
      .prepare("SELECT * FROM summary_drafts WHERE id=?")
      .get(Number(req.params.id));
    if (!row) throw httpError(404, "ไม่พบฉบับรายงาน");
    const snapshot = JSON.parse(row.snapshot_json);
    if (!canRead(db, req.user, row, snapshot))
      throw httpError(403, "ไม่มีสิทธิ์อ่านฉบับรายงานนี้");
    const changes = snapshot.rows
      .filter((r) => {
        const current = db
          .prepare("SELECT version FROM activities WHERE id=?")
          .get(r.id);
        return !current || current.version !== r.version;
      })
      .map((r) => r.id);
    const { snapshot_json, narrative_json, ...rest } = row;
    return {
      ...rest,
      snapshot,
      narrative: JSON.parse(narrative_json),
      changed_source_ids: changes,
      can_edit: row.owner_id === req.user.id && row.status === "draft",
    };
  }
  app.get("/api/report-drafts", (req, res) => {
    reportingScope(req.user);
    const rows = db
      .prepare("SELECT * FROM summary_drafts ORDER BY id DESC")
      .all()
      .filter((r) => canRead(db, req.user, r, JSON.parse(r.snapshot_json)))
      .map(({ snapshot_json, narrative_json, ...r }) => r);
    res.json({ items: rows });
  });
  app.post("/api/report-drafts/:id/ai-draft", async (req, res) => {
    const d = readDraft(req);
    if (!d.can_edit) throw httpError(403, "แก้ได้เฉพาะร่างของตน");
    res.json(await draftWithAI(d.snapshot));
  });
  app.get("/api/report-drafts/:id", (req, res) => res.json(readDraft(req)));
  app.put("/api/report-drafts/:id", (req, res) => {
    const d = readDraft(req);
    if (!d.can_edit)
      throw httpError(
        403,
        "แก้ได้เฉพาะร่างของตน ฉบับยืนยันแล้วเก็บไว้ไม่เปลี่ยน",
      );
    const input = z
      .object({
        version: id,
        title: z.string().trim().min(1).max(300),
        narrative: narrativeSchema,
        confirm: z.boolean().default(false),
        reviewed: z.boolean().default(false),
        accept_source_changes: z.boolean().default(false),
      })
      .parse(req.body);
    if (input.version !== d.version)
      throw httpError(409, "ร่างนี้มีการแก้ไขแล้ว กรุณาโหลดใหม่");
    if (input.confirm && !input.reviewed)
      throw httpError(400, "กรุณายืนยันว่าตรวจข้อความ ตัวเลข และรูปภาพแล้ว");
    if (
      input.confirm &&
      d.changed_source_ids.length &&
      !input.accept_source_changes
    )
      throw httpError(
        409,
        "ต้นทางเปลี่ยนแล้ว ต้องเลือกว่าจะคงข้อมูล ณ เวลาจัดทำหรือสร้างร่างใหม่",
      );
    const confirmed = input.confirm ? new Date().toISOString() : null,
      hash = input.confirm
        ? fingerprint({
            title: input.title,
            snapshot: d.snapshot,
            narrative: input.narrative,
            confirmed_at: confirmed,
          })
        : null;
    transaction(db, () => {
      db.prepare(
        "UPDATE summary_drafts SET title=?,narrative_json=?,status=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),confirmed_at=?,content_hash=? WHERE id=?",
      ).run(
        input.title,
        JSON.stringify(input.narrative),
        input.confirm ? "confirmed" : "draft",
        confirmed,
        hash,
        d.id,
      );
      writeAudit(
        db,
        req.user,
        input.confirm ? "ยืนยันฉบับรายงานสรุป" : "แก้ร่างรายงานสรุป",
        "summary_draft",
        d.id,
        { title: d.title, narrative: d.narrative },
        {
          title: input.title,
          narrative: input.narrative,
          content_hash: hash,
          accepted_source_changes: input.accept_source_changes,
        },
      );
    });
    res.json(readDraft(req));
  });
  app.get("/api/report-drafts/:id/docx", (req, res) => {
    const d = readDraft(req);
    if (d.status !== "confirmed")
      throw httpError(400, "ยืนยันฉบับรายงานก่อนส่งออก");
    const bytes = makeReportDocx(d);
    writeAudit(
      db,
      req.user,
      "ส่งออกฉบับรายงาน Word",
      "summary_draft",
      d.id,
      null,
      { content_hash: d.content_hash },
    );
    res
      .type(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      )
      .set(
        "Content-Disposition",
        `attachment; filename="rm-summary-${d.id}.docx"`,
      )
      .send(bytes);
  });
}
