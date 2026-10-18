import { TemplateReadiness } from "./report-drafts";
import React, { useState } from "react";
import { query } from "./api";
import {
  Button,
  Field,
  Heading,
  DataState,
  useData,
  today,
  dateText,
  ReportTabs,
} from "./workspace-ui";
export default function Reports({ user, meta, navigate }) {
  const [filters, setFilters] = useState({
    scope: user.roles.includes("executive")
      ? "all"
      : user.roles.includes("head") ||
          user.roles.includes("center_head") ||
          user.delegated
        ? "unit"
        : "mine",
    period: "month",
    anchor: today(),
    from: today().slice(0, 8) + "01",
    to: today(),
    unit: "",
    work: "",
    category: "",
  });
  const [status, setStatus] = useState(""),
    [selectedCategory, setCategory] = useState(""),
    [selectedUnit, setUnit] = useState("");
  const resource = useData("/reports/summary?" + query(filters));
  const change = (key, value) => {
    setFilters((f) => ({
      ...f,
      [key]: value,
      ...(["unit", "scope"].includes(key) ? { work: "" } : {}),
      ...(key === "scope" ? { unit: "" } : {}),
    }));
    setUnit("");
    setCategory("");
    setStatus("");
  };
  const units = meta.units.filter(
    (u) =>
      u.kind !== "section" &&
      (filters.scope !== "unit" ||
        user.scopes.includes(u.id) ||
        (user.roles.includes("center_head") && user.unit_id === u.id)),
  );
  return (
    <div className="report-page">
      <ReportTabs page="reports" navigate={navigate} />
      <Heading
        title="รายงานสรุป"
        actions={
          <div className="report-actions no-print">
            <Button
              primary
              onClick={() => {
                sessionStorage.setItem(
                  "rm-draft-filters",
                  JSON.stringify(filters),
                );
                navigate("drafts/new");
              }}
            >
              สร้างร่างรายงานสรุปผล
            </Button>
            <Button disabled={!resource.data} onClick={() => window.print()}>
              พิมพ์ / บันทึก PDF
            </Button>
            {resource.data && (
              <a
                className="button"
                href={"/api/reports/export?" + query(filters)}
              >
                ดาวน์โหลด CSV
              </a>
            )}
          </div>
        }
      >
        รายเดือน ไตรมาส และปีงบประมาณ · ตรวจย้อนกลับถึงรายงานต้นทางได้
      </Heading>
      <section className="panel report-filters no-print">
        <Field label="ขอบเขตข้อมูล">
          <select
            value={filters.scope}
            onChange={(e) => change("scope", e.target.value)}
          >
            <option value="mine">รายงานของฉัน</option>
            {(user.roles.includes("head") ||
              user.roles.includes("center_head") ||
              user.delegated) && (
              <option value="unit">หน่วยงานที่รับผิดชอบ</option>
            )}
            {user.roles.includes("executive") && (
              <option value="all">ภาพรวมสำนัก</option>
            )}
          </select>
        </Field>
        <Field label="รอบรายงาน">
          <select
            value={filters.period}
            onChange={(e) => change("period", e.target.value)}
          >
            <option value="month">รายเดือน</option>
            <option value="quarter">รายไตรมาส</option>
            <option value="year">ปีงบประมาณ (ต.ค.–ก.ย.)</option>
            <option value="custom">กำหนดเอง</option>
          </select>
        </Field>
        {filters.period === "custom" ? (
          <>
            <Field label="วันเริ่มต้น">
              <input
                type="date"
                value={filters.from}
                onChange={(e) => change("from", e.target.value)}
              />
            </Field>
            <Field label="วันสิ้นสุด">
              <input
                type="date"
                value={filters.to}
                onChange={(e) => change("to", e.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field label="วันที่ในรอบรายงาน">
            <input
              type="date"
              value={filters.anchor}
              onChange={(e) => change("anchor", e.target.value)}
            />
          </Field>
        )}
        <Field label="ฝ่าย / กลุ่มงาน">
          <select
            value={filters.unit}
            onChange={(e) => change("unit", e.target.value)}
          >
            <option value="">ทั้งหมดในขอบเขต</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="งาน">
          <select
            value={filters.work}
            onChange={(e) => change("work", e.target.value)}
          >
            <option value="">ทุกงาน</option>
            {meta.works
              .filter(
                (w) =>
                  (!filters.unit || w.unit_id === Number(filters.unit)) &&
                  units.some((u) => u.id === w.unit_id),
              )
              .map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="ประเภทงาน">
          <select
            value={filters.category}
            onChange={(e) => change("category", e.target.value)}
          >
            <option value="">ทุกประเภท</option>
            {meta.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </section>
      <details className="panel readiness-details no-print">
        <summary>ตรวจความพร้อมตามรูปแบบรายงาน</summary>
        <TemplateReadiness filters={filters} navigate={navigate} />
      </details>
      <DataState resource={resource}>
        {(d) => {
          const rows = d.rows.filter(
            (r) =>
              (!status ||
                (status === "duplicate"
                  ? r.duplicate_of
                  : r.status === status && !r.duplicate_of)) &&
              (!selectedCategory ||
                r.category_id === Number(selectedCategory)) &&
              (!selectedUnit || r.unit_id === Number(selectedUnit)),
          );
          const delta = d.ready - d.previous.ready;
          return (
            <>
              <section className="panel report-summary">
                <div className="panel-heading">
                  <div>
                    <h2>{d.title}</h2>
                    <p>
                      {d.scope} · {dateText(d.range.from)} –{" "}
                      {dateText(d.range.to)}
                    </p>
                  </div>
                  <span className="badge">{d.rows.length} รายงาน</span>
                </div>
                <div className="report-counts">
                  <button onClick={() => setStatus("ready")}>
                    <strong>{d.ready}</strong>
                    <span>กิจกรรมที่ยืนยันแล้ว</span>
                  </button>
                  <button onClick={() => setStatus("pending")}>
                    <strong>{d.pending}</strong>
                    <span>ตรวจข้อมูลที่อ่านได้ · ไม่รวมยอด</span>
                  </button>
                  <div>
                    <strong>
                      {delta > 0 ? "+" : ""}
                      {delta}
                    </strong>
                    <span>เทียบรอบก่อน ({d.previous.ready} กิจกรรม)</span>
                  </div>
                </div>
                <p className="muted">
                  รอบก่อน: {dateText(d.range.previous.from)} –{" "}
                  {dateText(d.range.previous.to)} · เปรียบเทียบจำนวนกิจกรรม
                  ไม่ใช่คะแนนประเมิน
                </p>
                <details>
                  <summary>วิธีนับและข้อมูลที่ไม่รวมยอด</summary>
                  <p>{d.note}</p>
                  <p>ยืนยันแล้วว่าซ้ำ {d.duplicates} รายการ ไม่รวมในยอด</p>
                </details>
              </section>
              <section className="panel report-metrics">
                <h2>ผลการดำเนินงานแยกตามหน่วยนับ</h2>
                {d.metrics.length ? (
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>ผลการดำเนินงาน</th>
                          <th>รอบนี้</th>
                          <th>รอบก่อน</th>
                          <th>หน่วย</th>
                          <th>วิธีสรุป</th>
                        </tr>
                      </thead>
                      <tbody>
                        {d.metrics.map((m) => (
                          <tr key={m.label + m.unit + m.method}>
                            <td>{m.label}</td>
                            <td>{m.value.toLocaleString("th-TH")}</td>
                            <td>
                              {d.previous.metrics
                                .find(
                                  (p) =>
                                    p.label === m.label &&
                                    p.unit === m.unit &&
                                    p.method === m.method,
                                )
                                ?.value?.toLocaleString("th-TH") ??
                                "ไม่มีข้อมูล"}
                            </td>
                            <td>{m.unit}</td>
                            <td>
                              {m.method === "max" ? "ค่าสูงสุด" : "รวมค่า"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">ยังไม่มีตัวเลขที่ยืนยันในช่วงนี้</p>
                )}
              </section>
              <div className="dashboard-charts">
                <section className="panel">
                  <h2>ผลงานตามฝ่าย</h2>
                  {d.units.length ? (
                    d.units.map((u) => (
                      <button
                        className="report-breakdown"
                        key={u.id}
                        onClick={() => {
                          setUnit(String(u.id));
                          setStatus("ready");
                        }}
                      >
                        <span>{u.name}</span>
                        <b>{u.count} กิจกรรม</b>
                      </button>
                    ))
                  ) : (
                    <p>ยังไม่มีรายงานที่ยืนยัน</p>
                  )}
                </section>
                <section className="panel">
                  <h2>ผลงานตามประเภทงาน</h2>
                  {d.categories.map((c) => (
                    <button
                      className="report-breakdown"
                      key={c.id}
                      onClick={() => {
                        setCategory(String(c.id));
                        setStatus("ready");
                      }}
                    >
                      <span>{c.name}</span>
                      <b>{c.count} กิจกรรม</b>
                    </button>
                  ))}
                </section>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>รายงานต้นทาง</h2>
                    <p>
                      เรียงตามวันที่กิจกรรม · {rows.length} รายการที่แสดงจาก{" "}
                      {d.rows.length} รายการ
                    </p>
                  </div>
                  <Button
                    onClick={() => {
                      setStatus("");
                      setUnit("");
                      setCategory("");
                    }}
                  >
                    แสดงทุกรายการ
                  </Button>
                </div>
                <div className="no-print report-actions">
                  <label>
                    สถานะ{" "}
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value)}
                    >
                      <option value="">ทั้งหมด</option>
                      <option value="ready">ยืนยันแล้ว</option>
                      <option value="pending">ตรวจข้อมูลที่อ่านได้</option>
                      <option value="duplicate">ซ้ำ ไม่รวมยอด</option>
                    </select>
                  </label>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>กิจกรรม / วันที่</th>
                        <th>ฝ่าย / งาน</th>
                        <th>ผู้ส่ง / ผู้ปฏิบัติงาน</th>
                        <th>ผล / สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <button
                              className="table-link"
                              onClick={() => navigate("activity/" + r.id)}
                            >
                              {r.title}
                            </button>
                            <small>
                              {dateText(r.date)} ·{" "}
                              {r.source === "line" ? "LINE" : "เว็บ"}
                            </small>
                          </td>
                          <td>
                            {r.unit_name}
                            <small>{r.work_name}</small>
                          </td>
                          <td>
                            ผู้ส่ง: {r.owner_name}
                            <small>
                              ผู้ปฏิบัติงาน: {r.workers || "ยังไม่ระบุ"}
                            </small>
                          </td>
                          <td>
                            {r.result || "ยังไม่ระบุ"}
                            <small>
                              {r.duplicate_of
                                ? "ซ้ำ ไม่รวมยอด"
                                : r.status === "ready"
                                  ? "ยืนยันแล้ว"
                                  : "ตรวจข้อมูลที่อ่านได้ — ไม่รวมยอด"}
                            </small>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!rows.length && <p>ไม่พบรายงานตามตัวกรองนี้</p>}
                <p className="muted no-print">
                  PDF พิมพ์รายการที่แสดงบนหน้านี้ · CSV
                  ส่งออกทุกรายการตามขอบเขตและรอบรายงานด้านบน
                </p>
              </section>
              <p className="muted">
                จัดทำเมื่อ {dateText(d.generated_at)} · {user.name}
              </p>
            </>
          );
        }}
      </DataState>
    </div>
  );
}
