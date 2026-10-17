const esc = (s) =>
  String(s ?? "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "")
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c],
    );
const value = (n) =>
  Number(n).toLocaleString("th-TH", { maximumFractionDigits: 6 });
export function reportDocument(r) {
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>body{font:16px/1.7 Tahoma,sans-serif;color:#183d2d;max-width:1050px;margin:32px auto;padding:20px}h1{font-size:24px}h2{font-size:19px;margin-top:28px}table{width:100%;border-collapse:collapse;color:#222}th,td{border:1px solid #bccfc3;padding:8px;text-align:left;vertical-align:top}th{background:#eaf1ec}small{color:#53685a}.print{background:#14543b;color:white;padding:12px;border:0;border-radius:8px}@media print{.print{display:none}body{margin:0;font-size:12px}tr{break-inside:avoid}thead{display:table-header-group}@page{size:A4 landscape;margin:15mm}}</style></head><body><p class="print">ใช้เมนูพิมพ์ของเบราว์เซอร์ (Ctrl/Cmd + P) แล้วเลือกบันทึกเป็น PDF</p><h1>สำนักสาธารณสุขและสิ่งแวดล้อม เทศบาลนครขอนแก่น</h1><h2>${esc(r.title)}</h2><p>ฉบับที่ ${r.id} · สร้างเมื่อ ${esc(r.generatedAt)}<br>ช่วงข้อมูล ${esc(r.period.from)} ถึง ${esc(r.period.to)}</p><p>กิจกรรมที่ยืนยัน ${value(r.ready)} กิจกรรม · รอยืนยัน ${value(r.pending)} รายการ · พื้นที่ที่รายงาน ${value(r.areaCount)} พื้นที่</p><small>${esc(r.note)}</small>${(r.sections || []).map((s) => `<h2>${esc(s.heading)}</h2><p>${esc(s.body)}</p><small>อ้างอิงรายงาน: ${s.activity_ids.map((id) => "#" + id).join(", ")}</small>`).join("")}<h2>ผลงานเชิงปริมาณ</h2><table><thead><tr><th>รายการ</th><th>ผล</th><th>หน่วย</th><th>วิธีรวม</th></tr></thead><tbody>${r.metrics.map((m) => `<tr><td>${esc(m.label)}</td><td>${value(m.value)}</td><td>${esc(m.unit)}</td><td>${esc(m.aggregation)}${m.note ? " · " + esc(m.note) : ""}</td></tr>`).join("")}</tbody></table><h2>รายการกิจกรรมและที่มาของผลรวม</h2><table><thead><tr><th>รหัส / ฉบับ</th><th>วันที่</th><th>กิจกรรม / โครงการ</th><th>หน่วยงาน / ผู้ส่ง</th><th>พื้นที่</th><th>ผลและสถานะ</th></tr></thead><tbody>${r.activities.map((a) => `<tr><td>#${a.id} / v${a.version}</td><td>${esc(a.date || "ยังไม่ระบุ")}</td><td>${esc(a.title)}<br>${esc(a.project_name || "")}</td><td>${esc(a.unit_name)}<br>${esc(a.owner_name)}</td><td>${esc(a.area)}</td><td>${esc(a.result)}<br>${a.status === "ready" ? "ยืนยันแล้ว" : "รอยืนยัน · ไม่รวมยอด"}</td></tr>`).join("")}</tbody></table><p><small>รายงานนี้เป็นสำเนาข้อมูล ณ เวลาสร้าง การแก้ไขข้อมูลภายหลังไม่เปลี่ยนฉบับย้อนหลัง ให้สร้างฉบับใหม่เมื่อข้อมูลเปลี่ยน</small></p></body></html>`;
}
function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zip(files) {
  let offset = 0;
  const local = [],
    central = [];
  for (const [name, content] of Object.entries(files)) {
    const n = Buffer.from(name),
      b = Buffer.from(content),
      crc = crc32(b),
      h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(b.length, 18);
    h.writeUInt32LE(b.length, 22);
    h.writeUInt16LE(n.length, 26);
    local.push(h, n, b);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(b.length, 20);
    c.writeUInt32LE(b.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += h.length + n.length + b.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
export function docxDocument(r) {
  const p = (s, bold = false) =>
    `<w:p><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/><w:lang w:val="th-TH" w:bidi="th-TH"/>${bold ? "<w:b/>" : ""}<w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${esc(s)}</w:t></w:r></w:p>`;
  const table = (rows) =>
    `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((x) => `<w:${x} w:val="single" w:sz="4" w:color="B6C8BB"/>`).join("")}</w:tblBorders></w:tblPr>${rows.map((row) => "<w:tr>" + row.map((cell) => '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>' + p(cell) + "</w:tc>").join("") + "</w:tr>").join("")}</w:tbl>`;
  const body =
    p("สำนักสาธารณสุขและสิ่งแวดล้อม เทศบาลนครขอนแก่น", true) +
    p(r.title, true) +
    p(`ฉบับที่ ${r.id} · สร้างเมื่อ ${r.generatedAt}`) +
    p(`กิจกรรมยืนยัน ${r.ready} กิจกรรม · รอยืนยัน ${r.pending} รายการ`) +
    p(r.note) +
    (r.sections || [])
      .map(
        (s) =>
          p(s.heading, true) +
          p(s.body) +
          p(
            "อ้างอิงรายงาน: " + s.activity_ids.map((id) => "#" + id).join(", "),
          ),
      )
      .join("") +
    p("ผลงานเชิงปริมาณ", true) +
    table([
      ["รายการ", "ผล", "หน่วย", "วิธีรวม"],
      ...r.metrics.map((m) => [m.label, value(m.value), m.unit, m.aggregation]),
    ]) +
    p("รายการกิจกรรม", true) +
    table([
      ["รหัส/ฉบับ", "วันที่", "กิจกรรม", "หน่วยงาน", "ผล / สถานะ"],
      ...r.activities.map((a) => [
        `#${a.id} / v${a.version}`,
        a.date || "ยังไม่ระบุ",
        a.title,
        a.unit_name,
        `${a.result} (${a.status === "ready" ? "ยืนยันแล้ว" : "รอยืนยัน ไม่รวมยอด"})`,
      ]),
    ]) +
    p(
      "ฉบับย้อนหลังเก็บตามข้อมูล ณ เวลาสร้าง หากมีการแก้ไขให้สร้างรายงานฉบับใหม่",
    );
  return zip({
    "[Content_Types].xml":
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850"/></w:sectPr></w:body></w:document>`,
  });
}
