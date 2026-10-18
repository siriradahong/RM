import { draftWithAI } from "./ai-provider.js";
import { redactForNews } from "./privacy.js";
import { z } from "zod";
import { canEdit, httpError } from "./security.js";
import { assertRead } from "./access.js";
import { writeAudit } from "./db.js";
export function registerNewsQueue(app, db) {
  app.post("/api/activities/:id/news-ai-draft", async (req, res) => {
    if (!req.user.roles.includes("pr"))
      throw httpError(403, "เฉพาะประชาสัมพันธ์");
    const a = db
      .prepare("SELECT * FROM activities WHERE id=?")
      .get(Number(req.params.id));
    assertRead(db, req.user, a);
    if (a.status !== "ready" || a.duplicate_of)
      throw httpError(400, "รายงานยังไม่พร้อม");
    res.json(
      await draftWithAI({
        rows: [
          {
            id: a.id,
            title: redactForNews(a.title),
            date: a.date,
            result: redactForNews(a.result),
          },
        ],
        metrics: JSON.parse(a.metrics),
        template: {
          config: {
            headings: {
              summary: "เนื้อหาข่าวประชาสัมพันธ์",
              problems: "จุดที่ต้องตรวจ",
              next_steps: "ข้อมูลที่ขาด",
            },
          },
        },
      }),
    );
  });
  app.get("/api/activities/:id/news-preview", (req, res) => {
    if (!req.user.roles.includes("pr"))
      throw httpError(403, "เฉพาะประชาสัมพันธ์");
    const a = db
      .prepare("SELECT * FROM activities WHERE id=?")
      .get(Number(req.params.id));
    assertRead(db, req.user, a);
    res.json({
      title: redactForNews(a.title),
      body: redactForNews(a.result || a.source_text),
      note: "ปิดตัวระบุบุคคลตามรูปแบบที่ตรวจพบแล้ว ยังต้องตรวจเนื้อหาและภาพก่อนเผยแพร่",
    });
  });
  app.get("/api/news-candidates", (req, res) => {
    if (!req.user.roles.includes("pr"))
      throw httpError(403, "เฉพาะประชาสัมพันธ์");
    res.json({
      items: db
        .prepare(
          "SELECT c.*,a.title,a.date,a.status,a.unit_id,u.name unit_name,o.name owner_name FROM news_candidates c JOIN activities a ON a.id=c.activity_id JOIN units u ON u.id=a.unit_id JOIN users o ON o.id=c.requested_by WHERE c.state IN ('requested','in_review') AND a.duplicate_of IS NULL ORDER BY c.created_at DESC",
        )
        .all(),
    });
  });
  app.post("/api/activities/:id/news-candidate", (req, res) => {
    const a = db
      .prepare("SELECT * FROM activities WHERE id=?")
      .get(Number(req.params.id));
    assertRead(db, req.user, a);
    if (!canEdit(req.user, a) || a.status !== "ready" || a.duplicate_of)
      throw httpError(403, "ส่งข่าวได้จากรายงานที่มีสิทธิ์แก้และยืนยันแล้ว");
    db.prepare(
      "INSERT INTO news_candidates(activity_id,requested_by) VALUES(?,?) ON CONFLICT(activity_id) DO UPDATE SET state=CASE WHEN state='dismissed' THEN 'requested' ELSE state END,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
    ).run(a.id, req.user.id);
    writeAudit(
      db,
      req.user,
      "เสนอรายงานให้ประชาสัมพันธ์",
      "activity",
      a.id,
      null,
      { requested: true },
    );
    res.json({ ok: true });
  });
  app.post("/api/news-candidates/:id/dismiss", (req, res) => {
    if (!req.user.roles.includes("pr"))
      throw httpError(403, "เฉพาะประชาสัมพันธ์");
    const reason = z.string().trim().min(1).max(2000).parse(req.body.reason);
    db.prepare(
      "UPDATE news_candidates SET state='dismissed',note=? WHERE activity_id=?",
    ).run(reason, Number(req.params.id));
    writeAudit(
      db,
      req.user,
      "พักเรื่องเสนอข่าว",
      "activity",
      Number(req.params.id),
      null,
      { reason },
    );
    res.json({ ok: true });
  });
}
