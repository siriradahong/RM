import { z } from "zod";
import { suggestFields } from "./extraction-parser.js";
import { validDate } from "../shared/report-period.js";
import { httpError } from "./security.js";
import { manages } from "./access.js";
import { transaction, writeAudit } from "./db.js";
import { notify } from "./jobs.js";
const positive = z.number().int().positive();
export function proposeWorkflow(db, user, kind, text) {
  if (
    kind === "assignment" &&
    !user.roles.includes("executive") &&
    !user.roles.includes("head") &&
    !user.roles.includes("center_head")
  )
    throw httpError(403, "เฉพาะหัวหน้าหรือผู้บริหารเสนอการมอบหมาย");
  const fields = suggestFields(text).fields,
    times = [...text.matchAll(/\b([01]?\d|2[0-3])[.:]([0-5]\d)\b/g)].map(
      (m) => m[1].padStart(2, "0") + ":" + m[2],
    );
  const names = db
    .prepare("SELECT id,name,unit_id FROM users WHERE active=1")
    .all()
    .filter((u) => text.includes(u.name));
  const payload = {
    title: (fields.title || text.split("\n")[0]).slice(0, 300),
    date: fields.date || null,
    start_time: times[0] || null,
    end_time: times[1] || null,
    unit_id: user.unit_id || user.scopes[0] || null,
    work_id: user.work_id || null,
    attendee_ids: names
      .filter(
        (u) =>
          user.roles.includes("executive") ||
          u.unit_id === user.unit_id ||
          user.scopes.includes(u.unit_id),
      )
      .map((u) => u.id),
    project_id: null,
    assignee_id: names.length === 1 ? names[0].id : null,
  };
  const id = Number(
    db
      .prepare(
        "INSERT INTO workflow_proposals(owner_id,kind,source_text,payload) VALUES(?,?,?,?)",
      )
      .run(user.id, kind, text, JSON.stringify(payload)).lastInsertRowid,
  );
  writeAudit(
    db,
    user,
    "เตรียมข้อเสนอจากข้อความ ยังไม่สร้างงาน/นัดหมาย",
    "workflow_proposal",
    id,
    null,
    { kind },
  );
  return { id, kind, payload, state: "pending", source_text: text };
}
export function registerProposalRoutes(app, db) {
  app.get("/api/workflow-proposals", (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT * FROM workflow_proposals WHERE owner_id=? ORDER BY id DESC LIMIT 100",
        )
        .all(req.user.id)
        .map((r) => ({ ...r, payload: JSON.parse(r.payload) })),
    }),
  );
  app.post("/api/workflow-proposals/analyze", (req, res) => {
    const b = z
      .object({
        kind: z.enum(["event", "assignment"]),
        source_text: z.string().trim().min(1).max(20000),
      })
      .parse(req.body);
    res.status(201).json(proposeWorkflow(db, req.user, b.kind, b.source_text));
  });
  app.post("/api/workflow-proposals/:id/confirm", (req, res) => {
    const r = db
      .prepare(
        "SELECT * FROM workflow_proposals WHERE id=? AND owner_id=? AND state='pending'",
      )
      .get(Number(req.params.id), req.user.id);
    if (!r) throw httpError(409, "ข้อเสนอผ่านการยืนยันแล้วหรือไม่อยู่ในสิทธิ์");
    const p = z
      .object({
        title: z.string().trim().min(1).max(300),
        date: z.string().refine(validDate),
        unit_id: positive,
        work_id: positive.nullable().default(null),
        start_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .nullable()
          .default(null),
        end_time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
          .nullable()
          .default(null),
        attendee_ids: z.array(positive).max(100).default([]),
        project_id: positive.nullable().default(null),
        assignee_id: positive.nullable().default(null),
        version: positive.optional(),
      })
      .parse(req.body);
    const result = transaction(db, () => {
      let id;
      if (r.kind === "assignment") {
        const project = db
          .prepare("SELECT * FROM projects WHERE id=?")
          .get(p.project_id);
        if (
          !project ||
          project.status === "completed" ||
          (!req.user.roles.includes("executive") && !manages(req.user, project))
        )
          throw httpError(403, "เลือกโครงการที่ตนมีอำนาจมอบหมาย");
        if (p.version !== project.version)
          throw httpError(409, "โครงการเปลี่ยนแล้ว กรุณาตรวจใหม่");
        if (p.date > project.due_date)
          throw httpError(400, "กำหนดส่งต้องไม่เกินวันสิ้นสุดโครงการ");
        const u = db
          .prepare("SELECT * FROM users WHERE id=? AND active=1 AND unit_id=?")
          .get(p.assignee_id, project.unit_id);
        if (
          !u ||
          !JSON.parse(u.roles).some((x) =>
            ["staff", "head", "center_head"].includes(x),
          )
        )
          throw httpError(400, "เลือกผู้รับผิดชอบที่ปฏิบัติงานในฝ่ายโครงการ");
        if (
          req.user.roles.includes("center_head") &&
          !req.user.roles.includes("executive") &&
          !req.user.roles.includes("head") &&
          !req.user.work_scopes.includes(u.work_id)
        )
          throw httpError(403, "ผู้รับผิดชอบอยู่นอกศูนย์");
        id = Number(
          db
            .prepare(
              "INSERT INTO project_tasks(project_id,title,assignee_id,due_date) VALUES(?,?,?,?)",
            )
            .run(project.id, p.title, u.id, p.date).lastInsertRowid,
        );
        db.prepare("UPDATE projects SET version=version+1 WHERE id=?").run(
          project.id,
        );
        notify(
          db,
          u.id,
          "assignment",
          "ได้รับมอบหมายงานใหม่",
          p.title,
          "projects",
          `assigned:${id}`,
        );
      } else {
        if (
          !req.user.roles.includes("executive") &&
          !manages(req.user, p) &&
          p.unit_id !== req.user.unit_id
        )
          throw httpError(403, "ไม่มีสิทธิ์สร้างนัดหมายฝ่ายนี้");
        if (
          !db
            .prepare(
              "SELECT id FROM units WHERE id=? AND active=1 AND kind!='section'",
            )
            .get(p.unit_id)
        )
          throw httpError(400, "ฝ่ายไม่พร้อมใช้งาน");
        if (
          p.work_id &&
          !db
            .prepare(
              "SELECT id FROM works WHERE id=? AND unit_id=? AND active=1",
            )
            .get(p.work_id, p.unit_id)
        )
          throw httpError(400, "งานไม่อยู่ในฝ่าย");
        if (
          (p.start_time === null) !== (p.end_time === null) ||
          (p.start_time && p.start_time >= p.end_time)
        )
          throw httpError(400, "ตรวจเวลาเริ่มและสิ้นสุด");
        id = Number(
          db
            .prepare(
              "INSERT INTO calendar_events(title,date,start_time,end_time,unit_id,work_id,owner_id,source_text) VALUES(?,?,?,?,?,?,?,?)",
            )
            .run(
              p.title,
              p.date,
              p.start_time,
              p.end_time,
              p.unit_id,
              p.work_id,
              req.user.id,
              r.source_text,
            ).lastInsertRowid,
        );
        for (const uid of new Set([req.user.id, ...p.attendee_ids])) {
          const u = db
            .prepare("SELECT * FROM users WHERE id=? AND active=1")
            .get(uid);
          if (
            !u ||
            (uid !== req.user.id &&
              !req.user.roles.includes("executive") &&
              !manages(req.user, u) &&
              u.unit_id !== req.user.unit_id)
          )
            throw httpError(400, "ผู้เข้าร่วมอยู่นอกสิทธิ์");
          db.prepare("INSERT INTO calendar_attendees VALUES(?,?)").run(id, uid);
        }
      }
      db.prepare(
        "UPDATE workflow_proposals SET state='confirmed',payload=?,result_id=? WHERE id=?",
      ).run(JSON.stringify(p), id, r.id);
      writeAudit(
        db,
        req.user,
        "ยืนยันข้อเสนอและสร้าง" +
          (r.kind === "event" ? "นัดหมาย" : "งานมอบหมาย"),
        "workflow_proposal",
        r.id,
        r,
        { ...p, result_id: id },
      );
      return id;
    });
    res.json({ id: result, kind: r.kind });
  });
}
