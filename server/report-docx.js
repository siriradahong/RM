// Minimal OOXML package using only Node buffers. No external executable is needed on the server.
const xml = (s) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const parts = [],
    central = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = Buffer.from(name),
      b = Buffer.isBuffer(data) ? data : Buffer.from(data),
      crc = crc32(b),
      h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(33, 12);
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(b.length, 18);
    h.writeUInt32LE(b.length, 22);
    h.writeUInt16LE(n.length, 26);
    parts.push(h, n, b);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(b.length, 20);
    c.writeUInt32LE(b.length, 24);
    c.writeUInt16LE(n.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, n);
    offset += h.length + n.length + b.length;
  }
  const cd = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
const paragraph = (s, style = "Normal") =>
  `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(s)}</w:t></w:r></w:p>`;
const lines = (s) =>
  String(s)
    .split("\n")
    .map((x) => paragraph(x))
    .join("");
const localTime = (s) =>
  new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(s));
function table(headers, rows, widths) {
  return `<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders>${["top", "left", "bottom", "right", "insideH", "insideV"].map((x) => `<w:${x} w:val="single" w:sz="4" w:color="D6DFE5"/>`).join("")}</w:tblBorders><w:tblCellMar><w:top w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${[headers, ...rows].map((row, i) => `<w:tr>${i === 0 ? "<w:trPr><w:tblHeader/></w:trPr>" : ""}${row.map((v, j) => `<w:tc><w:tcPr><w:tcW w:w="${widths[j]}" w:type="dxa"/>${i === 0 ? '<w:shd w:fill="EDF2F5"/>' : ""}</w:tcPr>${paragraph(v, "TableText")}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
}
function imageSize(b, mime) {
  if (mime === "image/png") return [b.readUInt32BE(16), b.readUInt32BE(20)];
  for (let o = 2; o + 9 < b.length;) {
    if (b[o] !== 255) break;
    const marker = b[o + 1];
    if (marker === 217 || marker === 218) break;
    const size = b.readUInt16BE(o + 2);
    if ([192, 193, 194].includes(marker))
      return [b.readUInt16BE(o + 7), b.readUInt16BE(o + 5)];
    if (size < 2) break;
    o += 2 + size;
  }
  return [4, 3];
}
export function makeReportDocx(d) {
  const s = d.snapshot,
    files = {},
    relationships = [],
    heads = s.template.config.headings;
  let body =
    paragraph(d.title, "Title") +
    paragraph(`สำนักสาธารณสุขและสิ่งแวดล้อม เทศบาลนครขอนแก่น`) +
    paragraph(`ช่วงรายงาน ${s.range.from} ถึง ${s.range.to}`) +
    paragraph(
      `ผู้จัดทำ ${d.author_name}  ฉบับที่ ${d.id}  ยืนยัน ${localTime(d.confirmed_at)}`,
      "Caption",
    ) +
    paragraph(
      `ข้อมูล ณ ${localTime(s.cutoff_at)} (เวลาไทย)  แม่แบบ ${s.template.name} รุ่น ${s.template.version}`,
      "Caption",
    );
  body +=
    paragraph(heads.summary, "Heading1") +
    lines(d.narrative.summary) +
    paragraph("ตารางผลการดำเนินงาน", "Heading1") +
    table(
      ["ตัวชี้วัดและวิธีคำนวณ", "ผล", "หน่วย"],
      s.metrics.map((m) => [
        `${m.label} (${m.method === "count" ? "นับรหัสกิจกรรมไม่ซ้ำ" : m.method === "max" ? "ค่าสูงสุด" : "รวมค่า"})`,
        m.value ?? "ไม่มีข้อมูล",
        m.unit,
      ]),
      [5500, 1560, 2300],
    );
  body += paragraph(
    "ตัวเลขอ้างอิงเฉพาะรายงานที่เลือก จำนวนคนและรายเป็นยอดการรายงาน ไม่ใช่จำนวนบุคคลไม่ซ้ำ",
    "Caption",
  );
  if (s.template.config.include_trend)
    body +=
      paragraph("แนวโน้มกิจกรรมรายเดือน", "Heading1") +
      table(
        ["เดือน", "กิจกรรมที่ยืนยัน"],
        s.months.map((m) => [m.month, m.count]),
        [5500, 3860],
      );
  body +=
    paragraph(heads.problems, "Heading1") +
    lines(d.narrative.problems) +
    paragraph(heads.next_steps, "Heading1") +
    lines(d.narrative.next_steps);
  if (s.template.config.include_projects)
    body +=
      paragraph("รายงานตามโครงการ", "Heading1") +
      (s.projects.length
        ? table(
            ["โครงการ", "รายงานต้นทาง"],
            s.projects.map((p) => [p.title, `[${p.activity_id}]`]),
            [6500, 2860],
          )
        : paragraph("ไม่มีการเชื่อมโครงการในรายการที่เลือก"));
  body += paragraph("รายการข้อมูลอ้างอิง", "Heading1");
  for (const r of s.rows)
    body +=
      paragraph(`[${r.id}] ${r.title}`, "Heading2") +
      paragraph(`${r.date}  ${r.unit_name} / ${r.work_name || "ไม่ระบุงาน"}`) +
      paragraph(r.result) +
      paragraph(
        `ผู้บันทึก ${r.owner_name}  ผู้ปฏิบัติงาน ${r.workers || "ยังไม่ระบุ"}  รุ่นข้อมูล ${r.version}`,
        "Caption",
      );
  s.images.forEach((im, i) => {
    const bytes = Buffer.from(im.base64, "base64"),
      ext = im.mime === "image/png" ? "png" : "jpg",
      name = `image${i + 1}.${ext}`,
      rid = `image${i + 1}`;
    files["word/media/" + name] = bytes;
    relationships.push(
      `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`,
    );
    const [w, h] = imageSize(bytes, im.mime),
      scale = Math.min(5486400 / w, 3657600 / h),
      cx = Math.round(w * scale),
      cy = Math.round(h * scale);
    body +=
      paragraph(
        `หลักฐานจากรายงาน [${im.activity_id}] ${im.title}`,
        "Heading2",
      ) +
      `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${i + 1}" name="${name}" descr="${xml(im.title)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${i + 1}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  });
  body += paragraph(`รหัสตรวจสอบฉบับ ${d.content_hash}`, "Caption");
  files["word/document.xml"] =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1200" w:right="1440" w:bottom="1200" w:left="1440"/></w:sectPr></w:body></w:document>`;
  files["word/styles.xml"] =
    `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:eastAsia="Tahoma" w:cs="Tahoma"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:color w:val="000000"/><w:lang w:val="th-TH" w:bidi="th-TH"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>${[
      ["Normal", 24],
      ["Title", 36],
      ["Heading1", 28],
      ["Heading2", 24],
      ["Caption", 20],
      ["TableText", 22],
    ]
      .map(
        ([name, size]) =>
          `<w:style w:type="paragraph" w:styleId="${name}"><w:name w:val="${name}"/>${name !== "Normal" ? '<w:basedOn w:val="Normal"/>' : ""}<w:pPr>${["Title", "Heading1", "Heading2"].includes(name) ? '<w:keepNext/><w:spacing w:before="220" w:after="120"/>' : ""}</w:pPr><w:rPr><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${["Title", "Heading1", "Heading2"].includes(name) ? "<w:b/>" : ""}<w:color w:val="000000"/></w:rPr></w:style>`,
      )
      .join("")}</w:styles>`;
  files["[Content_Types].xml"] =
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
  files["_rels/.rels"] =
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';
  files["word/_rels/document.xml.rels"] =
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${relationships.join("")}</Relationships>`;
  return zip(files);
}

// Lightweight Word export for personal and scheduled summaries; all text is escaped.
export function makeTextDocx(title, sections) {
  const body =
    paragraph(title, "Title") +
    sections
      .map((s) => paragraph(s.heading, "Heading1") + lines(s.text))
      .join("");
  return zip({
    "[Content_Types].xml":
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    "_rels/.rels":
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="doc" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:spacing w:after="180"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/><w:sz w:val="24"/></w:rPr><w:t>สำนักสาธารณสุขและสิ่งแวดล้อม เทศบาลนครขอนแก่น</w:t></w:r></w:p>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:right="1440" w:bottom="1200" w:left="1440"/></w:sectPr></w:body></w:document>`,
  });
}
