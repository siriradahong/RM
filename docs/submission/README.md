> ชุดส่งงานด้านล่างเป็นหลักฐานรุ่น 4 ต.ค. สำหรับขอบเขต/สิทธิ์และหน้าจอล่าสุดตาม PDF ระยะ 1–3 ให้ใช้ [บันทึกฉบับ 18 ต.ค.](../SCOPE-IMPLEMENTATION.md) เปอร์เซ็นต์ checklist เดิมไม่ใช่ผลตรวจขอบเขตใหม่

# ชุดตรวจความพร้อมและหลักฐานส่งงาน RM

ตรวจวันที่ 4 ตุลาคม 2569 จากโค้ดแอปพลิเคชัน commit 1272553

## ไฟล์ส่งงาน

- [แบบประเมินผู้ใช้งาน PDF](../../output/pdf/rm-user-evaluation.pdf): แบบฟอร์มเปล่า 7 หน้า วางแผนผู้ใช้ภายในทั่วไป 30 คนและผู้เชี่ยวชาญงานรายงานสาธารณสุข/สิ่งแวดล้อมเพิ่มเติม 1 คน รวม 31 คน ยังไม่มีการเก็บคำตอบจริง
- [รายงานตรวจ Prototype และภาพหน้าจอ PDF](../../output/pdf/rm-prototype-evidence.pdf): ผลตรวจ requirement ตารางเชื่อม Use Case/Activity/Sequence กับหน้าจอ และคำบรรยายภาพ
- [Checklist 32 กลุ่มฟังก์ชัน](requirements.json): ครบ 23 ข้อ บางส่วน 6 ข้อ ยังไม่มี 3 ข้อ นับข้อครบแบบน้ำหนักเท่ากันได้ 71.9% เป็นการประเมินภายในตามรายการที่แจกแจง ไม่ใช่คะแนนรับรองจากอาจารย์หรือเปอร์เซ็นต์ความเสร็จทั้งโครงการ
- [หลักฐานการเก็บภาพ](capture-manifest.json): 26 ภาพและผลตรวจ Flow A-D รวมถึงรายงาน #19 เชื่อมข่าว #7 ในฐานข้อมูลชั่วคราว

## สิ่งที่ยังต้องทำ

ยังไม่พบ Use Case, Activity Diagram และ Sequence Diagram ต้นฉบับในโปรเจกต์ รหัส UC-A ถึง UC-D ในรายงานเป็นรหัสชั่วคราว ต้องจับคู่กับ Diagram ที่ใช้ส่งอาจารย์ก่อนยืนยันว่าตรงกันทุกขั้นตอน ข้อความลำดับ API ในรายงานเป็นตารางอธิบาย ไม่ใช่ไฟล์ Diagram ที่ใช้แทนงานวิเคราะห์เดิม

AI สกัดข้อมูล/เสนอข่าวยังไม่เชื่อมบริการ LINE รับ-ส่งจริงยังไม่ตั้งค่า/พิสูจน์กับบริการจริง ตัวกรองประเภทบนแดชบอร์ดและตารางสรุปเทียบหน่วยงานยังมีช่องว่างตาม checklist ส่วนตัวอย่าง 3 ข้อความ 10 รูปและยอดจำลอง 240 กิจกรรมจาก requirement เดิมไม่ใช่ข้อมูลในชุดภาพนี้

แบบประเมินระบุจำนวนตามแผน ต้องจัดการทดสอบกับบุคคลจริง หากอาจารย์ต้องการผลด้วยให้สรุปหลังเก็บคำตอบเท่านั้น ควรยืนยันคุณสมบัติผู้เชี่ยวชาญและจำนวนผู้ใช้ตามเกณฑ์อาจารย์

## วิธีสร้างหลักฐานซ้ำ

1. รัน npm run build แล้ว node scripts/capture-submission.mjs (ใช้ Chrome หรือกำหนด CHROME_PATH)
2. รัน PDF_PYTHON=python3 node scripts/build-submission.mjs โดย Python ต้องมี reportlab และ pypdf
3. เปิด PDF และตรวจทุกหน้าอีกครั้ง หาก source เปลี่ยนควรเก็บภาพใหม่ทั้งชุด

สคริปต์ Capture สร้างและลบฐานข้อมูลชั่วคราว ใช้ข้อมูลสมมติ ทำการบันทึกผ่าน UI จริง ไม่แตะข้อมูลใน data/ และไม่ติดต่อ LINE ไม่มีบัญชีหรือรหัสผ่านจริงอยู่ในชุดส่งงาน ส่วนเลขรายงาน/ข่าวในภาพเป็นเลขของฐานข้อมูลชั่วคราว ไม่จำเป็นต้องตรงกับ localhost ของผู้ใช้

ระหว่างตรวจพบคำขอข้อมูลที่ถูกยกเลิกอาจทำให้แดชบอร์ดว่าง แก้ใน src/api.js และ useResource แล้ว ทดสอบอัตโนมัติผ่าน 33 ข้อและ Capture Flow A-D ผ่านครบ

## ภาพแยกเพื่อใช้ประกอบรายงาน

| ภาพ                                                            | หน้าจอ    | เนื้อหา                                    | Flow         |
| -------------------------------------------------------------- | --------- | ------------------------------------------ | ------------ |
| [01-login](screenshots/01-login.png)                           | S01       | เข้าสู่ระบบ                                | ร่วมทุก Flow |
| [06a-import-files](screenshots/06a-import-files.png)           | S06       | เลือกไฟล์หลักฐานสองไฟล์                    | A            |
| [06b-import-purpose](screenshots/06b-import-purpose.png)       | S06       | เลือกวัตถุประสงค์การนำเข้า                 | A            |
| [06c-import-review](screenshots/06c-import-review.png)         | S06       | ชื่อเรื่องและสังกัดก่อนนำเข้า              | A            |
| [07a-report-edit](screenshots/07a-report-edit.png)             | S07       | ตรวจข้อมูลและหลักฐาน                       | A            |
| [02-dashboard-mine](screenshots/02-dashboard-mine.png)         | S02       | ข้อมูลที่ฉันนำเข้า หลังบันทึกและตรวจข้อมูล | A            |
| [03-dashboard-unit](screenshots/03-dashboard-unit.png)         | S03       | แดชบอร์ดฝ่ายส่งเสริมสุขภาพ                 | B            |
| [05a-library](screenshots/05a-library.png)                     | S05       | รายการที่มาของยอดสรุป                      | B            |
| [07b-report-ready](screenshots/07b-report-ready.png)           | S07       | รายงานพร้อมสรุปและหลักฐานเดียวกัน          | B            |
| [04-dashboard-overview](screenshots/04-dashboard-overview.png) | S04       | ภาพรวมสำนัก แยกกิจกรรมและหน่วยนับ          | B            |
| [07c-report-readonly](screenshots/07c-report-readonly.png)     | S07       | ผู้บริหารอ่านรายงานเดียวกัน                | B            |
| [05b-files](screenshots/05b-files.png)                         | S05       | คลังไฟล์และเอกสาร                          | A/B          |
| [09-news-manager](screenshots/09-news-manager.png)             | S09       | เลือกรายงานต้นทางเพื่อจัดทำข่าว            | C            |
| [10a-news-edit](screenshots/10a-news-edit.png)                 | S10       | ตรวจแก้ข่าวและเลือกภาพจากหลักฐาน           | C            |
| [10b-news-preview](screenshots/10b-news-preview.png)           | S10       | ดูข่าวก่อนยืนยันเผยแพร่                    | C            |
| [10c-news-published](screenshots/10c-news-published.png)       | S10       | สถานะเว็บและ LINE แยกกัน                   | C            |
| [08-feed](screenshots/08-feed.png)                             | S08       | ข่าวเดียวกันปรากฏบนฟีดภายใน                | C            |
| [11a-admin-users](screenshots/11a-admin-users.png)             | S11       | ผู้ใช้งานและสิทธิ์                         | D            |
| [11d-admin-edit](screenshots/11d-admin-edit.png)               | S11       | กำหนดฝ่ายและงานตามบทบาท                    | D            |
| [11b-admin-master](screenshots/11b-admin-master.png)           | S11       | ส่วน ฝ่าย และงานในสังกัด                   | D            |
| [11c-admin-line](screenshots/11c-admin-line.png)               | S11       | สถานะ LINE ที่ยังไม่ได้เชื่อมบริการจริง    | ข้อจำกัด     |
| [12a-audit-list](screenshots/12a-audit-list.png)               | S12       | ค้นหาและกรองประวัติการแก้ไข                | D            |
| [12b-audit-diff](screenshots/12b-audit-diff.png)               | S12       | ค่าเดิมและค่าใหม่หลังแก้บัญชี              | D            |
| [M01-mobile-dashboard](screenshots/M01-mobile-dashboard.png)   | S04       | แดชบอร์ดบนมือถือ                           | B            |
| [M02-mobile-audit](screenshots/M02-mobile-audit.png)           | S12       | ค่าเดิมและค่าใหม่บนมือถือ                  | D            |
| [L01-line-simulation](screenshots/L01-line-simulation.png)     | ส่วนเสริม | ข้อความ LINE จำลองสำหรับจัดรายงาน          | ข้อจำกัด     |
