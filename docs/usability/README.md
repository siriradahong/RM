# ภาพหน้าจอรอบปรับปรุงการใช้งาน

วันที่ 18 ตุลาคม 2569 · จอคอมพิวเตอร์ 1440 px, แท็บเล็ต 768 px, มือถือ 390 px

ภาพทั้งหมดสร้างจากบัญชีและฐานข้อมูลทดสอบชั่วคราว ไม่ใช้ฐานข้อมูลจริงและไม่ใช่ผลประเมินจากเจ้าหน้าที่

| หน้า                  | คอมพิวเตอร์                                  | มือถือ / แท็บเล็ต                                                                   |
| --------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------- |
| แดชบอร์ดและตัวชี้วัด  | [เปิดภาพ](screenshots/dashboard-desktop.png) | [มือถือ](screenshots/dashboard-mobile.png)                                          |
| เพิ่มข้อความและไฟล์   | [เปิดภาพ](screenshots/intake-desktop.png)    | [มือถือ](screenshots/intake-mobile.png)                                             |
| ตรวจข้อมูลและต้นฉบับ  | [เปิดภาพ](screenshots/review-desktop.png)    | [มือถือ](screenshots/review-mobile.png) / [แท็บเล็ต](screenshots/review-tablet.png) |
| ยืนยันรายการซ้ำ       | [เปิดภาพ](screenshots/duplicate-desktop.png) | ใช้แบบฟอร์มเดียวกันตามขนาดจอ                                                        |
| ปฏิทินจากวันที่จริง   | [เปิดภาพ](screenshots/calendar-desktop.png)  | [มือถือ](screenshots/calendar-mobile.png)                                           |
| คลังหลังเปิดจากยอด    | [เปิดภาพ](screenshots/library-desktop.png)   | ทดสอบผ่านชุด browser ด้วย                                                           |
| รายงานสรุปตามรอบ      | [เปิดภาพ](screenshots/reports-desktop.png)   | [มือถือ](screenshots/reports-mobile.png)                                            |
| ฉบับยืนยันพร้อมส่งออก | [เปิดภาพ](screenshots/draft-desktop.png)     | [มือถือ](screenshots/draft-mobile.png)                                              |
| โครงการและงาน         | [เปิดภาพ](screenshots/projects-desktop.png)  | [มือถือ](screenshots/projects-mobile.png)                                           |

## ตัวอย่างหน้าจอ

![แดชบอร์ด](screenshots/dashboard-desktop.png)

![เพิ่มข้อมูล](screenshots/intake-desktop.png)

![ปฏิทินมือถือ](screenshots/calendar-mobile.png)

ตรวจเส้นทางรับข้อมูล/สิทธิ์/ข่าวด้วย `npm run test:browser`, โครงการและรายงานด้วย `npm run test:workflows`, ฉบับรายงานด้วย `npm run test:drafts`, และหน้าที่เพิ่มในรอบนี้ด้วย `npm run test:usability` ดู [ขอบเขตและผลตรวจรับ](../USABILITY-20261018.md)
