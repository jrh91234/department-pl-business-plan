# P&L Workspace

หน้าเว็บ Profit & Loss รายแผนกและ Business Plan สำหรับ GitHub Pages ใช้ Google Sheets เป็นฐานข้อมูล โดยไม่ใส่ข้อมูลการเงินจริงไว้ใน GitHub

## โครงสร้างข้อมูล

Google Sheet `Department P&L Database` มีแท็บหลักดังนี้:

- `pnl`: ค่ารายเดือนแบบ long format แยกหน่วยงาน เดือน BP และ Actual/Forecast พร้อม source sheet/cell
- `accounts`: ลำดับ ชื่อ และประเภทบัญชี
- `products`: ราคาขายและวัตถุดิบตามรุ่นสินค้า
- `source_sheets`, `source_errors`: แหล่งที่มาและเซลล์ที่มีข้อผิดพลาด
- `business_plans`: บันทึกสมมติฐานและแผนงานแบบเพิ่มแถวใหม่ทุกครั้ง เพื่อเก็บประวัติ
- `metadata`: ปี สกุลเงิน และข้อมูลต้นทาง

แอปโหลดข้อมูลผ่าน Google Sheets API หลังผู้ใช้เข้าสู่ระบบด้วย Google OAuth และบันทึก Business Plan ไปยัง `business_plans` ผู้ใช้ที่บันทึกต้องมีสิทธิ์ Editor ในชีต

## ตั้งค่า Google OAuth

1. สร้างโปรเจกต์ใน Google Cloud Console และเปิดใช้ Google Sheets API
2. ตั้ง OAuth consent screen เป็น External แบบ Testing และใส่อีเมล Google ของผู้ใช้ที่อนุญาตเป็น Test users
3. สร้าง OAuth Client ID ชนิด Web application และเพิ่ม Authorized JavaScript origin: `https://jrh91234.github.io`
4. วาง Client ID ใน `site/config.js` ที่ `googleClientId` แล้ว commit/push
5. แชร์ Google Sheet ให้บัญชี Google ที่ใช้เข้าสู่ระบบเป็น Editor ห้ามตั้งสิทธิ์เป็น Anyone

Google OAuth Client ID เป็นค่าระบุตัวแอปที่แสดงในหน้าเว็บได้ ไม่ใช่ client secret ห้ามใส่ client secret หรือ service-account key ในรีโพนี้ OAuth scope `spreadsheets` ให้แอปที่ผู้ใช้อนุญาตอ่านและเขียนสเปรดชีตในบัญชีนั้น ผู้ใช้ควรอนุญาตเฉพาะแอปที่เชื่อถือได้ และเพิ่มเฉพาะบัญชีที่ต้องใช้เป็น Test users

## เผยแพร่

GitHub Actions ใน `.github/workflows/pages.yml` จะเผยแพร่เนื้อหาใน `site/` เมื่อ push ไป `main` ไปที่ GitHub Pages URL ของรีโพนี้ การเปิดหน้าเว็บไม่แสดงตัวเลขจนกว่าผู้ใช้จะเข้าสู่ระบบและได้รับสิทธิ์ในชีต

## ขอบเขตต้นแบบ

ข้อมูลเริ่มต้นมาจาก P&L ปี 2022; มกราคมเป็น Actual และเดือนถัดไปเป็น Forecast ตามเอกสารต้นทาง ส่วนแผนจะบันทึกเป็นประวัติใน Google Sheet แต่ยังไม่มีขั้นตอน Submit/Approve หรือการจำกัดสิทธิ์ตามบทบาท
