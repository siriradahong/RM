# การติดตั้งบนเซิร์ฟเวอร์

รุ่นนี้ใช้ Node.js process เดียวและ SQLite บน local disk ไม่ใช้ network filesystem หากต้องขยายหลาย instance ให้ย้าย persistence layer ไป PostgreSQL และ shared object storage ก่อน

## ติดตั้ง

1. Node.js 24 LTS → `npm ci` → `npm run build`
2. สร้าง `.env` จาก `.env.example` กำหนด `DATA_DIR` เป็น absolute path บน persistent disk
3. ใช้ OS service account เฉพาะ ให้เขียนเฉพาะ data directory
4. รัน `npm run admin:create` หนึ่งครั้ง เก็บ credentials ให้ปลอดภัย
5. เปิด Express ด้วย service manager และ reverse proxy

```dotenv
NODE_ENV=production
HOST=127.0.0.1
PORT=3001
APP_ORIGIN=https://reports.example.go.th
DATA_DIR=/var/lib/kkmuni-rm
TRUST_PROXY=1
```

`TRUST_PROXY=1` ใช้เมื่อมี reverse proxy ที่เชื่อถือได้หนึ่งชั้นและ Express ไม่เปิดตรงสู่อินเทอร์เน็ต `production` ใช้ Secure cookie และ HSTS จึงต้องเป็น HTTPS ไม่ใช้ wildcard Origin

## ตัวอย่าง Nginx

ปรับโดเมนและ certificate paths ตามเครื่องจริง:

```nginx
server {
    listen 443 ssl;
    server_name reports.example.go.th;
    ssl_certificate /etc/letsencrypt/live/reports.example.go.th/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/reports.example.go.th/privkey.pem;
    client_max_body_size 21m;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

เพิ่ม HTTP → HTTPS redirect และ certificate renewal ตามระบบของหน่วยงาน ไม่ expose Vite dev server ต่อสาธารณะ

## ก่อนใช้ข้อมูลจริงบนอินเทอร์เน็ต

- ยืนยันโดเมน HTTPS, Origin, service account, monitoring และนโยบายสำรองข้อมูลกับผู้ดูแลเซิร์ฟเวอร์
- ทดสอบ restore บนเครื่องแยก กำหนดระยะเวลาเก็บตามนโยบายหน่วยงาน
- ตั้งบัญชีจริง สังกัด และ scopes หัวหน้า ไม่แชร์รหัสผ่านแอดมิน
- กำหนด storage quota, retention และ antivirus ตามนโยบายองค์กร รุ่นนี้จำกัดขนาดต่อไฟล์ รองรับ ClamAV เมื่อกำหนด ANTIVIRUS_ENABLED=1 และมีตัวสแกนพร้อมใช้งาน ส่วนโควตาพื้นที่ดิสก์ให้ผู้ติดตั้งกำหนดตามระบบเซิร์ฟเวอร์
- LINE credentials อยู่ฝั่งเซิร์ฟเวอร์เท่านั้น ทดสอบกับกลุ่มที่ได้รับอนุญาต
- รองรับ PDF/Word/Excel และ OCR ในเครื่อง, LINE Login และตัวเชื่อม Ollama แบบเลือกเปิดตามคู่มือขอบเขตฉบับล่าสุด ส่วนอีเมลรีเซ็ตรหัสผ่านยังไม่อยู่ในระบบ

## อัปเดต

สำรองข้อมูล → โค้ดใหม่ → `npm ci` → `npm test` → `npm run build` → restart service การเปิดฐานข้อมูลใช้ migrations และไม่ seed รายการงาน/ข่าวทับข้อมูลเดิม

## เปิดส่วนที่เพิ่มตาม PDF

ดู `.env.example` สำหรับ LINE Login, PUBLIC_BASE_URL, Ollama และ ClamAV ข้อมูลลับอยู่ฝั่งเซิร์ฟเวอร์เท่านั้น เปิดผู้ช่วย LINE/ส่ง LINE ใน **ดูแลระบบ → หน่วยงานและหมวดข้อมูล → ค่ามาตรฐานและงานอัตโนมัติ** หลังตั้งค่าครบ อ่าน [เงื่อนไขและขอบเขตล่าสุด](SCOPE-IMPLEMENTATION.md) ก่อนใช้จริง

เตือนในเว็บและสรุปตามรอบทำงานเมื่อเซิร์ฟเวอร์เปิดอยู่ การลบตามอายุเก็บปิดไว้จนแอดมินกำหนดจำนวนวันและเปิดนโยบาย สำรองก่อน migration 11 และตรวจนโยบายองค์กรสำหรับอายุเก็บสำเนาสำรองด้วย การลบในฐานข้อมูลใช้งานไม่ลบ backup เก่าที่ผู้ติดตั้งเก็บแยกไว้
