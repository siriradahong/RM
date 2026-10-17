import { z } from "zod";
import { canEdit, isHeadForUnit, httpError } from "./security.js";
import { transaction, writeAudit } from "./db.js";
import { settings } from "./insights.js";

export function registerCommunity(app, db) {
  function published(id) {
    const n = db
      .prepare("SELECT id FROM news WHERE id=? AND status='published'")
      .get(id);
    if (!n) throw httpError(404, "ไม่พบข่าวที่เผยแพร่");
  }
  app.get("/api/news/:id/discussion", (req, res) => {
    const id = Number(req.params.id);
    published(id);
    res.json({
      likes: db
        .prepare("SELECT COUNT(*) n FROM news_likes WHERE news_id=?")
        .get(id).n,
      liked: !!db
        .prepare("SELECT 1 FROM news_likes WHERE news_id=? AND user_id=?")
        .get(id, req.user.id),
      comments: db
        .prepare(
          "SELECT c.id,c.body,c.created_at,c.user_id,u.name author FROM news_comments c JOIN users u ON u.id=c.user_id WHERE c.news_id=? ORDER BY c.id DESC LIMIT 100",
        )
        .all(id)
        .reverse()
        .map((c) => ({
          ...c,
          can_delete:
            c.user_id === req.user.id || req.user.roles.includes("pr"),
        })),
    });
  });
  app.put("/api/news/:id/like", (req, res) => {
    const id = Number(req.params.id);
    published(id);
    const liked = z.boolean().parse(req.body.liked);
    if (liked)
      db.prepare(
        "INSERT OR IGNORE INTO news_likes(news_id,user_id) VALUES(?,?)",
      ).run(id, req.user.id);
    else
      db.prepare("DELETE FROM news_likes WHERE news_id=? AND user_id=?").run(
        id,
        req.user.id,
      );
    res.json({ liked });
  });
  app.post("/api/news/:id/comments", (req, res) => {
    const id = Number(req.params.id);
    published(id);
    const body = z.string().trim().min(1).max(2000).parse(req.body.body);
    const comment = Number(
      db
        .prepare(
          "INSERT INTO news_comments(news_id,user_id,body) VALUES(?,?,?)",
        )
        .run(id, req.user.id, body).lastInsertRowid,
    );
    res.status(201).json({ id: comment });
  });
  app.delete("/api/news-comments/:id", (req, res) => {
    const c = db
      .prepare("SELECT * FROM news_comments WHERE id=?")
      .get(Number(req.params.id));
    if (!c) throw httpError(404, "ไม่พบความคิดเห็น");
    published(c.news_id);
    if (c.user_id !== req.user.id && !req.user.roles.includes("pr"))
      throw httpError(403, "ลบได้เฉพาะความคิดเห็นของตนเองหรือประชาสัมพันธ์");
    transaction(db, () => {
      db.prepare("DELETE FROM news_comments WHERE id=?").run(c.id);
      writeAudit(db, req.user, "ลบความคิดเห็น", "news_comment", c.id, c, null);
    });
    res.json({ ok: true });
  });
  app.get("/api/activity-calendar", (req, res) => {
    const month = z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .parse(req.query.month);
    const clauses = ["a.date LIKE ?", "a.duplicate_of IS NULL"],
      args = [month + "-%"];
    if (req.query.unit) {
      clauses.push("a.unit_id=?");
      args.push(z.coerce.number().int().positive().parse(req.query.unit));
    }
    if (req.query.mine === "1") {
      clauses.push("a.owner_id=?");
      args.push(req.user.id);
    }
    res.json(
      db
        .prepare(
          `SELECT a.id,a.title,a.date,a.status,a.area,u.name unit_name,o.name owner_name FROM activities a JOIN units u ON u.id=a.unit_id JOIN users o ON o.id=a.owner_id WHERE ${clauses.join(" AND ")} ORDER BY a.date,a.id`,
        )
        .all(...args),
    );
  });
  app.post("/api/activities/:id/amendment-requests", (req, res) => {
    const a = db
      .prepare("SELECT * FROM activities WHERE id=?")
      .get(Number(req.params.id));
    if (!a) throw httpError(404, "ไม่พบรายงาน");
    if (!canEdit(req.user, a))
      throw httpError(403, "ขอแก้ไขได้เฉพาะรายการที่ตนมีสิทธิ์");
    const reason = z.string().trim().min(5).max(2000).parse(req.body.reason);
    if (
      !a.date ||
      !db
        .prepare(
          "SELECT id FROM period_locks WHERE unit_id=? AND active=1 AND date_from<=? AND date_to>=?",
        )
        .get(a.unit_id, a.date, a.date)
    )
      throw httpError(409, "รายงานไม่ได้อยู่ในรอบที่ปิด สามารถแก้ไขตามสิทธิ์");
    if (
      db
        .prepare(
          "SELECT id FROM amendment_requests WHERE activity_id=? AND requested_by=? AND status='pending'",
        )
        .get(a.id, req.user.id)
    )
      throw httpError(409, "มีคำขอที่รอพิจารณาแล้ว");
    const id = transaction(db, () => {
      const id = Number(
        db
          .prepare(
            "INSERT INTO amendment_requests(activity_id,requested_by,reason) VALUES(?,?,?)",
          )
          .run(a.id, req.user.id, reason).lastInsertRowid,
      );
      writeAudit(
        db,
        req.user,
        "ขอเปิดรอบแก้ไขรายงาน",
        "amendment_request",
        id,
        null,
        { activity_id: a.id, reason },
      );
      return id;
    });
    res.status(201).json({ id });
  });
  app.get("/api/amendment-requests", (req, res) => {
    res.json(
      db
        .prepare(
          "SELECT r.*,a.title,a.unit_id,a.date,u.name requester FROM amendment_requests r JOIN activities a ON a.id=r.activity_id JOIN users u ON u.id=r.requested_by ORDER BY r.id DESC",
        )
        .all()
        .filter(
          (r) =>
            r.requested_by === req.user.id ||
            isHeadForUnit(req.user, r.unit_id),
        ),
    );
  });
  app.post("/api/amendment-requests/:id/resolve", (req, res) => {
    const v = z
      .object({
        decision: z.enum(["approve", "reject"]),
        reason: z.string().trim().min(5).max(2000),
      })
      .parse(req.body);
    const r = db
      .prepare(
        "SELECT r.*,a.unit_id,a.date FROM amendment_requests r JOIN activities a ON a.id=r.activity_id WHERE r.id=?",
      )
      .get(Number(req.params.id));
    if (!r) throw httpError(404, "ไม่พบคำขอ");
    if (!isHeadForUnit(req.user, r.unit_id))
      throw httpError(403, "เฉพาะหัวหน้าที่ดูแลหน่วยนี้");
    if (r.status !== "pending") throw httpError(409, "คำขอถูกพิจารณาแล้ว");
    transaction(db, () => {
      if (v.decision === "approve") {
        // Reopens every overlapping period for this unit. Existing export snapshots stay immutable.
        const locks = db
          .prepare(
            "SELECT * FROM period_locks WHERE unit_id=? AND active=1 AND date_from<=? AND date_to>=?",
          )
          .all(r.unit_id, r.date, r.date);
        for (const lock of locks) {
          db.prepare("UPDATE period_locks SET active=0 WHERE id=?").run(
            lock.id,
          );
          writeAudit(
            db,
            req.user,
            "เปิดรอบตามคำขอแก้ไข",
            "period_lock",
            lock.id,
            lock,
            { active: 0, reason: v.reason, request_id: r.id },
          );
        }
      }
      db.prepare(
        "UPDATE amendment_requests SET status=?,resolution=?,resolved_by=? WHERE id=?",
      ).run(
        v.decision === "approve" ? "approved" : "rejected",
        v.reason,
        req.user.id,
        r.id,
      );
      writeAudit(
        db,
        req.user,
        "พิจารณาคำขอแก้ไข",
        "amendment_request",
        r.id,
        r,
        v,
      );
    });
    res.json({ ok: true });
  });
  app.get("/api/system-status", (req, res) => {
    if (!req.user.roles.includes("admin"))
      throw httpError(403, "เฉพาะผู้ดูแลระบบ");
    const accounts = db
      .prepare(
        "SELECT COUNT(*) total,SUM(active=1) active,SUM(active=1 AND line_user_id IS NOT NULL) linked FROM users",
      )
      .get();
    res.json({
      accounts,
      files: db
        .prepare("SELECT COUNT(*) count,COALESCE(SUM(size),0) bytes FROM files")
        .get(),
      jobs: db
        .prepare("SELECT state,COUNT(*) count FROM inbox_jobs GROUP BY state")
        .all(),
      database: "ok",
      line: {
        receiveConfigured: Boolean(
          process.env.LINE_CHANNEL_SECRET && process.env.LINE_REPORT_GROUP_ID,
        ),
        sendConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
        automatic: settings(db).line_reply_enabled,
      },
      model: process.env.OLLAMA_MODEL || null,
      documentReader: Boolean(process.env.DOCUMENT_PYTHON),
      scheduledReports: settings(db).scheduled_reports,
      latestExport:
        db
          .prepare(
            "SELECT created_at FROM report_exports ORDER BY id DESC LIMIT 1",
          )
          .get()?.created_at || null,
    });
  });
}
