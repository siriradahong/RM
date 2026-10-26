import { UnitOptions, WorkOptions } from "./organization";
import React, { useState, useEffect } from "react";
import { api, query } from "./api";
import {
  useData,
  DataState,
  Button,
  Heading,
  Field,
  Dialog,
  today,
  dateText,
} from "./workspace-ui";
const localInput = (d) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
export const leader = (u) =>
  u.delegated ||
  u.roles.some((r) => ["head", "center_head", "executive"].includes(r));
export const scopeUnits = (u, meta) =>
  meta.units.filter(
    (x) =>
      x.active &&
      x.kind !== "section" &&
      (u.roles.includes("executive") ||
        u.scopes.includes(x.id) ||
        x.id === u.unit_id),
  );
const status = {
  pending: "รอพิจารณา",
  approved: "อนุมัติแล้ว",
  rejected: "ไม่อนุมัติ",
  transfer: "ย้ายสังกัด",
  staff: "เจ้าหน้าที่",
  head: "หัวหน้าฝ่าย",
  center_head: "หัวหน้าศูนย์",
  executive: "ผู้บริหาร",
};
function ErrorBox({ error }) {
  return (
    error && (
      <p className="notice error" role="alert">
        {error}
      </p>
    )
  );
}
export function Action({ label, path, body = {}, after, primary = false }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Button
        primary={primary}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api(path, { method: "POST", body });
            after?.();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "กำลังบันทึก…" : label}
      </Button>
      <ErrorBox error={error} />
    </>
  );
}
export function EditDialog({
  title,
  path,
  method = "POST",
  initial,
  fields,
  onClose,
  onSaved,
  children,
}) {
  const [form, setForm] = useState(initial),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const payload = {
              ...form,
              ...(form.headings_text !== undefined
                ? {
                    headings: form.headings_text
                      .split("\n")
                      .map((x) => x.trim())
                      .filter(Boolean),
                  }
                : {}),
              ...Object.fromEntries(
                fields
                  .filter((f) => f.datetime)
                  .map((f) => [f.key, new Date(form[f.key]).toISOString()]),
              ),
            };
            const d = await api(path, { method, body: payload });
            onSaved?.(d);
            onClose();
          } catch (e) {
            setError(
              e.message + (e.details ? " · " + e.details.join(" / ") : ""),
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
        {fields.map((f) => (
          <Field key={f.key} label={f.label}>
            {f.options ? (
              <select
                required={!f.optional}
                value={form[f.key] ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    [f.key]: f.number
                      ? e.target.value === ""
                        ? null
                        : Number(e.target.value)
                      : e.target.value,
                  })
                }
              >
                <option value="">เลือก{f.label}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                rows={4}
                required={!f.optional}
                maxLength={f.max || 2000}
                value={form[f.key] || ""}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            ) : (
              <input
                type={f.type || "text"}
                required={!f.optional}
                min={f.min}
                max={f.max}
                step={f.step}
                value={form[f.key] ?? ""}
                onChange={(e) =>
                  setForm({
                    ...form,
                    [f.key]: f.number
                      ? e.target.value === ""
                        ? null
                        : Number(e.target.value)
                      : e.target.value,
                  })
                }
              />
            )}
          </Field>
        ))}
        <ErrorBox error={error} />
        <div className="modal-actions">
          <Button onClick={onClose}>ยกเลิก</Button>
          <Button primary disabled={busy}>
            {busy ? "กำลังบันทึก…" : "บันทึก"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
const options = (items) =>
  items.map((i) => ({ value: i.id, label: i.name || i.title }));
export function AccountTools({ user, meta, navigate }) {
  const history = useData("/personnel/" + user.id + "/history");
  return (
    <div className="scope-account">
      <Button onClick={() => navigate("workspace/approvals")}>
        คำขอและการมอบอำนาจ
      </Button>
      <details>
        <summary>ประวัติสังกัดของฉัน</summary>
        <DataState resource={history}>
          {(d) => (
            <ul>
              {d.items.map((h) => (
                <li key={h.id}>
                  {dateText(h.effective_at)} · {h.unit_name || "ส่วนกลาง"} /{" "}
                  {h.work_name || "ไม่ระบุงาน"}
                </li>
              ))}
            </ul>
          )}
        </DataState>
      </details>
      <Transfer user={user} meta={meta} />
    </div>
  );
}
function Transfer({ user, meta }) {
  const [open, setOpen] = useState(false),
    [unit, setUnit] = useState(""),
    [work, setWork] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (user.roles.includes("admin")) return null;
  return (
    <details>
      <summary>แจ้งย้ายสังกัด</summary>
      <p>
        บัญชีจะพักใช้งานจนแอดมินตรวจสังกัดใหม่ รายงานเดิมคงสังกัดและประวัติเดิม
      </p>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/me/transfer", {
              method: "POST",
              body: {
                unit_id: Number(unit),
                work_id: Number(work),
                reason: "แจ้งย้ายสังกัดโดยเจ้าของบัญชี",
              },
            });
            location.reload();
          } catch (e) {
            setError(e.message);
            setBusy(false);
          }
        }}
      >
        <Field label="ฝ่ายใหม่">
          <select
            required
            value={unit}
            onChange={(e) => {
              setUnit(e.target.value);
              setWork("");
            }}
          >
            <option value="">เลือกฝ่าย</option>
            {meta.units
              .filter((u) => u.active && u.kind !== "section")
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="งานใหม่">
          <select
            required
            value={work}
            onChange={(e) => setWork(e.target.value)}
          >
            <option value="">เลือกงาน</option>
            {meta.works
              .filter((w) => w.active && w.unit_id === Number(unit))
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
        </Field>
        <label>
          <input
            type="checkbox"
            checked={open}
            onChange={(e) => setOpen(e.target.checked)}
          />
          ยืนยันว่าต้องการแจ้งย้ายและพักบัญชี
        </label>
        <Button disabled={!open || busy}>แจ้งย้ายสังกัด</Button>
        <ErrorBox error={error} />
      </form>
    </details>
  );
}
export function NotificationButton({ navigate }) {
  const r = useData("/notifications");
  useEffect(() => {
    const update = () => r.reload(),
      timer = setInterval(update, 60000);
    window.addEventListener("rm-notifications-updated", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("rm-notifications-updated", update);
    };
  }, []);
  const n = r.data?.items.filter((x) => !x.read_at).length || 0;
  return (
    <Button onClick={() => navigate("workspace/notifications")}>
      แจ้งเตือน{n ? " (" + n + ")" : ""}
    </Button>
  );
}
export function RoleApprovals({ user }) {
  const r = useData("/role-requests");
  return (
    <DataState resource={r}>
      {(d) => (
        <section className="panel">
          <h2>คำขอรับรองตำแหน่งและย้ายสังกัด</h2>
          {!d.items.length && <p className="muted">ไม่มีคำขอ</p>}
          {d.items.map((x) => (
            <article className="scope-list-item" key={x.id}>
              <div>
                <strong>
                  {x.name || x.user_name || "ผู้ใช้ #" + x.user_id}
                </strong>
                <p>
                  {status[x.requested_role]} · {status[x.status]} · {x.reason}
                </p>
              </div>
              {(x.status === "pending" &&
                x.user_id !== user.id &&
                leader(user)) ||
              (x.status === "pending" && user.roles.includes("admin")) ? (
                <div className="actions">
                  <Action
                    label="รับรอง"
                    path={"/role-requests/" + x.id + "/resolve"}
                    body={{ approve: true, reason: "ตรวจตำแหน่งและสังกัดแล้ว" }}
                    after={r.reload}
                  />
                  <Action
                    label="ไม่รับรอง"
                    path={"/role-requests/" + x.id + "/resolve"}
                    body={{ approve: false, reason: "ไม่ผ่านการตรวจตำแหน่ง" }}
                    after={r.reload}
                  />
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}
    </DataState>
  );
}
function Notifications({ navigate }) {
  const r = useData("/notifications");
  return (
    <DataState resource={r}>
      {(d) => (
        <section className="panel">
          <h2>การแจ้งเตือนของฉัน</h2>
          {!d.items.length && <p>ยังไม่มีการแจ้งเตือน</p>}
          {d.items.map((n) => (
            <article className="scope-list-item" key={n.id}>
              <div>
                <strong>{n.title}</strong>
                <p>{n.body}</p>
                <small>
                  {dateText(n.created_at)} ·{" "}
                  {n.delivery_state === "failed"
                    ? "ส่ง LINE ไม่สำเร็จ เปิดอ่านในเว็บได้"
                    : n.read_at
                      ? "อ่านแล้ว"
                      : "ยังไม่อ่าน"}
                </small>
              </div>
              <Button
                onClick={async () => {
                  await api("/notifications/" + n.id + "/read", {
                    method: "POST",
                    body: {},
                  });
                  window.dispatchEvent(new Event("rm-notifications-updated"));
                  navigate(n.route || "workspace/notifications");
                  r.reload();
                }}
              >
                เปิดดู
              </Button>
            </article>
          ))}
        </section>
      )}
    </DataState>
  );
}
export function ScopeAdmin({ meta }) {
  const r = useData("/scope/settings"),
    virus = useData("/file-policy/status"),
    hr = useData("/hr-templates");
  const [form, setForm] = useState(null),
    [dialog, setDialog] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(""),
    [preview, setPreview] = useState(null);
  const bools = {
    reminders_enabled: "เปิดติดตามงานและเตือนนัดหมาย",
    summaries_enabled: "สร้างรายงานอัตโนมัติวันที่ 1 ตามรอบ",
    skip_weekends: "ข้ามเสาร์–อาทิตย์สำหรับการเตือน",
    line_reply_enabled: "เปิดผู้ช่วยรับรายงานใน LINE",
    line_reminders_enabled: "ส่งการแจ้งเตือนไป LINE ส่วนตัว",
    retention_enabled: "ลบไฟล์และข้อความต้นฉบับที่ครบอายุเก็บอัตโนมัติ",
  };
  return (
    <>
      <DataState resource={r}>
        {(s) => (
          <form
            className="panel form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api("/scope/settings", {
                  method: "PUT",
                  body: {
                    ...(form || s),
                    holidays: (form || s).holidays
                      .map((x) => x.trim())
                      .filter(Boolean),
                  },
                });
                setResult("บันทึกค่ากลางแล้ว");
                r.reload();
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2>ค่ามาตรฐานสำนัก</h2>
            <p>ใช้กับทุกฝ่าย ผู้ใช้เลือกได้เฉพาะเวลาและช่องทางแจ้งเตือนของตน</p>
            {Object.entries(bools).map(([k, label]) => (
              <label className="check" key={k}>
                <input
                  type="checkbox"
                  checked={(form || s)[k]}
                  onChange={(e) =>
                    setForm({ ...s, ...form, [k]: e.target.checked })
                  }
                />
                {label}
              </label>
            ))}
            <div className="form-row">
              {[
                ["escalate_after_days", "แจ้งหัวหน้าเมื่อไม่มีอัปเดต (วัน)", 1],
                [
                  "escalate_executive_after_days",
                  "แจ้งผู้บริหารเมื่อไม่มีอัปเดต (วัน)",
                  1,
                ],
                ["ai_min_confidence", "เกณฑ์ความมั่นใจขั้นต่ำของโมเดล", 0],
                ["retention_days", "อายุเก็บไฟล์และข้อความ (วัน)", 30],
              ].map(([k, label, min]) => (
                <Field key={k} label={label}>
                  <input
                    type="number"
                    min={min}
                    max={k === "ai_min_confidence" ? 1 : 36500}
                    step={k === "ai_min_confidence" ? 0.05 : 1}
                    value={(form || s)[k] ?? ""}
                    onChange={(e) =>
                      setForm({
                        ...s,
                        ...form,
                        [k]:
                          e.target.value === "" ? null : Number(e.target.value),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            <Field label="วันหยุดเพิ่มเติม (หนึ่งวันต่อบรรทัด เช่น 2026-12-10)">
              <textarea
                value={(form || s).holidays.join("\n")}
                onChange={(e) =>
                  setForm({
                    ...s,
                    ...form,
                    holidays: e.target.value.split("\n"),
                  })
                }
              />
            </Field>
            <p>
              ตัวตรวจไวรัส:{" "}
              {virus.data?.configured
                ? "เปิดใช้ ClamAV ตรวจทุกไฟล์ก่อนรับ"
                : "ยังไม่ได้ตั้งค่า ClamAV"}
            </p>
            <p>
              การลบตามอายุเก็บจะคงทะเบียนและประวัติไว้
              ข้ามหลักฐานงานที่ตรวจรับและรูปข่าวที่เผยแพร่
            </p>
            <ErrorBox error={error} />
            {result && <p role="status">{result}</p>}
            <Button primary disabled={busy}>
              {busy ? "กำลังบันทึก…" : "บันทึกค่ากลาง"}
            </Button>
          </form>
        )}
      </DataState>
      <section className="panel">
        <h2>ตรวจงานตามรอบและอายุไฟล์</h2>
        <div className="actions">
          <Action
            label="ประมวลผลงานที่ถึงรอบตอนนี้"
            path="/scope/jobs/run"
            after={() =>
              setResult("ประมวลผลแล้ว ดูรายการแจ้งเตือนและรายงานตามรอบ")
            }
          />
          <Button
            onClick={async () => {
              try {
                setPreview(await api("/retention/preview"));
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            ตรวจไฟล์ครบอายุเก็บ
          </Button>
        </div>
        {preview && (
          <>
            <p>
              {preview.items.length} ไฟล์ และ {preview.texts?.length || 0}{" "}
              ข้อความต้นฉบับครบอายุ (
              {preview.items.filter((f) => f.held).length} ไฟล์มีเหตุให้เก็บต่อ)
            </p>
            <ul>
              {preview.items.map((f) => (
                <li key={f.id}>
                  {f.title} · {f.reason}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>แบบสรุปผลงานบุคลากร</h2>
          <Button onClick={() => setDialog(true)}>
            เพิ่มแบบจากเอกสารอ้างอิง
          </Button>
        </div>
        <p>กำหนดหัวข้อตามแบบของหน่วยงาน ตัวเลขกิจกรรมไม่ใช่คะแนนประเมิน</p>
        <DataState resource={hr}>
          {(d) => (
            <ul>
              {d.items.map((t) => (
                <li key={t.id}>
                  {t.name} · {t.personnel_type} · อ้างอิง {t.reference}
                </li>
              ))}
            </ul>
          )}
        </DataState>
      </section>
      {dialog && (
        <EditDialog
          title="เพิ่มแบบสรุปบุคลากร"
          path="/hr-templates"
          initial={{
            name: "",
            personnel_type: "",
            reference: "",
            headings: ["ผลการปฏิบัติงาน"],
            headings_text: "ผลการปฏิบัติงาน",
          }}
          fields={[
            { key: "name", label: "ชื่อแบบ" },
            {
              key: "headings_text",
              label: "หัวข้อตามแบบจริง (หนึ่งหัวข้อต่อบรรทัด)",
              type: "textarea",
            },
            {
              key: "personnel_type",
              label: "ประเภทบุคลากร (ตรงกับบัญชีผู้ใช้)",
            },
            { key: "reference", label: "ชื่อหรือเลขเอกสารแบบจริงที่อ้างอิง" },
          ]}
          onClose={() => setDialog(false)}
          onSaved={hr.reload}
        >
          <p>ใช้หัวข้อและประเภทบุคลากรตามเอกสารที่หน่วยงานตรวจแล้ว</p>
        </EditDialog>
      )}
      <CommunityAdmin />
    </>
  );
}
function CommunityAdmin() {
  const r = useData("/communities"),
    [show, setShow] = useState(false);
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>ทะเบียนชุมชนและเขตพื้นที่</h2>
        <Button onClick={() => setShow(true)}>เพิ่มชุมชน</Button>
      </div>
      <DataState resource={r}>
        {(d) => (
          <ul>
            {d.items.map((c) => (
              <li key={c.id}>
                เขต {c.district} · {c.name}{" "}
                {c.latitude === null ? "(ยังไม่ระบุพิกัด)" : ""}
              </li>
            ))}
          </ul>
        )}
      </DataState>
      {show && (
        <EditDialog
          title="เพิ่มชุมชน"
          path="/communities"
          initial={{ name: "", district: 1, latitude: null, longitude: null }}
          fields={[
            { key: "name", label: "ชื่อชุมชน" },
            {
              key: "district",
              label: "เขต",
              type: "number",
              number: true,
              min: 1,
              max: 4,
            },
            {
              key: "latitude",
              label: "ละติจูด",
              type: "number",
              number: true,
              optional: true,
              step: "any",
              min: -90,
              max: 90,
            },
            {
              key: "longitude",
              label: "ลองจิจูด",
              type: "number",
              number: true,
              optional: true,
              step: "any",
              min: -180,
              max: 180,
            },
          ]}
          onClose={() => setShow(false)}
          onSaved={r.reload}
        />
      )}
    </section>
  );
}
export function Workspace({
  view = "notifications",
  detailId,
  user,
  meta,
  navigate,
}) {
  const reportRole =
    user.delegated ||
    user.roles.some((r) =>
      ["staff", "head", "center_head", "executive"].includes(r),
    );
  const pages = [
    ["notifications", "แจ้งเตือน"],
    ...(reportRole
      ? [
          ["events", "ปฏิทินนัดหมาย"],
          ["proposals", "ข้อเสนอจากข้อความ"],
          ["coverage", "พื้นที่และชุมชน"],
        ]
      : []),
    ...(leader(user) ? [["plans", "แผนและงบประมาณ"]] : []),
    ["approvals", "คำขอและมอบอำนาจ"],
    ...(reportRole
      ? [
          ["hr", "ผลงานรายบุคคล"],
          ["scheduled", "รายงานตามรอบ"],
        ]
      : []),
  ];
  return (
    <>
      <div className="no-print">
        <Heading title="พื้นที่งานของฉัน">
          ติดตามงาน นัดหมาย และข้อมูลตามสิทธิ์ของบัญชี
        </Heading>
      </div>
      <section className="panel period-toolbar no-print">
        <Field label="หัวข้อการทำงาน">
          <select
            value={pages.some(([k]) => k === view) ? view : "notifications"}
            onChange={(e) => navigate("workspace/" + e.target.value)}
          >
            {pages.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </section>
      {!pages.some(([k]) => k === view) ? (
        <Notifications navigate={navigate} />
      ) : view === "proposals" ? (
        <WorkflowProposals user={user} meta={meta} />
      ) : view === "events" ? (
        <Events user={user} meta={meta} />
      ) : view === "coverage" ? (
        <Coverage user={user} meta={meta} navigate={navigate} />
      ) : view === "plans" && leader(user) ? (
        <Plans user={user} meta={meta} />
      ) : view === "approvals" ? (
        <Approvals user={user} meta={meta} />
      ) : view === "hr" ? (
        <HR user={user} navigate={navigate} />
      ) : view === "scheduled" ? (
        <Scheduled navigate={navigate} initialId={detailId} />
      ) : (
        <Notifications navigate={navigate} />
      )}
    </>
  );
}
function Events({ user, meta }) {
  const [from, setFrom] = useState(today().slice(0, 8) + "01"),
    [to, setTo] = useState(
      new Date(
        new Date().getFullYear(),
        new Date().getMonth() + 1,
        0,
      ).toLocaleDateString("en-CA"),
    ),
    [show, setShow] = useState(false);
  const r = useData("/events?" + query({ from, to }));
  return (
    <>
      <section className="panel period-toolbar">
        <Field label="ตั้งแต่">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field label="ถึง">
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
        <Button onClick={() => setShow(true)}>เพิ่มนัดหมาย</Button>
      </section>
      <DataState resource={r}>
        {(d) => (
          <section className="panel">
            <h2>นัดหมายตามเวลาจริง</h2>
            {!d.items.length && <p>ไม่มีนัดหมายในช่วงนี้</p>}
            {d.conflicts.length > 0 && (
              <p className="notice">
                พบ {d.conflicts.length}{" "}
                คู่นัดหมายที่เวลาทับซ้อนและมีผู้เข้าร่วมคนเดียวกัน
              </p>
            )}
            {d.items.map((e) => (
              <article className="scope-list-item" key={e.key || e.id}>
                <div>
                  <strong>{e.title}</strong>
                  <p>
                    {dateText(e.date)} ·{" "}
                    {e.start_time
                      ? e.start_time + "–" + e.end_time
                      : "ยังไม่กำหนดเวลา"}{" "}
                    · {e.unit_name}
                  </p>
                  {e.source_text && (
                    <details>
                      <summary>ประกาศต้นทาง</summary>
                      <p className="preserve-text">{e.source_text}</p>
                    </details>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}
      </DataState>
      {show && (
        <EventForm
          user={user}
          meta={meta}
          onClose={() => setShow(false)}
          saved={r.reload}
        />
      )}
    </>
  );
}
export function EventForm({ user, meta, onClose, saved }) {
  const [form, setForm] = useState({
      title: "",
      date: today(),
      start_time: "",
      end_time: "",
      unit_id: user.unit_id || user.scopes[0] || "",
      work_id: null,
      attendee_ids: [],
      source_text: "",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const p = useData("/people?unit=" + form.unit_id);
  return (
    <Dialog title="เพิ่มนัดหมาย" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api("/events", {
              method: "POST",
              body: {
                ...form,
                unit_id: Number(form.unit_id),
                start_time: form.start_time || null,
                end_time: form.end_time || null,
              },
            });
            saved();
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {[
          ["title", "เรื่อง", "text"],
          ["date", "วันที่", "date"],
          ["start_time", "เริ่ม", "time"],
          ["end_time", "สิ้นสุด", "time"],
        ].map(([k, l, type]) => (
          <Field key={k} label={l}>
            <input
              type={type}
              required={k === "title" || k === "date"}
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
          </Field>
        ))}
        <Field label="ฝ่าย">
          <select
            value={form.unit_id}
            onChange={(e) =>
              setForm({
                ...form,
                unit_id: Number(e.target.value),
                attendee_ids: [],
              })
            }
          >
            {scopeUnits(user, meta).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <fieldset>
          <legend>ผู้เข้าร่วม</legend>
          {p.data?.items.map((u) => (
            <label className="check" key={u.id}>
              <input
                type="checkbox"
                checked={form.attendee_ids.includes(u.id)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    attendee_ids: e.target.checked
                      ? [...form.attendee_ids, u.id]
                      : form.attendee_ids.filter((id) => id !== u.id),
                  })
                }
              />
              {u.name}
            </label>
          ))}
        </fieldset>
        <Field label="ข้อความประกาศต้นทาง (ถ้ามี)">
          <textarea
            value={form.source_text}
            onChange={(e) => setForm({ ...form, source_text: e.target.value })}
          />
        </Field>
        <ErrorBox error={error} />
        <Button primary disabled={busy}>
          {busy ? "กำลังบันทึก…" : "ยืนยันนัดหมาย"}
        </Button>
      </form>
    </Dialog>
  );
}
function Coverage({ user, meta, navigate }) {
  const [unit, setUnit] = useState(user.scopes[0] || user.unit_id || ""),
    [anchor, setAnchor] = useState(today()),
    [show, setShow] = useState(false);
  const r = useData("/coverage?" + query({ period: "year", anchor, unit })),
    communities = useData("/communities");
  return (
    <>
      <section className="panel period-toolbar">
        <Field label="ฝ่าย">
          <select value={unit} onChange={(e) => setUnit(e.target.value)}>
            {scopeUnits(user, meta).map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="วันที่ในปีงบประมาณ">
          <input
            type="date"
            value={anchor}
            onChange={(e) => setAnchor(e.target.value)}
          />
        </Field>
        {leader(user) && (
          <Button onClick={() => setShow(true)}>กำหนดพื้นที่ตามแผน</Button>
        )}
      </section>
      <DataState resource={r}>
        {(d) => (
          <>
            <p className="notice">
              นับกิจกรรมที่ยืนยันและไม่ซ้ำในขอบเขตสิทธิ์ · {d.unassigned}{" "}
              รายการยังไม่ผูกชุมชน · โครงการปิดในรอบนี้ {d.completed_projects}{" "}
              โครงการ
              {d.completed_undated
                ? " · " +
                  d.completed_undated +
                  " โครงการเดิมไม่ทราบวันปิด จึงไม่รวมยอดรอบนี้"
                : ""}
            </p>
            <CommunityMap items={d.items} navigate={navigate} />
            <div className="district-grid">
              {[1, 2, 3, 4].map((n) => {
                const rows = d.items.filter((c) => c.district === n),
                  planned = rows.filter((c) => c.planned);
                return (
                  <section className="panel" key={n}>
                    <h2>เขต {n}</h2>
                    <p>
                      {planned.filter((c) => c.visited).length} /{" "}
                      {planned.length} ชุมชนตามแผนมีรายงาน
                    </p>
                    {!rows.length && (
                      <p className="muted">ยังไม่มีทะเบียนชุมชนในเขตนี้</p>
                    )}
                    {rows.map((c) => (
                      <details key={c.id}>
                        <summary>
                          {c.visited ? "✓" : "○"} {c.name} · {c.reports.length}{" "}
                          กิจกรรม {c.planned ? "ตามแผน" : ""}
                        </summary>
                        {c.reports.map((a) => (
                          <p key={a.id}>
                            <button
                              className="text-link"
                              onClick={() => navigate("activity/" + a.id)}
                            >
                              {dateText(a.date)} · {a.title}
                            </button>
                          </p>
                        ))}
                        {c.latitude !== null && (
                          <small>
                            พิกัด {c.latitude}, {c.longitude}
                          </small>
                        )}
                      </details>
                    ))}
                  </section>
                );
              })}
            </div>
            {d.watches.map((w) => (
              <section className="panel" key={w.community_id}>
                <h3>เฝ้าติดตาม: {w.name}</h3>
                <p>{w.note}</p>
                {w.report_ids.map((id) => (
                  <Button key={id} onClick={() => navigate("activity/" + id)}>
                    รายงาน #{id}
                  </Button>
                ))}
              </section>
            ))}
          </>
        )}
      </DataState>
      {show && (
        <EditDialog
          title="กำหนดพื้นที่ตามแผน"
          path="/community-targets"
          initial={{
            unit_id: Number(unit),
            community_id: "",
            fiscal_year:
              Number(anchor.slice(0, 4)) +
              543 +
              (Number(anchor.slice(5, 7)) >= 10 ? 1 : 0),
            reference: "",
          }}
          fields={[
            {
              key: "community_id",
              label: "ชุมชน",
              number: true,
              options: options(communities.data?.items || []),
            },
            {
              key: "fiscal_year",
              label: "ปีงบประมาณ พ.ศ.",
              number: true,
              type: "number",
              min: 2500,
              max: 2800,
            },
            { key: "reference", label: "เอกสารแผนอ้างอิง" },
          ]}
          onClose={() => setShow(false)}
          onSaved={r.reload}
        />
      )}
    </>
  );
}
function Plans({ user, meta }) {
  const r = useData("/plans"),
    projects = useData("/projects");
  const [show, setShow] = useState(false),
    [project, setProject] = useState(null);
  return (
    <>
      <section className="panel">
        <div className="panel-heading">
          <h2>แผนและงบประมาณที่อนุมัติ</h2>
          <Button onClick={() => setShow(true)}>เพิ่มแผนอ้างอิง</Button>
        </div>
        <DataState resource={r}>
          {(d) => (
            <>
              {!d.items.length && <p>ยังไม่มีแผนที่บันทึก</p>}
              {d.items.map((p) => (
                <article className="scope-list-item" key={p.id}>
                  <div>
                    <strong>{p.title}</strong>
                    <p>
                      {p.unit_name} · ปี {p.fiscal_year} ·{" "}
                      {p.approved_budget.toLocaleString("th-TH")} บาท
                    </p>
                    <small>อ้างอิง {p.reference}</small>
                  </div>
                </article>
              ))}
            </>
          )}
        </DataState>
      </section>
      <section className="panel">
        <h2>เชื่อมโครงการและรายจ่าย</h2>
        <DataState resource={projects}>
          {(d) => (
            <div className="scope-cards">
              {d.items.map((p) => (
                <Button key={p.id} onClick={() => setProject(p)}>
                  {p.title}
                </Button>
              ))}
            </div>
          )}
        </DataState>
      </section>
      {show && (
        <EditDialog
          title="เพิ่มแผนที่อนุมัติแล้ว"
          path="/plans"
          initial={{
            title: "",
            unit_id: user.scopes[0] || user.unit_id || "",
            fiscal_year: 2569,
            approved_budget: 0,
            reference: "",
          }}
          fields={[
            { key: "title", label: "ชื่อแผน" },
            {
              key: "unit_id",
              label: "ฝ่าย",
              number: true,
              options: options(scopeUnits(user, meta)),
            },
            {
              key: "fiscal_year",
              label: "ปีงบประมาณ พ.ศ.",
              type: "number",
              number: true,
              min: 2500,
              max: 2800,
            },
            {
              key: "approved_budget",
              label: "งบที่อนุมัติ (บาท)",
              type: "number",
              number: true,
              min: 0,
              step: "0.01",
            },
            { key: "reference", label: "เลข/ชื่อเอกสารอนุมัติ" },
          ]}
          onClose={() => setShow(false)}
          onSaved={r.reload}
        />
      )}
      {project && (
        <Budget
          project={project}
          plans={r.data?.items || []}
          onClose={() => setProject(null)}
        />
      )}
    </>
  );
}
function Budget({ project, plans, onClose }) {
  const r = useData("/projects/" + project.id + "/budget");
  const [expense, setExpense] = useState(false),
    [plan, setPlan] = useState(project.plan_id || ""),
    [error, setError] = useState("");
  return (
    <Dialog title={"งบประมาณ · " + project.title} onClose={onClose}>
      <DataState resource={r}>
        {(d) => (
          <>
            <p>
              แผน: {d.plan?.title || "ยังไม่เชื่อมแผน"} · รายจ่ายโครงการ{" "}
              {d.spent.toLocaleString("th-TH")} บาท
            </p>
            {d.plan && (
              <p>
                รายจ่ายสะสมทุกโครงการในแผน{" "}
                {d.plan_spent.toLocaleString("th-TH")} บาท · คงเหลือ{" "}
                {d.remaining.toLocaleString("th-TH")} บาท
              </p>
            )}
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const current = await api("/projects/" + project.id);
                  await api("/projects/" + project.id + "/plan", {
                    method: "PUT",
                    body: {
                      plan_id: plan ? Number(plan) : null,
                      version: current.version,
                    },
                  });
                  r.reload();
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <Field label="แผนที่เชื่อม">
                <select value={plan} onChange={(e) => setPlan(e.target.value)}>
                  <option value="">ไม่เชื่อมแผน</option>
                  {plans
                    .filter((p) => p.unit_id === project.unit_id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title}
                      </option>
                    ))}
                </select>
              </Field>
              <Button>บันทึกแผนที่เชื่อม</Button>
            </form>
            <h3>รายจ่ายจริง</h3>
            <ul>
              {d.items.map((e) => (
                <li key={e.id}>
                  {dateText(e.date)} · {e.description} ·{" "}
                  {e.amount.toLocaleString("th-TH")} บาท · {e.reference}
                </li>
              ))}
            </ul>
          </>
        )}
      </DataState>
      <ErrorBox error={error} />
      <Button onClick={() => setExpense(true)}>บันทึกรายจ่าย</Button>
      {expense && (
        <EditDialog
          title="บันทึกรายจ่ายจริง"
          path={"/projects/" + project.id + "/expenses"}
          initial={{ amount: 0, date: today(), description: "", reference: "" }}
          fields={[
            {
              key: "amount",
              label: "จำนวนเงิน (บาท)",
              type: "number",
              number: true,
              min: 0,
              step: "0.01",
            },
            { key: "date", label: "วันที่", type: "date" },
            { key: "description", label: "รายละเอียด" },
            { key: "reference", label: "เอกสารหลักฐาน" },
          ]}
          onClose={() => setExpense(false)}
          onSaved={r.reload}
        />
      )}
    </Dialog>
  );
}
function Approvals({ user, meta }) {
  const locks = useData("/period-locks"),
    amend = useData("/amendments"),
    extensions = useData("/task-extensions"),
    delegates = useData("/delegations");
  const [dialog, setDialog] = useState(null);
  return (
    <>
      <RoleApprovals user={user} />
      <section className="panel">
        <h2>ขอแก้ไขหลังปิดรอบ</h2>
        <DataState resource={amend}>
          {(d) => (
            <>
              {!d.items.length && <p>ไม่มีคำขอ</p>}
              {d.items.map((a) => (
                <article className="scope-list-item" key={a.id}>
                  <div>
                    <strong>{a.title}</strong>
                    <p>
                      {a.requester_name} · {a.reason} · {status[a.status]}
                    </p>
                  </div>
                  {a.status === "pending" &&
                    a.requested_by !== user.id &&
                    leader(user) && (
                      <div className="actions">
                        <Action
                          label="อนุมัติแก้เฉพาะรายการ 24 ชั่วโมง"
                          path={"/amendments/" + a.id + "/resolve"}
                          body={{ approve: true, reason: "ตรวจคำขอแล้ว" }}
                          after={amend.reload}
                        />
                        <Action
                          label="ไม่อนุมัติ"
                          path={"/amendments/" + a.id + "/resolve"}
                          body={{
                            approve: false,
                            reason: "ไม่ผ่านการตรวจคำขอ",
                          }}
                          after={amend.reload}
                        />
                      </div>
                    )}
                </article>
              ))}
            </>
          )}
        </DataState>
      </section>
      <section className="panel">
        <h2>ขอเลื่อนกำหนดส่งงาน</h2>
        <DataState resource={extensions}>
          {(d) => (
            <>
              {!d.items.length && <p>ไม่มีคำขอ</p>}
              {d.items.map((a) => (
                <article className="scope-list-item" key={a.id}>
                  <div>
                    <strong>{a.title}</strong>
                    <p>
                      {a.reason} · ขอถึง {dateText(a.requested_date)} ·{" "}
                      {status[a.status]}
                    </p>
                  </div>
                  {a.status === "pending" &&
                    a.requested_by !== user.id &&
                    leader(user) && (
                      <div className="actions">
                        <Action
                          label="อนุมัติ"
                          path={"/task-extensions/" + a.id + "/resolve"}
                          body={{ approve: true }}
                          after={extensions.reload}
                        />
                        <Action
                          label="ไม่อนุมัติ"
                          path={"/task-extensions/" + a.id + "/resolve"}
                          body={{ approve: false }}
                          after={extensions.reload}
                        />
                      </div>
                    )}
                </article>
              ))}
            </>
          )}
        </DataState>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>รอบที่ปิดแล้ว</h2>
          {user.roles.includes("head") && (
            <Button onClick={() => setDialog("lock")}>ปิดรอบรายงาน</Button>
          )}
        </div>
        <DataState resource={locks}>
          {(d) => (
            <ul>
              {d.items.map((l) => (
                <li key={l.id}>
                  {l.unit_name} · {dateText(l.date_from)}–{dateText(l.date_to)}{" "}
                  · {l.reason}
                </li>
              ))}
            </ul>
          )}
        </DataState>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>มอบอำนาจชั่วคราว</h2>
          {user.roles.some((r) => ["head", "center_head"].includes(r)) && (
            <Button onClick={() => setDialog("delegate")}>
              เพิ่มการมอบอำนาจ
            </Button>
          )}
        </div>
        <DataState resource={delegates}>
          {(d) => (
            <>
              {!d.items.length && <p>ยังไม่มีการมอบอำนาจ</p>}
              {d.items.map((g) => (
                <article className="scope-list-item" key={g.id}>
                  <div>
                    <strong>
                      {g.grantor_name} → {g.grantee_name}
                    </strong>
                    <p>
                      {dateText(g.starts_at)}–{dateText(g.ends_at)} ·{" "}
                      {g.revoked
                        ? "ยกเลิกแล้ว"
                        : new Date(g.ends_at) < new Date()
                          ? "หมดอายุ"
                          : "มีผลตามช่วงเวลา"}
                    </p>
                  </div>
                  {!g.revoked &&
                    (g.grantor_id === user.id ||
                      user.roles.includes("admin")) && (
                      <Action
                        label="ยกเลิกมอบอำนาจ"
                        path={"/delegations/" + g.id + "/revoke"}
                        after={delegates.reload}
                      />
                    )}
                </article>
              ))}
            </>
          )}
        </DataState>
      </section>
      {dialog === "lock" && (
        <EditDialog
          title="ปิดรอบรายงาน"
          path="/period-locks"
          initial={{
            unit_id: user.scopes[0] || "",
            date_from: today().slice(0, 8) + "01",
            date_to: today(),
            reason: "",
          }}
          fields={[
            {
              key: "unit_id",
              label: "ฝ่าย",
              number: true,
              options: options(
                meta.units.filter((u) => user.scopes.includes(u.id)),
              ),
            },
            { key: "date_from", label: "ตั้งแต่", type: "date" },
            { key: "date_to", label: "ถึง", type: "date" },
            { key: "reason", label: "เหตุผล" },
          ]}
          onClose={() => setDialog(null)}
          onSaved={locks.reload}
        >
          <p>เมื่อปิดรอบ ต้องขออนุมัติแก้ไขเป็นรายรายการ ประวัติเดิมยังอยู่</p>
        </EditDialog>
      )}
      {dialog === "delegate" && (
        <Delegation
          user={user}
          meta={meta}
          onClose={() => setDialog(null)}
          saved={delegates.reload}
        />
      )}
    </>
  );
}
function Delegation({ user, meta, onClose, saved }) {
  const people = useData("/people?unit=" + (user.unit_id || user.scopes[0]));
  return (
    <EditDialog
      title="มอบอำนาจชั่วคราว"
      path="/delegations"
      initial={{
        grantee_id: "",
        unit_id: user.roles.includes("head") ? user.scopes[0] : null,
        work_id: user.roles.includes("center_head")
          ? user.work_scopes[0]
          : null,
        starts_at: localInput(new Date()),
        ends_at: localInput(new Date(Date.now() + 86400000)),
        reason: "",
      }}
      fields={[
        {
          key: "grantee_id",
          label: "ผู้รับมอบ",
          number: true,
          options: options(
            people.data?.items.filter((u) => u.id !== user.id) || [],
          ),
        },
        ...(user.roles.includes("head")
          ? [
              {
                key: "unit_id",
                label: "ฝ่ายที่มอบ",
                number: true,
                options: options(
                  meta.units.filter((u) => user.scopes.includes(u.id)),
                ),
              },
            ]
          : [
              {
                key: "work_id",
                label: "ศูนย์ที่มอบ",
                number: true,
                options: options(
                  meta.works.filter((w) => user.work_scopes.includes(w.id)),
                ),
              },
            ]),
        {
          key: "starts_at",
          label: "เริ่มมอบอำนาจ",
          type: "datetime-local",
          datetime: true,
        },
        {
          key: "ends_at",
          label: "สิ้นสุดมอบอำนาจ",
          type: "datetime-local",
          datetime: true,
        },
        { key: "reason", label: "เหตุผล" },
      ]}
      onClose={onClose}
      onSaved={saved}
    />
  );
}
function HR({ user, navigate }) {
  const templates = useData("/hr-templates"),
    exports = useData("/hr-exports");
  const [show, setShow] = useState(false),
    [detail, setDetail] = useState(null),
    [error, setError] = useState("");
  return (
    <>
      <section className="panel no-print">
        <div className="panel-heading">
          <h2>สรุปผลงานรายบุคคล</h2>
          <Button onClick={() => setShow(true)}>สร้างฉบับสรุป</Button>
        </div>
        <p>
          ใช้เฉพาะกิจกรรมที่เจ้าของยืนยันตัวเลข และผู้ร่วมงานยืนยันบทบาทแล้ว
          แยกผู้บันทึกออกจากผู้ปฏิบัติงาน
        </p>
        <DataState resource={exports}>
          {(d) => (
            <ul>
              {d.items.map((x) => (
                <li key={x.id}>
                  <Button
                    onClick={async () => {
                      try {
                        setDetail(await api("/hr-exports/" + x.id));
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    ฉบับ #{x.id} · {dateText(x.created_at)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DataState>
        <ErrorBox error={error} />
      </section>
      {show && (
        <HRForm
          templates={
            templates.data?.items.filter(
              (t) => t.personnel_type === user.personnel_type,
            ) || []
          }
          onClose={() => setShow(false)}
          saved={(d) => {
            setDetail(d);
            exports.reload();
          }}
        />
      )}
      {detail && (
        <section className="panel report-print">
          <h2>{detail.template.name}</h2>
          <p>
            {detail.user.name} · {detail.user.position} ·{" "}
            {dateText(detail.from)}–{dateText(detail.to)}
          </p>
          {detail.template.headings.map((h) => (
            <div key={h}>
              <h3>{h}</h3>
              <p className="preserve-text">
                {detail.narrative[h] || "ยังไม่ระบุคำอธิบาย"}
              </p>
            </div>
          ))}
          {detail.rows.map((a) => (
            <article key={a.id}>
              <h3>
                <button
                  className="text-link"
                  onClick={() => navigate("activity/" + a.id)}
                >
                  {a.title}
                </button>
              </h3>
              <p>
                {dateText(a.date)} · บทบาท {a.work_role} · {a.result}
              </p>
            </article>
          ))}
          <small>
            {detail.note} · ข้อมูล ณ {dateText(detail.cutoff_at)}
          </small>
          <div className="actions no-print">
            <Button onClick={() => window.print()}>พิมพ์ / PDF</Button>
            <a
              className="button"
              href={"/api/hr-exports/" + detail.id + "/word"}
            >
              ดาวน์โหลด Word
            </a>
          </div>
        </section>
      )}
    </>
  );
}
function HRForm({ templates, onClose, saved }) {
  const [id, setId] = useState(""),
    [from, setFrom] = useState(today().slice(0, 8) + "01"),
    [to, setTo] = useState(today()),
    [text, setText] = useState({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    t = templates.find((t) => t.id === Number(id));
  return (
    <Dialog title="สร้างสรุปผลงานรายบุคคล" onClose={onClose}>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            saved(
              await api("/hr-exports", {
                method: "POST",
                body: { template_id: Number(id), from, to, narrative: text },
              }),
            );
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="แบบสรุป">
          <select
            required
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setText({});
            }}
          >
            <option value="">เลือกแบบที่ตรงประเภทบุคลากร</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>
        {!templates.length && (
          <p className="notice">
            ให้แอดมินกำหนดประเภทบุคลากรในบัญชีและเพิ่มแบบจากเอกสารจริงก่อน
          </p>
        )}
        <div className="form-row">
          <Field label="ตั้งแต่">
            <input
              required
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field label="ถึง">
            <input
              required
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
        {t?.headings.map((h) => (
          <Field key={h} label={h}>
            <textarea
              value={text[h] || ""}
              onChange={(e) => setText({ ...text, [h]: e.target.value })}
            />
          </Field>
        ))}
        <ErrorBox error={error} />
        <Button primary disabled={busy || !t}>
          สร้างฉบับสรุปจากกิจกรรมที่ยืนยันแล้ว
        </Button>
      </form>
    </Dialog>
  );
}
function Scheduled({ navigate, initialId }) {
  const r = useData("/scheduled-summaries");
  const [detail, setDetail] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!initialId) return;
    let alive = true;
    api("/scheduled-summaries/" + initialId)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [initialId]);
  return (
    <section className="panel report-print">
      <div className="no-print">
        <h2>รายงานที่ระบบเตรียมตามรอบ</h2>
        <p>
          วันที่ 1 สร้างสรุปรอบก่อนหน้า: รายเดือน ไตรมาส และปีงบประมาณตามค่ากลาง
        </p>
        <DataState resource={r}>
          {(d) => (
            <ul>
              {!d.items.length && (
                <li>
                  ยังไม่มีฉบับตามรอบ สามารถสร้างรายงานเองจากเมนูรายงานสรุปได้
                </li>
              )}
              {d.items.map((x) => (
                <li key={x.id}>
                  <Button
                    onClick={async () => {
                      try {
                        setDetail(await api("/scheduled-summaries/" + x.id));
                      } catch (e) {
                        setError(e.message);
                      }
                    }}
                  >
                    ฉบับ #{x.id} · {dateText(x.created_at)}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DataState>
        <ErrorBox error={error} />
      </div>
      {detail && (
        <>
          <h3>{detail.payload.title || detail.payload.scope_label}</h3>
          <p>
            {detail.payload.range?.from}–{detail.payload.range?.to} · เตรียม ณ{" "}
            {dateText(detail.created_at)}
          </p>
          {detail.payload.rows.map((a) => (
            <article key={a.id}>
              <h3>
                <button
                  className="text-link"
                  onClick={() => navigate("activity/" + a.id)}
                >
                  {a.title}
                </button>
              </h3>
              <p>{a.result}</p>
            </article>
          ))}
          <div className="actions no-print">
            <Button onClick={() => window.print()}>พิมพ์ / PDF</Button>
            <a
              className="button"
              href={"/api/scheduled-summaries/" + detail.id + "/word"}
            >
              ดาวน์โหลด Word
            </a>
            <Button onClick={() => navigate("reports")}>
              จัดทำรายงานตามแม่แบบ
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
export function ActivityScope({ record, user, meta, refresh }) {
  const team = useData("/activities/" + record.id + "/team"),
    communities = useData("/communities");
  const [dialog, setDialog] = useState(null),
    [search, setSearch] = useState(""),
    [ppl, setPpl] = useState([]),
    [people, setPeople] = useState(null),
    [units, setUnits] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const canChange =
    record.can_edit && (!record.period_lock || record.amendment_allowed);
  const mine = team.data?.people.find((p) => p.user_id === user.id);
  return (
    <details
      className="panel scope-activity"
      open={record.period_lock && !record.amendment_allowed ? true : undefined}
    >
      <summary>
        ผู้ร่วมงาน ชุมชน และการนำข้อมูลไปใช้
        {record.period_lock ? " · ปิดรอบแล้ว" : ""}
      </summary>
      {record.period_lock && (
        <div className="notice">
          <div>
            ปิดรอบแล้ว {record.period_lock.date_from}–
            {record.period_lock.date_to}
            <p>
              {record.amendment_allowed
                ? "ได้รับอนุมัติแก้รายการนี้ชั่วคราว"
                : "ต้องขออนุมัติก่อนแก้ไข"}
            </p>
            {!record.amendment_allowed && record.can_edit && (
              <Button onClick={() => setDialog("amend")}>
                ขอแก้ไขหลังปิดรอบ
              </Button>
            )}
          </div>
        </div>
      )}
      {record.brief && (
        <p className="notice">
          รายงานแบบย่อจากไฟล์/ภาพ โปรดตรวจข้อเท็จจริงจากต้นฉบับ
        </p>
      )}
      <DataState resource={team}>
        {(d) => (
          <>
            <ul>
              {d.people.map((p) => (
                <li key={p.user_id}>
                  {p.name} · {p.work_role} ·{" "}
                  {p.confirmed_at ? "ยืนยันบทบาทแล้ว" : "รอยืนยันบทบาท"}
                </li>
              ))}
            </ul>
            {!d.people.length && (
              <p className="muted">ยังไม่ระบุผู้ปฏิบัติงานจากบัญชีระบบ</p>
            )}
            <p>
              หน่วยร่วม: {d.units.map((u) => u.name).join(" / ") || "ไม่มี"}
            </p>
            {mine &&
              !mine.confirmed_at &&
              (!record.period_lock || record.amendment_allowed) && (
                <Action
                  label="ยืนยันบทบาทการทำงานของฉัน"
                  path={"/activities/" + record.id + "/team/confirm"}
                  after={team.reload}
                />
              )}
            {canChange && (
              <Button
                onClick={() => {
                  setPeople(d.people);
                  setUnits(d.units.map((u) => u.unit_id));
                  setDialog("team");
                }}
              >
                แก้ผู้ร่วมงานและหน่วยร่วม
              </Button>
            )}
          </>
        )}
      </DataState>
      {(!record.period_lock || record.amendment_allowed) &&
        record.owner_id === user.id &&
        record.status === "ready" &&
        !record.owner_confirmed_at && (
          <Action
            label="เจ้าของยืนยันข้อเท็จจริงและตัวเลข"
            path={"/activities/" + record.id + "/owner-confirm"}
            body={{ version: record.version }}
            after={refresh}
          />
        )}
      {canChange && record.status === "ready" && (
        <Action
          label={
            record.news_candidate
              ? "ส่งเข้าคิวข่าวแล้ว · เสนออีกครั้ง"
              : "ส่งให้ประชาสัมพันธ์พิจารณา"
          }
          path={"/activities/" + record.id + "/news-candidate"}
          after={refresh}
        />
      )}
      {canChange && (
        <Button onClick={() => setDialog("community")}>
          ระบุชุมชนที่ดำเนินงาน
        </Button>
      )}
      {dialog === "amend" && (
        <EditDialog
          title="ขอแก้ไขหลังปิดรอบ"
          path={"/activities/" + record.id + "/amendments"}
          initial={{ reason: "" }}
          fields={[
            {
              key: "reason",
              label: "เหตุผลและข้อมูลที่ต้องการแก้",
              type: "textarea",
            },
          ]}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      )}
      {dialog === "community" && (
        <EditDialog
          title="ชุมชนของรายงาน"
          method="PUT"
          path={"/activities/" + record.id + "/community"}
          initial={{
            version: record.version,
            community_id: record.community_id || "",
          }}
          fields={[
            {
              key: "community_id",
              label: "ชุมชน",
              number: true,
              options: options(communities.data?.items || []),
            },
          ]}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      )}
      {dialog === "team" && (
        <Dialog title="ผู้ร่วมงานและหน่วยร่วม" onClose={() => setDialog(null)}>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await api("/activities/" + record.id + "/team", {
                  method: "PUT",
                  body: {
                    version: record.version,
                    people: people.map((p) => ({
                      user_id: p.user_id,
                      work_role: p.work_role,
                    })),
                    units,
                  },
                });
                team.reload();
                refresh();
                setDialog(null);
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <p>
              เพิ่มเฉพาะผู้ปฏิบัติงานจริง
              ผู้มีชื่อจะเปิดอ่านรายงานนี้และยืนยันบทบาทของตนได้
            </p>
            <div className="actions">
              <input
                aria-label="ค้นหาชื่อผู้ร่วมงาน"
                placeholder="พิมพ์ชื่ออย่างน้อย 2 ตัวอักษร"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Button
                disabled={search.trim().length < 2}
                onClick={async () => {
                  try {
                    setPpl(
                      (await api("/people?q=" + encodeURIComponent(search)))
                        .items,
                    );
                  } catch (e) {
                    setError(e.message);
                  }
                }}
              >
                ค้นหา
              </Button>
            </div>
            {ppl
              .filter((p) => !people.some((x) => x.user_id === p.id))
              .map((p) => (
                <Button
                  key={p.id}
                  onClick={() =>
                    setPeople([
                      ...people,
                      {
                        user_id: p.id,
                        name: p.name,
                        work_role: "ผู้ร่วมปฏิบัติงาน",
                      },
                    ])
                  }
                >
                  เพิ่ม {p.name}
                </Button>
              ))}
            {people.map((p, i) => (
              <div className="form-row" key={p.user_id}>
                <Field label={p.name}>
                  <input
                    required
                    maxLength={2000}
                    value={p.work_role}
                    onChange={(e) =>
                      setPeople(
                        people.map((x, j) =>
                          j === i ? { ...x, work_role: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </Field>
                <Button
                  onClick={() =>
                    setPeople(people.filter((x) => x.user_id !== p.user_id))
                  }
                >
                  นำชื่อออก
                </Button>
              </div>
            ))}
            <fieldset>
              <legend>
                ฝ่ายร่วมดำเนินงาน (ภาพรวมสำนักนับกิจกรรมครั้งเดียว)
              </legend>
              {meta.units
                .filter(
                  (u) =>
                    u.active && u.kind !== "section" && u.id !== record.unit_id,
                )
                .map((u) => (
                  <label className="check" key={u.id}>
                    <input
                      type="checkbox"
                      checked={units.includes(u.id)}
                      onChange={(e) =>
                        setUnits(
                          e.target.checked
                            ? [...units, u.id]
                            : units.filter((id) => id !== u.id),
                        )
                      }
                    />
                    {u.name}
                  </label>
                ))}
            </fieldset>
            <ErrorBox error={error} />
            <Button primary disabled={busy}>
              บันทึกผู้ร่วมงาน
            </Button>
          </form>
        </Dialog>
      )}
    </details>
  );
}
export function LineRegistration({ onLogin }) {
  const token =
      new URLSearchParams(location.hash.split("?")[1] || "").get("token") || "",
    r = useData("/auth/line/registration?token=" + encodeURIComponent(token));
  const [f, setF] = useState({
      name: "",
      unit_id: "",
      work_id: "",
      position: "",
      personnel_type: "",
      requested_role: "staff",
    }),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="login-page">
      <section className="panel form">
        <img
          className="registration-seal"
          src="/municipality-seal.png"
          alt="ตราเทศบาลนครขอนแก่น"
        />
        <h1>ลงทะเบียนบุคลากรผ่าน LINE</h1>
        <p className="muted">เลือกฝ่ายและงานตามโครงสร้างของสำนัก</p>
        <a className="text-link" href="/">
          กลับหน้าเข้าสู่ระบบ
        </a>
        <DataState resource={r}>
          {(d) => (
            <form
              className="form"
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  const out = await api("/auth/line/register", {
                    method: "POST",
                    body: {
                      ...f,
                      name: f.name || d.display_name,
                      unit_id: Number(f.unit_id),
                      work_id: Number(f.work_id),
                      registration_token: token,
                    },
                  });
                  history.replaceState(null, "", location.pathname);
                  onLogin(out);
                } catch (e) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Field label="ชื่อ–นามสกุล">
                <input
                  required
                  value={f.name || d.display_name || ""}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                />
              </Field>
              <Field label="ฝ่าย">
                <select
                  required
                  value={f.unit_id}
                  onChange={(e) =>
                    setF({ ...f, unit_id: e.target.value, work_id: "" })
                  }
                >
                  <option value="">เลือกฝ่าย</option>
                  <UnitOptions
                    units={d.units.map((u) => ({ ...u, active: true }))}
                  />
                </select>
              </Field>
              <Field label="งาน/ศูนย์">
                <select
                  required
                  value={f.work_id}
                  onChange={(e) => setF({ ...f, work_id: e.target.value })}
                >
                  <option value="">เลือกงาน</option>
                  <WorkOptions
                    works={d.works.map((w) => ({ ...w, active: true }))}
                    unitId={f.unit_id}
                    selected={f.work_id}
                  />
                </select>
              </Field>
              {[
                ["position", "ตำแหน่ง"],
                ["personnel_type", "ประเภทบุคลากร"],
              ].map(([k, label]) => (
                <Field label={label} key={k}>
                  <input
                    required
                    value={f[k]}
                    onChange={(e) => setF({ ...f, [k]: e.target.value })}
                  />
                </Field>
              ))}
              <Field label="ตำแหน่งที่ขอใช้ในระบบ">
                <select
                  value={f.requested_role}
                  onChange={(e) =>
                    setF({ ...f, requested_role: e.target.value })
                  }
                >
                  {["staff", "center_head", "head", "executive"].map((k) => (
                    <option key={k} value={k}>
                      {status[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <p>
                เริ่มด้วยสิทธิ์เจ้าหน้าที่
                ตำแหน่งหัวหน้าและผู้บริหารต้องได้รับการรับรอง
              </p>
              <ErrorBox error={error} />
              <Button primary disabled={busy}>
                ลงทะเบียน
              </Button>
            </form>
          )}
        </DataState>
      </section>
    </div>
  );
}

function WorkflowProposals({ user, meta }) {
  const r = useData("/workflow-proposals"),
    [text, setText] = useState(""),
    [kind, setKind] = useState("event"),
    [review, setReview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <section className="panel">
        <h2>เตรียมงานและนัดหมายจากข้อความ</h2>
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const d = await api("/workflow-proposals/analyze", {
                method: "POST",
                body: { kind, source_text: text },
              });
              setReview(d);
              r.reload();
            } catch (e) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="สิ่งที่ต้องการเตรียม">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="event">นัดหมายจากประกาศ</option>
              {leader(user) && <option value="assignment">งานมอบหมาย</option>}
            </select>
          </Field>
          <Field label="ข้อความต้นทาง">
            <textarea
              required
              rows={5}
              maxLength={20000}
              placeholder="วางประกาศนัดหมายหรือข้อความมอบหมายงาน…"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <p className="muted">
            อ่านวันที่และชื่อจากข้อความในเครื่อง
            ข้อมูลที่ยังอ่านไม่ได้ให้เติมตอนตรวจ
            ระบบยังไม่สร้างงานจนกว่าจะยืนยัน
          </p>
          <ErrorBox error={error} />
          <Button primary disabled={busy}>
            {busy ? "กำลังเตรียม…" : "เตรียมให้ตรวจ"}
          </Button>
        </form>
      </section>
      <DataState resource={r}>
        {(d) => (
          <section className="panel">
            <h2>ข้อเสนอที่รับไว้</h2>
            {!d.items.length && <p>ยังไม่มีข้อเสนอ</p>}
            {d.items.map((x) => (
              <article className="scope-list-item" key={x.id}>
                <div>
                  <strong>{x.payload.title}</strong>
                  <p>
                    {x.kind === "event" ? "นัดหมาย" : "งานมอบหมาย"} ·{" "}
                    {x.state === "confirmed"
                      ? "ยืนยันและสร้างแล้ว"
                      : "รอตรวจยืนยัน"}
                  </p>
                </div>
                {x.state === "pending" && (
                  <Button onClick={() => setReview(x)}>ตรวจและยืนยัน</Button>
                )}
              </article>
            ))}
          </section>
        )}
      </DataState>
      {review && (
        <ProposalReview
          proposal={review}
          user={user}
          meta={meta}
          onClose={() => setReview(null)}
          saved={r.reload}
        />
      )}
    </>
  );
}
function ProposalReview({ proposal: p, user, meta, onClose, saved }) {
  const [f, setF] = useState(p.payload),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    projects = useData("/projects");
  const chosen = projects.data?.items.find(
      (p) => p.id === Number(f.project_id),
    ),
    unit = chosen?.unit_id || f.unit_id || user.unit_id || user.scopes[0],
    people = useData("/people?unit=" + unit);
  const set = (k, v) => setF({ ...f, [k]: v });
  return (
    <Dialog
      title={p.kind === "event" ? "ตรวจนัดหมายจากประกาศ" : "ตรวจข้อเสนอมอบหมาย"}
      onClose={onClose}
    >
      <details>
        <summary>อ่านข้อความต้นฉบับ</summary>
        <p className="preserve-text">{p.source_text}</p>
      </details>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const current = chosen ? await api("/projects/" + chosen.id) : null;
            await api("/workflow-proposals/" + p.id + "/confirm", {
              method: "POST",
              body: {
                ...f,
                date: f.date || null,
                unit_id: Number(unit),
                project_id: f.project_id ? Number(f.project_id) : null,
                assignee_id: f.assignee_id ? Number(f.assignee_id) : null,
                start_time: f.start_time || null,
                end_time: f.end_time || null,
                ...(current ? { version: current.version } : {}),
              },
            });
            saved();
            onClose();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="เรื่อง">
          <input
            required
            maxLength={300}
            value={f.title}
            onChange={(e) => set("title", e.target.value)}
          />
        </Field>
        <Field label={p.kind === "event" ? "วันที่นัดหมาย" : "วันที่กำหนดส่ง"}>
          <input
            required
            type="date"
            value={f.date || ""}
            onChange={(e) => set("date", e.target.value)}
          />
        </Field>
        {p.kind === "assignment" ? (
          <>
            <Field label="โครงการที่รับผิดชอบ">
              <select
                required
                value={f.project_id || ""}
                onChange={(e) =>
                  setF({
                    ...f,
                    project_id: Number(e.target.value),
                    assignee_id: null,
                  })
                }
              >
                <option value="">เลือกโครงการ</option>
                {projects.data?.items
                  .filter((p) => p.can_manage && p.status !== "completed")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="ผู้รับผิดชอบ">
              <select
                required
                value={f.assignee_id || ""}
                onChange={(e) => set("assignee_id", Number(e.target.value))}
              >
                <option value="">เลือกผู้รับผิดชอบ</option>
                {people.data?.items.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field label="ฝ่าย">
              <select
                required
                value={unit || ""}
                onChange={(e) =>
                  setF({
                    ...f,
                    unit_id: Number(e.target.value),
                    work_id: null,
                    attendee_ids: [],
                  })
                }
              >
                <option value="">เลือกฝ่าย</option>
                {scopeUnits(user, meta).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="form-row">
              <Field label="เวลาเริ่ม">
                <input
                  type="time"
                  value={f.start_time || ""}
                  onChange={(e) => set("start_time", e.target.value)}
                />
              </Field>
              <Field label="เวลาสิ้นสุด">
                <input
                  type="time"
                  value={f.end_time || ""}
                  onChange={(e) => set("end_time", e.target.value)}
                />
              </Field>
            </div>
            <fieldset>
              <legend>ผู้เข้าร่วม</legend>
              {people.data?.items.map((u) => (
                <label className="check" key={u.id}>
                  <input
                    type="checkbox"
                    checked={f.attendee_ids.includes(u.id)}
                    onChange={(e) =>
                      set(
                        "attendee_ids",
                        e.target.checked
                          ? [...f.attendee_ids, u.id]
                          : f.attendee_ids.filter((id) => id !== u.id),
                      )
                    }
                  />
                  {u.name}
                </label>
              ))}
            </fieldset>
          </>
        )}
        <ErrorBox error={error} />
        <Button primary disabled={busy}>
          ยืนยันและสร้าง{p.kind === "event" ? "นัดหมาย" : "งานมอบหมาย"}
        </Button>
      </form>
    </Dialog>
  );
}
export function AISuggestion({ path, configured, onUse }) {
  const [proposal, setProposal] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <section className="no-print ai-draft-assist">
      {configured ? (
        <>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setProposal(await api(path, { method: "POST", body: {} }));
              } catch (e) {
                setError(e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "กำลังเรียบเรียง…" : "ให้โมเดลช่วยเรียบเรียงร่าง"}
          </Button>
          <p className="muted">
            ส่งข้อมูลฉบับนี้ให้โมเดลที่ตั้งค่าไว้ ตัวเลขในตารางคงจากฐานข้อมูล
            ตรวจข้อความก่อนใช้
          </p>
        </>
      ) : (
        <p className="muted">
          ยังไม่ได้ตั้งค่าโมเดล
          ร่างนี้เรียบเรียงจากฐานข้อมูลในเครื่องและแก้ข้อความเองได้
        </p>
      )}
      <ErrorBox error={error} />
      {proposal && (
        <Dialog
          title="ตรวจข้อความที่โมเดลเสนอ"
          onClose={() => setProposal(null)}
        >
          <p className="notice">
            ยังไม่ได้บันทึกลงฉบับ กรุณาตรวจตัวเลขและรหัสอ้างอิง
          </p>
          {["summary", "problems", "next_steps"].map((k) => (
            <p className="preserve-text" key={k}>
              {proposal[k]}
            </p>
          ))}
          <Button
            primary
            onClick={() => {
              onUse(proposal);
              setProposal(null);
            }}
          >
            ใช้ข้อความนี้ในร่างที่กำลังแก้
          </Button>
        </Dialog>
      )}
    </section>
  );
}

export function LineProcessingStatus() {
  const r = useData("/admin/line-events");
  return (
    <DataState resource={r}>
      {(d) => (
        <section className="panel">
          <h2>การรับและประมวลผลจาก LINE</h2>
          {!d.items.length && <p>ยังไม่มีเหตุการณ์จาก LINE ที่ประมวลผล</p>}
          {d.items.map((x) => (
            <article className="scope-list-item" key={x.event_id}>
              <div>
                <strong>
                  {x.state === "processed"
                    ? "ประมวลผลแล้ว"
                    : x.state === "failed"
                      ? "ยังไม่สำเร็จ"
                      : "อยู่ในคิว"}
                </strong>
                <p>
                  {dateText(x.created_at)} · {x.event_id}
                </p>
                {x.error && <p>{x.error}</p>}
              </div>
              {x.state === "failed" && (
                <Action
                  label="ลองประมวลผลใหม่"
                  path="/admin/line-events/retry"
                  body={{ event_id: x.event_id }}
                  after={r.reload}
                />
              )}
            </article>
          ))}
        </section>
      )}
    </DataState>
  );
}

function CommunityMap({ items, navigate }) {
  const points = items.filter(
    (c) => c.latitude !== null && c.longitude !== null,
  );
  if (!points.length)
    return (
      <p className="notice">
        ทะเบียนยังไม่มีพิกัดชุมชน แสดงรายชื่อแยก 4 เขตด้านล่างได้
        และให้แอดมินเพิ่มพิกัดจริงเพื่อดูตำแหน่ง
      </p>
    );
  const xs = points.map((c) => c.longitude),
    ys = points.map((c) => c.latitude),
    minX = Math.min(...xs),
    minY = Math.min(...ys),
    dx = Math.max(...xs) - minX || 0.01,
    dy = Math.max(...ys) - minY || 0.01;
  const open = (c) => {
    sessionStorage.setItem("rm-library-tab", "activities");
    sessionStorage.setItem(
      "rm-library-filter",
      JSON.stringify({ community: c.id, status: "ready" }),
    );
    navigate("library");
  };
  return (
    <section className="panel">
      <h2>ตำแหน่งชุมชนจากทะเบียน</h2>
      <p>
        พิกัดจริงในระบบ · เขียว: มีรายงาน · เหลือง: อยู่ในแผนและยังไม่มีรายงาน ·
        เทา: ยังไม่มีรายงาน
      </p>
      <svg
        className="community-map"
        viewBox="0 0 640 330"
        role="img"
        aria-label="ตำแหน่งชุมชนตามละติจูดและลองจิจูด"
      >
        <path d="M50 20V290H620" fill="none" stroke="#cbd5e1" />
        <text x="10" y="17">
          เหนือ ↑
        </text>
        <text x="500" y="320">
          ลองจิจูด →
        </text>
        {points.map((c) => (
          <g
            key={c.id}
            role="button"
            tabIndex={0}
            aria-label={c.name + " " + c.reports.length + " กิจกรรม"}
            onClick={() => open(c)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open(c);
              }
            }}
          >
            <circle
              cx={70 + ((c.longitude - minX) / dx) * 500}
              cy={260 - ((c.latitude - minY) / dy) * 210}
              r="9"
              fill={c.visited ? "#16845b" : c.planned ? "#b97b12" : "#64748b"}
            />
            <text
              x={80 + ((c.longitude - minX) / dx) * 500}
              y={264 - ((c.latitude - minY) / dy) * 210}
              fontSize="12"
            >
              {c.name}
            </text>
            <title>
              {c.name} · เขต {c.district} · {c.latitude}, {c.longitude}
            </title>
          </g>
        ))}
      </svg>
      <small>
        แสดงตำแหน่งสัมพันธ์จากพิกัดในทะเบียน ไม่ใช่แผนที่เขตการปกครอง
      </small>
    </section>
  );
}

export function OrganizationHistory() {
  const r = useData("/admin/organization-history");
  return (
    <details className="panel">
      <summary>ประวัติโครงสร้างและวันที่มีผล</summary>
      <p>
        รายการตั้งต้นเป็นโครงสร้างที่ทราบเมื่อติดตั้งส่วนนี้
        รายงานเดิมเก็บชื่อและสังกัด ณ เวลาบันทึก
      </p>
      <DataState resource={r}>
        {(d) => (
          <ul>
            {d.items.map((h) => (
              <li key={h.id}>
                {dateText(h.effective_at)} ·{" "}
                {h.entity === "units" ? "ฝ่าย/ส่วน" : "งาน/ศูนย์"} ·{" "}
                {h.payload.name} · {h.payload.active ? "เปิดใช้" : "ปิดใช้"}
                {h.recorded_by ? "" : " (โครงสร้างตั้งต้น)"}
              </li>
            ))}
          </ul>
        )}
      </DataState>
    </details>
  );
}
