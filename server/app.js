import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { openDatabase, publicUser, ROLES } from "./db.js";
import {
  digest,
  httpError,
  token,
  verifyPassword,
  hashPassword,
} from "./security.js";
import { loginSchema } from "./validation.js";
import { registerDataRoutes } from "./data-routes.js";
import { registerAdminRoutes } from "./admin-routes.js";
import { registerNewsRoutes, registerLineWebhook } from "./news-routes.js";

export function createApp(options = {}) {
  const { db, dataDir } = openDatabase(options.dataDir);
  const app = express();
  const production = process.env.NODE_ENV === "production";
  const origins = (
    options.origins ||
    process.env.APP_ORIGIN ||
    "http://localhost:5173,http://localhost:3001"
  )
    .split(",")
    .map((s) => s.trim());
  app.disable("x-powered-by");
  app.param("id", (req, res, next, value) =>
    /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value))
      ? next()
      : next(httpError(400, "รหัสรายการไม่ถูกต้อง")),
  );
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", "blob:", "data:"],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameSrc: ["'self'", "blob:"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: production ? [] : null,
        },
      },
      strictTransportSecurity: production ? undefined : false,
    }),
  );
  app.get("/api/health", (req, res) => {
    db.prepare("SELECT 1").get();
    res.json({ status: "ok" });
  });
  registerLineWebhook(app, db, dataDir);
  app.use("/api", express.json({ limit: "1mb" }));
  app.use("/api", (req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!origins.includes(req.headers.origin))
        return next(httpError(403, "ต้นทางคำขอไม่ได้รับอนุญาต"));
      if (req.headers["sec-fetch-site"] === "cross-site")
        return next(httpError(403, "ไม่อนุญาตคำขอข้ามเว็บไซต์"));
    }
    next();
  });
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      message: { error: "มีคำขอมากเกินไป กรุณารอสักครู่" },
      skip: () => Boolean(options.disableRateLimit),
    }),
  );
  app.use("/api", (req, res, next) => {
    const cookie = (req.headers.cookie || "")
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("rm_session="))
      ?.slice(11);
    if (cookie && /^[a-f0-9]{64}$/.test(cookie)) {
      const session = db
        .prepare("SELECT * FROM sessions WHERE token_hash=? AND expires_at>?")
        .get(digest(cookie), Date.now());
      if (session) {
        const u = db
          .prepare("SELECT * FROM users WHERE id=? AND active=1")
          .get(session.user_id);
        if (u) {
          req.user = publicUser(u);
          req.session = session;
        }
      }
    }
    next();
  });
  const cookieOptions = {
    httpOnly: true,
    secure: production,
    sameSite: "strict",
    path: "/api",
    maxAge: 8 * 60 * 60 * 1000,
  };
  app.post("/api/auth/login", async (req, res) => {
    const input = loginSchema.parse(req.body);
    const key = digest(input.username.toLowerCase());
    const attempt = db
      .prepare("SELECT * FROM login_attempts WHERE key=?")
      .get(key);
    if (attempt?.blocked_until > Date.now())
      throw httpError(429, "เข้าสู่ระบบผิดหลายครั้ง กรุณารอ 15 นาที");
    const row = db
      .prepare("SELECT * FROM users WHERE username=?")
      .get(input.username);
    // A fixed valid hash forces the same password KDF work for unknown accounts.
    const fallback =
      "scrypt:00000000000000000000000000000000:" + "00".repeat(64);
    const valid = await verifyPassword(
      input.password,
      row?.password_hash || fallback,
    );
    if (!row || !row.active || !valid) {
      const failures =
        (attempt && Date.now() - attempt.last_at < 15 * 60_000
          ? attempt.failures
          : 0) + 1;
      db.prepare(
        "INSERT INTO login_attempts(key,failures,blocked_until,last_at) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET failures=excluded.failures,blocked_until=excluded.blocked_until,last_at=excluded.last_at",
      ).run(
        key,
        failures,
        failures >= 8 ? Date.now() + 15 * 60_000 : 0,
        Date.now(),
      );
      throw httpError(401, "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
    }
    db.prepare("DELETE FROM login_attempts WHERE key=?").run(key);
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(Date.now());
    if (req.session)
      db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
        req.session.token_hash,
      );
    const raw = token(),
      csrf = token();
    db.prepare(
      "INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)",
    ).run(digest(raw), row.id, csrf, Date.now() + cookieOptions.maxAge);
    res
      .cookie("rm_session", raw, cookieOptions)
      .json({ user: publicUser(row), csrf });
  });
  app.use("/api", (req, res, next) => {
    if (!req.user) return next(httpError(401, "กรุณาเข้าสู่ระบบ"));
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-csrf-token"] !== req.session.csrf
    )
      return next(httpError(403, "คำขอหมดอายุ กรุณาโหลดหน้าใหม่"));
    next();
  });
  app.get("/api/auth/me", (req, res) =>
    res.json({ user: req.user, csrf: req.session.csrf }),
  );
  app.post("/api/auth/logout", (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
      req.session.token_hash,
    );
    res
      .clearCookie("rm_session", { ...cookieOptions, maxAge: undefined })
      .json({ ok: true });
  });
  app.post("/api/auth/password", async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (
      typeof currentPassword !== "string" ||
      typeof newPassword !== "string" ||
      newPassword.length < 12 ||
      newPassword.length > 128
    )
      throw httpError(400, "รหัสผ่านใหม่ต้องยาว 12–128 ตัวอักษร");
    const row = db.prepare("SELECT * FROM users WHERE id=?").get(req.user.id);
    if (!(await verifyPassword(currentPassword, row.password_hash)))
      throw httpError(400, "รหัสผ่านปัจจุบันไม่ถูกต้อง");
    const password = await hashPassword(newPassword);
    db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(
      password,
      req.user.id,
    );
    db.prepare("DELETE FROM sessions WHERE user_id=?").run(req.user.id);
    res
      .clearCookie("rm_session", { ...cookieOptions, maxAge: undefined })
      .json({ ok: true });
  });
  app.get("/api/meta", (req, res) =>
    res.json({
      roles: ROLES,
      units: db.prepare("SELECT * FROM units ORDER BY sort_order,id").all(),
      works: db.prepare("SELECT * FROM works ORDER BY id").all(),
      categories: db.prepare("SELECT * FROM categories ORDER BY id").all(),
      ai: { configured: false },
      line: {
        receiveConfigured: Boolean(
          process.env.LINE_CHANNEL_SECRET && process.env.LINE_REPORT_GROUP_ID,
        ),
        sendConfigured: Boolean(
          process.env.LINE_CHANNEL_ACCESS_TOKEN &&
          process.env.LINE_NEWS_GROUP_ID,
        ),
      },
    }),
  );
  registerDataRoutes(app, db, dataDir);
  registerAdminRoutes(app, db);
  registerNewsRoutes(app, db);
  app.use("/api", (req, res) =>
    res.status(404).json({ error: "ไม่พบ API ที่เรียกใช้" }),
  );
  const dist = resolve("dist");
  if (existsSync(dist)) {
    app.use(express.static(dist, { index: false }));
    app.get("/{*path}", (req, res) =>
      res.sendFile(resolve(dist, "index.html")),
    );
  }
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.name === "ZodError")
      return res.status(400).json({
        error: "กรุณาตรวจข้อมูลที่กรอก",
        details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    if (err.code === "LIMIT_FILE_SIZE")
      return res.status(413).json({ error: "ขนาดไฟล์เกิน 20 MB" });
    if (err.code?.startsWith("LIMIT_"))
      return res
        .status(400)
        .json({ error: "จำนวนไฟล์หรือข้อมูลเกินขนาดที่รองรับ" });
    if (
      err.code === "ERR_SQLITE_ERROR" &&
      /UNIQUE constraint/.test(err.message)
    )
      return res
        .status(409)
        .json({ error: "ข้อมูลนี้มีอยู่แล้ว กรุณาใช้ชื่ออื่น" });
    const status = err.status || 500;
    if (status >= 500 && !err.status)
      console.error("Request failed:", err.message);
    res.status(status).json({
      error:
        status >= 500 && !err.status
          ? "ระบบไม่สามารถดำเนินการได้ กรุณาลองใหม่"
          : err.message,
    });
  });
  app.locals.db = db;
  app.locals.dataDir = dataDir;
  return app;
}
