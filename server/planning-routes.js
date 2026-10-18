import { z } from "zod";
import { httpError } from "./security.js";
import { assertRead, assertUnlocked, manages, contentScope } from "./access.js";
import { transaction, writeAudit } from "./db.js";
import { validDate, reportPeriod } from "../shared/report-period.js";
import { makeReportDocx } from "./report-docx.js";
const id = z.number().int().positive(),
  date = z.string().refine(validDate),
  text = z.string().trim().min(1).max(2000),
  amount = z
    .number()
    .finite()
    .min(0)
    .max(1e12)
    .refine(
      (v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.001,
      "จำนวนเงินได้ไม่เกินสองตำแหน่ง",
    );
const unitRead = (u, id) =>
  u.roles.includes("executive") ||
  ((u.roles.includes("head") || u.delegated) && u.scopes.includes(id));
const unitWrite = (u, id) =>
  u.roles.includes("executive") ||
  ((u.roles.includes("head") || u.delegated) && u.scopes.includes(id));
export function registerPlanningRoutes(app, db) {
  app.get("/api/plans", (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT p.*,u.name unit_name FROM plans p JOIN units u ON u.id=p.unit_id ORDER BY fiscal_year DESC,id DESC",
        )
        .all()
        .filter((p) => unitRead(req.user, p.unit_id)),
    }),
  );
  app.post("/api/plans", (req, res) => {
    const p = z
      .object({
        title: text,
        fiscal_year: z.number().int().min(2500).max(2800),
        unit_id: id,
        approved_budget: amount,
        reference: text,
      })
      .parse(req.body);
    if (!unitWrite(req.user, p.unit_id))
      throw httpError(403, "ไม่มีสิทธิ์บันทึกแผน");
    const key = Number(
      db
        .prepare(
          "INSERT INTO plans(title,fiscal_year,unit_id,approved_budget,reference) VALUES(?,?,?,?,?)",
        )
        .run(p.title, p.fiscal_year, p.unit_id, p.approved_budget, p.reference)
        .lastInsertRowid,
    );
    writeAudit(db, req.user, "บันทึกแผนและงบประมาณ", "plan", key, null, p);
    res.status(201).json({ id: key });
  });
  app.put("/api/projects/:id/plan", (req, res) => {
    const p = db
        .prepare("SELECT * FROM projects WHERE id=?")
        .get(Number(req.params.id)),
      input = z.object({ plan_id: id.nullable(), version: id }).parse(req.body);
    if (!p || !(manages(req.user, p) || req.user.roles.includes("executive")))
      throw httpError(403, "ไม่มีสิทธิ์เชื่อมแผน");
    if (p.version !== input.version) throw httpError(409, "โครงการเปลี่ยนแล้ว");
    if (
      input.plan_id &&
      !db
        .prepare("SELECT id FROM plans WHERE id=? AND unit_id=?")
        .get(input.plan_id, p.unit_id)
    )
      throw httpError(400, "แผนต้องอยู่ฝ่ายเดียวกับโครงการ");
    db.prepare(
      "UPDATE projects SET plan_id=?,version=version+1 WHERE id=?",
    ).run(input.plan_id, p.id);
    writeAudit(
      db,
      req.user,
      "เชื่อมโครงการกับแผน",
      "project",
      p.id,
      { plan_id: p.plan_id },
      input,
    );
    res.json({ version: p.version + 1 });
  });
  app.get("/api/projects/:id/budget", (req, res) => {
    const p = db
      .prepare("SELECT * FROM projects WHERE id=?")
      .get(Number(req.params.id));
    if (
      !p ||
      !(
        unitRead(req.user, p.unit_id) ||
        manages(req.user, p) ||
        db
          .prepare(
            "SELECT 1 FROM project_tasks WHERE project_id=? AND assignee_id=?",
          )
          .get(p.id, req.user.id)
      )
    )
      throw httpError(404, "ไม่พบโครงการ");
    const plan = p.plan_id
        ? db.prepare("SELECT * FROM plans WHERE id=?").get(p.plan_id)
        : null,
      items = db
        .prepare(
          "SELECT e.*,u.name author_name FROM project_expenses e JOIN users u ON u.id=e.created_by WHERE project_id=? ORDER BY e.date,e.id",
        )
        .all(p.id);
    const planSpent = plan
      ? db
          .prepare(
            "SELECT COALESCE(SUM(e.amount),0) total FROM project_expenses e JOIN projects p ON p.id=e.project_id WHERE p.plan_id=?",
          )
          .get(plan.id).total
      : null;
    res.json({
      plan,
      items,
      spent: Math.round(items.reduce((n, e) => n + e.amount, 0) * 100) / 100,
      plan_spent: planSpent === null ? null : Math.round(planSpent * 100) / 100,
      remaining: plan
        ? Math.round((plan.approved_budget - planSpent) * 100) / 100
        : null,
    });
  });
  app.post("/api/projects/:id/expenses", (req, res) => {
    const p = db
        .prepare("SELECT * FROM projects WHERE id=?")
        .get(Number(req.params.id)),
      e = z
        .object({ amount, date, description: text, reference: text })
        .parse(req.body);
    if (!p || !(manages(req.user, p) || req.user.roles.includes("executive")))
      throw httpError(403, "เฉพาะหัวหน้าที่รับผิดชอบ");
    const key = Number(
      db
        .prepare(
          "INSERT INTO project_expenses(project_id,amount,date,description,reference,created_by) VALUES(?,?,?,?,?,?)",
        )
        .run(p.id, e.amount, e.date, e.description, e.reference, req.user.id)
        .lastInsertRowid,
    );
    writeAudit(
      db,
      req.user,
      "บันทึกค่าใช้จ่ายจริง",
      "project_expense",
      key,
      null,
      e,
    );
    res.status(201).json({ id: key });
  });
  app.get("/api/communities", (req, res) =>
    res.json({
      items: db
        .prepare("SELECT * FROM communities ORDER BY district,name")
        .all(),
    }),
  );
  app.post("/api/communities", (req, res) => {
    if (!req.user.roles.includes("admin")) throw httpError(403, "เฉพาะแอดมิน");
    const c = z
      .object({
        name: text,
        district: z.number().int().min(1).max(4),
        latitude: z.number().min(-90).max(90).nullable(),
        longitude: z.number().min(-180).max(180).nullable(),
      })
      .parse(req.body);
    if ((c.latitude === null) !== (c.longitude === null))
      throw httpError(400, "กรอกละติจูดและลองจิจูดคู่กัน");
    const key = Number(
      db
        .prepare(
          "INSERT INTO communities(name,district,latitude,longitude) VALUES(?,?,?,?)",
        )
        .run(c.name, c.district, c.latitude, c.longitude).lastInsertRowid,
    );
    writeAudit(db, req.user, "เพิ่มทะเบียนชุมชน", "community", key, null, c);
    res.status(201).json({ id: key });
  });
  app.post("/api/community-targets", (req, res) => {
    const p = z
      .object({
        unit_id: id,
        community_id: id,
        fiscal_year: z.number().int().min(2500).max(2800),
        reference: text,
      })
      .parse(req.body);
    if (!unitWrite(req.user, p.unit_id))
      throw httpError(403, "ไม่มีสิทธิ์ตั้งแผนพื้นที่");
    db.prepare(
      "INSERT INTO community_targets VALUES(?,?,?,?) ON CONFLICT(unit_id,community_id,fiscal_year) DO UPDATE SET reference=excluded.reference",
    ).run(p.unit_id, p.community_id, p.fiscal_year, p.reference);
    writeAudit(
      db,
      req.user,
      "กำหนดพื้นที่ตามแผน",
      "community",
      p.community_id,
      null,
      p,
    );
    res.status(201).json({ ok: true });
  });
  app.put("/api/activities/:id/community", (req, res) => {
    const a = db
      .prepare("SELECT * FROM activities WHERE id=?")
      .get(Number(req.params.id));
    assertRead(db, req.user, a);
    if (!unitWrite(req.user, a.unit_id) && a.owner_id !== req.user.id)
      throw httpError(403, "ไม่มีสิทธิ์");
    assertUnlocked(db, req.user, a);
    const p = z
      .object({ community_id: id.nullable(), version: id })
      .parse(req.body);
    if (a.version !== p.version) throw httpError(409, "รายงานเปลี่ยนแล้ว");
    if (
      p.community_id &&
      !db
        .prepare("SELECT id FROM communities WHERE id=? AND active=1")
        .get(p.community_id)
    )
      throw httpError(400, "ชุมชนไม่พร้อมใช้งาน");
    db.prepare(
      "UPDATE activities SET community_id=?,version=version+1 WHERE id=?",
    ).run(p.community_id, a.id);
    writeAudit(
      db,
      req.user,
      "ระบุชุมชนจากต้นฉบับ",
      "activity",
      a.id,
      { community_id: a.community_id },
      p,
    );
    res.json({ version: a.version + 1 });
  });
  app.get("/api/coverage", (req, res) => {
    const range = reportPeriod(req.query),
      s = contentScope(req.user),
      unit = Number(req.query.unit || req.user.unit_id),
      fiscalYear =
        Number(range.from.slice(0, 4)) +
        (Number(range.from.slice(5, 7)) >= 10 ? 1 : 0) +
        543;
    const unitWhere = unit
      ? "AND (a.unit_id=? OR EXISTS(SELECT 1 FROM activity_units au WHERE au.activity_id=a.id AND au.unit_id=?))"
      : "";
    const rows = db
      .prepare(
        `SELECT a.id,a.title,a.date,a.community_id,a.metrics FROM activities a WHERE ${s.sql} ${unitWhere} AND a.status='ready' AND a.duplicate_of IS NULL AND a.date BETWEEN ? AND ?`,
      )
      .all(...s.params, ...(unit ? [unit, unit] : []), range.from, range.to);
    const targets = db
      .prepare(
        "SELECT * FROM community_targets WHERE fiscal_year=? AND unit_id=?",
      )
      .all(fiscalYear, unit);
    const items = db
      .prepare(
        "SELECT * FROM communities WHERE active=1 ORDER BY district,name",
      )
      .all()
      .map((c) => ({
        ...c,
        planned: targets.some((t) => t.community_id === c.id),
        reports: rows
          .filter((r) => r.community_id === c.id)
          .map((r) => ({ id: r.id, title: r.title, date: r.date })),
        visited: rows.some((r) => r.community_id === c.id),
      }));
    const watches = items.flatMap((c) => {
      const dated = rows.filter(
        (r) =>
          r.community_id === c.id &&
          r.date >=
            new Date(Date.parse(range.to) - 6 * 86400000)
              .toISOString()
              .slice(0, 10),
      );
      const relevant = dated.filter((r) =>
        JSON.parse(r.metrics).some(
          (m) =>
            /ไข้เลือดออก/.test(m.label) &&
            ["คน", "ราย"].includes(m.unit) &&
            m.value > 0,
        ),
      );
      return relevant.length >= 2
        ? [
            {
              community_id: c.id,
              name: c.name,
              report_ids: relevant.map((r) => r.id),
              note: "พบรายงานที่ระบุไข้เลือดออกตั้งแต่ 2 กิจกรรมใน 7 วัน ควรตรวจต้นทาง ไม่ใช่การยืนยันการระบาด",
            },
          ]
        : [];
    });
    const completed = db
      .prepare("SELECT * FROM projects WHERE status='completed'")
      .all()
      .filter(
        (p) =>
          (!unit || p.unit_id === unit) &&
          (req.user.roles.includes("executive") ||
            manages(req.user, p) ||
            !!db
              .prepare(
                "SELECT 1 FROM project_tasks WHERE project_id=? AND assignee_id=?",
              )
              .get(p.id, req.user.id)),
      );
    const completedDay = (p) =>
      p.completed_at
        ? new Date(Date.parse(p.completed_at) + 7 * 3600000)
            .toISOString()
            .slice(0, 10)
        : null;
    res.json({
      range,
      items,
      watches,
      unassigned: rows.filter((r) => !r.community_id).length,
      completed_projects: completed.filter(
        (p) => completedDay(p) >= range.from && completedDay(p) <= range.to,
      ).length,
      completed_undated: completed.filter((p) => !p.completed_at).length,
    });
  });
  app.get("/api/events", (req, res) => {
    const { from, to } = req.query;
    if (!validDate(from) || !validDate(to) || from > to)
      throw httpError(400, "ช่วงเวลาไม่ถูกต้อง");
    const items = db
      .prepare(
        "SELECT e.*,u.name unit_name FROM calendar_events e JOIN units u ON u.id=e.unit_id WHERE e.date BETWEEN ? AND ? ORDER BY e.date,e.start_time",
      )
      .all(from, to)
      .filter(
        (e) =>
          req.user.roles.includes("executive") ||
          manages(req.user, e) ||
          e.owner_id === req.user.id ||
          db
            .prepare(
              "SELECT 1 FROM calendar_attendees WHERE event_id=? AND user_id=?",
            )
            .get(e.id, req.user.id),
      );
    const conflicts = [];
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i],
          b = items[j];
        if (
          a.date === b.date &&
          a.start_time &&
          a.end_time &&
          b.start_time &&
          b.end_time &&
          a.start_time < b.end_time &&
          b.start_time < a.end_time
        ) {
          const ids = db
            .prepare(
              "SELECT user_id FROM calendar_attendees WHERE event_id=? INTERSECT SELECT user_id FROM calendar_attendees WHERE event_id=?",
            )
            .all(a.id, b.id);
          if (ids.length)
            conflicts.push({
              ids: [a.id, b.id],
              attendees: ids.map((r) => r.user_id),
            });
        }
      }
    res.json({ items, conflicts });
  });
  app.post("/api/events", (req, res) => {
    const e = z
      .object({
        title: text,
        date,
        start_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .nullable(),
        end_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .nullable(),
        unit_id: id,
        work_id: id.nullable(),
        attendee_ids: z.array(id).max(100),
        source_text: z.string().max(20000).default(""),
      })
      .parse(req.body);
    if (!unitWrite(req.user, e.unit_id) && e.unit_id !== req.user.unit_id)
      throw httpError(403, "ไม่มีสิทธิ์สร้างกิจกรรมหน่วยนี้");
    if (
      (e.start_time === null) !== (e.end_time === null) ||
      (e.start_time && e.start_time >= e.end_time)
    )
      throw httpError(400, "ระบุช่วงเวลาให้ถูกต้อง");
    const key = transaction(db, () => {
      const key = Number(
        db
          .prepare(
            "INSERT INTO calendar_events(title,date,start_time,end_time,unit_id,work_id,owner_id,source_text) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            e.title,
            e.date,
            e.start_time,
            e.end_time,
            e.unit_id,
            e.work_id,
            req.user.id,
            e.source_text,
          ).lastInsertRowid,
      );
      for (const uid of new Set([req.user.id, ...e.attendee_ids])) {
        const u = db
          .prepare("SELECT id,unit_id FROM users WHERE id=? AND active=1")
          .get(uid);
        if (
          !u ||
          (!unitWrite(req.user, u.unit_id) && u.unit_id !== req.user.unit_id)
        )
          throw httpError(400, "ผู้เข้าร่วมอยู่นอกขอบเขต");
        db.prepare("INSERT INTO calendar_attendees VALUES(?,?)").run(key, uid);
      }
      writeAudit(
        db,
        req.user,
        "ยืนยันนัดหมายจากประกาศ",
        "calendar_event",
        key,
        null,
        e,
      );
      return key;
    });
    res.status(201).json({ id: key });
  });
  app.get("/api/hr-templates", (req, res) =>
    res.json({
      items: db
        .prepare("SELECT * FROM hr_templates WHERE active=1 ORDER BY name")
        .all()
        .map((t) => ({ ...t, headings: JSON.parse(t.headings) })),
    }),
  );
  app.post("/api/hr-templates", (req, res) => {
    if (!req.user.roles.includes("admin")) throw httpError(403, "เฉพาะผู้ดูแล");
    const t = z
      .object({
        name: text,
        personnel_type: text,
        headings: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
        reference: text,
      })
      .parse(req.body);
    const key = Number(
      db
        .prepare(
          "INSERT INTO hr_templates(name,personnel_type,headings,reference) VALUES(?,?,?,?)",
        )
        .run(t.name, t.personnel_type, JSON.stringify(t.headings), t.reference)
        .lastInsertRowid,
    );
    writeAudit(
      db,
      req.user,
      "กำหนดแบบสรุปบุคลากรจากเอกสารจริง",
      "hr_template",
      key,
      null,
      t,
    );
    res.status(201).json({ id: key });
  });
  app.post("/api/hr-exports", (req, res) => {
    const input = z
      .object({
        template_id: id,
        from: date,
        to: date,
        narrative: z.record(z.string(), z.string().max(10000)).default({}),
      })
      .parse(req.body);
    const t = db
      .prepare("SELECT * FROM hr_templates WHERE id=? AND active=1")
      .get(input.template_id);
    if (!t || input.from > input.to)
      throw httpError(400, "แบบฟอร์มหรือช่วงเวลาไม่ถูกต้อง");
    const user = db
      .prepare("SELECT id,name,personnel_type,position FROM users WHERE id=?")
      .get(req.user.id);
    if (user.personnel_type !== t.personnel_type)
      throw httpError(
        400,
        "แบบนี้ไม่ตรงประเภทบุคลากร ให้ผู้ดูแลตรวจข้อมูลบัญชีก่อน",
      );
    const rows = db
      .prepare(
        "SELECT a.id,a.title,a.date,a.result,a.metrics,a.unit_id,a.work_id,p.work_role,p.confirmed_at FROM activities a JOIN activity_people p ON p.activity_id=a.id WHERE p.user_id=? AND p.confirmed_at IS NOT NULL AND a.status='ready' AND a.owner_confirmed_at IS NOT NULL AND a.duplicate_of IS NULL AND a.date BETWEEN ? AND ? ORDER BY a.date",
      )
      .all(user.id, input.from, input.to)
      .map((r) => ({ ...r, metrics: JSON.parse(r.metrics) }));
    const payload = {
      user,
      template: { ...t, headings: JSON.parse(t.headings) },
      rows,
      narrative: input.narrative,
      from: input.from,
      to: input.to,
      cutoff_at: new Date().toISOString(),
      note: "ใช้เฉพาะบทบาทการทำงานที่บุคคลยืนยันเอง ตัวเลขจากกิจกรรมไม่ใช่คะแนนประเมิน",
    };
    const key = Number(
      db
        .prepare("INSERT INTO hr_exports(user_id,payload) VALUES(?,?)")
        .run(user.id, JSON.stringify(payload)).lastInsertRowid,
    );
    writeAudit(
      db,
      req.user,
      "สร้างฉบับสรุปผลงานบุคลากร",
      "hr_export",
      key,
      null,
      { template_id: t.id, count: rows.length },
    );
    res.status(201).json({ id: key, ...payload });
  });
  app.get("/api/hr-exports", (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT id,created_at FROM hr_exports WHERE user_id=? ORDER BY id DESC",
        )
        .all(req.user.id),
    }),
  );
  app.get("/api/hr-exports/:id", (req, res) => {
    const r = db
      .prepare("SELECT * FROM hr_exports WHERE id=? AND user_id=?")
      .get(Number(req.params.id), req.user.id);
    if (!r) throw httpError(404, "ไม่พบฉบับ");
    res.json({ id: r.id, ...JSON.parse(r.payload) });
  });
}
