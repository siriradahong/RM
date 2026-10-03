// Requires the Codex bundled @oai/artifact-tool runtime (authoring only).
// Link this directory's ignored node_modules to the bundled runtime modules,
// then run with the bundled Node executable. The finished XLSX has no runtime dependency.
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const output = path.dirname(fileURLToPath(import.meta.url));
const workbook = Workbook.create();
const sheet = workbook.worksheets.add('สรุปกิจกรรมสาธิต');
sheet.showGridLines = false;
sheet.tabColor = '#0c5176';
sheet.getRange('A1:F13').format.font = {name:'Arial',size:11,color:'#153b58'};
sheet.getRange('A1:F13').format.rowHeight = 30;
sheet.getRange('A1:F13').format.verticalAlignment = 'center';
sheet.getRange('A2').values = [['สรุปรายการกิจกรรมตัวอย่าง']];
sheet.getRange('A2').format.font = {name:'Arial',size:17,bold:true,color:'#0c5176'};
sheet.getRange('A3').values = [['ข้อมูลสาธิต ไม่ใช่ผลการปฏิบัติงานจริง • ตัวเลขและพื้นที่สมมติ']];
sheet.getRange('A3').format.font = {name:'Arial',size:11,color:'#9a642b'};
sheet.getRange('A5').values = [['ทั้งหมด (รายการ)']];
sheet.getRange('B5').formulas = [['=COUNTA(B9:B11)']];
sheet.getRange('C5').values = [['พร้อมสรุป (รายการ)']];
sheet.getRange('D5').formulas = [['=COUNTIFS(F9:F11,"พร้อมสรุป")']];
sheet.getRange('A5:F5').format.fill = '#eaf4f9';
sheet.getRange('A5:F5').format.font.bold = true;
sheet.getRange('B5').format.horizontalAlignment = 'left';
sheet.getRange('D5').format.horizontalAlignment = 'center';
sheet.getRange('A8:F11').values = [
 ['วันที่','ชื่อกิจกรรมสาธิต','ตัวชี้วัด','จำนวน','หน่วย','สถานะ'],
 [new Date('2026-10-02T00:00:00Z'),'กิจกรรมขยับกายและเรียนรู้การดูแลสุขภาพ','ผู้ร่วมกิจกรรม',120,'คน','พร้อมสรุป'],
 [new Date('2026-10-02T00:00:00Z'),'สำรวจสิ่งแวดล้อมในชุมชน','ครัวเรือนที่สำรวจ',80,'ครัวเรือน','พร้อมสรุป'],
 [new Date('2026-10-01T00:00:00Z'),'กิจกรรมคัดแยกวัสดุรีไซเคิล','วัสดุที่คัดแยก',240,'กิโลกรัม','พร้อมสรุป'],
 ];
sheet.getRange('A8:F8').format = {fill:'#0c5176',font:{name:'Arial',size:11,bold:true,color:'#ffffff'},horizontalAlignment:'center',rowHeight:32};
sheet.getRange('A9:A11').setNumberFormat('dd/mm/yyyy');
sheet.getRange('D9:D11').setNumberFormat('#,##0');
sheet.getRange('A9:F11').format.rowHeight = 44;
sheet.getRange('A9:F11').format.borders = {bottom:{style:'thin',color:'#d8e7ef'}};
sheet.getRange('A10:F10').format.fill = '#f1f7fa';
sheet.getRange('A13').values = [['แหล่งข้อมูล: ชุดตัวอย่าง RM DEMO ที่สร้างขึ้นเพื่อทดสอบการแนบและดาวน์โหลดไฟล์']];
sheet.getRange('A13').format.font = {name:'Arial',size:11,color:'#57778d'};
for (const [column,width] of Object.entries({A:150,B:390,C:200,D:90,E:120,F:150})) sheet.getRange(`${column}1:${column}13`).format.columnWidthPx = width;
sheet.getRange('D9:D11').format.horizontalAlignment = 'right';
sheet.getRange('A9:C11').format.horizontalAlignment = 'left';
sheet.getRange('F11').values = [['รอตรวจข้อมูล']];
workbook.recalculate();
if (sheet.getRange('D5').values[0][0] !== 2) throw new Error('Status count did not recalculate');
sheet.getRange('F11').values = [['พร้อมสรุป']];
workbook.recalculate();
if (sheet.getRange('B5').values[0][0] !== 3 || sheet.getRange('D5').values[0][0] !== 3) throw new Error('Unexpected demo totals');
const check = await workbook.inspect({kind:'table',range:'สรุปกิจกรรมสาธิต!A5:F11',include:'values,formulas',tableMaxRows:7,tableMaxCols:6});
console.log(check.ndjson);
const errors = await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:10},summary:'Final formula scan'});
console.log(errors.ndjson);
const preview = await workbook.render({sheetName:'สรุปกิจกรรมสาธิต',range:'A1:F13',scale:1.5,format:'png'});
await fs.writeFile(path.join(output,'.workbook-preview.png'),new Uint8Array(await preview.arrayBuffer()));
const xlsx = await SpreadsheetFile.exportXlsx(workbook);
await xlsx.save(path.join(output,'activity-summary.xlsx'));
console.log('Created activity-summary.xlsx with formula totals and fictional data.');
