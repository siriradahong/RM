import { validDate } from "../shared/report-period.js";
const months = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
];
const escape = (s) =>
  [...s].map((c) => (".*+?^${}()|[]\\".includes(c) ? "\\" + c : c)).join("");
const digits = (s) =>
  s.replace(/[๐-๙]/g, (c) => String(c.charCodeAt(0) - 3664));
export function suggestFields(
  input,
  { categories = [], units = [], metrics = [] } = {},
) {
  const text = digits(input)
      .normalize("NFC")
      .replace(/[ \t]*\|[ \t]*/g, " "),
    fields = {},
    evidence = {},
    warnings = [];
  const set = (key, value, quote) => {
    if (value) {
      fields[key] = value;
      evidence[key] = quote;
    }
  };
  const labeled = (labels) =>
    text.match(
      new RegExp(`(?:^|\\n)\\s*(?:${labels})\\s*[:：]\\s*([^\\n]+)`, "u"),
    );
  for (const [key, labels] of Object.entries({
    title: "ชื่อกิจกรรม|ชื่อเรื่อง|เรื่อง",
    area: "สถานที่|พื้นที่",
    workers: "ผู้ปฏิบัติงาน|เจ้าหน้าที่ผู้ปฏิบัติงาน",
    result: "ผลการดำเนินงาน|ผลการปฏิบัติงาน",
  })) {
    const m = labeled(labels);
    if (m)
      set(
        key,
        m[1]
          .trim()
          .slice(
            0,
            key === "title"
              ? 300
              : key === "area"
                ? 300
                : key === "workers"
                  ? 2000
                  : 10000,
          ),
        m[0].trim(),
      );
  }
  const candidates = new Map();
  const collect = (year, month, day, quote, endDay) => {
    if (year >= 2400) year -= 543;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (validDate(date)) candidates.set(date, quote);
    if (endDay)
      warnings.push(
        `ต้นฉบับระบุช่วงวันที่ ${quote} ใช้วันเริ่มกิจกรรมในการจัดรอบ กรุณาตรวจช่วงเวลาในรายละเอียดด้วย`,
      );
  };
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g))
    collect(+m[1], +m[2], +m[3], m[0]);
  for (const m of text.matchAll(
    new RegExp(
      `(?:วันที่\\s*)?(\\d{1,2})(?:\\s*[-–]\\s*(\\d{1,2}))?\\s+(${months.join("|")})\\s+(?:พ\\.?ศ\\.?\\s*)?(\\d{4})`,
      "gu",
    ),
  ))
    collect(+m[4], months.indexOf(m[3]) + 1, +m[1], m[0], m[2]);
  for (const m of text.matchAll(
    /(?:วันที่\s*[:：]?\s*)?(\d{1,2})\/(\d{1,2})\/(\d{4})/g,
  ))
    collect(+m[3], +m[2], +m[1], m[0]);
  if (candidates.size === 1) {
    const [date, quote] = [...candidates][0];
    set("date", date, quote);
  } else if (candidates.size > 1)
    warnings.push("พบหลายวันที่ในต้นฉบับ กรุณายืนยันวันที่กิจกรรมก่อนรวมยอด");
  const category = categories.filter((c) => c.active && text.includes(c.name));
  if (category.length === 1)
    set("category_id", category[0].id, category[0].name);
  else if (!category.length) {
    const meeting = categories.find(
      (c) => c.active && /ประชุม.*อบรม/.test(c.name),
    );
    const term = text.match(/ประชุม|อบรม/);
    if (meeting && term) set("category_id", meeting.id, term[0]);
  }
  const foundUnits = units.filter(
    (u) => u.kind !== "section" && text.includes(u.name),
  );
  if (foundUnits.length)
    warnings.push(
      `ต้นฉบับกล่าวถึง ${foundUnits.map((u) => u.name).join(" และ ")} ให้ตรวจฝ่ายเจ้าของงานกับสังกัดผู้ส่ง`,
    );
  const defs = [
    ...metrics,
    { label: "ผู้เข้าร่วม", unit: "คน" },
    { label: "ผู้รับบริการ", unit: "ราย" },
    { label: "คนพิการ", unit: "ราย" },
    { label: "เที่ยวเก็บขยะ", unit: "เที่ยว" },
    { label: "ปริมาณขยะ", unit: "ตัน" },
  ];
  const seen = new Set(),
    results = [];
  for (const d of defs) {
    const key = d.label + "|" + d.unit;
    if (seen.has(key)) continue;
    seen.add(key);
    const re = new RegExp(
      `${escape(d.label)}\\s*(?:จำนวน|รวม|ทั้งหมด)?\\s*[:：]?\\s*([\\d,]+(?:\\.\\d+)?)\\s*${escape(d.unit)}(?=$|[\\s.,ฯ)\\n])`,
      "gu",
    );
    const matches = [...text.matchAll(re)];
    if (matches.length === 1) {
      const value = Number(matches[0][1].replaceAll(",", ""));
      if (Number.isFinite(value) && value <= 1e12)
        results.push({
          label: d.label,
          unit: d.unit,
          value,
          quote: matches[0][0],
        });
    } else if (matches.length > 1)
      warnings.push(
        `พบ ${d.label} (${d.unit}) หลายค่า ให้ตรวจแยกกิจกรรมก่อนรวมยอด`,
      );
  }
  if (results.length) {
    fields.metrics = results.slice(0, 20).map(({ quote, ...m }) => m);
    evidence.metrics = results.map((m) => m.quote).join("\n");
    if (!fields.result)
      set("result", results.map((m) => m.quote).join("\n"), evidence.metrics);
  }
  return {
    fields,
    evidence,
    warnings,
    method: "local_rules",
    note: "ข้อเสนอจากข้อความจริง ยังไม่ได้ยืนยัน ไม่เดาจำนวนจากภาพถ่าย",
  };
}
