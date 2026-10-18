// Isolated from the HTTP server: bounded time/heap, no arbitrary commands or document scripts.
import { readFile, access } from "node:fs/promises";
import { resolve } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let ocr;
async function recognize(bytes, modelDir) {
  for (const lang of ["tha", "eng"])
    await access(resolve(modelDir, `${lang}.traineddata`));
  if (!ocr) {
    const { createWorker } = await import("tesseract.js");
    ocr = await createWorker(["tha", "eng"], 1, {
      langPath: modelDir,
      gzip: false,
      cacheMethod: "none",
      logger: () => {},
    });
  }
  const r = await ocr.recognize(bytes);
  return r.data.text;
}
process.on("message", async ({ files, modelDir, includeImages }) => {
  const parts = [],
    warnings = [];
  try {
    for (const f of files) {
      try {
        const b = await readFile(f.path);
        if (f.mime === "application/pdf") {
          const { getDocument } =
            await import("pdfjs-dist/legacy/build/pdf.mjs");
          const task = getDocument({
            data: new Uint8Array(b),
            isEvalSupported: false,
            useSystemFonts: false,
            verbosity: 0,
            standardFontDataUrl:
              resolve(
                require.resolve("pdfjs-dist/package.json"),
                "../standard_fonts",
              ) + "/",
            wasmUrl:
              resolve(require.resolve("pdfjs-dist/package.json"), "../wasm") +
              "/",
          });
          const pdf = await task.promise;
          try {
            if (pdf.numPages > 30)
              warnings.push(
                `${f.title}: อ่านเฉพาะ 30 หน้าแรกจาก ${pdf.numPages} หน้า`,
              );
            let scanned = 0;
            for (let n = 1; n <= Math.min(pdf.numPages, 30); n++) {
              const page = await pdf.getPage(n),
                content = await page.getTextContent();
              let text = content.items
                  .map((x) => x.str + (x.hasEOL ? "\n" : " "))
                  .join(""),
                method = "pdf_text";
              if (text.trim().length < 10) {
                if (scanned++ >= 5) {
                  warnings.push(
                    `${f.title}: OCR ได้ไม่เกิน 5 หน้าสแกนต่อไฟล์ กรุณาแบ่งไฟล์`,
                  );
                  break;
                }
                const { createCanvas } = await import("@napi-rs/canvas");
                const original = page.getViewport({ scale: 1 }),
                  scale = Math.min(
                    2,
                    2000 / Math.max(original.width, original.height),
                  );
                const viewport = page.getViewport({ scale }),
                  canvas = createCanvas(
                    Math.ceil(viewport.width),
                    Math.ceil(viewport.height),
                  );
                await page.render({
                  canvasContext: canvas.getContext("2d"),
                  viewport,
                }).promise;
                try {
                  text = await recognize(
                    canvas.toBuffer("image/png"),
                    modelDir,
                  );
                  method = "ocr";
                } catch {
                  warnings.push(
                    `${f.title} หน้า ${n}: อ่านภาพไม่ได้ ตรวจว่าติดตั้งภาษา OCR แล้ว`,
                  );
                  text = "";
                }
              }
              if (text.trim())
                parts.push({
                  file_id: f.id,
                  title: f.title,
                  page: n,
                  method,
                  text: text.slice(0, 20000),
                });
            }
          } finally {
            await task.destroy();
          }
        } else if (f.mime.includes("wordprocessingml")) {
          const { readWord } = await import("./word-text.js");
          const text = readWord(b);
          parts.push({
            file_id: f.id,
            title: f.title,
            page: 1,
            method: "docx",
            text: text.slice(0, 20000),
          });
          if (text.length > 20000)
            warnings.push(
              `${f.title}: อ่านเฉพาะข้อความ 20,000 ตัวอักษรแรก กรุณาแบ่งไฟล์`,
            );
        } else if (f.mime.includes("spreadsheetml")) {
          const ExcelJS = (await import("exceljs")).default,
            book = new ExcelJS.Workbook();
          await book.xlsx.load(b);
          for (const sheet of book.worksheets.slice(0, 10)) {
            const lines = [];
            sheet.eachRow((row, index) => {
              if (index <= 2000)
                lines.push(
                  row.values
                    .slice(1, 41)
                    .map((v) => {
                      if (v == null) return "";
                      if (v instanceof Date)
                        return v.toISOString().slice(0, 10);
                      if (typeof v === "object")
                        return (
                          v.richText?.map((x) => x.text).join("") ||
                          v.text ||
                          String(v.result ?? "")
                        );
                      return String(v);
                    })
                    .join(" | "),
                );
            });
            const text = lines.join("\n");
            parts.push({
              file_id: f.id,
              title: f.title,
              page: sheet.name,
              method: "xlsx",
              text: text.slice(0, 20000),
            });
            if (
              sheet.rowCount > 2000 ||
              sheet.columnCount > 40 ||
              text.length > 20000
            )
              warnings.push(
                `${f.title}/${sheet.name}: มีข้อมูลเกินขอบเขตการอ่าน กรุณาแบ่งไฟล์`,
              );
          }
          if (book.worksheets.length > 10)
            warnings.push(`${f.title}: อ่านเฉพาะ 10 แผ่นงานแรก`);
        } else if (f.mime.startsWith("image/")) {
          if (includeImages) {
            const text = await recognize(b, modelDir);
            if (text.trim())
              parts.push({
                file_id: f.id,
                title: f.title,
                page: 1,
                method: "ocr",
                text: text.slice(0, 20000),
              });
            else
              warnings.push(
                `${f.title}: ไม่พบข้อความที่อ่านได้ เก็บรูปเป็นหลักฐานตามเดิม`,
              );
          }
        } else
          warnings.push(
            `${f.title}: ยังอ่านชนิดนี้ไม่ได้ หากเป็น Excel เก่าให้บันทึกเป็น .xlsx`,
          );
      } catch {
        warnings.push(
          `${f.title}: อ่านไม่สำเร็จ ไฟล์อาจมีรหัสผ่าน เสียหาย หรือ OCR ยังไม่พร้อม ต้นฉบับยังอยู่`,
        );
      }
    }
    const size = parts.reduce((n, p) => n + p.text.length, 0);
    if (size > 60000)
      warnings.push(
        "ข้อความรวมเกิน 60,000 ตัวอักษร แสดงเฉพาะส่วนแรก กรุณาแบ่งรายงาน",
      );
    let remain = 60000;
    const bounded = parts
      .map((p) => {
        const text = p.text.slice(0, remain);
        remain -= text.length;
        return { ...p, text };
      })
      .filter((p) => p.text);
    process.send({ parts: bounded, warnings });
  } catch {
    process.send({ error: "อ่านเอกสารไม่สำเร็จ กรุณาลองทีละไฟล์" });
  } finally {
    await ocr?.terminate();
    process.exit(0);
  }
});
