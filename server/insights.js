import { z } from "zod";
import { transaction, writeAudit } from "./db.js";
import { canEdit, canCreate, httpError } from "./security.js";
import { reportDocument, docxDocument } from "./report-document.js";

export const metricSchema = z.object({
  label: z.string().trim().min(1).max(100),
  value: z.number().finite().min(0).max(1e12),
  unit: z.string().trim().min(1).max(40),
});
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s);
    return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s;
  }, "วันที่ไม่ถูกต้อง");
const positive = z.number().int().positive();
const periodSchema = z.object({
  period: z.enum(["month", "quarter", "year", "custom"]).default("month"),
  year: z.coerce.number().int().min(2000).max(2200).optional(),
  month: z.coerce.number().int().min(1).max(12).default(1),
  quarter: z.coerce.number().int().min(1).max(4).default(1),
  from: date.optional(),
  to: date.optional(),
  unit: z.coerce.number().int().positive().optional(),
  project: z.coerce.number().int().positive().optional(),
  mine: z.enum(["0", "1"]).default("0"),
});
export function settings(db) {
  return Object.fromEntries(
    db
      .prepare("SELECT * FROM report_settings")
      .all()
      .map((r) => [r.key, JSON.parse(r.value)]),
  );
}
export function templates(db) {
  return db
    .prepare("SELECT * FROM report_templates ORDER BY id")
    .all()
    .map((r) => ({
      ...r,
      active: !!r.active,
      keywords: JSON.parse(r.keywords),
      unit_ids: JSON.parse(r.unit_ids),
      metrics: JSON.parse(r.metrics),
    }));
}
const iso = (d) => d.toISOString().slice(0, 10);
export function reportPeriod(input, fiscalStart = 10) {
  const p = periodSchema.parse(
      Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== "" && v != null),
      ),
    ),
    now = new Date(Date.now() + 7 * 3600000);
  const year =
    p.year ??
    now.getUTCFullYear() +
      (["quarter", "year"].includes(p.period) &&
      fiscalStart !== 1 &&
      now.getUTCMonth() + 1 >= fiscalStart
        ? 1
        : 0);
  if (p.period === "custom") {
    if (!p.from || !p.to || p.from > p.to)
      throw httpError(400, "กรุณาระบุวันเริ่มและสิ้นสุดให้ถูกต้อง");
    return { ...p, year, from: p.from, to: p.to };
  }
  const startYear = year - (fiscalStart === 1 ? 0 : 1);
  let start, end;
  if (p.period === "month") {
    start = new Date(Date.UTC(year, p.month - 1, 1));
    end = new Date(Date.UTC(year, p.month, 0));
  } else {
    const m =
      fiscalStart - 1 + (p.period === "quarter" ? (p.quarter - 1) * 3 : 0);
    start = new Date(Date.UTC(startYear, m, 1));
    end = new Date(
      Date.UTC(startYear, m + (p.period === "quarter" ? 3 : 12), 0),
    );
  }
  return { ...p, year, from: iso(start), to: iso(end) };
}
function descendants(db, id) {
  const unit = db.prepare("SELECT id FROM units WHERE id=?").get(id);
  if (!unit) throw httpError(400, "ไม่พบหน่วยงาน");
  return db
    .prepare(
      "WITH RECURSIVE tree(id) AS (SELECT id FROM units WHERE id=? UNION ALL SELECT u.id FROM units u JOIN tree t ON u.parent_id=t.id) SELECT id FROM tree",
    )
    .all(id)
    .map((r) => r.id);
}
export function assertUnlocked(db, row) {
  if (!row?.date) return;
  const lock = db
    .prepare(
      "SELECT id FROM period_locks WHERE unit_id=? AND active=1 AND date_from<=? AND date_to>=?",
    )
    .get(row.unit_id, row.date, row.date);
  if (lock)
    throw httpError(423, "รอบรายงานนี้ปิดแล้ว ให้หัวหน้าหน่วยเปิดรอบก่อนแก้ไข");
}
function selectRows(db, p, user) {
  const conditions = [
      "a.duplicate_of IS NULL",
      "COALESCE(a.date,substr(a.created_at,1,10))>=?",
      "COALESCE(a.date,substr(a.created_at,1,10))<=?",
    ],
    args = [p.from, p.to];
  if (p.unit) {
    const units = descendants(db, p.unit);
    conditions.push(`a.unit_id IN (${units.map(() => "?").join(",")})`);
    args.push(...units);
  }
  if (p.mine === "1") {
    conditions.push("a.owner_id=?");
    args.push(user.id);
  }
  if (p.project) {
    conditions.push("pa.project_id=?");
    args.push(p.project);
  }
  return db
    .prepare(
      `SELECT a.*,u.name unit_name,c.name category_name,o.name owner_name,pa.project_id,p.name project_name FROM activities a JOIN units u ON u.id=a.unit_id JOIN users o ON o.id=a.owner_id LEFT JOIN categories c ON c.id=a.category_id LEFT JOIN project_activities pa ON pa.activity_id=a.id LEFT JOIN projects p ON p.id=pa.project_id WHERE ${conditions.join(" AND ")} ORDER BY a.date,a.id`,
    )
    .all(...args)
    .map((r) => ({ ...r, metrics: JSON.parse(r.metrics) }));
}
const normalize = (s) => String(s).normalize("NFC").replace(/\s+/g, "").trim();
export function summarizeRows(rows, defs) {
  const ready = rows.filter((r) => r.status === "ready"),
    metrics = new Map(),
    byUnit = new Map(),
    byCategory = new Map(),
    months = new Map(),
    areas = new Set();
  for (const r of ready) {
    byUnit.set(r.unit_name, (byUnit.get(r.unit_name) || 0) + 1);
    byCategory.set(
      r.category_name || "ยังไม่ระบุ",
      (byCategory.get(r.category_name || "ยังไม่ระบุ") || 0) + 1,
    );
    months.set(r.date.slice(0, 7), (months.get(r.date.slice(0, 7)) || 0) + 1);
    if (r.area) areas.add(r.area);
    const matching = defs.filter(
      (t) => t.active && (!t.unit_ids.length || t.unit_ids.includes(r.unit_id)),
    );
    for (const source of r.metrics) {
      let m = { ...source },
        aggregation = "sum";
      const d = matching
        .flatMap((t) => t.metrics)
        .find(
          (d) =>
            [d.label, ...d.aliases].some(
              (a) => normalize(a) === normalize(m.label),
            ) &&
            (d.unit === m.unit ||
              (["ตัน", "กิโลกรัม"].includes(d.unit) &&
                ["ตัน", "กิโลกรัม"].includes(m.unit))),
        );
      if (d) {
        if (m.unit !== d.unit) m.value *= m.unit === "กิโลกรัม" ? 0.001 : 1000;
        m.unit = d.unit;
        m.label = d.label;
        aggregation = d.aggregation;
      }
      const key = m.label + "|" + m.unit + "|" + aggregation;
      if (!metrics.has(key))
        metrics.set(key, {
          label: m.label,
          unit: m.unit,
          value: 0,
          aggregation,
          activity_ids: [],
          note:
            m.unit === "คน"
              ? "เป็นผลรวมยอดแต่ละกิจกรรม ยังไม่ใช่จำนวนคนไม่ซ้ำ"
              : null,
        });
      const out = metrics.get(key);
      out.value =
        aggregation === "max"
          ? Math.max(out.value, m.value)
          : aggregation === "latest"
            ? m.value
            : out.value + m.value;
      out.activity_ids.push(r.id);
    }
  }
  return {
    ready: ready.length,
    pending: rows.length - ready.length,
    metrics: [...metrics.values()].map((m) => ({
      ...m,
      value: Math.round(m.value * 1e6) / 1e6,
      activity_ids: [...new Set(m.activity_ids)],
    })),
    byUnit: [...byUnit].map(([name, count]) => ({ name, count })),
    byCategory: [...byCategory].map(([name, count]) => ({ name, count })),
    months: [...months]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count })),
    areaCount: areas.size,
  };
}
export function buildInsights(db, input, user) {
  const config = settings(db),
    p = reportPeriod(input, config.fiscal_start_month),
    rows = selectRows(db, p, user),
    defs = templates(db),
    summary = summarizeRows(rows, defs);
  let previous;
  if (p.period === "month") {
    const d = new Date(Date.UTC(p.year, p.month - 2, 1));
    previous = reportPeriod(
      { ...p, year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 },
      config.fiscal_start_month,
    );
  } else if (p.period === "quarter")
    previous = reportPeriod(
      {
        ...p,
        year: p.quarter === 1 ? p.year - 1 : p.year,
        quarter: p.quarter === 1 ? 4 : p.quarter - 1,
      },
      config.fiscal_start_month,
    );
  else if (p.period === "year")
    previous = reportPeriod(
      { ...p, year: p.year - 1 },
      config.fiscal_start_month,
    );
  else {
    const length = (+new Date(p.to) - +new Date(p.from)) / 86400000 + 1;
    previous = {
      ...p,
      from: iso(new Date(+new Date(p.from) - length * 86400000)),
      to: iso(new Date(+new Date(p.from) - 86400000)),
    };
  }
  const prev = summarizeRows(selectRows(db, previous, user), defs);
  return {
    period: p,
    ...summary,
    comparison: {
      period: previous,
      ready: prev.ready,
      change: summary.ready - prev.ready,
      percent: prev.ready
        ? Math.round(((summary.ready - prev.ready) / prev.ready) * 1000) / 10
        : null,
    },
    templates: defs.filter(
      (t) =>
        t.active &&
        (!p.unit || !t.unit_ids.length || t.unit_ids.includes(p.unit)),
    ),
    quality: {
      missingDates: rows.filter((r) => !r.date).map((r) => r.id),
      missingMetrics: rows
        .filter((r) => r.status === "ready" && !r.metrics.length)
        .map((r) => r.id),
    },
    activities: rows.map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date,
      unit_name: r.unit_name,
      unit_id: r.unit_id,
      category_name: r.category_name,
      owner_name: r.owner_name,
      status: r.status,
      area: r.area,
      workers: r.workers,
      result: r.result,
      metrics: r.metrics,
      project_name: r.project_name,
      version: r.version,
    })),
    generatedAt: new Date().toISOString(),
    note: "นับเฉพาะกิจกรรมที่ยืนยันและไม่ถูกระบุเป็นรายการซ้ำ จำนวนกิจกรรมไม่ใช่จำนวนครั้งบริการหรือจำนวนคนไม่ซ้ำ",
  };
}
function snapshot(db, payload, user, scheduleKey = null) {
  const title = `สรุปผลการปฏิบัติงาน ${payload.period.from} ถึง ${payload.period.to}`;
  const id = Number(
    db
      .prepare(
        "INSERT INTO report_exports(title,payload,created_by,schedule_key) VALUES(?,?,?,?)",
      )
      .run(title, JSON.stringify(payload), user?.id || null, scheduleKey)
      .lastInsertRowid,
  );
  writeAudit(db, user, "สร้างรายงานสรุป", "report_export", id, null, {
    period: payload.period,
    activities: payload.ready,
  });
  return { id, title, ...payload };
}
export function runSchedules(db, now = new Date()) {
  const s = settings(db);
  if (!s.scheduled_reports) return { created: 0, enabled: false };
  const day = new Date(now.getTime() + 7 * 3600000),
    year = day.getUTCFullYear(),
    month = day.getUTCMonth();
  const fiscalYear =
    year +
    (s.fiscal_start_month !== 1 && month + 1 >= s.fiscal_start_month ? 1 : 0);
  const periods = [
    {
      period: "month",
      year: month === 0 ? year - 1 : year,
      month: month === 0 ? 12 : month,
    },
  ];
  const offset = (month + 1 - s.fiscal_start_month + 12) % 12;
  if (offset % 3 === 0) {
    const current = Math.floor(offset / 3) + 1;
    periods.push({
      period: "quarter",
      quarter: current === 1 ? 4 : current - 1,
      year: current === 1 ? fiscalYear - 1 : fiscalYear,
    });
  }
  if (month + 1 === s.fiscal_start_month)
    periods.push({ period: "year", year: fiscalYear - 1 });
  let created = 0;
  for (const p of periods.filter((p) => s.report_periods.includes(p.period)))
    for (const unit of [
      null,
      ...db
        .prepare("SELECT id FROM units WHERE active=1 AND kind!='section'")
        .all()
        .map((r) => r.id),
    ]) {
      const payload = buildInsights(
        db,
        { ...p, ...(unit ? { unit } : {}) },
        { id: 0 },
      );
      const key = `${p.period}:${payload.period.from}:${payload.period.to}:${unit || "all"}`;
      if (
        db
          .prepare("SELECT id FROM report_exports WHERE schedule_key=?")
          .get(key)
      )
        continue;
      transaction(db, () => snapshot(db, payload, null, key));
      created++;
    }
  return { created, enabled: true };
}
export function registerInsights(app, db) {
  app.get("/api/insights", (req, res) =>
    res.json(buildInsights(db, req.query, req.user)),
  );
  app.get("/api/report-templates", (req, res) => res.json(templates(db)));
  const requireAdmin = (req) => {
    if (!req.user.roles.includes("admin"))
      throw httpError(403, "เฉพาะผู้ดูแลระบบ");
  };
  const templateSchema = z.object({
    name: z.string().trim().min(1).max(150),
    keywords: z.array(z.string().trim().min(1).max(100)).max(30),
    unit_ids: z.array(positive).max(100),
    metrics: z
      .array(
        z.object({
          label: z.string().trim().min(1).max(100),
          aliases: z
            .array(z.string().trim().min(1).max(100))
            .max(20)
            .default([]),
          unit: metricSchema.shape.unit,
          aggregation: z.enum(["sum", "max", "latest"]),
        }),
      )
      .max(30),
    active: z.boolean().default(true),
    version: positive.optional(),
  });
  function saveTemplate(req, res) {
    requireAdmin(req);
    const v = templateSchema.parse(req.body);
    for (const id of v.unit_ids)
      if (!db.prepare("SELECT id FROM units WHERE id=?").get(id))
        throw httpError(400, "ไม่พบหน่วยงานในแม่แบบ");
    const old = req.params.id
      ? db
          .prepare("SELECT * FROM report_templates WHERE id=?")
          .get(+req.params.id)
      : null;
    if (req.params.id && !old) throw httpError(404, "ไม่พบแม่แบบ");
    if (old && old.version !== v.version)
      throw httpError(409, "แม่แบบถูกแก้ไขแล้ว กรุณาโหลดใหม่");
    const id = transaction(db, () => {
      let id = old?.id;
      if (old)
        db.prepare(
          "UPDATE report_templates SET name=?,keywords=?,unit_ids=?,metrics=?,active=?,version=version+1 WHERE id=?",
        ).run(
          v.name,
          JSON.stringify(v.keywords),
          JSON.stringify(v.unit_ids),
          JSON.stringify(v.metrics),
          +v.active,
          id,
        );
      else
        id = Number(
          db
            .prepare(
              "INSERT INTO report_templates(name,keywords,unit_ids,metrics,active) VALUES(?,?,?,?,?)",
            )
            .run(
              v.name,
              JSON.stringify(v.keywords),
              JSON.stringify(v.unit_ids),
              JSON.stringify(v.metrics),
              +v.active,
            ).lastInsertRowid,
        );
      writeAudit(
        db,
        req.user,
        "ตั้งค่าแม่แบบสรุปผล",
        "report_template",
        id,
        old,
        v,
      );
      return id;
    });
    res.status(old ? 200 : 201).json(templates(db).find((t) => t.id === id));
  }
  app.post("/api/report-templates", saveTemplate);
  app.put("/api/report-templates/:id", saveTemplate);
  app.get("/api/report-settings", (req, res) =>
    res.json({
      ...settings(db),
      ai: {
        configured: !!process.env.OLLAMA_MODEL,
        model: process.env.OLLAMA_MODEL || null,
      },
      documentReader: process.env.DOCUMENT_PYTHON
        ? "configured"
        : "not_configured",
    }),
  );
  app.put("/api/report-settings", (req, res) => {
    requireAdmin(req);
    const v = z
      .object({
        fiscal_start_month: z.number().int().min(1).max(12),
        scheduled_reports: z.boolean(),
        report_periods: z
          .array(z.enum(["month", "quarter", "year"]))
          .min(1)
          .max(3),
        line_reply_enabled: z.boolean(),
      })
      .parse(req.body);
    transaction(db, () => {
      const old = settings(db);
      for (const [k, value] of Object.entries(v))
        db.prepare("UPDATE report_settings SET value=? WHERE key=?").run(
          JSON.stringify(value),
          k,
        );
      writeAudit(
        db,
        req.user,
        "ตั้งค่าการสรุปอัตโนมัติ",
        "report_settings",
        null,
        old,
        v,
      );
    });
    res.json(settings(db));
  });
  app.post("/api/report-schedules/run", (req, res) => {
    requireAdmin(req);
    res.json(runSchedules(db));
  });
  app.post("/api/report-exports", (req, res) =>
    res
      .status(201)
      .json(
        transaction(db, () =>
          snapshot(db, buildInsights(db, req.body, req.user), req.user),
        ),
      ),
  );
  app.get("/api/report-exports", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT id,title,created_by,schedule_key,created_at FROM report_exports ORDER BY id DESC LIMIT 100",
        )
        .all(),
    ),
  );
  app.get("/api/report-exports/:id", (req, res) => {
    const r = db
      .prepare("SELECT * FROM report_exports WHERE id=?")
      .get(+req.params.id);
    if (!r) throw httpError(404, "ไม่พบรายงานสรุป");
    const payload = JSON.parse(r.payload);
    res.json({ ...r, payload: undefined, ...payload });
  });
  app.get("/api/report-exports/:id/download", (req, res) => {
    const r = db
      .prepare("SELECT * FROM report_exports WHERE id=?")
      .get(+req.params.id);
    if (!r) throw httpError(404, "ไม่พบรายงานสรุป");
    const data = { id: r.id, title: r.title, ...JSON.parse(r.payload) };
    const format = req.query.format || "html";
    writeAudit(db, req.user, "ส่งออกรายงานสรุป", "report_export", r.id, null, {
      format,
    });
    if (format === "docx") {
      res
        .type(
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        .attachment(`RM-report-${r.id}.docx`)
        .send(docxDocument(data));
    } else if (format === "json") {
      res.attachment(`RM-report-${r.id}.json`).json(data);
    } else if (format === "html") {
      res.type("html").send(reportDocument(data));
    } else throw httpError(400, "ไม่รองรับรูปแบบไฟล์");
  });
  const projectSchema = z
    .object({
      name: z.string().trim().min(1).max(300),
      unit_id: positive,
      description: z.string().max(10000).default(""),
      start_date: date.nullable().default(null),
      end_date: date.nullable().default(null),
      targets: z.array(metricSchema).max(20).default([]),
      version: positive.optional(),
    })
    .refine(
      (v) => !v.start_date || !v.end_date || v.start_date <= v.end_date,
      "ช่วงเวลาโครงการไม่ถูกต้อง",
    );
  app.get("/api/projects", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT p.*,u.name unit_name FROM projects p JOIN units u ON u.id=p.unit_id ORDER BY p.id DESC",
        )
        .all()
        .map((p) => ({
          ...p,
          targets: JSON.parse(p.targets),
          can_edit: canEdit(req.user, p),
          activity_count: db
            .prepare(
              "SELECT COUNT(*) n FROM project_activities pa JOIN activities a ON a.id=pa.activity_id WHERE pa.project_id=? AND a.duplicate_of IS NULL",
            )
            .get(p.id).n,
        })),
    ),
  );
  function saveProject(req, res) {
    const v = projectSchema.parse(req.body),
      old = req.params.id
        ? db.prepare("SELECT * FROM projects WHERE id=?").get(+req.params.id)
        : null;
    if (req.params.id && !old) throw httpError(404, "ไม่พบโครงการ");
    if (old ? !canEdit(req.user, old) : !canCreate(req.user, v.unit_id))
      throw httpError(403, "ไม่มีสิทธิ์แก้ไขโครงการนี้");
    if (old && old.version !== v.version)
      throw httpError(409, "โครงการถูกแก้ไขแล้ว");
    if (old && old.unit_id !== v.unit_id)
      throw httpError(400, "ไม่สามารถย้ายหน่วยงานเจ้าของโครงการ");
    if (
      !db
        .prepare(
          "SELECT id FROM units WHERE id=? AND kind!='section' AND (active=1 OR id=?)",
        )
        .get(v.unit_id, old?.unit_id || null)
    )
      throw httpError(400, "หน่วยงานไม่พร้อมใช้งาน");
    const id = transaction(db, () => {
      let id = old?.id;
      if (old)
        db.prepare(
          "UPDATE projects SET name=?,description=?,start_date=?,end_date=?,targets=?,version=version+1 WHERE id=?",
        ).run(
          v.name,
          v.description,
          v.start_date,
          v.end_date,
          JSON.stringify(v.targets),
          id,
        );
      else
        id = Number(
          db
            .prepare(
              "INSERT INTO projects(name,unit_id,owner_id,description,start_date,end_date,targets) VALUES(?,?,?,?,?,?,?)",
            )
            .run(
              v.name,
              v.unit_id,
              req.user.id,
              v.description,
              v.start_date,
              v.end_date,
              JSON.stringify(v.targets),
            ).lastInsertRowid,
        );
      writeAudit(db, req.user, "บันทึกทะเบียนโครงการ", "project", id, old, v);
      return id;
    });
    res.status(old ? 200 : 201).json({ id });
  }
  app.post("/api/projects", saveProject);
  app.put("/api/projects/:id", saveProject);
  app.get("/api/projects/:id", (req, res) => {
    const p = db
      .prepare(
        "SELECT p.*,u.name unit_name FROM projects p JOIN units u ON u.id=p.unit_id WHERE p.id=?",
      )
      .get(+req.params.id);
    if (!p) throw httpError(404, "ไม่พบโครงการ");
    const rows = db
      .prepare(
        "SELECT a.*,u.name unit_name,c.name category_name FROM activities a JOIN project_activities pa ON pa.activity_id=a.id JOIN units u ON u.id=a.unit_id LEFT JOIN categories c ON c.id=a.category_id WHERE pa.project_id=? AND a.duplicate_of IS NULL ORDER BY a.date,a.id",
      )
      .all(p.id)
      .map((r) => ({ ...r, metrics: JSON.parse(r.metrics) }));
    const sum = summarizeRows(rows, templates(db));
    res.json({
      ...p,
      targets: JSON.parse(p.targets),
      can_edit: canEdit(req.user, p),
      summary: sum,
      activities: rows,
      progress: JSON.parse(p.targets).map((t) => {
        const actual = sum.metrics.find(
          (m) => m.label === t.label && m.unit === t.unit,
        )?.value;
        return {
          ...t,
          actual: actual ?? null,
          percent:
            actual != null && t.value > 0
              ? Math.round((actual / t.value) * 1000) / 10
              : null,
        };
      }),
    });
  });
  app.put("/api/activities/:id/project", (req, res) => {
    const a = db
      .prepare("SELECT * FROM activities WHERE id=?")
      .get(+req.params.id);
    if (!a) throw httpError(404, "ไม่พบกิจกรรม");
    if (!canEdit(req.user, a))
      throw httpError(403, "ไม่มีสิทธิ์เชื่อมกิจกรรมนี้");
    assertUnlocked(db, a);
    const id = z
      .object({ project_id: positive.nullable() })
      .parse(req.body).project_id;
    const p = id
      ? db.prepare("SELECT * FROM projects WHERE id=?").get(id)
      : null;
    if (id && (!p || !canEdit(req.user, p)))
      throw httpError(403, "ไม่มีสิทธิ์เชื่อมโครงการนี้");
    transaction(db, () => {
      const old = db
        .prepare("SELECT * FROM project_activities WHERE activity_id=?")
        .get(a.id);
      if (id)
        db.prepare(
          "INSERT INTO project_activities(activity_id,project_id) VALUES(?,?) ON CONFLICT(activity_id) DO UPDATE SET project_id=excluded.project_id",
        ).run(a.id, id);
      else
        db.prepare("DELETE FROM project_activities WHERE activity_id=?").run(
          a.id,
        );
      writeAudit(
        db,
        req.user,
        "เชื่อมรายงานกับโครงการ",
        "activity",
        a.id,
        old,
        { project_id: id },
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/duplicates", (req, res) => {
    const rows = db
      .prepare(
        "SELECT a.*,u.name unit_name FROM activities a JOIN units u ON u.id=a.unit_id WHERE a.duplicate_of IS NULL ORDER BY a.id DESC LIMIT 1000",
      )
      .all();
    const pairs = [];
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i],
          b = rows[j];
        if (a.unit_id !== b.unit_id || !a.date || a.date !== b.date) continue;
        const title = normalize(a.title),
          other = normalize(b.title);
        if (
          title === other ||
          (a.area &&
            a.area === b.area &&
            title.length > 8 &&
            other.length > 8 &&
            (title.includes(other) || other.includes(title)))
        )
          pairs.push({
            first: a,
            second: b,
            can_merge: canEdit(req.user, a) && canEdit(req.user, b),
            reason:
              "วันที่ หน่วยงาน และชื่อกิจกรรมใกล้เคียงกัน ต้องตรวจต้นฉบับก่อนรวม",
          });
      }
    res.json({
      pairs: pairs.slice(0, 100),
      merged: db
        .prepare(
          "SELECT * FROM activities WHERE duplicate_of IS NOT NULL ORDER BY id DESC LIMIT 100",
        )
        .all()
        .map((a) => ({
          id: a.id,
          title: a.title,
          duplicate_of: a.duplicate_of,
          can_restore:
            canEdit(req.user, a) &&
            canEdit(
              req.user,
              db
                .prepare("SELECT * FROM activities WHERE id=?")
                .get(a.duplicate_of),
            ),
        })),
    });
  });
  app.post("/api/duplicates/merge", (req, res) => {
    const v = z
      .object({
        duplicate_id: positive,
        canonical_id: positive,
        confirmed: z.literal(true),
      })
      .parse(req.body);
    if (v.duplicate_id === v.canonical_id)
      throw httpError(400, "ต้องเลือกคนละรายการ");
    transaction(db, () => {
      const a = db
          .prepare("SELECT * FROM activities WHERE id=?")
          .get(v.duplicate_id),
        b = db
          .prepare("SELECT * FROM activities WHERE id=?")
          .get(v.canonical_id);
      if (!a || !b) throw httpError(404, "ไม่พบกิจกรรม");
      if (!canEdit(req.user, a) || !canEdit(req.user, b))
        throw httpError(403, "ต้องมีสิทธิ์แก้ไขทั้งสองรายการ");
      if (
        a.duplicate_of ||
        b.duplicate_of ||
        db.prepare("SELECT id FROM activities WHERE duplicate_of=?").get(a.id)
      )
        throw httpError(409, "รายการถูกเชื่อมแล้ว กรุณาโหลดใหม่");
      assertUnlocked(db, a);
      assertUnlocked(db, b);
      db.prepare(
        "UPDATE activities SET duplicate_of=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      ).run(b.id, a.id);
      writeAudit(db, req.user, "ยืนยันรายงานซ้ำ", "activity", a.id, a, {
        duplicate_of: b.id,
      });
    });
    res.json({ ok: true });
  });
  app.post("/api/duplicates/:id/restore", (req, res) => {
    const a = db
      .prepare("SELECT * FROM activities WHERE id=?")
      .get(+req.params.id);
    if (!a || !a.duplicate_of) throw httpError(404, "ไม่พบรายการซ้ำ");
    const b = db
      .prepare("SELECT * FROM activities WHERE id=?")
      .get(a.duplicate_of);
    if (!canEdit(req.user, a) || !canEdit(req.user, b))
      throw httpError(403, "ไม่มีสิทธิ์คืนรายการ");
    assertUnlocked(db, a);
    assertUnlocked(db, b);
    transaction(db, () => {
      db.prepare(
        "UPDATE activities SET duplicate_of=NULL,version=version+1 WHERE id=?",
      ).run(a.id);
      writeAudit(
        db,
        req.user,
        "คืนรายงานที่เคยซ้ำ",
        "activity",
        a.id,
        { duplicate_of: a.duplicate_of },
        { duplicate_of: null },
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/period-locks", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT l.*,u.name unit_name FROM period_locks l JOIN units u ON u.id=l.unit_id ORDER BY l.id DESC",
        )
        .all(),
    ),
  );
  app.post("/api/period-locks", (req, res) => {
    const v = z
      .object({
        unit_id: positive,
        date_from: date,
        date_to: date,
        reason: z.string().trim().min(1).max(300),
      })
      .refine((v) => v.date_from <= v.date_to, "ช่วงเวลาไม่ถูกต้อง")
      .parse(req.body);
    if (
      !req.user.roles.includes("head") ||
      !req.user.scopes.includes(v.unit_id)
    )
      throw httpError(403, "เฉพาะหัวหน้าหน่วยที่รับผิดชอบ");
    const id = transaction(db, () => {
      const id = Number(
        db
          .prepare(
            "INSERT INTO period_locks(unit_id,date_from,date_to,reason,created_by) VALUES(?,?,?,?,?)",
          )
          .run(v.unit_id, v.date_from, v.date_to, v.reason, req.user.id)
          .lastInsertRowid,
      );
      writeAudit(db, req.user, "ปิดรอบรายงาน", "period_lock", id, null, v);
      return id;
    });
    res.status(201).json({ id });
  });
  app.post("/api/period-locks/:id/reopen", (req, res) => {
    const lock = db
      .prepare("SELECT * FROM period_locks WHERE id=?")
      .get(+req.params.id);
    if (!lock) throw httpError(404, "ไม่พบรอบรายงาน");
    if (
      !req.user.roles.includes("head") ||
      !req.user.scopes.includes(lock.unit_id)
    )
      throw httpError(403, "เฉพาะหัวหน้าหน่วยที่รับผิดชอบ");
    const reason = z.string().trim().min(1).max(300).parse(req.body.reason);
    transaction(db, () => {
      db.prepare("UPDATE period_locks SET active=0 WHERE id=?").run(lock.id);
      writeAudit(
        db,
        req.user,
        "เปิดรอบรายงานเพื่อแก้ไข",
        "period_lock",
        lock.id,
        lock,
        { active: false, reason },
      );
    });
    res.json({ ok: true });
  });
}
