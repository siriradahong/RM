import React, { useEffect, useState } from "react";
import { api, query } from "./api";
export function UnitPicker({ label, value, onChange }) {
  const units = [
    "กิจกรรม",
    "ครั้ง",
    "ครั้งบริการ",
    "คน",
    "ราย",
    "ตัน",
    "หลังคาเรือน",
    "แห่ง",
    "กิโลกรัม",
    "บาท",
    "คัน",
    "เที่ยว",
    "เส้นทาง",
  ];
  const custom = !units.includes(value);
  return (
    <div>
      <select
        aria-label={label}
        value={custom ? "__custom" : value}
        onChange={(e) =>
          onChange(e.target.value === "__custom" ? "" : e.target.value)
        }
      >
        {units.map((u) => (
          <option key={u}>{u}</option>
        ))}
        <option value="__custom">ระบุหน่วยอื่น…</option>
      </select>
      {custom && (
        <input
          aria-label={label + " (พิมพ์เอง)"}
          placeholder="เช่น ถุง หรือ ชุด"
          required
          maxLength={40}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
const ErrorText = ({ text }) =>
  text ? (
    <p className="rm-notice error" role="alert">
      {text}
    </p>
  ) : null;
function useLoad(path) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setError("");
    api(path, { signal: abort.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => abort.abort();
  }, [path, revision]);
  return { data, error, reload: () => setRevision((x) => x + 1) };
}
export function Collaborators({ value = [], onChange, units = [] }) {
  const [text, setText] = useState("");
  function add() {
    const v = text.trim();
    if (v && !value.includes(v) && value.length < 30) onChange([...value, v]);
    setText("");
  }
  return (
    <div className="rm-collaborators">
      <div className="rm-row">
        {value.map((v) => (
          <span className="rm-tag" key={v}>
            {v}
            <button
              type="button"
              aria-label={"นำ " + v + " ออก"}
              onClick={() => onChange(value.filter((x) => x !== v))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="rm-row">
        <input
          aria-label="หน่วยงานร่วมเพิ่มเติม"
          placeholder="พิมพ์ชื่อหน่วยงาน แล้วกด Enter"
          list="rm-collaborator-options"
          maxLength={200}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="rm-button secondary" onClick={add}>
          เพิ่มหน่วยงานร่วม
        </button>
      </div>
      <datalist id="rm-collaborator-options">
        {units.map((u) => (
          <option key={u.id} value={u.name} />
        ))}
      </datalist>
      <small>
        บันทึกผู้ร่วมกิจกรรมได้ทั้งภายในและภายนอก
        ไม่เพิ่มยอดกิจกรรมซ้ำในฝ่ายที่ร่วม
      </small>
    </div>
  );
}
export function MetricSuggestions({ category, unitId, value, onChange }) {
  const r = useLoad("/report-templates");
  const definitions = (r.data || []).filter(
    (t) =>
      t.active &&
      (!t.unit_ids.length || t.unit_ids.includes(Number(unitId))) &&
      (!category ||
        t.name.includes(category) ||
        t.keywords.some((k) => category.includes(k))),
  );
  const seen = new Set(value.map((m) => m.label + "|" + m.unit));
  const options = definitions
    .flatMap((t) => t.metrics)
    .filter((m) => {
      const k = m.label + "|" + m.unit;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  return options.length ? (
    <div className="rm-row">
      <small>เพิ่มตัวเลขจากแม่แบบ:</small>
      {options.map((m) => (
        <button
          type="button"
          className="rm-button secondary"
          key={m.label + "|" + m.unit}
          onClick={() =>
            onChange([...value, { label: m.label, unit: m.unit, value: "" }])
          }
        >
          {m.label} ({m.unit}) +
        </button>
      ))}
    </div>
  ) : null;
}
export function NewsDiscussion({ id }) {
  const r = useLoad("/news/" + id + "/discussion"),
    [open, setOpen] = useState(false),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false),
    [share, setShare] = useState("");
  async function mutate(path, method, body) {
    setBusy(true);
    setError("");
    try {
      await api(path, { method, body });
      r.reload();
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    const url = location.origin + location.pathname + "#feed/" + id;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setShare(url);
    }
  }
  return (
    <section className="rm-discussion" aria-label="การสนทนาข่าว">
      <ErrorText text={error || r.error} />
      {r.data && (
        <>
          <div className="rm-social-actions">
            <button
              disabled={busy}
              aria-pressed={r.data.liked}
              onClick={() =>
                mutate("/news/" + id + "/like", "PUT", { liked: !r.data.liked })
              }
            >
              {r.data.liked ? "ถูกใจแล้ว" : "ถูกใจ"} · {r.data.likes}
            </button>
            <button aria-expanded={open} onClick={() => setOpen(!open)}>
              ความคิดเห็น ({r.data.comments.length})
            </button>
            <button onClick={copy}>
              {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
            </button>
          </div>
          {share && (
            <label>
              ลิงก์ข่าวภายใน
              <input
                readOnly
                value={share}
                onFocus={(e) => e.target.select()}
              />
            </label>
          )}
          {open && (
            <div>
              {r.data.comments.map((c) => (
                <div className="rm-comment" key={c.id}>
                  <b>{c.author}</b>
                  <p>{c.body}</p>
                  <small>
                    {new Date(c.created_at).toLocaleString("th-TH", {
                      timeZone: "Asia/Bangkok",
                    })}
                  </small>
                  {c.can_delete && (
                    <button
                      disabled={busy}
                      onClick={() => mutate("/news-comments/" + c.id, "DELETE")}
                    >
                      ลบความคิดเห็น
                    </button>
                  )}
                </div>
              ))}
              {r.data.comments.length === 100 && (
                <small>แสดง 100 ความคิดเห็นล่าสุด</small>
              )}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await mutate("/news/" + id + "/comments", "POST", {
                      body: text,
                    })
                  )
                    setText("");
                }}
              >
                <label className="rm-field">
                  <span>ความคิดเห็นภายในหน่วยงาน</span>
                  <textarea
                    maxLength={2000}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    required
                    rows={2}
                  />
                </label>
                <button className="rm-button" disabled={busy || !text.trim()}>
                  ส่งความคิดเห็น
                </button>
              </form>
            </div>
          )}
        </>
      )}
    </section>
  );
}
export function ActivityCalendar({ meta, user, navigate }) {
  const now = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [month, setMonth] = useState(now.slice(0, 7)),
    [unit, setUnit] = useState(user.unit_id || ""),
    [mine, setMine] = useState(false),
    [selected, setSelected] = useState("");
  const r = useLoad(
    "/activity-calendar?" + query({ month, unit, mine: mine ? "1" : "0" }),
  );
  const [year, m] = month.split("-").map(Number),
    days = new Date(year, m, 0).getDate(),
    offset = new Date(year, m - 1, 1).getDay();
  function move(delta) {
    const d = new Date(year, m - 1 + delta, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    setSelected("");
  }
  return (
    <>
      <header className="rm-title">
        <h1>ปฏิทินผลงาน</h1>
        <p>
          ดูวันที่กิจกรรมจากรายงานที่บันทึกไว้ คลิกเพื่อย้อนดูต้นฉบับและสถานะ
        </p>
      </header>
      <div className="rm-controls">
        <button
          className="rm-button secondary"
          onClick={() => move(-1)}
          aria-label="เดือนก่อน"
        >
          ‹
        </button>
        <label className="rm-field">
          <span>เดือนกิจกรรม</span>
          <input
            type="month"
            value={month}
            onChange={(e) => {
              if (e.target.value) {
                setMonth(e.target.value);
                setSelected("");
              }
            }}
          />
        </label>
        <button
          className="rm-button secondary"
          onClick={() => move(1)}
          aria-label="เดือนถัดไป"
        >
          ›
        </button>
        <label className="rm-field">
          <span>หน่วยงาน</span>
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            <option value="">ทุกหน่วยงาน</option>
            {meta.units
              .filter((u) => u.kind !== "section")
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </label>
        <label className="rm-checkbox">
          <input
            type="checkbox"
            checked={mine}
            onChange={(e) => setMine(e.target.checked)}
          />
          เฉพาะที่ฉันรายงาน
        </label>
      </div>
      <ErrorText text={r.error} />
      {r.data ? (
        <>
          <section className="rm-calendar" aria-label="วันในเดือน">
            {["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."].map((n) => (
              <b key={n}>{n}</b>
            ))}
            {Array.from({ length: offset }, (_, i) => (
              <span key={"blank" + i} />
            ))}
            {Array.from({ length: days }, (_, i) => {
              const date = month + "-" + String(i + 1).padStart(2, "0"),
                items = r.data.filter((a) => a.date === date);
              return (
                <button
                  key={date}
                  className={selected === date ? "selected" : ""}
                  aria-pressed={selected === date}
                  aria-label={`${date} ${items.length} รายการ`}
                  onClick={() => setSelected(date)}
                >
                  <b>{i + 1}</b>
                  {items.length > 0 && (
                    <>
                      <span>{items.length} รายการ</span>
                      <small>
                        {items.filter((x) => x.status === "ready").length}{" "}
                        ยืนยันแล้ว
                      </small>
                    </>
                  )}
                </button>
              );
            })}
          </section>
          <section className="rm-card">
            <h2>
              {selected ? "กิจกรรมวันที่ " + selected : "กิจกรรมในเดือนนี้"}
            </h2>
            {r.data
              .filter((a) => !selected || a.date === selected)
              .map((a) => (
                <button
                  key={a.id}
                  className="rm-timeline-item"
                  onClick={() => navigate("activity/" + a.id)}
                >
                  <time>{a.date}</time>
                  <div>
                    <b>{a.title}</b>
                    <small>
                      {a.unit_name} · {a.area || "ยังไม่ระบุพื้นที่"}
                    </small>
                  </div>
                  <span>
                    {a.status === "ready" ? "ยืนยันแล้ว" : "รอยืนยัน"}
                  </span>
                </button>
              ))}
            {!r.data.some((a) => !selected || a.date === selected) && (
              <p>ยังไม่มีรายงานกิจกรรมในช่วงนี้</p>
            )}
          </section>
        </>
      ) : (
        !r.error && <p role="status">กำลังโหลดปฏิทิน…</p>
      )}
    </>
  );
}
export function AmendmentRequest({ record, notify }) {
  const [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sent, setSent] = useState(false);
  if (!record?.locked || !record.can_edit) return null;
  return (
    <section className="rm-card">
      <h2>รอบรายงานนี้ปิดแล้ว</h2>
      <p>
        ส่งเหตุผลให้หัวหน้าหน่วยพิจารณาเปิดรอบก่อนแก้ไข
        รายงานสรุปฉบับเก่าจะยังคงข้อมูลเดิม
      </p>
      <ErrorText text={error} />
      {sent ? (
        <p role="status">ส่งคำขอแล้ว ติดตามได้ที่เมนูคำขอแก้ไข</p>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/activities/" + record.id + "/amendment-requests", {
                method: "POST",
                body: { reason },
              });
              setSent(true);
              notify("ส่งคำขอแก้ไขแล้ว");
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="rm-field">
            <span>เหตุผลที่ต้องแก้ไข</span>
            <textarea
              required
              minLength={5}
              maxLength={2000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button className="rm-button" disabled={busy}>
            ส่งคำขอ
          </button>
        </form>
      )}
    </section>
  );
}
export function AmendmentQueue({ user, navigate }) {
  const r = useLoad("/amendment-requests"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [resolution, setResolution] = useState({});
  async function resolve(item, decision) {
    setBusy(true);
    setError("");
    try {
      await api("/amendment-requests/" + item.id + "/resolve", {
        method: "POST",
        body: { decision, reason: resolution[item.id] || "" },
      });
      r.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="rm-title">
        <h1>คำขอแก้ไขรายงาน</h1>
        <p>เจ้าของรายงานติดตามคำขอ หัวหน้าที่ดูแลหน่วยเป็นผู้พิจารณา</p>
      </header>
      <ErrorText text={error || r.error} />
      {r.data?.map((item) => (
        <section className="rm-card" key={item.id}>
          <h2>{item.title}</h2>
          <p>
            {item.requester} · {item.reason}
          </p>
          <span>
            {
              {
                pending: "รอพิจารณา",
                approved: "อนุมัติเปิดรอบแล้ว",
                rejected: "ไม่อนุมัติ",
              }[item.status]
            }
          </span>
          {item.resolution && <p>เหตุผลการพิจารณา: {item.resolution}</p>}
          <div className="rm-row">
            <button
              className="rm-button secondary"
              onClick={() => navigate("activity/" + item.activity_id)}
            >
              ดูรายงาน
            </button>
          </div>
          {item.status === "pending" &&
            user.roles.includes("head") &&
            user.scopes.includes(item.unit_id) && (
              <>
                <p className="rm-notice">
                  การอนุมัติจะเปิดรอบที่ครอบคลุมวันที่นี้ของทั้งหน่วยให้แก้ไขตามสิทธิ์
                  เมื่อแก้ครบให้ปิดรอบอีกครั้ง
                </p>
                <label className="rm-field">
                  <span>เหตุผลการพิจารณา (อย่างน้อย 5 ตัวอักษร)</span>
                  <textarea
                    value={resolution[item.id] || ""}
                    onChange={(e) =>
                      setResolution({
                        ...resolution,
                        [item.id]: e.target.value,
                      })
                    }
                  />
                </label>
                <div className="rm-row">
                  <button
                    className="rm-button"
                    disabled={
                      busy || (resolution[item.id] || "").trim().length < 5
                    }
                    onClick={() => resolve(item, "approve")}
                  >
                    อนุมัติและเปิดรอบของหน่วย
                  </button>
                  <button
                    className="rm-button secondary"
                    disabled={
                      busy || (resolution[item.id] || "").trim().length < 5
                    }
                    onClick={() => resolve(item, "reject")}
                  >
                    ไม่อนุมัติ
                  </button>
                </div>
              </>
            )}
        </section>
      ))}
      {r.data?.length === 0 && <p>ยังไม่มีคำขอแก้ไข</p>}
    </>
  );
}
export function SystemStatus() {
  const r = useLoad("/system-status");
  return (
    <>
      <header className="rm-title">
        <h1>สถานะระบบ</h1>
        <p>
          แสดงข้อมูลจากฐานข้อมูลและการตั้งค่าปัจจุบัน
          การตั้งค่าแล้วไม่ได้ยืนยันว่าบริการภายนอกเชื่อมต่อสำเร็จ
        </p>
      </header>
      <button className="rm-button secondary" onClick={r.reload}>
        ตรวจสถานะอีกครั้ง
      </button>
      <ErrorText text={r.error} />
      {r.data && (
        <>
          <div className="rm-cards">
            {[
              [r.data.accounts.active || 0, "บัญชีเปิดใช้งาน"],
              [r.data.accounts.linked || 0, "บัญชีที่ผูก LINE"],
              [r.data.files.count, "ไฟล์ในระบบ"],
              [
                (r.data.files.bytes / 1048576).toFixed(1) + " MB",
                "ขนาดไฟล์ที่บันทึก",
              ],
            ].map(([n, label]) => (
              <div className="rm-card rm-stat" key={label}>
                <strong>{n}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <section className="rm-card">
            <h2>ช่องทางและการประมวลผล</h2>
            <dl className="rm-status-list">
              <dt>ฐานข้อมูล</dt>
              <dd>{r.data.database === "ok" ? "ตอบสนองปกติ" : "ไม่พร้อม"}</dd>
              <dt>LINE รับข้อความ</dt>
              <dd>
                {r.data.line.receiveConfigured
                  ? "ตั้งค่าแล้ว"
                  : "ยังไม่ตั้งค่า"}
              </dd>
              <dt>LINE ตอบรับอัตโนมัติ</dt>
              <dd>{r.data.line.automatic ? "เปิดในค่าตั้งต้น" : "ปิด"}</dd>
              <dt>โมเดล</dt>
              <dd>
                {r.data.model || "ยังไม่ตั้งค่า · ใช้กฎเสนอข้อมูลเบื้องต้น"}
              </dd>
              <dt>ตัวอ่านเอกสาร</dt>
              <dd>
                {r.data.documentReader
                  ? "ตั้งค่า Python แล้ว"
                  : "ยังไม่ตั้งค่า"}
              </dd>
              <dt>รายงานตามรอบ</dt>
              <dd>{r.data.scheduledReports ? "เปิด" : "ปิด"}</dd>
              <dt>รายงานสรุปล่าสุด</dt>
              <dd>{r.data.latestExport || "ยังไม่มี"}</dd>
            </dl>
          </section>
          <section className="rm-card">
            <h2>งานประมวลผล LINE</h2>
            {r.data.jobs.length ? (
              r.data.jobs.map((j) => (
                <p key={j.state}>
                  {j.state}: {j.count} รายการ
                </p>
              ))
            ) : (
              <p>ยังไม่มีงานอัตโนมัติ</p>
            )}
          </section>
        </>
      )}
    </>
  );
}
