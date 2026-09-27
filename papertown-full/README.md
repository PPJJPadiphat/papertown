# PaperTown — เมืองกระดาษ

เว็บแอป full-stack สำหรับชุมชนยืม/บริจาคหนังสือ: Node.js + Express + SQLite + vanilla JS/CSS

## เปิดใช้งานบน Windows
1. ติดตั้ง Node.js LTS
2. แตกโฟลเดอร์
3. ดับเบิลคลิก `start-papertown.bat`
4. เว็บจะเปิดที่ http://localhost:3000

## บัญชี Admin สำหรับทดสอบ
- Email: `admin@papertown.local`
- Password: `PaperTown@1234`

เปลี่ยนรหัสผ่าน/บัญชีจริงก่อนใช้งาน production

## OpenAI
คัดลอก `.env.example` เป็น `.env` แล้วตั้ง `OPENAI_API_KEY` และ `OPENAI_MODEL` ตามโปรเจกต์ OpenAI ของคุณ ฟีเจอร์ AI Community Note จะเรียก `/v1/responses` จาก server เท่านั้น ไม่ส่ง key ไป browser

หากไม่ตั้ง API key ฟีเจอร์ AI จะใช้ข้อความสำรองแบบ Demo เพื่อให้ระบบหลักยังใช้งานได้

## Email
ถ้าตั้ง SMTP ใน `.env` ระบบ register จะส่ง verification email จริง ถ้าไม่ตั้ง ระบบจะแสดง verification link ใน flow ทดสอบ

## ฟีเจอร์
- Auth/register/login/email verification/session
- Catalog/search/filter/book details
- Borrow: pickup/delivery, 14-day due date, tracking/return tracking
- Address Book + default address + postcode helper
- Donation upload + approval workflow
- Community Notes + OpenAI rewrite
- Admin inventory CRUD, barcode SVG, donation approvals, fulfillment/circulation
- SQLite persistence และ mobile-first responsive UI

## หมายเหตุ production
การเชื่อมผู้ให้บริการชำระเงิน, carrier tracking แบบ API จริง, object storage/CDN, SMTP provider จริง, backup/monitoring และ deployment ยังต้องใส่ credential/บริการของผู้ใช้งานก่อนขึ้น production เพราะเป็นข้อมูลและบริการภายนอกระบบ

## Sample book cover images

This version includes local sample cover artwork in `public/covers/` so the homepage, catalog, book detail, and dashboard show actual book-cover images instead of placeholder blocks. The artwork is original PaperTown sample artwork and does not require an external image service.
