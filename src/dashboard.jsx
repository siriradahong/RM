import React, { useState } from "react";
import {
  useData,
  DataState,
  Button,
  Heading,
  Field,
  today,
  dateText,
} from "./workspace-ui";
import { TemplateReadiness } from "./report-drafts";
import ActivityCalendar from "./calendar";
import { reportPeriod, periodLabel } from "../shared/report-period";
import { query } from "./api";
const number = (n) => n.toLocaleString("th-TH", { maximumFractionDigits: 2 });
export default function Dashboard({
  mode,
  user,
  meta,
  navigate,
  canWrite,
  initialTab = "summary",
  renderSearch,
}) {
  const [period, setPeriod] = useState({
    period: "month",
    anchor: today(),
    from: today(),
    to: today(),
  });
  const [unit, setUnit] = useState(
    mode === "unit" ? String(user.scopes[0] || user.unit_id || "") : "",
  );
  const [tab, setTab] = useState(initialTab);
  const [search, setSearch] = useState("");
  let range, error;
  try {
    range = reportPeriod(period);
  } catch (e) {
    error = e.message;
  }
  const filters = {
    ...(range ? { from: range.from, to: range.to } : { from: "", to: "" }),
    unit,
    mine: mode === "mine" ? "1" : "",
  };
  const resource = useData(
    "/dashboard?" + query({ ...period, unit, mine: filters.mine }),
  );
  const recent = useData("/activities?" + query({ ...filters, limit: 5 }));
  function drill(extra = {}) {
    sessionStorage.setItem(
      "rm-library-filter",
      JSON.stringify({ ...filters, ...extra }),
    );
    sessionStorage.setItem("rm-library-tab", "activities");
    navigate("dashboard/" + mode + "/search");
  }
  function drillMonth(month) {
    const first = month + "-01",
      last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0))
        .toISOString()
        .slice(0, 10);
    drill({
      from: filters.from > first ? filters.from : first,
      to: filters.to < last ? filters.to : last,
      status: "ready",
    });
  }
  const scope =
    mode === "mine"
      ? "mine"
      : mode === "unit" &&
          (user.roles.includes("head") ||
            user.roles.includes("center_head") ||
            user.delegated) &&
          (!unit || user.scopes.includes(Number(unit)))
        ? "unit"
        : mode === "overview" && user.roles.includes("executive")
          ? "all"
          : null;
  return (
    <div className="dashboard-view">
      <Heading
        title={
          mode === "mine"
            ? "รายงานของฉัน"
            : mode === "unit"
              ? "แดชบอร์ดหน่วยงาน"
              : "ภาพรวมสำนัก"
        }
        actions={
          canWrite && (
            <Button primary onClick={() => navigate("import")}>
              เพิ่มข้อมูล
            </Button>
          )
        }
      >
        ดูผลงานในช่วงเวลา และเปิดรายงานที่มาของแต่ละยอด
      </Heading>
      {mode === "mine" && (
        <section
          className="panel dashboard-search"
          aria-label="ค้นหารายงานส่วนตัว"
        >
          <Field label="ค้นหางานของฉัน">
            <input
              type="search"
              value={search}
              placeholder="ค้นหาชื่อเรื่อง ข้อความ หรือคำสำคัญ…"
              onChange={(e) => {
                setSearch(e.target.value);
                setTab("search");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") setTab("search");
              }}
            />
          </Field>
          <Button onClick={() => setTab("search")}>ค้นหางาน</Button>
        </section>
      )}
      {tab === "summary" && (
        <section className="period-toolbar panel" aria-label="ตัวกรองแดชบอร์ด">
          <Field label="รอบรายงาน">
            <select
              value={period.period}
              onChange={(e) => setPeriod({ ...period, period: e.target.value })}
            >
              <option value="month">รายเดือน</option>
              <option value="quarter">รายไตรมาส</option>
              <option value="year">ปีงบประมาณ</option>
              <option value="custom">กำหนดเอง</option>
            </select>
          </Field>
          {period.period === "custom" ? (
            <>
              <Field label="ตั้งแต่">
                <input
                  type="date"
                  value={period.from}
                  onChange={(e) =>
                    setPeriod({ ...period, from: e.target.value })
                  }
                />
              </Field>
              <Field label="ถึง">
                <input
                  type="date"
                  value={period.to}
                  onChange={(e) => setPeriod({ ...period, to: e.target.value })}
                />
              </Field>
            </>
          ) : (
            <Field label="วันที่ในรอบรายงาน">
              <input
                type="date"
                value={period.anchor}
                onChange={(e) =>
                  setPeriod({ ...period, anchor: e.target.value })
                }
              />
            </Field>
          )}
          {mode !== "mine" && (
            <Field label="หน่วยงาน">
              <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                <option value="">ทุกหน่วยงาน</option>
                {meta.units
                  .filter(
                    (u) =>
                      u.kind !== "section" &&
                      (user.roles.includes("executive") ||
                        user.scopes.includes(u.id) ||
                        u.id === user.unit_id),
                  )
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
              </select>
            </Field>
          )}
          {range && (
            <p className="range-label">
              {periodLabel(period.period, range.from)}
              <small>
                {dateText(range.from)} – {dateText(range.to)}
              </small>
            </p>
          )}
        </section>
      )}
      <div
        className="section-tabs view-tabs"
        role="navigation"
        aria-label="รูปแบบแสดงข้อมูล"
      >
        <button
          className={tab === "summary" ? "active" : ""}
          onClick={() => setTab("summary")}
        >
          สรุปผลงาน
        </button>
        <button
          className={tab === "search" ? "active" : ""}
          onClick={() => setTab("search")}
        >
          ค้นหางานและเอกสาร
        </button>
        <button
          className={tab === "calendar" ? "active" : ""}
          onClick={() => setTab("calendar")}
        >
          ปฏิทินกิจกรรม
        </button>
      </div>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : tab === "search" ? (
        <section
          className="dashboard-search-results"
          aria-label="ผลการค้นหางาน"
        >
          <h2>ค้นหางานและเอกสาร</h2>
          {mode !== "mine" && (
            <Field label="ค้นหางาน">
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="ค้นหาชื่อเรื่องหรือคำสำคัญ"
              />
            </Field>
          )}
          {renderSearch?.(search, () => setSearch(""))}
        </section>
      ) : tab === "calendar" ? (
        <ActivityCalendar
          filters={filters}
          navigate={navigate}
          units={mode !== "mine" ? meta.units : null}
          onUnitChange={mode !== "mine" ? setUnit : null}
        />
      ) : (
        <>
          <DataState resource={resource}>
            {(d) => (
              <>
                {d.previous && (
                  <section className="panel period-comparison">
                    <h2>เทียบรอบก่อนหน้า</h2>
                    <p>
                      กิจกรรมยืนยัน {number(d.previous.ready)} →{" "}
                      {number(d.ready)} กิจกรรม (
                      {d.ready - d.previous.ready >= 0 ? "+" : ""}
                      {number(d.ready - d.previous.ready)})
                    </p>
                    <small>
                      {dateText(d.previous.range.from)}–
                      {dateText(d.previous.range.to)} เทียบกับรอบที่เลือก ·
                      ตัวเลขต่างชนิดและหน่วยแสดงแยกกัน
                    </small>
                    {d.metrics.map((m) => {
                      const old = d.previous.metrics.find(
                        (x) =>
                          x.label === m.label &&
                          x.unit === m.unit &&
                          x.method === m.method,
                      );
                      return (
                        <p key={m.label + ":" + m.unit}>
                          {m.label}:{" "}
                          {old ? number(old.value) : "ไม่มีข้อมูลรอบก่อน"} →{" "}
                          {number(m.value)} {m.unit}
                        </p>
                      );
                    })}
                    <Button
                      onClick={() =>
                        drill({ ...d.previous.range, status: "ready" })
                      }
                    >
                      ดูรายงานรอบก่อน
                    </Button>
                  </section>
                )}
                <div className="stats concise-stats">
                  <button
                    className="stat featured"
                    onClick={() => drill({ status: "ready" })}
                  >
                    <span>กิจกรรมที่พร้อมสรุป</span>
                    <strong>
                      {number(d.ready)}
                      <small>กิจกรรม</small>
                    </strong>
                    <p>เปิดรายงานที่ใช้คำนวณ →</p>
                  </button>
                  <button
                    className="stat"
                    onClick={() => drill({ status: "pending" })}
                  >
                    <span>ข้อมูลที่ต้องตรวจ</span>
                    <strong>
                      {number(d.pending)}
                      <small>รายการ</small>
                    </strong>
                    <p>ตรวจข้อมูลที่อ่านได้ →</p>
                  </button>
                  <button
                    className="stat"
                    onClick={() => drill({ status: "duplicate" })}
                  >
                    <span>ยืนยันแล้วว่าซ้ำ</span>
                    <strong>
                      {number(d.duplicates)}
                      <small>รายการ</small>
                    </strong>
                    <p>เก็บต้นฉบับและไม่รวมยอด →</p>
                  </button>
                </div>
                {!d.ready && !d.pending && (
                  <section className="panel simple-empty">
                    <h2>ยังไม่มีรายงานในช่วงนี้</h2>
                    <p>
                      {canWrite
                        ? "เพิ่มข้อความหรือเอกสารเพื่อเริ่มบันทึกผลงาน หรือเปลี่ยนช่วงเวลา"
                        : "ลองเปลี่ยนช่วงเวลาหรือหน่วยงานเพื่อดูรายงานที่บันทึกไว้"}
                    </p>
                    {canWrite && (
                      <Button onClick={() => navigate("import")}>
                        เริ่มเพิ่มข้อมูล
                      </Button>
                    )}
                  </section>
                )}
                {d.ready > 0 && (
                  <>
                    <div className="dashboard-charts">
                      <section className="panel">
                        <h2>กิจกรรมรายเดือน</h2>
                        {d.months.length ? (
                          <div className="trend-list">
                            {d.months.map((m) => (
                              <button
                                key={m.name}
                                onClick={() => drillMonth(m.name)}
                              >
                                <span>
                                  {new Date(m.name + "-01").toLocaleDateString(
                                    "th-TH",
                                    {
                                      month: "short",
                                      year: "numeric",
                                      timeZone: "UTC",
                                    },
                                  )}
                                </span>
                                <i
                                  style={{
                                    width:
                                      Math.max(
                                        3,
                                        (m.count /
                                          Math.max(
                                            ...d.months.map((x) => x.count),
                                          )) *
                                          100,
                                      ) + "%",
                                  }}
                                />
                                <b>{m.count}</b>
                              </button>
                            ))}
                          </div>
                        ) : (
                          <p className="muted">
                            ยังไม่มีข้อมูลที่ยืนยันในช่วงนี้
                          </p>
                        )}
                      </section>
                      <section className="panel">
                        <h2>แยกตามประเภทงาน</h2>
                        {d.byCategory.length ? (
                          d.byCategory.map((c) => (
                            <button
                              className="report-breakdown"
                              key={c.name}
                              onClick={() =>
                                drill({
                                  status: "ready",
                                  category:
                                    meta.categories.find(
                                      (x) => x.name === c.name,
                                    )?.id || "",
                                })
                              }
                            >
                              <span>{c.name}</span>
                              <b>{c.count} กิจกรรม</b>
                            </button>
                          ))
                        ) : (
                          <p className="muted">ยังไม่มีข้อมูลประเภทงาน</p>
                        )}
                      </section>
                    </div>
                    <section className="panel">
                      <h2>ผลการดำเนินงานแยกตามหน่วยนับ</h2>
                      {d.metrics.length ? (
                        <div className="metric-grid">
                          {d.metrics.map((m) => (
                            <button
                              key={m.label + m.unit + m.method}
                              onClick={() =>
                                drill({
                                  status: "ready",
                                  metric_label: m.label,
                                  metric_unit: m.unit,
                                  metric_method: m.method,
                                })
                              }
                            >
                              <span>{m.label}</span>
                              <strong>
                                {number(m.value)} <small>{m.unit}</small>
                              </strong>
                              <small>
                                {m.method === "max"
                                  ? "ค่าสูงสุดตามแม่แบบ"
                                  : "รวมค่าที่รายงาน"}{" "}
                                · ดูต้นทาง →
                              </small>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="muted">
                          ยังไม่มีตัวเลขที่ยืนยัน ·
                          ค่าที่ไม่ได้รายงานจะแสดงว่าไม่มีข้อมูล
                        </p>
                      )}
                    </section>
                  </>
                )}
                {!!d.duplicates && (
                  <p className="muted">
                    ไม่นำรายการที่ยืนยันว่าซ้ำ {d.duplicates} รายการมารวมผลงาน
                  </p>
                )}
              </>
            )}
          </DataState>
          {!!(resource.data?.ready || resource.data?.pending) && (
            <section className="panel">
              <div className="panel-heading">
                <h2>รายการล่าสุด</h2>
                <Button onClick={() => drill()}>ดูทั้งหมด</Button>
              </div>
              <DataState resource={recent}>
                {(d) =>
                  d.items.length ? (
                    <div className="activity-list">
                      {d.items.map((r) => (
                        <button
                          key={r.id}
                          aria-label={r.title}
                          onClick={() => navigate("activity/" + r.id)}
                        >
                          <span>
                            <b>{r.title}</b>
                            <small>
                              {dateText(r.date)} · {r.unit_name}
                            </small>
                          </span>
                          <span
                            className={
                              "badge " +
                              (r.duplicate_of ? "duplicate" : r.status)
                            }
                          >
                            {r.duplicate_of
                              ? "ซ้ำ ไม่รวมยอด"
                              : r.status === "ready"
                                ? "พร้อมสรุป"
                                : "ตรวจข้อมูลที่อ่านได้"}
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">
                      รายงานที่บันทึกในช่วงนี้จะแสดงที่นี่
                    </p>
                  )
                }
              </DataState>
            </section>
          )}
          {scope &&
            range &&
            !!(resource.data?.ready || resource.data?.pending) && (
              <details className="panel readiness-details">
                <summary>ตรวจความพร้อมตามรูปแบบรายงาน</summary>
                <TemplateReadiness
                  filters={{
                    scope,
                    period: "custom",
                    from: range.from,
                    to: range.to,
                    unit,
                  }}
                  navigate={navigate}
                />
              </details>
            )}
          <details className="workflow-guide">
            <summary>วิธีนับผลงานและข้อมูลที่ไม่รวมยอด</summary>
            <p>
              นับจากกิจกรรมที่ยืนยันแล้ว
              รายการเก็บไว้ค้นหาและรายการที่ยืนยันว่าซ้ำไม่รวมยอด
              แยกชื่อผลและหน่วยนับ ใช้วิธีรวมตามแม่แบบที่แอดมินเปิดใช้
              ค่าคน/รายเป็นยอดที่รายงาน ไม่ใช่จำนวนบุคคลไม่ซ้ำ
              ผู้บันทึกอาจรายงานแทนผู้ปฏิบัติงานได้
            </p>
            <Button onClick={() => navigate("reports")}>เปิดรายงานสรุป</Button>
          </details>
        </>
      )}
    </div>
  );
}
