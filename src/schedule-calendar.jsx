import React, { useState } from "react";
import {
  useData,
  DataState,
  Heading,
  Button,
  dateText,
  today,
} from "./workspace-ui";
import { query } from "./api";
import { EventForm } from "./scope-workspace";
export default function ScheduleCalendar({ user, meta, navigate }) {
  const requested = location.hash.split("/")[1];
  const [month, setMonth] = useState(
    /^\d{4}-(0[1-9]|1[0-2])$/.test(requested || "")
      ? requested
      : today().slice(0, 7),
  );
  const [selected, setSelected] = useState(""),
    [show, setShow] = useState(false),
    [onlyMine, setOnlyMine] = useState(false);
  const [year, m] = month.split("-").map(Number),
    days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const r = useData(
    "/events?" + query({ from: month + "-01", to: month + "-" + days }),
  );
  function move(offset) {
    const d = new Date(Date.UTC(year, m - 1 + offset, 1));
    setMonth(d.toISOString().slice(0, 7));
    setSelected("");
  }
  return (
    <>
      <Heading
        title="ปฏิทิน"
        actions={
          <Button primary onClick={() => setShow(true)}>
            เพิ่มนัดหมาย
          </Button>
        }
      >
        นัดหมายและงานที่ได้รับมอบหมาย เชื่อมจากโครงการอัตโนมัติ
      </Heading>
      <section className="panel schedule-panel">
        <div className="schedule-toolbar">
          <div className="report-actions">
            <Button aria-label="เดือนก่อน" onClick={() => move(-1)}>
              ‹
            </Button>
            <h2>
              {new Date(year, m - 1, 1).toLocaleDateString("th-TH", {
                month: "long",
                year: "numeric",
              })}
            </h2>
            <Button aria-label="เดือนถัดไป" onClick={() => move(1)}>
              ›
            </Button>
          </div>
          <div className="report-actions">
            <input
              aria-label="เดือนในปฏิทิน"
              type="month"
              value={month}
              onChange={(e) => {
                if (e.target.value) {
                  setMonth(e.target.value);
                  setSelected("");
                }
              }}
            />
            <Button
              onClick={() => {
                setMonth(today().slice(0, 7));
                setSelected(today());
              }}
            >
              วันนี้
            </Button>
          </div>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={onlyMine}
            onChange={(e) => setOnlyMine(e.target.checked)}
          />{" "}
          เฉพาะงานและนัดหมายของฉัน
        </label>
        <DataState resource={r}>
          {(d) => {
            const items = d.items.filter(
              (e) =>
                !onlyMine ||
                (e.event_type === "task" && e.assignee_id === user.id) ||
                (e.event_type === "appointment" && e.is_mine),
            );
            const conflictKeys = new Set(
              d.conflicts.flatMap((c) => c.keys || []),
            );
            return (
              <>
                <div className="calendar-legend">
                  <span>● งานมอบหมาย</span>
                  <span>● นัดหมาย</span>
                  <span>● เวลาทับซ้อน</span>
                </div>
                {d.conflicts.length > 0 && (
                  <p className="notice">
                    พบ {d.conflicts.length} คู่งานหรือนัดหมายที่เวลาทับซ้อนกัน
                    กดวันที่เพื่อดูรายละเอียด
                  </p>
                )}
                <div
                  className="schedule-grid"
                  role="group"
                  aria-label="ปฏิทินรายเดือน"
                >
                  {["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."].map((v) => (
                    <b className="schedule-weekday" key={v}>
                      {v}
                    </b>
                  ))}
                  {Array.from(
                    {
                      length:
                        (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) %
                        7,
                    },
                    (_, i) => (
                      <div className="schedule-blank" key={"blank" + i} />
                    ),
                  )}
                  {Array.from({ length: days }, (_, i) => {
                    const date = month + "-" + String(i + 1).padStart(2, "0"),
                      events = items.filter((e) => e.date === date);
                    return (
                      <button
                        type="button"
                        aria-label={date + " · " + events.length + " รายการ"}
                        aria-pressed={selected === date}
                        key={date}
                        className={
                          "schedule-day " +
                          (date === today() ? "is-today " : "") +
                          (selected === date ? "is-selected" : "")
                        }
                        onClick={() => setSelected(date)}
                      >
                        <time dateTime={date}>{i + 1}</time>
                        {events.slice(0, 3).map((e) => (
                          <span
                            key={e.key}
                            title={e.title}
                            className={
                              "schedule-chip " +
                              e.event_type +
                              (conflictKeys.has(e.key) ? " conflict" : "") +
                              (e.status === "completed" ? " completed" : "")
                            }
                          >
                            {e.start_time ? e.start_time + " " : ""}
                            {e.title}
                          </span>
                        ))}
                        {events.length > 3 && (
                          <small>+{events.length - 3} รายการ</small>
                        )}
                      </button>
                    );
                  })}
                </div>
                <section className="schedule-detail" aria-live="polite">
                  <h2>{selected ? dateText(selected) : "รายการในเดือนนี้"}</h2>
                  {!items.filter((e) => !selected || e.date === selected)
                    .length && (
                    <p className="muted">ไม่มีงานหรือนัดหมายในช่วงนี้</p>
                  )}
                  {items
                    .filter((e) => !selected || e.date === selected)
                    .map((e) => (
                      <article className="scope-list-item" key={e.key}>
                        <div>
                          <strong>{e.title}</strong>
                          <p>
                            {dateText(e.date)} ·{" "}
                            {e.start_time
                              ? e.start_time + "–" + e.end_time
                              : e.event_type === "task"
                                ? "กำหนดส่งทั้งวัน"
                                : "ยังไม่กำหนดเวลา"}{" "}
                            · {e.unit_name}
                          </p>
                          {e.event_type === "task" && (
                            <p>
                              {e.project_title} · {e.assignee_name} ·{" "}
                              {
                                {
                                  assigned: "ยังไม่เริ่ม",
                                  in_progress: "กำลังดำเนินการ",
                                  submitted: "รอตรวจรับ",
                                  completed: "เสร็จสิ้น",
                                }[e.status]
                              }
                            </p>
                          )}
                          {conflictKeys.has(e.key) && (
                            <p className="notice">
                              เวลาทับซ้อนกับงานหรือนัดหมายอื่นของผู้รับผิดชอบ
                            </p>
                          )}
                          {e.source_text && (
                            <details>
                              <summary>ข้อความต้นทาง</summary>
                              <p className="preserve-text">{e.source_text}</p>
                            </details>
                          )}
                        </div>
                        {e.project_id && (
                          <Button
                            onClick={() => navigate("projects/" + e.project_id)}
                          >
                            เปิดโครงการ
                          </Button>
                        )}
                      </article>
                    ))}
                </section>
              </>
            );
          }}
        </DataState>
      </section>
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
