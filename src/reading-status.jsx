import React from "react";
import { useData, DataState } from "./workspace-ui";
export default function ReadingStatus() {
  const r = useData("/extraction/status");
  return (
    <DataState resource={r}>
      {(d) => (
        <section className="panel setup-status">
          <div>
            <h2>การอ่านเอกสารในเครื่อง</h2>
            <p>ไฟล์ต้นฉบับอยู่ในระบบ ประมวลผลบนเครื่องที่รันเว็บไซต์</p>
          </div>
          <div className="setup-pills">
            <span>✓ PDF ที่มีข้อความ</span>
            <span>✓ Excel .xlsx</span>
            <span>✓ Word .docx</span>
            <span className={d.ocr ? "" : "setup-warning"}>
              {d.ocr
                ? "✓ OCR ไทย / อังกฤษพร้อม"
                : "OCR ยังไม่ได้ติดตั้งชุดภาษา"}
            </span>
          </div>
          {!d.ocr && (
            <p>
              ให้ผู้ติดตั้งระบบติดตั้งชุดภาษา OCR ตามคู่มือติดตั้ง
              แล้วโหลดหน้านี้ใหม่
            </p>
          )}
          <p className="muted">
            {d.ai?.configured
              ? "ตั้งค่าโมเดลช่วยสกัดแล้ว หากโมเดลไม่พร้อม ระบบจะแจ้งและใช้การอ่านในเครื่อง"
              : "ใช้กติกาช่วยเสนอข้อมูลจากข้อความ ยังไม่ได้ตั้งค่าโมเดล AI"}{" "}
            · ตรวจข้อมูลก่อนยืนยันเสมอ
          </p>
        </section>
      )}
    </DataState>
  );
}
