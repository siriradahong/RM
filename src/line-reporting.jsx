import React, { useState } from "react";
import {
  MessageCircle,
  Image,
  FileCheck2,
  ArrowUpRight,
  Paperclip,
} from "lucide-react";
import { api } from "./api";
import { Heading, Button, useData, DataState, dateText } from "./workspace-ui";
const sample =
  "วันที่ 21 กันยายน 2569 งานฟื้นฟูสุขภาพ ลงพื้นที่ติดตามการจัดบริการผู้ช่วยคนพิการ จำนวน 85 ราย";
export default function LineReporting({ user, meta, navigate }) {
  const [example, setExample] = useState("text"),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const reports = useData(
    "/activities?mine=1&source=line&status=ready&limit=3",
  );
  const configured = meta.line.receiveConfigured;
  async function link() {
    setBusy(true);
    setError("");
    try {
      const d = await api("/me/line-code", { method: "POST", body: {} });
      setCode(d.code);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="ส่งรายงานทาง LINE">
        ส่งข้อความหรือรูปในแชต ตรวจข้อมูลที่ระบบอ่านได้ แล้วยืนยันเพื่อสรุปผลงาน
      </Heading>
      <div className="line-report-layout">
        <section
          className="line-phone"
          aria-label="ตัวอย่างขั้นตอนรายงานทาง LINE"
        >
          <header>
            <MessageCircle size={24} />
            <div>
              <strong>ผู้ช่วยรายงาน สสล.</strong>
              <small>สำนักสาธารณสุขและสิ่งแวดล้อม</small>
            </div>
          </header>
          <div className="line-example-label">
            ตัวอย่างขั้นตอน · ไม่ใช่ข้อความที่ส่งจริง
          </div>
          <div className="line-chat" aria-live="polite">
            <p className="line-bubble incoming">
              ส่งรายงานเป็นข้อความ หรือแนบรูปเอกสารและรูปกิจกรรมได้เลยค่ะ
            </p>
            <div className="line-bubble outgoing">
              {example === "image" ? (
                <>
                  <div className="line-document">
                    <Image size={36} />
                    <b>รูปเอกสาร / รูปกิจกรรม</b>
                  </div>
                  <span>ข้อความและรูปของงานเดียวกันแนบไว้ด้วยกัน</span>
                </>
              ) : (
                sample
              )}
            </div>
            <div className="line-bubble incoming">
              <b>ตรวจข้อมูลก่อนยืนยัน</b>
              <dl>
                <dt>กิจกรรม</dt>
                <dd>ติดตามบริการผู้ช่วยคนพิการ</dd>
                <dt>วันที่</dt>
                <dd>21 ก.ย. 2569</dd>
                <dt>ผลการดำเนินงาน</dt>
                <dd>85 ราย</dd>
              </dl>
              {example === "image" && (
                <p>
                  รูปเอกสารต้องอ่านด้วย OCR ก่อน ส่วนรูปกิจกรรมเก็บเป็นหลักฐาน
                  ไม่เดาจำนวนคนจากภาพ
                </p>
              )}
            </div>
            <p className="line-bubble incoming">
              {example === "confirm"
                ? "เมื่อเจ้าหน้าที่ยืนยันแล้ว รายงานจึงพร้อมนำไปสรุป และเปิดดูได้ในแดชบอร์ดของฉัน"
                : "ถ้าข้อมูลไม่ชัด ระบบถามให้เติมเฉพาะจุด แล้วจึงกดยืนยันข้อมูล"}
            </p>
          </div>
          <div className="line-example-actions">
            <button
              aria-pressed={example === "text"}
              onClick={() => setExample("text")}
            >
              <MessageCircle size={17} />
              ดูข้อความ
            </button>
            <button
              aria-pressed={example === "image"}
              onClick={() => setExample("image")}
            >
              <Paperclip size={17} />
              ดูรูปแนบ
            </button>
            <button
              aria-pressed={example === "confirm"}
              onClick={() => setExample("confirm")}
            >
              <FileCheck2 size={17} />
              ดูการยืนยัน
            </button>
          </div>
        </section>
        <div className="line-report-info">
          <section className="panel">
            <div className="panel-heading">
              <h2>เริ่มส่งรายงาน</h2>
              <span className={"badge " + (configured ? "ready" : "pending")}>
                {configured ? "ตั้งค่ารับ LINE แล้ว" : "ยังไม่เชื่อม LINE"}
              </span>
            </div>
            <ol className="line-instructions">
              <li>เปิดแชต LINE ของหน่วยงานและผูกบัญชีผู้ใช้งานครั้งแรก</li>
              <li>พิมพ์รายงานเหมือนเดิม พร้อมแนบรูปหรือเอกสารของงานนั้น</li>
              <li>ตรวจข้อมูลที่ระบบแยกให้ แก้เฉพาะจุดที่ขาดหรือไม่ถูกต้อง</li>
              <li>กดยืนยัน แล้วดูผลในแดชบอร์ดและรายงานสรุป</li>
            </ol>
            {meta.line.oaUrl ? (
              <a
                className="button line-open"
                href={meta.line.oaUrl}
                target="_blank"
                rel="noreferrer"
              >
                <MessageCircle size={19} />
                เปิด LINE เพื่อส่งรายงาน
                <ArrowUpRight size={17} />
              </a>
            ) : (
              <p className="notice">
                {configured
                  ? "ให้ผู้ดูแลเพิ่มลิงก์ LINE ของหน่วยงาน เพื่อเปิดแชตจากหน้านี้"
                  : "ผู้ดูแลยังไม่ได้ตั้งค่าช่องทางรับรายงานจาก LINE ระหว่างนี้ส่งข้อความและไฟล์ผ่านเว็บได้"}
              </p>
            )}
            <p>
              บัญชีของคุณ:{" "}
              <strong>
                {user.line_user_id ? "ผูก LINE แล้ว" : "ยังไม่ได้ผูก LINE"}
              </strong>
            </p>
            {!user.line_user_id && (
              <Button disabled={busy} onClick={link}>
                {busy ? "กำลังสร้างรหัส…" : "สร้างรหัสผูกบัญชี LINE"}
              </Button>
            )}
            {code && (
              <p className="notice">
                ส่งข้อความ <strong>ผูกบัญชี {code}</strong> ในแชตส่วนตัวของ LINE
                หน่วยงานภายใน 10 นาที
              </p>
            )}
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <div className="line-web-alternative">
              <Button onClick={() => navigate("import")}>
                ส่งข้อความและไฟล์ผ่านเว็บ
              </Button>
              <small>ข้อมูลส่วนนี้จะบันทึกเป็นรายงานที่ส่งผ่านเว็บ</small>
            </div>
          </section>
          <section className="panel">
            <h2>รายงาน LINE ของฉันที่ยืนยันแล้ว</h2>
            <DataState resource={reports}>
              {(d) => (
                <>
                  <strong className="line-real-count">
                    {d.total.toLocaleString("th-TH")} <small>รายการ</small>
                  </strong>
                  {d.items.length ? (
                    d.items.map((r) => (
                      <button
                        className="line-report-row"
                        key={r.id}
                        onClick={() => navigate("activity/" + r.id)}
                      >
                        <span>
                          {r.title}
                          <small>{dateText(r.date)}</small>
                        </span>
                        <ArrowUpRight size={18} />
                      </button>
                    ))
                  ) : (
                    <p className="muted">
                      ยังไม่มีรายงาน LINE ที่ยืนยันในบัญชีนี้
                    </p>
                  )}
                </>
              )}
            </DataState>
            <Button onClick={() => navigate("dashboard/mine/search")}>
              ดูรายงานของฉัน
            </Button>
          </section>
        </div>
      </div>
    </>
  );
}
