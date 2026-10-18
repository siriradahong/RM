// Conservative masking of common direct identifiers. PR still reviews the complete text and every image.
const patterns = [
  /(?<!\d)\d(?:[ -]?\d){12}(?!\d)/g,
  /(?<!\d)(?:0[689](?:[ -]?\d){8}|0[2-7](?:[ -]?\d){7})(?!\d)/g,
  /(?:ผู้ป่วย|คนไข้|ผู้รับบริการ)\s*(?:ชื่อ\s*)?(?:นาย|นางสาว|นาง|เด็กชาย|เด็กหญิง)\s*[ก-๙]+(?:\s+[ก-๙]+)?/g,
];
export function redactForNews(text) {
  let value = String(text || "");
  for (const p of patterns) value = value.replace(p, "[ปิดข้อมูลส่วนบุคคล]");
  return value;
}
export function hasDirectIdentifiers(text) {
  return redactForNews(text) !== text;
}
