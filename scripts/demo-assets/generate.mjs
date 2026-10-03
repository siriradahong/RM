// Regenerate the bundled fictional evidence assets with installed Chrome.
// Usage: node scripts/demo-assets/generate.mjs
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const output = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(output, '../..');
await mkdir(output, { recursive: true });
const font = await readFile(path.join(root, 'node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff2'));
const bold = await readFile(path.join(root, 'node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-700-normal.woff2'));
const styles = `
@font-face { font-family: Thai; src:url(data:font/woff2;base64,${font.toString('base64')}) }
@font-face { font-family: Thai; font-weight:700; src:url(data:font/woff2;base64,${bold.toString('base64')}) }
* { box-sizing:border-box } body { margin:0; font-family:Thai,Arial,sans-serif; color:#153b58; background:#f1f7fa }
.card { width:1200px; height:675px; padding:48px 60px; background:linear-gradient(135deg,#f8fcff,#e8f4fc); position:relative; overflow:hidden }
.top { position:relative; z-index:1; display:flex; justify-content:space-between; align-items:center; font-size:18px; color:#436b86 }
.badge { padding:8px 17px; border:1px solid #b6dced; border-radius:30px; background:white; font-weight:700; color:#05618c }
h1 { font-size:48px; letter-spacing:-1px; line-height:1.4; margin:40px 0 12px; position:relative }
.subtitle { font-size:22px; color:#507289; line-height:1.5; margin:0; max-width:790px }
.metrics { display:flex; gap:20px; margin-top:38px }
.metric { flex:1; border:1px solid #d0e5f0; border-radius:16px; background:#ffffffd9; padding:24px 28px }
.value { font:700 64px/1 Arial,sans-serif; color:#087db0; margin-bottom:16px }.label { font-size:23px }
.footer { position:absolute; bottom:35px; left:60px; right:60px; border-top:1px solid #c9e1ef; padding-top:20px; font-size:17px; color:#54778e }
.circle { position:absolute; width:300px; height:300px; right:-230px; top:55px; border:50px solid #d4eefa; border-radius:50% }
.green { background:linear-gradient(135deg,#fbfdf9,#eaf5e8) }.green .value { color:#267941 }.green .badge {color:#277340;border-color:#bfd8c6}.green .circle {border-color:#d8ead8}
.orange { background:linear-gradient(135deg,#fffdfa,#fff1e4) }.orange .value{color:#b1651c}.orange .badge{color:#9d5a1c;border-color:#e4cbb3}.orange .circle {border-color:#f8e4ce}
.document { width:794px; min-height:1122px; background:white; padding:52px 60px; position:relative; color:#193b53; font-size:14px; line-height:1.65 }
.document .top {font-size:12px}.document .badge {padding:4px 12px}.document h1 {font-size:28px; margin-top:30px; letter-spacing:0; line-height:1.5}
.document h2 {font-size:18px;margin:22px 0 10px}.document .subtitle {font-size:16px;max-width:none}
.notice {background:#eef7fc; border-left:4px solid #1686b1; padding:12px 18px; margin:22px 0; font-size:14px}
.info {display:grid;grid-template-columns:140px 1fr; gap:8px 12px; padding:18px 0; border-top:1px solid #d9e6ef; border-bottom:1px solid #d9e6ef }
.info b {color:#527387;font-weight:400}
table {width:100%;border-collapse:collapse;margin-top:12px;font-size:13px} th {background:#0c5176;color:white;font-weight:700;text-align:left;padding:12px} td {padding:10px;border-bottom:1px solid #dce7ee;vertical-align:top} tr:nth-child(odd) td {background:#f7fafc}
.document .footer {left:60px;right:60px;bottom:36px;font-size:11px} .sign {margin-top:20px;color:#537184;font-size:14px} .document ul {padding-left:22px} .document li {margin:6px 0}
@page {size:A4;margin:0} @media print {body {background:white}.document {width:210mm;height:297mm;min-height:0} }
`;
const html = (body) => `<!doctype html><html lang="th"><meta charset="utf-8"><title>ข้อมูลสาธิต RM</title><style>${styles}</style><body>${body}</body></html>`;
const commonTop = '<div class="top"><span>ระบบบูรณาการข้อมูลและสรุปผลการปฏิบัติงาน</span><span class="badge">ข้อมูลสาธิต</span></div>';
const disclaimer = 'ตัวเลขและสถานที่สมมติสำหรับทดลองระบบ ไม่ใช่ผลการปฏิบัติงานจริง';
const cards = [
  ['health-outreach', '', 'กิจกรรมส่งเสริมสุขภาพชุมชน', 'ตัวอย่างการสรุปกิจกรรมจากหลักฐาน สู่รายงานและข่าวภายใน', [['120','คนร่วมกิจกรรม'],['15','อาสาสมัคร'],['3','จุดกิจกรรม']]],
  ['dengue-survey', 'orange', 'สำรวจสิ่งแวดล้อมในชุมชน', 'ตัวอย่างรายงานการสำรวจและบันทึกจุดติดตามของฝ่ายป้องกันและควบคุมโรค', [['80','ครัวเรือนที่สำรวจ'],['12','จุดที่บันทึก'],['1','ชุมชนสาธิต']]],
  ['waste-sorting', 'green', 'กิจกรรมคัดแยกวัสดุรีไซเคิล', 'ตัวอย่างการบันทึกผู้เข้าร่วมและปริมาณวัสดุของฝ่ายส่งเสริมสิ่งแวดล้อม', [['75','คนร่วมกิจกรรม'],['240','กิโลกรัมวัสดุ'],['3','กลุ่มวัสดุ']]],
];
const docs = [
 ['health-report', `<section class="document">${commonTop}<h1>รายงานกิจกรรมขยับกายและเรียนรู้การดูแลสุขภาพ</h1><p class="subtitle">ตัวอย่างเอกสารหลักฐานสำหรับแนบรายการงาน</p><div class="notice">ข้อมูลสาธิตเท่านั้น ไม่ใช่ผลการปฏิบัติงานจริง<br>ไม่มีข้อมูลผู้ป่วยหรือข้อมูลส่วนบุคคลจริงในเอกสารนี้</div><div class="info"><b>วันที่</b><span>2 ตุลาคม 2569</span><b>ฝ่าย</b><span>ฝ่ายส่งเสริมสุขภาพ</span><b>งาน</b><span>งานสาธารณสุขชุมชน</span><b>พื้นที่</b><span>ศูนย์กิจกรรมชุมชนสาธิต A</span><b>ผู้ปฏิบัติงาน</b><span>ทีมเจ้าหน้าที่สาธิตสุขภาพและอาสาสมัครสาธิต</span></div><h2>รายละเอียดกิจกรรม</h2><p>จำลองกิจกรรมให้ความรู้และแลกเปลี่ยนความคิดเห็นเรื่องสุขภาพในชุมชน<br>ผู้ปฏิบัติงานรวบรวมจำนวนผู้เข้าร่วมและสรุปผลสำหรับส่งต่อให้หัวหน้าฝ่ายตรวจข้อมูล</p><table><thead><tr><th>รายการที่บันทึก</th><th>จำนวน</th><th>หน่วย</th></tr></thead><tbody><tr><td>ผู้ร่วมกิจกรรม</td><td>120</td><td>คน</td></tr><tr><td>อาสาสมัคร</td><td>15</td><td>คน</td></tr><tr><td>จุดกิจกรรม</td><td>3</td><td>จุด</td></tr></tbody></table><h2>ผลสรุปสำหรับสาธิต</h2><p>บันทึกข้อมูลกิจกรรมและตัวชี้วัดครบ พร้อมแนบเอกสารประกอบ<br>สามารถใช้รายการนี้ทดลองดูแดชบอร์ด กรองรายงาน และสร้างข่าวภายใน</p><div class="sign">ผู้จัดทำ: บัญชีสาธิตฝ่ายส่งเสริมสุขภาพ<br>สถานะเอกสาร: ตัวอย่างประกอบการทดลองระบบ</div><div class="footer">RM DEMO • ${disclaimer} <span style="float:right">1 / 1</span></div></section>`],
 ['sanitation-checklist', `<section class="document">${commonTop}<h1>แบบบันทึกตรวจข้อมูลสุขาภิบาล</h1><p class="subtitle">ตัวอย่างรายการตรวจความครบถ้วนของหลักฐาน</p><div class="notice">ข้อมูลสาธิตเท่านั้น ไม่ใช่ผลการตรวจสถานประกอบการจริง<br>รายการนี้แสดงการแนบไฟล์และตรวจข้อมูลในระบบ</div><div class="info"><b>วันที่</b><span>1 ตุลาคม 2569</span><b>ฝ่าย</b><span>ฝ่ายส่งเสริมสาธารณสุข</span><b>งาน</b><span>งานสุขาภิบาลอาหาร</span><b>พื้นที่</b><span>ตลาดชุมชนสาธิต B</span></div><h2>รายการตรวจเอกสาร</h2><table><thead><tr><th>รายการ</th><th>สถานะตัวอย่าง</th></tr></thead><tbody><tr><td>ชื่อเรื่องและวันที่ปฏิบัติงาน</td><td>ครบ</td></tr><tr><td>ฝ่ายและงานของเจ้าหน้าที่</td><td>ครบ</td></tr><tr><td>พื้นที่และชื่อทีมผู้ปฏิบัติงาน</td><td>ครบ</td></tr><tr><td>สรุปจำนวนจุดที่บันทึก</td><td>12 จุด</td></tr><tr><td>เอกสารแนบประกอบรายงาน</td><td>ครบ</td></tr><tr><td>รายละเอียดผลการดำเนินงาน</td><td>รอเพิ่มรายละเอียด</td></tr></tbody></table><h2>บันทึกเพื่อทดลองขั้นตอนการทำงาน</h2><ul><li>บันทึกรายการเป็น “รอตรวจข้อมูล”</li><li>ให้เจ้าหน้าที่เพิ่มรายละเอียดผลการดำเนินงาน</li><li>ให้หัวหน้าฝ่ายตรวจและเปลี่ยนเป็น “พร้อมสรุป” เมื่อข้อมูลครบ</li></ul><div class="sign">ผู้บันทึก: บัญชีสาธิตงานสุขาภิบาลอาหาร<br>เอกสารนี้ไม่มีผลรับรองด้านสุขาภิบาล</div><div class="footer">RM DEMO • ${disclaimer} <span style="float:right">1 / 1</span></div></section>`],
];
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
try {
 const page = await browser.newPage({viewport:{width:1200,height:675},deviceScaleFactor:1});
 for (const [name,theme,title,subtitle,metrics] of cards) {
  await page.setContent(html(`<section class="card ${theme}"><div class="circle"></div>${commonTop}<h1>${title}</h1><p class="subtitle">${subtitle}</p><div class="metrics">${metrics.map(([value,label])=>`<div class="metric"><div class="value">${value}</div><div class="label">${label}</div></div>`).join('')}</div><div class="footer">${disclaimer}</div></section>`));
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:path.join(output,`${name}.png`)});
 }
 for (const [name,body] of docs) {
  await page.setContent(html(body));
  await page.evaluate(()=>document.fonts.ready);
  await page.pdf({path:path.join(output,`${name}.pdf`),format:'A4',printBackground:true,preferCSSPageSize:true});
 }
} finally { await browser.close(); }
console.log('Created three PNG cards and two PDF evidence documents. All content is fictional.');
