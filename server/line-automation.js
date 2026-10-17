import { publicUser, writeAudit } from "./db.js";
import { canEdit, httpError } from "./security.js";
import { readDocument, modelExtract } from "./extraction.js";
import { settings } from "./insights.js";
const running = new Set();
export async function analyzeInbox(db, dataDir, row, user) {
  if (
    !row.owner_id ||
    !canEdit(user, { owner_id: row.owner_id, unit_id: row.unit_id })
  )
    throw httpError(403, "ไม่มีสิทธิ์จัดข้อมูลของผู้รายงานนี้");
  let text = row.text || "";
  const warnings = [];
  if (row.file_id) {
    const f = db.prepare("SELECT * FROM files WHERE id=?").get(row.file_id);
    const read = await readDocument(f, dataDir);
    text += "\n" + read.text;
    warnings.push(...read.warnings);
  }
  if (!text.trim())
    throw httpError(
      422,
      "ไม่มีข้อความที่อ่านได้ โปรดดาวน์โหลดไฟล์หรือตั้งค่าตัวอ่านเอกสารก่อน",
    );
  const data = await modelExtract(
    text,
    db.prepare("SELECT * FROM categories WHERE active=1").all(),
  );
  data.warnings.push(...warnings);
  const owner = db
    .prepare("SELECT id FROM users WHERE id=? AND active=1")
    .get(row.owner_id);
  if (!owner) throw httpError(409, "บัญชีผู้รายงานถูกระงับระหว่างประมวลผล");
  db.prepare(
    "INSERT INTO inbox_analysis(inbox_id,payload) VALUES(?,?) ON CONFLICT(inbox_id) DO UPDATE SET payload=excluded.payload",
  ).run(row.id, JSON.stringify(data));
  writeAudit(db, user, "เสนอข้อมูลจากข้อความ LINE", "inbox", row.id, null, {
    engine: data.engine,
    is_report: data.is_report,
  });
  return data;
}
export function queueLineAutomation(db, dataDir, event, row, download) {
  if (!settings(db).line_reply_enabled || running.has(row.id)) return;
  running.add(row.id);
  const work = async () => {
    db.prepare(
      "INSERT INTO inbox_jobs(inbox_id,state) VALUES(?,'running') ON CONFLICT(inbox_id) DO UPDATE SET state='running',error=NULL",
    ).run(row.id);
    const user = publicUser(
      db
        .prepare("SELECT * FROM users WHERE id=? AND active=1")
        .get(row.owner_id),
    );
    if (!user) throw httpError(400, "ยังไม่ผูกบัญชีผู้รายงาน");
    // Reply acknowledges storage only. It never certifies an activity or repeats sensitive source content.
    const url = process.env.PUBLIC_APP_URL,
      token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const likelyReport =
      row.kind !== "text" ||
      /(รายงาน|กิจกรรม|ประชุม|ลงพื้นที่|คัดกรอง|อบรม|ขยะ|วัคซีน|ดำเนินงาน)/.test(
        row.text,
      );
    if (url && token && event.replyToken && likelyReport) {
      const reply = await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        signal: AbortSignal.timeout(8000),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          replyToken: event.replyToken,
          messages: [
            {
              type: "text",
              text: "รับข้อมูลต้นฉบับแล้วค่ะ เลือกข้อความและรูปของงานเดียวกันเพื่อตรวจข้อมูลและยืนยันก่อนสรุป",
              quickReply: {
                items: [
                  {
                    type: "action",
                    action: {
                      type: "uri",
                      label: "จัดชุดและตรวจรายงาน",
                      uri: new URL("/#inbox", url).href,
                    },
                  },
                ],
              },
            },
          ],
        }),
      });
      if (!reply.ok)
        throw httpError(502, "รับข้อมูลแล้ว แต่ตอบกลับ LINE ไม่สำเร็จ");
    }
    if (["image", "file"].includes(row.kind) && !row.file_id) {
      const f = await download(db, dataDir, row, user);
      row.file_id = f.id;
    }
    const owner = db
      .prepare("SELECT unit_id FROM users WHERE id=?")
      .get(row.owner_id);
    await analyzeInbox(db, dataDir, { ...row, unit_id: owner.unit_id }, user);
    db.prepare(
      "UPDATE inbox_jobs SET state='done',error=NULL WHERE inbox_id=?",
    ).run(row.id);
  };
  setImmediate(() =>
    work()
      .catch((e) => {
        try {
          db.prepare(
            "UPDATE inbox_jobs SET state='failed',error=? WHERE inbox_id=?",
          ).run(e.message, row.id);
        } catch {}
      })
      .finally(() => running.delete(row.id)),
  );
}
export function registerInboxAnalysis(app, db, dataDir) {
  app.post("/api/inbox/:id/analyze", async (req, res) => {
    const row = db
      .prepare(
        "SELECT i.*,u.unit_id FROM inbox i LEFT JOIN users u ON u.id=i.owner_id WHERE i.id=?",
      )
      .get(+req.params.id);
    if (!row) throw httpError(404, "ไม่พบข้อความ");
    res.json(await analyzeInbox(db, dataDir, row, req.user));
  });
  app.post("/api/files/:id/read", async (req, res) => {
    const f = db.prepare("SELECT * FROM files WHERE id=?").get(+req.params.id);
    if (!f) throw httpError(404, "ไม่พบไฟล์");
    if (!canEdit(req.user, f))
      throw httpError(403, "ไม่มีสิทธิ์อ่านข้อความไฟล์นี้");
    const out = await readDocument(f, dataDir);
    if (out.text) {
      const current = db.prepare("SELECT * FROM files WHERE id=?").get(f.id);
      if (!canEdit(req.user, current))
        throw httpError(403, "สิทธิ์เปลี่ยนระหว่างอ่านข้อความ");
      db.prepare(
        "INSERT INTO file_texts(file_id,text) VALUES(?,?) ON CONFLICT(file_id) DO UPDATE SET text=excluded.text",
      ).run(f.id, out.text);
      writeAudit(
        db,
        req.user,
        "อ่านข้อความไฟล์เพื่อค้นหา",
        "file",
        f.id,
        null,
        { characters: out.text.length },
      );
    }
    res.json({ ...out, indexed: !!out.text });
  });
}
