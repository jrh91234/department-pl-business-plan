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

1. สร้างโปรเจกต์ใน Google Cloud Console แล้วเปิดใช้ Google Sheets API, Google Drive API และ Google Picker API
2. ตั้ง OAuth consent screen เป็น External แบบ Testing และใส่บัญชี Google ที่อนุญาตเป็น Test users
3. สร้าง OAuth Client ID ชนิด Web application และเพิ่ม Authorized JavaScript origin: `https://jrh91234.github.io`
4. สร้าง API Key จำกัด HTTP referrers เป็น `https://jrh91234.github.io/*` และ `https://docs.google.com/*` และจำกัด API เป็น Google Picker API
5. วาง OAuth Client ID, API Key และ Project Number ใน `site/config.js` แล้ว commit/push
6. แชร์ Google Sheet ให้บัญชี Google ที่ใช้เข้าสู่ระบบเป็น Editor ห้ามตั้งสิทธิ์เป็น Anyone

OAuth Client ID และ API Key ที่จำกัดโดเมนเป็นค่าระบุตัวแอปซึ่งแสดงในหน้าเว็บได้ ไม่ใช่ความลับ ห้ามใส่ client secret หรือ service-account key ในรีโพนี้ OAuth scope `drive.file` ใช้ร่วมกับ Google Picker เพื่อให้ผู้ใช้เลือกและอนุญาตเฉพาะไฟล์ฐานข้อมูลที่ตั้งค่าไว้

## เผยแพร่

GitHub Actions ใน `.github/workflows/pages.yml` จะเผยแพร่เนื้อหาใน `site/` เมื่อ push ไป `main` ไปที่ GitHub Pages URL ของรีโพนี้ การเปิดหน้าเว็บไม่แสดงตัวเลขจนกว่าผู้ใช้จะเข้าสู่ระบบและได้รับสิทธิ์ในชีต

## ขอบเขตต้นแบบ

ข้อมูลเริ่มต้นมาจาก P&L ปี 2022; มกราคมเป็น Actual และเดือนถัดไปเป็น Forecast ตามเอกสารต้นทาง ส่วนแผนจะบันทึกเป็นประวัติใน Google Sheet แต่ยังไม่มีขั้นตอน Submit/Approve หรือการจำกัดสิทธิ์ตามบทบาท
