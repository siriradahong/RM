import React, { useEffect, useRef, useState } from "react";
import { Button } from "./workspace-ui";

const sample = {
  title: "คัดกรองสุขภาพเชิงรุก",
  area: "ชุมชนเจ้าพ่อขุนภักดี",
  date: "7 ก.ย. 2569",
  people: 19,
  peopleUnit: "คน",
  services: 29,
  approximate: false,
  brief: false,
};
const source =
  "วันจันทร์ที่ 7 ก.ย. 2569 มอบหมายให้ศูนย์บริการสาธารณสุขที่ 1 ลงพื้นที่ชุมชนเจ้าพ่อขุนภักดี คัดกรองสุขภาพเชิงรุก ผู้เข้าร่วม 19 คน คัดกรองไวรัสตับอักเสบบี/ซี 17 ราย HPV 3 ราย วัคซีนไข้หวัดใหญ่ 9 ราย รวมการให้บริการ 29 ครั้ง";
const greeting = "สวัสดีค่ะ ส่งรายงานเข้ามาได้เลย จะเป็นข้อความหรือรูปก็ได้ค่ะ";
const unknown = (value) => !value || /ยังไม่ระบุ|ไม่ทราบ/.test(value);
function editText(c) {
  return `ชื่อกิจกรรม: ${c.title || ""}\nวันที่: ${c.date || ""}\nสถานที่: ${c.area || ""}\nผู้เข้าร่วม: ${c.people == null ? "" : (c.approximate ? "ประมาณ " : "") + c.people + " " + (c.peopleUnit || "คน")}\nบริการรวม: ${c.services == null ? "" : c.services + " ครั้ง"}`;
}
function readExample(text, previous) {
  const normalized = text.replace(/[๐-๙]/g, (c) =>
    String(c.charCodeAt(0) - 3664),
  );
  const field = (labels) =>
    normalized
      .match(new RegExp(`(?:^|\\n)(?:${labels})\\s*[:：]\\s*([^\\n]*)`))?.[1]
      ?.trim() || "";
  const people = normalized.match(
    /ผู้เข้าร่วม\s*[:：]?\s*(ประมาณ\s*)?(\d+)\s*(คน|ราย)/,
  );
  const services = normalized.match(
    /(?:บริการรวม|รวมการให้บริการ)\s*[:：]?\s*(\d+)\s*ครั้ง/,
  );
  const title = field("ชื่อกิจกรรม|กิจกรรม"),
    date = field("วันที่"),
    area = field("สถานที่|พื้นที่");
  return {
    ...previous,
    title,
    date,
    area,
    source: text,
    people: people ? Number(people[2]) : null,
    peopleUnit: people?.[3] || "คน",
    approximate: !!people?.[1],
    services: services ? Number(services[1]) : null,
    brief: !title || unknown(date) || !people || !!people[1],
  };
}
export default function LineBotChat() {
  const nextId = useRef(1),
    timer = useRef(null),
    chosen = useRef(new Set()),
    confirmed = useRef(new Set());
  const [messages, setMessages] = useState([{ id: 0, text: greeting }]);
  const [records, setRecords] = useState([]),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState(false);
  const [editing, setEditing] = useState("");
  const chat = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (chat.current) chat.current.scrollTop = chat.current.scrollHeight;
  }, [messages, busy]);
  function add(message) {
    const item = { id: nextId.current++, ...message };
    setMessages((m) => [...m, item]);
  }
  function reply(fn) {
    setBusy(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setBusy(false);
      fn();
    }, 450);
  }
  function reset() {
    clearTimeout(timer.current);
    timer.current = null;
    chosen.current.clear();
    confirmed.current.clear();
    setMessages([{ id: nextId.current++, text: greeting }]);
    setRecords([]);
    setBusy(false);
    setActive(false);
    setEditing("");
  }
  function review(candidate) {
    add({
      kind: "review",
      candidate,
      text: candidate.brief
        ? "สร้างร่างให้แล้วค่ะ · รายงานแบบย่อ"
        : "อ่านรายงานแล้วค่ะ ตรวจให้ดูนะคะ",
      options: candidate.brief
        ? [
            { label: "ยืนยัน", action: "confirm", candidate },
            { label: "เพิ่มรายละเอียด", action: "edit", candidate },
          ]
        : [
            { label: "ใช่ ถูกต้อง", action: "confirm", candidate },
            { label: "แก้ไข", action: "edit", candidate },
          ],
    });
  }
  function start(kind) {
    if (busy || active) return;
    setActive(true);
    const candidate = { ...sample, id: nextId.current++, source, kind };
    if (kind === "text") {
      add({ me: true, text: source });
      reply(() => review(candidate));
    } else {
      add({ me: true, kind: "photos", text: "รูปตัวอย่าง 6 รูป" });
      reply(() =>
        add({
          text: "ได้รับรูปตัวอย่าง 6 รูปค่ะ เลือกกิจกรรมที่ต้องการรายงานได้เลย",
          options: ["คัดกรองสุขภาพ", "ควบคุมโรค", "ประชุม"].map((title) => ({
            label: title,
            action: "activity",
            candidate: {
              ...candidate,
              title,
              date: "",
              area: "",
              people: null,
              services: null,
              brief: true,
            },
          })),
        }),
      );
    }
  }
  function finish(c) {
    if (confirmed.current.has(c.id)) return;
    confirmed.current.add(c.id);
    setRecords((r) => [...r, { ...c, news: false }]);
    setActive(false);
    add({
      text: "บันทึกตัวอย่างแล้วค่ะ ✔ ใช้เป็นข่าวประชาสัมพันธ์ด้วยไหมคะ",
      options: [
        { label: "ใช้เป็นข่าว", action: "news", candidate: c },
        { label: "ไม่ใช้", action: "no-news", candidate: c },
      ],
    });
  }
  function choose(message, option) {
    if (busy || chosen.current.has(message.id)) return;
    chosen.current.add(message.id);
    setMessages((m) =>
      m.map((x) => (x.id === message.id ? { ...x, used: true } : x)),
    );
    add({ me: true, text: option.label });
    const c = option.candidate;
    reply(() => {
      if (option.action === "confirm") finish(c);
      else if (option.action === "edit") {
        setEditing(editText(c));
        add({
          kind: "editor",
          candidate: c,
          text: "พิมพ์แก้หรือเพิ่มรายละเอียดในข้อความเดียว แล้วส่งกลับมาให้ตรวจอีกครั้งค่ะ",
        });
      } else if (option.action === "activity")
        add({
          text: "มีผู้เข้าร่วมกี่คนคะ",
          options: [
            {
              label: "ประมาณ 20",
              action: "people",
              candidate: { ...c, people: 20, approximate: true },
            },
            {
              label: "ไม่ทราบ",
              action: "people",
              candidate: { ...c, people: null, approximate: false },
            },
          ],
        });
      else if (option.action === "people") review(c);
      else if (option.action === "news") {
        setRecords((r) =>
          r.map((x) => (x.id === c.id ? { ...x, news: true } : x)),
        );
        add({
          text: "ส่งตัวอย่างเข้าคิวประชาสัมพันธ์แล้วค่ะ รอเจ้าหน้าที่ตรวจข้อความและรูปก่อนเผยแพร่",
        });
      } else if (option.action === "no-news")
        add({ text: "เก็บเป็นรายงานตัวอย่างอย่างเดียวค่ะ" });
    });
  }
  function submitEdit(event, message) {
    event.preventDefault();
    if (busy || chosen.current.has(message.id) || !editing.trim()) return;
    chosen.current.add(message.id);
    setMessages((m) =>
      m.map((x) => (x.id === message.id ? { ...x, used: true } : x)),
    );
    const value = editing.trim();
    add({ me: true, text: value });
    reply(() => review(readExample(value, message.candidate)));
  }
  return (
    <>
      <div className="line-bot-intro">
        <span>ตัวอย่างโต้ตอบจาก HTML</span>
        <p>
          ลองกดส่งข้อความหรือรูป แล้วตอบคำถามในแชต · ตัวอย่างนี้ไม่ส่ง LINE
          จริงและไม่รวมในผลงานจริง
        </p>
        <Button onClick={reset}>เริ่มตัวอย่างใหม่</Button>
      </div>
      <div className="line-bot-stage">
        <section className="line-bot-phone" aria-label="แชต LINE Bot ตัวอย่าง">
          <div className="line-bot-screen">
            <header className="line-bot-top">
              <span>AI</span>ผู้ช่วยรายงาน สสล.
            </header>
            <div
              className="line-bot-messages"
              ref={chat}
              role="log"
              aria-live="polite"
              aria-label="ข้อความในแชต"
            >
              {messages.map((m) => (
                <article
                  key={m.id}
                  className={"line-bot-message" + (m.me ? " me" : "")}
                >
                  {m.kind === "photos" ? (
                    <div
                      className="line-bot-photos"
                      aria-label="รูปตัวอย่าง 6 รูป"
                    >
                      {Array.from({ length: 6 }, (_, i) => (
                        <i key={i} />
                      ))}
                    </div>
                  ) : null}
                  <div className="line-bot-text">{m.text}</div>
                  {m.kind === "review" && (
                    <>
                      <dl>
                        <dt>กิจกรรม</dt>
                        <dd>{m.candidate.title || "ยังไม่ระบุ"}</dd>
                        <dt>สถานที่</dt>
                        <dd>{m.candidate.area || "ยังไม่ระบุ"}</dd>
                        <dt>วันที่</dt>
                        <dd>{m.candidate.date || "ยังไม่ระบุ"}</dd>
                        <dt>ผู้เข้าร่วม</dt>
                        <dd>
                          {m.candidate.people == null
                            ? "ยังไม่ทราบ"
                            : (m.candidate.approximate ? "ประมาณ " : "") +
                              m.candidate.people +
                              " " +
                              m.candidate.peopleUnit}
                        </dd>
                        {m.candidate.services != null && (
                          <>
                            <dt>บริการรวม</dt>
                            <dd>{m.candidate.services} ครั้ง</dd>
                          </>
                        )}
                      </dl>
                      <p className="line-bot-note">
                        {m.candidate.brief
                          ? "ยังไม่ยืนยันตัวเลข เก็บเป็นรายงานแบบย่อได้ โดยไม่สมมติจำนวนคนจากรูป"
                          : `ผู้เข้าร่วม ${m.candidate.people} ${m.candidate.peopleUnit}${m.candidate.services != null ? " แต่บริการรวม " + m.candidate.services + " ครั้ง" : ""} นับแยกจำนวนคนกับครั้งบริการถูกต้องไหมคะ`}
                      </p>
                    </>
                  )}
                  {m.kind === "editor" && !m.used && (
                    <form
                      className="line-bot-editor"
                      onSubmit={(e) => submitEdit(e, m)}
                    >
                      <label>
                        ข้อความที่ต้องการแก้ไข
                        <textarea
                          rows={7}
                          maxLength={5000}
                          value={editing}
                          onChange={(e) => setEditing(e.target.value)}
                        />
                      </label>
                      <button type="submit" disabled={busy || !editing.trim()}>
                        ส่งรายละเอียด
                      </button>
                    </form>
                  )}
                  {m.options && (
                    <div className="line-bot-options">
                      {m.options.map((o) => (
                        <button
                          key={o.label}
                          disabled={m.used || busy}
                          onClick={() => choose(m, o)}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  )}
                </article>
              ))}
              {busy && (
                <p className="line-bot-message line-bot-typing" role="status">
                  กำลังจัดข้อมูล…
                </p>
              )}
            </div>
            <div className="line-bot-compose">
              <button disabled={busy || active} onClick={() => start("text")}>
                ส่งรายงานเป็นข้อความ
              </button>
              <button disabled={busy || active} onClick={() => start("image")}>
                ส่งรูปอย่างเดียว
              </button>
            </div>
          </div>
        </section>
        <div className="line-bot-side">
          <section className="panel">
            <h2>สิ่งที่เกิดขึ้นเบื้องหลัง</h2>
            <ol>
              <li>แยกรายงานออกจากข้อความทั่วไป</li>
              <li>
                จัดวันที่ สถานที่ กิจกรรม และตัวเลข โดยแยกจำนวนคนกับครั้งบริการ
              </li>
              <li>ถามกลับเมื่อข้อมูลขาดหรือผิดปกติ ไม่เดาตัวเลขจากรูป</li>
              <li>ให้เจ้าหน้าที่ตรวจยืนยันก่อนนำไปสรุปและเสนอเป็นข่าว</li>
            </ol>
            <small className="muted">
              หน้านี้จำลองการโต้ตอบตามต้นแบบ ส่วนการรับรายงานจริงใช้การเชื่อมต่อ
              LINE ของหน่วยงาน
            </small>
          </section>
          <section className="panel line-bot-kpi">
            <span>รายงานตัวอย่างที่ยืนยันในรอบนี้</span>
            <strong aria-live="polite" aria-label="จำนวนรายงานตัวอย่าง">
              {records.length}
            </strong>
            <p>กดยืนยันในแชตแล้วจำนวนจะเพิ่ม · ไม่นำไปบวกยอดแดชบอร์ดจริง</p>
            {records.length > 0 && (
              <details>
                <summary>ดูรายงานตัวอย่างที่ยืนยัน</summary>
                {records.map((r) => (
                  <article key={r.id}>
                    <b>{r.title || "รายงานแบบย่อ"}</b>
                    <small>
                      {r.brief
                        ? "รายงานแบบย่อ · ยังไม่ยืนยันตัวเลข"
                        : `${r.people} ${r.peopleUnit}${r.services != null ? " · " + r.services + " ครั้งบริการ" : ""}`}
                    </small>
                    {r.news && (
                      <span className="badge">ตัวอย่างเสนอเป็นข่าว</span>
                    )}
                  </article>
                ))}
              </details>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
