import { scanFile } from "./file-policy.js";
import {
  contentScope,
  fileScope,
  assertRead,
  assertFileRead,
  assertUnlocked,
  lockFor,
} from "./access.js";
import { aggregateMetrics } from "./analytics.js";
import { reportPeriod } from "../shared/report-period.js";
import multer from "multer";
import { randomUUID } from "node:crypto";
import { writeFile, unlink, copyFile } from "node:fs/promises";
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
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 1,
    fields: 10,
    fieldSize: 80000,
  },
});
const allowed = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
  const locked = Boolean(
    db
      .prepare(
        "SELECT id FROM project_tasks WHERE activity_id=? AND status='completed' LIMIT 1",
      )
      .get(row.id),
  );
  return {
    ...row,
    metrics: JSON.parse(row.metrics),
    intake: Boolean(row.intake),
    news_requested: Boolean(row.news_requested),
    brief: Boolean(row.brief),
    locked_by_project: locked,
    period_lock: lockFor(db, row),
    amendment_allowed: !!db
      .prepare(
        "SELECT 1 FROM amendment_grants WHERE activity_id=? AND user_id=? AND expires_at>?",
      )
      .get(row.id, user.id, new Date().toISOString()),
    can_edit: !locked && canEdit(user, row),
  };
}
const selectActivity = `SELECT a.*,COALESCE(a.unit_label,u.name) AS unit_name,c.name AS category_name,o.name AS owner_name,COALESCE(a.work_label,w.name) AS work_name FROM activities a JOIN units u ON u.id=a.unit_id LEFT JOIN categories c ON c.id=a.category_id JOIN users o ON o.id=a.owner_id LEFT JOIN works w ON w.id=a.work_id`;
function whereFor(req, alias = "a") {
  const scope = contentScope(req.user, alias);
  const clauses = [scope.sql],
    params = [...scope.params];
  const add = (sql, v) => {
    clauses.push(sql);
    params.push(v);
  };
  if (req.query.community)
    add(`${alias}.community_id=?`, Number(req.query.community));
  if (["image", "file", "none"].includes(req.query.attachments)) {
    const condition =
      req.query.attachments === "image"
        ? " AND f.mime LIKE 'image/%'"
        : req.query.attachments === "file"
          ? " AND f.mime NOT LIKE 'image/%'"
          : "";
    clauses.push(
      `${req.query.attachments === "none" ? "NOT " : ""}EXISTS(SELECT 1 FROM files f WHERE f.activity_id=${alias}.id${condition})`,
    );
  }
  if (req.query.work) add(`${alias}.work_id=?`, Number(req.query.work));
  if (req.query.unit) {
    clauses.push(
      `(${alias}.unit_id=? OR EXISTS(SELECT 1 FROM activity_units au WHERE au.activity_id=${alias}.id AND au.unit_id=?))`,
    );
    params.push(Number(req.query.unit), Number(req.query.unit));
  }
  if (req.query.mine === "1") {
    clauses.push(
      `(${alias}.owner_id=? OR EXISTS(SELECT 1 FROM activity_people ap WHERE ap.activity_id=${alias}.id AND ap.user_id=? AND ap.confirmed_at IS NOT NULL))`,
    );
    params.push(req.user.id, req.user.id);
  }
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
  if (req.query.status === "duplicate")
    clauses.push(`${alias}.duplicate_of IS NOT NULL`);
  else if (req.query.status) {
    add(`${alias}.status=?`, req.query.status);
    clauses.push(`${alias}.duplicate_of IS NULL`);
  }
  if (req.query.ids) {
    const ids = String(req.query.ids).split(",").map(Number);
    if (
      ids.length > 1000 ||
      ids.some((id) => !Number.isSafeInteger(id) || id <= 0)
    )
      throw httpError(400, "ตัวกรองรายการไม่ถูกต้อง");
    clauses.push(`${alias}.id IN (${ids.map(() => "?").join(",")})`);
    params.push(...ids);
  }
  if (req.query.category)
    add(`${alias}.category_id=?`, Number(req.query.category));
  if (req.query.source) add(`${alias}.source=?`, req.query.source);
  if (req.query.q) {
    clauses.push(
      `(${alias}.title LIKE ? OR ${alias}.area LIKE ? OR ${alias}.result LIKE ? OR ${alias}.workers LIKE ? OR ${alias}.source_text LIKE ? OR EXISTS (SELECT 1 FROM activity_extractions ex WHERE ex.activity_id=${alias}.id AND ex.result_json LIKE ?))`,
    );
    params.push(...Array(6).fill(`%${String(req.query.q).slice(0, 200)}%`));
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
    if (req.query.metric_label) {
      const method = req.query.metric_method || "sum";
      if (!["sum", "max"].includes(method) || !req.query.metric_unit)
        throw httpError(400, "ตัวกรองผลการดำเนินงานไม่ถูกต้อง");
      const rows = db
        .prepare(`${selectActivity}${where} ORDER BY a.date DESC,a.id DESC`)
        .all(...params);
      const metric = aggregateMetrics(db, rows).find(
        (m) =>
          m.label === req.query.metric_label &&
          m.unit === req.query.metric_unit &&
          m.method === method,
      );
      const ids = new Set(metric?.source_ids || []),
        selected = rows.filter((r) => ids.has(r.id));
      return res.json({
        items: selected
          .slice((page - 1) * limit, page * limit)
          .map((r) => activity(db, r, req.user)),
        total: selected.length,
        page,
        limit,
      });
    }
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
    assertRead(db, req.user, r, { audit: true });
    res.json({
      ...activity(db, r, req.user),
      extraction: (() => {
        const e = db
          .prepare(
            "SELECT result_json FROM activity_extractions WHERE activity_id=?",
          )
          .get(r.id);
        return e ? JSON.parse(e.result_json) : null;
      })(),
      news_candidate:
        db
          .prepare("SELECT state,note FROM news_candidates WHERE activity_id=?")
          .get(r.id) || null,
      files: db
        .prepare(
          "SELECT f.id,f.title,f.original_name,f.mime,f.size,f.created_at,EXISTS(SELECT 1 FROM media_retention mr WHERE mr.file_id=f.id AND mr.state IN ('purging','purged')) purged FROM files f WHERE f.activity_id=?",
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
    if (!record && input.intake_key) {
      const existing = db
        .prepare("SELECT * FROM activities WHERE intake_key=?")
        .get(input.intake_key);
      if (existing) {
        if (existing.owner_id !== req.user.id)
          throw httpError(409, "รหัสการส่งถูกใช้แล้ว");
        return res.json(activity(db, existing, req.user));
      }
    }
    if (!record && input.intake) {
      if (!input.source_text.trim() && !input.file_ids.length)
        throw httpError(400, "กรุณาส่งข้อความหรือแนบไฟล์");
      if (input.status !== "pending")
        throw httpError(400, "รายงานที่ส่งใหม่ต้องรอตรวจก่อนยืนยัน");
      input.date = null;
      input.metrics = [];
      input.workers = "";
      input.result = "";
    }

    if (record) assertUnlocked(db, req.user, record);
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
    if (
      record &&
      db
        .prepare(
          "SELECT id FROM project_tasks WHERE activity_id=? AND status='completed' LIMIT 1",
        )
        .get(record.id)
    )
      throw httpError(
        409,
        "รายงานนี้ใช้ตรวจรับงานแล้ว ให้หัวหน้าเปิดโครงการและส่งงานกลับก่อนแก้ไข",
      );
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
    if (input.status === "ready")
      assertUnlocked(db, req.user, {
        ...record,
        ...input,
        id: record?.id || 0,
      });
    const files = input.file_ids.map((id) =>
      db.prepare("SELECT * FROM files WHERE id=?").get(id),
    );
    if (
      files.some(
        (f) =>
          !f ||
          f.purpose !== "evidence" ||
          db
            .prepare(
              "SELECT 1 FROM media_retention WHERE file_id=? AND state IN ('purging','purged')",
            )
            .get(f.id) ||
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
      if (!record && input.intake) {
        db.prepare(
          "UPDATE activities SET source_text=?,intake=1,intake_key=? WHERE id=?",
        ).run(input.source_text, input.intake_key || null, recordId);
      }
      db.prepare(
        "UPDATE activities SET news_requested=?,brief=? WHERE id=?",
      ).run(input.news_requested ? 1 : 0, input.brief ? 1 : 0, recordId);
      db.prepare("UPDATE activities SET owner_confirmed_at=? WHERE id=?").run(
        input.status === "ready" && (!record || record.owner_id === req.user.id)
          ? new Date().toISOString()
          : null,
        recordId,
      );
      if (input.news_requested && input.status === "ready")
        db.prepare(
          "INSERT OR IGNORE INTO news_candidates(activity_id,requested_by) VALUES(?,?)",
        ).run(recordId, req.user.id);
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
  app.post("/api/activities/:id/attachments", async (req, res) => {
    const reportId = Number(req.params.id),
      fileId = Number(req.body.file_id);
    const check = () => {
      const report = db
        .prepare("SELECT * FROM activities WHERE id=?")
        .get(reportId);
      const file = db.prepare("SELECT * FROM files WHERE id=?").get(fileId);
      if (!report || !file) throw httpError(404, "ไม่พบรายงานหรือไฟล์");
      if (
        db
          .prepare(
            "SELECT 1 FROM media_retention WHERE file_id=? AND state IN ('purging','purged')",
          )
          .get(file.id)
      )
        throw httpError(
          410,
          "ไฟล์นี้ครบอายุเก็บแล้ว ใช้แนบเป็นหลักฐานใหม่ไม่ได้",
        );
      assertUnlocked(db, req.user, report);
      if (!canEdit(req.user, report) || !canEdit(req.user, file))
        throw httpError(403, "ไม่มีสิทธิ์แนบไฟล์นี้");
      if (file.activity_id === reportId) return { report, file, already: true };
      if (
        db
          .prepare(
            "SELECT id FROM project_tasks WHERE activity_id=? AND status='completed' LIMIT 1",
          )
          .get(reportId)
      )
        throw httpError(
          409,
          "รายงานนี้ใช้ตรวจรับงานแล้ว ให้หัวหน้าส่งงานกลับก่อนเพิ่มหลักฐาน",
        );
      if (file.activity_id) throw httpError(409, "ไฟล์นี้แนบกับรายงานอื่นแล้ว");
      if (report.version !== req.body.version)
        throw httpError(
          409,
          "รายงานมีการแก้ไขแล้ว กรุณาโหลดใหม่ก่อนเพิ่มไฟล์แนบ",
        );
      return { report, file, already: false };
    };
    const initial = check();
    if (initial.already)
      return res.json({
        file: { ...initial.file, storage_name: undefined },
        version: initial.report.version,
      });
    let copied = null;
    try {
      if (initial.file.purpose === "archive") {
        copied =
          randomUUID() + "." + initial.file.storage_name.split(".").at(-1);
        await copyFile(
          resolve(dataDir, "uploads", initial.file.storage_name),
          resolve(dataDir, "uploads", copied),
        );
      }
      const result = transaction(db, () => {
        const { report, file, already } = check();
        if (already) throw httpError(409, "ไฟล์ถูกแนบแล้ว กรุณาโหลดใหม่");
        let id = file.id;
        if (copied) {
          id = Number(
            db
              .prepare(
                "INSERT INTO files(original_name,storage_name,mime,size,title,keywords,purpose,unit_id,work_id,owner_id,activity_id) VALUES(?,?,?,?,?,?,'evidence',?,?,?,?)",
              )
              .run(
                file.original_name,
                copied,
                file.mime,
                file.size,
                file.title,
                file.keywords,
                report.unit_id,
                report.work_id,
                req.user.id,
                reportId,
              ).lastInsertRowid,
          );
          db.prepare("UPDATE files SET description=? WHERE id=?").run(
            file.description,
            id,
          );
        } else
          db.prepare("UPDATE files SET activity_id=? WHERE id=?").run(
            reportId,
            id,
          );
        db.prepare(
          "UPDATE activities SET version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
        ).run(reportId);
        writeAudit(db, req.user, "เพิ่มไฟล์แนบ", "activity", reportId, null, {
          file_id: id,
          source_file_id: file.id,
          archive_preserved: Boolean(copied),
        });
        return {
          file: {
            ...db.prepare("SELECT * FROM files WHERE id=?").get(id),
            storage_name: undefined,
          },
          version: report.version + 1,
        };
      });
      res.status(201).json(result);
    } catch (e) {
      if (copied)
        await unlink(resolve(dataDir, "uploads", copied)).catch(() => {});
      throw e;
    }
  });
  app.get("/api/dashboard", (req, res) => {
    let effective = req;
    if (req.query.period) {
      try {
        effective = {
          user: req.user,
          query: { ...req.query, ...reportPeriod(req.query) },
        };
      } catch (e) {
        throw httpError(400, e.message);
      }
    }
    let previous = null;
    if (effective.query.previous) {
      const prior = whereFor({
        user: req.user,
        query: { ...effective.query, ...effective.query.previous },
      });
      const rows = db
        .prepare(`${selectActivity}${prior.where}`)
        .all(...prior.params);
      const ready = rows.filter((r) => r.status === "ready" && !r.duplicate_of);
      previous = {
        range: effective.query.previous,
        ready: ready.length,
        pending: rows.filter((r) => r.status === "pending" && !r.duplicate_of)
          .length,
        metrics: aggregateMetrics(db, ready),
      };
    }
    const { where, params } = whereFor(effective);
    const rows = db.prepare(`${selectActivity}${where}`).all(...params);
    const ready = rows.filter((r) => r.status === "ready" && !r.duplicate_of),
      pending = rows.filter((r) => r.status === "pending" && !r.duplicate_of);
    const byUnit = new Map(),
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
    }
    const fs = fileScope(req.user);
    let fileWhere = " WHERE purpose='archive' AND " + fs.sql,
      fileParams = [...fs.params];
    if (req.query.unit) {
      fileWhere += " AND unit_id=?";
      fileParams.push(Number(req.query.unit));
    }
    if (req.query.mine === "1") {
      fileWhere += " AND owner_id=?";
      fileParams.push(req.user.id);
    }
    if (effective.query.from) {
      fileWhere += " AND substr(created_at,1,10)>=?";
      fileParams.push(effective.query.from);
    }
    if (effective.query.to) {
      fileWhere += " AND substr(created_at,1,10)<=?";
      fileParams.push(effective.query.to);
    }
    res.json({
      ready: ready.length,
      previous,
      pending: pending.length,
      range: effective.query.from
        ? { from: effective.query.from, to: effective.query.to }
        : null,
      archives: db
        .prepare(`SELECT COUNT(*) AS count FROM files f${fileWhere}`)
        .get(...fileParams).count,
      duplicates: rows.filter((r) => r.duplicate_of).length,
      metrics: aggregateMetrics(db, ready),
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
      if (
        !req.user.roles.some((r) =>
          ["staff", "head", "center_head"].includes(r),
        )
      )
        return next(httpError(403, "ไม่มีสิทธิ์นำเข้าไฟล์"));
      next();
    },
    upload.single("file"),
    async (req, res) => {
      let description = req.body.description ?? "";
      if (typeof description !== "string" || description.length > 20000)
        throw httpError(400, "ข้อความต้องไม่เกิน 20,000 ตัวอักษร");
      description = description.replace(/\r\n/g, "\n");
      const textOnly =
        !req.file && req.body.purpose === "archive" && description.trim();
      if (textOnly) {
        const buffer = Buffer.from(description, "utf8");
        req.file = { buffer, size: buffer.length, originalname: "note.txt" };
      }
      if (!req.file) throw httpError(400, "กรุณาพิมพ์ข้อความหรือเลือกไฟล์");
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
        detected = textOnly
          ? { mime: "text/plain", ext: "txt" }
          : await fileTypeFromBuffer(req.file.buffer);
      } catch {
        throw httpError(415, "ไฟล์ไม่สมบูรณ์หรือไม่รองรับ");
      }
      if (!detected || (!textOnly && !allowed.has(detected.mime)))
        throw httpError(
          415,
          "รองรับ PDF, Word (.docx), Excel, JPG, PNG และ WebP เท่านั้น",
        );
      if (
        detected.mime === "application/x-cfb" &&
        !req.file.originalname.toLowerCase().endsWith(".xls")
      )
        throw httpError(415, "รองรับเอกสารไบนารีชนิด Excel .xls เท่านั้น");
      const mime =
        detected.mime === "application/x-cfb"
          ? "application/vnd.ms-excel"
          : detected.mime;
      await scanFile(req.file.buffer);
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
          db.prepare("UPDATE files SET description=? WHERE id=?").run(
            description,
            id,
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
    const scope = fileScope(req.user);
    const conditions = [scope.sql],
      params = [...scope.params];
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
      conditions.push(
        "(f.title LIKE ? OR f.keywords LIKE ? OR f.description LIKE ? OR EXISTS (SELECT 1 FROM activity_extractions ex WHERE ex.activity_id=f.activity_id AND ex.result_json LIKE ?))",
      );
      params.push(...Array(4).fill(`%${String(req.query.q).slice(0, 200)}%`));
    }
    if (req.query.from) {
      conditions.push("substr(f.created_at,1,10)>=?");
      params.push(req.query.from);
    }
    if (req.query.to) {
      conditions.push("substr(f.created_at,1,10)<=?");
      params.push(req.query.to);
    }
    if (req.query.unlinked === "1") conditions.push("f.activity_id IS NULL");
    if (req.query.attachable === "1") {
      conditions.push("f.activity_id IS NULL");
      const access = [];
      if (req.user.roles.includes("staff")) {
        access.push("f.owner_id=?");
        params.push(req.user.id);
      }
      if (req.user.roles.includes("head") && req.user.scopes.length) {
        access.push(
          `f.unit_id IN (${req.user.scopes.map(() => "?").join(",")})`,
        );
        params.push(...req.user.scopes);
      }
      conditions.push(access.length ? "(" + access.join(" OR ") + ")" : "0=1");
    }

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
          `SELECT f.id,EXISTS(SELECT 1 FROM media_retention mr WHERE mr.file_id=f.id AND mr.state IN ('purging','purged')) purged,f.original_name,f.title,f.mime,f.size,f.purpose,f.keywords,f.description,f.activity_id,f.unit_id,f.work_id,f.owner_id,f.created_at,u.name AS unit_name,w.name AS work_name,o.name AS owner_name FROM files f JOIN units u ON u.id=f.unit_id LEFT JOIN works w ON w.id=f.work_id JOIN users o ON o.id=f.owner_id${where} ORDER BY f.id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, (page - 1) * limit),
    });
  });
  app.get("/api/files/:id/content", (req, res) => {
    const f = db
      .prepare("SELECT * FROM files WHERE id=?")
      .get(Number(req.params.id));
    if (!f) throw httpError(404, "ไม่พบไฟล์");
    assertFileRead(db, req.user, f.id);
    if (
      db
        .prepare(
          "SELECT 1 FROM media_retention WHERE file_id=? AND state IN ('purging','purged')",
        )
        .get(f.id)
    )
      throw httpError(
        410,
        "ไฟล์นี้ครบอายุเก็บแล้ว เหลือเฉพาะประวัติการจัดเก็บ",
      );
    res.set("Content-Type", f.mime);
    res.set(
      "Content-Disposition",
      `${req.query.download === "1" || !["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(f.mime) ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`,
    );
    res.sendFile(resolve(dataDir, "uploads", f.storage_name));
  });
  app.get("/api/inbox", (req, res) => {
    const { page, limit } = pagination(req);
    let rows = db
      .prepare(
        "SELECT i.*,u.name AS owner_name,u.unit_id,u.work_id FROM inbox i LEFT JOIN users u ON u.id=i.owner_id WHERE i.activity_id IS NULL ORDER BY i.id DESC",
      )
      .all();
    rows = rows.filter(
      (r) =>
        req.user.roles.includes("executive") ||
        (r.owner_id && (r.owner_id === req.user.id || canEdit(req.user, r))),
    );
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
