import React, { useState } from "react";
import { useData, DataState, Button, dateText } from "./workspace-ui";
import { query } from "./api";

export default function ActivityCalendar({
  filters,
  navigate,
  units,
  onUnitChange,
}) {
  const [month, setMonth] = useState(
    () => filters.from?.slice(0, 7) || new Date().toISOString().slice(0, 7),
  );
  const [year, m] = month.split("-").map(Number),
    days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const from = month + "-01",
    to = month + "-" + days;
  const resource = useData(
    "/calendar?" + query({ from, to, unit: filters.unit, mine: filters.mine }),
  );
  return (
    <section className="panel calendar-panel">
      <div className="panel-heading">
        <div>
          <h2>ปฏิทินกิจกรรม</h2>
          <p>ใช้วันที่กิจกรรมที่บันทึกไว้ กดชื่อเพื่อดูหลักฐาน</p>
        </div>
        {onUnitChange && (
          <label className="field">
            <span>หน่วยงานในปฏิทิน</span>
            <select
              value={filters.unit || ""}
              onChange={(e) => onUnitChange(e.target.value)}
            >
              <option value="">ทุกหน่วยงาน</option>
              {units
                .filter((u) => u.kind !== "section")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <label className="field">
          <span>เดือนในปฏิทิน</span>
          <input
            type="month"
            required
            value={month}
            onChange={(e) => {
              if (e.target.value) setMonth(e.target.value);
            }}
          />
        </label>
      </div>
      <DataState resource={resource}>
        {(d) => (
          <>
            {d.has_more && (
              <p className="notice">
                มีมากกว่า 500 รายการ กรุณาเลือกฝ่ายให้แคบลงหรือเปิดคลังข้อมูล
              </p>
            )}
            {d.items.length ? (
              <div className="calendar-grid">
                {["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."].map((day) => (
                  <div className="calendar-weekday" key={day}>
                    {day}
                  </div>
                ))}
                {Array.from(
                  { length: (new Date(from).getUTCDay() + 6) % 7 },
                  (_, i) => (
                    <div className="calendar-spacer" key={"blank" + i} />
                  ),
                )}
                {Array.from({ length: days }, (_, i) => {
                  const date = month + "-" + String(i + 1).padStart(2, "0"),
                    items = d.items.filter((x) => x.date === date);
                  return (
                    <div
                      className={
                        "calendar-day " + (items.length ? "has-events" : "")
                      }
                      key={date}
                    >
                      <time dateTime={date}>
                        {i + 1}{" "}
                        <small>
                          {new Date(date).toLocaleDateString("th-TH", {
                            weekday: "short",
                            timeZone: "UTC",
                          })}
                        </small>
                      </time>
                      {items.map((x) => (
                        <button
                          key={x.id}
                          className={x.duplicate_of ? "duplicate-event" : ""}
                          onClick={() => navigate("activity/" + x.id)}
                        >
                          <strong>{x.title}</strong>
                          <small>
                            {x.unit_name} ·{" "}
                            {x.duplicate_of
                              ? "รายการซ้ำ ไม่รวมยอด"
                              : x.status === "ready"
                                ? "พร้อมสรุป"
                                : "ตรวจข้อมูลที่อ่านได้"}
                          </small>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="subtle-empty">
                <h3>ยังไม่มีกิจกรรมที่ระบุวันที่ในเดือนนี้</h3>
                <p>
                  เปลี่ยนเดือน หรือเปิดรายงานในคลังเพื่อยืนยันวันที่จากต้นฉบับ
                </p>
                <Button onClick={() => navigate("library")}>
                  เปิดคลังข้อมูล
                </Button>
              </div>
            )}
          </>
        )}
      </DataState>
    </section>
  );
}
