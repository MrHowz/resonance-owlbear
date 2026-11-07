# Resonance — Owlbear Rodeo audio desk

โปรเจกต์ส่วนขยายเล่นเพลงร่วมกันที่เขียนใหม่ โดยศึกษาพฤติกรรมของ **Tracks 1.8.0** ด้วย REA และตรวจโค้ด JavaScript ที่เผยแพร่จริง โค้ดและภาพของ Tracks ไม่ได้อยู่ใน source หรือ build ของ Resonance

## เริ่มใช้งาน

ใช้ Node.js 26 ที่ติดตั้งอยู่ในเครื่องนี้:

```powershell
npm ci
npm run dev
```

เปิด <http://127.0.0.1:5173> เพื่อทดลองแบบ standalone คลังตัวอย่างมีเสียงสังเคราะห์ต้นฉบับ 8 รายการ ไม่ใช่เพลงเต็มสำหรับเล่นเกมจริง หน้า preview ระบุชัดว่าเป็นการจำลองในเครื่อง

เปิดแท็บที่สองที่ <http://127.0.0.1:5173/?role=PLAYER> ใน browser profile เดียวกันเพื่อทดลองฝั่งผู้ฟัง หาก conductor ปิดแท็บ ให้ GM ใช้ **Take control** ในหน้า Session

## สิ่งที่ทำได้

- เพลงหลักและ ambience แยกกัน เล่นวน พัก หยุด และปรับระดับส่วนกลาง
- Crossfade 0–10 วินาทีระหว่างเพลง และเมื่อเรียก scene
- แถบเวลาเดินตามเฟรมหน้าจอ ลากดูตำแหน่งได้ทันทีและเลื่อนเพลงเมื่อปล่อย รองรับ touch และปุ่มลูกศรโดยไม่ส่ง metadata ทุกเฟรม
- คิวเพลง 20 รายการ เล่นต่อเมื่อเพลงจบ การเพิ่มคิวจะปิด repeat ของเพลงปัจจุบัน
- Soundboard แบบ one-shot พร้อมปุ่มลัด 1–8 และเสียงซ้อนพร้อมกันสูงสุด 4 เสียง
- บันทึก scene ที่ประกอบด้วยเพลง ambience และระดับเสียงทั้งสองชั้น
- ค้นหาแบบ fuzzy จากชื่อ/แท็ก, favorites, ตัวกรองประเภท, แก้ไขชื่อ URL และแท็ก
- Import / export CSV รูปแบบเดียวกับ Tracks และสำรอง JSON ที่เก็บประเภท favorites และ scene ครบ
- คลังเพลงใน IndexedDB; หาก browser ปิด storage ใช้คลังชั่วคราวและแจ้งให้ export ก่อนปิดหน้า
- ซิงก์ตำแหน่งจาก timeline, clock probes และแก้ drift; ผู้เข้าทีหลังตามสถานะที่บันทึกไว้ในห้อง
- GM ควบคุม shared mix; ผู้เล่นปรับระดับเสียงของตัวเองได้
- Audio engine อยู่ใน background iframe แยกจาก action popover
- Responsive 320px ขึ้นไป, label ปุ่มสำหรับ screen reader, keyboard shortcuts และ reduced motion

คลังเพลงและ scene อยู่ใน browser ของแต่ละคน ผู้ฟังไม่ต้อง import คลังของ GM เพราะสถานะห้องมี URL ของเสียงที่กำลังใช้ แต่ URL ต้องเปิดได้สาธารณะจากอุปกรณ์ของทุกคน

## Build และติดตั้งใน Owlbear Rodeo

```powershell
npm run build
npm run preview
```

นำ **เนื้อหาภายใน `dist/`** ขึ้น static HTTPS hosting ที่ root ของโดเมน แล้วเพิ่มลิงก์ `https://your-domain.example/manifest.json` ใน Manage Extensions ของ Owlbear Rodeo จากนั้นเปิดใช้ Resonance ในห้อง

- ต้องเข้าถึง `/`, `/background.html`, `/manifest.json`, `/assets/` และ `/audio/` ได้
- อย่าใช้ `X-Frame-Options: DENY` หรือ `SAMEORIGIN` เพราะ Owlbear ต้องฝัง extension ใน iframe
- หากตั้ง CSP ให้ `frame-ancestors` อนุญาตโดเมน Owlbear ที่ใช้จริง เช่น `https://www.owlbear.app` และ `https://www.owlbear.rodeo`
- ตั้ง `manifest.json`, HTML ให้ revalidate; asset ที่มี hash ตั้ง immutable cache ได้
- ทดสอบการเล่น/ปิดแผง/ผู้เล่นเข้าทีหลังในห้องจริงก่อนใช้งานกับกลุ่ม โดยเฉพาะ Safari/iOS

โครงการนี้ยังไม่ได้เผยแพร่ขึ้น public hosting หรือติดตั้งในบัญชี Owlbear ของผู้ใช้ ไฟล์ build พร้อมนำขึ้น host

## ย้ายจาก Tracks

1. Export CSV จากเมนู Tracks
2. ใน Resonance เลือก **Import** และตรวจ preview ก่อนยืนยัน
3. ใช้หัวตาราง `title,url,tags` โดยแท็กคั่นด้วย `|`
4. เพลงที่ URL ตรงกันจะอัปเดตรายการเดิม การ merge เทียบ URL หลัง normalize
5. CSV ไม่มีประเภทเสียงหรือ scene; ใช้ **Backup JSON** เมื่อต้องการย้ายข้อมูล Resonance แบบครบ

Dropbox share URL ถูกแปลงเป็น direct content URL ให้อัตโนมัติ Google Drive ไม่รองรับการฝังเสียงแบบนี้ ส่วนลิงก์หน้า YouTube / Spotify ใช้แทนไฟล์เสียงไม่ได้ ไม่ได้มีการ upload หรือ proxy ไฟล์เสียงผ่าน server ของโปรเจกต์

## ตรวจสอบและพัฒนาต่อ

```powershell
npm run check
npm run format:check
npm run measure
```

ชุดตรวจประกอบด้วย TypeScript + production build, 30 unit tests และ 6 browser scenarios ที่ทดสอบหลายขั้นตอน โดยใช้ Chrome ที่ติดตั้งอยู่บน Windows หรือกำหนด `PLAYWRIGHT_CHROMIUM_EXECUTABLE` สำหรับเครื่องอื่น หากไม่มี system Chrome ใช้ `npx playwright install chromium`

Browser test มี host จำลอง protocol ของ Owlbear ที่ `tests/obr-host.html` และรัน **SDK จริง** ทั้ง action/background รวม GM กับผู้เล่น ตรวจว่าเพลงเล่นต่อเมื่อถอด action iframe และ crossfade คืนทรัพยากรเดิมได้เมื่อแผงปิด ตัว simulator ไม่ถูกรวมใน `dist/` และไม่ใช่หลักฐานการทดสอบ backend ของ Owlbear จริง

รายละเอียด: [รายงานการแกะ Tracks](docs/TRACKS-ANALYSIS.th.md), [สถาปัตยกรรมและข้อจำกัด](docs/ARCHITECTURE.th.md), [ค่าที่วัดได้](docs/measurements.json)

## ข้อจำกัดที่ยังต้องทราบ

- `autoplay` ใน manifest ไม่สามารถบังคับ browser ทุกตัวได้ หากถูกปิดจะมีปุ่ม **Enable audio** และคำแนะนำเปิดสิทธิ์ใน browser การส่งข้อความจาก action ไป background ไม่รับประกันว่าจะส่ง user activation ไปด้วยทุก browser
- HTMLAudio ไม่ใช่ระบบ sample-accurate sync; เครือข่าย การ seek ของ host และการพักแท็บยังทำให้เหลื่อมได้
- การปรับ volume / fade บน iOS อาจถูกจำกัดตาม browser ไม่ได้ผ่านการทดสอบ Safari/iOS ในงานนี้
- มี conductor หนึ่ง connection ต่อห้อง การ Take control พร้อมกันของ GM หลายคนใช้ลำดับ metadata ล่าสุด เพราะ SDK ไม่มี compare-and-swap
- สิทธิ์ GM เป็นการตรวจใน extension ตาม authenticated connection ID; SDK ไม่ได้มี server ACL ส่วนตัวให้ metadata namespace นี้ จึงไม่ใช่ขอบเขตความปลอดภัยต่อ client ที่ดัดแปลงโค้ด
- URL สาธารณะและการรองรับ format/range ของผู้ให้บริการเสียงยังเป็นข้อกำหนด ไม่มีระบบ upload, audio relay หรือ YouTube extractor

Dependency lockfile อยู่ในโปรเจกต์ มี override `uuid@11.1.1` สำหรับ SDK ซึ่งใช้ API v4 ที่เข้ากันได้ เพื่อตัด dependency advisory ของรุ่นเก่า ตรวจ `npm audit` แล้วไม่มีรายการ ณ วันที่สร้าง Notices ของ dependency และ font อยู่ใน `public/licenses/`
