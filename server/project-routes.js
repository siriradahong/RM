import { notify } from "./jobs.js";
import { applyTaskAction } from "./task-actions.js";
import { manages } from "./access.js";
import { z } from "zod";
import { httpError, isHeadForUnit } from "./security.js";
import { transaction, writeAudit } from "./db.js";
import { validDate } from "../shared/report-period.js";
import { metricUnits } from "./summary-engine.js";
const positive = z.number().int().positive();
const due = z.string().refine(validDate, "วันที่ไม่ถูกต้อง");
const title = z.string().trim().min(1).max(300);
const projectSchema = z.object({
  title,
  description: z.string().trim().max(5000).default(""),
  unit_id: positive,
  work_id: positive.nullable().default(null),
  due_date: due,
});
const taskSchema = z.object({
  title,
  assignee_id: positive,
  due_date: due,
  version: positive,
});
const actionSchema = z.object({
  action: z.enum(["start", "submit", "approve", "return"]),
  version: positive,
  activity_id: positive.optional(),
  note: z.string().trim().max(2000).default(""),
});
const selectProject =
  "SELECT p.*,u.name unit_name,o.name creator_name FROM projects p JOIN units u ON u.id=p.unit_id JOIN users o ON o.id=p.created_by";
const selectTask = `SELECT t.*,u.name assignee_name,a.title activity_title,a.status activity_status FROM project_tasks t JOIN users u ON u.id=t.assignee_id LEFT JOIN activities a ON a.id=t.activity_id`;
function scope(user) {
  const parts = [],
    args = [];
  if (user.roles.includes("executive")) return { sql: "1=1", args: [] };
  if ((user.roles.includes("head") || user.delegated) && user.scopes.length) {
    parts.push(`p.unit_id IN (${user.scopes.map(() => "?").join(",")})`);
    args.push(...user.scopes);
  }
  if (
    (user.roles.includes("center_head") || user.delegated) &&
    user.work_scopes.length
  ) {
    parts.push(`p.work_id IN (${user.work_scopes.map(() => "?")})`);
    args.push(...user.work_scopes);
  }
  if (user.roles.includes("staff")) {
    parts.push(
      "EXISTS(SELECT 1 FROM project_tasks t WHERE t.project_id=p.id AND t.assignee_id=?)",
    );
    args.push(user.id);
  }
  if (!parts.length) throw httpError(403, "ไม่มีสิทธิ์ดูงานมอบหมาย");
  return { sql: "(" + parts.join(" OR ") + ")", args };
}
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(
    new Date(),
  );
export function registerProjectRoutes(app, db) {
  function project(req, id = Number(req.params.id)) {
    const s = scope(req.user);
    const p = db
      .prepare(`${selectProject} WHERE p.id=? AND ${s.sql}`)
      .get(id, ...s.args);
    if (!p) throw httpError(404, "ไม่พบโครงการที่มีสิทธิ์เข้าถึง");
    return p;
  }
  function manager(req, p) {
    if (!req.user.roles.includes("executive") && !manages(req.user, p))
      throw httpError(403, "เฉพาะหัวหน้าที่รับผิดชอบฝ่ายนี้");
  }
  function checkVersion(row, version) {
    if (version !== row.version)
      throw httpError(409, "รายการเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่");
  }
  function detail(req, p) {
    const manage = req.user.roles.includes("executive") || manages(req.user, p),
      broad = manage || req.user.roles.includes("executive");
    const tasks = db
      .prepare(
        `${selectTask} WHERE t.project_id=? ${broad ? "" : "AND t.assignee_id=?"} ORDER BY t.due_date,t.id`,
      )
      .all(p.id, ...(broad ? [] : [req.user.id]));
    const sourceIds = [
      ...new Set(tasks.map((t) => t.activity_id).filter(Boolean)),
    ];
    const sources = sourceIds.length
      ? db
          .prepare(
            `SELECT id,title,status,result,metrics FROM activities WHERE status='ready' AND duplicate_of IS NULL AND id IN (${sourceIds.map(() => "?").join(",")})`,
          )
          .all(...sourceIds)
      : [];
    const target = p.target_json ? JSON.parse(p.target_json) : null;
    const values = target
      ? sources.flatMap((s) =>
          JSON.parse(s.metrics)
            .filter((m) => m.label === target.label && m.unit === target.unit)
            .map((m) => m.value),
        )
      : [];
    const actual = values.length ? values.reduce((a, b) => a + b, 0) : null;
    return {
      ...p,
      target_json: undefined,
      target,
      performance: {
        sources,
        actual,
        percent:
          target && actual !== null ? (actual / target.value) * 100 : null,
        scope: broad ? "ทั้งโครงการ" : "เฉพาะงานที่คุณได้รับมอบหมาย",
      },
      can_manage: manage,
      tasks: tasks.map((t) => ({
        ...t,
        overdue: t.status !== "completed" && t.due_date < today(),
        can_submit:
          req.user.roles.includes("staff") && t.assignee_id === req.user.id,
      })),
      history: db
        .prepare(
          "SELECT actor_name,action,created_at FROM audits WHERE entity='project' AND entity_id=? ORDER BY id DESC LIMIT 20",
        )
        .all(p.id),
    };
  }
  app.get("/api/projects", (req, res) => {
    const s = scope(req.user);
    res.json({
      items: db
        .prepare(
          `${selectProject} WHERE ${s.sql} ORDER BY p.due_date,p.id DESC`,
        )
        .all(...s.args)
        .map((p) => detail(req, p)),
    });
  });
  app.put("/api/projects/:id/target", (req, res) => {
    const p = project(req);
    manager(req, p);
    const input = z
      .object({
        version: positive,
        label: z.string().trim().min(1).max(100),
        unit: z.enum(metricUnits),
        value: z.number().positive().max(1e12),
        source: z.string().trim().min(1).max(2000),
        verified: z.literal(true),
      })
      .parse(req.body);
    checkVersion(p, input.version);
    const target = {
      label: input.label,
      unit: input.unit,
      value: input.value,
      source: input.source,
      confirmed_by: req.user.name,
      confirmed_at: new Date().toISOString(),
    };
    transaction(db, () => {
      db.prepare(
        "UPDATE projects SET target_json=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      ).run(JSON.stringify(target), p.id);
      writeAudit(
        db,
        req.user,
        "ยืนยันเป้าหมายจากเอกสาร",
        "project",
        p.id,
        p.target_json ? JSON.parse(p.target_json) : null,
        target,
      );
    });
    res.json(detail(req, project(req, p.id)));
  });
  app.get("/api/projects/members", (req, res) => {
    const unit = Number(req.query.unit);
    if (
      !isHeadForUnit(req.user, unit) &&
      !(req.user.roles.includes("center_head") && req.user.unit_id === unit)
    )
      throw httpError(403, "ไม่มีสิทธิ์มอบหมายงานในฝ่ายนี้");
    res.json({
      items: db
        .prepare(
          "SELECT id,name,work_id FROM users WHERE active=1 AND unit_id=? AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value='staff') ORDER BY name",
        )
        .all(unit)
        .filter(
          (u) =>
            isHeadForUnit(req.user, unit) ||
            req.user.work_scopes.includes(u.work_id),
        ),
    });
  });
  app.post("/api/projects", (req, res) => {
    const input = projectSchema.parse(req.body);
    if (req.user.roles.includes("center_head") && !input.work_id)
      input.work_id = req.user.work_scopes[0];
    if (
      input.work_id &&
      !db
        .prepare("SELECT id FROM works WHERE id=? AND unit_id=? AND active=1")
        .get(input.work_id, input.unit_id)
    )
      throw httpError(400, "ศูนย์ต้องอยู่ในฝ่ายที่เลือก");
    manager(req, input);
    if (
      !db
        .prepare(
          "SELECT id FROM units WHERE id=? AND active=1 AND kind!='section'",
        )
        .get(input.unit_id)
    )
      throw httpError(400, "ฝ่ายไม่พร้อมใช้งาน");
    const id = transaction(db, () => {
      const id = Number(
        db
          .prepare(
            "INSERT INTO projects(title,description,unit_id,due_date,created_by) VALUES(?,?,?,?,?)",
          )
          .run(
            input.title,
            input.description,
            input.unit_id,
            input.due_date,
            req.user.id,
          ).lastInsertRowid,
      );
      db.prepare("UPDATE projects SET work_id=? WHERE id=?").run(
        input.work_id || req.user.work_id || null,
        id,
      );
      writeAudit(db, req.user, "สร้างโครงการ", "project", id, null, input);
      return id;
    });
    res.status(201).json(detail(req, project(req, id)));
  });
  app.get("/api/projects/:id", (req, res) =>
    res.json(detail(req, project(req))),
  );
  app.post("/api/projects/:id/tasks", (req, res) => {
    const p = project(req),
      input = taskSchema.parse(req.body);
    manager(req, p);
    checkVersion(p, input.version);
    if (p.status === "completed")
      throw httpError(400, "เปิดโครงการอีกครั้งก่อนเพิ่มงาน");
    if (input.due_date > p.due_date)
      throw httpError(400, "กำหนดส่งงานต้องไม่เกินวันสิ้นสุดโครงการ");
    if (
      !db
        .prepare(
          "SELECT id FROM users WHERE id=? AND active=1 AND unit_id=? AND EXISTS(SELECT 1 FROM json_each(users.roles) WHERE value='staff')",
        )
        .get(input.assignee_id, p.unit_id)
    )
      throw httpError(400, "เลือกเจ้าหน้าที่ที่เปิดใช้งานในฝ่ายนี้");
    if (
      req.user.roles.includes("center_head") &&
      !isHeadForUnit(req.user, p.unit_id)
    ) {
      const u = db
        .prepare("SELECT work_id FROM users WHERE id=?")
        .get(input.assignee_id);
      if (!req.user.work_scopes.includes(u.work_id))
        throw httpError(403, "ผู้รับงานอยู่นอกศูนย์ที่รับผิดชอบ");
    }
    transaction(db, () => {
      const created = db
        .prepare(
          "INSERT INTO project_tasks(project_id,title,assignee_id,due_date) VALUES(?,?,?,?)",
        )
        .run(p.id, input.title, input.assignee_id, input.due_date);
      notify(
        db,
        input.assignee_id,
        "assignment",
        "ได้รับมอบหมายงานใหม่",
        input.title,
        "projects",
        `assigned:${created.lastInsertRowid}`,
      );
      db.prepare(
        "UPDATE projects SET version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      ).run(p.id);
      writeAudit(db, req.user, "มอบหมายงาน", "project", p.id, null, input);
    });
    res.status(201).json(detail(req, project(req)));
  });
  app.patch("/api/projects/:id", (req, res) => {
    const p = project(req);
    manager(req, p);
    const input = z
      .object({
        status: z.enum(["planning", "active", "awaiting", "completed"]),
        version: positive,
      })
      .parse(req.body);
    checkVersion(p, input.version);
    if (input.status === "completed") {
      const tasks = db
        .prepare(
          "SELECT t.status,a.status activity_status FROM project_tasks t LEFT JOIN activities a ON a.id=t.activity_id WHERE project_id=?",
        )
        .all(p.id);
      if (
        !tasks.length ||
        tasks.some(
          (t) => t.status !== "completed" || t.activity_status !== "ready",
        )
      )
        throw httpError(
          400,
          "ต้องมีงานที่ตรวจรับและรายงานที่ยืนยันครบทุกงานก่อนปิดโครงการ",
        );
    }
    transaction(db, () => {
      db.prepare(
        "UPDATE projects SET status=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      ).run(input.status, p.id);
      db.prepare(
        "UPDATE projects SET completed_at=CASE WHEN ?='completed' THEN COALESCE(completed_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE NULL END WHERE id=?",
      ).run(input.status, p.id);
      writeAudit(
        db,
        req.user,
        "เปลี่ยนสถานะโครงการ",
        "project",
        p.id,
        p,
        input,
      );
    });
    res.json(detail(req, project(req)));
  });
  app.post("/api/project-tasks/:id/action", (req, res) => {
    const t = db
      .prepare("SELECT * FROM project_tasks WHERE id=?")
      .get(Number(req.params.id));
    if (!t) throw httpError(404, "ไม่พบงาน");
    project(req, t.project_id);
    const id = applyTaskAction(db, req.user, t.id, req.body);
    res.json(detail(req, project(req, id)));
  });
}
