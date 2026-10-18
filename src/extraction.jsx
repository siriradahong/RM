import React, { useState } from "react";
import { api } from "./api";
import { Button } from "./workspace-ui";
export function fillEmptyFromExtraction(row, extraction) {
  if (row.status !== "pending" || extraction?.version !== row.version)
    return row;
  const next = { ...row };
  for (const [key, value] of Object.entries(
    extraction.suggestions?.fields || {},
  )) {
    if (key === "title") {
      if (
        row.title === row.source_text?.trim().split("\n")[0]?.slice(0, 300) ||
        /\.(pdf|xlsx?|png|jpg|jpeg|webp)$/i.test(row.title)
      )
        next.title = value;
    } else if (key === "metrics") {
      if (!row.metrics.length) next.metrics = value;
    } else if (!row[key]) next[key] = value;
  }
  return next;
}
export default function LocalExtraction({ record, onApply }) {
  const [result, setResult] = useState(record.extraction),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [images, setImages] = useState(false);
  async function read() {
    setBusy(true);
    setError("");
    try {
      const r = await api(`/activities/${record.id}/extract`, {
        method: "POST",
        body: { version: record.version, include_images: images },
      });
      setResult(r);
      onApply(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="local-reading no-print">
      <div className="local-reading-header">
        <div>
          <strong>
            {result
              ? "อ่านต้นฉบับแล้ว · กรุณาตรวจข้อมูลก่อนยืนยัน"
              : "ช่วยอ่านและจัดข้อมูลจากต้นฉบับ"}
          </strong>
          <p>ตรวจเทียบกับต้นฉบับ แล้วแก้เฉพาะข้อมูลที่ต้องการ</p>
        </div>
        {record.can_edit && record.status === "pending" && (
          <Button type="button" disabled={busy} onClick={read}>
            {busy
              ? "กำลังอ่านเอกสาร…"
              : result
                ? "อ่านต้นฉบับอีกครั้ง"
                : "อ่านต้นฉบับให้ช่วยกรอก"}
          </Button>
        )}
      </div>
      {record.can_edit && record.status === "pending" && (
        <label className="check">
          <input
            type="checkbox"
            checked={images}
            onChange={(e) => setImages(e.target.checked)}
            disabled={busy}
          />
          อ่านตัวหนังสือในรูปเอกสารด้วย (รูปถ่ายกิจกรรมไม่ต้องเลือก)
        </label>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {result && (
        <details>
          <summary>ดูข้อความที่อ่านได้และจุดที่ต้องตรวจ</summary>
          {[...result.warnings, ...result.suggestions.warnings].map((w, i) => (
            <p className="notice" key={i}>
              {w}
            </p>
          ))}
          {!result.parts.length && (
            <p>ใช้ข้อความที่ส่งมา ไม่พบข้อความเพิ่มเติมจากไฟล์</p>
          )}
          {Object.entries(result.suggestions.evidence).map(([k, v]) => (
            <p key={k}>
              <b>
                {
                  {
                    title: "ชื่อเรื่อง",
                    date: "วันที่",
                    area: "พื้นที่",
                    workers: "ผู้ปฏิบัติงาน",
                    result: "ผล",
                    metrics: "ตัวเลข",
                    category_id: "ประเภทงาน",
                  }[k]
                }
              </b>{" "}
              — {v}
            </p>
          ))}
          {result.parts.map((p, i) => (
            <details key={i}>
              <summary>
                {p.title} · {p.page} ·{" "}
                {p.method === "ocr" ? "อ่านจากภาพเอกสาร" : "อ่านข้อความ"}
              </summary>
              <pre className="read-text">{p.text}</pre>
            </details>
          ))}
          <p className="muted">
            ค่าที่เสนอเป็นข้อเสนอจากข้อความ ไม่ใช่ข้อมูลที่ยืนยันแล้ว
            ช่องที่ยังไม่พบต้องตรวจเติมจากต้นฉบับ
          </p>
        </details>
      )}
    </section>
  );
}
