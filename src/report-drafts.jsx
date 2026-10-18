import { AISuggestion } from "./scope-workspace";
import React, { useState, useEffect } from "react";
import { api, query } from "./api";
import {
  Button,
  Field,
  Heading,
  DataState,
  useData,
  today,
  dateText,
  ReportSteps,
  ReportTabs,
} from "./workspace-ui";
export default function ReportDrafts({ id, user, meta, navigate }) {
  if (id === "new")
    return <DraftBuilder user={user} meta={meta} navigate={navigate} />;
  if (id)
    return <DraftReader key={id} id={id} navigate={navigate} meta={meta} />;
  return <DraftList navigate={navigate} />;
}
function DraftList({ navigate }) {
  const r = useData("/report-drafts");
  return (
    <>
      <ReportTabs page="drafts" navigate={navigate} />
      <Heading
        title="ฉบับรายงานสรุปผล"
        actions={
          <Button primary onClick={() => navigate("drafts/new")}>
            สร้างร่างรายงานสรุปผล
          </Button>
        }
      >
        เก็บฉบับยืนยันพร้อมตัวเลข แม่แบบ และข้อมูลอ้างอิง ณ วันที่จัดทำ
      </Heading>
      <DataState resource={r}>
        {(d) => (
          <section className="panel template-panel">
            {!d.items.length && (
              <p>ยังไม่มีฉบับรายงาน เลือกฝ่ายและช่วงเวลาเพื่อเริ่มจัดทำ</p>
            )}
            {d.items.map((x) => (
              <article className="draft-list-item" key={x.id}>
                <div>
                  <h2>{x.title}</h2>
                  <p>
                    {x.author_name} · สร้าง {dateText(x.created_at)} ·{" "}
                    {x.status === "confirmed" ? "ยืนยันแล้ว" : "ฉบับร่าง"}
                  </p>
                </div>
                <Button onClick={() => navigate("drafts/" + x.id)}>
                  เปิดฉบับ {x.id}
                </Button>
              </article>
            ))}
          </section>
        )}
      </DataState>
    </>
  );
}
function DraftBuilder({ user, meta, navigate }) {
  const templates = useData("/summary-templates");
  const [filters, setFilters] = useState(() => {
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem("rm-draft-filters"));
    } catch {}
    sessionStorage.removeItem("rm-draft-filters");
    return (
      saved || {
        scope: user.roles.includes("executive")
          ? "all"
          : user.roles.includes("head") ||
              user.roles.includes("center_head") ||
              user.delegated
            ? "unit"
            : "mine",
        period: "month",
        anchor: today(),
        from: today(),
        to: today(),
        unit: "",
        work: "",
        category: "",
      }
    );
  });
  const [tid, setTid] = useState(""),
    [preview, setPreview] = useState(null),
    [selected, setSelected] = useState([]),
    [reviewed, setReviewed] = useState([]),
    [images, setImages] = useState([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (templates.data && !tid) {
      const ts = templates.data.items.filter(
        (t) =>
          (!filters.category || t.category_id === Number(filters.category)) &&
          (!t.unit_id || !filters.unit || t.unit_id === Number(filters.unit)) &&
          (filters.scope !== "unit" ||
            !t.unit_id ||
            user.scopes.includes(t.unit_id)),
      );
      const match = ts.find((t) => t.unit_id === Number(filters.unit)) || ts[0];
      if (match) setTid(String(match.id));
    }
  }, [templates.data]);
  const reset = () => {
    setPreview(null);
    setSelected([]);
    setReviewed([]);
    setImages([]);
    setError("");
  };
  const change = (k, v) => {
    reset();
    setFilters((f) => ({
      ...f,
      [k]: v,
      ...(k === "scope"
        ? { unit: "", work: "" }
        : k === "unit"
          ? { work: "" }
          : {}),
    }));
  };
  async function load(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await api("/report-drafts/preview", {
        method: "POST",
        body: { template_id: Number(tid), filters },
      });
      setPreview(d);
      setSelected(d.rows.filter((r) => r.auto_include).map((r) => r.id));
      setReviewed([]);
      setImages([]);
    } catch (e) {
      setPreview(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    setBusy(true);
    setError("");
    try {
      const d = await api("/report-drafts", {
        method: "POST",
        body: {
          template_id: Number(tid),
          filters,
          selected_ids: selected,
          reviewed_duplicate_ids: reviewed,
          image_ids: images,
          preview_token: preview.preview_token,
        },
      });
      navigate("drafts/" + d.id);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const toggle = (set, values, id) =>
    set(values.includes(id) ? values.filter((x) => x !== id) : [...values, id]);
  const availableTemplates = templates.data?.items || [];
  return (
    <>
      <Heading
        title="สร้างร่างรายงานสรุปผล"
        actions={
          <Button onClick={() => navigate("drafts")}>ฉบับที่จัดทำไว้</Button>
        }
      >
        เลือกข้อมูล → ตรวจความพร้อม → สร้างร่างจากข้อเท็จจริง → ตรวจยืนยัน
      </Heading>
      <p className="notice">
        เลือกฝ่ายและช่วงเวลา ระบบจะรวบรวมข้อมูลที่ยืนยันแล้วมาให้ตรวจ
      </p>
      <ReportSteps step={1} />
      <form className="panel template-panel project-form" onSubmit={load}>
        <DataState resource={templates}>
          {(d) =>
            d.items.length ? (
              <Field label="รูปแบบรายงาน">
                <select
                  required
                  value={tid}
                  onChange={(e) => {
                    reset();
                    setTid(e.target.value);
                  }}
                >
                  <option value="">เลือกแม่แบบ</option>
                  {d.items.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} —{" "}
                      {meta.units.find((u) => u.id === t.unit_id)?.name ||
                        "ทุกฝ่าย"}
                    </option>
                  ))}
                </select>
              </Field>
            ) : (
              <p>
                ยังไม่มีแม่แบบเปิดใช้ ให้แอดมินตั้งค่าที่ ดูแลระบบ →
                หน่วยงานและหมวดข้อมูล → แม่แบบข้อมูลและรายงานสรุป
              </p>
            )
          }
        </DataState>
        <div className="report-filters">
          <Field label="ขอบเขตร่าง">
            <select
              value={filters.scope}
              onChange={(e) => change("scope", e.target.value)}
            >
              <option value="mine">รายงานของฉัน</option>
              {(user.roles.includes("head") ||
                user.roles.includes("center_head") ||
                user.delegated) && (
                <option value="unit">หน่วยที่รับผิดชอบ</option>
              )}
              {user.roles.includes("executive") && (
                <option value="all">ทั้งสำนัก</option>
              )}
            </select>
          </Field>
          <Field label="ฝ่ายของรายงาน">
            <select
              value={
                availableTemplates.find((t) => t.id === Number(tid))?.unit_id ||
                filters.unit ||
                ""
              }
              disabled={
                !!availableTemplates.find((t) => t.id === Number(tid))?.unit_id
              }
              onChange={(e) => change("unit", e.target.value)}
            >
              <option value="">ตามขอบเขตและแม่แบบ</option>
              {meta.units
                .filter(
                  (u) =>
                    u.kind !== "section" &&
                    (filters.scope !== "unit" ||
                      user.scopes.includes(u.id) ||
                      (user.roles.includes("center_head") &&
                        user.unit_id === u.id)),
                )
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="ช่วงรายงาน">
            <select
              value={filters.period}
              onChange={(e) => change("period", e.target.value)}
            >
              <option value="month">เดือน</option>
              <option value="quarter">ไตรมาส</option>
              <option value="year">ปีงบประมาณ</option>
              <option value="custom">กำหนดเอง</option>
            </select>
          </Field>
          {filters.period === "custom" ? (
            <>
              <Field label="ตั้งแต่">
                <input
                  type="date"
                  required
                  value={filters.from}
                  onChange={(e) => change("from", e.target.value)}
                />
              </Field>
              <Field label="ถึง">
                <input
                  type="date"
                  required
                  value={filters.to}
                  onChange={(e) => change("to", e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Field label="วันที่ในช่วงรายงาน">
              <input
                type="date"
                required
                value={filters.anchor}
                onChange={(e) => change("anchor", e.target.value)}
              />
            </Field>
          )}
        </div>
        {filters.work && (
          <p>
            กรองงาน:{" "}
            {meta.works.find((w) => w.id === Number(filters.work))?.name ||
              filters.work}{" "}
            <Button type="button" onClick={() => change("work", "")}>
              ดูทุกงาน
            </Button>
          </p>
        )}
        <Button primary disabled={busy || !tid}>
          แสดงรายงานในช่วงนี้
        </Button>
      </form>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {preview && (
        <section className="panel template-panel">
          <h2>
            {preview.title} · {preview.template.name}
          </h2>
          <p>
            ใช้กับ{" "}
            {meta.units.find((u) => u.id === Number(preview.filters.unit))
              ?.name || preview.scope}{" "}
            · ประเภท{" "}
            {
              meta.categories.find((c) => c.id === preview.template.category_id)
                ?.name
            }
          </p>
          <div className="readiness-counts">
            <span>เลือกอัตโนมัติ {preview.quality.automatic}</span>
            <span>รอยืนยัน {preview.quality.pending}</span>
            <span>ขาดตามแม่แบบ {preview.quality.missing}</span>
            <span>อาจซ้ำ {preview.quality.possible_duplicates}</span>
          </div>
          <p className="muted">
            สถานะอาจซ้อนกัน รายการอาจซ้ำตรวจจากชื่อ วันที่ และฝ่ายตรงกัน
            ไม่ได้ลบหรือรวมรายงานต้นฉบับ
          </p>
          {preview.rows.map((r) => (
            <article className="selection-row" key={r.id}>
              <label className="check">
                <input
                  type="checkbox"
                  disabled={!r.eligible}
                  checked={selected.includes(r.id)}
                  onChange={() => {
                    toggle(setSelected, selected, r.id);
                    setImages(
                      images.filter(
                        (fid) => !r.files.some((f) => f.id === fid),
                      ),
                    );
                  }}
                />
                <b>
                  [{r.id}] {r.title}
                </b>
              </label>
              <p>
                {dateText(r.date)} · {r.unit_name} ·{" "}
                {r.status === "ready" ? "ยืนยันแล้ว" : "รอยืนยัน"}{" "}
                <button
                  className="table-link"
                  onClick={() =>
                    window.open("#activity/" + r.id, "_blank", "noopener")
                  }
                >
                  ดูต้นฉบับ
                </button>
              </p>
              {r.missing.length > 0 && (
                <p className="notice error">ขาด: {r.missing.join(", ")}</p>
              )}
              {r.duplicate_ids.length > 0 && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={reviewed.includes(r.id)}
                    onChange={() => toggle(setReviewed, reviewed, r.id)}
                  />
                  ตรวจแล้วให้รวมรายการนี้ แม้อาจซ้ำกับ{" "}
                  {r.duplicate_ids.join(", ")}
                </label>
              )}
              {selected.includes(r.id) &&
                r.files
                  .filter((f) => ["image/jpeg", "image/png"].includes(f.mime))
                  .map((f) => (
                    <label className="check" key={f.id}>
                      <input
                        type="checkbox"
                        disabled={
                          (!images.includes(f.id) && images.length >= 4) ||
                          f.size > 3 * 1024 * 1024
                        }
                        checked={images.includes(f.id)}
                        onChange={() => toggle(setImages, images, f.id)}
                      />
                      ใส่รูป {f.title}
                      {f.size > 3 * 1024 * 1024 ? " (เกิน 3 MB)" : ""}
                    </label>
                  ))}
            </article>
          ))}
          {!preview.rows.length && (
            <p>ไม่มีรายงานตรงกับฝ่าย ประเภท และช่วงเวลาที่เลือก</p>
          )}
          <p>
            เลือก {selected.length} รายงาน · รูป {images.length}/4 ·
            รายการที่ไม่เลือกจะถูกบันทึกว่าไม่รวมในฉบับนี้
          </p>
          <Button
            primary
            disabled={
              busy ||
              !selected.length ||
              preview.rows.some(
                (r) =>
                  selected.includes(r.id) &&
                  r.duplicate_ids.length &&
                  !reviewed.includes(r.id),
              )
            }
            onClick={create}
          >
            ต่อไป: ตรวจร่างรายงาน
          </Button>
        </section>
      )}
    </>
  );
}
function DraftReader({ id, navigate, meta }) {
  const resource = useData("/report-drafts/" + id),
    [form, setForm] = useState(null),
    [reviewed, setReviewed] = useState(false),
    [accept, setAccept] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [focus, setFocus] = useState(null);
  useEffect(() => {
    if (resource.data) {
      setForm({
        title: resource.data.title,
        narrative: resource.data.narrative,
      });
      setReviewed(false);
    }
  }, [resource.data]);
  async function save(confirm) {
    setBusy(true);
    setError("");
    try {
      await api("/report-drafts/" + id, {
        method: "PUT",
        body: {
          ...form,
          version: resource.data.version,
          confirm,
          reviewed,
          accept_source_changes: accept,
        },
      });
      resource.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <DataState resource={resource}>
      {(d) => {
        if (!form) return <p>กำลังเตรียมร่าง…</p>;
        const s = d.snapshot;
        return (
          <div className="report-page draft-document">
            <ReportSteps step={d.status === "confirmed" ? 3 : 2} />
            <Heading
              title={
                d.status === "confirmed"
                  ? "ฉบับรายงานที่ยืนยันแล้ว"
                  : "ตรวจร่างรายงานสรุปผล"
              }
              actions={
                <div className="report-actions no-print">
                  <Button onClick={() => navigate("drafts")}>
                    กลับรายการฉบับ
                  </Button>
                  {d.status === "confirmed" && (
                    <>
                      <a
                        className="button primary"
                        href={"/api/report-drafts/" + d.id + "/docx"}
                      >
                        ส่งออก Word
                      </a>
                      <Button onClick={() => window.print()}>
                        พิมพ์ / บันทึก PDF
                      </Button>
                    </>
                  )}
                </div>
              }
            >
              ฉบับที่ {d.id} · ผู้จัดทำ {d.author_name} · ข้อมูล ณ{" "}
              {new Date(s.cutoff_at).toLocaleString("th-TH")}
            </Heading>
            {d.changed_source_ids.length > 0 && (
              <p className="notice no-print">
                ต้นทาง {d.changed_source_ids.join(", ")} เปลี่ยนหลังจัดทำ
                ฉบับนี้ยังคงข้อมูลเดิม{" "}
                <Button onClick={() => navigate("drafts/new")}>
                  สร้างร่างใหม่
                </Button>
              </p>
            )}
            <section className="panel">
              <span className="badge">
                {d.status === "confirmed"
                  ? "ยืนยันแล้ว"
                  : "ร่างจากฐานข้อมูล ไม่ใช่ AI"}
              </span>
              {d.can_edit ? (
                <Field label="ชื่อฉบับรายงาน">
                  <input
                    value={form.title}
                    maxLength={300}
                    onChange={(e) =>
                      setForm({ ...form, title: e.target.value })
                    }
                  />
                </Field>
              ) : (
                <h1>{d.title}</h1>
              )}
              {d.can_edit && (
                <AISuggestion
                  path={"/report-drafts/" + d.id + "/ai-draft"}
                  configured={Boolean(meta?.ai?.configured)}
                  onUse={(p) =>
                    setForm({
                      ...form,
                      narrative: {
                        summary: p.summary,
                        problems: p.problems,
                        next_steps: p.next_steps,
                      },
                    })
                  }
                />
              )}
              {d.can_edit && (
                <p className="muted">
                  แก้ข้อความด้านล่างได้ ตัวเลขในตารางอ้างอิงจากข้อมูลที่คุณเลือก
                  เมื่อพร้อมให้กดยืนยันท้ายหน้านี้
                </p>
              )}
              <p>
                {s.period_title} · {s.range.from} ถึง {s.range.to} · แม่แบบ{" "}
                {s.template.name} รุ่น {s.template.version}
              </p>
              {Object.entries(s.template.config.headings).map(
                ([key, label]) => (
                  <section className="draft-section" key={key}>
                    <h2>{label}</h2>
                    {d.can_edit ? (
                      <Field label={"เนื้อหา " + label}>
                        <textarea
                          rows={key === "summary" ? 7 : 3}
                          value={form.narrative[key]}
                          maxLength={key === "summary" ? 10000 : 5000}
                          onChange={(e) =>
                            setForm({
                              ...form,
                              narrative: {
                                ...form.narrative,
                                [key]: e.target.value,
                              },
                            })
                          }
                        />
                      </Field>
                    ) : (
                      <p className="source-text">{d.narrative[key]}</p>
                    )}
                  </section>
                ),
              )}
              <h2>ตัวเลขจากฐานข้อมูล ณ เวลาจัดทำ</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>ตัวชี้วัด</th>
                      <th>ผล</th>
                      <th>หน่วย</th>
                      <th>วิธีคำนวณ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.metrics.map((m, i) => (
                      <tr key={i}>
                        <td>
                          <button
                            className="table-link"
                            onClick={() => setFocus(m.source_ids)}
                          >
                            {m.label}
                          </button>
                        </td>
                        <td>{m.value ?? "ไม่มีข้อมูล"}</td>
                        <td>{m.unit}</td>
                        <td>
                          {m.method === "count"
                            ? "นับรหัสไม่ซ้ำ"
                            : m.method === "max"
                              ? "ค่าสูงสุด"
                              : "รวมค่า"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted">
                กดชื่อตัวชี้วัดเพื่อดูรายงานที่นำมาคำนวณ
                ยอดคน/รายไม่ใช่จำนวนบุคคลไม่ซ้ำ
              </p>
              {s.template.config.include_trend && (
                <section className="draft-section">
                  <h2>แนวโน้มกิจกรรมรายเดือน</h2>
                  {s.months.map((m) => (
                    <div className="draft-trend" key={m.month}>
                      <span>{m.month}</span>
                      <meter
                        min="0"
                        max={Math.max(...s.months.map((x) => x.count), 1)}
                        value={m.count}
                      />
                      <b>{m.count} กิจกรรม</b>
                    </div>
                  ))}
                </section>
              )}
              {s.template.config.include_projects && (
                <section className="draft-section">
                  <h2>รายงานตามโครงการ</h2>
                  {s.projects.length ? (
                    s.projects.map((p, i) => (
                      <p key={i}>
                        {p.title} — รายงาน [{p.activity_id}]
                      </p>
                    ))
                  ) : (
                    <p>ไม่มีการเชื่อมโครงการในรายการที่เลือก</p>
                  )}
                </section>
              )}
              <section className="draft-section">
                <div className="panel-heading">
                  <h2>ข้อมูลอ้างอิงที่เก็บไว้</h2>
                  <Button onClick={() => setFocus(null)}>
                    แสดงแหล่งข้อมูลทั้งหมด
                  </Button>
                </div>
                {s.rows.map((r) => (
                  <article
                    className={
                      "snapshot-source " +
                      (focus && !focus.includes(r.id) ? "source-dim" : "")
                    }
                    key={r.id}
                  >
                    <h3>
                      [{r.id}] {r.title}
                    </h3>
                    <p>
                      {r.date} · {r.unit_name} /{" "}
                      {r.work_name || "ยังไม่ระบุงาน"}
                    </p>
                    <p>{r.result}</p>
                    <small>
                      ผู้บันทึก {r.owner_name} · ผู้ปฏิบัติงาน{" "}
                      {r.workers || "ยังไม่ระบุ"} · รุ่น {r.version}
                    </small>
                    <p className="no-print">
                      <button
                        className="table-link"
                        onClick={() => navigate("activity/" + r.id)}
                      >
                        เปิดต้นฉบับและประวัติปัจจุบัน
                      </button>
                    </p>
                  </article>
                ))}
              </section>
              {!!s.images.length && (
                <section className="draft-section">
                  <h2>หลักฐานที่เลือกไว้</h2>
                  <div className="snapshot-images">
                    {s.images.map((im) => (
                      <figure key={im.id}>
                        <img
                          src={"data:" + im.mime + ";base64," + im.base64}
                          alt={im.title}
                        />
                        <figcaption>
                          {im.title} · รายงาน [{im.activity_id}]
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                </section>
              )}
              <details className="no-print">
                <summary>รายการที่ไม่รวม {s.exclusions.length} รายการ</summary>
                {s.exclusions.map((r) => (
                  <p key={r.id}>
                    [{r.id}] {r.title} ·{" "}
                    {r.status !== "ready"
                      ? "รอยืนยัน"
                      : r.missing.length
                        ? "ขาด " + r.missing.join(", ")
                        : r.duplicate_ids.length
                          ? "อาจซ้ำ / ผู้จัดทำไม่เลือก"
                          : "ผู้จัดทำไม่เลือก"}
                  </p>
                ))}
              </details>
              {d.content_hash && (
                <p className="snapshot-hash">
                  ยืนยัน {new Date(d.confirmed_at).toLocaleString("th-TH")} ·
                  รหัสตรวจสอบ {d.content_hash}
                </p>
              )}
            </section>
            {error && (
              <p className="notice error" role="alert">
                {error}
              </p>
            )}
            {d.can_edit && (
              <section className="panel no-print">
                <label className="check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  ตรวจข้อความ ตัวเลข ข้อมูลที่ขาด และสิทธิ์ใช้รูปภาพแล้ว
                </label>
                {!!d.changed_source_ids.length && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={accept}
                      onChange={(e) => setAccept(e.target.checked)}
                    />
                    ยืนยันใช้ข้อมูล ณ เวลาจัดทำ แม้ต้นทางเปลี่ยนแล้ว
                  </label>
                )}
                <div className="report-actions">
                  <Button disabled={busy} onClick={() => save(false)}>
                    บันทึกร่าง
                  </Button>
                  <Button
                    primary
                    disabled={
                      busy ||
                      !reviewed ||
                      (d.changed_source_ids.length > 0 && !accept)
                    }
                    onClick={() => save(true)}
                  >
                    ยืนยันฉบับรายงาน
                  </Button>
                </div>
                <p className="muted">
                  ฉบับยืนยันเก็บไว้ไม่เปลี่ยนแปลง หากต้องแก้ให้จัดทำฉบับใหม่
                </p>
              </section>
            )}
          </div>
        );
      }}
    </DataState>
  );
}
export function TemplateReadiness({ filters, navigate }) {
  const r = useData("/reports/readiness?" + query(filters));
  return (
    <DataState resource={r}>
      {(d) => (
        <details className="workflow-guide no-print">
          <summary>
            ความพร้อมตามแม่แบบ · {d.automatic} รายการเข้าได้อัตโนมัติ ·{" "}
            {d.review} รายการต้องตรวจ
          </summary>
          <p>{d.note}</p>
          {d.groups.map((g) => (
            <div key={g.id}>
              <h3>{g.name}</h3>
              {g.metrics.map((m, i) => (
                <p key={i}>
                  {m.label}: {m.value ?? "ไม่มีข้อมูล"} {m.unit}
                </p>
              ))}
            </div>
          ))}
          {d.rows
            .filter(
              (x) =>
                x.missing.length ||
                x.duplicate_ids.length ||
                x.status !== "ready",
            )
            .map((r) => (
              <p key={r.id}>
                <button
                  className="table-link"
                  onClick={() => navigate("activity/" + r.id)}
                >
                  [{r.id}] {r.title}
                </button>{" "}
                · {r.status !== "ready" ? "รอยืนยัน " : ""}
                {r.missing.length ? "ขาด " + r.missing.join(", ") : ""}
                {r.duplicate_ids.length
                  ? " · อาจซ้ำกับ " + r.duplicate_ids.join(", ")
                  : ""}
              </p>
            ))}
        </details>
      )}
    </DataState>
  );
}
