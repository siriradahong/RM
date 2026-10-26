import { proposeWorkflow } from "./proposals.js";
import { applyTaskAction } from "./task-actions.js";
import { z } from "zod";
import { digest, httpError, canEdit } from "./security.js";
import { publicUser, writeAudit, transaction } from "./db.js";
import { effectiveUser, assertUnlocked } from "./access.js";
import { scopeSettings } from "./scope-routes.js";
import { suggestFields } from "./extraction-parser.js";
import { extractWithAI, aiStatus } from "./ai-provider.js";
import { runReader } from "./extraction-routes.js";
import { resolveRole } from "./line-auth.js";
import { resolve } from "node:path";
import { validDate } from "../shared/report-period.js";
export function createLineWorkflow(db, dataDir, download) {
  const send = async (event, text, quickReply) => {
    if (
      !scopeSettings(db).line_reply_enabled ||
      !process.env.LINE_CHANNEL_ACCESS_TOKEN
    )
      return;
    const r = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        replyToken: event.replyToken,
        messages: [
          {
            type: "text",
            text: text.slice(0, 4500),
            ...(quickReply
              ? {
                  quickReply: {
                    items: quickReply.slice(0, 13).map(([label, data]) => ({
                      type: "action",
                      action: {
                        type: "postback",
                        label: label.slice(0, 20),
                        data,
                      },
                    })),
                  },
                }
              : {}),
          },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw Error("LINE reply HTTP " + r.status);
  };
  const saveConversation = (uid, p) =>
    db
      .prepare(
        "INSERT INTO line_conversations VALUES(?,?,?) ON CONFLICT(line_user_id) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at",
      )
      .run(uid, JSON.stringify(p), Date.now() + 30 * 60000);
  const summary = async (event, a, questions = []) => {
    saveConversation(event.source.userId, {
      activity_id: a.id,
      version: a.version,
    });
    if (event.source.type !== "user")
      return send(
        event,
        "เก็บต้นฉบับแล้ว กรุณาเปิดแชตส่วนตัวกับบัญชีทางการเพื่อตรวจข้อมูล หรือเปิดระบบเว็บ",
      );
    const missing = [
      ...(!a.date ? ["วันที่"] : []),
      ...(!a.area ? ["สถานที่"] : []),
      ...(!a.category_id ? ["ประเภทงาน"] : []),
      ...(!a.workers ? ["ผู้ปฏิบัติงาน"] : []),
      ...(!a.result ? ["ผลการดำเนินงาน"] : []),
    ];
    await send(
      event,
      `เก็บต้นฉบับแล้ว ยังไม่รวมยอด\nเรื่อง: ${a.title.slice(0, 150)}\n${a.date || "ยังไม่ระบุวันที่"} · ${a.area || "ยังไม่ระบุสถานที่"}\n${missing.length ? "กรุณาเติม: " + missing.slice(0, 3).join(" / ") : "ตรวจข้อมูลและตัวเลขก่อนยืนยัน"}${questions.length ? "\n" + questions.slice(0, 2).join("\n") : ""}`,
      [
        ["ถูกต้อง", `rm=confirm&id=${a.id}&v=${a.version}`],
        ["แก้ไข", `rm=edit&id=${a.id}&v=${a.version}`],
        ["เพิ่มข้อความต่อ", `rm=append&id=${a.id}&v=${a.version}`],
        ["วันที่", `rm=field&id=${a.id}&field=date`],
        ["สถานที่", `rm=field&id=${a.id}&field=area`],
        ["ผลการดำเนินงาน", `rm=field&id=${a.id}&field=result`],
        ["ผู้ปฏิบัติงาน", `rm=field&id=${a.id}&field=workers`],
        ["ประเภทงาน", `rm=category&id=${a.id}`],
        ["ใช้เป็นข่าวด้วย", `rm=news&id=${a.id}`],
      ],
    );
  };
  return async function handle(event) {
    if (!["user", "group"].includes(event.source?.type)) return;
    const uid = event.source?.userId;
    if (!/^U[0-9a-f]{32}$/.test(uid || "")) return;
    const userRow = db
      .prepare("SELECT * FROM users WHERE line_user_id=?")
      .get(uid);
    if (event.type === "unfollow") {
      if (userRow && !JSON.parse(userRow.roles).includes("admin"))
        transaction(db, () => {
          db.prepare("UPDATE users SET active=0 WHERE id=?").run(userRow.id);
          db.prepare("DELETE FROM sessions WHERE user_id=?").run(userRow.id);
          writeAudit(
            db,
            publicUser(userRow),
            "พักบัญชีเมื่อเลิกติดตาม LINE",
            "user",
            userRow.id,
            null,
            { active: false },
          );
        });
      return;
    }
    if (
      event.source.type === "group" &&
      event.source.groupId !== process.env.LINE_REPORT_GROUP_ID
    )
      return;
    if (
      event.type === "message" &&
      event.message.type === "text" &&
      event.source.type === "user"
    ) {
      const m = event.message.text.trim().match(/^ผูกบัญชี\s+([A-F0-9]{12})$/i);
      if (m) {
        const code = db
          .prepare(
            "SELECT * FROM line_link_codes WHERE code_hash=? AND expires_at>?",
          )
          .get(digest(m[1].toUpperCase()), Date.now());
        if (!code)
          return send(
            event,
            "รหัสผูกบัญชีหมดอายุหรือไม่ถูกต้อง กรุณาสร้างใหม่จากบัญชีของฉัน",
          );
        if (userRow && userRow.id !== code.user_id)
          return send(event, "LINE นี้ผูกกับบัญชีอื่นแล้ว ให้ผู้ดูแลตรวจสอบ");
        transaction(db, () => {
          db.prepare("DELETE FROM line_link_codes WHERE code_hash=?").run(
            code.code_hash,
          );
          db.prepare(
            "UPDATE users SET line_user_id=? WHERE id=? AND active=1",
          ).run(uid, code.user_id);
          db.prepare(
            "UPDATE inbox SET owner_id=? WHERE line_user_id=? AND owner_id IS NULL",
          ).run(code.user_id, uid);
          writeAudit(
            db,
            { id: code.user_id, name: "เจ้าของบัญชี" },
            "ผูก LINE ด้วยรหัสครั้งเดียว",
            "user",
            code.user_id,
            null,
            { linked: true },
          );
        });
        return send(event, "ผูกบัญชีแล้ว ส่งรายงานในแชตนี้ได้เลย");
      }
    }
    if (!userRow || !userRow.active) {
      if (event.source.type === "user" && event.type !== "unfollow")
        return send(
          event,
          process.env.PUBLIC_BASE_URL
            ? "กรุณาเข้าสู่ระบบหรือสมัครผ่าน LINE ที่ " +
                new URL(process.env.PUBLIC_BASE_URL).origin
            : "บัญชีนี้ยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ",
        );
      return;
    }
    const user = effectiveUser(db, publicUser(userRow));
    if (user.assignment_review_required)
      return send(
        event,
        "บัญชีเดิมมีหลายบทบาทหรือหลายฝ่าย กรุณาให้แอดมินเลือกตำแหน่งหลักและสังกัดเดียวก่อนส่งรายงาน",
      );
    if (event.type === "postback") {
      const p = new URLSearchParams(event.postback.data || ""),
        action = p.get("rm");
      if (action === "role") {
        resolveRole(
          db,
          user,
          Number(p.get("id")),
          p.get("approve") === "1",
          "รับรองผ่าน LINE",
        );
        return send(event, "บันทึกผลรับรองตำแหน่งแล้ว");
      }
      if (
        ["taskcontinue", "taskdone", "tasksubmit", "taskextension"].includes(
          action,
        )
      ) {
        const t = db
          .prepare(
            "SELECT t.*,p.unit_id,p.status project_status FROM project_tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND t.assignee_id=?",
          )
          .get(Number(p.get("id")), user.id);
        if (!t || t.status === "completed" || t.project_status === "completed")
          return send(event, "งานนี้ไม่อยู่ในสิทธิ์หรือเสร็จแล้ว");
        if (action === "taskcontinue") {
          applyTaskAction(db, user, t.id, {
            action: "start",
            version: t.version,
          });
          return send(event, "บันทึกว่ายังดำเนินงานต่อแล้ว");
        }
        if (action === "taskdone") {
          const rows = db
            .prepare(
              "SELECT id,title FROM activities WHERE owner_id=? AND unit_id=? AND status='ready' AND duplicate_of IS NULL ORDER BY id DESC LIMIT 10",
            )
            .all(user.id, t.unit_id);
          return send(
            event,
            "เลือกรายงานที่เป็นหลักฐานส่งหัวหน้าตรวจรับ",
            rows.map((a) => [
              a.title,
              `rm=tasksubmit&id=${t.id}&activity=${a.id}&v=${t.version}`,
            ]),
          );
        }
        if (action === "tasksubmit") {
          applyTaskAction(db, user, t.id, {
            action: "submit",
            version: Number(p.get("v")),
            activity_id: Number(p.get("activity")),
          });
          return send(
            event,
            "ส่งรายงานให้หัวหน้าตรวจรับแล้ว ยังไม่นับว่าโครงการเสร็จ",
          );
        }
        saveConversation(uid, {
          task_id: t.id,
          version: t.version,
          field: "extension",
        });
        return send(
          event,
          "พิมพ์วันที่ขอส่งและเหตุผล เช่น 2026-10-30 รอประสานชุมชน",
        );
      }
      const a = db
        .prepare("SELECT * FROM activities WHERE id=?")
        .get(Number(p.get("id")));
      if (!a || a.owner_id !== user.id)
        return send(event, "ไม่มีสิทธิ์จัดการรายงานนี้");
      assertUnlocked(db, user, a);
      if (action === "append") {
        if (a.status !== "pending")
          return send(event, "รายงานยืนยันแล้ว ให้เปิดเว็บตรวจแก้ตามสิทธิ์");
        saveConversation(uid, {
          activity_id: a.id,
          version: a.version,
          field: "append",
        });
        return send(
          event,
          "ส่งข้อความส่วนที่เหลือต่อได้ ระบบจะเก็บรวมกับต้นฉบับเดิมของรายงานนี้",
        );
      }
      if (action === "edit") return summary(event, a);
      if (action === "field") {
        const field = z
          .enum(["date", "area", "workers", "result", "title"])
          .parse(p.get("field"));
        saveConversation(uid, { activity_id: a.id, version: a.version, field });
        return send(
          event,
          field === "date"
            ? "พิมพ์วันที่กิจกรรม เช่น 2026-10-21 (ไม่ใช้วันที่ส่งแทน)"
            : "พิมพ์" +
                {
                  area: "สถานที่",
                  workers: "ผู้ปฏิบัติงาน",
                  result: "ผลการดำเนินงานและตัวเลขพร้อมหน่วย",
                  title: "ชื่อเรื่อง",
                }[field] +
                " จากต้นฉบับ",
        );
      }
      if (action === "category")
        return send(
          event,
          "เลือกประเภทงาน",
          db
            .prepare(
              "SELECT id,name FROM categories WHERE active=1 ORDER BY id LIMIT 13",
            )
            .all()
            .map((c) => [
              c.name,
              `rm=setcategory&id=${a.id}&category=${c.id}&v=${a.version}`,
            ]),
        );
      if (action === "setcategory") {
        if (a.version !== Number(p.get("v")))
          return summary(event, a, ["ข้อมูลเปลี่ยน กรุณาเลือกอีกครั้ง"]);
        const c = db
          .prepare("SELECT id FROM categories WHERE id=? AND active=1")
          .get(Number(p.get("category")));
        if (!c) return;
        db.prepare(
          "UPDATE activities SET category_id=?,status='pending',owner_confirmed_at=NULL,version=version+1 WHERE id=?",
        ).run(c.id, a.id);
        writeAudit(
          db,
          user,
          "เลือกประเภทงานผ่าน LINE",
          "activity",
          a.id,
          null,
          { category_id: c.id },
        );
        return summary(
          event,
          db.prepare("SELECT * FROM activities WHERE id=?").get(a.id),
        );
      }
      if (action === "news") {
        if (a.status !== "ready")
          return send(event, "ยืนยันรายงานให้ครบก่อนส่งเข้าคิวข่าว");
        db.prepare(
          "INSERT OR IGNORE INTO news_candidates(activity_id,requested_by) VALUES(?,?)",
        ).run(a.id, user.id);
        return send(
          event,
          "ส่งเรื่องเข้าคิวประชาสัมพันธ์แล้ว เจ้าหน้าที่จะตรวจข้อความและเลือกรูปก่อนเผยแพร่",
        );
      }
      if (action === "confirm") {
        if (a.version !== Number(p.get("v")))
          return summary(event, a, ["ข้อมูลเปลี่ยน กรุณาตรวจฉบับล่าสุด"]);
        if (!a.date || !a.area || !a.workers || !a.result || !a.category_id)
          return summary(event, a);
        db.prepare(
          "UPDATE activities SET status='ready',owner_confirmed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),version=version+1 WHERE id=?",
        ).run(a.id);
        writeAudit(
          db,
          user,
          "เจ้าของยืนยันข้อมูลผ่าน LINE",
          "activity",
          a.id,
          { status: a.status },
          { status: "ready" },
        );
        return send(event, "ยืนยันแล้ว พร้อมนำไปสรุปผลงาน", [
          ["ส่งให้ประชาสัมพันธ์", `rm=news&id=${a.id}`],
        ]);
      }
      return;
    }
    if (
      event.type !== "message" ||
      !["text", "image", "file"].includes(event.message?.type) ||
      !user.roles.some((r) =>
        ["staff", "pr", "head", "center_head"].includes(r),
      )
    )
      return;
    if (
      event.message?.type === "text" &&
      /^(มอบหมาย|สั่งงาน|นัดหมาย|ประกาศนัด|เชิญประชุม)/.test(
        event.message.text.trim(),
      )
    ) {
      const kind = /^(มอบหมาย|สั่งงาน)/.test(event.message.text.trim())
        ? "assignment"
        : "event";
      const proposal = proposeWorkflow(
        db,
        user,
        kind,
        event.message.text.trim(),
      );
      return send(
        event,
        "เก็บข้อเสนอแล้ว ยังไม่สร้างงานหรือนัดหมาย กรุณาเปิดพื้นที่งานของฉัน → ข้อเสนอจากข้อความ เพื่อตรวจชื่อ วันที่ และผู้รับผิดชอบก่อนยืนยัน" +
          (process.env.PUBLIC_BASE_URL
            ? "\n" +
              new URL(process.env.PUBLIC_BASE_URL).origin +
              "/#workspace/proposals"
            : ""),
      );
    }
    const previous = db
        .prepare(
          "SELECT * FROM line_conversations WHERE line_user_id=? AND expires_at>?",
        )
        .get(uid, Date.now()),
      conversation = previous ? JSON.parse(previous.payload) : null;
    if (
      event.message.type === "text" &&
      conversation?.field === "extension" &&
      event.source.type === "user"
    ) {
      const m = event.message.text
          .trim()
          .match(/^(\d{4}-\d{2}-\d{2})\s+(.+)$/s),
        t = db
          .prepare("SELECT * FROM project_tasks WHERE id=? AND assignee_id=?")
          .get(conversation.task_id, user.id);
      if (
        !m ||
        !validDate(m[1]) ||
        !t ||
        m[1] <= t.due_date ||
        t.version !== conversation.version ||
        ["submitted", "completed"].includes(t.status)
      )
        return send(event, "ตรวจวันและงานอีกครั้ง ใช้รูปแบบ 2026-10-30 เหตุผล");
      if (
        db
          .prepare(
            "SELECT id FROM task_extensions WHERE task_id=? AND status='pending'",
          )
          .get(t.id)
      )
        return send(event, "มีคำขอรอพิจารณาแล้ว");
      db.prepare(
        "INSERT INTO task_extensions(task_id,requested_by,requested_date,reason) VALUES(?,?,?,?)",
      ).run(t.id, user.id, m[1], m[2].slice(0, 2000));
      db.prepare("DELETE FROM line_conversations WHERE line_user_id=?").run(
        uid,
      );
      writeAudit(
        db,
        user,
        "ขอเลื่อนกำหนดส่งผ่าน LINE",
        "project_task",
        t.id,
        null,
        { date: m[1] },
      );
      return send(event, "ส่งคำขอเลื่อนให้หัวหน้าพิจารณาแล้ว");
    }
    if (
      event.message.type === "text" &&
      conversation?.field === "append" &&
      event.source.type === "user"
    ) {
      const a = db
        .prepare("SELECT * FROM activities WHERE id=? AND owner_id=?")
        .get(conversation.activity_id, user.id);
      if (!a || a.status !== "pending" || a.version !== conversation.version)
        return send(event, "รายงานเปลี่ยนแล้ว กรุณาเปิดเว็บ");
      assertUnlocked(db, user, a);
      const text = a.source_text + "\n" + event.message.text;
      if (text.length > 20000)
        return send(
          event,
          "ข้อความรวมเกิน 20,000 ตัวอักษร กรุณาแนบเป็นเอกสารแทน",
        );
      transaction(db, () => {
        db.prepare(
          "INSERT OR IGNORE INTO inbox(event_id,line_user_id,owner_id,group_id,kind,text,message_id,received_at,activity_id) VALUES(?,?,?,'private','text',?,?,?,?)",
        ).run(
          event.webhookEventId,
          uid,
          user.id,
          event.message.text,
          event.message.id,
          new Date(event.timestamp).toISOString(),
          a.id,
        );
        db.prepare(
          "UPDATE activities SET source_text=?,version=version+1 WHERE id=?",
        ).run(text, a.id);
        const suggestions = suggestFields(text, {
          categories: db.prepare("SELECT * FROM categories").all(),
        });
        db.prepare(
          "INSERT INTO activity_extractions VALUES(?,?) ON CONFLICT(activity_id) DO UPDATE SET result_json=excluded.result_json",
        ).run(
          a.id,
          JSON.stringify({
            version: a.version + 1,
            parts: [],
            warnings: [],
            suggestions,
            created_at: new Date().toISOString(),
          }),
        );
        writeAudit(
          db,
          user,
          "เก็บข้อความส่วนที่เหลือต่อกับรายงานเดิม",
          "activity",
          a.id,
          null,
          { event_id: event.webhookEventId },
        );
      });
      return summary(
        event,
        db.prepare("SELECT * FROM activities WHERE id=?").get(a.id),
        ["อ่านข้อความครบทุกส่วนในเว็บก่อนยืนยัน"],
      );
    }
    if (
      event.message.type === "text" &&
      conversation?.field &&
      event.source.type === "user"
    ) {
      const a = db
        .prepare("SELECT * FROM activities WHERE id=?")
        .get(conversation.activity_id);
      if (!a || a.owner_id !== user.id || a.version !== conversation.version)
        return send(event, "รายงานเปลี่ยนแล้ว กรุณาเปิดดูฉบับล่าสุด");
      assertUnlocked(db, user, a);
      let value = event.message.text.trim().slice(0, 2000);
      const field = conversation.field;
      if (field === "date") {
        value = validDate(value) ? value : suggestFields(value).fields.date;
        if (!value)
          return send(event, "ยังอ่านวันที่ไม่ได้ กรุณาใช้รูปแบบ 2026-10-21");
      }
      db.prepare(
        `UPDATE activities SET ${field}=?,status='pending',version=version+1 WHERE id=?`,
      ).run(value, a.id);
      if (field === "result") {
        const proposed = suggestFields(value).fields.metrics;
        if (proposed)
          db.prepare("UPDATE activities SET metrics=? WHERE id=?").run(
            JSON.stringify(proposed),
            a.id,
          );
      }
      writeAudit(
        db,
        user,
        "เติมข้อมูลรายงานผ่าน LINE",
        "activity",
        a.id,
        null,
        { field },
      );
      return summary(
        event,
        db.prepare("SELECT * FROM activities WHERE id=?").get(a.id),
      );
    }
    const message = event.message.text || event.message.fileName || "";
    const appearsReport =
      /วันที่|ลงพื้นที่|ประชุม|กิจกรรม|อบรม|คัดกรอง|บริการ|รายงาน|จำนวน|เก็บขยะ|ผลการดำเนินงาน/.test(
        message,
      );
    let initialAI = null;
    if (event.message.type === "text" && !appearsReport) {
      if (!aiStatus().configured) return;
      try {
        initialAI = await extractWithAI(
          message,
          scopeSettings(db).ai_min_confidence,
        );
        if (!initialAI.is_report) return;
      } catch {
        return;
      }
    }
    if (!user.work_id || !user.unit_id)
      return send(event, "กรุณาให้ผู้ดูแลกำหนดฝ่ายและงานของบัญชีก่อนรับรายงาน");
    db.prepare(
      "INSERT OR IGNORE INTO inbox(event_id,line_user_id,owner_id,group_id,kind,text,message_id,received_at) VALUES(?,?,?,?,?,?,?,?)",
    ).run(
      event.webhookEventId,
      uid,
      user.id,
      event.source.groupId || "direct",
      event.message.type,
      message,
      event.message.id,
      new Date(event.timestamp).toISOString(),
    );
    const inbox = db
      .prepare("SELECT * FROM inbox WHERE event_id=?")
      .get(event.webhookEventId);
    let a = inbox.activity_id
      ? db.prepare("SELECT * FROM activities WHERE id=?").get(inbox.activity_id)
      : null;
    if (!a && event.message.type !== "text" && conversation?.activity_id) {
      const candidate = db
        .prepare("SELECT * FROM activities WHERE id=? AND owner_id=?")
        .get(conversation.activity_id, user.id);
      if (candidate && Date.now() - Date.parse(candidate.created_at) < 120000)
        a = candidate;
    }
    if (!a) {
      const key = Number(
        db
          .prepare(
            "INSERT INTO activities(title,unit_id,work_id,owner_id,status,source,source_text,intake,brief) VALUES(?,?,?,?,'pending','line',?,1,?)",
          )
          .run(
            (message.split("\n")[0] || "รายงานจากรูปเอกสาร").slice(0, 300),
            user.unit_id,
            user.work_id,
            user.id,
            event.message.type === "text" ? message.slice(0, 20000) : "",
            event.message.type === "text" ? 0 : 1,
          ).lastInsertRowid,
      );
      a = db.prepare("SELECT * FROM activities WHERE id=?").get(key);
    }
    assertUnlocked(db, user, a);
    db.prepare("UPDATE inbox SET activity_id=? WHERE id=?").run(a.id, inbox.id);
    let text = a.source_text,
      readParts = [];
    if (event.message.type !== "text") {
      const f = await download(
        db,
        dataDir,
        { ...inbox, unit_id: a.unit_id, work_id: a.work_id },
        user,
      );
      db.prepare("UPDATE files SET activity_id=? WHERE id=?").run(a.id, f.id);
      const file = db.prepare("SELECT * FROM files WHERE id=?").get(f.id);
      const read = await runReader(
        [{ ...file, path: resolve(dataDir, "uploads", file.storage_name) }],
        { includeImages: true },
      );
      readParts = read.parts;
      text += "\n" + read.parts.map((p) => p.text).join("\n");
    }
    let suggestions = suggestFields(text, {
      categories: db.prepare("SELECT * FROM categories").all(),
      units: db.prepare("SELECT * FROM units").all(),
      metrics: db
        .prepare(
          "SELECT config FROM summary_templates WHERE active=1 AND (unit_id IS NULL OR unit_id=?)",
        )
        .all(a.unit_id)
        .flatMap((t) => JSON.parse(t.config).metrics),
    });
    if (aiStatus().configured) {
      try {
        const ai =
          initialAI ||
          (await extractWithAI(text, scopeSettings(db).ai_min_confidence));
        if (!ai.is_report && event.message.type === "text" && !appearsReport) {
          db.prepare(
            "UPDATE activities SET title='ข้อความที่ไม่ใช่รายงาน',brief=1 WHERE id=?",
          ).run(a.id);
          return;
        }
        suggestions = {
          ...suggestions,
          ...ai,
          fields: { ...suggestions.fields, ...ai.fields },
          warnings: [...suggestions.warnings, ...ai.warnings],
        };
      } catch {
        suggestions.warnings.push(
          "โมเดลไม่พร้อม ใช้ข้อความที่อ่านได้และตรวจเอง",
        );
      }
    }
    const fields = suggestions.fields;
    db.prepare(
      "INSERT INTO activity_extractions(activity_id,result_json) VALUES(?,?) ON CONFLICT(activity_id) DO UPDATE SET result_json=excluded.result_json",
    ).run(
      a.id,
      JSON.stringify({
        suggestions,
        parts: readParts,
        warnings: [],
        version: a.version + 1,
        created_at: new Date().toISOString(),
      }),
    );
    db.prepare(
      "UPDATE activities SET title=?,date=?,area=?,workers=?,result=?,category_id=?,metrics=?,version=version+1 WHERE id=?",
    ).run(
      fields.title || a.title,
      fields.date || a.date,
      fields.area || a.area,
      fields.workers || a.workers,
      fields.result || a.result,
      fields.category_id || a.category_id,
      JSON.stringify(fields.metrics || JSON.parse(a.metrics)),
      a.id,
    );
    writeAudit(
      db,
      user,
      "รับต้นฉบับและเสนอข้อมูลจาก LINE",
      "activity",
      a.id,
      null,
      { source_event: event.webhookEventId, confirmed: false },
    );
    return summary(
      event,
      db.prepare("SELECT * FROM activities WHERE id=?").get(a.id),
      suggestions.warnings,
    );
  };
}
