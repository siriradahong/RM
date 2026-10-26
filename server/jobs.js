import { runRetention } from "./file-policy.js";
import { manages } from "./access.js";
import { scopeSettings } from "./scope-routes.js";
import { publicUser, writeAudit, transaction } from "./db.js";
import { effectiveUser, canRead } from "./access.js";
import { buildReport } from "./report-routes.js";
import { reportPeriod } from "../shared/report-period.js";
import { httpError } from "./security.js";
const local = (now) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
export function notify(db, userId, kind, title, body, route, key) {
  return (
    db
      .prepare(
        "INSERT OR IGNORE INTO notifications(user_id,kind,title,body,route,dedupe_key) VALUES(?,?,?,?,?,?)",
      )
      .run(userId, kind, title, body, route, key).changes > 0
  );
}
export async function runJobs(db, now = new Date(), dataDir = null) {
  db.prepare("DELETE FROM line_conversations WHERE expires_at<?").run(
    now.getTime(),
  );
  db.prepare("DELETE FROM line_login_states WHERE expires_at<?").run(
    now.getTime(),
  );
  db.prepare("DELETE FROM line_registrations WHERE expires_at<?").run(
    now.getTime(),
  );
  db.prepare("DELETE FROM line_link_codes WHERE expires_at<?").run(
    now.getTime(),
  );
  const settings = scopeSettings(db),
    stamp = local(now),
    day = stamp.slice(0, 10),
    time = stamp.slice(11, 16),
    weekDay = new Date(day).getUTCDay();
  let reminders = 0,
    summaries = 0;
  const users = db
    .prepare("SELECT * FROM users WHERE active=1")
    .all()
    .map((u) => effectiveUser(db, publicUser(u), now.toISOString()))
    .filter((u) => !u.assignment_review_required);
  if (
    settings.reminders_enabled &&
    (!settings.skip_weekends || ![0, 6].includes(weekDay)) &&
    !settings.holidays.includes(day)
  ) {
    const tasks = db
      .prepare(
        "SELECT t.*,p.title project_title,p.unit_id,p.work_id,p.created_by FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE t.status!='completed' AND p.status!='completed'",
      )
      .all();
    for (const t of tasks) {
      const user = users.find((u) => u.id === t.assignee_id);
      if (!user) continue;
      const pref = db
        .prepare("SELECT * FROM personal_preferences WHERE user_id=?")
        .get(user.id) || { reminder_time: "09:00", channel: "web" };
      if (time < pref.reminder_time) continue;
      if (
        notify(
          db,
          user.id,
          "task",
          `ติดตามงาน: ${t.title}`,
          `กำหนดส่ง ${t.due_date}`,
          "projects",
          `task:${t.id}:${user.id}:${day}`,
        )
      )
        reminders++;
      const since = t.last_update_at || t.updated_at || t.created_at,
        days = Math.floor(
          (Date.parse(day) - Date.parse(since.slice(0, 10))) / 86400000,
        );
      const recipients =
        days >= settings.escalate_executive_after_days
          ? users.filter((u) => u.roles.includes("executive"))
          : days >= settings.escalate_after_days
            ? users.filter(
                (u) => u.roles.includes("head") && u.scopes.includes(t.unit_id),
              )
            : days >= 1
              ? users.filter(
                  (u) =>
                    u.roles.includes("center_head") &&
                    u.work_scopes.includes(t.work_id),
                )
              : [];
      for (const head of recipients)
        if (
          notify(
            db,
            head.id,
            "escalation",
            `งานยังไม่มีอัปเดต ${days} วัน`,
            t.title,
            "projects",
            `escalation:${t.id}:${head.id}:${day}`,
          )
        )
          reminders++;
    }
    for (const e of db
      .prepare(
        "SELECT e.*,a.user_id FROM calendar_events e JOIN calendar_attendees a ON a.event_id=e.id WHERE e.date=?",
      )
      .all(new Date(Date.parse(day) + 86400000).toISOString().slice(0, 10)))
      if (users.some((u) => u.id === e.user_id))
        notify(
          db,
          e.user_id,
          "event",
          `นัดหมายวันพรุ่งนี้: ${e.title}`,
          e.start_time ? `${e.start_time}–${e.end_time}` : "ยังไม่ระบุเวลา",
          "dashboard/mine",
          `event:${e.id}:${e.user_id}:${day}`,
        );
  }
  if (settings.summaries_enabled && day.endsWith("-01")) {
    const previousDate = new Date(Date.parse(day) - 86400000)
        .toISOString()
        .slice(0, 10),
      month = Number(day.slice(5, 7)),
      periods = [
        "month",
        ...([1, 4, 7, 10].includes(month) ? ["quarter"] : []),
        ...(month === 10 ? ["year"] : []),
      ];
    for (const user of users.filter((u) =>
      u.roles.some((r) =>
        ["staff", "pr", "head", "center_head", "executive"].includes(r),
      ),
    ))
      for (const period of periods) {
        const scope = user.roles.includes("executive")
          ? "all"
          : user.roles.includes("head") || user.roles.includes("center_head")
            ? "unit"
            : "mine";
        const key = `${user.id}:${scope}:${period}:${day}`;
        if (
          db
            .prepare("SELECT 1 FROM scheduled_summaries WHERE schedule_key=?")
            .get(key)
        )
          continue;
        const payload = buildReport(db, {
          user,
          query: { period, anchor: previousDate, scope },
        });
        const id = Number(
          db
            .prepare(
              "INSERT INTO scheduled_summaries(schedule_key,user_id,payload) VALUES(?,?,?)",
            )
            .run(key, user.id, JSON.stringify(payload)).lastInsertRowid,
        );
        notify(
          db,
          user.id,
          "summary",
          "สรุปผลงานตามรอบพร้อมตรวจ",
          `${payload.title} · กิจกรรมยืนยัน ${payload.ready} · รอยืนยัน ${payload.pending} · ซ้ำ ${payload.duplicates}`,
          `workspace/scheduled/${id}`,
          `summary:${key}`,
        );
        summaries++;
      }
  }
  for (const request of db
    .prepare(
      "SELECT r.*,u.name FROM role_requests r JOIN users u ON u.id=r.user_id WHERE r.status='pending'",
    )
    .all()) {
    for (const approver of users.filter(
      (u) =>
        u.id !== request.user_id &&
        (u.roles.includes("admin") ||
          (u.roles.includes("executive") &&
            request.requested_role !== "transfer") ||
          (u.roles.includes("head") &&
            u.scopes.includes(request.unit_id) &&
            request.requested_role === "center_head")),
    ))
      notify(
        db,
        approver.id,
        "role",
        "มีคำขอรับรองตำแหน่งหรือย้ายสังกัด",
        request.name,
        "workspace/approvals",
        `role:${request.id}:${approver.id}`,
      );
  }
  if (
    dataDir &&
    settings.retention_enabled &&
    time >= "02:00" &&
    !db.prepare("SELECT 1 FROM scope_job_runs WHERE day=?").get(day)
  ) {
    await runRetention(db, dataDir, null, now);
    db.prepare("INSERT OR IGNORE INTO scope_job_runs(day) VALUES(?)").run(day);
  }
  // Delivery is separate from creating the in-app reminder, so failures remain visible and retryable.
  if (
    settings.line_reminders_enabled &&
    process.env.LINE_CHANNEL_ACCESS_TOKEN
  ) {
    for (const n of db
      .prepare(
        "SELECT n.*,u.line_user_id,p.channel FROM notifications n JOIN users u ON u.id=n.user_id JOIN personal_preferences p ON p.user_id=u.id WHERE n.delivery_state IN ('web','failed') AND u.active=1 AND p.channel='line' AND u.line_user_id IS NOT NULL AND date(n.created_at,'+7 hours')>=? LIMIT 30",
      )
      .all(day)) {
      try {
        const response = await fetch(
          "https://api.line.me/v2/bot/message/push",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
              "X-Line-Retry-Key": deliveryKey(n.id),
            },
            body: JSON.stringify({
              to: n.line_user_id,
              messages: [
                {
                  type: "text",
                  text:
                    n.title +
                    (n.kind === "summary" ? "\n" + n.body : "") +
                    (process.env.PUBLIC_BASE_URL
                      ? "\nเปิดดู " +
                        new URL(process.env.PUBLIC_BASE_URL).origin +
                        "/#" +
                        n.route
                      : "\nเปิดระบบเพื่อตรวจรายละเอียดและตอบรับงาน"),
                  ...(n.kind === "role"
                    ? {
                        quickReply: {
                          items: [
                            ["รับรองตำแหน่ง", "1"],
                            ["ไม่รับรอง", "0"],
                          ].map(([label, approve]) => ({
                            type: "action",
                            action: {
                              type: "postback",
                              label,
                              data: `rm=role&id=${n.dedupe_key.split(":")[1]}&approve=${approve}`,
                            },
                          })),
                        },
                      }
                    : {}),
                  ...(n.kind === "task"
                    ? {
                        quickReply: {
                          items: [
                            ["ยังดำเนินงานต่อ", "taskcontinue"],
                            ["ส่งรายงานตรวจรับ", "taskdone"],
                            ["ขอเลื่อนกำหนด", "taskextension"],
                          ].map(([label, action]) => ({
                            type: "action",
                            action: {
                              type: "postback",
                              label,
                              data: `rm=${action}&id=${n.dedupe_key.split(":")[1]}`,
                            },
                          })),
                        },
                      }
                    : {}),
                },
              ],
            }),
            signal: AbortSignal.timeout(10000),
          },
        );
        if (
          !response.ok &&
          !(
            response.status === 409 &&
            response.headers.get("x-line-accepted-request-id")
          )
        )
          throw Error("LINE delivery failed");
        db.prepare(
          "UPDATE notifications SET delivery_state='accepted' WHERE id=?",
        ).run(n.id);
      } catch {
        db.prepare(
          "UPDATE notifications SET delivery_state='failed' WHERE id=?",
        ).run(n.id);
      }
    }
  }
  return { reminders, summaries, day };
}
function deliveryKey(id) {
  const h = String(id).padStart(12, "0");
  return `00000000-0000-4000-8000-${h}`;
}
export function startJobs(db, dataDir) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await runJobs(db, new Date(), dataDir);
    } catch (e) {
      console.error("งานตามรอบยังไม่สำเร็จ:", e.message);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 60000);
  timer.unref();
  tick();
  return () => clearInterval(timer);
}
export function registerJobRoutes(app, db, dataDir) {
  app.post("/api/scope/jobs/run", async (req, res) => {
    if (!req.user.roles.includes("admin")) throw httpError(403, "เฉพาะแอดมิน");
    const result = await runJobs(db, new Date(), dataDir);
    writeAudit(
      db,
      req.user,
      "ประมวลผลงานตามรอบ",
      "scheduler",
      null,
      null,
      result,
    );
    res.json(result);
  });
  app.post("/api/tasks/:id/update", (req, res) => {
    const t = db
      .prepare("SELECT * FROM project_tasks WHERE id=?")
      .get(Number(req.params.id));
    if (!t || t.assignee_id !== req.user.id || t.status === "completed")
      throw httpError(403, "เฉพาะผู้รับผิดชอบงานที่ยังไม่เสร็จ");
    db.prepare(
      "UPDATE project_tasks SET last_update_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1 WHERE id=?",
    ).run(t.id);
    writeAudit(db, req.user, "อัปเดตงานประจำวัน", "project_task", t.id, null, {
      continues: true,
    });
    res.json({ ok: true });
  });
  app.post("/api/tasks/:id/extensions", (req, res) => {
    const t = db
      .prepare("SELECT * FROM project_tasks WHERE id=?")
      .get(Number(req.params.id));
    if (!t || t.assignee_id !== req.user.id || t.status === "completed")
      throw httpError(403, "ไม่มีสิทธิ์");
    if (req.body.date <= t.due_date)
      throw httpError(400, "วันขอเลื่อนต้องหลังวันครบกำหนดเดิม");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ||
      Number.isNaN(Date.parse(req.body.date)) ||
      new Date(req.body.date).toISOString().slice(0, 10) !== req.body.date ||
      typeof req.body.reason !== "string" ||
      !req.body.reason.trim() ||
      req.body.reason.length > 2000
    )
      throw httpError(400, "ระบุวันที่และเหตุผล");
    if (
      db
        .prepare(
          "SELECT id FROM task_extensions WHERE task_id=? AND status='pending'",
        )
        .get(t.id)
    )
      throw httpError(409, "มีคำขอรอพิจารณาแล้ว");
    const key = Number(
      db
        .prepare(
          "INSERT INTO task_extensions(task_id,requested_by,requested_date,reason) VALUES(?,?,?,?)",
        )
        .run(t.id, req.user.id, req.body.date, req.body.reason).lastInsertRowid,
    );
    res.status(201).json({ id: key });
  });
  app.get("/api/task-extensions", (req, res) =>
    res.json({
      items: db
        .prepare(
          "SELECT e.*,t.title,p.unit_id,p.work_id FROM task_extensions e JOIN project_tasks t ON t.id=e.task_id JOIN projects p ON p.id=t.project_id ORDER BY e.id DESC",
        )
        .all()
        .filter(
          (e) =>
            e.requested_by === req.user.id ||
            manages(req.user, e) ||
            req.user.roles.includes("executive"),
        ),
    }),
  );
  app.post("/api/task-extensions/:id/resolve", (req, res) => {
    const r = db
      .prepare(
        "SELECT e.*,p.unit_id,p.work_id,t.project_id,p.due_date project_due_date,t.status task_status,p.status project_status FROM task_extensions e JOIN project_tasks t ON t.id=e.task_id JOIN projects p ON p.id=t.project_id WHERE e.id=?",
      )
      .get(Number(req.params.id));
    if (
      !r ||
      r.status !== "pending" ||
      !(manages(req.user, r) || req.user.roles.includes("executive")) ||
      r.requested_by === req.user.id
    )
      throw httpError(403, "เฉพาะหัวหน้าผู้รับผิดชอบและไม่ใช่คำขอของตน");
    if (typeof req.body.approve !== "boolean")
      throw httpError(400, "ระบุผลพิจารณา");
    if (
      req.body.approve &&
      (["submitted", "completed"].includes(r.task_status) ||
        r.project_status === "completed")
    )
      throw httpError(
        409,
        "งานส่งตรวจหรือปิดโครงการแล้ว ไม่สามารถเลื่อนกำหนดได้",
      );
    transaction(db, () => {
      db.prepare(
        "UPDATE task_extensions SET status=?,resolved_by=? WHERE id=?",
      ).run(req.body.approve ? "approved" : "rejected", req.user.id, r.id);
      if (req.body.approve && r.requested_date > r.project_due_date)
        db.prepare(
          "UPDATE projects SET due_date=?,version=version+1 WHERE id=?",
        ).run(r.requested_date, r.project_id);
      if (req.body.approve)
        db.prepare(
          "UPDATE project_tasks SET due_date=?,version=version+1 WHERE id=?",
        ).run(r.requested_date, r.task_id);
      writeAudit(
        db,
        req.user,
        "พิจารณาขอเลื่อนกำหนดส่ง",
        "project_task",
        r.task_id,
        r,
        { approved: req.body.approve },
      );
    });
    res.json({ ok: true });
  });
}
