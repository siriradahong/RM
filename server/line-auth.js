import { createHash } from "node:crypto";
import { z } from "zod";
import { token, digest, httpError, hashPassword } from "./security.js";
import { transaction, publicUser, writeAudit } from "./db.js";
import { effectiveUser } from "./access.js";
export const lineLoginReady = () =>
  Boolean(
    process.env.LINE_LOGIN_CHANNEL_ID &&
    process.env.LINE_LOGIN_CHANNEL_SECRET &&
    process.env.PUBLIC_BASE_URL,
  );
const base = () => new URL(process.env.PUBLIC_BASE_URL).origin;
const readCookie = (req, key) =>
  (req.headers.cookie || "")
    .split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith(key + "="))
    ?.slice(key.length + 1);
export function registerLineLogin(app, db, cookieOptions) {
  const session = (res, u) => {
    const raw = token(),
      csrf = token();
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      digest(raw),
      u.id,
      csrf,
      Date.now() + cookieOptions.maxAge,
    );
    res.cookie("rm_session", raw, cookieOptions);
    return csrf;
  };
  app.get("/api/auth/line/status", (req, res) =>
    res.json({ configured: lineLoginReady() }),
  );
  app.get("/api/auth/line/start", (req, res) => {
    if (!lineLoginReady())
      throw httpError(503, "ยังไม่ได้ตั้งค่าเข้าสู่ระบบด้วย LINE");
    const state = token(),
      nonce = token(),
      verifier = token(),
      challenge = createHash("sha256").update(verifier).digest("base64url");
    db.prepare("DELETE FROM line_login_states WHERE expires_at<?").run(
      Date.now(),
    );
    db.prepare("INSERT INTO line_login_states VALUES(?,?,?,?)").run(
      digest(state),
      nonce,
      verifier,
      Date.now() + 600000,
    );
    res.cookie("rm_line_state", state, {
      httpOnly: true,
      secure: cookieOptions.secure,
      sameSite: "lax",
      path: "/api/auth/line",
      maxAge: 600000,
    });
    const q = new URLSearchParams({
      response_type: "code",
      client_id: process.env.LINE_LOGIN_CHANNEL_ID,
      redirect_uri: base() + "/api/auth/line/callback",
      state,
      nonce,
      scope: "openid profile",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    res.redirect("https://access.line.me/oauth2/v2.1/authorize?" + q);
  });
  app.get("/api/auth/line/callback", async (req, res) => {
    if (!lineLoginReady()) throw httpError(503, "ยังไม่ได้ตั้งค่า LINE Login");
    const state = String(req.query.state || ""),
      saved = db
        .prepare(
          "SELECT * FROM line_login_states WHERE state_hash=? AND expires_at>?",
        )
        .get(digest(state), Date.now());
    if (
      !saved ||
      readCookie(req, "rm_line_state") !== state ||
      typeof req.query.code !== "string"
    )
      throw httpError(400, "คำขอเข้าสู่ระบบหมดอายุหรือไม่ตรงกัน");
    db.prepare("DELETE FROM line_login_states WHERE state_hash=?").run(
      digest(state),
    );
    res.clearCookie("rm_line_state", { path: "/api/auth/line" });
    const r = await fetch("https://api.line.me/oauth2/v2.1/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: req.query.code,
        redirect_uri: base() + "/api/auth/line/callback",
        client_id: process.env.LINE_LOGIN_CHANNEL_ID,
        client_secret: process.env.LINE_LOGIN_CHANNEL_SECRET,
        code_verifier: saved.code_verifier,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw httpError(502, "ยืนยันการเข้าสู่ LINE ไม่สำเร็จ");
    const payload = await r.json();
    const v = await fetch("https://api.line.me/oauth2/v2.1/verify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id_token: payload.id_token,
        client_id: process.env.LINE_LOGIN_CHANNEL_ID,
        nonce: saved.nonce,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!v.ok) throw httpError(401, "ยืนยันเจ้าของบัญชี LINE ไม่สำเร็จ");
    const profile = await v.json();
    if (
      !/^U[0-9a-f]{32}$/.test(profile.sub) ||
      profile.nonce !== saved.nonce ||
      String(profile.aud) !== process.env.LINE_LOGIN_CHANNEL_ID ||
      !Number.isFinite(profile.exp) ||
      profile.exp * 1000 <= Date.now()
    )
      throw httpError(401, "ข้อมูล LINE ไม่ถูกต้อง");
    const user = db
      .prepare("SELECT * FROM users WHERE line_user_id=?")
      .get(profile.sub);
    if (user) {
      if (!user.active)
        throw httpError(403, "บัญชีถูกระงับ กรุณาติดต่อผู้ดูแล");
      session(res, user);
      return res.redirect(base() + "/#");
    }
    if (req.session)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
        req.session.token_hash,
      );
    res.clearCookie("rm_session", { ...cookieOptions, maxAge: undefined });
    const raw = token();
    db.prepare("INSERT INTO line_registrations VALUES(?,?,?,?,?)").run(
      digest(raw),
      profile.sub,
      String(profile.name || "").slice(0, 200),
      profile.picture && /^https:\/\//.test(profile.picture)
        ? profile.picture
        : null,
      Date.now() + 600000,
    );
    res.redirect(base() + "/#line-register?token=" + raw);
  });
  app.get("/api/auth/line/registration", (req, res) => {
    const r = db
      .prepare(
        "SELECT display_name,avatar_url FROM line_registrations WHERE token_hash=? AND expires_at>?",
      )
      .get(digest(String(req.query.token || "")), Date.now());
    if (!r) throw httpError(401, "แบบลงทะเบียนหมดอายุ");
    res.json({
      ...r,
      units: db
        .prepare(
          "SELECT id,name,parent_id,kind FROM units WHERE active=1 ORDER BY sort_order,id",
        )
        .all(),
      works: db
        .prepare(
          "SELECT id,name,unit_id,parent_id FROM works WHERE active=1 ORDER BY id",
        )
        .all(),
    });
  });
  app.post("/api/auth/line/register", async (req, res) => {
    const input = z
      .object({
        registration_token: z.string().length(64),
        name: z.string().trim().min(1).max(200),
        unit_id: z.number().int().positive(),
        work_id: z.number().int().positive(),
        position: z.string().trim().min(1).max(200),
        personnel_type: z.string().trim().min(1).max(100),
        requested_role: z
          .enum(["staff", "head", "center_head", "executive"])
          .default("staff"),
      })
      .parse(req.body);
    const raw = digest(input.registration_token),
      r = db
        .prepare(
          "SELECT * FROM line_registrations WHERE token_hash=? AND expires_at>?",
        )
        .get(raw, Date.now());
    if (!r) throw httpError(401, "คำขอลงทะเบียนหมดอายุ");
    if (
      !db
        .prepare(
          "SELECT w.id FROM works w JOIN units u ON u.id=w.unit_id WHERE w.id=? AND w.unit_id=? AND w.active=1 AND u.active=1 AND u.kind!='section'",
        )
        .get(input.work_id, input.unit_id)
    )
      throw httpError(400, "กรุณาเลือกฝ่ายและงานที่เปิดใช้");
    const hash = await hashPassword(token());
    const key = transaction(db, () => {
      if (
        !db
          .prepare("DELETE FROM line_registrations WHERE token_hash=?")
          .run(raw).changes
      )
        throw httpError(409, "คำขอนี้ใช้แล้ว");
      const uid = Number(
        db
          .prepare(
            "INSERT INTO users(username,name,password_hash,unit_id,work_id,roles,line_user_id,position,personnel_type,avatar_url) VALUES(?,?,?,?,?,'[\"staff\"]',?,?,?,?)",
          )
          .run(
            "line_" + r.line_user_id.slice(1),
            input.name,
            hash,
            input.unit_id,
            input.work_id,
            r.line_user_id,
            input.position,
            input.personnel_type,
            r.avatar_url,
          ).lastInsertRowid,
      );
      db.prepare(
        "INSERT INTO personnel_history(user_id,unit_id,work_id,roles,effective_at) VALUES(?,?,?,'[\"staff\"]',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
      ).run(uid, input.unit_id, input.work_id);
      if (input.requested_role !== "staff")
        db.prepare(
          "INSERT INTO role_requests(user_id,requested_role,unit_id,work_id,reason) VALUES(?,?,?,?,?)",
        ).run(
          uid,
          input.requested_role,
          input.unit_id,
          input.work_id,
          "ขอยืนยันตำแหน่งจากการลงทะเบียน LINE",
        );
      writeAudit(
        db,
        { id: uid, name: input.name },
        "ลงทะเบียนผ่าน LINE",
        "user",
        uid,
        null,
        { unit_id: input.unit_id, work_id: input.work_id, role: "staff" },
      );
      return uid;
    });
    const u = db.prepare("SELECT * FROM users WHERE id=?").get(key),
      csrf = session(res, u);
    res.status(201).json({ user: effectiveUser(db, publicUser(u)), csrf });
  });
}
export function resolveRole(db, actor, requestId, approve, reason = "") {
  const r = db
    .prepare("SELECT * FROM role_requests WHERE id=? AND status='pending'")
    .get(requestId);
  if (!r) throw httpError(409, "คำขอผ่านการพิจารณาแล้ว");
  if (
    r.user_id === actor.id ||
    (!actor.roles.includes("admin") &&
      !actor.roles.includes("executive") &&
      !(
        actor.roles.includes("head") &&
        actor.scopes.includes(r.unit_id) &&
        r.requested_role === "center_head"
      ))
  )
    throw httpError(403, "ไม่มีสิทธิ์รับรองตำแหน่งนี้");
  transaction(db, () => {
    db.prepare(
      "UPDATE role_requests SET status=?,resolved_by=? WHERE id=?",
    ).run(approve ? "approved" : "rejected", actor.id, r.id);
    if (approve && r.requested_role === "transfer") {
      if (!actor.roles.includes("admin"))
        throw httpError(403, "ให้แอดมินตรวจย้ายสังกัด");
      db.prepare(
        "UPDATE users SET unit_id=?,work_id=?,roles='[\"staff\"]',scopes='[]',work_scopes='[]',active=1 WHERE id=?",
      ).run(r.unit_id, r.work_id, r.user_id);
      db.prepare(
        "INSERT INTO personnel_history(user_id,unit_id,work_id,roles,effective_at,recorded_by) VALUES(?,?,?,'[\"staff\"]',strftime('%Y-%m-%dT%H:%M:%fZ','now'),?)",
      ).run(r.user_id, r.unit_id, r.work_id, actor.id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(r.user_id);
    } else if (approve) {
      const u = db.prepare("SELECT * FROM users WHERE id=?").get(r.user_id),
        roles = [...new Set([...JSON.parse(u.roles), r.requested_role])];
      db.prepare(
        "UPDATE users SET roles=?,scopes=?,work_scopes=? WHERE id=?",
      ).run(
        JSON.stringify(roles),
        JSON.stringify(
          r.requested_role === "head" ? [r.unit_id] : JSON.parse(u.scopes),
        ),
        JSON.stringify(
          r.requested_role === "center_head"
            ? [r.work_id]
            : JSON.parse(u.work_scopes),
        ),
        u.id,
      );
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(u.id);
    }
    writeAudit(db, actor, "พิจารณารับรองตำแหน่ง", "role_request", r.id, r, {
      approve,
      reason,
    });
  });
  return r;
}
export function registerLineAccountRoutes(app, db) {
  app.post("/api/me/line-code", (req, res) => {
    if (req.user.line_user_id) throw httpError(409, "บัญชีนี้ผูก LINE แล้ว");
    const code = token().slice(0, 12).toUpperCase();
    db.prepare(
      "DELETE FROM line_link_codes WHERE user_id=? OR expires_at<?",
    ).run(req.user.id, Date.now());
    db.prepare("INSERT INTO line_link_codes VALUES(?,?,?)").run(
      digest(code),
      req.user.id,
      Date.now() + 600000,
    );
    res.json({
      code,
      expires_in: 600,
      instruction:
        "ส่งข้อความ ผูกบัญชี " +
        code +
        " ในแชตส่วนตัวของ LINE Official Account",
    });
  });
  app.get("/api/role-requests", (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT r.*,u.name FROM role_requests r JOIN users u ON u.id=r.user_id ORDER BY id DESC",
        )
        .all()
        .filter(
          (r) =>
            r.user_id === req.user.id ||
            req.user.roles.includes("admin") ||
            req.user.roles.includes("executive") ||
            (req.user.roles.includes("head") &&
              req.user.scopes.includes(r.unit_id)),
        ),
    }),
  );
  app.post("/api/role-requests/:id/resolve", (req, res) => {
    const p = z
      .object({
        approve: z.boolean(),
        reason: z.string().trim().min(1).max(2000),
      })
      .parse(req.body);
    resolveRole(db, req.user, Number(req.params.id), p.approve, p.reason);
    res.json({ ok: true });
  });
  app.post("/api/me/transfer", (req, res) => {
    const p = z
      .object({
        unit_id: z.number().int().positive(),
        work_id: z.number().int().positive(),
        reason: z.string().trim().min(1).max(2000),
      })
      .parse(req.body);
    if (
      !db
        .prepare("SELECT id FROM works WHERE id=? AND unit_id=? AND active=1")
        .get(p.work_id, p.unit_id)
    )
      throw httpError(400, "สังกัดใหม่ไม่ถูกต้อง");
    if (req.user.roles.includes("admin"))
      throw httpError(400, "บัญชีแอดมินให้ผู้ดูแลอีกคนจัดการ");
    transaction(db, () => {
      db.prepare("UPDATE users SET active=0 WHERE id=?").run(req.user.id);
      db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id);
      db.prepare(
        "INSERT INTO role_requests(user_id,requested_role,unit_id,work_id,reason) VALUES(?,'transfer',?,?,?)",
      ).run(req.user.id, p.unit_id, p.work_id, p.reason);
      writeAudit(
        db,
        req.user,
        "แจ้งย้ายสังกัดและพักบัญชีเดิม",
        "user",
        req.user.id,
        null,
        p,
      );
    });
    res.json({ ok: true });
  });
}
