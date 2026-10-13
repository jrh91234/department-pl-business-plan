# P&L Workspace

หน้าเว็บ Profit & Loss รายแผนกและ Business Plan สำหรับ GitHub Pages ใช้ Google Sheets เป็นฐานข้อมูล โดยไม่ใส่ข้อมูลการเงินจริงไว้ใน GitHub

## โครงสร้างข้อมูลล่าสุด

เว็บอ่านตารางใน Google Sheet `Department P&L Database` โดยตรง:

- `BP บริษัท A` และ `BP บริษัท A (PD)`: หาแถวหัวเดือนที่มี BP ครบ 12 เดือน อ่าน Actual/Forecast ตามหัวตาราง และใช้ปีจากหัวตาราง Y2022 หาแถวบัญชีจากชื่อรายการในตาราง
- รวมเฉพาะคอลัมน์รายเดือน ข้ามยอด Q1–Q4 และยอดทั้งปีเพื่อไม่ให้นับซ้ำ ข้ามตาราง Target เก่าที่อยู่ด้านขวา
- `Sale Price`: อ่านตาราง BP Process Price และ FC Price จับคู่ SKU โดยตัดท้าย `-S` ของ BP ไม่ใช้ตำแหน่งแถวจับคู่ เก็บค่าว่างเป็นค่าว่าง
- `Manpower`, `SAP`, `BP Detail (PD)` และแท็บประกอบอื่น: แสดงในทะเบียนแหล่งข้อมูลจาก metadata ของชีต ไม่อ้างรายการแท็บจากไฟล์เก่า
- `business_plans`: อ่านประวัติถ้ามี ถ้ายังไม่มีจะสร้างแท็บและหัวตารางเมื่อผู้ใช้กดบันทึกครั้งแรก จากนั้นเพิ่มแถวใหม่เพื่อเก็บประวัติ ไม่มีการเขียนทับตาราง P&L หรือ Sale Price

หน้าเลือกช่วงเวลาเพิ่มโหมดรายวันจากชีต `ยอดผลิต` ของ [Job-order Tracking](https://github.com/jrh91234/Job-order-tracking) โดยอ่าน CSV ที่ตั้งค่าใน `site/pl-settings.js` และใช้ฟิลด์ Date, Time, Job order No., Model, FG Qty, Line และ Shift โหมดนี้กรอง `VOID` และรอยิงซ้ำให้สอดคล้องกับแดชบอร์ดต้นทาง

รายวันแสดงปริมาณผลิต ไม่ใช่ยอดขายจริง หากรุ่นสินค้ามีราคา FC ใน `Sale Price` เว็บคำนวณมูลค่าผลิตโดยประมาณจาก FG Qty × ราคา FC ต่อหน่วยหลังเข้าสู่ระบบ ตัวเลขนี้ไม่ถูกรวมเข้า P&L หรือใช้แทนรายได้และกำไรจริง แหล่ง CSV ของ Job-order Tracking เป็นข้อมูลที่ชีตเผยแพร่ไว้สำหรับแดชบอร์ดต้นทาง

ตัวอ่านยังรองรับรูปแบบเดิม (`pnl`, `accounts`, `products`, `source_sheets`, `source_errors`, `metadata`) ถ้าไม่มีตาราง BP หลัก ห้ามเก็บตัวเลขการเงินจริงหรือสำเนาชีตในรีโพสาธารณะ

ค่าที่อ่านไม่ได้และสูตรผิดพลาดแสดงเป็น “—” โดยไม่แทนด้วยศูนย์ เดือน Actual ไม่ถูกเปลี่ยนโดยแบบจำลอง หาก Forecast มีค่าที่แบบจำลองต้องใช้ไม่ครบ จะแสดงว่าไม่สามารถคำนวณแผนครบทั้งปีได้ จำนวนข้อผิดพลาดในหน้าแหล่งข้อมูลนับเฉพาะช่วงที่เว็บอ่าน แท็บที่ไม่ได้ตรวจจะแสดง “ยังไม่ได้ตรวจสูตร”

แอปโหลดข้อมูลผ่าน Google Sheets API หลังผู้ใช้อนุญาต Google OAuth และบันทึก Business Plan ไปยัง `business_plans` ผู้ใช้ที่บันทึกต้องมีสิทธิ์ Editor ในชีต หลังเลือกไฟล์ผ่าน Google Picker ครั้งแรก เว็บจำเฉพาะ Spreadsheet ID ใน localStorage และไม่เก็บ access token หรือ refresh token เมื่อเปิดหรือรีโหลดหน้า ให้กดปุ่มเชื่อมต่อ Google เพื่อขอ access token ใหม่ด้วยสิทธิ์เดิม จึงไม่ต้องเลือกไฟล์ซ้ำ หาก Google ไม่จำบัญชีหรือสิทธิ์แล้ว ระบบจะให้เลือกบัญชีและยืนยันอีกครั้ง

## ตั้งค่า Google OAuth

1. สร้างโปรเจกต์ใน Google Cloud Console แล้วเปิดใช้ Google Sheets API, Google Drive API และ Google Picker API
2. ตั้ง OAuth consent screen เป็น External แบบ Testing และใส่บัญชี Google ที่อนุญาตเป็น Test users
3. สร้าง OAuth Client ID ชนิด Web application และเพิ่ม Authorized JavaScript origin: `https://jrh91234.github.io`
4. สร้าง API Key จำกัด HTTP referrers เป็น `https://jrh91234.github.io/*` และ `https://docs.google.com/*` และจำกัด API เป็น Google Picker API
5. วาง OAuth Client ID, API Key และ Project Number ใน `site/pl-settings.js` แล้ว commit/push
6. แชร์ Google Sheet ให้บัญชี Google ที่ใช้เข้าสู่ระบบเป็น Editor ห้ามตั้งสิทธิ์เป็น Anyone

OAuth Client ID และ API Key ที่จำกัดโดเมนเป็นค่าระบุตัวแอปซึ่งแสดงในหน้าเว็บได้ ไม่ใช่ความลับ ห้ามใส่ client secret หรือ service-account key ในรีโพนี้ OAuth scope `drive.file` ใช้ร่วมกับ Google Picker เพื่อให้ผู้ใช้เลือกและอนุญาตเฉพาะไฟล์ฐานข้อมูลที่ตั้งค่าไว้

## เผยแพร่

GitHub Actions ใน `.github/workflows/pages.yml` จะเผยแพร่เนื้อหาใน `site/` เมื่อ push ไป `main` ไปที่ GitHub Pages URL ของรีโพนี้ การเปิดหน้าเว็บไม่แสดงตัวเลขจนกว่าผู้ใช้จะเข้าสู่ระบบและได้รับสิทธิ์ในชีต

## ขอบเขตต้นแบบ

ตาราง P&L ปัจจุบันอ้างปี 2022; มกราคมเป็น Actual และเดือนถัดไปเป็น Forecast ตามหัวตาราง ข้อมูลถูกอ่านใหม่จากชีตเมื่อเข้าสู่ระบบ ส่วนแผนจะบันทึกเป็นประวัติใน Google Sheet แต่ยังไม่มีขั้นตอน Submit/Approve หรือการจำกัดสิทธิ์ตามบทบาท

ตรวจตัวอ่านและการบันทึกประวัติด้วย `node --test tests/workbook-data.test.cjs tests/sheets-bridge.test.cjs` ใช้ข้อมูลจำลอง ไม่มีข้อมูลการเงินจริงในชุดทดสอบ
