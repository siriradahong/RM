import { contentScope } from "./access.js";
import { aggregateMetrics } from "./analytics.js";
import { httpError } from "./security.js";
import { reportPeriod, periodLabel, csvCell } from "../shared/report-period.js";
import { writeAudit } from "./db.js";

export function reportingScope(user, requested = "mine") {
  if (
    !user.delegated &&
    !user.roles.some((r) =>
      ["staff", "pr", "head", "center_head", "executive"].includes(r),
    )
  )
    throw httpError(403, "ไม่มีสิทธิ์ดูสรุปผลงาน");
  if (requested === "mine")
    return {
      sql: "(a.owner_id=? OR EXISTS(SELECT 1 FROM activity_people ap WHERE ap.activity_id=a.id AND ap.user_id=? AND ap.confirmed_at IS NOT NULL))",
      params: [user.id, user.id],
      label: "รายงานของฉัน",
    };
  if (
    requested === "unit" &&
    (user.roles.includes("head") ||
      user.roles.includes("center_head") ||
      user.delegated)
  )
    return { ...contentScope(user), label: "หน่วยงานที่รับผิดชอบ" };
  if (requested === "all" && user.roles.includes("executive"))
    return { sql: "1=1", params: [], label: "ภาพรวมสำนัก" };
  throw httpError(403, "ไม่มีสิทธิ์ดูสรุปในขอบเขตนี้");
}
function summarize(db, rows) {
  const ready = rows.filter((r) => r.status === "ready" && !r.duplicate_of);
  const units = new Map(),
    categories = new Map();
  for (const r of ready) {
    for (const [map, id, name] of [
      [units, r.unit_id, r.unit_name],
      [categories, r.category_id, r.category_name],
    ]) {
      const entries =
        map === units
          ? [
              { id, name },
              ...db
                .prepare(
                  "SELECT u.id,u.name FROM activity_units au JOIN units u ON u.id=au.unit_id WHERE au.activity_id=? AND u.id<>?",
                )
                .all(r.id, r.unit_id),
            ]
          : [{ id, name }];
      for (const entry of entries) {
        const item = map.get(entry.id) || { ...entry, count: 0 };
        item.count++;
        map.set(entry.id, item);
      }
    }
  }
  return {
    ready: ready.length,
    pending: rows.filter((r) => r.status !== "ready" && !r.duplicate_of).length,
    duplicates: rows.filter((r) => r.duplicate_of).length,
    metrics: aggregateMetrics(db, ready),
    units: [...units.values()],
    categories: [...categories.values()],
  };
}
export function buildReport(db, req) {
  let range;
  try {
    range = reportPeriod(req.query);
  } catch (e) {
    throw httpError(400, e.message);
  }
  const scope = reportingScope(req.user, req.query.scope);
  const filters = [scope.sql],
    args = [...scope.params];
  for (const [key, column, table] of [
    ["unit", "unit_id", "units"],
    ["work", "work_id", "works"],
    ["category", "category_id", "categories"],
  ]) {
    if (req.query[key]) {
      const id = Number(req.query[key]);
      if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !db.prepare(`SELECT id FROM ${table} WHERE id=?`).get(id)
      )
        throw httpError(400, "ตัวกรองไม่ถูกต้อง");
      if (
        key === "unit" &&
        req.query.scope === "unit" &&
        !req.user.scopes.includes(id) &&
        !(req.user.roles.includes("center_head") && req.user.unit_id === id)
      )
        throw httpError(403, "หน่วยงานอยู่นอกขอบเขตที่รับผิดชอบ");
      if (key === "unit") {
        filters.push(
          "(a.unit_id=? OR EXISTS(SELECT 1 FROM activity_units au WHERE au.activity_id=a.id AND au.unit_id=?))",
        );
        args.push(id, id);
      } else {
        filters.push(`a.${column}=?`);
        args.push(id);
      }
    }
  }
  const read = ({ from, to }) =>
    db
      .prepare(
        `SELECT a.id,a.title,a.date,a.status,a.duplicate_of,a.area,a.workers,a.result,a.source,a.owner_id,a.unit_id,a.work_id,a.category_id,a.metrics,a.version,a.updated_at,a.source_text,COALESCE(a.unit_label,u.name) unit_name,COALESCE(a.work_label,w.name) work_name,c.name category_name,o.name owner_name FROM activities a JOIN units u ON u.id=a.unit_id LEFT JOIN works w ON w.id=a.work_id LEFT JOIN categories c ON c.id=a.category_id JOIN users o ON o.id=a.owner_id WHERE ${filters.join(" AND ")} AND COALESCE(a.date,substr(a.created_at,1,10)) BETWEEN ? AND ? ORDER BY a.date DESC,a.id DESC`,
      )
      .all(...args, from, to)
      .map((r) => ({ ...r, metrics: JSON.parse(r.metrics) }));
  const rows = read(range),
    previous = summarize(db, read(range.previous));
  return {
    range,
    title: periodLabel(req.query.period || "month", range.from),
    scope: scope.label,
    generated_at: new Date().toISOString(),
    ...summarize(db, rows),
    previous,
    rows,
    note: "นับเฉพาะรายงานที่ยืนยันแล้วและไม่ถูกระบุว่าซ้ำ แยกชื่อผลและหน่วยนับ ใช้วิธีรวมตามแม่แบบที่เปิดใช้ ผู้ส่งอาจไม่ใช่ผู้ปฏิบัติงาน ยอดคน/รายเป็นยอดที่รายงาน ไม่ใช่จำนวนบุคคลไม่ซ้ำ",
  };
}
export function registerReportRoutes(app, db) {
  app.get("/api/reports/summary", (req, res) => res.json(buildReport(db, req)));
  app.get("/api/reports/export", (req, res) => {
    const d = buildReport(db, req);
    const rows = [
      ["สรุปผลงาน", d.title, d.scope],
      ["ตั้งแต่", d.range.from, "ถึง", d.range.to],
      ["หมายเหตุ", d.note],
      ["กิจกรรมที่ยืนยันแล้ว", d.ready],
      ["ตรวจข้อมูลที่อ่านได้ (ไม่รวมยอด)", d.pending],
      ["ยืนยันแล้วว่าซ้ำ (ไม่รวมยอด)", d.duplicates],
      ["ผลการดำเนินงาน", "จำนวน", "หน่วย", "วิธีสรุป"],
      ...d.metrics.map((m) => [
        m.label,
        m.value,
        m.unit,
        m.method === "max" ? "ค่าสูงสุด" : "รวมค่า",
      ]),
      [],
      [
        "รหัส",
        "ชื่อกิจกรรม",
        "วันที่",
        "ฝ่าย",
        "งาน",
        "ประเภทงาน",
        "ผู้ส่ง",
        "ผู้ปฏิบัติงานตามต้นฉบับ",
        "ผลการดำเนินงาน",
        "สถานะ",
        "แหล่งข้อมูล",
      ],
      ...d.rows.map((r) => [
        r.id,
        r.title,
        r.date,
        r.unit_name,
        r.work_name,
        r.category_name,
        r.owner_name,
        r.workers,
        r.result,
        r.duplicate_of
          ? "ซ้ำกับ #" + r.duplicate_of + " — ไม่รวมยอด"
          : r.status === "ready"
            ? "ยืนยันแล้ว"
            : "ตรวจข้อมูลที่อ่านได้ — ไม่รวมยอด",
        r.source,
      ]),
    ];
    writeAudit(db, req.user, "ส่งออกสรุปผลงาน", "report_export", null, null, {
      scope: d.scope,
      from: d.range.from,
      to: d.range.to,
      count: d.rows.length,
    });
    res
      .type("text/csv")
      .set(
        "Content-Disposition",
        `attachment; filename="rm-report-${d.range.from}-${d.range.to}.csv"`,
      )
      .send("\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n"));
  });
}
