import { masterSchema, workSchema } from "./validation.js";
import { httpError } from "./security.js";
import { transaction, writeAudit } from "./db.js";

export function registerMasterRoutes(app, db) {
  for (const table of ["units", "works", "categories"]) {
    function save(req, res) {
      const input = (table === "works" ? workSchema : masterSchema).parse(
        req.body,
      );
      const old = req.params.id
        ? db
            .prepare(`SELECT * FROM ${table} WHERE id=?`)
            .get(Number(req.params.id))
        : null;
      if (req.params.id && !old) throw httpError(404, "ไม่พบข้อมูล");
      if (
        db
          .prepare(
            `SELECT id FROM ${table} WHERE name=? COLLATE NOCASE AND id!=?${table === "works" ? " AND unit_id=?" : ""}`,
          )
          .get(
            input.name,
            old?.id || 0,
            ...(table === "works" ? [input.unit_id] : []),
          )
      )
        throw httpError(
          409,
          table === "categories"
            ? "มีประเภทงานชื่อนี้แล้ว กรุณาเลือกจากรายการเดิม หรือติดต่อผู้ดูแลระบบหากถูกปิดใช้"
            : "มีชื่อข้อมูลนี้แล้ว",
        );
      if (table === "units") {
        if (input.kind === "section" && input.parent_id)
          throw httpError(400, "ส่วนต้องอยู่ระดับบนสุด");
        if (input.parent_id) {
          const parent = db
            .prepare("SELECT * FROM units WHERE id=?")
            .get(input.parent_id);
          if (!parent || parent.kind !== "section" || parent.id === old?.id)
            throw httpError(400, "กรุณาเลือกส่วนที่สังกัด");
        }
        if (
          old &&
          input.kind !== old.kind &&
          (old.kind === "section" || input.kind === "section")
        )
          throw httpError(
            400,
            "ไม่สามารถสลับระดับส่วนกับฝ่าย/กลุ่มงาน กรุณาเพิ่มหน่วยงานใหม่",
          );
      }
      if (table === "works") {
        if (
          !db
            .prepare(
              "SELECT id FROM units WHERE id=? AND kind!='section' AND active=1",
            )
            .get(input.unit_id)
        )
          throw httpError(400, "กรุณาเลือกฝ่าย/กลุ่มงานที่เปิดใช้งาน");
        if (
          old &&
          input.unit_id !== old.unit_id &&
          (db
            .prepare("SELECT id FROM activities WHERE work_id=? LIMIT 1")
            .get(old.id) ||
            db
              .prepare("SELECT id FROM users WHERE work_id=? LIMIT 1")
              .get(old.id) ||
            db
              .prepare("SELECT id FROM files WHERE work_id=? LIMIT 1")
              .get(old.id) ||
            db
              .prepare("SELECT id FROM works WHERE parent_id=? LIMIT 1")
              .get(old.id))
        )
          throw httpError(
            400,
            "งานนี้มีผู้ใช้งาน รายงาน ไฟล์ หรืองานย่อยอ้างอิงแล้ว จึงไม่สามารถย้ายฝ่ายได้",
          );
        let parentId = input.parent_id;
        const seen = new Set([old?.id]);
        while (parentId) {
          if (seen.has(parentId)) throw httpError(400, "โครงสร้างงานวนซ้ำ");
          seen.add(parentId);
          const parent = db
            .prepare("SELECT * FROM works WHERE id=?")
            .get(parentId);
          if (!parent || parent.unit_id !== input.unit_id)
            throw httpError(400, "งานแม่ต้องอยู่ในฝ่ายเดียวกัน");
          parentId = parent.parent_id;
        }
      }
      const out = transaction(db, () => {
        const fields = [
          "name",
          "active",
          ...(table === "units"
            ? ["parent_id", "kind"]
            : table === "works"
              ? ["unit_id", "parent_id"]
              : []),
        ];
        const values = fields.map((k) =>
          k === "active" ? Number(input.active) : input[k],
        );
        let id = old?.id;
        if (old)
          db.prepare(
            `UPDATE ${table} SET ${fields.map((k) => `${k}=?`).join(",")} WHERE id=?`,
          ).run(...values, id);
        else
          id = Number(
            db
              .prepare(
                `INSERT INTO ${table}(${fields.join(",")}) VALUES(${fields.map(() => "?").join(",")})`,
              )
              .run(...values).lastInsertRowid,
          );
        const row = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
        writeAudit(
          db,
          req.user,
          old ? "แก้ไขข้อมูลตั้งต้น" : "เพิ่มข้อมูลตั้งต้น",
          table,
          id,
          old,
          row,
        );
        return row;
      });
      res.status(old ? 200 : 201).json(out);
    }
    app.post(`/api/admin/${table}`, save);
    app.put(`/api/admin/${table}/:id`, save);
    if (table === "categories")
      app.post("/api/categories", (req, res) => {
        if (!req.user.roles.some((r) => ["staff", "head", "admin"].includes(r)))
          throw httpError(403, "ไม่มีสิทธิ์เพิ่มประเภทงาน");
        req.body = { name: req.body.name, active: true };
        save(req, res);
      });
  }
}
