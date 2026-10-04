// Thai shaping/layout uses Chromium. ReportLab generates footer overlays, merged
// with the searchable PDFs by pypdf. Requires Python reportlab + pypdf (PDF skill runtime).
import { chromium } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
const output = resolve("output/pdf"),
  scratch = resolve(process.env.RM_PDF_TMP || "/tmp/rm-submission-pdf");
await mkdir(output, { recursive: true });
await mkdir(scratch, { recursive: true });
const req = JSON.parse(
  await readFile("docs/submission/requirements.json", "utf8"),
);
const manifest = JSON.parse(
  await readFile("docs/submission/capture-manifest.json", "utf8"),
);
const regular = await readFile(
  "node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff2",
);
const bold = await readFile(
  "node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-700-normal.woff2",
);
const latin = await readFile(
  "node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-latin-400-normal.woff2",
);
const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const style = `@font-face{font-family:Thai;src:url(data:font/woff2;base64,${regular.toString("base64")});font-weight:400}@font-face{font-family:Thai;src:url(data:font/woff2;base64,${bold.toString("base64")});font-weight:700}@font-face{font-family:Latin;src:url(data:font/woff2;base64,${latin.toString("base64")})}*{box-sizing:border-box}body{margin:0;font-family:Thai,Latin,sans-serif;color:#19384e;background:#fff;font-size:12px;line-height:1.65}h1,h2,h3,p{margin:0}h1{font-size:29px;line-height:1.5;margin:14px 0 9px;color:#053f60}h2{font-size:18px;margin:18px 0 8px;color:#075e78}h3{font-size:14px;margin:12px 0 6px}p{margin:7px 0}small,.muted{color:#5e7484}.eyebrow{font-family:Latin,sans-serif;letter-spacing:2px;color:#0b7798;font-size:10px;font-weight:700}.top{border-bottom:2px solid #0b88b1;padding-bottom:10px;display:flex;justify-content:space-between;gap:20px;font-size:10px;color:#5e7484}.tag{background:#eaf6fb;border:1px solid #cfe6f0;border-radius:5px;padding:3px 10px;color:#075d7e;display:inline-block}.notice{background:#eef7fb;border-left:4px solid #1684aa;padding:11px 14px;margin:12px 0}.warn{background:#fff7e6;border-color:#d4a13c}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}table{border-collapse:collapse;width:100%;font-size:11px;margin:10px 0}th,td{padding:7px 9px;border:1px solid #d9e3ea;text-align:left;vertical-align:top}th{background:#eef4f8;color:#244e67;font-weight:700}tr{break-inside:avoid}ul,ol{margin:6px 0;padding-left:22px}li{margin:5px 0}.blank{border-bottom:1px solid #a6b5c1;min-height:28px;margin:6px 0}.box{display:inline-block;border:1px solid #587084;width:11px;height:11px;vertical-align:middle;margin:0 5px}.rates th:not(:first-child),.rates td:not(:first-child){width:28px;text-align:center;padding-left:4px;padding-right:4px}.rates td{padding-top:9px;padding-bottom:9px}.rates .box{margin:0}.page{position:relative;break-after:page;overflow:hidden}.page:last-child{break-after:auto}.portrait{font-size:14px}.portrait table{font-size:12.5px}.portrait .page:last-child{font-size:13px}.portrait .page:last-child table{font-size:12px}.portrait .rates td{padding-top:8px;padding-bottom:8px}.portrait .page{width:210mm;height:297mm;padding:16mm 16mm 20mm}.landscape .page{width:297mm;height:210mm;padding:12mm 14mm 17mm}.landscape h1{font-size:26px;margin:8px 0}.landscape h2{font-size:16px;margin:10px 0 5px}.landscape table{font-size:10.2px;line-height:1.5}.landscape th,.landscape td{padding:5px 8px}.lede{font-size:15px;line-height:1.7}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:17px 0}.stat{background:#eef7fb;border:1px solid #d3e9f2;border-radius:8px;padding:17px}.stat strong{font:700 38px/1.2 Latin,sans-serif;color:#056c96;display:block}.stat span{font-size:12px}.shot-layout{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,1fr);gap:20px;margin-top:13px;align-items:start}.shot{width:100%;max-height:525px;object-fit:contain;object-position:top;border:1px solid #dbe4ec;border-radius:6px}.caption{font-size:12px;line-height:1.75}.caption h2{font-size:15px}.mono{font-family:Latin,sans-serif;font-size:10px;overflow-wrap:anywhere}.mobile-pair{display:flex;justify-content:center;gap:28px;margin-top:12px}.mobile-pair img{height:520px;width:auto;border:1px solid #dbe4ec}.score{font-size:12px}.sign-lines{display:grid;grid-template-columns:1fr 1fr;gap:16px}.tiny{font-size:10px}.role-heading{background:#eaf5fa;padding:5px 9px;margin-top:10px;font-weight:700}@media print{body{background:white}}`;
const top = (label) =>
  `<div class="top"><span>RM - ระบบบูรณาการข้อมูลและสรุปผลการปฏิบัติงาน</span><span>${label} | 4 ต.ค. 2569</span></div>`;
const page = (label, body) =>
  `<section class="page">${top(label)}${body}</section>`;
const table = (headers, rows, cls = "") =>
  `<table class="${cls}"><thead><tr>${headers.map((x) => `<th>${x}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
const box = '<span class="box"></span>';
const lines = (n = 3) =>
  Array.from({ length: n }, () => '<div class="blank"></div>').join("");
const rating = (items) =>
  table(
    ["รายการประเมิน", "1", "2", "3", "4", "5", "N/A"],
    items.map((x) => [x, ...Array(6).fill(box)]),
    "rates",
  );
const scale =
  '<p class="tiny">ทำเครื่องหมาย 1 ช่องต่อข้อ: 1 = ไม่เห็นด้วยอย่างยิ่ง, 2 = ไม่เห็นด้วย, 3 = ปานกลาง, 4 = เห็นด้วย, 5 = เห็นด้วยอย่างยิ่ง, N/A = ไม่ได้ทดลอง/ไม่เกี่ยวข้อง</p>';
const roleCounts = [
  ["เจ้าหน้าที่ปฏิบัติงาน", "18", "ผู้รายงานและนำเข้าไฟล์จากหลายฝ่าย"],
  ["หัวหน้าฝ่าย", "5", "ผู้ตรวจข้อมูลตามขอบเขตที่ได้รับมอบหมาย"],
  ["ผู้บริหารสำนัก", "2", "ผู้ใช้ข้อมูลสรุปเพื่อดูภาพรวม"],
  ["ประชาสัมพันธ์", "3", "ผู้จัดทำข่าวจากรายงานต้นทาง"],
  ["ผู้ดูแลระบบ", "2", "ผู้จัดบัญชี โครงสร้าง และตรวจประวัติ"],
  ["รวมผู้ใช้ภายในทั่วไป", "30", "นับบุคคลไม่ซ้ำ แม้หนึ่งบัญชีมีหลายบทบาท"],
  [
    "ผู้เชี่ยวชาญเฉพาะด้านเพิ่มเติม",
    "1",
    "ผู้มีประสบการณ์งานรายงานสาธารณสุข/สิ่งแวดล้อมของหน่วยงาน",
  ],
  ["รวมผู้ประเมินตามแผน", "31", "ยังไม่ได้เก็บแบบประเมินจริง"],
];
const tasks = [
  ["T01", "ทุกบทบาท", "เข้าสู่ระบบและบอกหน้าเริ่มต้นของตน"],
  ["T02", "ทุกบทบาท", "ค้นรายงานกิจกรรมขยับกายฯ กรองฝ่ายและวันที่"],
  ["T03", "ทุกบทบาท", "เปิดรายงานและหลักฐาน ระบุผู้เข้าร่วม 120 คน"],
  ["T04", "ทุกบทบาท", "ดูแดชบอร์ด กดยอดไปยังรายการ อธิบายว่าไฟล์ไม่ใช่กิจกรรม"],
  ["T05", "ทุกบทบาท", "เปิดข่าวในฟีดและตรวจว่าข้อมูลตรงรายงานต้นทาง"],
  [
    "T06",
    "พนักงาน",
    "นำเข้า PDF และภาพ เลือกจัดข้อมูล กรอกชื่อเรื่องและบันทึก",
  ],
  ["T07", "พนักงาน", "ตรวจฝ่าย/งานประจำและแก้รายงานของตนให้ครบ"],
  ["T08", "หัวหน้าฝ่าย", "ตรวจรายงานในขอบเขตและเปลี่ยนรอตรวจเป็นพร้อมสรุป"],
  [
    "T09",
    "ประชาสัมพันธ์",
    "เลือกต้นทาง แก้ข่าว เลือกรูป Preview และยืนยันฟีดภายใน",
  ],
  ["T10", "แอดมิน", "เพิ่มบัญชีพนักงาน 1 ฝ่าย 1 งาน และกำหนดขอบเขตหัวหน้า"],
  ["T11", "แอดมิน", "เพิ่มประเภทงานในข้อมูลตั้งต้นแล้วตรวจว่ามีให้เลือก"],
  ["T12", "แอดมิน", "ค้นประวัติการแก้ไขบัญชีและอธิบายค่าเดิมเทียบค่าใหม่"],
];
let survey = [];
survey.push(
  page(
    "แผนและแบบประเมิน",
    `<span class="eyebrow">USER EVALUATION PLAN</span><h1>แบบประเมินการใช้งานระบบ RM</h1><p class="lede">สำนักสาธารณสุขและสิ่งแวดล้อม เทศบาลนครขอนแก่น</p><div class="notice"><b>แผนเก็บข้อมูล: ผู้ใช้ภายใน 30 คน + ผู้เชี่ยวชาญ 1 คน = 31 คน</b><br>เอกสารนี้เป็นแผนและแบบฟอร์มเปล่า ไม่ใช่ผลประเมินที่ดำเนินการแล้ว</div><h2>1. กลุ่มผู้ประเมินและจำนวนที่วางแผน</h2>${table(["กลุ่ม", "จำนวน (คน)", "หลักเกณฑ์คัดเลือก"], roleCounts)}<h2>2. วิธีคัดเลือกและจัดรอบทดสอบ</h2><ul><li>เลือกผู้ใช้ภายในที่มีหน้าที่ตรงกับระบบ กระจายฝ่าย อายุงาน และความคุ้นเคยกับคอมพิวเตอร์ ไม่ใช้ประชาชนหรือผู้ป่วยแทนผู้ใช้ระบบ</li><li>กำหนดบทบาทหลักให้แต่ละคนเพื่อไม่ให้นับซ้ำ; หากปรับสัดส่วน ต้องคงผู้ใช้ทั่วไปอย่างน้อย 30 คนและผู้เชี่ยวชาญเพิ่มเติมอย่างน้อย 1 คน</li><li>ผู้เชี่ยวชาญควรมีประสบการณ์ด้านรายงาน/สรุปผลสาธารณสุขหรือสิ่งแวดล้อม แยกจากผู้พัฒนา และอธิบายเหตุผลการคัดเลือกในรายงาน</li><li>ผู้ใช้ทั่วไปประมาณ 20-30 นาที/คน ผู้เชี่ยวชาญประมาณ 30-45 นาที ใช้ชุดข้อมูลสมมติเดียวกันและบันทึกอุปกรณ์ที่ใช้</li></ul><p class="tiny">แบบประเมินนี้ออกแบบเฉพาะโครงการ ไม่ใช่แบบวัดมาตรฐาน SUS หรือแบบสอบถามที่ผ่านการตรวจสอบความเที่ยงแล้ว</p>`,
  ),
);
survey.push(
  page(
    "แบบผู้ใช้ทั่วไป - ข้อมูลเบื้องต้น",
    `<h1>ข้อมูลผู้ประเมินและคำชี้แจง</h1><p>รหัสผู้ประเมิน U____ (U01-U30) วันที่ __________ เวลาเริ่ม ________</p><p>ผู้ดำเนินการ __________ รุ่นระบบ/Commit __________</p><h2>การเข้าร่วมโดยสมัครใจ</h2><p>การประเมินนี้ใช้ปรับปรุงต้นแบบระบบ ไม่ประเมินผลงานส่วนบุคคล สามารถข้ามคำถามหรือหยุดได้ ผู้ประเมินไม่ต้องระบุชื่อ เลขประจำตัว เบอร์โทร หรือข้อมูลผู้ป่วย ใช้รหัสแทนบุคคลในการรายงานผล</p><p>${box} ยินยอมร่วมทดสอบและให้ใช้คำตอบโดยไม่ระบุตัวตน ${box} ไม่ยินยอม (สิ้นสุดการประเมิน)</p><h2>ข้อมูลการใช้งาน</h2><p>บทบาทหลัก: ${box} พนักงาน ${box} หัวหน้าฝ่าย ${box} ผู้บริหาร<br>${box} ประชาสัมพันธ์ ${box} ผู้ดูแลระบบ</p><p>ฝ่าย/กลุ่มงาน (ระบุได้ตามสะดวก) __________________________________</p><p>ประสบการณ์ในงาน: ${box} น้อยกว่า 1 ปี ${box} 1-3 ปี ${box} มากกว่า 3 ปี</p><p>ความถี่ใช้คอมพิวเตอร์/ระบบงาน: ${box} ทุกวัน ${box} ทุกสัปดาห์ ${box} นาน ๆ ครั้ง</p><p>อุปกรณ์ทดสอบ: ${box} คอมพิวเตอร์ ${box} แท็บเล็ต ${box} โทรศัพท์<br>เบราว์เซอร์/ขนาดหน้าจอ __________________________</p><h2>ก่อนเริ่ม</h2><ol><li>ผู้ดำเนินการเตรียมบัญชีเฉพาะบทบาทและข้อมูลสาธิต ห้ามใช้รหัสผ่านของบัญชีจริงในการบันทึกผล</li><li>อธิบายเป้าหมายภายใน 3 นาที แล้วให้ผู้ใช้ทำงานด้วยตนเอง หากช่วยเหลือให้บันทึกว่าช่วยเรื่องใด</li><li>ทุกคนทำ T01-T05 และทำงานเฉพาะบทบาทของตนจากหน้า 3 ผู้บริหารทำเฉพาะงานอ่านข้อมูล ไม่ต้องทดสอบการแก้รายงาน</li><li>ทำแบบสอบถามหน้าที่ 4-5 หลังทดลองเสร็จ ให้ตอบตามสิ่งที่ได้ลองจริง</li></ol><div class="notice warn"><b>ขอบเขตต้นแบบในการประเมิน</b><br>AI ยังไม่เชื่อมบริการ และ LINE ยังไม่มีการรับ-ส่งจริง ห้ามให้ผู้ใช้ให้คะแนนความแม่นยำ AI หรืออ้างว่า LINE ส่งสำเร็จ ข้อที่ไม่ได้ทดลองให้เลือก N/A และบันทึกเหตุผล</div>`,
  ),
);
survey.push(
  page(
    "บันทึกการทดลองทำงาน",
    `<h1>บันทึกภารกิจตามบทบาท</h1><p>รหัสผู้ประเมิน U____ บทบาทหลัก __________________</p><p class="tiny">ผล: S = สำเร็จด้วยตนเอง, H = สำเร็จโดยมีผู้ช่วย, F = ไม่สำเร็จ, N/A = ไม่อยู่ในบทบาท/ไม่ได้ทดสอบ เวลาเป็นวินาที ผู้ดำเนินการกรอกตามที่สังเกตจริง</p>${table(
      ["รหัส", "ผู้ทำ", "ภารกิจ/ผลที่คาด", "ผล", "เวลา", "ครั้งที่ช่วย"],
      tasks.map(([a, b, c]) => [a, b, c, "_____", "_____", "_____"]),
    )}<h2>บันทึกสิ่งที่ติดขัด</h2><p>รหัสภารกิจ ______ ขั้นตอน/ปุ่มที่ติดขัด __________________________</p>${lines(2)}<p>คำพูดหรือข้อสังเกตของผู้ประเมิน (ไม่ระบุชื่อบุคคล)</p>${lines(2)}<div class="notice">T06-T12 ใช้บัญชีและฐานข้อมูลสำหรับประเมินโดยเฉพาะ การเปลี่ยนสิทธิ์หรือเผยแพร่ข่าวทำในชุดข้อมูลสาธิตเท่านั้น ไม่ส่งข้อความไป LINE จริง</div>`,
  ),
);
survey.push(
  page(
    "แบบผู้ใช้ทั่วไป - ความคิดเห็น",
    `<h1>ประเมินหลังทดลองใช้งาน</h1><p>รหัสผู้ประเมิน U____ โปรดตอบเฉพาะสิ่งที่ได้ทดลอง</p>${scale}${rating(
      [
        "Q01 ฉันเข้าใจชื่อเมนูและเลือกหน้าที่ต้องการได้",
        "Q02 ฉันทำขั้นตอนหลักได้โดยไม่สับสนว่าจะกดปุ่มใดต่อ",
        "Q03 ข้อความแจ้งผลหรือข้อผิดพลาดช่วยให้ฉันทำต่อได้",
        "Q04 ขั้นตอนในระบบสอดคล้องกับหน้าที่ที่ฉันได้รับ",
        "Q05 ช่องข้อมูลและตัวเลือกเหมาะกับการรายงานของหน่วยงาน",
        "Q06 ฉันค้นรายการงานหรือเอกสารย้อนหลังได้สะดวก",
        "Q07 ฉันแยกจำนวนกิจกรรมออกจากจำนวนไฟล์/ข้อความได้",
        "Q08 ฉันอ่านตัวเลขและหน่วยนับในแดชบอร์ดได้ชัดเจน",
        "Q09 ฉันย้อนจากข้อมูลสรุปไปตรวจหลักฐานได้",
        "Q10 ฉันเข้าใจว่าข้อมูลใดอ่านได้และข้อมูลใดแก้ไขได้",
        "Q11 ระบบแสดงฝ่าย งาน และบทบาทของฉันได้ชัดเจน",
        "Q12 ฉันแยกข้อมูลสาธิตและสถานะยังไม่เชื่อมบริการได้",
        "Q13 ตัวอักษร สี และการจัดวางอ่านง่ายบนอุปกรณ์ที่ใช้",
        "Q14 ปุ่มและช่องกรอกมีขนาดเหมาะสมกับการใช้งาน",
        "Q15 ฉันมองเห็นผลการบันทึก/การเปลี่ยนสถานะได้ชัดเจน",
      ],
    )}<p class="tiny">แบ่งมิติ: Q01-Q03 ความเข้าใจ, Q04-Q06 ความเหมาะสมกับงาน, Q07-Q09 การใช้ข้อมูล, Q10-Q12 สิทธิ์และสถานะ, Q13-Q15 หน้าจอและการตอบกลับ</p>`,
  ),
);
survey.push(
  page(
    "แบบผู้ใช้ทั่วไป - เฉพาะบทบาท",
    `<h1>คำถามเฉพาะบทบาทและข้อเสนอแนะ</h1><p>รหัสผู้ประเมิน U____ ตอบเฉพาะ 2 ข้อของบทบาทหลักที่ได้รับ</p>${scale}${rating(
      [
        "พนักงาน P01: เลือกวัตถุประสงค์การนำเข้าและส่งชื่อเรื่องต่อได้เข้าใจง่าย",
        "พนักงาน P02: ตรวจฝ่าย/งานประจำ แก้รายงาน และแนบหลักฐานได้สะดวก",
        "หัวหน้า H01: ระบุได้ว่ารายงานใดอยู่ในขอบเขตที่ฉันแก้ไขได้",
        "หัวหน้า H02: ตรวจหลักฐานและเปลี่ยนสถานะพร้อมสรุปได้ชัดเจน",
        "ผู้บริหาร E01: ตัวเลขภาพรวมและรายฝ่ายช่วยให้ฉันเข้าใจงานที่รายงานแล้ว",
        "ผู้บริหาร E02: ฉันย้อนดูที่มาของยอดสรุปได้โดยไม่ต้องแก้ข้อมูล",
        "ประชาสัมพันธ์ PR01: เลือกต้นทาง แก้ข้อความและภาพข่าวได้สะดวก",
        "ประชาสัมพันธ์ PR02: Preview และสถานะเผยแพร่เว็บ/LINE แยกกันชัดเจน",
        "แอดมิน A01: กำหนดบทบาท ฝ่าย/งาน และขอบเขตหัวหน้าได้ไม่ซ้ำซ้อน",
        "แอดมิน A02: ค้นประวัติและเปรียบเทียบค่าเดิม/ค่าใหม่ได้เข้าใจง่าย",
      ],
    )}<h2>ข้อเสนอแนะ</h2><p>1. ขั้นตอนใดมีประโยชน์กับงานของท่านมากที่สุด เพราะอะไร</p>${lines(1)}<p>2. ขั้นตอนใดสับสนหรือควรแก้ไขก่อนใช้งานจริง</p>${lines(1)}<p>3. สิ่งที่ยังขาดและตัวอย่างเหตุการณ์ที่ต้องการให้ระบบรองรับ</p>${lines(1)}<p>พร้อมร่วมทดสอบรอบถัดไป: ${box} พร้อม ${box} ยังไม่พร้อม (ไม่ต้องระบุช่องทางติดต่อในแบบนี้)</p>`,
  ),
);
survey.push(
  page(
    "แบบผู้เชี่ยวชาญเฉพาะด้าน",
    `<h1>ตรวจความเหมาะสมด้านงานรายงาน</h1><p>รหัสผู้เชี่ยวชาญ X01 วันที่ __________ ประสบการณ์ในงาน ____ ปี</p><p>ตำแหน่ง/ลักษณะงานโดยไม่ระบุชื่อ ______________________________</p><p>เหตุผลที่เหมาะสมเป็นผู้เชี่ยวชาญ __________________________________</p><p>${box} ยินยอมประเมินโดยสมัครใจ และไม่เป็นผู้พัฒนาระบบชุดนี้</p><p>โปรดทดลองด้วยหลักฐานชุดเดียวกับผู้ใช้ ตรวจความถูกต้องตามบริบทหน่วยงาน พร้อมระบุหลักฐานประกอบข้อที่เห็นว่าควรแก้ไข</p>${scale}${rating(
      [
        "X01 ชื่อข้อมูล ฝ่าย กลุ่มงาน และงานตรงกับโครงสร้างหน่วยงาน",
        "X02 แยกผู้รายงาน/ผู้นำเข้าออกจากผู้ปฏิบัติงานได้เหมาะสม",
        "X03 หนึ่งกิจกรรมที่มีหลายหลักฐานไม่ถูกนับซ้ำเป็นหลายกิจกรรม",
        "X04 รายการรอตรวจและไฟล์ฝากเก็บไม่ถูกรวมเป็นกิจกรรมพร้อมสรุป",
        "X05 การรวมผลรักษาชื่อผลและหน่วยนับ ไม่รวมคน ตัน และครั้งเข้าด้วยกัน",
        "X06 สิทธิ์พนักงาน หัวหน้า ผู้บริหาร PR และแอดมินตรงหน้าที่",
        "X07 ข่าวต้องตรวจและยืนยันก่อนเผยแพร่ และไม่แก้รายงานต้นทาง",
        "X08 ตรวจย้อนจากข่าว/แดชบอร์ดถึงรายงานและหลักฐานได้",
        "X09 ประวัติการแก้ไขช่วยระบุผู้แก้ เวลา และสิ่งที่เปลี่ยน",
        "X10 ระบุข้อจำกัดของ AI/LINE และข้อมูลสาธิตอย่างไม่ทำให้เข้าใจผิด",
      ],
    )}<p>ประเด็นสำคัญที่ต้องแก้ (รหัส X__ / หน้าจอ / ตัวอย่าง)</p>${lines(2)}<p>ความเห็นโดยรวม: ${box} เหมาะสมสำหรับรอบทดสอบผู้ใช้ ${box} ควรแก้ก่อนทดสอบต่อ</p>`,
  ),
);
survey.push(
  page(
    "สำหรับผู้ดำเนินการ - สรุปผล",
    `<h1>วิธีวิเคราะห์และสรุปผลจริง</h1><div class="notice warn">เว้นช่องผลไว้จนกว่าจะประเมินจริง ห้ามนำผลทดสอบอัตโนมัติหรือข้อมูลสาธิตมาแทนความคิดเห็นผู้ใช้งาน 31 คน</div><h2>1. ตรวจจำนวนและคุณภาพข้อมูล</h2>${table(
      ["รายการ", "ตามแผน", "ผลจริง"],
      [
        ["ผู้ใช้ภายในไม่ซ้ำคน", "30", "_____ คน"],
        ["ผู้เชี่ยวชาญเฉพาะด้านเพิ่มเติม", "1", "_____ คน"],
        ["แบบตอบครบและยินยอม", "ตรวจเป็นรายฉบับ", "_____ ฉบับ"],
        ["ไม่ยินยอม/ถอนตัว/ข้อมูลไม่ครบ", "รายงานเหตุผล", "_____ คน"],
      ],
    )}<h2>2. คำนวณผลโดยไม่รวม N/A เป็นศูนย์</h2><ul><li>คะแนนรายข้อ = ผลรวมคะแนน 1-5 ÷ จำนวนผู้ตอบที่ใช้ได้ของข้อนั้น รายงานจำนวนผู้ตอบ (n) ควบคู่ทุกข้อ</li><li>คะแนนรายมิติ Q01-Q15 = ค่าเฉลี่ยข้อที่เกี่ยวข้องจากผู้ใช้ทั่วไป แสดงการกระจายคะแนนและข้อคิดเห็น ไม่รวมคะแนนผู้เชี่ยวชาญเข้ากับผู้ใช้ 30 คน</li><li>คำถามเฉพาะบทบาทวิเคราะห์แยกตามบทบาท ระบุจำนวนคนของแต่ละกลุ่ม หลีกเลี่ยงสรุปแทนผู้ใช้ทั้งหมดจากกลุ่มที่มีคนจำนวนน้อย</li><li>อัตราสำเร็จด้วยตนเอง = จำนวนภารกิจ S ÷ จำนวนภารกิจที่ได้มอบหมายและทดลองจริง × 100 รายงาน H/F แยก; ตัด N/A ออกพร้อมเหตุผล</li><li>รายงานค่ามัธยฐานเวลา/ภารกิจและจำนวนครั้งช่วยเหลือ พร้อมปัญหาที่สังเกต ไม่เปรียบเทียบเวลาเส้นทางคนละบทบาทโดยตรง</li></ul><h2>3. เกณฑ์ปรับปรุงที่เสนอสำหรับโครงการ</h2><p>เสนอเป้าหมายภายใน: สำเร็จด้วยตนเองอย่างน้อย 80% และคะแนนเฉลี่ยรายมิติอย่างน้อย 4 จาก 5 หากพบการเข้าถึงหรือแก้ข้อมูลผิดสิทธิ์ให้แก้ก่อนใช้งานจริง เกณฑ์นี้เป็นข้อเสนอของโครงการ ต้องตกลงกับอาจารย์/หน่วยงาน ไม่ใช่เกณฑ์มาตรฐานสากล</p>${table(
      ["ปัญหา/หลักฐาน", "ความสำคัญ", "สิ่งที่จะแก้", "ผู้รับผิดชอบ/รอบทดสอบ"],
      Array.from({ length: 3 }, () => [
        "________________",
        "________",
        "________________",
        "________________",
      ]),
    )}<p>ผลสรุปหลังเก็บข้อมูลจริง _________________________________________</p>${lines(1)}<p class="tiny">เก็บแบบตอบในพื้นที่ที่ผู้ดำเนินการเข้าถึงเท่านั้น ใช้รหัส U/X แทนชื่อ และรายงานข้อมูลรวมตามระยะเวลาเก็บรักษาที่ตกลงกับผู้ประเมิน</p>`,
  ),
);
const full = req.filter((r) => r[3] === "ครบ").length,
  partial = req.filter((r) => r[3] === "บางส่วน").length,
  missing = req.length - full - partial;
let evidence = [];
evidence.push(
  page(
    "ตรวจความพร้อมส่งงาน",
    `<span class="eyebrow">PROTOTYPE REVIEW & SCREEN EVIDENCE</span><h1>ตรวจความพร้อมตามเกณฑ์งานออกแบบหน้าจอ</h1><p class="lede">ระบบ RM - ใช้งานผ่าน Node.js API, React/Vite และ SQLite<br>ประเมินจาก requirement เดิม 12 หน้าจอ และข้อแก้ไขของเจ้าของโครงการ</p><div class="stats"><div class="stat"><strong>${full}/${req.length}</strong><span>ฟังก์ชันหลักที่ทำได้ตาม checklist</span></div><div class="stat"><strong>${((full / req.length) * 100).toFixed(1)}%</strong><span>นับเฉพาะข้อครบ; บางส่วนไม่นับคะแนน</span></div><div class="stat"><strong>4</strong><span>Flow หลักที่คลิกทำงานและตรวจผล</span></div></div><div class="notice"><b>ในเชิงฟังก์ชันหลัก: เกินเกณฑ์ 50% ตาม checklist ภายในชุดนี้</b><br>นี่เป็นการประเมินแบบให้น้ำหนักเท่ากัน ${req.length} กลุ่มฟังก์ชัน ไม่ใช่เปอร์เซ็นต์ความเสร็จทั้งโครงการหรือการรับรองคะแนนจากอาจารย์</div>${table(
      ["เกณฑ์งาน", "สิ่งที่มีในชุดนี้", "สิ่งที่ยังต้องทำ"],
      [
        [
          "Prototype คลิกทำงานอย่างน้อย 50%",
          "ภาพและผลตรวจ Flow A-D พร้อมหน้าจอหลัก S01-S12",
          "ส่วน AI และบริการ LINE จริงยังไม่ครบ",
        ],
        [
          "Capture เชื่อมโยงการวิเคราะห์",
          "รหัสหน้าจอ บทบาท ขั้นตอน API และข้อมูลที่เกี่ยวข้อง",
          "ยังไม่พบ Diagram ต้นฉบับ จึงยังยืนยันความตรงกันทั้งหมดไม่ได้",
        ],
        [
          "แบบประเมิน PDF และจำนวนคน",
          "ไฟล์แบบประเมินเปล่า 7 หน้า; แผนผู้ใช้ 30 + ผู้เชี่ยวชาญ 1",
          "ต้องดำเนินการประเมินจริงและสรุปผลภายหลัง",
        ],
      ],
    )}<p class="tiny">ตรวจจาก commit ${manifest.sourceCommit.slice(0, 7)} | GitHub: https://github.com/siriradahong/RM<br>ภาพทั้งหมดมาจากเว็บที่รันจริงด้วยฐานข้อมูลชั่วคราว ใช้ข้อมูลสมมติ ไม่มีการส่ง LINE หรือแก้ฐานข้อมูลจริงของผู้ใช้</p>`,
  ),
);
for (let i = 0; i < 2; i++)
  evidence.push(
    page(
      "รายการตรวจ requirement",
      `<h1>Checklist ฟังก์ชันหลัก (${i + 1}/2)</h1><p>ครบ = ทำได้ตามกลุ่มฟังก์ชันที่ระบุ, บางส่วน = ยังขาดส่วนของ requirement, ยังไม่มี = ยังไม่รองรับใน UI/บริการปัจจุบัน</p>${table(
        ["รหัส", "ฟังก์ชันหลัก", "หน้าจอ", "ผล", "หลักฐาน/ข้อจำกัด"],
        req.slice(i * 16, (i + 1) * 16).map((r) => r.map(esc)),
      )}<p class="tiny">ผลรวม: ครบ ${full} ข้อ, บางส่วน ${partial} ข้อ, ยังไม่มี ${missing} ข้อ - อ่านขอบเขตของแต่ละข้อก่อนตีความเปอร์เซ็นต์</p>`,
    ),
  );
evidence.push(
  page(
    "ตารางเชื่อมการวิเคราะห์กับหน้าจอ",
    `<h1>ความสัมพันธ์ Use Case - Activity - Sequence - UI</h1><div class="notice warn">UC-A ถึง UC-D เป็นรหัสอ้างอิงชั่วคราวของเอกสารชุดนี้ ยังไม่ใช่รหัสจาก Diagram ที่ส่งอาจารย์ ต้องนำไปจับคู่กับเอกสารวิเคราะห์ฉบับจริงก่อนส่ง</div>${table(
      [
        "Use Case / Actor",
        "Activity และทางแยก",
        "Sequence ที่ตรวจจาก API",
        "หน้าจอ/ข้อมูล",
      ],
      [
        [
          "UC-A นำเข้าและจัดรายงาน<br>พนักงาน + หัวหน้าตามสิทธิ์",
          "เลือกไฟล์ → เลือกฝาก/จัดข้อมูล → กรอกชื่อเรื่อง → ตรวจข้อมูล → pending/ready<br>ข้อมูลไม่ครบ: อยู่ pending",
          "Browser → POST /api/files → ตรวจสิทธิ์/ชนิดไฟล์ → SQLite + uploads<br>Browser → POST/PUT /api/activities → audit → ผลบันทึก",
          "S06 → S07 → S02<br>files.activity_id → activities.id; unit_id/work_id จากบัญชี",
        ],
        [
          "UC-B ตรวจที่มาของข้อมูลสรุป<br>ผู้ใช้ภายในทุกบทบาท",
          "เลือกช่วงเวลา/ฝ่าย → กดยอด → เปิดรายงาน → เปิดหลักฐาน<br>อ่านได้ แต่แก้ตามสิทธิ์",
          "GET /api/dashboard → aggregate ready<br>GET /api/activities → GET /:id<br>GET /api/files/:id/content",
          "S03/S04 → S05 → S07<br>นับกิจกรรมแยกไฟล์และหน่วยนับ",
        ],
        [
          "UC-C จัดทำและเผยแพร่ข่าว<br>ประชาสัมพันธ์",
          "เลือกต้นทาง → แก้ข่าว/ภาพ → บันทึกร่าง → Preview → ยืนยัน → ฟีด<br>LINE แยกสถานะและยังไม่ส่ง",
          "GET /api/activities → POST/PUT /api/news<br>POST /api/news/:id/publish → news + audit<br>GET /api/news?feed=1",
          "S09 → S10 → S08<br>news.activity_id → activities.id; image_ids → files.id",
        ],
        [
          "UC-D จัดบัญชีและตรวจประวัติ<br>ผู้ดูแลระบบ",
          "เลือกบัญชี → บทบาท → ฝ่าย/งาน หรือขอบเขตหัวหน้า → บันทึก → เปิดประวัติ",
          "GET /api/admin/users → PUT /:id → validation → users + audits + ยกเลิก session<br>GET /api/admin/audits",
          "S11 → S12<br>users.unit_id/work_id/scopes; before_json/after_json",
        ],
      ],
    )}<h2>ตัวอย่างข้อมูลเดียวกันที่ตามรอยได้</h2><p>รายงาน #${manifest.activity.id} → ไฟล์หลักฐาน 2 ไฟล์ → เปลี่ยน pending เป็น ready → ข่าว #${manifest.news.id} → ฟีดภายใน<br>ผู้เข้าร่วม 120 คน / อาสาสมัคร 15 คน / จุดจัดกิจกรรม 3 แห่ง; นับเป็น 1 กิจกรรม ไม่ใช่ 2 กิจกรรมตามจำนวนไฟล์</p>`,
  ),
);
const shots = [
  [
    "01-login",
    "S01 - เข้าสู่ระบบ",
    "ผู้ใช้ภายในทุกบทบาท",
    "UC ร่วม: ยืนยันบัญชีและเปิดหน้าตามบทบาท",
    "POST /api/auth/login → session → หน้าเริ่มต้น",
    "ไม่ใช้การสลับบทบาทเอง; ปุ่มเข้าสู่ระบบเชื่อม API จริง",
  ],
  [
    "02-dashboard-mine",
    "S02 - ข้อมูลที่ฉันนำเข้า",
    "เจ้าหน้าที่ปฏิบัติงาน",
    "UC-A: หลังบันทึกและหัวหน้าตรวจข้อมูล",
    "GET /api/dashboard?mine=1",
    "ข้อมูลของผู้นำเข้าไม่เท่ากับผลงานส่วนบุคคลทั้งหมด; ยอดคำนวณจากฐานข้อมูล",
  ],
  [
    "03-dashboard-unit",
    "S03 - แดชบอร์ดหน่วยงาน",
    "หัวหน้าฝ่าย",
    "UC-B: เลือกฝ่ายส่งเสริมสุขภาพ",
    "GET /api/dashboard?unit=1",
    "กิจกรรมพร้อมสรุปและรายการรอตรวจแยกกัน; กดการ์ดเพื่อดูที่มาของยอด",
  ],
  [
    "04-dashboard-overview",
    "S04 - ภาพรวมสำนัก",
    "ผู้บริหารสำนัก",
    "UC-B: ดูภาพรวมช่วง ก.ย.-ต.ค. 2569",
    "GET /api/dashboard?from=2026-09-01",
    "แยกชื่อผลและหน่วยนับ; ไม่มี KPI/เปอร์เซ็นต์สำเร็จเทียบแผน",
  ],
  [
    "05a-library",
    "S05 - คลังรายการงาน",
    "หัวหน้าฝ่าย",
    "UC-B: คลิกมาจากยอดแดชบอร์ด",
    "GET /api/activities?unit=1&status=ready",
    "เงื่อนไขฝ่ายและสถานะตามยอดที่กด; เปิดรายงานเดียวกับข่าวที่ใช้สาธิต",
  ],
  [
    "06c-import-review",
    "S06 - ตรวจรายละเอียดก่อนนำเข้า",
    "เจ้าหน้าที่ปฏิบัติงาน",
    "UC-A: เลือก 2 ไฟล์ → จัดข้อมูล → กรอกชื่อเรื่อง",
    "POST /api/files (multipart)",
    "ฝ่ายและงานอ่านจากบัญชี; ชื่อเรื่องส่งต่อหน้ารายงาน ภาพขั้น 1-2 อยู่ในโฟลเดอร์ screenshots",
  ],
  [
    "07b-report-ready",
    "S07 - รายละเอียดและหลักฐาน",
    "หัวหน้าฝ่าย",
    "UC-A/UC-B: ตรวจข้อมูลและเปลี่ยนพร้อมสรุป",
    "PUT /api/activities/" + manifest.activity.id,
    "รายงาน #" +
      manifest.activity.id +
      " มี 2 ไฟล์ ผู้รายงานแยกจากผู้ปฏิบัติงาน; ตัวเลขตรงกับเอกสารหลักฐาน",
  ],
  [
    "07c-report-readonly",
    "S07 - ตัวอย่างสิทธิ์อ่านอย่างเดียว",
    "ผู้บริหารสำนัก",
    "UC-B: เปิดรายงานเดียวกันจากอีกบทบาท",
    "GET /api/activities/" + manifest.activity.id,
    "ระบบไม่แสดงปุ่มบันทึกให้ผู้บริหาร; API ตรวจสิทธิ์ซ้ำ",
  ],
  [
    "09-news-manager",
    "S09 - จัดการข่าวประชาสัมพันธ์",
    "เจ้าหน้าที่ประชาสัมพันธ์",
    "UC-C: เลือกรายงานพร้อมสรุป",
    "GET /api/activities?status=ready",
    "ตอนนี้ใช้เจ้าหน้าที่เลือกต้นทาง ยังไม่มี AI เสนอข่าว",
  ],
  [
    "10a-news-edit",
    "S10 - ตรวจแก้ข่าวและเลือกภาพ",
    "เจ้าหน้าที่ประชาสัมพันธ์",
    "UC-C: แก้ข่าวที่แยกจากรายงานต้นทาง",
    "POST/PUT /api/news",
    "อ้างอิงรายงาน #" +
      manifest.activity.id +
      "; รูปมาจากไฟล์หลักฐาน ไม่แก้ข้อความต้นทาง",
  ],
  [
    "10b-news-preview",
    "S10 - Preview ก่อนเผยแพร่",
    "เจ้าหน้าที่ประชาสัมพันธ์",
    "UC-C: ตรวจเนื้อหาและยืนยันเผยแพร่",
    "POST /api/news/" + manifest.news.id + "/publish",
    "การยืนยันบนหน้าจอทำให้ข่าวปรากฏในฟีดภายใน; ไม่มีการเผยแพร่อัตโนมัติ",
  ],
  [
    "08-feed",
    "S08 - ฟีดข่าวภายใน",
    "ผู้บริหาร/ผู้ใช้ภายใน",
    "UC-C: ดูผลหลัง PR ยืนยัน",
    "GET /api/news?feed=1",
    "ข่าว #" +
      manifest.news.id +
      " อ้างอิงรายงานเดียวกัน; ต้องเข้าสู่ระบบจึงอ่านได้",
  ],
  [
    "11a-admin-users",
    "S11 - ผู้ใช้งานและสิทธิ์",
    "ผู้ดูแลระบบ",
    "UC-D: ตรวจบัญชี ฝ่าย งาน บทบาทและสถานะ",
    "GET /api/admin/users",
    "เมนูดูแลระบบ 3 แท็บ; พนักงาน 1 ฝ่าย 1 งาน หัวหน้าเลือกขอบเขตหนึ่งจุด",
  ],
  [
    "11b-admin-master",
    "S11 - หน่วยงานและหมวดข้อมูล",
    "ผู้ดูแลระบบ",
    "UC-D: ส่วน → ฝ่าย/กลุ่มงาน → งาน",
    "POST/PUT /api/admin/units, works, categories",
    "โครงสร้างตามผังล่าสุด: 2 ส่วน 8 ฝ่าย 1 กลุ่มงาน และ 30 งานตั้งต้น",
  ],
  [
    "11c-admin-line",
    "S11 - การเชื่อมต่อ LINE",
    "ผู้ดูแลระบบ",
    "ตรวจสถานะช่องทางและกลุ่ม",
    "GET /api/admin/line",
    "ยังไม่ตั้งค่าบริการจริง; อ่าน Group ID และเวลาล่าสุด แก้ค่าผ่าน .env ไม่เผยรหัสลับ",
  ],
  [
    "12b-audit-diff",
    "S12 - ประวัติการแก้ไขข้อมูล",
    "ผู้ดูแลระบบ",
    "UC-D: หลังแก้ชื่อบัญชีในชุดทดสอบ",
    "GET /api/admin/audits?entity=user",
    "แสดงค่าเดิม/ค่าใหม่จริงที่เกิดจากการบันทึก เป็นข้อมูลอ่านอย่างเดียว",
  ],
];
for (const [id, title, actor, activity, sequence, note] of shots) {
  const b = await readFile("docs/submission/screenshots/" + id + ".png");
  evidence.push(
    page(
      "หลักฐานจากหน้าจอจริง",
      `<h1>${esc(title)}</h1><div class="shot-layout"><img class="shot" src="data:image/png;base64,${b.toString("base64")}"><aside class="caption"><span class="tag">${esc(id)}</span><h2>บทบาท</h2><p>${esc(actor)}</p><h2>ขั้นตอนการทำงาน</h2><p>${esc(activity)}</p><h2>การเรียกข้อมูล</h2><p class="mono">${esc(sequence)}</p><h2>สิ่งที่พิสูจน์/ขอบเขต</h2><p>${esc(note)}</p></aside></div>`,
    ),
  );
}
const m1 = await readFile(
    "docs/submission/screenshots/M01-mobile-dashboard.png",
  ),
  m2 = await readFile("docs/submission/screenshots/M02-mobile-audit.png");
evidence.push(
  page(
    "หลักฐานหน้าจอมือถือ",
    `<h1>หน้าจอ 390 px - ภาพรวมและประวัติการแก้ไข</h1><p>ชุดข้อมูลเดียวกับหน้าคอมพิวเตอร์ เมนูย่อบนมือถือและค่าเดิม/ค่าใหม่เรียงให้อ่านได้ครบ</p><div class="mobile-pair"><img src="data:image/png;base64,${m1.toString("base64")}"><img src="data:image/png;base64,${m2.toString("base64")}"></div>`,
  ),
);
evidence.push(
  page(
    "สิ่งที่ต้องตรวจต่อก่อนส่ง",
    `<h1>รายการคงค้างและวิธีใช้ชุดหลักฐาน</h1><div class="grid"><div><h2>ต้องทำก่อนส่งเอกสารให้ครบ</h2><ol><li>นำ Diagram ต้นฉบับมาแทนรหัส UC ชั่วคราว ตรวจ Actor, ทางแยก, ข้อมูลเข้า/ออก และข้อความใน Sequence ให้ตรงกับ API จริง</li><li>แนบแบบประเมินผู้ใช้ PDF และระบุ 31 คนเป็นจำนวนตามแผน หากอาจารย์ต้องการผลประเมินด้วย ต้องเก็บข้อมูลจริงก่อนสรุปผล</li><li>ระบุเวอร์ชันโปรแกรมและวันที่ Capture พร้อมคำบรรยายแต่ละภาพ ไม่ใช้ภาพอย่างเดียวโดยไม่อธิบายความสัมพันธ์</li></ol><h2>แหล่งหลักฐาน</h2><p>requirement เดิมที่เจ้าของโครงการให้ + ข้อแก้ไขล่าสุด<br>README.md, docs/API.md, src/main.jsx, server/*<br>docs/submission/capture-manifest.json<br>docs/submission/requirements.json</p></div><div><h2>ส่วนที่ไม่ควรอ้างว่าทำครบแล้ว</h2><ul><li>AI สกัดข้อมูลและ AI เสนอข่าวยังไม่เชื่อมบริการ</li><li>รับไฟล์/ข้อความและส่งข่าว LINE จริงยังไม่ทดสอบกับ channel/group จริง</li><li>ตัวเลือกประเภทงานบนแดชบอร์ดและตารางสรุปเทียบรายหน่วยงานยังมีช่องว่างจาก requirement เดิม</li><li>ตัวอย่างเฉพาะ 3 ข้อความ 10 รูป และยอดจำลอง 240 กิจกรรมจากข้อกำหนดเดิมไม่ใช่ชุดข้อมูลในรอบนี้</li></ul><div class="notice">งานรอบนี้ประเมินและจัดหลักฐาน ไม่ได้เปลี่ยนระบบให้ AI/LINE ทำงานจริง และไม่ได้สร้างผลแบบสอบถามแทนผู้ใช้งาน</div></div></div><p class="tiny">ไฟล์ภาพ PNG แยกใน docs/submission/screenshots เปิดขยายได้ รายงานนี้ย่อภาพเพื่ออธิบายเส้นทางและการเชื่อมโยงข้อมูล</p>`,
  ),
);
const browser = await chromium.launch({
  headless: true,
  executablePath:
    process.env.CHROME_PATH ||
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const outputs = [
  ["rm-user-evaluation", "portrait", survey],
  ["rm-prototype-evidence", "landscape", evidence],
];
try {
  for (const [name, mode, pages] of outputs) {
    const p = await browser.newPage();
    const html = `<!doctype html><html lang="th"><meta charset="UTF-8"><title>${name}</title><style>${style}@page{size:A4 ${mode};margin:0}</style><body class="${mode}">${pages.join("")}</body></html>`;
    await writeFile(join(scratch, name + ".html"), html);
    await p.setContent(html, { waitUntil: "networkidle" });
    await p.evaluate(() => document.fonts.ready);
    const overflow = await p
      .locator(".page")
      .evaluateAll((nodes) =>
        nodes
          .map((node, i) => ({
            page: i + 1,
            overflow: Math.max(
              node.scrollHeight - node.clientHeight,
              Math.max(
                ...[...node.children].map(
                  (child) => child.getBoundingClientRect().bottom,
                ),
              ) -
                (node.getBoundingClientRect().bottom -
                  parseFloat(getComputedStyle(node).paddingBottom)),
            ),
          }))
          .filter((v) => v.overflow > 2),
      );
    if (overflow.length)
      throw Error(name + " page overflow " + JSON.stringify(overflow));
    await p.pdf({
      path: join(scratch, name + ".pdf"),
      printBackground: true,
      preferCSSPageSize: true,
    });
    await p.close();
  }
} finally {
  await browser.close();
}
const py = `from reportlab.pdfgen import canvas\nfrom pypdf import PdfReader,PdfWriter\nfrom io import BytesIO\nimport sys,os\nscratch,out=sys.argv[1:]\nfor name in ['rm-user-evaluation','rm-prototype-evidence']:\n reader=PdfReader(os.path.join(scratch,name+'.pdf')); writer=PdfWriter()\n for i,page in enumerate(reader.pages):\n  w,h=float(page.mediabox.width),float(page.mediabox.height)\n  buf=BytesIO(); c=canvas.Canvas(buf,pagesize=(w,h))\n  c.setStrokeColorRGB(.83,.88,.91);c.line(40,28,w-40,28)\n  c.setFillColorRGB(.36,.46,.53);c.setFont('Helvetica',8)\n  c.drawString(40,17,'RM | '+('USER EVALUATION - BLANK FORM' if name=='rm-user-evaluation' else 'PROTOTYPE EVIDENCE - DEMONSTRATION DATA'))\n  c.drawRightString(w-40,17,str(i+1)+' / '+str(len(reader.pages)))\n  c.save();buf.seek(0);page.merge_page(PdfReader(buf).pages[0]);writer.add_page(page)\n writer.add_metadata({'/Title':name,'/Author':'RM Project','/Subject':'Project submission materials - 2026-10-04'})\n with open(os.path.join(out,name+'.pdf'),'wb') as f:writer.write(f)\n print(name,len(reader.pages),'pages')\n`;
await writeFile(join(scratch, "finalize.py"), py);
execFileSync(
  process.env.PDF_PYTHON || "python3",
  [join(scratch, "finalize.py"), scratch, output],
  { stdio: "inherit" },
);
const summary = {
  full,
  partial,
  missing,
  total: req.length,
  coverage: Number(((full / req.length) * 100).toFixed(1)),
  evaluationPlan: {
    generalUsers: 30,
    domainExperts: 1,
    total: 31,
    actualResponses: null,
  },
  diagramsVerified: false,
};
await writeFile(
  "docs/submission/assessment-summary.json",
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(JSON.stringify(summary));
