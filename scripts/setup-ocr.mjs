import { mkdir, writeFile, access } from "node:fs/promises";
import { resolve } from "node:path";
const dir = resolve(process.env.OCR_MODEL_DIR || "data/ocr");
await mkdir(dir, { recursive: true, mode: 0o700 });
for (const lang of ["tha", "eng"]) {
  const path = resolve(dir, lang + ".traineddata");
  if (
    await access(path).then(
      () => true,
      () => false,
    )
  ) {
    console.log(lang + ": พร้อมแล้ว");
    continue;
  }
  const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/${lang}.traineddata`;
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok)
    throw new Error("ดาวน์โหลดภาษา OCR ไม่สำเร็จ " + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 100000) throw new Error("ไฟล์ภาษาไม่สมบูรณ์");
  await writeFile(path, bytes, { mode: 0o600 });
  console.log(lang + ": ติดตั้งแล้ว");
}
console.log("OCR พร้อมอ่านไทย/อังกฤษในเครื่อง โดยไม่ส่งเอกสารออกอินเทอร์เน็ต");
