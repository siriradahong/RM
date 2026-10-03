# API reference

API ใช้ JSON ยกเว้น multipart upload ทุก endpoint ต้องมี session ยกเว้น `/health`, `/auth/login` และ LINE webhook

การเขียนต้องมี `Origin` ใน `APP_ORIGIN` และ `X-CSRF-Token` จาก login หรือ `/auth/me` พร้อม cookie `rm_session`

| Method       | Path (prefix `/api`)                         | หน้าที่                                                                           |
| ------------ | -------------------------------------------- | --------------------------------------------------------------------------------- |
| GET          | `/health`                                    | ระบบและฐานข้อมูลพร้อม                                                             |
| POST         | `/auth/login`                                | username/password → user, csrf, cookie                                            |
| GET          | `/auth/me`                                   | บัญชีและ csrf ปัจจุบัน                                                            |
| POST         | `/auth/logout`                               | ยกเลิก session                                                                    |
| POST         | `/auth/password`                             | currentPassword/newPassword; ยกเลิกทุก session                                    |
| GET          | `/meta`                                      | หน่วยงาน (kind/parent_id) งานในสังกัด ประเภท บทบาท integration                    |
| GET          | `/dashboard`                                 | สรุปจริง filter unit/work/mine/from/to/category                                   |
| GET          | `/activities`                                | filter q/unit/work/mine/from/to/status/category/source/page/limit                 |
| GET          | `/activities/:id`                            | ข้อมูล หลักฐาน ข้อความ ประวัติ can_edit                                           |
| POST/PUT     | `/activities`, `/activities/:id`             | staff/head ตาม owner/scope; PUT ส่ง version                                       |
| POST         | `/categories`                                | staff/head/admin เพิ่มประเภทงาน `{ "name": "ชื่อประเภท" }`; คืน 201 และรายการใหม่ |
| GET          | `/files`                                     | filter q/unit/mine/purpose/unlinked/page/limit                                    |
| POST         | `/files`                                     | multipart file/purpose/unit_id/title?/keywords?                                   |
| GET          | `/files/:id/content`                         | ดูต้นฉบับ; `?download=1` ดาวน์โหลด                                                |
| GET          | `/inbox`                                     | LINE ที่ยังไม่ผูกงาน                                                              |
| POST         | `/inbox/:id/download`                        | ดาวน์โหลดไฟล์ LINE ตามสิทธิ์                                                      |
| GET          | `/news`, `/news/:id`                         | ข่าว; `feed=1` เฉพาะ published                                                    |
| POST/PUT     | `/news`, `/news/:id`                         | PR เขียนร่าง; PUT ส่ง version                                                     |
| POST         | `/news/:id/publish`                          | PR ยืนยันด้วย version                                                             |
| POST         | `/news/:id/send-line`                        | PR ส่งข่าว published                                                              |
| GET/POST/PUT | `/admin/users`, `/admin/users/:id`           | admin จัดการบัญชี                                                                 |
| POST/PUT     | `/admin/units`, `/admin/units/:id`           | admin หน่วยงาน                                                                    |
| POST/PUT     | `/admin/works`, `/admin/works/:id`           | admin งานในสังกัด (name/unit_id/parent_id?/active)                                |
| POST/PUT     | `/admin/categories`, `/admin/categories/:id` | admin หมวด                                                                        |
| GET          | `/admin/audits`                              | audit อ่านอย่างเดียว filter q/from/to/page                                        |
| GET          | `/admin/line`                                | ตั้งค่า เวลาใช้งานล่าสุด ID ที่ยังไม่ผูก                                          |
| POST         | `/line/webhook`                              | raw JSON + LINE signature                                                         |

ตัวอย่าง payload รายการงาน:

```json
{
  "title": "ชื่อกิจกรรม",
  "date": "2026-09-30",
  "unit_id": 1,
  "work_id": null,
  "category_id": 1,
  "area": "พื้นที่ดำเนินงาน",
  "workers": "ผู้ปฏิบัติงานตามต้นทาง",
  "result": "ผลการดำเนินงานตามหลักฐาน",
  "metrics": [{ "label": "ผู้เข้าร่วม", "value": 32, "unit": "คน" }],
  "status": "ready",
  "file_ids": [],
  "inbox_ids": [],
  "version": 1
}
```

`pending` อนุญาตข้อมูลไม่ครบและไม่ถูกนับ `ready` ต้องมีชื่อ วันที่ หน่วยงาน ประเภท พื้นที่ ผู้ปฏิบัติงาน และผล หนึ่ง record คือหนึ่งกิจกรรม ไม่ว่ามีกี่ไฟล์/ข้อความ ผลรวมเฉพาะ label+unit เดียวกัน

Errors: `{ "error": "ข้อความไทย", "details": ["รายละเอียดช่องกรอก"] }` รหัส 400 validation, 401 session, 403 permission/CSRF/Origin, 404 ไม่พบ, 409 ซ้ำหรือ version เก่า, 413 ไฟล์ใหญ่, 415 ไฟล์ไม่รองรับ, 429 rate limit, 502 LINE ผิดพลาด, 503 ยังไม่ตั้งค่า

`work_id` ไม่บังคับ หากระบุจะต้องเป็นงานที่เปิดใช้และอยู่ใน `unit_id` เดียวกัน งานที่ปิดใช้แล้วคงค่าเดิมในรายงานเก่าได้ การตอบกลับรายการ/รายละเอียด/dashboard มี `work_name` และ `work_id`

`units.kind` คือ `section`, `division` หรือ `group`; `parent_id` ของฝ่าย/กลุ่มงานอ้างอิงส่วน งานมี `unit_id` อ้างอิงฝ่าย/กลุ่มงาน และ `parent_id` อ้างอิงงานแม่ในฝ่ายเดียวกัน ระบบปฏิเสธโครงสร้างวนซ้ำและการย้ายฝ่ายของงานที่มีรายงานหรืองานย่อยอ้างอิงแล้ว

ประเภทงานที่เพิ่มผ่าน `/categories` จะเปิดใช้งานเสมอ การแก้ชื่อ/ปิดใช้ต้องใช้ endpoint ผู้ดูแลระบบ ชื่อถูกตัดช่องว่างหัวท้ายและยุบช่องว่างซ้ำ ระบบตอบ 409 หากชื่อซ้ำ (รวมตัวอักษรอังกฤษต่างตัวพิมพ์)
