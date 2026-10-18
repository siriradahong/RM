import { createHash } from "node:crypto";
export const fieldNames = {
  date: "วันที่กิจกรรม",
  area: "พื้นที่",
  workers: "ผู้ปฏิบัติงาน",
  result: "ผลการดำเนินงาน",
};
export const metricUnits = [
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
];
export function parseTemplate(row) {
  return {
    ...row,
    active: Boolean(row.active),
    config: JSON.parse(row.config),
  };
}
export function activeTemplates(db) {
  return db
    .prepare(
      "SELECT * FROM summary_templates WHERE active=1 ORDER BY unit_id IS NULL,id",
    )
    .all()
    .map(parseTemplate);
}
export function matchTemplate(templates, row) {
  return templates.find(
    (t) =>
      t.category_id === row.category_id &&
      (t.unit_id == null || t.unit_id === row.unit_id),
  );
}
export function calculate(rows, template) {
  return [
    {
      label: "กิจกรรมไม่ซ้ำ",
      unit: "กิจกรรม",
      method: "count",
      value: new Set(rows.map((r) => r.id)).size,
      source_ids: rows.map((r) => r.id),
    },
    ...template.config.metrics.map((m) => {
      const values = rows.flatMap((r) =>
        r.metrics
          .filter((x) => x.label === m.label && x.unit === m.unit)
          .map((x) => ({ value: x.value, id: r.id })),
      );
      return {
        ...m,
        value: values.length
          ? m.method === "max"
            ? Math.max(...values.map((x) => x.value))
            : values.reduce((a, x) => a + x.value, 0)
          : null,
        source_ids: [...new Set(values.map((x) => x.id))],
      };
    }),
  ];
}
export function inspectRows(rows, templates) {
  const groups = new Map();
  for (const r of rows) {
    if (!r.date || r.duplicate_of) continue;
    const key = JSON.stringify([
      r.unit_id,
      r.date,
      r.title.normalize("NFC").replace(/\s+/g, "").toLowerCase(),
    ]);
    groups.set(key, [...(groups.get(key) || []), r.id]);
  }
  return rows.map((r) => {
    const t = matchTemplate(templates, r),
      missing = [];
    if (r.duplicate_of)
      missing.push("ยืนยันแล้วว่าซ้ำกับรายงาน #" + r.duplicate_of);
    if (!t) missing.push("แม่แบบสรุปผลสำหรับฝ่ายและประเภทงานนี้");
    if (t) {
      for (const f of t.config.required_fields)
        if (!String(r[f] || "").trim()) missing.push(fieldNames[f]);
      for (const m of t.config.metrics)
        if (
          m.required &&
          !r.metrics.some((x) => x.label === m.label && x.unit === m.unit)
        )
          missing.push(`${m.label} (${m.unit})`);
    }
    const key = JSON.stringify([
      r.unit_id,
      r.date,
      r.title.normalize("NFC").replace(/\s+/g, "").toLowerCase(),
    ]);
    const duplicates = (groups.get(key) || []).filter((id) => id !== r.id);
    return {
      ...r,
      template_id: t?.id || null,
      template_name: t?.name || null,
      missing,
      duplicate_ids: duplicates,
      eligible: r.status === "ready" && !r.duplicate_of && missing.length === 0,
      auto_include:
        r.status === "ready" && missing.length === 0 && duplicates.length === 0,
    };
  });
}
export const fingerprint = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
