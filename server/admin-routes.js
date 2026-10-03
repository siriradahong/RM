import { userSchema } from "./validation.js";
import { hashPassword, httpError } from "./security.js";
import { publicUser, transaction, writeAudit } from "./db.js";
import { registerMasterRoutes } from "./master-routes.js";

export function registerAdminRoutes(app, db) {
  app.use("/api/admin", (req, res, next) =>
    req.user.roles.includes("admin")
      ? next()
      : next(httpError(403, "เฉพาะผู้ดูแลระบบ")),
  );
  app.get("/api/admin/users", (req, res) =>
    res.json(
      db
        .prepare(
          "SELECT u.*,n.name AS unit_name,w.name AS work_name FROM users u LEFT JOIN units n ON n.id=u.unit_id LEFT JOIN works w ON w.id=u.work_id ORDER BY u.id",
        )
        .all()
        .map(publicUser),
    ),
  );
  async function saveUser(req, res) {
    const input = userSchema.parse(req.body),
      old = req.params.id
        ? db
            .prepare("SELECT * FROM users WHERE id=?")
            .get(Number(req.params.id))
        : null;
    if (req.params.id && !old) throw httpError(404, "ไม่พบบัญชี");
    if (!old && !input.password)
      throw httpError(400, "กรุณากำหนดรหัสผ่านอย่างน้อย 12 ตัวอักษร");
    if (
      input.unit_id &&
      !db
        .prepare(
          "SELECT id FROM units WHERE id=? AND active=1 AND kind!='section'",
        )
        .get(input.unit_id)
    )
      throw httpError(400, "สังกัดไม่พร้อมใช้งาน");
    if (
      input.work_id &&
      !db
        .prepare("SELECT id FROM works WHERE id=? AND unit_id=? AND active=1")
        .get(input.work_id, input.unit_id)
    )
      throw httpError(400, "กรุณาเลือกงานที่เปิดใช้งานในฝ่ายที่สังกัด");
    if (
      input.scopes.some(
        (i) =>
          !db
            .prepare(
              "SELECT id FROM units WHERE id=? AND active=1 AND kind!='section'",
            )
            .get(i),
      )
    )
      throw httpError(400, "หน่วยงานที่รับผิดชอบไม่พร้อมใช้งาน");
    if (
      old?.id === req.user.id &&
      (!input.active || !input.roles.includes("admin"))
    )
      throw httpError(400, "ไม่สามารถระงับบัญชีหรือลบสิทธิ์แอดมินของตนเอง");
    const passwordHash = input.password
      ? await hashPassword(input.password)
      : old.password_hash;
    const result = transaction(db, () => {
      const values = [
        input.username,
        input.name,
        passwordHash,
        input.unit_id,
        input.work_id,
        JSON.stringify(input.roles),
        JSON.stringify(input.roles.includes("head") ? input.scopes : []),
        input.active ? 1 : 0,
        input.line_user_id,
      ];
      let id;
      if (old) {
        db.prepare(
          "UPDATE users SET username=?,name=?,password_hash=?,unit_id=?,work_id=?,roles=?,scopes=?,active=?,line_user_id=? WHERE id=?",
        ).run(...values, old.id);
        id = old.id;
        db.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
      } else
        id = Number(
          db
            .prepare(
              "INSERT INTO users(username,name,password_hash,unit_id,work_id,roles,scopes,active,line_user_id) VALUES(?,?,?,?,?,?,?,?,?)",
            )
            .run(...values).lastInsertRowid,
        );
      if (input.line_user_id)
        db.prepare(
          "UPDATE inbox SET owner_id=? WHERE line_user_id=? AND owner_id IS NULL",
        ).run(id, input.line_user_id);
      const updated = publicUser(
        db.prepare("SELECT * FROM users WHERE id=?").get(id),
      );
      writeAudit(
        db,
        req.user,
        old ? "แก้ไขบัญชีและสิทธิ์" : "สร้างบัญชี",
        "user",
        id,
        publicUser(old),
        updated,
      );
      return updated;
    });
    res.status(old ? 200 : 201).json(result);
  }
  app.post("/api/admin/users", saveUser);
  app.put("/api/admin/users/:id", saveUser);
  registerMasterRoutes(app, db);
  app.get("/api/admin/audits", (req, res) => {
    let conditions = [],
      params = [];
    if (req.query.q) {
      conditions.push("(actor_name LIKE ? OR action LIKE ? OR entity LIKE ?)");
      params.push(...Array(3).fill(`%${String(req.query.q).slice(0, 200)}%`));
    }
    if (req.query.from) {
      conditions.push("created_at>=?");
      params.push(req.query.from);
    }
    if (req.query.to) {
      conditions.push("substr(created_at,1,10)<=?");
      params.push(req.query.to);
    }
    const where = conditions.length ? " WHERE " + conditions.join(" AND ") : "",
      page = Math.min(
        1000000,
        Math.max(1, Math.trunc(Number(req.query.page)) || 1),
      ),
      limit = 20;
    res.json({
      items: db
        .prepare(
          `SELECT * FROM audits${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, (page - 1) * limit),
      total: db
        .prepare(`SELECT COUNT(*) count FROM audits${where}`)
        .get(...params).count,
      page,
      limit,
    });
  });
  app.get("/api/admin/line", (req, res) =>
    res.json({
      receiveConfigured: Boolean(
        process.env.LINE_CHANNEL_SECRET && process.env.LINE_REPORT_GROUP_ID,
      ),
      sendConfigured: Boolean(
        process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_NEWS_GROUP_ID,
      ),
      lastReceived:
        db
          .prepare(
            "SELECT received_at FROM inbox WHERE event_id NOT LIKE 'demo:%' ORDER BY id DESC LIMIT 1",
          )
          .get()?.received_at || null,
      lastSent:
        db
          .prepare(
            "SELECT line_sent_at FROM news WHERE line_sent_at IS NOT NULL ORDER BY line_sent_at DESC LIMIT 1",
          )
          .get()?.line_sent_at || null,
      unmappedUsers: db
        .prepare(
          "SELECT DISTINCT line_user_id FROM inbox WHERE owner_id IS NULL",
        )
        .all(),
      webhookPath: "/api/line/webhook",
    }),
  );
}
