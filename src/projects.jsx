import { Action, EditDialog } from "./scope-workspace";
import ProjectIntake from "./project-intake";
import React, { useEffect, useState } from "react";
import { api, query } from "./api";
import {
  Button,
  Field,
  Heading,
  DataState,
  useData,
  today,
  dateText,
} from "./workspace-ui";
const labels = {
  planning: "วางแผน",
  active: "กำลังดำเนินการ",
  awaiting: "รอรายงานผล",
  completed: "เสร็จสิ้น",
  assigned: "ยังไม่เริ่ม",
  in_progress: "กำลังดำเนินการ",
  submitted: "รอหัวหน้าตรวจรับ",
};
export default function Projects({ user, meta, navigate, notify, projectId }) {
  const resource = useData("/projects");
  const [intake, setIntake] = useState(false);
  useEffect(() => {
    if (resource.data && projectId)
      document
        .getElementById("project-" + projectId)
        ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [resource.data, projectId]);
  const [show, setShow] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    unit_id: user.scopes[0] || user.unit_id || "",
    due_date: today(),
  });
  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  async function create(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/projects", {
        method: "POST",
        body: { ...form, unit_id: Number(form.unit_id) },
      });
      setShow(false);
      setForm((f) => ({ ...f, title: "", description: "" }));
      resource.reload();
      notify("สร้างโครงการแล้ว");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading
        title="ติดตามโครงการ"
        actions={
          (user.delegated ||
            user.roles.some((r) =>
              ["head", "center_head", "executive"].includes(r),
            )) && (
            <div className="report-actions">
              <Button
                primary
                onClick={() => {
                  setShow(false);
                  setIntake(true);
                }}
              >
                รับโครงการและแจกงาน
              </Button>
              <Button
                onClick={() => {
                  setIntake(false);
                  setShow(!show);
                }}
              >
                {show ? "ปิดแบบฟอร์ม" : "สร้างโครงการเอง"}
              </Button>
            </div>
          )
        }
      >
        มอบหมายงาน → ส่งรายงานหลักฐาน → หัวหน้าตรวจรับ → ปิดโครงการ
      </Heading>
      <details className="workflow-guide">
        <summary>การติดตามงานและการแจ้งเตือน</summary>
        <p>
          ผู้รับงานอัปเดตว่ายังดำเนินงานต่อ ส่งรายงานหลักฐาน
          หรือขอเลื่อนกำหนดได้ การเตือนและส่งต่อหัวหน้าขึ้นกับค่ากลาง ส่วน LINE
          ใช้ได้เมื่อตั้งค่าการเชื่อมต่อแล้ว
        </p>
      </details>
      {intake && (
        <ProjectIntake
          user={user}
          meta={meta}
          notify={notify}
          onCancel={() => setIntake(false)}
          onSaved={(p) => {
            setIntake(false);
            resource.reload();
            navigate("projects/" + p.id);
          }}
        />
      )}
      {show && (
        <form className="panel project-form" onSubmit={create}>
          <h2>สร้างโครงการ</h2>
          <Field label="ชื่อโครงการ">
            <input
              required
              maxLength={300}
              value={form.title}
              onChange={(e) => update("title", e.target.value)}
            />
          </Field>
          <div className="form-row">
            <Field label="ฝ่ายรับผิดชอบ">
              <select
                required
                value={form.unit_id}
                onChange={(e) => update("unit_id", e.target.value)}
              >
                {meta.units
                  .filter(
                    (u) =>
                      (user.roles.includes("executive") ||
                        user.scopes.includes(u.id) ||
                        user.unit_id === u.id) &&
                      u.active,
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
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
          <Field label="รายละเอียดโครงการ">
            <textarea
              rows={3}
              maxLength={5000}
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
            />
          </Field>
          {error && <p role="alert">{error}</p>}
          <Button primary disabled={busy}>
            บันทึกโครงการ
          </Button>
        </form>
      )}
      <DataState resource={resource}>
        {(d) => (
          <>
            <div className="report-counts panel">
              <div>
                <strong>{d.items.length}</strong>
                <span>โครงการในขอบเขต</span>
              </div>
              <div>
                <strong>
                  {
                    d.items.flatMap((p) => p.tasks).filter((t) => t.overdue)
                      .length
                  }
                </strong>
                <span>งานเลยกำหนด</span>
              </div>
              <div>
                <strong>
                  {
                    d.items
                      .flatMap((p) => p.tasks)
                      .filter((t) => t.status === "submitted").length
                  }
                </strong>
                <span>งานรอตรวจรับ</span>
              </div>
            </div>
            {!d.items.length && (
              <section className="panel">
                <h2>ยังไม่มีโครงการในขอบเขตของคุณ</h2>
                <p>
                  หัวหน้าสร้างโครงการและมอบหมายให้เจ้าหน้าที่ในฝ่าย
                  งานจะปรากฏในหน้านี้ของผู้รับมอบหมาย
                </p>
              </section>
            )}
            {d.items.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                user={user}
                navigate={navigate}
                notify={notify}
                reload={resource.reload}
              />
            ))}
          </>
        )}
      </DataState>
    </>
  );
}
function ProjectCard({ project: p, user, navigate, notify, reload }) {
  const [assign, setAssign] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function changeStatus(status) {
    setBusy(true);
    setError("");
    try {
      await api("/projects/" + p.id, {
        method: "PATCH",
        body: { status, version: p.version },
      });
      reload();
      notify("บันทึกสถานะโครงการแล้ว");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel project-card" id={"project-" + p.id}>
      <div className="panel-heading">
        <div>
          <h2>{p.title}</h2>
          <p>
            {p.unit_name} · สิ้นสุด {dateText(p.due_date)}
          </p>
        </div>
        <span className={"badge " + (p.status === "completed" ? "ready" : "")}>
          {labels[p.status]}
        </span>
      </div>
      <div className="report-actions">
        <Button onClick={() => navigate("calendar/" + p.due_date.slice(0, 7))}>
          ดูงานในปฏิทิน
        </Button>
      </div>
      {p.source_text && p.can_manage && (
        <details>
          <summary>ต้นฉบับโครงการ</summary>
          <p className="preserve-text">{p.source_text}</p>
        </details>
      )}
      {p.description && (
        <details>
          <summary>รายละเอียดโครงการ</summary>
          <p className="source-text">{p.description}</p>
        </details>
      )}
      <ProjectPerformance project={p} navigate={navigate} reload={reload} />
      <div className="project-stages">
        {["planning", "active", "awaiting", "completed"].map((s) => (
          <span key={s} className={p.status === s ? "current" : ""}>
            {labels[s]}
          </span>
        ))}
      </div>
      {p.can_manage && (
        <div className="report-actions">
          <label>
            เปลี่ยนสถานะโครงการ{" "}
            <select
              aria-label={"สถานะโครงการ " + p.title}
              disabled={busy}
              value={p.status}
              onChange={(e) => changeStatus(e.target.value)}
            >
              {["planning", "active", "awaiting", "completed"].map((s) => (
                <option key={s} value={s}>
                  {labels[s]}
                </option>
              ))}
            </select>
          </label>
          {p.status !== "completed" && (
            <Button onClick={() => setAssign(!assign)}>
              {assign ? "ปิดการมอบหมาย" : "มอบหมายงาน"}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error} <Button onClick={reload}>โหลดข้อมูลใหม่</Button>
        </p>
      )}
      {assign && <AssignTask project={p} onSaved={reload} />}
      <h3>
        {p.can_manage || user.roles.includes("executive")
          ? "งานในโครงการ"
          : "งานที่มอบหมายให้ฉัน"}
      </h3>
      {!p.tasks.length && <p className="muted">ยังไม่มีงานมอบหมาย</p>}
      {p.tasks.map((t) => (
        <TaskRow
          key={t.id}
          task={t}
          project={p}
          navigate={navigate}
          reload={reload}
          notify={notify}
        />
      ))}
      {(p.can_manage || user.roles.includes("executive")) && (
        <details>
          <summary>ประวัติโครงการ</summary>
          {p.history.map((h, i) => (
            <p key={i}>
              {dateText(h.created_at)} · {h.actor_name} · {h.action}
            </p>
          ))}
        </details>
      )}
      <p className="muted">
        ปิดโครงการเมื่อทุกงานตรวจรับแล้ว · ไม่เพิ่มยอดกิจกรรมซ้ำจากรายงานที่แนบ
      </p>
    </section>
  );
}
function ProjectPerformance({ project: p, navigate, reload }) {
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [form, setForm] = useState(
    p.target || { label: "", unit: "คน", value: "", source: "" },
  );
  const [verified, setVerified] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/projects/${p.id}/target`, {
        method: "PUT",
        body: {
          ...form,
          value: Number(form.value),
          version: p.version,
          verified,
        },
      });
      setEditing(false);
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="project-performance">
      <div className="panel-heading">
        <h3>ผลสะสมของโครงการ</h3>
        {p.can_manage && (
          <Button onClick={() => setEditing(!editing)}>
            {editing ? "ยกเลิก" : p.target ? "แก้เป้าหมาย" : "กำหนดเป้าหมาย"}
          </Button>
        )}
      </div>
      {p.target ? (
        <>
          <p>
            <b>
              {p.target.label}: {p.performance.actual ?? "ยังไม่มีค่าที่ตรงกัน"}{" "}
              / {p.target.value} {p.target.unit}
            </b>
          </p>
          {p.performance.percent !== null && (
            <>
              <progress
                max="100"
                value={Math.min(100, p.performance.percent)}
              />
              <span> {p.performance.percent.toFixed(1)}% ของเป้าหมาย</span>
            </>
          )}
          <p className="muted">
            {p.performance.scope} · อ้างอิง {p.target.source} · ยืนยันโดย{" "}
            {p.target.confirmed_by}
          </p>
        </>
      ) : (
        <p className="muted">
          ยังไม่ได้กำหนดเป้าหมายจากเอกสาร จึงยังไม่คิดร้อยละความสำเร็จ
        </p>
      )}
      {editing && (
        <form className="project-form task-form" onSubmit={save}>
          <Field label="ตัวชี้วัดตามเอกสาร">
            <input
              required
              maxLength={100}
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
            />
          </Field>
          <div className="form-row">
            <Field label="เป้าหมาย">
              <input
                required
                type="number"
                min="0.000001"
                step="any"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
              />
            </Field>
            <Field label="หน่วยนับ">
              <select
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
              >
                {[
                  "คน",
                  "ราย",
                  "ครั้ง",
                  "ครั้งบริการ",
                  "เที่ยว",
                  "ตัน",
                  "กิโลกรัม",
                  "แห่ง",
                  "กิจกรรม",
                  "หลังคาเรือน",
                ].map((u) => (
                  <option key={u}>{u}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="เอกสารอ้างอิงและหน้าที่ระบุเป้าหมาย">
            <textarea
              required
              maxLength={2000}
              rows={2}
              placeholder="ชื่อเอกสาร / เลขที่โครงการ / หน้า"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            />
          </Field>
          <label className="check">
            <input
              required
              type="checkbox"
              checked={verified}
              onChange={(e) => setVerified(e.target.checked)}
            />
            ตรวจค่าเป้าหมายกับเอกสารต้นทางแล้ว
          </label>
          {error && <p role="alert">{error}</p>}
          <Button primary disabled={busy || !verified}>
            บันทึกเป้าหมายที่ตรวจแล้ว
          </Button>
        </form>
      )}
      <details>
        <summary>
          รายงานและหลักฐาน {p.performance.sources.length} รายการ
        </summary>
        {p.performance.sources.map((s) => (
          <p key={s.id}>
            <button
              className="table-link"
              onClick={() => navigate("activity/" + s.id)}
            >
              {s.title}
            </button>{" "}
            — {s.result}
          </p>
        ))}
      </details>
    </div>
  );
}
function AssignTask({ project: p, onSaved }) {
  const members = useData(
    "/projects/members?" + query({ unit: p.unit_id, work: p.work_id }),
  );
  const [form, setForm] = useState({
      title: "",
      assignee_id: "",
      due_date: p.due_date,
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(`/projects/${p.id}/tasks`, {
        method: "POST",
        body: {
          ...form,
          assignee_id: Number(form.assignee_id),
          version: p.version,
        },
      });
      onSaved();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="project-form task-form" onSubmit={save}>
      <h3>มอบหมายงานใหม่</h3>
      <Field label="ชื่องานมอบหมาย">
        <input
          required
          maxLength={300}
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
      </Field>
      <DataState resource={members}>
        {(d) => (
          <Field label="ผู้รับผิดชอบ">
            <select
              required
              value={form.assignee_id}
              onChange={(e) =>
                setForm({ ...form, assignee_id: e.target.value })
              }
            >
              <option value="">เลือกเจ้าหน้าที่ในฝ่าย</option>
              {d.items.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </DataState>
      <Field label="กำหนดส่ง">
        <input
          required
          type="date"
          max={p.due_date}
          value={form.due_date}
          onChange={(e) => setForm({ ...form, due_date: e.target.value })}
        />
      </Field>
      {error && <p role="alert">{error}</p>}
      <Button primary disabled={busy}>
        บันทึกงานมอบหมาย
      </Button>
    </form>
  );
}
function TaskRow({ task: t, project: p, navigate, reload, notify }) {
  const [submit, setSubmit] = useState(false),
    [returning, setReturning] = useState(false),
    [extension, setExtension] = useState(false),
    [note, setNote] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function action(action, activity_id) {
    setBusy(true);
    setError("");
    try {
      await api(`/project-tasks/${t.id}/action`, {
        method: "POST",
        body: { action, activity_id, note, version: t.version },
      });
      reload();
      notify("บันทึกงานมอบหมายแล้ว");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const canAct = p.status !== "completed";
  return (
    <article className="project-task">
      <div className="panel-heading">
        <div>
          <h3>{t.title}</h3>
          <p>
            {t.assignee_name} · กำหนดส่ง {dateText(t.due_date)}{" "}
            {t.start_time ? `· ${t.start_time}–${t.end_time}` : ""}
          </p>
        </div>
        <span className={"badge " + (t.overdue ? "pending" : "")}>
          {labels[t.status]}
          {t.overdue ? " · เลยกำหนด" : ""}
        </span>
      </div>
      {t.note && <p className="notice">หมายเหตุ: {t.note}</p>}
      {t.activity_id && (
        <p>
          รายงานหลักฐาน:{" "}
          <button
            className="table-link"
            disabled={t.can_read_activity === false}
            onClick={() => navigate("activity/" + t.activity_id)}
          >
            {t.activity_title}
          </button>{" "}
          · {t.activity_status === "ready" ? "ยืนยันแล้ว" : "รอยืนยัน"}
        </p>
      )}
      {t.can_submit &&
        canAct &&
        !["submitted", "completed"].includes(t.status) && (
          <div className="actions">
            <Action
              label="วันนี้ยังดำเนินงานต่อ"
              path={"/tasks/" + t.id + "/update"}
              after={reload}
            />
            <Button onClick={() => setExtension(true)}>ขอเลื่อนกำหนดส่ง</Button>
          </div>
        )}
      {extension && (
        <EditDialog
          title="ขอเลื่อนกำหนดส่ง"
          path={"/tasks/" + t.id + "/extensions"}
          initial={{ date: t.due_date, reason: "" }}
          fields={[
            { key: "date", label: "วันที่ขอส่ง", type: "date" },
            { key: "reason", label: "เหตุผล", type: "textarea" },
          ]}
          onClose={() => setExtension(false)}
          onSaved={reload}
        />
      )}
      <div className="report-actions">
        {canAct &&
          t.can_submit &&
          ["assigned", "in_progress"].includes(t.status) && (
            <>
              {t.status === "assigned" && (
                <Button disabled={busy} onClick={() => action("start")}>
                  เริ่มงาน
                </Button>
              )}
              <Button
                onClick={() => {
                  sessionStorage.setItem("rm-task-draft", t.title);
                  navigate("import");
                }}
              >
                เขียนรายงาน
              </Button>
              <Button primary onClick={() => setSubmit(!submit)}>
                ส่งรายงานให้หัวหน้า
              </Button>
            </>
          )}
        {canAct && p.can_manage && t.status === "submitted" && (
          <Button primary disabled={busy} onClick={() => action("approve")}>
            ตรวจรับงาน
          </Button>
        )}
        {canAct &&
          p.can_manage &&
          ["submitted", "completed"].includes(t.status) && (
            <Button onClick={() => setReturning(!returning)}>
              ส่งกลับแก้ไข
            </Button>
          )}
      </div>
      {submit && (
        <SelectReport
          unit={p.unit_id}
          busy={busy}
          onSubmit={(id) => action("submit", id)}
        />
      )}
      {returning && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            action("return");
          }}
          className="project-form"
        >
          <Field label="เหตุผลส่งกลับ">
            <textarea
              required
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Button disabled={busy}>ยืนยันส่งกลับ</Button>
        </form>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error} <Button onClick={reload}>โหลดข้อมูลใหม่</Button>
        </p>
      )}
    </article>
  );
}
function SelectReport({ unit, busy, onSubmit }) {
  const [q, setQ] = useState(""),
    [id, setId] = useState("");
  const r = useData(
    "/activities?" + query({ mine: "1", status: "ready", unit, q, limit: 100 }),
  );
  return (
    <form
      className="project-form task-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Number(id));
      }}
    >
      <Field label="ค้นหารายงานของฉัน">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setId("");
          }}
          placeholder="ค้นชื่อกิจกรรม"
        />
      </Field>
      <DataState resource={r}>
        {(d) => (
          <>
            <Field label="รายงานที่ยืนยันแล้ว">
              <select
                required
                value={id}
                onChange={(e) => setId(e.target.value)}
              >
                <option value="">เลือกรายงานหลักฐาน</option>
                {d.items.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title} · {dateText(a.date)}
                  </option>
                ))}
              </select>
            </Field>
            {d.total > 100 && (
              <p>แสดง 100 รายการ กรุณาค้นชื่อเพื่อจำกัดผลลัพธ์</p>
            )}
          </>
        )}
      </DataState>
      <Button primary disabled={busy || !id || !r.data}>
        ยืนยันส่งรายงาน
      </Button>
    </form>
  );
}
