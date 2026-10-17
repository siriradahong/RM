import React, { useEffect, useRef, useState } from "react";
import { api, query } from "./api";
import "./expanded.css";
import { ReportDraft } from "./report-draft";
import { UnitPicker } from "./community";
const UNITS = [
  "กิจกรรม",
  "ครั้ง",
  "ครั้งบริการ",
  "คน",
  "ราย",
  "ตัน",
  "หลังคาเรือน",
  "แห่ง",
  "กิโลกรัม",
];
const number = (v) =>
  Number(v || 0).toLocaleString("th-TH", { maximumFractionDigits: 3 });
function useData(path) {
  const [data, setData] = useState(null),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!path) return;
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
  return { data, error, reload: () => setRevision((v) => v + 1) };
}
const Button = ({
  children,
  onClick,
  type = "button",
  disabled = false,
  secondary = false,
}) => (
  <button
    type={type}
    disabled={disabled}
    className={"rm-button " + (secondary ? "secondary" : "")}
    onClick={onClick}
  >
    {children}
  </button>
);
const Notice = ({ children, error = false }) =>
  children ? (
    <div
      className={"rm-notice " + (error ? "error" : "")}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  ) : null;
const Field = ({ label, children }) => (
  <label className="rm-field">
    <span>{label}</span>
    {children}
  </label>
);
const Title = ({ title, children }) => (
  <header className="rm-title">
    <h1>{title}</h1>
    <p>{children}</p>
  </header>
);
function State({ resource, children }) {
  return resource.error ? (
    <Notice error>{resource.error}</Notice>
  ) : !resource.data ? (
    <p role="status">กำลังโหลดข้อมูล…</p>
  ) : (
    children(resource.data)
  );
}
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function initialPeriod(unit = "") {
  const [year, month] = today().split("-").map(Number);
  return {
    period: "month",
    year,
    month,
    quarter: 1,
    unit: unit || "",
    mine: "0",
    from: today().slice(0, 7) + "-01",
    to: today(),
  };
}
function PeriodPicker({ value, onChange, meta, projects = [] }) {
  const change = (key, v) => onChange({ ...value, [key]: v });
  return (
    <div className="rm-controls">
      <Field label="รอบสรุป">
        <select
          value={value.period}
          onChange={(e) => {
            const period = e.target.value;
            const [year, month] = today().split("-").map(Number);
            onChange({
              ...value,
              period,
              year: ["quarter", "year"].includes(period)
                ? year +
                  ((meta.fiscalStart || 10) !== 1 &&
                  month >= (meta.fiscalStart || 10)
                    ? 1
                    : 0)
                : year,
            });
          }}
        >
          <option value="month">รายเดือน</option>
          <option value="quarter">รายไตรมาส</option>
          <option value="year">รายปีงบประมาณ</option>
          <option value="custom">กำหนดช่วงเอง</option>
        </select>
      </Field>
      {value.period === "custom" ? (
        <>
          <Field label="ตั้งแต่">
            <input
              type="date"
              value={value.from}
              onChange={(e) => change("from", e.target.value)}
            />
          </Field>
          <Field label="ถึง">
            <input
              type="date"
              value={value.to}
              onChange={(e) => change("to", e.target.value)}
            />
          </Field>
        </>
      ) : (
        <Field
          label={
            ["year", "quarter"].includes(value.period)
              ? "ปีงบประมาณ (พ.ศ.)"
              : "ปี (พ.ศ.)"
          }
        >
          <input
            type="number"
            min="2543"
            max="2743"
            value={Number(value.year) + 543}
            onChange={(e) => change("year", Number(e.target.value) - 543)}
          />
        </Field>
      )}
      {value.period === "month" && (
        <Field label="เดือน">
          <select
            value={value.month}
            onChange={(e) => change("month", +e.target.value)}
          >
            {[
              "มกราคม",
              "กุมภาพันธ์",
              "มีนาคม",
              "เมษายน",
              "พฤษภาคม",
              "มิถุนายน",
              "กรกฎาคม",
              "สิงหาคม",
              "กันยายน",
              "ตุลาคม",
              "พฤศจิกายน",
              "ธันวาคม",
            ].map((n, i) => (
              <option key={i} value={i + 1}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      )}
      {value.period === "quarter" && (
        <Field label="ไตรมาส">
          <select
            value={value.quarter}
            onChange={(e) => change("quarter", +e.target.value)}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                ไตรมาส {n}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="หน่วยงาน">
        <select
          value={value.unit}
          onChange={(e) => change("unit", e.target.value)}
        >
          <option value="">ทั้งสำนัก</option>
          {meta.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      {!!projects.length && (
        <Field label="โครงการ">
          <select
            value={value.project || ""}
            onChange={(e) => change("project", e.target.value)}
          >
            <option value="">ทุกโครงการ</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <label className="rm-checkbox">
        <input
          type="checkbox"
          checked={value.mine === "1"}
          onChange={(e) => change("mine", e.target.checked ? "1" : "0")}
        />
        เฉพาะข้อมูลที่ฉันนำเข้า
      </label>
    </div>
  );
}
function ActivityTable({ rows, navigate }) {
  return (
    <div className="rm-table">
      <table>
        <thead>
          <tr>
            <th>วันที่</th>
            <th>กิจกรรม / โครงการ</th>
            <th>ฝ่าย / ผู้ส่ง</th>
            <th>สถานะ</th>
            <th>หลักฐาน</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>{a.date || "ยังไม่ระบุ"}</td>
              <td>
                {a.title}
                <small>{a.project_name || ""}</small>
              </td>
              <td>
                {a.unit_name}
                <small>{a.owner_name || ""}</small>
              </td>
              <td>{a.status === "ready" ? "ยืนยันแล้ว" : "รอยืนยัน"}</td>
              <td>
                <Button secondary onClick={() => navigate("activity/" + a.id)}>
                  ดูต้นฉบับ #{a.id}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="rm-empty">ไม่มีรายการในช่วงที่เลือก</p>}
    </div>
  );
}
function Bars({ rows }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="rm-bars">
      {rows.map((r) => (
        <div key={r.name}>
          <span>{r.name}</span>
          <div className="rm-track">
            <i style={{ width: (r.count / max) * 100 + "%" }} />
          </div>
          <strong>{number(r.count)}</strong>
        </div>
      ))}
      {!rows.length && <p className="rm-empty">ยังไม่มีข้อมูลที่ยืนยันแล้ว</p>}
    </div>
  );
}
function Insights({ user, meta, navigate }) {
  const [filters, setFilters] = useState(() =>
      initialPeriod(user.unit_id || user.scopes[0]),
    ),
    [ids, setIds] = useState(null);
  const projects = useData("/projects"),
    r = useData("/insights?" + query(filters));
  useEffect(() => setIds(null), [JSON.stringify(filters)]);
  return (
    <>
      <Title title="วิเคราะห์ผลตามหน่วยงาน">
        แม่แบบและตัวชี้วัดตามประเภทงาน คำนวณจากข้อมูลที่ยืนยัน
        พร้อมตรวจย้อนกลับถึงต้นฉบับ
      </Title>
      <PeriodPicker
        value={filters}
        onChange={setFilters}
        meta={meta}
        projects={projects.data || []}
      />
      <State resource={r}>
        {(d) => (
          <>
            <Notice>
              ช่วงข้อมูล {d.period.from} ถึง {d.period.to} · {d.note}
            </Notice>
            <div className="rm-cards">
              <button
                className="rm-card rm-stat"
                onClick={() =>
                  setIds(
                    d.activities
                      .filter((a) => a.status === "ready")
                      .map((a) => a.id),
                  )
                }
              >
                <small>กิจกรรมที่ยืนยัน</small>
                <strong>{number(d.ready)}</strong>
                <span>กดดูรายการที่นำมานับ</span>
              </button>
              <button
                className="rm-card rm-stat"
                onClick={() =>
                  setIds(
                    d.activities
                      .filter((a) => a.status === "pending")
                      .map((a) => a.id),
                  )
                }
              >
                <small>รอยืนยัน / ไม่รวมยอด</small>
                <strong>{number(d.pending)}</strong>
              </button>
              <div className="rm-card rm-stat">
                <small>พื้นที่ที่มีรายงานยืนยัน</small>
                <strong>{number(d.areaCount)}</strong>
              </div>
              <div className="rm-card rm-stat">
                <small>เทียบรอบก่อน</small>
                <strong>
                  {d.comparison.change > 0 ? "+" : ""}
                  {number(d.comparison.change)}
                </strong>
                <span>
                  {d.comparison.percent === null
                    ? "รอบก่อนเป็นศูนย์ ไม่คำนวณเปอร์เซ็นต์"
                    : d.comparison.percent + "%"}{" "}
                  · จำนวนกิจกรรม
                </span>
              </div>
            </div>
            <h2>ผลเชิงปริมาณตามประเภทงาน</h2>
            <div className="rm-cards">
              {d.metrics.map((m, i) => (
                <button
                  className="rm-card rm-stat"
                  key={i}
                  onClick={() => setIds(m.activity_ids)}
                >
                  <small>{m.label}</small>
                  <strong>
                    {number(m.value)} <em>{m.unit}</em>
                  </strong>
                  <span>
                    {m.aggregation === "sum"
                      ? "รวมยอด"
                      : m.aggregation === "max"
                        ? "ค่าสูงสุด"
                        : "ค่าล่าสุด"}
                  </span>
                  {m.note && <small>{m.note}</small>}
                </button>
              ))}
            </div>
            {!d.metrics.length && (
              <p className="rm-empty">
                ยังไม่มีผลเชิงปริมาณในช่วงนี้
                รายการที่ไม่มีตัวเลขยังแสดงในจำนวนกิจกรรมได้
              </p>
            )}
            <div className="rm-columns">
              <section className="rm-card">
                <h2>จำนวนกิจกรรมตามหน่วยงาน</h2>
                <Bars rows={d.byUnit} />
              </section>
              <section className="rm-card">
                <h2>แนวโน้มรายเดือน</h2>
                <Bars rows={d.months} />
              </section>
            </div>
            <details className="rm-card">
              <summary>แม่แบบที่ใช้และรายการที่ควรตรวจ</summary>
              <p>
                {d.templates.map((t) => t.name).join(" · ") ||
                  "ใช้ตัวชี้วัดที่บันทึกในรายงาน"}
              </p>
              <p>
                ยังไม่ระบุวันที่ {d.quality.missingDates.length} รายการ ·
                ยืนยันแล้วแต่ไม่มีตัวเลข {d.quality.missingMetrics.length}{" "}
                รายการ
              </p>
              <small>
                จำนวนกิจกรรมเพิ่มหรือลดไม่ได้ยืนยันคุณภาพการทำงาน
                ต้องอ่านบริบทและความครบถ้วนของรายงานประกอบ
              </small>
            </details>
            <div className="rm-row">
              <h2>
                {ids
                  ? "รายการที่ประกอบเป็นยอดที่เลือก"
                  : "รายงานในช่วงที่เลือก"}
              </h2>
              {ids && (
                <Button secondary onClick={() => setIds(null)}>
                  แสดงทั้งหมด
                </Button>
              )}
            </div>
            <ActivityTable
              rows={d.activities.filter((a) => !ids || ids.includes(a.id))}
              navigate={navigate}
            />
          </>
        )}
      </State>
    </>
  );
}
function Exports({ meta, notify, user }) {
  const [filters, setFilters] = useState(() => initialPeriod()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [created, setCreated] = useState(null);
  const history = useData("/report-exports");
  async function create() {
    setBusy(true);
    setError("");
    try {
      const d = await api("/report-exports", { method: "POST", body: filters });
      setCreated(d);
      history.reload();
      notify("สร้างรายงานฉบับย้อนหลังแล้ว");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Title title="รายงานสรุปย้อนหลัง">
        สร้างรายงานรายเดือน ไตรมาส หรือปี
        และเก็บข้อมูลฉบับที่ส่งออกไว้ตรวจสอบภายหลัง
      </Title>
      <PeriodPicker value={filters} onChange={setFilters} meta={meta} />
      <Notice error>{error}</Notice>
      <Button disabled={busy} onClick={create}>
        {busy ? "กำลังรวบรวมข้อมูล…" : "สร้างรายงานสรุป"}
      </Button>
      {created && (
        <div className="rm-card">
          <h2>รายงานฉบับ #{created.id}</h2>
          <p>
            {created.period.from} ถึง {created.period.to} · ยืนยัน{" "}
            {created.ready} กิจกรรม · รอยืนยัน {created.pending} รายการ
          </p>
          <ExportLinks id={created.id} />
        </div>
      )}
      <h2>รายงานที่เก็บไว้</h2>
      <State resource={history}>
        {(rows) => (
          <div className="rm-stack">
            {rows.map((r) => (
              <article className="rm-card" key={r.id}>
                <h3>{r.title}</h3>
                <p>
                  ฉบับ #{r.id} · {r.created_at}{" "}
                  {r.schedule_key ? "· สร้างตามกำหนดอัตโนมัติ" : ""}
                </p>
                <ExportLinks id={r.id} />
                <ReportDraft
                  exportId={r.id}
                  user={user}
                  modelConfigured={meta.ai?.configured}
                />
              </article>
            ))}
            {!rows.length && <p>ยังไม่มีรายงานย้อนหลัง</p>}
          </div>
        )}
      </State>
      <Notice>
        PDF ใช้หน้าพิมพ์ของเบราว์เซอร์แล้วเลือกบันทึกเป็น PDF ส่วน Word
        ดาวน์โหลดเป็น .docx ได้โดยตรง
        การแก้รายงานต้นทางภายหลังจะไม่เปลี่ยนฉบับที่เก็บไว้
      </Notice>
    </>
  );
}
const ExportLinks = ({ id }) => (
  <div className="rm-row">
    <a
      className="rm-button"
      href={`/api/report-exports/${id}/download?format=html`}
      target="_blank"
      rel="noopener noreferrer"
    >
      เปิด / พิมพ์ / บันทึก PDF
    </a>
    <a
      className="rm-button secondary"
      href={`/api/report-exports/${id}/download?format=docx`}
    >
      ดาวน์โหลด Word
    </a>
    <a
      className="rm-button secondary"
      href={`/api/report-exports/${id}/download?format=json`}
    >
      ข้อมูลฉบับนี้
    </a>
  </div>
);
const blankMetric = () => ({ label: "", value: 0, unit: "คน" });
function MetricInputs({ value, onChange, definitions = false }) {
  const change = (i, k, v) =>
    onChange(value.map((m, n) => (n === i ? { ...m, [k]: v } : m)));
  return (
    <>
      <div className="rm-stack">
        {value.map((m, i) => (
          <div className="rm-metric-edit" key={i}>
            <Field label="ชื่อตัวชี้วัด">
              <input
                required
                maxLength={100}
                value={m.label}
                onChange={(e) => change(i, "label", e.target.value)}
              />
            </Field>
            {definitions ? (
              <Field label="ชื่ออื่นที่ใช้ (คั่นด้วย ,)">
                <input
                  value={m.aliases.join(",")}
                  onChange={(e) =>
                    change(
                      i,
                      "aliases",
                      e.target.value.split(",").map((s) => s.trim()),
                    )
                  }
                />
              </Field>
            ) : (
              <Field label="เป้าหมายจากเอกสาร">
                <input
                  type="number"
                  required
                  min="0"
                  step="any"
                  value={m.value}
                  onChange={(e) => change(i, "value", +e.target.value)}
                />
              </Field>
            )}
            <Field label="หน่วย">
              <UnitPicker
                label={"หน่วยตัวชี้วัด " + (i + 1)}
                value={m.unit}
                onChange={(unit) => change(i, "unit", unit)}
              />
            </Field>
            {definitions && (
              <Field label="วิธีรวม">
                <select
                  value={m.aggregation}
                  onChange={(e) => change(i, "aggregation", e.target.value)}
                >
                  <option value="sum">รวมยอด</option>
                  <option value="max">ค่าสูงสุด</option>
                  <option value="latest">ค่าล่าสุดตามวันที่กิจกรรม</option>
                </select>
              </Field>
            )}
            <Button
              secondary
              onClick={() => onChange(value.filter((_, n) => n !== i))}
            >
              เอาออก
            </Button>
          </div>
        ))}
      </div>
      <Button
        secondary
        onClick={() =>
          onChange([
            ...value,
            definitions
              ? { label: "", aliases: [], unit: "คน", aggregation: "sum" }
              : blankMetric(),
          ])
        }
      >
        เพิ่มตัวชี้วัด
      </Button>
    </>
  );
}
function Projects({ user, meta, navigate, notify }) {
  const list = useData("/projects"),
    [selected, setSelected] = useState(null),
    [form, setForm] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const detail = useData(selected ? "/projects/" + selected : null);
  const reports = useData("/activities?limit=100"),
    [reportId, setReportId] = useState("");
  const writable = user.roles.some((r) => ["staff", "head"].includes(r));
  const open = (p) =>
    setForm(
      p
        ? { ...p }
        : {
            name: "",
            unit_id: user.unit_id || user.scopes[0] || "",
            description: "",
            start_date: "",
            end_date: "",
            targets: [],
          },
    );
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await api("/projects" + (form.id ? "/" + form.id : ""), {
        method: form.id ? "PUT" : "POST",
        body: {
          ...form,
          unit_id: +form.unit_id,
          start_date: form.start_date || null,
          end_date: form.end_date || null,
        },
      });
      setForm(null);
      setSelected(d.id);
      list.reload();
      detail.reload();
      notify("บันทึกทะเบียนโครงการแล้ว");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function link() {
    setBusy(true);
    setError("");
    try {
      await api("/activities/" + reportId + "/project", {
        method: "PUT",
        body: { project_id: selected },
      });
      detail.reload();
      list.reload();
      notify("เชื่อมรายงานกับโครงการแล้ว");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Title title="ผลการดำเนินงานรายโครงการ">
        รวบรวมกิจกรรม ผลสะสม และหลักฐานของโครงการเดิม
        เป้าหมายใช้เท่าที่มีเอกสารยืนยัน
      </Title>
      <Notice error>{error}</Notice>
      {writable && (
        <Button onClick={() => open(null)}>เพิ่มทะเบียนโครงการ</Button>
      )}
      {form && (
        <form className="rm-card rm-stack" onSubmit={save}>
          <h2>{form.id ? "แก้ไข" : "เพิ่ม"}ทะเบียนโครงการ</h2>
          <Field label="ชื่อโครงการ">
            <input
              required
              maxLength={300}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="หน่วยงานเจ้าของ">
            <select
              required
              disabled={!!form.id}
              value={form.unit_id}
              onChange={(e) => setForm({ ...form, unit_id: +e.target.value })}
            >
              {meta.units
                .filter(
                  (u) =>
                    u.active &&
                    u.kind !== "section" &&
                    (u.id === user.unit_id ||
                      (user.roles.includes("head") &&
                        user.scopes.includes(u.id))),
                )
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="รายละเอียด / ที่มาของเป้าหมาย">
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
            />
          </Field>
          <div className="rm-columns">
            <Field label="เริ่มโครงการ (ถ้ามี)">
              <input
                type="date"
                value={form.start_date || ""}
                onChange={(e) =>
                  setForm({ ...form, start_date: e.target.value })
                }
              />
            </Field>
            <Field label="สิ้นสุดโครงการ (ถ้ามี)">
              <input
                type="date"
                value={form.end_date || ""}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </Field>
          </div>
          <MetricInputs
            value={form.targets}
            onChange={(targets) => setForm({ ...form, targets })}
          />
          <div className="rm-row">
            <Button type="submit" disabled={busy}>
              บันทึก
            </Button>
            <Button secondary onClick={() => setForm(null)}>
              ยกเลิก
            </Button>
          </div>
        </form>
      )}
      <State resource={list}>
        {(projects) => (
          <div className="rm-cards">
            {projects.map((p) => (
              <button
                key={p.id}
                className="rm-card rm-project"
                onClick={() => {
                  setSelected(p.id);
                  setError("");
                }}
              >
                <h2>{p.name}</h2>
                <p>{p.unit_name}</p>
                <strong>{p.activity_count} กิจกรรมที่เชื่อมไว้</strong>
              </button>
            ))}
            {!projects.length && <p>ยังไม่มีทะเบียนโครงการ</p>}
          </div>
        )}
      </State>
      {selected && (
        <State resource={detail}>
          {(p) => (
            <section className="rm-card">
              <div className="rm-row">
                <h2>{p.name}</h2>
                {p.can_edit && (
                  <Button secondary onClick={() => open(p)}>
                    แก้ไขโครงการ
                  </Button>
                )}
              </div>
              <p>{p.description}</p>
              <p>
                ยืนยันแล้ว {p.summary.ready} กิจกรรม · รอยืนยัน{" "}
                {p.summary.pending} รายการ
              </p>
              <div className="rm-cards">
                {p.progress.map((t, i) => (
                  <div className="rm-card" key={i}>
                    <b>{t.label}</b>
                    <p>
                      {t.actual === null
                        ? "ยังไม่มีค่าผลที่ตรงกัน"
                        : number(t.actual)}{" "}
                      / {number(t.value)} {t.unit}
                    </p>
                    <small>
                      {t.percent === null
                        ? "ยังคำนวณสัดส่วนไม่ได้"
                        : t.percent + "% ของเป้าหมายตัวชี้วัดนี้"}
                    </small>
                  </div>
                ))}
              </div>
              {!p.targets.length && (
                <Notice>
                  ยังไม่มีเป้าหมายที่ยืนยัน แสดงผลสะสมและไทม์ไลน์ตามรายงานที่มี
                </Notice>
              )}
              {p.can_edit && (
                <div className="rm-controls">
                  <Field label="เลือกรายงานที่มีสิทธิ์แก้ไขเพื่อเชื่อม">
                    <select
                      value={reportId}
                      onChange={(e) => setReportId(e.target.value)}
                    >
                      <option value="">เลือกรายงาน</option>
                      {(reports.data?.items || [])
                        .filter(
                          (a) =>
                            a.can_edit &&
                            !p.activities.some((x) => x.id === a.id),
                        )
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            #{a.id} {a.title}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Button disabled={!reportId || busy} onClick={link}>
                    เชื่อมรายงาน
                  </Button>
                </div>
              )}
              <h3>ไทม์ไลน์และหลักฐาน</h3>
              <ActivityTable rows={p.activities} navigate={navigate} />
            </section>
          )}
        </State>
      )}
    </>
  );
}
function Quality({ user, meta, navigate, notify }) {
  const duplicates = useData("/duplicates"),
    locks = useData("/period-locks"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [form, setForm] = useState({
      unit_id: user.scopes[0] || "",
      date_from: today().slice(0, 7) + "-01",
      date_to: today(),
      reason: "",
    });
  async function mutate(path, body) {
    setBusy(true);
    setError("");
    try {
      await api(path, { method: "POST", body });
      duplicates.reload();
      locks.reload();
      notify("บันทึกการเปลี่ยนแปลงแล้ว");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Title title="ตรวจข้อมูลซ้ำและรอบรายงาน">
        ตรวจต้นฉบับก่อนยืนยันรายการซ้ำ รายการเดิมยังเก็บไว้และคืนสถานะได้
      </Title>
      <Notice error>{error}</Notice>
      <State resource={duplicates}>
        {(d) => (
          <>
            <h2>รายการที่อาจซ้ำ</h2>
            {d.pairs.map(({ first: a, second: b, reason, can_merge }) => (
              <div className="rm-card" key={a.id + "-" + b.id}>
                <p>{reason}</p>
                <p>
                  #{a.id} {a.title} · {a.date} · {a.unit_name}
                </p>
                <p>
                  #{b.id} {b.title} · {b.date}
                </p>
                <div className="rm-row">
                  <Button
                    secondary
                    onClick={() => navigate("activity/" + a.id)}
                  >
                    ตรวจ #{a.id}
                  </Button>
                  <Button
                    secondary
                    onClick={() => navigate("activity/" + b.id)}
                  >
                    ตรวจ #{b.id}
                  </Button>
                  {can_merge && (
                    <Button
                      disabled={busy}
                      onClick={() => {
                        if (
                          window.confirm(
                            `ตรวจแล้วว่าเป็นกิจกรรมเดียวกัน ใช้ #${b.id} เป็นหลัก และไม่นับ #${a.id} ซ้ำ?`,
                          )
                        )
                          mutate("/duplicates/merge", {
                            duplicate_id: a.id,
                            canonical_id: b.id,
                            confirmed: true,
                          });
                      }}
                    >
                      ยืนยันว่า #{a.id} ซ้ำกับ #{b.id}
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {!d.pairs.length && <p>ไม่พบคู่ที่ตรงกฎตรวจซ้ำในรายการล่าสุด</p>}
            <details className="rm-card">
              <summary>รายการที่ยืนยันว่าซ้ำแล้ว ({d.merged.length})</summary>
              {d.merged.map((a) => (
                <div className="rm-row" key={a.id}>
                  <span>
                    #{a.id} {a.title} → รายการหลัก #{a.duplicate_of}
                  </span>
                  <Button
                    secondary
                    onClick={() => navigate("activity/" + a.id)}
                  >
                    ดูต้นฉบับ
                  </Button>
                  {a.can_restore && (
                    <Button
                      secondary
                      disabled={busy}
                      onClick={() =>
                        mutate("/duplicates/" + a.id + "/restore", {})
                      }
                    >
                      คืนรายการ
                    </Button>
                  )}
                </div>
              ))}
            </details>
          </>
        )}
      </State>
      <ArchiveIndex user={user} notify={notify} />
      <h2>ปิดและเปิดรอบรายงาน</h2>
      {user.roles.includes("head") && (
        <form
          className="rm-card rm-stack"
          onSubmit={(e) => {
            e.preventDefault();
            mutate("/period-locks", { ...form, unit_id: +form.unit_id });
          }}
        >
          <div className="rm-controls">
            <Field label="หน่วยงาน">
              <select
                value={form.unit_id}
                onChange={(e) => setForm({ ...form, unit_id: e.target.value })}
              >
                {meta.units
                  .filter((u) => user.scopes.includes(u.id))
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="เริ่มรอบ">
              <input
                type="date"
                required
                value={form.date_from}
                onChange={(e) =>
                  setForm({ ...form, date_from: e.target.value })
                }
              />
            </Field>
            <Field label="สิ้นสุดรอบ">
              <input
                type="date"
                required
                value={form.date_to}
                onChange={(e) => setForm({ ...form, date_to: e.target.value })}
              />
            </Field>
            <Field label="เหตุผล">
              <input
                required
                maxLength={300}
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </Field>
            <Button type="submit" disabled={busy}>
              ปิดรอบ
            </Button>
          </div>
          <small>
            การปิดรอบป้องกันการแก้ไขข้อมูลที่อยู่ในช่วงนี้
            หัวหน้าต้องเปิดรอบพร้อมระบุเหตุผลเมื่อต้องแก้ไข
          </small>
        </form>
      )}
      <State resource={locks}>
        {(rows) => (
          <div className="rm-stack">
            {rows.map((l) => (
              <div className="rm-card" key={l.id}>
                <b>{l.unit_name}</b>
                <p>
                  {l.date_from} ถึง {l.date_to} ·{" "}
                  {l.active ? "ปิดรอบอยู่" : "เปิดรอบแล้ว"} · {l.reason}
                </p>
                {!!l.active &&
                  user.roles.includes("head") &&
                  user.scopes.includes(l.unit_id) && (
                    <Button
                      secondary
                      disabled={busy}
                      onClick={() => {
                        const reason = window.prompt(
                          "เหตุผลที่เปิดรอบให้แก้ไข",
                        );
                        if (reason?.trim())
                          mutate("/period-locks/" + l.id + "/reopen", {
                            reason,
                          });
                      }}
                    >
                      เปิดรอบเพื่อแก้ไข
                    </Button>
                  )}
              </div>
            ))}
          </div>
        )}
      </State>
    </>
  );
}
function TemplateSettings({ meta, notify }) {
  const ts = useData("/report-templates"),
    settings = useData("/report-settings"),
    [form, setForm] = useState(null),
    [config, setConfig] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (settings.data) setConfig(settings.data);
  }, [settings.data]);
  async function saveTemplate(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/report-templates" + (form.id ? "/" + form.id : ""), {
        method: form.id ? "PUT" : "POST",
        body: {
          ...form,
          keywords: form.keywords.filter(Boolean),
          metrics: form.metrics.map((m) => ({
            ...m,
            aliases: m.aliases.filter(Boolean),
          })),
        },
      });
      setForm(null);
      ts.reload();
      notify("บันทึกแม่แบบแล้ว มีผลกับการสรุปครั้งถัดไป");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveSettings() {
    setBusy(true);
    setError("");
    try {
      await api("/report-settings", {
        method: "PUT",
        body: {
          fiscal_start_month: config.fiscal_start_month,
          scheduled_reports: config.scheduled_reports,
          report_periods: config.report_periods,
          line_reply_enabled: config.line_reply_enabled,
        },
      });
      notify("บันทึกการตั้งค่าแล้ว");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Title title="แม่แบบและการสรุปอัตโนมัติ">
        กำหนดหน่วยงาน ตัวชี้วัด หน่วยนับ และวิธีรวมข้อมูล
        หัวหน้าฝ่ายใช้แดชบอร์ดได้ทันทีตามค่าที่กำหนด
      </Title>
      <Notice error>{error}</Notice>
      <Button
        onClick={() =>
          setForm({
            name: "",
            keywords: [],
            unit_ids: [],
            metrics: [],
            active: true,
          })
        }
      >
        เพิ่มแม่แบบ
      </Button>
      {form && (
        <form className="rm-card rm-stack" onSubmit={saveTemplate}>
          <Field label="ชื่อแม่แบบ">
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="คำอธิบายประเภทงาน / คำสำคัญ (คั่นด้วย ,)">
            <input
              value={form.keywords.join(",")}
              onChange={(e) =>
                setForm({
                  ...form,
                  keywords: e.target.value.split(",").map((s) => s.trim()),
                })
              }
            />
          </Field>
          <fieldset>
            <legend>หน่วยงานที่ใช้ (ไม่เลือก = ใช้ร่วมกัน)</legend>
            <div className="rm-unit-options">
              {meta.units
                .filter((u) => u.kind !== "section")
                .map((u) => (
                  <label className="rm-checkbox" key={u.id}>
                    <input
                      type="checkbox"
                      checked={form.unit_ids.includes(u.id)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          unit_ids: e.target.checked
                            ? [...form.unit_ids, u.id]
                            : form.unit_ids.filter((id) => id !== u.id),
                        })
                      }
                    />
                    {u.name}
                  </label>
                ))}
            </div>
          </fieldset>
          <MetricInputs
            definitions
            value={form.metrics}
            onChange={(metrics) => setForm({ ...form, metrics })}
          />
          <label className="rm-checkbox">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
            />
            เปิดใช้งานแม่แบบ
          </label>
          <div className="rm-row">
            <Button type="submit" disabled={busy}>
              บันทึกแม่แบบ
            </Button>
            <Button secondary onClick={() => setForm(null)}>
              ยกเลิก
            </Button>
          </div>
        </form>
      )}
      <State resource={ts}>
        {(rows) => (
          <div className="rm-cards">
            {rows.map((t) => (
              <article className="rm-card" key={t.id}>
                <h2>{t.name}</h2>
                <p>
                  {t.unit_ids.length
                    ? t.unit_ids
                        .map((id) => meta.units.find((u) => u.id === id)?.name)
                        .join(", ")
                    : "ใช้ร่วมกันทุกฝ่าย"}{" "}
                  · {t.active ? "เปิดใช้" : "ปิดใช้"}
                </p>
                {t.metrics.map((m, i) => (
                  <p key={i}>
                    {m.label} · {m.unit} · {m.aggregation}
                  </p>
                ))}
                <Button secondary onClick={() => setForm(structuredClone(t))}>
                  แก้ไขแม่แบบ
                </Button>
              </article>
            ))}
          </div>
        )}
      </State>
      {config && (
        <section className="rm-card rm-stack">
          <h2>รอบรายงานและการทำงานอัตโนมัติ</h2>
          <Field label="เดือนเริ่มปีงบประมาณ">
            <select
              value={config.fiscal_start_month}
              onChange={(e) =>
                setConfig({ ...config, fiscal_start_month: +e.target.value })
              }
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i} value={i + 1}>
                  เดือน {i + 1}
                </option>
              ))}
            </select>
          </Field>
          <label className="rm-checkbox">
            <input
              type="checkbox"
              checked={config.scheduled_reports}
              onChange={(e) =>
                setConfig({ ...config, scheduled_reports: e.target.checked })
              }
            />
            สร้างรายงานของรอบที่สิ้นสุดแล้วอัตโนมัติ เก็บในหน้ารายงานย้อนหลัง
          </label>
          <div className="rm-row">
            {[
              ["month", "รายเดือน"],
              ["quarter", "รายไตรมาส"],
              ["year", "รายปี"],
            ].map(([k, n]) => (
              <label className="rm-checkbox" key={k}>
                <input
                  type="checkbox"
                  checked={config.report_periods.includes(k)}
                  onChange={(e) =>
                    setConfig({
                      ...config,
                      report_periods: e.target.checked
                        ? [...config.report_periods, k]
                        : config.report_periods.filter((x) => x !== k),
                    })
                  }
                />
                {n}
              </label>
            ))}
          </div>
          <label className="rm-checkbox">
            <input
              type="checkbox"
              checked={config.line_reply_enabled}
              onChange={(e) =>
                setConfig({ ...config, line_reply_enabled: e.target.checked })
              }
            />
            ตอบรับและส่งลิงก์ตรวจรายงานทาง LINE เมื่อเชื่อมต่อจริง
          </label>
          <Notice>
            โมเดล:{" "}
            {config.ai.configured
              ? config.ai.model
              : "ยังไม่ตั้งค่า ใช้กฎช่วยหาข้อมูลแทน"}{" "}
            · ตัวอ่านเอกสาร:{" "}
            {config.documentReader === "configured"
              ? "ตั้งค่าแล้ว ต้องตรวจ dependency"
              : "ยังไม่ตั้งค่า"}{" "}
            การตั้งค่าโมเดลและ Token อยู่บนเซิร์ฟเวอร์
          </Notice>
          <div className="rm-row">
            <Button disabled={busy} onClick={saveSettings}>
              บันทึกการตั้งค่า
            </Button>
            <Button
              secondary
              disabled={busy}
              onClick={async () => {
                try {
                  const d = await api("/report-schedules/run", {
                    method: "POST",
                    body: {},
                  });
                  notify("สร้างรายงานตามกำหนด " + d.created + " ฉบับ");
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              ตรวจรอบและสร้างรายงานตอนนี้
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
function LineLink({ user }) {
  const [result, setResult] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <>
      <Title title="ผูกบัญชี LINE ของฉัน">
        เชื่อมบัญชีที่เข้าสู่ระบบอยู่กับ LINE โดยใช้รหัสครั้งเดียว
        ไม่เปลี่ยนบทบาทหรือสังกัดจากข้อความแชต
      </Title>
      <p>
        {user.line_user_id
          ? "บัญชีนี้มี LINE ที่ผูกไว้แล้ว สามารถผูกใหม่ด้วยรหัสครั้งเดียว"
          : "ยังไม่ได้ผูก LINE"}
      </p>
      <Notice error>{error}</Notice>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setResult(
              await api("/me/line-link-code", { method: "POST", body: {} }),
            );
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        สร้างรหัสผูกบัญชี
      </Button>
      {result && (
        <div className="rm-card">
          <p>{result.instruction}</p>
          <textarea
            readOnly
            rows={2}
            aria-label="ข้อความผูกบัญชี"
            value={result.command}
          />
          <p>
            หมดอายุ {new Date(result.expires_at).toLocaleTimeString("th-TH")}
          </p>
          <small>
            ส่งในแชตส่วนตัวของ OA ที่หน่วยงานกำหนด
            หลังผูกสำเร็จให้เข้าสู่ระบบใหม่เพื่อปรับสถานะบนหน้าจอ
          </small>
        </div>
      )}
    </>
  );
}
export function ExpandedPage(props) {
  const { section, user } = props;
  if (section === "insights") return <Insights {...props} />;
  if (section === "projects") return <Projects {...props} />;
  if (section === "reports") return <Exports {...props} />;
  if (section === "quality") return <Quality {...props} />;
  if (section === "news-candidates" && user.roles.includes("pr"))
    return <NewsCandidates {...props} />;
  if (section === "line-link") return <LineLink {...props} />;
  if (section === "report-settings" && user.roles.includes("admin"))
    return <TemplateSettings {...props} />;
  return <Notice error>ไม่มีสิทธิ์เข้าถึงหน้านี้</Notice>;
}
export function ActivityAssist({ record, meta, onApplied, navigate, notify }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [run, setRun] = useState(null),
    [projectId, setProjectId] = useState(record.project_id || "");
  const runs = useData("/activities/" + record.id + "/extractions"),
    projects = useData("/projects");
  useEffect(() => {
    setRun(null);
    setProjectId(record.project_id || "");
  }, [record.id, record.version, record.project_id]);
  const current =
    run || (runs.data?.[0] && { id: runs.data[0].id, ...runs.data[0].payload });
  async function extract() {
    setBusy(true);
    setError("");
    try {
      setRun(
        await api("/activities/" + record.id + "/extract", {
          method: "POST",
          body: {},
        }),
      );
      runs.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="rm-card rm-assist">
      <h2>จัดข้อมูลจากต้นฉบับ</h2>
      <p>
        {meta.ai.configured
          ? "ใช้โมเดลที่ตั้งค่าไว้เสนอข้อมูลให้ตรวจ"
          : "ขณะนี้ใช้กฎช่วยค้นวันที่และตัวเลข ยังไม่ได้ใช้โมเดล AI"}{" "}
        ข้อมูลที่เสนอจะยังไม่รวมในสรุปจนกดยืนยันรายงาน
      </p>
      <Notice error>{error}</Notice>
      {record.locked && (
        <Notice>รอบรายงานนี้ปิดแล้ว ต้องให้หัวหน้าเปิดรอบก่อนแก้ไข</Notice>
      )}
      <Button
        disabled={busy || record.locked || !!record.duplicate_of}
        onClick={extract}
      >
        {busy ? "กำลังอ่านข้อความและเสนอข้อมูล…" : "อ่านข้อความ / เสนอข้อมูล"}
      </Button>
      {current && (
        <div className="rm-stack">
          <p>วิธีประมวลผล: {current.engine}</p>
          {current.warnings?.map((w, i) => (
            <Notice key={i}>{w}</Notice>
          ))}
          {!current.is_report && (
            <Notice>ยังไม่พบว่าเป็นรายงานการปฏิบัติงาน กรุณาตรวจต้นฉบับ</Notice>
          )}
          {current.activities?.map((a, i) => (
            <details className="rm-card" key={i} open>
              <summary>
                รายการที่ {i + 1}: {a.title}
              </summary>
              <p>
                วันที่ {a.date || "ยังไม่พบ"} · พื้นที่ {a.area || "ยังไม่พบ"}
              </p>
              <p>{a.result || "ยังไม่พบผลการดำเนินงาน"}</p>
              {a.metrics.map((m, j) => (
                <p key={j}>
                  {m.label}: {number(m.value)} {m.unit}
                </p>
              ))}
              {a.evidence?.map((e, j) => (
                <blockquote key={j}>
                  {e.field}: {e.quote}
                </blockquote>
              ))}
              <Button
                disabled={busy || record.status !== "pending" || record.locked}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const r = await api(
                      "/activities/" + record.id + "/apply-extraction",
                      {
                        method: "POST",
                        body: {
                          run_id: current.id,
                          index: i,
                          version: record.version,
                        },
                      },
                    );
                    notify("นำข้อมูลมาให้ตรวจแล้ว ยังไม่รวมในสรุป");
                    if (r.id === record.id) await onApplied();
                    else navigate("activity/" + r.id);
                  } catch (e) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                ใช้ข้อมูลรายการนี้เพื่อรอตรวจยืนยัน
              </Button>
            </details>
          ))}
        </div>
      )}
      <details>
        <summary>เชื่อมกับทะเบียนโครงการ</summary>
        <div className="rm-controls">
          <Field label="โครงการ">
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            >
              <option value="">ไม่เชื่อมโครงการ</option>
              {(projects.data || [])
                .filter((p) => p.can_edit)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
          <Button
            disabled={busy || record.locked}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/activities/" + record.id + "/project", {
                  method: "PUT",
                  body: { project_id: projectId ? +projectId : null },
                });
                notify("บันทึกการเชื่อมโครงการแล้ว");
                await onApplied();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            บันทึกการเชื่อม
          </Button>
        </div>
      </details>
    </section>
  );
}

function ArchiveIndex({ user, notify }) {
  const r = useData("/files?limit=100"),
    [id, setId] = useState(""),
    [busy, setBusy] = useState(false),
    [out, setOut] = useState(null),
    [error, setError] = useState("");
  return (
    <section className="rm-card">
      <h2>อ่านข้อความในไฟล์เพื่อค้นย้อนหลัง</h2>
      <p>ใช้กับไฟล์ฝากเก็บได้ด้วย โดยไม่สร้างกิจกรรมหรือเพิ่มยอดผลงาน</p>
      <div className="rm-controls">
        <Field label="ไฟล์ที่มีสิทธิ์จัดข้อมูล">
          <select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">เลือกไฟล์</option>
            {(r.data?.items || [])
              .filter(
                (f) =>
                  (user.roles.includes("staff") && f.owner_id === user.id) ||
                  (user.roles.includes("head") &&
                    user.scopes.includes(f.unit_id)),
              )
              .map((f) => (
                <option value={f.id} key={f.id}>
                  {f.title}
                </option>
              ))}
          </select>
        </Field>
        <Button
          disabled={!id || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const d = await api("/files/" + id + "/read", {
                method: "POST",
                body: {},
              });
              setOut(d);
              notify(
                d.indexed
                  ? "เก็บข้อความสำหรับค้นหาแล้ว"
                  : "ยังอ่านไม่พบข้อความ",
              );
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "กำลังอ่านเอกสาร…" : "อ่านข้อความเพื่อค้นหา"}
        </Button>
      </div>
      <Notice error>{error}</Notice>
      {out && (
        <>
          <Notice>{out.warnings.join(" · ")}</Notice>
          <details>
            <summary>ข้อความที่อ่านได้</summary>
            <pre style={{ whiteSpace: "pre-wrap" }}>{out.text}</pre>
          </details>
        </>
      )}
    </section>
  );
}
function NewsCandidates({ navigate, notify }) {
  const r = useData("/news-candidates"),
    ready = useData("/activities?status=ready&limit=100"),
    [id, setId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Title title="คิวเสนอข่าวประชาสัมพันธ์">
        รับข้อเสนอจากเจ้าหน้าที่หรือโมเดล
        ตรวจต้นฉบับและรูปก่อนสร้างฉบับข่าวเพื่ออนุมัติเผยแพร่
      </Title>
      <Notice error>{error}</Notice>
      <div className="rm-controls">
        <Field label="รายงานที่ยืนยันแล้ว">
          <select value={id} onChange={(e) => setId(e.target.value)}>
            <option value="">เลือกรายงานให้โมเดลช่วยเสนอ</option>
            {(ready.data?.items || []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </Field>
        <Button
          disabled={busy || !id}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await api("/news-candidates/analyze", {
                method: "POST",
                body: { activity_id: +id },
              });
              r.reload();
              notify("ได้ข้อเสนอแล้ว กรุณาตรวจเองก่อนจัดทำข่าว");
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "กำลังวิเคราะห์…" : "ให้ AI ช่วยเสนอ"}
        </Button>
      </div>
      <State resource={r}>
        {(rows) => (
          <div className="rm-stack">
            {rows.map((n) => (
              <article className="rm-card" key={n.activity_id}>
                <h2>{n.title}</h2>
                <p>
                  {n.unit_name} ·{" "}
                  {n.source === "staff" ? "เจ้าหน้าที่เสนอ" : "โมเดลเสนอ"} ·{" "}
                  {n.status === "ready"
                    ? "รายงานยืนยันแล้ว"
                    : "รายงานยังรอยืนยัน"}
                </p>
                <p>
                  {n.result.candidate
                    ? "เสนอให้พิจารณา"
                    : "โมเดลยังไม่เสนอ ให้เจ้าหน้าที่พิจารณาต่อได้"}{" "}
                  · {n.result.reason}
                </p>
                {n.result.evidence && (
                  <blockquote>{n.result.evidence}</blockquote>
                )}
                <div className="rm-row">
                  <Button
                    secondary
                    onClick={() => navigate("activity/" + n.activity_id)}
                  >
                    ดูรายงานต้นฉบับ
                  </Button>
                  <Button
                    disabled={n.status !== "ready"}
                    onClick={() => navigate("news")}
                  >
                    ไปจัดทำและอนุมัติข่าว
                  </Button>
                </div>
              </article>
            ))}
            {!rows.length && <p>ยังไม่มีรายงานเสนอเข้าคิวข่าว</p>}
          </div>
        )}
      </State>
    </>
  );
}
