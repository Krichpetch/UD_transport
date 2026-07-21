import { PrismaClient } from '@prisma/client'
import * as bcrypt from 'bcryptjs'
import { BCRYPT_ROUNDS } from '../src/config/constants'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // ---- Users ----
  const passwordHash = await bcrypt.hash('password123', BCRYPT_ROUNDS)

  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: { username: 'admin', email: 'admin@ud-transport.go.th', passwordHash, role: 'ADMIN' },
  })
  await prisma.user.upsert({
    where: { username: 'auditor1' },
    update: {},
    create: { username: 'auditor1', email: 'auditor1@ud-transport.go.th', passwordHash, role: 'AUDITOR' },
  })
  await prisma.user.upsert({
    where: { username: 'executive' },
    update: {},
    create: { username: 'executive', email: 'executive@ud-transport.go.th', passwordHash, role: 'EXECUTIVE' },
  })

  // ---- Stations (mirrors apps/web/lib/mock-data.ts) ----
  const stations = [
    { name: 'Hua Lamphong Station',          nameTh: 'สถานีรถไฟหัวลำโพง',          mode: 'ทางราง',   railSubtype: 'รถไฟ',    province: 'กรุงเทพมหานคร',           region: 'กลาง',                    responsibleAgency: 'รฟท.',  score: 82, status: 'ผ่านมาตรฐาน',   lastInspected: new Date('2026-04-12'), lat: 13.7380, lng: 100.5159, urgentIssues: [] },
    { name: 'Mo Chit Bus Terminal',           nameTh: 'สถานีขนส่งหมอชิต',           mode: 'ทางบก',    railSubtype: null,       province: 'กรุงเทพมหานคร',           region: 'กลาง',                    responsibleAgency: 'บขส.',  score: 61, status: 'ต้องปรับปรุง', lastInspected: new Date('2026-03-22'), lat: 13.8021, lng: 100.5530, urgentIssues: ['ทางลาดสำหรับรถเข็นชำรุด', 'ป้ายอักษรเบรลล์ไม่ครบ'] },
    { name: 'Suvarnabhumi Airport',           nameTh: 'ท่าอากาศยานสุวรรณภูมิ',      mode: 'ทางอากาศ', railSubtype: null,       province: 'สมุทรปราการ',              region: 'กลาง',                    responsibleAgency: 'ทอท.',  score: 91, status: 'ผ่านมาตรฐาน',   lastInspected: new Date('2026-05-01'), lat: 13.6900, lng: 100.7501, urgentIssues: [] },
    { name: 'Chiang Mai Station',             nameTh: 'สถานีรถไฟเชียงใหม่',         mode: 'ทางราง',   railSubtype: 'รถไฟ',    province: 'เชียงใหม่',                region: 'เหนือ',                   responsibleAgency: 'รฟท.',  score: 44, status: 'ไม่ผ่าน',       lastInspected: new Date('2026-02-15'), lat: 18.7978, lng: 98.9733,  urgentIssues: ['ลิฟต์ไม่ทำงาน', 'ห้องน้ำสำหรับผู้พิการไม่มี', 'ทางลาดชันเกินมาตรฐาน'] },
    { name: 'Nakhon Ratchasima Bus Terminal', nameTh: 'สถานีขนส่งนครราชสีมา',       mode: 'ทางบก',    railSubtype: null,       province: 'นครราชสีมา',               region: 'ตะวันออกเฉียงเหนือ',     responsibleAgency: 'บขส.',  score: 57, status: 'ต้องปรับปรุง', lastInspected: new Date('2026-03-05'), lat: 14.9799, lng: 102.0978, urgentIssues: ['พื้นผิวเตือนชำรุด'] },
    { name: 'Phuket Airport',                 nameTh: 'ท่าอากาศยานภูเก็ต',          mode: 'ทางอากาศ', railSubtype: null,       province: 'ภูเก็ต',                   region: 'ใต้',                     responsibleAgency: 'ทอท.',  score: 88, status: 'ผ่านมาตรฐาน',   lastInspected: new Date('2026-04-20'), lat: 8.1132,  lng: 98.3169,  urgentIssues: [] },
    { name: 'Sathorn Pier',                   nameTh: 'ท่าเรือสาทร',                mode: 'ทางเรือ',  railSubtype: null,       province: 'กรุงเทพมหานคร',           region: 'กลาง',                    responsibleAgency: 'จท.',   score: 38, status: 'ไม่ผ่าน',       lastInspected: new Date('2026-01-30'), lat: 13.7234, lng: 100.5148, urgentIssues: ['ไม่มีทางลาดลงท่า', 'แสงสว่างไม่เพียงพอ', 'ไม่มีห้องน้ำสำหรับผู้พิการ'] },
    { name: 'Khon Kaen Bus Terminal',         nameTh: 'สถานีขนส่งขอนแก่น',          mode: 'ทางบก',    railSubtype: null,       province: 'ขอนแก่น',                  region: 'ตะวันออกเฉียงเหนือ',     responsibleAgency: 'บขส.',  score: 73, status: 'ผ่านมาตรฐาน',   lastInspected: new Date('2026-04-08'), lat: 16.4419, lng: 102.8360, urgentIssues: [] },
    { name: 'BTS Siam Station',               nameTh: 'สถานีรถไฟฟ้าสยาม',           mode: 'ทางราง',   railSubtype: 'รถไฟฟ้า', province: 'กรุงเทพมหานคร',           region: 'กลาง',                    responsibleAgency: 'BEM',   score: 79, status: 'ผ่านมาตรฐาน',   lastInspected: new Date('2026-05-10'), lat: 13.7455, lng: 100.5331, urgentIssues: [] },
    { name: 'MRT Chatuchak Park',             nameTh: 'สถานีรถไฟฟ้าจตุจักร',        mode: 'ทางราง',   railSubtype: 'รถไฟฟ้า', province: 'กรุงเทพมหานคร',           region: 'กลาง',                    responsibleAgency: 'รฟม.',  score: 52, status: 'ต้องปรับปรุง', lastInspected: new Date('2026-04-28'), lat: 13.8024, lng: 100.5533, urgentIssues: ['บันไดเลื่อนชำรุด'] },
  ]

  for (const s of stations) {
    // Match on the model's real unique constraint (nameTh, mode, responsibleAgency, province) —
    // not `id` (a cuid `.create()` never sets to `s.nameTh` in practice once matched once), which
    // meant every re-run tried to CREATE a fresh row and could collide with real OTP-imported
    // data sharing the same natural key instead of updating the existing one.
    await prisma.station.upsert({
      where: { nameTh_mode_responsibleAgency_province: {
        nameTh: s.nameTh, mode: s.mode, responsibleAgency: s.responsibleAgency, province: s.province,
      } },
      update: s,
      create: s,
    })
  }

  console.log('Seed complete.')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
