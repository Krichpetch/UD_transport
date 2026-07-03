// Test/demo fixtures only — NOT imported by any runtime page or API route.
// Moved out of lib/mock-data.ts during the Phase 0 real-data cutover
// (every screen now reads stations/checklists from the live API).
import type { Station, KpiSummary } from '@repo/types'

export const mockKpi: KpiSummary = {
  totalStations: 831,
  passing: 588,
  needsImprovement: 176,
  failing: 67,
  passRate: 70.8,
}

export const mockStations: Station[] = [
  { id: '1',  name: 'Hua Lamphong Station',          nameTh: 'สถานีรถไฟหัวลำโพง',          mode: 'ทางราง',   railSubtype: 'รถไฟ',    province: 'กรุงเทพมหานคร',         region: 'กลาง',                      responsibleAgency: 'รฟท.',  score: 82, status: 'ผ่านมาตรฐาน', lastInspected: '2026-04-12', lat: 13.7380, lng: 100.5159, urgentIssues: [] },
  { id: '2',  name: 'Mo Chit Bus Terminal',           nameTh: 'สถานีขนส่งหมอชิต',           mode: 'ทางบก',                             province: 'กรุงเทพมหานคร',         region: 'กลาง',                      responsibleAgency: 'บขส.',  score: 61, status: 'ต้องปรับปรุง', lastInspected: '2026-03-22', lat: 13.8021, lng: 100.5530, urgentIssues: ['ทางลาดสำหรับรถเข็นชำรุด', 'ป้ายอักษรเบรลล์ไม่ครบ'] },
  { id: '3',  name: 'Suvarnabhumi Airport',           nameTh: 'ท่าอากาศยานสุวรรณภูมิ',      mode: 'ทางอากาศ',                          province: 'สมุทรปราการ',            region: 'กลาง',                      responsibleAgency: 'ทอท.',  score: 91, status: 'ผ่านมาตรฐาน', lastInspected: '2026-05-01', lat: 13.6900, lng: 100.7501, urgentIssues: [] },
  { id: '4',  name: 'Chiang Mai Station',             nameTh: 'สถานีรถไฟเชียงใหม่',         mode: 'ทางราง',   railSubtype: 'รถไฟ',    province: 'เชียงใหม่',              region: 'เหนือ',                     responsibleAgency: 'รฟท.',  score: 44, status: 'ไม่ผ่าน',      lastInspected: '2026-02-15', lat: 18.7978, lng: 98.9733,  urgentIssues: ['ลิฟต์ไม่ทำงาน', 'ห้องน้ำสำหรับผู้พิการไม่มี', 'ทางลาดชันเกินมาตรฐาน'] },
  { id: '5',  name: 'Nakhon Ratchasima Bus Terminal', nameTh: 'สถานีขนส่งนครราชสีมา',       mode: 'ทางบก',                             province: 'นครราชสีมา',             region: 'ตะวันออกเฉียงเหนือ',       responsibleAgency: 'บขส.',  score: 57, status: 'ต้องปรับปรุง', lastInspected: '2026-03-05', lat: 14.9799, lng: 102.0978, urgentIssues: ['พื้นผิวเตือนชำรุด'] },
  { id: '6',  name: 'Phuket Airport',                 nameTh: 'ท่าอากาศยานภูเก็ต',          mode: 'ทางอากาศ',                          province: 'ภูเก็ต',                 region: 'ใต้',                       responsibleAgency: 'ทอท.',  score: 88, status: 'ผ่านมาตรฐาน', lastInspected: '2026-04-20', lat: 8.1132,  lng: 98.3169,  urgentIssues: [] },
  { id: '7',  name: 'Sathorn Pier',                   nameTh: 'ท่าเรือสาทร',                mode: 'ทางเรือ',                           province: 'กรุงเทพมหานคร',         region: 'กลาง',                      responsibleAgency: 'จท.',   score: 38, status: 'ไม่ผ่าน',      lastInspected: '2026-01-30', lat: 13.7234, lng: 100.5148, urgentIssues: ['ไม่มีทางลาดลงท่า', 'แสงสว่างไม่เพียงพอ', 'ไม่มีห้องน้ำสำหรับผู้พิการ'] },
  { id: '8',  name: 'Khon Kaen Bus Terminal',         nameTh: 'สถานีขนส่งขอนแก่น',          mode: 'ทางบก',                             province: 'ขอนแก่น',                region: 'ตะวันออกเฉียงเหนือ',       responsibleAgency: 'บขส.',  score: 73, status: 'ผ่านมาตรฐาน', lastInspected: '2026-04-08', lat: 16.4419, lng: 102.8360, urgentIssues: [] },
  { id: '9',  name: 'BTS Siam Station',               nameTh: 'สถานีรถไฟฟ้าสยาม',           mode: 'ทางราง',   railSubtype: 'รถไฟฟ้า', province: 'กรุงเทพมหานคร',         region: 'กลาง',                      responsibleAgency: 'BEM',   score: 79, status: 'ผ่านมาตรฐาน', lastInspected: '2026-05-10', lat: 13.7455, lng: 100.5331, urgentIssues: [] },
  { id: '10', name: 'MRT Chatuchak Park',             nameTh: 'สถานีรถไฟฟ้าจตุจักร',        mode: 'ทางราง',   railSubtype: 'รถไฟฟ้า', province: 'กรุงเทพมหานคร',         region: 'กลาง',                      responsibleAgency: 'รฟม.',  score: 52, status: 'ต้องปรับปรุง', lastInspected: '2026-04-28', lat: 13.8024, lng: 100.5533, urgentIssues: ['บันไดเลื่อนชำรุด'] },
]

export const mockChartData = [
  { type: 'ทางบก',     ผ่าน: 210, ต้องปรับปรุง: 68, ไม่ผ่าน: 22 },
  { type: 'ทางราง',    ผ่าน: 145, ต้องปรับปรุง: 54, ไม่ผ่าน: 31 },
  { type: 'ทางเรือ',   ผ่าน: 98,  ต้องปรับปรุง: 34, ไม่ผ่าน: 10 },
  { type: 'ทางอากาศ',  ผ่าน: 135, ต้องปรับปรุง: 20, ไม่ผ่าน: 4  },
]
