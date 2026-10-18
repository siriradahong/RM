import { z } from "zod";
import { httpError, canEdit } from "./security.js";
import {
  assertRead,
  assertUnlocked,
  contentScope,
  manages,
  lockFor,
} from "./access.js";
import { transaction, writeAudit } from "./db.js";
import { validDate, reportPeriod } from "../shared/report-period.js";
const id = z.number().int().positive(),
  date = z.string().refine(validDate, "วันที่ไม่ถูกต้อง"),
  text = z.string().trim().min(1).max(2000);
const admin = (req, res, next) =>
  req.user.roles.includes("admin")
    ? next()
    : next(httpError(403, "เฉพาะผู้ดูแลระบบ"));
export const scopeSettings = (db) =>
  Object.fromEntries(
    db
      .prepare("SELECT * FROM scope_settings")
      .all()
      .map((r) => [r.key, JSON.parse(r.value)]),
  );
export function registerScopeRoutes(app, db) {
  const rowFor = (req, edit = false) => {
    const r = db
      .prepare("SELECT * FROM activities WHERE id=?")
      .get(Number(req.params.id));
    assertRead(db, req.user, r);
    if (edit && !canEdit(req.user, r)) throw httpError(403, "ไม่มีสิทธิ์แก้ไข");
    return r;
  };
  const requireHead = (user, row) => {
    if (!manages(user, row) && !user.roles.includes("executive"))
      throw httpError(403, "เฉพาะหัวหน้าที่รับผิดชอบ");
  };
  app.get("/api/admin/organization-history", admin, (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT * FROM organization_history ORDER BY id DESC LIMIT 200",
        )
        .all()
        .map((h) => ({ ...h, payload: JSON.parse(h.payload) })),
    }),
  );
  app.get("/api/scope/settings", (req, res) => res.json(scopeSettings(db)));
  app.put("/api/scope/settings", admin, (req, res) => {
    const s = z
      .object({
        reminders_enabled: z.boolean(),
        summaries_enabled: z.boolean(),
        skip_weekends: z.boolean(),
        holidays: z.array(date).max(366),
        escalate_after_days: z.number().int().min(1).max(90),
        escalate_executive_after_days: z.number().int().min(1).max(180),
        line_reply_enabled: z.boolean(),
        line_reminders_enabled: z.boolean(),
        ai_min_confidence: z.number().min(0).max(1),
        retention_days: z.number().int().min(30).max(36500).nullable(),
        retention_enabled: z.boolean(),
      })
      .parse(req.body);
    if (s.escalate_executive_after_days < s.escalate_after_days)
      throw httpError(400, "วันแจ้งผู้บริหารต้องไม่น้อยกว่าวันแจ้งหัวหน้า");
    if (s.retention_enabled && !s.retention_days)
      throw httpError(400, "กำหนดอายุข้อมูลก่อนเปิดลบอัตโนมัติ");
    const before = scopeSettings(db);
    transaction(db, () => {
      for (const [k, v] of Object.entries(s))
        db.prepare("UPDATE scope_settings SET value=? WHERE key=?").run(
          JSON.stringify(v),
          k,
        );
      writeAudit(
        db,
        req.user,
        "แก้ค่ามาตรฐานสำนัก",
        "scope_settings",
        null,
        before,
        s,
      );
    });
    res.json(s);
  });
  app.post("/api/activities/:id/owner-confirm", (req, res) => {
    const a = rowFor(req);
    assertUnlocked(db, req.user, a);
    if (
      a.owner_id !== req.user.id ||
      a.status !== "ready" ||
      req.body.version !== a.version
    )
      throw httpError(
        409,
        "เฉพาะเจ้าของยืนยันตัวเลขของรายงานฉบับปัจจุบันที่พร้อมสรุป",
      );
    db.prepare(
      "UPDATE activities SET owner_confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
    ).run(a.id);
    writeAudit(
      db,
      req.user,
      "เจ้าของยืนยันข้อเท็จจริงและตัวเลข",
      "activity",
      a.id,
      null,
      { version: a.version },
    );
    res.json({ ok: true });
  });
  app.get("/api/people", (req, res) => {
    const q = String(req.query.q || "")
      .trim()
      .slice(0, 100);
    if (q.length >= 2) {
      return res.json({
        items: db
          .prepare(
            "SELECT id,name,unit_id,work_id,position,personnel_type FROM users WHERE active=1 AND name LIKE ? ORDER BY name LIMIT 30",
          )
          .all("%" + q + "%"),
      });
    }
    const unit = Number(req.query.unit || req.user.unit_id);
    if (
      !req.user.roles.includes("executive") &&
      !req.user.roles.includes("admin") &&
      unit !== req.user.unit_id &&
      !req.user.scopes.includes(unit)
    )
      throw httpError(403, "ไม่มีสิทธิ์ดูบุคลากรหน่วยนี้");
    res.json({
      items: db
        .prepare(
          "SELECT id,name,unit_id,work_id,position,personnel_type FROM users WHERE active=1 AND unit_id=? ORDER BY name",
        )
        .all(unit),
    });
  });
  app.get("/api/personnel/:id/history", (req, res) => {
    const uid = Number(req.params.id),
      target = db.prepare("SELECT * FROM users WHERE id=?").get(uid);
    if (!target) throw httpError(404, "ไม่พบผู้ใช้");
    if (
      uid !== req.user.id &&
      !req.user.roles.includes("admin") &&
      !req.user.roles.includes("executive") &&
      !manages(req.user, target)
    )
      throw httpError(403, "ไม่มีสิทธิ์");
    res.json({
      items: db
        .prepare(
          "SELECT h.*,u.name unit_name,w.name work_name FROM personnel_history h LEFT JOIN units u ON u.id=h.unit_id LEFT JOIN works w ON w.id=h.work_id WHERE user_id=? ORDER BY effective_at DESC,id DESC",
        )
        .all(uid),
    });
  });
  app.get("/api/activities/:id/team", (req, res) => {
    const r = rowFor(req);
    res.json({
      people: db
        .prepare(
          "SELECT p.*,u.name FROM activity_people p JOIN users u ON u.id=p.user_id WHERE activity_id=?",
        )
        .all(r.id),
      units: db
        .prepare(
          "SELECT au.unit_id,u.name FROM activity_units au JOIN units u ON u.id=au.unit_id WHERE activity_id=?",
        )
        .all(r.id),
    });
  });
  app.put("/api/activities/:id/team", (req, res) => {
    const input = z
      .object({
        version: id,
        people: z.array(z.object({ user_id: id, work_role: text })).max(100),
        units: z.array(id).max(30),
      })
      .parse(req.body);
    const r = rowFor(req, true);
    assertUnlocked(db, req.user, r);
    if (r.version !== input.version) throw httpError(409, "ข้อมูลเปลี่ยนแล้ว");
    for (const p of input.people)
      if (
        !db
          .prepare("SELECT id FROM users WHERE id=? AND active=1")
          .get(p.user_id)
      )
        throw httpError(400, "ผู้ร่วมงานไม่พร้อมใช้งาน");
    for (const unit of input.units)
      if (
        !db
          .prepare(
            "SELECT id FROM units WHERE id=? AND active=1 AND kind!='section'",
          )
          .get(unit)
      )
        throw httpError(400, "หน่วยร่วมไม่พร้อมใช้งาน");
    transaction(db, () => {
      const previous = db
        .prepare("SELECT * FROM activity_people WHERE activity_id=?")
        .all(r.id);
      db.prepare("DELETE FROM activity_people WHERE activity_id=?").run(r.id);
      for (const p of input.people) {
        const old = previous.find(
          (x) => x.user_id === p.user_id && x.work_role === p.work_role,
        );
        db.prepare("INSERT INTO activity_people VALUES(?,?,?,?)").run(
          r.id,
          p.user_id,
          p.work_role,
          old?.confirmed_at || null,
        );
      }
      db.prepare("DELETE FROM activity_units WHERE activity_id=?").run(r.id);
      for (const unit of new Set(input.units))
        db.prepare("INSERT INTO activity_units VALUES(?,?)").run(r.id, unit);
      db.prepare("UPDATE activities SET version=version+1 WHERE id=?").run(
        r.id,
      );
      writeAudit(
        db,
        req.user,
        "กำหนดผู้ร่วมงานและหน่วยร่วม",
        "activity",
        r.id,
        { people: previous },
        input,
      );
    });
    res.json({ version: r.version + 1 });
  });
  app.post("/api/activities/:id/team/confirm", (req, res) => {
    const r = rowFor(req);
    assertUnlocked(db, req.user, r);
    if (
      !db
        .prepare(
          "SELECT 1 FROM activity_people WHERE activity_id=? AND user_id=?",
        )
        .get(r.id, req.user.id)
    )
      throw httpError(403, "ไม่มีชื่อเป็นผู้ร่วมงาน");
    db.prepare(
      "UPDATE activity_people SET confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE activity_id=? AND user_id=?",
    ).run(r.id, req.user.id);
    writeAudit(
      db,
      req.user,
      "ยืนยันบทบาทผู้ปฏิบัติงาน",
      "activity",
      r.id,
      null,
      { user_id: req.user.id },
    );
    res.json({ ok: true });
  });
  app.get("/api/period-locks", (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT l.*,u.name unit_name FROM period_locks l JOIN units u ON u.id=l.unit_id ORDER BY l.id DESC",
        )
        .all()
        .filter(
          (r) =>
            req.user.roles.includes("executive") ||
            r.unit_id === req.user.unit_id ||
            manages(req.user, r),
        ),
    }),
  );
  app.post("/api/period-locks", (req, res) => {
    const input = z
      .object({ unit_id: id, date_from: date, date_to: date, reason: text })
      .parse(req.body);
    requireHead(req.user, input);
    if (input.date_from > input.date_to)
      throw httpError(400, "ช่วงเวลาไม่ถูกต้อง");
    const key = Number(
      db
        .prepare(
          "INSERT INTO period_locks(unit_id,date_from,date_to,reason,created_by) VALUES(?,?,?,?,?)",
        )
        .run(
          input.unit_id,
          input.date_from,
          input.date_to,
          input.reason,
          req.user.id,
        ).lastInsertRowid,
    );
    writeAudit(db, req.user, "ปิดรอบรายงาน", "period_lock", key, null, input);
    res.status(201).json({ id: key });
  });
  app.post("/api/activities/:id/amendments", (req, res) => {
    const r = rowFor(req),
      reason = text.parse(req.body.reason);
    if (!canEdit(req.user, r) || !lockFor(db, r))
      throw httpError(400, "ขอได้เฉพาะรายงานที่มีสิทธิ์แก้และปิดรอบแล้ว");
    const key = Number(
      db
        .prepare(
          "INSERT INTO amendment_requests(activity_id,requested_by,reason) VALUES(?,?,?)",
        )
        .run(r.id, req.user.id, reason).lastInsertRowid,
    );
    res.status(201).json({ id: key });
  });
  app.get("/api/amendments", (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT ar.*,a.title,a.unit_id,a.work_id,u.name requester_name FROM amendment_requests ar JOIN activities a ON a.id=ar.activity_id JOIN users u ON u.id=ar.requested_by ORDER BY ar.id DESC",
        )
        .all()
        .filter(
          (r) =>
            r.requested_by === req.user.id ||
            manages(req.user, r) ||
            req.user.roles.includes("executive"),
        ),
    }),
  );
  app.post("/api/amendments/:id/resolve", (req, res) => {
    const input = z
        .object({ approve: z.boolean(), reason: text })
        .parse(req.body),
      r = db
        .prepare(
          "SELECT ar.*,a.unit_id,a.work_id FROM amendment_requests ar JOIN activities a ON a.id=ar.activity_id WHERE ar.id=?",
        )
        .get(Number(req.params.id));
    if (!r || r.status !== "pending")
      throw httpError(409, "คำขอไม่อยู่ระหว่างพิจารณา");
    requireHead(req.user, r);
    if (r.requested_by === req.user.id)
      throw httpError(403, "ให้หัวหน้าคนอื่นพิจารณาคำขอของตน");
    transaction(db, () => {
      db.prepare(
        "UPDATE amendment_requests SET status=?,resolution=?,resolved_by=?,resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      ).run(
        input.approve ? "approved" : "rejected",
        input.reason,
        req.user.id,
        r.id,
      );
      if (input.approve)
        db.prepare(
          "INSERT INTO amendment_grants VALUES(?,?,?) ON CONFLICT(activity_id,user_id) DO UPDATE SET expires_at=excluded.expires_at",
        ).run(
          r.activity_id,
          r.requested_by,
          new Date(Date.now() + 86400000).toISOString(),
        );
      writeAudit(
        db,
        req.user,
        "พิจารณาขอแก้รายงานหลังปิดรอบ",
        "activity",
        r.activity_id,
        r,
        input,
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/delegations", (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT d.*,a.name grantor_name,b.name grantee_name FROM delegation_grants d JOIN users a ON a.id=d.grantor_id JOIN users b ON b.id=d.grantee_id ORDER BY d.id DESC",
        )
        .all()
        .filter(
          (d) =>
            d.grantor_id === req.user.id ||
            d.grantee_id === req.user.id ||
            req.user.roles.includes("admin"),
        ),
    }),
  );
  app.post("/api/delegations", (req, res) => {
    const input = z
      .object({
        grantee_id: id,
        unit_id: id.nullable(),
        work_id: id.nullable(),
        starts_at: z.string().datetime(),
        ends_at: z.string().datetime(),
        reason: text,
      })
      .parse(req.body);
    if (
      input.starts_at >= input.ends_at ||
      input.grantee_id === req.user.id ||
      !db
        .prepare("SELECT id FROM users WHERE id=? AND active=1")
        .get(input.grantee_id)
    )
      throw httpError(400, "ผู้รับมอบหรือช่วงเวลาไม่ถูกต้อง");
    if (input.unit_id) {
      if (
        !req.user.roles.includes("head") ||
        !req.user.scopes.includes(input.unit_id)
      )
        throw httpError(403, "มอบอำนาจได้เฉพาะหน่วยงานของตน");
    } else if (
      !input.work_id ||
      !req.user.roles.includes("center_head") ||
      !req.user.work_scopes.includes(input.work_id)
    )
      throw httpError(403, "มอบอำนาจได้เฉพาะศูนย์ของตน");
    const key = Number(
      db
        .prepare(
          "INSERT INTO delegation_grants(grantor_id,grantee_id,unit_id,work_id,starts_at,ends_at,reason) VALUES(?,?,?,?,?,?,?)",
        )
        .run(
          req.user.id,
          input.grantee_id,
          input.unit_id,
          input.work_id,
          input.starts_at,
          input.ends_at,
          input.reason,
        ).lastInsertRowid,
    );
    writeAudit(
      db,
      req.user,
      "มอบอำนาจชั่วคราว",
      "delegation",
      key,
      null,
      input,
    );
    res.status(201).json({ id: key });
  });
  app.post("/api/delegations/:id/revoke", (req, res) => {
    const r = db
      .prepare("SELECT * FROM delegation_grants WHERE id=?")
      .get(Number(req.params.id));
    if (
      !r ||
      (r.grantor_id !== req.user.id && !req.user.roles.includes("admin"))
    )
      throw httpError(403, "ไม่มีสิทธิ์ยกเลิก");
    db.prepare("UPDATE delegation_grants SET revoked=1 WHERE id=?").run(r.id);
    writeAudit(db, req.user, "ยกเลิกมอบอำนาจ", "delegation", r.id, r, {
      revoked: true,
    });
    res.json({ ok: true });
  });
  app.get("/api/notifications", (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 100",
        )
        .all(req.user.id),
    }),
  );
  app.post("/api/notifications/:id/read", (req, res) => {
    db.prepare(
      "UPDATE notifications SET read_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=?",
    ).run(Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });
  app.get("/api/preferences", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT reminder_time,channel FROM personal_preferences WHERE user_id=?",
        )
        .get(req.user.id) || { reminder_time: "09:00", channel: "web" },
    ),
  );
  app.put("/api/preferences", (req, res) => {
    const p = z
      .object({
        reminder_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        channel: z.enum(["web", "line"]),
      })
      .parse(req.body);
    db.prepare(
      "INSERT INTO personal_preferences VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET reminder_time=excluded.reminder_time,channel=excluded.channel",
    ).run(req.user.id, p.reminder_time, p.channel);
    res.json(p);
  });
  app.get("/api/scheduled-summaries", (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT id,schedule_key,created_at FROM scheduled_summaries WHERE user_id=? ORDER BY id DESC",
        )
        .all(req.user.id),
    }),
  );
  app.get("/api/scheduled-summaries/:id", (req, res) => {
    const r = db
      .prepare("SELECT * FROM scheduled_summaries WHERE id=? AND user_id=?")
      .get(Number(req.params.id), req.user.id);
    if (!r) throw httpError(404, "ไม่พบฉบับสรุป");
    const payload = JSON.parse(r.payload);
    for (const row of payload.rows || []) assertRead(db, req.user, row);
    res.json({ ...r, payload });
  });
}
