import { it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ExcelJS from "exceljs";
import { createCanvas } from "@napi-rs/canvas";
import { suggestFields } from "../server/extraction-parser.js";
import { runReader, extractionStatus } from "../server/extraction-routes.js";
import { createApp } from "../server/app.js";
import { digest, token } from "../server/security.js";
it("proposes only evidenced fields, Thai Buddhist dates, zero metrics and flags ambiguity", () => {
  const text =
    "ชื่อกิจกรรม: ประชุมเครือข่าย\nวันที่ ๒๑–๒๓ กันยายน ๒๕๖๙\nสถานที่: ชุมชน\nผู้ปฏิบัติงาน: เจ้าหน้าที่\nผู้เข้าร่วม 0 คน\nฝ่ายส่งเสริมสุขภาพ และ ฝ่ายป้องกันและควบคุมโรค";
  const s = suggestFields(text, {
    categories: [{ id: 1, name: "ประชุมและอบรม", active: 1 }],
    units: [
      { name: "ฝ่ายส่งเสริมสุขภาพ" },
      { name: "ฝ่ายป้องกันและควบคุมโรค" },
    ],
  });
  assert.equal(s.fields.date, "2026-09-21");
  assert.equal(s.fields.title, "ประชุมเครือข่าย");
  assert.equal(s.fields.metrics[0].value, 0);
  assert.equal(s.fields.category_id, 1);
  assert.equal(s.warnings.length, 2);
  assert.equal(s.fields.unit_id, undefined);
  const ambiguous = suggestFields("ผู้เข้าร่วม 19 คน และ ผู้เข้าร่วม 29 คน");
  assert.equal(ambiguous.fields.metrics, undefined);
  assert.match(ambiguous.warnings[0], /หลายค่า/);
  assert.equal(suggestFields("มีรูปถ่ายคนจำนวนมาก").fields.metrics, undefined);
  const dates = suggestFields("วันที่ 2 ตุลาคม 2569 และ 3 ตุลาคม 2569");
  assert.equal(dates.fields.date, undefined);
  assert.match(dates.warnings[0], /หลายวันที่/);
  assert.equal(
    suggestFields("วันที่ 31 กุมภาพันธ์ 2569").fields.date,
    undefined,
  );
});
function textPdf(text) {
  const stream = `BT /F1 18 Tf 40 700 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let s = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((o, i) => {
    offsets.push(s.length);
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = s.length;
  s +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
      .slice(1)
      .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(s);
}
function scanPdf(jpeg) {
  const stream = "q 700 0 0 160 0 0 cm /Im1 Do Q";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 700 160] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",
    `<< /Type /XObject /Subtype /Image /Width 700 /Height 160 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n${jpeg.toString("latin1")}\nendstream`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let s = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((o, i) => {
    offsets.push(s.length);
    s += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const start = s.length;
  s +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return Buffer.from(s, "latin1");
}
it("reads actual PDF and XLSX locally, skips photos by default and reports invalid files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rm-read-"));
  try {
    const book = new ExcelJS.Workbook(),
      sheet = book.addWorksheet("รายงาน");
    sheet.addRow(["ชื่อกิจกรรม: ประชุมเครือข่าย"]);
    sheet.addRow(["ผู้เข้าร่วม", 19, "คน"]);
    await book.xlsx.writeFile(join(dir, "report.xlsx"));
    await writeFile(
      join(dir, "report.pdf"),
      textPdf("Meeting attendance 19 people"),
    );
    await writeFile(join(dir, "bad.pdf"), "broken");
    const files = [
      {
        id: 1,
        title: "report.xlsx",
        path: join(dir, "report.xlsx"),
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
      {
        id: 2,
        title: "report.pdf",
        path: join(dir, "report.pdf"),
        mime: "application/pdf",
      },
      {
        id: 3,
        title: "bad.pdf",
        path: join(dir, "bad.pdf"),
        mime: "application/pdf",
      },
    ];
    const r = await runReader(files);
    assert.match(r.parts[0].text, /ผู้เข้าร่วม \| 19 \| คน/);
    assert.equal(suggestFields(r.parts[0].text).fields.metrics[0].value, 19);
    assert.match(r.parts[1].text, /Meeting attendance 19/);
    assert.equal(r.warnings.length, 1);
    const canvas = createCanvas(700, 160),
      ctx = canvas.getContext("2d");
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, 700, 160);
    ctx.fillStyle = "black";
    ctx.font = "48px Arial";
    ctx.fillText("Meeting 19 people", 30, 90);
    await writeFile(join(dir, "image.png"), canvas.toBuffer("image/png"));
    const image = {
      id: 4,
      title: "image.png",
      mime: "image/png",
      path: join(dir, "image.png"),
    };
    assert.equal((await runReader([image])).parts.length, 0);
    if (extractionStatus().ocr) {
      const o = await runReader([image], { includeImages: true });
      assert.match(o.parts[0]?.text || "", /19/);
      assert.equal(o.parts[0].method, "ocr");
      await writeFile(
        join(dir, "scan.pdf"),
        scanPdf(canvas.toBuffer("image/jpeg")),
      );
      const scan = await runReader([
        {
          id: 5,
          title: "scan.pdf",
          mime: "application/pdf",
          path: join(dir, "scan.pdf"),
        },
      ]);
      assert.deepEqual(scan.warnings, []);
      assert.match(scan.parts[0]?.text || "", /19/);
      assert.equal(scan.parts[0].method, "ocr");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("authorizes extraction, preserves originals and does not confirm or overwrite a report", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rm-extract-api-")),
    app = createApp({ dataDir: dir, disableRateLimit: true }),
    db = app.locals.db;
  let server;
  try {
    const work = db
      .prepare("SELECT id FROM works WHERE unit_id=1 LIMIT 1")
      .get().id;
    const uid = Number(
      db
        .prepare(
          "INSERT INTO users(username,name,password_hash,unit_id,work_id,roles) VALUES('staff','Staff','unused',1,?,'[\"staff\"]')",
        )
        .run(work).lastInsertRowid,
    );
    const raw = token(),
      csrf = token();
    db.prepare("INSERT INTO sessions VALUES(?,?,?,?)").run(
      digest(raw),
      uid,
      csrf,
      Date.now() + 60000,
    );
    const source =
      "ชื่อกิจกรรม: ประชุม\nวันที่ 2 ตุลาคม 2569\nผู้เข้าร่วม 19 คน";
    const aid = Number(
      db
        .prepare(
          "INSERT INTO activities(title,unit_id,work_id,owner_id,status,source,source_text) VALUES('ต้นฉบับ',1,?,?,'pending','web',?)",
        )
        .run(work, uid, source).lastInsertRowid,
    );
    server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const url = `http://127.0.0.1:${server.address().port}/api/activities/${aid}/extract`;
    const request = (body, auth = true) =>
      fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173",
          ...(auth
            ? { Cookie: `rm_session=${raw}`, "X-CSRF-Token": csrf }
            : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal((await request({ version: 1 }, false)).status, 401);
    assert.equal((await request({ version: 9 })).status, 409);
    const r = await request({ version: 1 });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).suggestions.fields.metrics[0].value, 19);
    const saved = db.prepare("SELECT * FROM activities WHERE id=?").get(aid);
    assert.equal(saved.source_text, source);
    assert.equal(saved.metrics, "[]");
    assert.equal(saved.status, "pending");
    assert.equal(saved.version, 1);
    db.prepare("UPDATE activities SET status='ready' WHERE id=?").run(aid);
    assert.equal((await request({ version: 1 })).status, 409);
  } finally {
    if (server) await new Promise((r) => server.close(r));
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
