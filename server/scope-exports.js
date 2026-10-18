import { makeTextDocx } from "./report-docx.js";
import { assertRead } from "./access.js";
import { httpError } from "./security.js";
import { writeAudit } from "./db.js";
export function registerScopeExports(app, db) {
  const send = (res, title, sections) =>
    res
      .type(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      )
      .attachment("RM-summary.docx")
      .send(makeTextDocx(title, sections));
  app.get("/api/hr-exports/:id/word", (req, res) => {
    const row = db
      .prepare("SELECT * FROM hr_exports WHERE id=? AND user_id=?")
      .get(Number(req.params.id), req.user.id);
    if (!row) throw httpError(404, "ไม่พบฉบับสรุป");
    const d = JSON.parse(row.payload);
    writeAudit(
      db,
      req.user,
      "ส่งออกสรุปผลงานบุคลากร",
      "hr_export",
      row.id,
      null,
      { format: "docx" },
    );
    send(res, d.template.name, [
      {
        heading: "ข้อมูลฉบับ",
        text: `${d.user.name} ${d.user.position}\n${d.from} ถึง ${d.to}\nข้อมูล ณ ${d.cutoff_at}\nแบบ ${d.template.name} รุ่น ${d.template.version}\nอ้างอิง ${d.template.reference}`,
      },
      ...d.template.headings.map((h) => ({
        heading: h,
        text: d.narrative[h] || "ยังไม่มีคำอธิบาย",
      })),
      {
        heading: "กิจกรรมและบทบาทที่ยืนยัน",
        text: d.rows
          .map(
            (a) =>
              `[${a.id}] ${a.date} ${a.title}\nบทบาท ${a.work_role}\n${a.result}`,
          )
          .join("\n\n"),
      },
      { heading: "หมายเหตุ", text: d.note },
    ]);
  });
  app.get("/api/scheduled-summaries/:id/word", (req, res) => {
    const row = db
      .prepare("SELECT * FROM scheduled_summaries WHERE id=? AND user_id=?")
      .get(Number(req.params.id), req.user.id);
    if (!row) throw httpError(404, "ไม่พบฉบับ");
    const d = JSON.parse(row.payload);
    for (const a of d.rows) assertRead(db, req.user, a);
    writeAudit(
      db,
      req.user,
      "ส่งออกสรุปตามรอบ",
      "scheduled_summary",
      row.id,
      null,
      { format: "docx" },
    );
    send(res, d.title, [
      {
        heading: "ข้อมูลฉบับ",
        text: `${d.scope}\n${d.range.from} ถึง ${d.range.to}\nข้อมูล ณ ${d.generated_at}\nกิจกรรมยืนยัน ${d.ready} กิจกรรม · ไม่รวมรอยืนยัน ${d.pending} / ซ้ำ ${d.duplicates}`,
      },
      {
        heading: "ผลเชิงปริมาณ",
        text: d.metrics
          .map((m) => `${m.label} ${m.value} ${m.unit} (${m.method || "sum"})`)
          .join("\n"),
      },
      {
        heading: "รายงานต้นทาง",
        text: d.rows
          .map(
            (a) =>
              `[${a.id}] ${a.date || "ยังไม่ระบุวัน"} ${a.title}\nสถานะ ${a.status}\n${a.result}`,
          )
          .join("\n\n"),
      },
      { heading: "หมายเหตุ", text: d.note },
    ]);
  });
}
