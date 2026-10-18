import { spawn } from "node:child_process";
import { unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { httpError } from "./security.js";
import { scopeSettings } from "./scope-routes.js";
import { writeAudit, transaction } from "./db.js";
export const virusStatus = () => ({
  configured: process.env.ANTIVIRUS_ENABLED === "1",
  engine: process.env.ANTIVIRUS_ENABLED === "1" ? "clamav" : null,
});
export async function scanFile(buffer) {
  if (process.env.ANTIVIRUS_ENABLED !== "1") return { state: "not_configured" };
  return new Promise((accept, reject) => {
    const child = spawn(
        process.env.CLAMSCAN_PATH || "clamscan",
        ["--no-summary", "-"],
        { stdio: ["pipe", "ignore", "ignore"] },
      ),
      timer = setTimeout(() => {
        child.kill();
        reject(httpError(503, "ตรวจไวรัสเกินเวลา กรุณาลองใหม่"));
      }, 30000);
    child.on("error", () => {
      clearTimeout(timer);
      reject(httpError(503, "ตัวตรวจไวรัสยังไม่พร้อม จึงยังไม่รับไฟล์"));
    });
    child.stdin.on("error", () => {});
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) accept({ state: "clean" });
      else
        reject(
          httpError(
            code === 1 ? 415 : 503,
            code === 1
              ? "ไฟล์ไม่ผ่านการตรวจไวรัส"
              : "ตรวจไฟล์ไม่สำเร็จ กรุณาตรวจการติดตั้งตัวตรวจไวรัส",
          ),
        );
    });
    child.stdin.end(buffer);
  });
}
const cutoffFor = (db, now) => {
  const days = scopeSettings(db).retention_days;
  return days ? new Date(now.getTime() - days * 86400000).toISOString() : null;
};
const heldActivity = (db, id) =>
  !!id &&
  (!!db
    .prepare(
      "SELECT 1 FROM project_tasks WHERE activity_id=? AND status='completed'",
    )
    .get(id) ||
    !!db
      .prepare(
        "SELECT 1 FROM summary_drafts d,json_each(d.snapshot_json,'$.rows') r WHERE d.status='confirmed' AND json_extract(r.value,'$.id')=?",
      )
      .get(id) ||
    !!db
      .prepare(
        "SELECT 1 FROM hr_exports h,json_each(h.payload,'$.rows') r WHERE json_extract(r.value,'$.id')=?",
      )
      .get(id));
export function textRetentionCandidates(db, now = new Date()) {
  const cutoff = cutoffFor(db, now);
  if (!cutoff) return [];
  return db
    .prepare(
      "SELECT id,title FROM activities WHERE created_at<? AND source_purged_at IS NULL AND (source_text!='' OR EXISTS(SELECT 1 FROM activity_extractions e WHERE e.activity_id=activities.id))",
    )
    .all(cutoff)
    .map((a) => ({ ...a, held: heldActivity(db, a.id) }));
}
export function retentionCandidates(db, now = new Date()) {
  const s = scopeSettings(db);
  if (!s.retention_days) return [];
  const cutoff = new Date(
    now.getTime() - s.retention_days * 86400000,
  ).toISOString();
  return db
    .prepare(
      "SELECT f.id,f.title,f.created_at,f.activity_id,f.storage_name FROM files f WHERE f.created_at<? AND NOT EXISTS(SELECT 1 FROM media_retention r WHERE r.file_id=f.id AND r.state='purged')",
    )
    .all(cutoff)
    .map((f) => {
      const held =
        !!db
          .prepare(
            "SELECT 1 FROM news n,json_each(n.image_ids) i WHERE i.value=? AND n.status='published'",
          )
          .get(f.id) || heldActivity(db, f.activity_id);
      return {
        ...f,
        held: Boolean(held),
        reason: held
          ? "เป็นหลักฐานที่ใช้ตรวจรับ ออกรายงาน หรือรูปข่าวเผยแพร่ จึงเก็บต่อ"
          : "ครบอายุเก็บตามค่ากลาง",
      };
    });
}
export async function runRetention(db, dataDir, actor, now = new Date()) {
  const s = scopeSettings(db);
  if (!s.retention_enabled) return { purged: 0, held: 0, enabled: false };
  let purged = 0,
    held = 0;
  for (const f of retentionCandidates(db, now)) {
    if (f.held) {
      held++;
      continue;
    }
    const marker = db
      .prepare(
        "INSERT INTO media_retention(file_id,state,reason) VALUES(?,'purging',?)",
      )
      .run(f.id, f.reason).lastInsertRowid;
    try {
      await unlink(resolve(dataDir, "uploads", f.storage_name));
    } catch (e) {
      if (e.code !== "ENOENT") {
        db.prepare("UPDATE media_retention SET state='failed' WHERE id=?").run(
          marker,
        );
        throw e;
      }
    }
    db.prepare("UPDATE media_retention SET state='purged' WHERE id=?").run(
      marker,
    );
    db.prepare("UPDATE files SET description='' WHERE id=?").run(f.id);
    writeAudit(db, actor, "ลบเนื้อไฟล์ครบอายุเก็บ", "file", f.id, null, {
      retention: true,
    });
    purged++;
  }
  let text_purged = 0;
  for (const a of textRetentionCandidates(db, now)) {
    if (a.held) {
      held++;
      continue;
    }
    transaction(db, () => {
      db.prepare(
        "UPDATE activities SET source_text='',source_purged_at=? WHERE id=?",
      ).run(now.toISOString(), a.id);
      db.prepare("DELETE FROM activity_extractions WHERE activity_id=?").run(
        a.id,
      );
      db.prepare("UPDATE inbox SET text='' WHERE activity_id=?").run(a.id);
      // Keep who/when/what, but do not retain deleted raw source in audit copies.
      for (const audit of db
        .prepare(
          "SELECT id,before_json,after_json FROM audits WHERE entity='activity' AND entity_id=?",
        )
        .all(a.id)) {
        const clean = (v) => {
          if (!v) return null;
          const o = JSON.parse(v);
          if (o && typeof o === "object") delete o.source_text;
          return JSON.stringify(o);
        };
        db.prepare(
          "UPDATE audits SET before_json=?,after_json=? WHERE id=?",
        ).run(clean(audit.before_json), clean(audit.after_json), audit.id);
      }
      writeAudit(
        db,
        actor,
        "ลบข้อความต้นฉบับครบอายุเก็บ",
        "activity",
        a.id,
        null,
        { retention: true },
      );
    });
    text_purged++;
  }
  const cutoff = cutoffFor(db, now);
  if (cutoff) {
    db.prepare(
      "UPDATE inbox SET text='' WHERE received_at<? AND activity_id IS NULL",
    ).run(cutoff);
    db.prepare(
      "UPDATE line_events SET payload=NULL,error='เนื้อหาครบอายุเก็บ' WHERE created_at<? AND state!='processed'",
    ).run(cutoff);
  }
  return { purged, text_purged, held, enabled: true };
}
export function registerFilePolicy(app, db, dataDir) {
  app.get("/api/file-policy/status", (req, res) => res.json(virusStatus()));
  app.get("/api/retention/preview", (req, res) => {
    if (!req.user.roles.includes("admin")) throw httpError(403, "เฉพาะผู้ดูแล");
    res.json({
      items: retentionCandidates(db).map(({ storage_name, ...f }) => f),
      texts: textRetentionCandidates(db),
    });
  });
  app.post("/api/retention/run", async (req, res) => {
    if (!req.user.roles.includes("admin")) throw httpError(403, "เฉพาะผู้ดูแล");
    res.json(await runRetention(db, dataDir, req.user));
  });
}
