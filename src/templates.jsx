import React, { useState } from "react";
import { api } from "./api";
import { Button, Field, DataState, useData, Dialog } from "./workspace-ui";
import { metricUnits as units } from "../shared/metric-units";
export default function TemplatesAdmin({ meta }) {
  const r = useData("/admin/summary-templates"),
    [form, setForm] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const blank = () => ({
    name: "",
    unit_id: null,
    category_id: meta.categories[0]?.id || "",
    active: false,
    config: {
      required_fields: ["date", "result"],
      metrics: [],
      include_trend: true,
      include_projects: true,
      headings: {
        summary: "สรุปผลการดำเนินงาน",
        problems: "ปัญหาและอุปสรรค",
        next_steps: "แนวทางดำเนินงานต่อไป",
      },
    },
  });
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v })),
    config = (k, v) =>
      setForm((f) => ({ ...f, config: { ...f.config, [k]: v } }));
  async function save(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await api("/admin/summary-templates" + (form.id ? "/" + form.id : ""), {
        method: form.id ? "PUT" : "POST",
        body: form,
      });
      setForm(null);
      r.reload();
    } catch (e) {
      setError(e.message + (e.details ? " · " + e.details.join(", ") : ""));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel template-panel">
      <div className="panel-heading">
        <div>
          <h2>แม่แบบข้อมูลและรายงานสรุป</h2>
          <p>
            กำหนดข้อมูลจำเป็น ตัวชี้วัด วิธีรวม
            และหัวข้อเอกสารตามฝ่ายและประเภทงาน
          </p>
        </div>
        <Button
          onClick={() => {
            setForm(blank());
            setError("");
          }}
        >
          เพิ่มแม่แบบ
        </Button>
      </div>
      <p>
        แม่แบบทดลองเริ่มต้นยังปิดใช้งาน
        ให้ตรวจชื่อผลและหน่วยนับร่วมกับหน่วยงานก่อนเปิดใช้
        แม่แบบเฉพาะฝ่ายมีลำดับก่อนแม่แบบทุกฝ่าย
      </p>
      <DataState resource={r}>
        {(d) => (
          <div className="template-list">
            {d.items.map((t) => (
              <article key={t.id}>
                <div>
                  <h3>{t.name}</h3>
                  <p>
                    {meta.units.find((u) => u.id === t.unit_id)?.name ||
                      "ทุกฝ่าย"}{" "}
                    ·{" "}
                    {meta.categories.find((c) => c.id === t.category_id)?.name}{" "}
                    · รุ่น {t.version}
                  </p>
                  <small>
                    {t.active ? "เปิดใช้งาน" : "ปิดใช้งาน"} · นับกิจกรรมไม่ซ้ำ
                    {t.config.metrics
                      .map(
                        (m) =>
                          " · " +
                          m.label +
                          " " +
                          m.unit +
                          " (" +
                          (m.method === "sum" ? "รวม" : "สูงสุด") +
                          ")",
                      )
                      .join("")}
                  </small>
                </div>
                <Button
                  onClick={() => {
                    setForm(structuredClone(t));
                    setError("");
                  }}
                >
                  แก้แม่แบบ {t.name}
                </Button>
              </article>
            ))}
          </div>
        )}
      </DataState>
      {form && (
        <Dialog
          title={form.id ? "แก้ไขรูปแบบรายงาน" : "เพิ่มรูปแบบรายงาน"}
          onClose={() => !busy && setForm(null)}
        >
          <form className="project-form task-form" onSubmit={save}>
            <h3>{form.id ? "แก้ไขแม่แบบ" : "แม่แบบใหม่"}</h3>
            <Field label="ชื่อแม่แบบ">
              <input
                required
                maxLength={200}
                value={form.name}
                onChange={(e) => update("name", e.target.value)}
              />
            </Field>
            <div className="form-row">
              <Field label="ใช้กับฝ่าย">
                <select
                  value={form.unit_id || ""}
                  onChange={(e) =>
                    update(
                      "unit_id",
                      e.target.value ? Number(e.target.value) : null,
                    )
                  }
                >
                  <option value="">ทุกฝ่าย</option>
                  {meta.units
                    .filter((u) => u.active && u.kind !== "section")
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="ใช้กับประเภทงาน">
                <select
                  value={form.category_id}
                  onChange={(e) =>
                    update("category_id", Number(e.target.value))
                  }
                >
                  {meta.categories
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
            </div>
            <fieldset>
              <legend>ข้อมูลที่ต้องมีเพิ่มเติมก่อนนำเข้าสรุป</legend>
              {Object.entries({
                date: "วันที่",
                area: "พื้นที่",
                workers: "ผู้ปฏิบัติงาน",
                result: "ผลการดำเนินงาน",
              }).map(([key, label]) => (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    checked={form.config.required_fields.includes(key)}
                    onChange={(e) =>
                      config(
                        "required_fields",
                        e.target.checked
                          ? [...form.config.required_fields, key]
                          : form.config.required_fields.filter(
                              (x) => x !== key,
                            ),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <h3>ตัวชี้วัด</h3>
            <p>
              มีการนับรหัสกิจกรรมไม่ซ้ำให้อัตโนมัติ
              ตัวชี้วัดต่อไปนี้จับคู่ชื่อและหน่วยตรงกับตัวเลขในรายงาน
              ไม่แปลงคนเป็นครั้งบริการ
            </p>
            {form.config.metrics.map((m, i) => {
              const change = (k, v) =>
                config(
                  "metrics",
                  form.config.metrics.map((x, j) =>
                    i === j ? { ...x, [k]: v } : x,
                  ),
                );
              return (
                <div className="template-metric" key={i}>
                  <Field label={"ชื่อผล " + (i + 1)}>
                    <input
                      required
                      maxLength={100}
                      value={m.label}
                      onChange={(e) => change("label", e.target.value)}
                    />
                  </Field>
                  <Field label={"หน่วย " + (i + 1)}>
                    <select
                      value={m.unit}
                      onChange={(e) => change("unit", e.target.value)}
                    >
                      {units.map((u) => (
                        <option key={u}>{u}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label={"วิธีคำนวณ " + (i + 1)}>
                    <select
                      value={m.method}
                      onChange={(e) => change("method", e.target.value)}
                    >
                      <option value="sum">รวมค่า</option>
                      <option value="max">ค่าสูงสุด</option>
                    </select>
                  </Field>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={m.required}
                      onChange={(e) => change("required", e.target.checked)}
                    />
                    จำเป็น
                  </label>
                  <Button
                    type="button"
                    onClick={() =>
                      config(
                        "metrics",
                        form.config.metrics.filter((_, j) => i !== j),
                      )
                    }
                  >
                    ลบตัวชี้วัด
                  </Button>
                </div>
              );
            })}
            <Button
              type="button"
              disabled={form.config.metrics.length >= 12}
              onClick={() =>
                config("metrics", [
                  ...form.config.metrics,
                  { label: "", unit: "คน", method: "sum", required: true },
                ])
              }
            >
              เพิ่มตัวชี้วัด
            </Button>
            <div className="form-row">
              {Object.entries(form.config.headings).map(([k, v]) => (
                <Field
                  key={k}
                  label={
                    {
                      summary: "หัวข้อสรุป",
                      problems: "หัวข้อปัญหา",
                      next_steps: "หัวข้อแนวทาง",
                    }[k]
                  }
                >
                  <input
                    required
                    maxLength={100}
                    value={v}
                    onChange={(e) =>
                      config("headings", {
                        ...form.config.headings,
                        [k]: e.target.value,
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={form.config.include_trend}
                onChange={(e) => config("include_trend", e.target.checked)}
              />
              แสดงแนวโน้มรายเดือน
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.config.include_projects}
                onChange={(e) => config("include_projects", e.target.checked)}
              />
              แสดงตารางโครงการที่มีรายงานเชื่อมอยู่
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => update("active", e.target.checked)}
              />
              เปิดใช้แม่แบบนี้
            </label>
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            <div className="report-actions">
              <Button primary disabled={busy}>
                บันทึกแม่แบบ
              </Button>
              <Button type="button" onClick={() => setForm(null)}>
                ยกเลิก
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </section>
  );
}
