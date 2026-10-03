import multer from "multer";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { activitySchema } from "./validation.js";
import {
  canEdit,
  canCreate,
  createWorkAssignment,
  isHeadForUnit,
  httpError,
} from "./security.js";
import { transaction, writeAudit } from "./db.js";
import { downloadLineMedia } from "./news-routes.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 10, fieldSize: 4000 },
});
const allowed = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/x-cfb",
]);
const pagination = (req) => ({
  page: Math.min(1000000, Math.max(1, Math.trunc(Number(req.query.page)) || 1)),
  limit: Math.min(100, Math.max(1, Math.trunc(Number(req.query.limit)) || 10)),
});
export function activity(db, row, user) {
  if (!row) return null;
  return {
    ...row,
    metrics: JSON.parse(row.metrics),
    can_edit: canEdit(user, row),
  };
}
const selectActivity = `SELECT a.*,u.name AS unit_name,c.name AS category_name,o.name AS owner_name,w.name AS work_name FROM activities a JOIN units u ON u.id=a.unit_id LEFT JOIN categories c ON c.id=a.category_id JOIN users o ON o.id=a.owner_id LEFT JOIN works w ON w.id=a.work_id`;
function whereFor(req, alias = "a") {
  const clauses = [],
    params = [];
  const add = (sql, v) => {
    clauses.push(sql);
    params.push(v);
  };
  if (req.query.work) add(`${alias}.work_id=?`, Number(req.query.work));
  if (req.query.unit) add(`${alias}.unit_id=?`, Number(req.query.unit));
  if (req.query.mine === "1") add(`${alias}.owner_id=?`, req.user.id);
  if (req.query.from)
    add(
      `COALESCE(${alias}.date,substr(${alias}.created_at,1,10))>=?`,
      req.query.from,
    );
  if (req.query.to)
    add(
      `COALESCE(${alias}.date,substr(${alias}.created_at,1,10))<=?`,
      req.query.to,
    );
  if (req.query.status) add(`${alias}.status=?`, req.query.status);
  if (req.query.category)
    add(`${alias}.category_id=?`, Number(req.query.category));
  if (req.query.source) add(`${alias}.source=?`, req.query.source);
  if (req.query.q) {
    clauses.push(
      `(${alias}.title LIKE ? OR ${alias}.area LIKE ? OR ${alias}.result LIKE ?)`,
    );
    params.push(...Array(3).fill(`%${String(req.query.q).slice(0, 200)}%`));
  }
  return {
    where: clauses.length ? " WHERE " + clauses.join(" AND ") : "",
    params,
  };
}
export function registerDataRoutes(app, db, dataDir) {
  app.post("/api/inbox/:id/download", async (req, res) => {
    const row = db
      .prepare(
        "SELECT i.*,COALESCE(a.unit_id,u.unit_id) AS unit_id,CASE WHEN a.id IS NOT NULL THEN a.work_id ELSE u.work_id END AS work_id FROM inbox i LEFT JOIN users u ON u.id=i.owner_id LEFT JOIN activities a ON a.id=i.activity_id WHERE i.id=?",
      )
      .get(Number(req.params.id));
    if (!row) throw httpError(404, "ไม่พบข้อความ");
    if (!row.owner_id || !canEdit(req.user, row))
      throw httpError(403, "ไม่มีสิทธิ์ดาวน์โหลดหลักฐานของผู้รายงานนี้");
    try {
      res.json(await downloadLineMedia(db, dataDir, row, req.user));
    } catch (e) {
      db.prepare("UPDATE inbox SET error=? WHERE id=?").run(e.message, row.id);
      throw e;
    }
  });
  app.get("/api/activities", (req, res) => {
    const { where, params } = whereFor(req),
      { page, limit } = pagination(req);
    const total = db
      .prepare(`SELECT COUNT(*) AS count FROM activities a${where}`)
      .get(...params).count;
    res.json({
      items: db
        .prepare(
          `${selectActivity}${where} ORDER BY a.date DESC,a.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, (page - 1) * limit)
        .map((r) => activity(db, r, req.user)),
      total,
      page,
      limit,
    });
  });
  app.get("/api/activities/:id", (req, res) => {
    const r = db
      .prepare(`${selectActivity} WHERE a.id=?`)
      .get(Number(req.params.id));
    if (!r) throw httpError(404, "ไม่พบรายการงาน");
    res.json({
      ...activity(db, r, req.user),
      files: db
        .prepare(
          "SELECT id,title,original_name,mime,size,created_at FROM files WHERE activity_id=?",
        )
        .all(r.id),
      messages: db
        .prepare(
          "SELECT id,kind,text,received_at,file_id,error FROM inbox WHERE activity_id=?",
        )
        .all(r.id),
      history: db
        .prepare(
          "SELECT actor_name,action,created_at FROM audits WHERE entity='activity' AND entity_id=? ORDER BY id DESC LIMIT 20",
        )
        .all(r.id),
    });
  });
  function saveActivity(req, res) {
    const input = activitySchema.parse(req.body),
      record = req.params.id
        ? db
            .prepare("SELECT * FROM activities WHERE id=?")
            .get(Number(req.params.id))
        : null;
    if (req.params.id && !record) throw httpError(404, "ไม่พบรายการงาน");
    if (record && !Object.hasOwn(req.body, "work_id"))
      input.work_id = record.work_id;
    if (
      record ? !canEdit(req.user, record) : !canCreate(req.user, input.unit_id)
    )
      throw httpError(403, "ไม่มีสิทธิ์บันทึกงานในหน่วยงานนี้");
    if (
      record &&
      record.unit_id !== input.unit_id &&
      !canCreate(req.user, input.unit_id)
    )
      throw httpError(403, "ไม่มีสิทธิ์ย้ายงานไปหน่วยงานนี้");
    if (record && !isHeadForUnit(req.user, record.unit_id)) {
      // Owners may correct historical reports after reassignment, but cannot
      // rewrite the original organization selected for those reports.
      if (input.unit_id !== record.unit_id || input.work_id !== record.work_id)
        throw httpError(
          403,
          "พนักงานไม่สามารถเปลี่ยนฝ่ายหรืองานประจำของรายการได้ กรุณาติดต่อผู้ดูแลระบบ",
        );
    } else if (!record || input.unit_id !== record.unit_id) {
      input.work_id = createWorkAssignment(
        db,
        req.user,
        input.unit_id,
        input.work_id,
      );
    }
    if (record && input.version !== record.version)
      throw httpError(409, "มีผู้แก้ไขรายการนี้แล้ว กรุณาโหลดข้อมูลใหม่");
    if (
      !db
        .prepare(
          "SELECT id FROM units WHERE id=? AND (active=1 OR id=?) AND kind!='section'",
        )
        .get(input.unit_id, record?.unit_id || null)
    )
      throw httpError(400, "หน่วยงานไม่พร้อมใช้งาน");
    if (
      input.category_id &&
      !db
        .prepare("SELECT id FROM categories WHERE id=? AND active=1")
        .get(input.category_id)
    )
      throw httpError(400, "หมวดข้อมูลไม่พร้อมใช้งาน");
    if (
      input.work_id &&
      !db
        .prepare(
          "SELECT id FROM works WHERE id=? AND unit_id=? AND (active=1 OR id=?)",
        )
        .get(input.work_id, input.unit_id, record?.work_id || null)
    )
      throw httpError(
        400,
        "กรุณาเลือกงานที่อยู่ในฝ่าย/กลุ่มงานที่เลือกและเปิดใช้งาน",
      );
    const files = input.file_ids.map((id) =>
      db.prepare("SELECT * FROM files WHERE id=?").get(id),
    );
    if (
      files.some(
        (f) =>
          !f ||
          f.purpose !== "evidence" ||
          (f.activity_id && f.activity_id !== record?.id) ||
          (!record && f.owner_id !== req.user.id) ||
          !canEdit(req.user, f),
      )
    )
      throw httpError(403, "ไม่มีสิทธิ์เชื่อมหลักฐานที่เลือก");
    const messages = input.inbox_ids.map((id) =>
      db.prepare("SELECT * FROM inbox WHERE id=?").get(id),
    );
    if (
      messages.some(
        (m) =>
          !m ||
          (m.activity_id && m.activity_id !== record?.id) ||
          !m.owner_id ||
          !canEdit(req.user, {
            owner_id: m.owner_id,
            unit_id: db
              .prepare("SELECT unit_id FROM users WHERE id=?")
              .get(m.owner_id)?.unit_id,
          }),
      )
    )
      throw httpError(403, "ไม่มีสิทธิ์เชื่อมข้อความ LINE ที่เลือก");
    const out = transaction(db, () => {
      const values = [
        input.title,
        input.date,
        input.unit_id,
        input.category_id,
        input.work_id,
        input.area,
        input.workers,
        input.result,
        JSON.stringify(input.metrics),
        input.status,
      ];
      let recordId;
      if (record) {
        db.prepare(
          "UPDATE activities SET title=?,date=?,unit_id=?,category_id=?,work_id=?,area=?,workers=?,result=?,metrics=?,status=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        ).run(...values, record.id);
        recordId = record.id;
      } else
        recordId = Number(
          db
            .prepare(
              "INSERT INTO activities(title,date,unit_id,category_id,work_id,area,workers,result,metrics,status,source,owner_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
            )
            .run(...values, messages.length ? "line" : "web", req.user.id)
            .lastInsertRowid,
        );
      for (const f of files)
        db.prepare("UPDATE files SET activity_id=? WHERE id=?").run(
          recordId,
          f.id,
        );
      for (const m of messages) {
        db.prepare("UPDATE inbox SET activity_id=? WHERE id=?").run(
          recordId,
          m.id,
        );
        if (m.file_id)
          db.prepare("UPDATE files SET activity_id=? WHERE id=?").run(
            recordId,
            m.file_id,
          );
      }
      const result = db
        .prepare("SELECT * FROM activities WHERE id=?")
        .get(recordId);
      writeAudit(
        db,
        req.user,
        record ? "แก้ไขรายการงาน" : "สร้างรายการงาน",
        "activity",
        recordId,
        record,
        result,
      );
      return result;
    });
    res.status(record ? 200 : 201).json(activity(db, out, req.user));
  }
  app.post("/api/activities", saveActivity);
  app.put("/api/activities/:id", saveActivity);
  app.get("/api/dashboard", (req, res) => {
    const { where, params } = whereFor(req);
    const rows = db.prepare(`${selectActivity}${where}`).all(...params);
    const ready = rows.filter((r) => r.status === "ready"),
      pending = rows.filter((r) => r.status === "pending");
    const metrics = new Map(),
      byUnit = new Map(),
      byCategory = new Map(),
      months = new Map();
    for (const r of ready) {
      byUnit.set(r.unit_name, (byUnit.get(r.unit_name) || 0) + 1);
      byCategory.set(
        r.category_name || "ไม่ระบุ",
        (byCategory.get(r.category_name || "ไม่ระบุ") || 0) + 1,
      );
      const month = r.date.slice(0, 7);
      months.set(month, (months.get(month) || 0) + 1);
      for (const m of JSON.parse(r.metrics)) {
        const key = `${m.label}|${m.unit}`;
        const prev = metrics.get(key) || {
          label: m.label,
          unit: m.unit,
          value: 0,
        };
        prev.value += m.value;
        metrics.set(key, prev);
      }
    }
    let fileWhere = " WHERE purpose='archive'",
      fileParams = [];
    if (req.query.unit) {
      fileWhere += " AND unit_id=?";
      fileParams.push(Number(req.query.unit));
    }
    if (req.query.mine === "1") {
      fileWhere += " AND owner_id=?";
      fileParams.push(req.user.id);
    }
    if (req.query.from) {
      fileWhere += " AND substr(created_at,1,10)>=?";
      fileParams.push(req.query.from);
    }
    if (req.query.to) {
      fileWhere += " AND substr(created_at,1,10)<=?";
      fileParams.push(req.query.to);
    }
    res.json({
      ready: ready.length,
      pending: pending.length,
      archives: db
        .prepare(`SELECT COUNT(*) AS count FROM files${fileWhere}`)
        .get(...fileParams).count,
      metrics: [...metrics.values()],
      byUnit: [...byUnit].map(([name, count]) => ({ name, count })),
      byCategory: [...byCategory].map(([name, count]) => ({ name, count })),
      months: [...months]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, count]) => ({ name, count })),
      updatedAt:
        rows
          .map((r) => r.updated_at)
          .sort()
          .at(-1) || null,
    });
  });
  app.post(
    "/api/files",
    (req, res, next) => {
      if (!req.user.roles.some((r) => ["staff", "head"].includes(r)))
        return next(httpError(403, "ไม่มีสิทธิ์นำเข้าไฟล์"));
      next();
    },
    upload.single("file"),
    async (req, res) => {
      if (!req.file) throw httpError(400, "กรุณาเลือกไฟล์");
      const unit = Number(req.body.unit_id),
        purpose = req.body.purpose;
      if (!canCreate(req.user, unit))
        throw httpError(403, "ไม่มีสิทธิ์นำเข้าไฟล์ในหน่วยงานนี้");
      const requestedWork =
          req.body.work_id == null || req.body.work_id === ""
            ? null
            : Number(req.body.work_id),
        work = createWorkAssignment(db, req.user, unit, requestedWork);
      if (
        work != null &&
        (!Number.isSafeInteger(work) ||
          !db
            .prepare(
              "SELECT id FROM works WHERE id=? AND unit_id=? AND active=1",
            )
            .get(work, unit))
      )
        throw httpError(400, "กรุณาเลือกงานที่เปิดใช้งานในฝ่ายที่เลือก");
      if (!["archive", "evidence"].includes(purpose))
        throw httpError(400, "กรุณาระบุวัตถุประสงค์");
      if (
        req.body.title !== undefined &&
        (typeof req.body.title !== "string" ||
          !req.body.title.trim() ||
          req.body.title.trim().length > 300)
      )
        throw httpError(400, "กรุณาระบุชื่อเรื่อง 1–300 ตัวอักษร");
      if (
        !db
          .prepare(
            "SELECT id FROM units WHERE id=? AND active=1 AND kind!='section'",
          )
          .get(unit)
      )
        throw httpError(400, "หน่วยงานไม่พร้อมใช้งาน");
      let detected;
      try {
        detected = await fileTypeFromBuffer(req.file.buffer);
      } catch {
        throw httpError(415, "ไฟล์ไม่สมบูรณ์หรือไม่รองรับ");
      }
      if (!detected || !allowed.has(detected.mime))
        throw httpError(415, "รองรับ PDF, Excel, JPG, PNG และ WebP เท่านั้น");
      if (
        detected.mime === "application/x-cfb" &&
        !req.file.originalname.toLowerCase().endsWith(".xls")
      )
        throw httpError(415, "รองรับเอกสารไบนารีชนิด Excel .xls เท่านั้น");
      const mime =
        detected.mime === "application/x-cfb"
          ? "application/vnd.ms-excel"
          : detected.mime;
      const storage = `${randomUUID()}.${detected.ext}`,
        original = Buffer.from(req.file.originalname, "latin1")
          .toString("utf8")
          .replace(/[\x00-\x1f]/g, "")
          .slice(0, 240),
        title = String(req.body.title || original)
          .trim()
          .slice(0, 300);
      await writeFile(resolve(dataDir, "uploads", storage), req.file.buffer, {
        mode: 0o600,
      });
      try {
        const file = transaction(db, () => {
          const id = Number(
            db
              .prepare(
                "INSERT INTO files(original_name,storage_name,mime,size,title,keywords,purpose,unit_id,work_id,owner_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
              )
              .run(
                original,
                storage,
                mime,
                req.file.size,
                title,
                String(req.body.keywords || "").slice(0, 1000),
                purpose,
                unit,
                work,
                req.user.id,
              ).lastInsertRowid,
          );
          const r = db.prepare("SELECT * FROM files WHERE id=?").get(id);
          writeAudit(db, req.user, "นำเข้าไฟล์", "file", id, null, {
            title,
            purpose,
          });
          return r;
        });
        res.status(201).json({ ...file, storage_name: undefined });
      } catch (e) {
        await unlink(resolve(dataDir, "uploads", storage));
        throw e;
      }
    },
  );
  app.get("/api/files", (req, res) => {
    const conditions = [],
      params = [];
    for (const [q, col] of [
      ["unit", "f.unit_id"],
      ["work", "f.work_id"],
      ["purpose", "f.purpose"],
    ])
      if (req.query[q]) {
        conditions.push(`${col}=?`);
        params.push(req.query[q]);
      }
    if (req.query.mine === "1") {
      conditions.push("f.owner_id=?");
      params.push(req.user.id);
    }
    if (req.query.q) {
      conditions.push("(f.title LIKE ? OR f.keywords LIKE ?)");
      params.push(...Array(2).fill(`%${String(req.query.q).slice(0, 200)}%`));
    }
    if (req.query.unlinked === "1") conditions.push("f.activity_id IS NULL");
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "",
      { page, limit } = pagination(req);
    const total = db
      .prepare(`SELECT COUNT(*) count FROM files f${where}`)
      .get(...params).count;
    res.json({
      total,
      page,
      limit,
      items: db
        .prepare(
          `SELECT f.id,f.original_name,f.title,f.mime,f.size,f.purpose,f.keywords,f.activity_id,f.unit_id,f.work_id,f.owner_id,f.created_at,u.name AS unit_name,w.name AS work_name,o.name AS owner_name FROM files f JOIN units u ON u.id=f.unit_id LEFT JOIN works w ON w.id=f.work_id JOIN users o ON o.id=f.owner_id${where} ORDER BY f.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, (page - 1) * limit),
    });
  });
  app.get("/api/files/:id/content", (req, res) => {
    const f = db
      .prepare("SELECT * FROM files WHERE id=?")
      .get(Number(req.params.id));
    if (!f) throw httpError(404, "ไม่พบไฟล์");
    res.set("Content-Type", f.mime);
    res.set(
      "Content-Disposition",
      `${req.query.download === "1" || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(f.mime) ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
    );
    res.sendFile(resolve(dataDir, "uploads", f.storage_name));
  });
  app.get("/api/inbox", (req, res) => {
    const { page, limit } = pagination(req);
    const rows = db
      .prepare(
        "SELECT i.*,u.name AS owner_name,u.unit_id,u.work_id FROM inbox i LEFT JOIN users u ON u.id=i.owner_id WHERE i.activity_id IS NULL ORDER BY i.id DESC",
      )
      .all();
    res.json({
      items: rows
        .slice((page - 1) * limit, page * limit)
        .map((r) => ({ ...r, can_edit: !!r.owner_id && canEdit(req.user, r) })),
      total: rows.length,
      page,
      limit,
    });
  });
}
