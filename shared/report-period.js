const iso = (d) => d.toISOString().slice(0, 10);
const utc = (year, month, day = 1) => new Date(Date.UTC(year, month, day));
export const validDate = (s) =>
  typeof s === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  !Number.isNaN(Date.parse(s)) &&
  iso(new Date(s)) === s;
export function reportPeriod({ period = "month", anchor, from, to }) {
  if (!["month", "quarter", "year", "custom"].includes(period))
    throw new Error("ช่วงเวลาไม่ถูกต้อง");
  if (period === "custom") {
    if (!validDate(from) || !validDate(to) || from > to)
      throw new Error("กรุณาระบุวันเริ่มและวันสิ้นสุดให้ถูกต้อง");
    const days = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
    if (days > 366 * 5) throw new Error("เลือกช่วงเวลาได้ไม่เกิน 5 ปี");
    return {
      from,
      to,
      previous: {
        from: iso(new Date(Date.parse(from) - days * 86400000)),
        to: iso(new Date(Date.parse(from) - 86400000)),
      },
    };
  }
  if (!validDate(anchor)) throw new Error("กรุณาเลือกวันที่ในรอบรายงาน");
  const [y, m] = anchor.split("-").map(Number);
  const startMonth =
    period === "year"
      ? 9
      : period === "quarter"
        ? Math.floor((m - 1) / 3) * 3
        : m - 1;
  const startYear = period === "year" && m < 10 ? y - 1 : y;
  const length = period === "year" ? 12 : period === "quarter" ? 3 : 1;
  const start = utc(startYear, startMonth);
  return {
    from: iso(start),
    to: iso(utc(startYear, startMonth + length, 0)),
    previous: {
      from: iso(utc(startYear, startMonth - length)),
      to: iso(utc(startYear, startMonth, 0)),
    },
  };
}
export function periodLabel(period, from) {
  const [year, month] = from.split("-").map(Number);
  const fiscalYear = year + (month >= 10 ? 1 : 0) + 543;
  if (period === "year") return `ปีงบประมาณ ${fiscalYear}`;
  if (period === "quarter")
    return `ไตรมาส ${Math.floor(((month + 2) % 12) / 3) + 1} ปีงบประมาณ ${fiscalYear}`;
  return period === "month"
    ? new Date(from).toLocaleDateString("th-TH", {
        timeZone: "UTC",
        month: "long",
        year: "numeric",
      })
    : "ช่วงเวลาที่กำหนด";
}
export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[\s]*[=+\-@]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"', '""') + '"';
}
