import { z } from "zod";
import { httpError } from "./security.js";
import { manages } from "./access.js";
import { transaction, writeAudit } from "./db.js";
const schema = z.object({
  action: z.enum(["start", "submit", "approve", "return"]),
  version: z.number().int().positive(),
  activity_id: z.number().int().positive().optional(),
  note: z.string().trim().max(2000).default(""),
});
export function applyTaskAction(db, user, taskId, body) {
  const input = schema.parse(body),
    t = db.prepare("SELECT * FROM project_tasks WHERE id=?").get(taskId);
  if (!t) throw httpError(404, "ไม่พบงาน");
  const p = db.prepare("SELECT * FROM projects WHERE id=?").get(t.project_id);
  if (t.version !== input.version)
    throw httpError(409, "งานเปลี่ยนแล้ว กรุณาตรวจใหม่");
  if (p.status === "completed") throw httpError(400, "โครงการปิดแล้ว");
  let state,
    activityId = t.activity_id;
  if (["approve", "return"].includes(input.action)) {
    if (!user.roles.includes("executive") && !manages(user, p))
      throw httpError(403, "เฉพาะหัวหน้าที่รับผิดชอบ");
    if (input.action === "approve") {
      if (
        t.status !== "submitted" ||
        !db
          .prepare(
            "SELECT 1 FROM activities WHERE id=? AND owner_id=? AND unit_id=? AND status='ready' AND duplicate_of IS NULL",
          )
          .get(t.activity_id, t.assignee_id, p.unit_id)
      )
        throw httpError(400, "ต้องมีรายงานที่ยืนยันและส่งตรวจแล้ว");
      state = "completed";
    } else {
      if (!["submitted", "completed"].includes(t.status) || !input.note)
        throw httpError(400, "ระบุเหตุผลส่งกลับงานที่ส่งตรวจแล้ว");
      state = "in_progress";
    }
  } else {
    if (
      t.assignee_id !== user.id ||
      !user.roles.some((r) => ["staff", "center_head", "head"].includes(r))
    )
      throw httpError(403, "เฉพาะผู้รับมอบหมาย");
    if (["submitted", "completed"].includes(t.status))
      throw httpError(400, "ส่งตรวจแล้ว");
    if (input.action === "submit") {
      const a = db
        .prepare(
          "SELECT id FROM activities WHERE id=? AND owner_id=? AND unit_id=? AND status='ready' AND duplicate_of IS NULL",
        )
        .get(input.activity_id || null, user.id, p.unit_id);
      if (!a)
        throw httpError(400, "เลือกรายงานของตนในฝ่ายโครงการที่ยืนยันแล้ว");
      activityId = a.id;
      state = "submitted";
    } else state = "in_progress";
  }
  transaction(db, () => {
    db.prepare(
      "UPDATE project_tasks SET status=?,activity_id=?,note=?,last_update_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    ).run(state, activityId, input.note, t.id);
    db.prepare(
      "UPDATE projects SET version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    ).run(p.id);
    writeAudit(db, user, "งานมอบหมาย: " + input.action, "project", p.id, t, {
      task_id: t.id,
      status: state,
      activity_id: activityId,
      note: input.note,
    });
  });
  return p.id;
}
