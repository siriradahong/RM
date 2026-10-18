import { fork } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { z } from "zod";
import { canEdit, httpError } from "./security.js";
import { writeAudit, transaction } from "./db.js";
import { suggestFields } from "./extraction-parser.js";
const modelDir = () => resolve(process.env.OCR_MODEL_DIR || "data/ocr");
export const extractionStatus = () => ({
  local: true,
  pdf: true,
  xlsx: true,
  ocr: ["tha", "eng"].every((l) =>
    existsSync(resolve(modelDir(), l + ".traineddata")),
  ),
  ai: false,
});
export function runReader(
  files,
  { includeImages = false, timeout = 120000 } = {},
) {
  return new Promise((resolveResult, reject) => {
    const child = fork(
      fileURLToPath(new URL("./extraction-worker.js", import.meta.url)),
      [],
      {
        execArgv: ["--max-old-space-size=384"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    let done = false;
    const finish = (error, result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      error ? reject(error) : resolveResult(result);
    };
    const timer = setTimeout(
      () =>
        finish(
          httpError(
            408,
            "อ่านไฟล์เกินเวลาที่กำหนด กรุณาลองทีละไฟล์หรือแบ่งเอกสาร",
          ),
        ),
      timeout,
    );
    child.once("error", () => finish(httpError(422, "เริ่มอ่านไฟล์ไม่สำเร็จ")));
    child.once("exit", () =>
      finish(httpError(422, "ไฟล์ซับซ้อนเกินขอบเขตการอ่าน กรุณาแบ่งเอกสาร")),
    );
    child.once("message", (r) =>
      finish(r.error ? httpError(422, r.error) : null, r),
    );
    child.send({ files, modelDir: modelDir(), includeImages });
  });
}
export function registerExtractionRoutes(app, db, dataDir) {
  let busy = false;
  app.get("/api/extraction/status", (req, res) => res.json(extractionStatus()));
  app.post("/api/activities/:id/extract", async (req, res) => {
    const input = z
      .object({
        version: z.number().int().positive(),
        include_images: z.boolean().default(false),
      })
      .parse(req.body);
    const row = db
      .prepare("SELECT * FROM activities WHERE id=?")
      .get(Number(req.params.id));
    if (!row) throw httpError(404, "ไม่พบรายงาน");
    if (!canEdit(req.user, row))
      throw httpError(403, "ไม่มีสิทธิ์จัดข้อมูลรายงานนี้");
    if (row.status !== "pending")
      throw httpError(409, "รายงานยืนยันแล้ว แก้เฉพาะจุดแทนการอ่านใหม่");
    if (input.version !== row.version)
      throw httpError(409, "รายงานเปลี่ยนแล้ว กรุณาโหลดใหม่");
    if (busy)
      throw httpError(409, "เครื่องกำลังอ่านเอกสารอื่น กรุณาลองอีกครั้ง");
    const files = db
      .prepare(
        "SELECT id,title,mime,storage_name FROM files WHERE activity_id=? ORDER BY id",
      )
      .all(row.id);
    busy = true;
    try {
      const read = files.length
        ? await runReader(
            files.map((f) => ({
              ...f,
              path: resolve(dataDir, "uploads", f.storage_name),
            })),
            { includeImages: input.include_images },
          )
        : { parts: [], warnings: [] };
      const current = db
        .prepare("SELECT * FROM activities WHERE id=?")
        .get(row.id);
      if (
        !current ||
        !canEdit(req.user, current) ||
        current.version !== row.version ||
        current.status !== "pending"
      )
        throw httpError(409, "รายงานเปลี่ยนขณะอ่าน กรุณาโหลดแล้วลองใหม่");
      const text = [row.source_text, ...read.parts.map((p) => p.text)]
        .filter(Boolean)
        .join("\n");
      const metrics = db
        .prepare(
          "SELECT config FROM summary_templates WHERE active=1 AND (unit_id IS NULL OR unit_id=?)",
        )
        .all(row.unit_id)
        .flatMap((t) => JSON.parse(t.config).metrics);
      const result = {
        ...read,
        suggestions: suggestFields(text, {
          categories: db.prepare("SELECT * FROM categories").all(),
          units: db.prepare("SELECT * FROM units").all(),
          metrics,
        }),
        version: row.version,
        created_at: new Date().toISOString(),
      };
      transaction(db, () => {
        db.prepare(
          "INSERT INTO activity_extractions(activity_id,result_json) VALUES(?,?) ON CONFLICT(activity_id) DO UPDATE SET result_json=excluded.result_json",
        ).run(row.id, JSON.stringify(result));
        writeAudit(
          db,
          req.user,
          "อ่านข้อความในเครื่อง",
          "activity",
          row.id,
          null,
          {
            parts: read.parts.length,
            methods: [...new Set(read.parts.map((p) => p.method))],
            warnings: read.warnings,
          },
        );
      });
      res.json(result);
    } finally {
      busy = false;
    }
  });
}
