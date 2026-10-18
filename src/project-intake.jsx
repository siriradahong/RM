import React, { useRef, useState } from "react";
import { api, query } from "./api";
import { Button, Field, useData, DataState } from "./workspace-ui";
import { WorkOptions } from "./organization";
export default function ProjectIntake({
  user,
  meta,
  onSaved,
  onCancel,
  notify,
}) {
  const [form, setForm] = useState({
    title: "",
    due_date: "",
    unit_id:
      user.scopes[0] ||
      user.unit_id ||
      meta.units.find((u) => u.active && u.kind !== "section")?.id ||
      "",
    work_id: user.roles.includes("center_head")
      ? user.work_scopes[0] || ""
      : "",
    source_text: "",
    tasks: [],
  });
  const [step, setStep] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [warnings, setWarnings] = useState([]);
  const key = useRef(crypto.randomUUID());
  const members = useData(
    "/projects/members?" + query({ unit: form.unit_id, work: form.work_id }),
  );
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  function task(index, k, v) {
    setForm((f) => ({
      ...f,
      tasks: f.tasks.map((t, i) => (i === index ? { ...t, [k]: v } : t)),
    }));
  }
  async function read(file) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const r = await api("/projects/read", { method: "POST", body });
      if (!r.text.trim())
        throw new Error("ยังอ่านข้อความไม่ได้ ลองวางข้อความโครงการแทน");
      setForm((f) => ({
        ...f,
        source_text: [f.source_text, r.text]
          .filter(Boolean)
          .join("\n")
          .slice(0, 60000),
      }));
      setWarnings(r.warnings || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function prepare(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await api("/projects/prepare", {
        method: "POST",
        body: {
          unit_id: Number(form.unit_id),
          work_id: Number(form.work_id) || null,
          source_text: form.source_text,
        },
      });
      setForm((f) => ({
        ...f,
        title: r.title,
        due_date: r.due_date,
        tasks: r.tasks,
      }));
      setWarnings(r.warnings);
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const p = await api("/projects", {
        method: "POST",
        body: {
          ...form,
          unit_id: Number(form.unit_id),
          work_id: Number(form.work_id) || null,
          submission_key: key.current,
          tasks: form.tasks.map((t) => ({
            ...t,
            assignee_id: Number(t.assignee_id),
            start_time: t.start_time || null,
            end_time: t.end_time || null,
          })),
        },
      });
      notify("สร้างโครงการ แจกงาน และเพิ่มในปฏิทินแล้ว");
      onSaved(p);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel project-intake" aria-busy={busy}>
      <div className="panel-heading">
        <div>
          <h2>รับโครงการและแจกงาน</h2>
          <p>1. ใส่โครงการ → 2. ตรวจงานที่แยกให้ → 3. แจกงานและลงปฏิทิน</p>
        </div>
        <Button disabled={busy} onClick={onCancel}>
          ปิด
        </Button>
      </div>
      {step === 1 ? (
        <form className="form" onSubmit={prepare}>
          <div className="form-row">
            <Field label="ฝ่ายรับผิดชอบ">
              <select
                required
                value={form.unit_id}
                onChange={(e) => {
                  setForm((f) => ({
                    ...f,
                    unit_id: Number(e.target.value),
                    work_id: "",
                  }));
                }}
              >
                {meta.units
                  .filter(
                    (u) =>
                      u.active &&
                      u.kind !== "section" &&
                      (user.roles.includes("executive") ||
                        user.scopes.includes(u.id) ||
                        user.unit_id === u.id),
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="งาน / ศูนย์">
              <select
                value={form.work_id}
                onChange={(e) => update("work_id", e.target.value)}
              >
                <option value="">ทุกงานในฝ่าย</option>
                <WorkOptions
                  unitId={form.unit_id}
                  works={meta.works.filter(
                    (w) =>
                      w.unit_id === Number(form.unit_id) &&
                      w.active &&
                      (!user.roles.includes("center_head") ||
                        user.scopes.includes(Number(form.unit_id)) ||
                        user.work_scopes.includes(w.id)),
                  )}
                />
              </select>
            </Field>
          </div>
          <Field label="ข้อความโครงการ">
            <textarea
              required
              rows={8}
              maxLength={60000}
              value={form.source_text}
              placeholder={
                "วางข้อความโครงการหรืออ่านจากเอกสาร\nชื่อโครงการ: คัดกรองสุขภาพชุมชน\nสิ้นสุดโครงการ: 31/10/2569\n- เตรียมอุปกรณ์ | ชื่อ-นามสกุลผู้รับผิดชอบ | 25/10/2569\n- ลงพื้นที่ | ชื่อ-นามสกุลผู้รับผิดชอบ | 26/10/2569 | 09:00–11:00"
              }
              onChange={(e) => update("source_text", e.target.value)}
            />
          </Field>
          <div
            className="project-drop"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              read(e.dataTransfer.files[0]);
            }}
          >
            <Field label="อ่านเอกสารโครงการจากเครื่อง">
              <input
                disabled={busy}
                type="file"
                accept=".pdf,.docx,.xlsx,.jpg,.jpeg,.png,.webp"
                onChange={(e) => {
                  read(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </Field>
            <small>
              ลากเอกสารมาวางได้ · PDF / Word / Excel / รูปเอกสาร ไม่เกิน 20 MB ·
              อ่านข้อความมาเก็บเป็นต้นฉบับโครงการ
            </small>
          </div>
          <p className="muted">
            ระบบอ่านในเครื่องและจับชื่อบุคลากรที่ตรงกับต้นฉบับ
            ข้อมูลที่ไม่ชัดจะเว้นไว้ให้ยืนยัน
          </p>
          <Button primary disabled={busy || !form.source_text.trim()}>
            {busy ? "กำลังอ่านและจัดงาน…" : "แยกงานจากโครงการ"}
          </Button>
        </form>
      ) : (
        <form className="form" onSubmit={save}>
          <div className="form-row">
            <Field label="ชื่อโครงการ">
              <input
                required
                maxLength={300}
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
              />
            </Field>
            <Field label="วันสิ้นสุดโครงการ">
              <input
                required
                type="date"
                value={form.due_date}
                onChange={(e) => update("due_date", e.target.value)}
              />
            </Field>
          </div>
          <DataState resource={members}>
            {(d) => (
              <>
                <div className="panel-heading">
                  <h3>งานที่จะมอบหมาย ({form.tasks.length})</h3>
                  <Button
                    disabled={form.tasks.length >= 50}
                    onClick={() =>
                      update("tasks", [
                        ...form.tasks,
                        {
                          title: "",
                          assignee_id: "",
                          due_date: "",
                          start_time: "",
                          end_time: "",
                          source_quote: "",
                        },
                      ])
                    }
                  >
                    เพิ่มงาน
                  </Button>
                </div>
                {!form.tasks.length && (
                  <p>
                    ยังไม่พบงาน เพิ่มงานและเลือกผู้รับผิดชอบก่อนแจกงานได้ค่ะ
                  </p>
                )}
                {form.tasks.map((t, i) => (
                  <article className="intake-task" key={i}>
                    <div className="panel-heading">
                      <strong>งานที่ {i + 1}</strong>
                      <Button
                        onClick={() =>
                          update(
                            "tasks",
                            form.tasks.filter((_, n) => n !== i),
                          )
                        }
                      >
                        ลบงาน
                      </Button>
                    </div>
                    <Field label={"ชื่องาน " + (i + 1)}>
                      <input
                        required
                        maxLength={300}
                        value={t.title}
                        onChange={(e) => task(i, "title", e.target.value)}
                      />
                    </Field>
                    <div className="form-row">
                      <Field label={"ผู้รับผิดชอบ " + (i + 1)}>
                        <select
                          required
                          value={t.assignee_id || ""}
                          onChange={(e) =>
                            task(i, "assignee_id", e.target.value)
                          }
                        >
                          <option value="">เลือกผู้รับผิดชอบ</option>
                          {d.items.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label={"วันปฏิบัติงาน / กำหนดส่ง " + (i + 1)}>
                        <input
                          required
                          type="date"
                          max={form.due_date || undefined}
                          value={t.due_date}
                          onChange={(e) => task(i, "due_date", e.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="form-row">
                      <Field label={"เวลาเริ่ม (ถ้ามี) " + (i + 1)}>
                        <input
                          type="time"
                          value={t.start_time || ""}
                          onChange={(e) =>
                            task(i, "start_time", e.target.value)
                          }
                        />
                      </Field>
                      <Field label={"เวลาสิ้นสุด (ถ้ามี) " + (i + 1)}>
                        <input
                          type="time"
                          required={!!t.start_time}
                          value={t.end_time || ""}
                          onChange={(e) => task(i, "end_time", e.target.value)}
                        />
                      </Field>
                    </div>
                    {t.source_quote && (
                      <details>
                        <summary>ข้อความที่ใช้อ้างอิง</summary>
                        <p className="preserve-text">{t.source_quote}</p>
                      </details>
                    )}
                  </article>
                ))}
                <p className="notice">
                  เมื่อยืนยัน ระบบสร้างงาน แจ้งผู้รับผิดชอบ
                  และแสดงในปฏิทินให้ทันที
                  งานที่ไม่มีเวลาจะแสดงเป็นกำหนดส่งทั้งวัน
                </p>
                <div className="report-actions">
                  <Button disabled={busy} onClick={() => setStep(1)}>
                    กลับไปดูต้นฉบับ
                  </Button>
                  <Button primary disabled={busy}>
                    {busy
                      ? "กำลังบันทึก…"
                      : form.tasks.length
                        ? "ยืนยันโครงการและแจกงาน"
                        : "บันทึกโครงการก่อน"}
                  </Button>
                </div>
              </>
            )}
          </DataState>
        </form>
      )}
      {warnings.length > 0 && (
        <details>
          <summary>รายละเอียดการอ่านข้อมูล</summary>
          {warnings.map((w, i) => (
            <p key={i}>{w}</p>
          ))}
        </details>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
