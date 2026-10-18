import { assertRead, contentScope, assertUnlocked } from "./access.js";
import { z } from "zod";
import { canEdit, httpError } from "./security.js";
import { transaction, writeAudit } from "./db.js";
import { validDate } from "../shared/report-period.js";

export const duplicateKey = (r) =>
  JSON.stringify([
    r.unit_id,
    r.date,
    r.title.normalize("NFC").replace(/\s+/g, "").toLowerCase(),
  ]);
export function registerInsightRoutes(app, db) {
  app.get("/api/activities/:id/duplicates", (req, res) => {
    const row = db
      .prepare("SELECT * FROM activities WHERE id=?")
      .get(Number(req.params.id));
    if (!row) throw httpError(404, "ไม่พบรายงาน");
    assertRead(db, req.user, row);
    const candidates = row.date
      ? db
          .prepare(
            "SELECT a.id,a.title,a.date,a.status,a.owner_id,a.version,a.unit_id,a.duplicate_of,u.name owner_name FROM activities a JOIN users u ON u.id=a.owner_id WHERE a.unit_id=? AND a.date=? AND a.id<>? AND a.duplicate_of IS NULL ORDER BY a.id",
          )
          .all(row.unit_id, row.date, row.id)
          .filter((r) => duplicateKey(r) === duplicateKey(row))
      : [];
    res.json({
      items: candidates.filter((r) => {
        try {
          assertRead(db, req.user, r);
          return true;
        } catch {
          return false;
        }
      }),
      canonical: row.duplicate_of
        ? (() => {
            const c = db
              .prepare("SELECT * FROM activities WHERE id=?")
              .get(row.duplicate_of);
            try {
              assertRead(db, req.user, c);
              return { id: c.id, title: c.title };
            } catch {
              return {
                id: row.duplicate_of,
                title: "รายงานหลักอยู่นอกขอบเขตสิทธิ์",
              };
            }
          })()
        : null,
    });
  });
  app.put("/api/activities/:id/duplicate", (req, res) => {
    const input = z
      .object({
        version: z.number().int().positive(),
        duplicate_of: z.number().int().positive().nullable(),
        reason: z.string().trim().min(3).max(1000),
      })
      .parse(req.body);
    const result = transaction(db, () => {
      const row = db
        .prepare("SELECT * FROM activities WHERE id=?")
        .get(Number(req.params.id));
      if (!row) throw httpError(404, "ไม่พบรายงาน");
      assertUnlocked(db, req.user, row);
      if (!canEdit(req.user, row))
        throw httpError(403, "ไม่มีสิทธิ์ตรวจรายการนี้");
      if (row.version !== input.version)
        throw httpError(409, "รายงานเปลี่ยนแล้ว กรุณาโหลดใหม่");
      if (
        db
          .prepare(
            "SELECT id FROM project_tasks WHERE activity_id=? AND status='completed'",
          )
          .get(row.id)
      )
        throw httpError(
          409,
          "รายงานเป็นหลักฐานงานที่ตรวจรับแล้ว ต้องให้หัวหน้าส่งกลับก่อน",
        );
      if (input.duplicate_of !== null) {
        const canonical = db
          .prepare("SELECT * FROM activities WHERE id=?")
          .get(input.duplicate_of);
        if (
          !canonical ||
          canonical.id === row.id ||
          canonical.duplicate_of ||
          canonical.status !== "ready" ||
          canonical.unit_id !== row.unit_id
        )
          throw httpError(
            400,
            "เลือกรายงานหลักที่ยืนยันแล้วในฝ่ายเดียวกัน และไม่ใช่รายการซ้ำ",
          );
        assertRead(db, req.user, canonical);
        if (
          db
            .prepare("SELECT id FROM activities WHERE duplicate_of=?")
            .get(row.id)
        )
          throw httpError(409, "รายการนี้เป็นรายงานหลักของรายการอื่นแล้ว");
      } else if (!row.duplicate_of)
        throw httpError(400, "รายการนี้ยังไม่ได้ระบุว่าซ้ำ");
      db.prepare(
        "UPDATE activities SET duplicate_of=?,duplicate_reason=?,version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",
      ).run(input.duplicate_of, input.reason, row.id);
      const after = db
        .prepare("SELECT * FROM activities WHERE id=?")
        .get(row.id);
      writeAudit(
        db,
        req.user,
        input.duplicate_of
          ? "ยืนยันรายการซ้ำ ไม่รวมยอด"
          : "ยกเลิกการระบุว่าซ้ำ",
        "activity",
        row.id,
        row,
        after,
      );
      return after;
    });
    res.json({
      id: result.id,
      version: result.version,
      duplicate_of: result.duplicate_of,
    });
  });
  app.get("/api/calendar", (req, res) => {
    const { from, to, unit, mine } = req.query;
    if (
      !validDate(from) ||
      !validDate(to) ||
      from > to ||
      (Date.parse(to) - Date.parse(from)) / 86400000 > 62
    )
      throw httpError(400, "เลือกช่วงปฏิทินไม่เกิน 63 วัน");
    const scope = contentScope(req.user);
    const clauses = [scope.sql, "a.date BETWEEN ? AND ?"],
      params = [...scope.params, from, to];
    if (unit) {
      clauses.push("a.unit_id=?");
      params.push(Number(unit));
    }
    if (mine === "1") {
      clauses.push("a.owner_id=?");
      params.push(req.user.id);
    }
    const rows = db
      .prepare(
        `SELECT a.id,a.title,a.date,a.status,a.duplicate_of,u.name unit_name,w.name work_name FROM activities a JOIN units u ON u.id=a.unit_id LEFT JOIN works w ON w.id=a.work_id WHERE ${clauses.join(" AND ")} ORDER BY a.date,a.id LIMIT 501`,
      )
      .all(...params);
    res.json({
      items: rows.slice(0, 500),
      has_more: rows.length > 500,
      from,
      to,
    });
  });
}
