import express from "express";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { httpError } from "./security.js";
import { newsSchema } from "./validation.js";
import { transaction, writeAudit } from "./db.js";

function newsRow(row) {
  return row ? { ...row, image_ids: JSON.parse(row.image_ids) } : null;
}
const newsSelect = `SELECT n.*,COALESCE(n.activity_date,a.date) AS date,COALESCE(n.activity_area,a.area) AS area,COALESCE(n.publication_unit_id,a.unit_id) AS unit_id,COALESCE(n.publication_unit_name,u.name) AS unit_name,a.title AS activity_title FROM news n JOIN activities a ON a.id=n.activity_id JOIN units u ON u.id=a.unit_id`;
export function registerNewsRoutes(app, db) {
  app.get("/api/news", (req, res) => {
    const params = [],
      where = [];
    if (!req.user.roles.includes("pr") || req.query.feed === "1")
      where.push("n.status='published'");
    else if (req.query.status) {
      where.push("n.status=?");
      params.push(req.query.status);
    }
    if (req.query.unit) {
      where.push("COALESCE(n.publication_unit_id,a.unit_id)=?");
      params.push(Number(req.query.unit));
    }
    if (req.query.from) {
      where.push("COALESCE(n.activity_date,a.date)>=?");
      params.push(req.query.from);
    }
    if (req.query.to) {
      where.push("COALESCE(n.activity_date,a.date)<=?");
      params.push(req.query.to);
    }
    const page = Math.min(
        1000000,
        Math.max(1, Math.trunc(Number(req.query.page)) || 1),
      ),
      limit = 12,
      filter = where.length ? " WHERE " + where.join(" AND ") : "";
    res.json({
      items: db
        .prepare(`${newsSelect}${filter} ORDER BY n.id DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, (page - 1) * limit)
        .map(newsRow),
      total: db
        .prepare(`SELECT count(*) count FROM (${newsSelect}${filter})`)
        .get(...params).count,
      page,
      limit,
    });
  });
  app.get("/api/news/:id", (req, res) => {
    const row = db
      .prepare(`${newsSelect} WHERE n.id=?`)
      .get(Number(req.params.id));
    if (!row || (row.status !== "published" && !req.user.roles.includes("pr")))
      throw httpError(404, "ไม่พบข่าว");
    res.json(newsRow(row));
  });
  const pr = (req, res, next) =>
    req.user.roles.includes("pr")
      ? next()
      : next(httpError(403, "เฉพาะเจ้าหน้าที่ประชาสัมพันธ์"));
  function save(req, res) {
    const input = newsSchema.parse(req.body),
      old = req.params.id
        ? db.prepare("SELECT * FROM news WHERE id=?").get(Number(req.params.id))
        : null;
    if (req.params.id && !old) throw httpError(404, "ไม่พบข่าว");
    if (old?.status === "published")
      throw httpError(409, "ข่าวเผยแพร่แล้ว ไม่สามารถแก้ไขฉบับที่เผยแพร่");
    if (old && input.version !== old.version)
      throw httpError(409, "ข่าวถูกแก้ไขแล้ว กรุณาโหลดใหม่");
    const a = db
      .prepare("SELECT * FROM activities WHERE id=? AND status='ready'")
      .get(input.activity_id);
    if (!a) throw httpError(400, "กรุณาเลือกรายงานที่พร้อมสรุป");
    for (const id of input.image_ids) {
      const f = db
        .prepare("SELECT * FROM files WHERE id=? AND activity_id=?")
        .get(id, a.id);
      if (!f || !f.mime.startsWith("image/"))
        throw httpError(400, "รูปภาพต้องเป็นหลักฐานจากรายงานต้นทาง");
    }
    if (input.cover_id && !input.image_ids.includes(input.cover_id))
      throw httpError(400, "รูปปกต้องอยู่ในรูปภาพที่เลือก");
    const out = transaction(db, () => {
      let id;
      if (old) {
        db.prepare(
          "UPDATE news SET activity_id=?,title=?,body=?,image_ids=?,cover_id=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        ).run(
          input.activity_id,
          input.title,
          input.body,
          JSON.stringify(input.image_ids),
          input.cover_id,
          old.id,
        );
        id = old.id;
      } else
        id = Number(
          db
            .prepare(
              "INSERT INTO news(activity_id,title,body,image_ids,cover_id,status,author_id) VALUES(?,?,?,?,?,'draft',?)",
            )
            .run(
              input.activity_id,
              input.title,
              input.body,
              JSON.stringify(input.image_ids),
              input.cover_id,
              req.user.id,
            ).lastInsertRowid,
        );
      const row = db.prepare("SELECT * FROM news WHERE id=?").get(id);
      writeAudit(db, req.user, "บันทึกฉบับร่างข่าว", "news", id, old, row);
      return row;
    });
    res.status(old ? 200 : 201).json(newsRow(out));
  }
  app.post("/api/news", pr, save);
  app.put("/api/news/:id", pr, save);
  app.post("/api/news/:id/publish", pr, (req, res) => {
    const row = db
      .prepare("SELECT * FROM news WHERE id=?")
      .get(Number(req.params.id));
    if (!row) throw httpError(404, "ไม่พบข่าว");
    if (row.status === "published") return res.json(newsRow(row));
    if (req.body.version !== row.version)
      throw httpError(409, "ข่าวถูกแก้ไขแล้ว กรุณาดู Preview ใหม่");
    const source = db
      .prepare(
        "SELECT a.*,u.name AS unit_name FROM activities a JOIN units u ON u.id=a.unit_id WHERE a.id=? AND a.status='ready'",
      )
      .get(row.activity_id);
    if (!source) throw httpError(400, "รายงานต้นทางยังไม่พร้อมสรุป");
    const out = transaction(db, () => {
      db.prepare(
        "UPDATE news SET status='published',published_by=?,published_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1,activity_date=?,activity_area=?,publication_unit_id=?,publication_unit_name=? WHERE id=?",
      ).run(
        req.user.id,
        source.date,
        source.area,
        source.unit_id,
        source.unit_name,
        row.id,
      );
      const out = db.prepare("SELECT * FROM news WHERE id=?").get(row.id);
      writeAudit(db, req.user, "ยืนยันเผยแพร่ข่าว", "news", row.id, row, out);
      return out;
    });
    res.json(newsRow(out));
  });
  app.post("/api/news/:id/send-line", pr, async (req, res) => {
    const row = db
      .prepare("SELECT * FROM news WHERE id=? AND status='published'")
      .get(Number(req.params.id));
    if (!row) throw httpError(400, "ข่าวต้องเผยแพร่แล้วก่อนส่ง LINE");
    if (row.line_status === "sent") return res.json(newsRow(row));
    if (
      !process.env.LINE_CHANNEL_ACCESS_TOKEN ||
      !process.env.LINE_NEWS_GROUP_ID
    )
      throw httpError(503, "ยังไม่ได้ตั้งค่าการเชื่อมต่อ LINE");
    const retryKey = row.line_retry_key || randomUUID();
    db.prepare("UPDATE news SET line_retry_key=?,line_status=? WHERE id=?").run(
      retryKey,
      "sending",
      row.id,
    );
    try {
      const response = await fetch("https://api.line.me/v2/bot/message/push", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "X-Line-Retry-Key": retryKey,
        },
        body: JSON.stringify({
          to: process.env.LINE_NEWS_GROUP_ID,
          messages: [
            {
              type: "text",
              text: (row.title + "\n\n" + row.body).slice(0, 5000),
            },
          ],
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (
        !response.ok &&
        !(
          response.status === 409 &&
          response.headers.get("x-line-accepted-request-id")
        )
      )
        throw new Error(`LINE HTTP ${response.status}`);
      db.prepare(
        "UPDATE news SET line_status='sent',line_error=NULL,line_sent_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      ).run(row.id);
      writeAudit(db, req.user, "ส่งข่าว LINE", "news", row.id, null, {
        status: "accepted",
      });
    } catch (e) {
      db.prepare(
        "UPDATE news SET line_status='failed',line_error=? WHERE id=?",
      ).run(e.message, row.id);
      throw httpError(502, "ส่ง LINE ไม่สำเร็จ สามารถลองใหม่ได้");
    }
    res.json(newsRow(db.prepare("SELECT * FROM news WHERE id=?").get(row.id)));
  });
}
export function registerLineWebhook(app, db, dataDir) {
  app.post(
    "/api/line/webhook",
    express.raw({ type: "application/json", limit: "1mb" }),
    (req, res, next) => {
      try {
        if (
          !process.env.LINE_CHANNEL_SECRET ||
          !process.env.LINE_REPORT_GROUP_ID
        )
          throw httpError(503, "LINE is not configured");
        const received = Buffer.from(
            req.headers["x-line-signature"] || "",
            "base64",
          ),
          expected = createHmac("sha256", process.env.LINE_CHANNEL_SECRET)
            .update(req.body || Buffer.alloc(0))
            .digest();
        if (
          received.length !== expected.length ||
          !timingSafeEqual(received, expected)
        )
          throw httpError(401, "Invalid LINE signature");
        const payload = JSON.parse(req.body.toString("utf8"));
        if (!Array.isArray(payload.events))
          throw httpError(400, "Invalid webhook payload");
        for (const event of payload.events) {
          if (
            event.type !== "message" ||
            event.source?.groupId !== process.env.LINE_REPORT_GROUP_ID ||
            !event.source?.userId ||
            !event.webhookEventId
          )
            continue;
          const owner = db
            .prepare("SELECT id FROM users WHERE line_user_id=? AND active=1")
            .get(event.source.userId);
          db.prepare(
            "INSERT OR IGNORE INTO inbox(event_id,line_user_id,owner_id,group_id,kind,text,message_id,received_at) VALUES(?,?,?,?,?,?,?,?)",
          ).run(
            event.webhookEventId,
            event.source.userId,
            owner?.id || null,
            event.source.groupId,
            event.message.type,
            event.message.text || event.message.fileName || "",
            event.message.id || null,
            new Date(event.timestamp).toISOString(),
          );
        }
        res.json({ ok: true });
      } catch (e) {
        next(e instanceof SyntaxError ? httpError(400, "Invalid JSON") : e);
      }
    },
  );
  // Download is explicit, retriable, and authenticated. Webhook acknowledgements never wait for media transfer.
  app.post("/api/inbox/:id/download", async (req, res, next) => {
    // Registered before auth routes; delegate to the protected handler registered below.
    next();
  });
}
export async function downloadLineMedia(db, dataDir, row, user) {
  if (row.file_id) return { id: row.file_id };
  if (
    !["image", "file"].includes(row.kind) ||
    !row.message_id ||
    !/^\d+$/.test(row.message_id)
  )
    throw httpError(400, "ข้อความนี้ไม่มีไฟล์ที่ดาวน์โหลดได้");
  if (!process.env.LINE_CHANNEL_ACCESS_TOKEN)
    throw httpError(503, "ยังไม่ได้ตั้งค่า LINE access token");
  const response = await fetch(
    `https://api-data.line.me/v2/bot/message/${row.message_id}/content`,
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      signal: AbortSignal.timeout(20000),
    },
  );
  if (!response.ok) throw httpError(502, "ไม่สามารถดาวน์โหลดไฟล์จาก LINE ได้");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 20 * 1024 * 1024) {
      await response.body.cancel().catch(() => {});
      throw httpError(413, "ไฟล์เกิน 20 MB");
    }
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks),
    type = await fileTypeFromBuffer(buffer);
  if (
    !type ||
    ![
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].includes(type.mime)
  )
    throw httpError(415, "ไม่รองรับไฟล์นี้");
  const owner = db.prepare("SELECT * FROM users WHERE id=?").get(row.owner_id);
  if (!owner?.unit_id)
    throw httpError(400, "กรุณาผูกผู้รายงานกับบัญชีและหน่วยงานก่อน");
  const name = `${randomUUID()}.${type.ext}`;
  await writeFile(resolve(dataDir, "uploads", name), buffer, { mode: 0o600 });
  try {
    return transaction(db, () => {
      const current = db
        .prepare("SELECT file_id FROM inbox WHERE id=?")
        .get(row.id);
      if (current.file_id) throw httpError(409, "มีผู้ดาวน์โหลดไฟล์นี้แล้ว");
      const id = Number(
        db
          .prepare(
            "INSERT INTO files(original_name,storage_name,mime,size,title,purpose,unit_id,owner_id,activity_id) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            row.kind === "file"
              ? row.text
              : `LINE-${row.message_id}.${type.ext}`,
            name,
            type.mime,
            size,
            row.text || "รูปภาพจาก LINE",
            "evidence",
            owner.unit_id,
            owner.id,
            row.activity_id,
          ).lastInsertRowid,
      );
      db.prepare("UPDATE inbox SET file_id=?,error=NULL WHERE id=?").run(
        id,
        row.id,
      );
      writeAudit(db, user, "ดาวน์โหลดหลักฐาน LINE", "file", id, null, {
        message_id: row.message_id,
      });
      return { id };
    });
  } catch (e) {
    await unlink(resolve(dataDir, "uploads", name));
    throw e;
  }
}
