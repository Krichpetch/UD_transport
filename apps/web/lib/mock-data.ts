// ============================================================
// MOCK DATA — Replace with real API calls in Phase 2
// ============================================================

export type StationStatus = 'ผ่านมาตรฐาน' | 'ต้องปรับปรุง' | 'ไม่ผ่าน'
export type TransportType = 'รถโดยสาร' | 'รถไฟ' | 'เรือโดยสาร' | 'สนามบิน'
export type UserRole = 'ADMIN' | 'AUDITOR' | 'EXECUTIVE'

export interface Station {
  id: string
  name: string
  nameTh: string
  type: TransportType
  province: string
  region: string
  score: number
  status: StationStatus
  lastInspected: string | null
  lat: number
  lng: number
  urgentIssues: string[]
}

export interface ChecklistItem {
  id: string
  code: string
  label: string
  labelTh: string
  category: string
  value: 'มี' | 'ไม่มี' | 'ได้มาตรฐาน' | null
}

export interface KpiSummary {
  totalStations: number
  passing: number
  needsImprovement: number
  failing: number
  passRate: number
}

// --- KPI ---
export const mockKpi: KpiSummary = {
  totalStations: 831,
  passing: 588,
  needsImprovement: 176,
  failing: 67,
  passRate: 70.8,
}

// --- Stations ---
export const mockStations: Station[] = [
  { id: '1', name: 'Hua Lamphong Station', nameTh: 'สถานีรถไฟหัวลำโพง', type: 'รถไฟ', province: 'กรุงเทพมหานคร', region: 'กลาง', score: 82, status: 'ผ่านมาตรฐาน', lastInspected: '2026-04-12', lat: 13.7380, lng: 100.5159, urgentIssues: [] },
  { id: '2', name: 'Mo Chit Bus Terminal', nameTh: 'สถานีขนส่งหมอชิต', type: 'รถโดยสาร', province: 'กรุงเทพมหานคร', region: 'กลาง', score: 61, status: 'ต้องปรับปรุง', lastInspected: '2026-03-22', lat: 13.8021, lng: 100.5530, urgentIssues: ['ทางลาดสำหรับรถเข็นชำรุด', 'ป้ายอักษรเบรลล์ไม่ครบ'] },
  { id: '3', name: 'Suvarnabhumi Airport', nameTh: 'ท่าอากาศยานสุวรรณภูมิ', type: 'สนามบิน', province: 'สมุทรปราการ', region: 'กลาง', score: 91, status: 'ผ่านมาตรฐาน', lastInspected: '2026-05-01', lat: 13.6900, lng: 100.7501, urgentIssues: [] },
  { id: '4', name: 'Chiang Mai Station', nameTh: 'สถานีรถไฟเชียงใหม่', type: 'รถไฟ', province: 'เชียงใหม่', region: 'เหนือ', score: 44, status: 'ไม่ผ่าน', lastInspected: '2026-02-15', lat: 18.7978, lng: 98.9733, urgentIssues: ['ลิฟต์ไม่ทำงาน', 'ห้องน้ำสำหรับผู้พิการไม่มี', 'ทางลาดชันเกินมาตรฐาน'] },
  { id: '5', name: 'Nakhon Ratchasima Bus Terminal', nameTh: 'สถานีขนส่งนครราชสีมา', type: 'รถโดยสาร', province: 'นครราชสีมา', region: 'ตะวันออกเฉียงเหนือ', score: 57, status: 'ต้องปรับปรุง', lastInspected: '2026-03-05', lat: 14.9799, lng: 102.0978, urgentIssues: ['พื้นผิวเตือนชำรุด'] },
  { id: '6', name: 'Phuket Airport', nameTh: 'ท่าอากาศยานภูเก็ต', type: 'สนามบิน', province: 'ภูเก็ต', region: 'ใต้', score: 88, status: 'ผ่านมาตรฐาน', lastInspected: '2026-04-20', lat: 8.1132, lng: 98.3169, urgentIssues: [] },
  { id: '7', name: 'Sathorn Pier', nameTh: 'ท่าเรือสาทร', type: 'เรือโดยสาร', province: 'กรุงเทพมหานคร', region: 'กลาง', score: 38, status: 'ไม่ผ่าน', lastInspected: '2026-01-30', lat: 13.7234, lng: 100.5148, urgentIssues: ['ไม่มีทางลาดลงท่า', 'แสงสว่างไม่เพียงพอ', 'ไม่มีห้องน้ำสำหรับผู้พิการ'] },
  { id: '8', name: 'Khon Kaen Bus Terminal', nameTh: 'สถานีขนส่งขอนแก่น', type: 'รถโดยสาร', province: 'ขอนแก่น', region: 'ตะวันออกเฉียงเหนือ', score: 73, status: 'ผ่านมาตรฐาน', lastInspected: '2026-04-08', lat: 16.4419, lng: 102.8360, urgentIssues: [] },
]

// --- Bar chart data (transport type breakdown) ---
export const mockChartData = [
  { type: 'รถโดยสาร', ผ่าน: 210, ต้องปรับปรุง: 68, ไม่ผ่าน: 22 },
  { type: 'รถไฟ', ผ่าน: 145, ต้องปรับปรุง: 54, ไม่ผ่าน: 31 },
  { type: 'เรือโดยสาร', ผ่าน: 98, ต้องปรับปรุง: 34, ไม่ผ่าน: 10 },
  { type: 'สนามบิน', ผ่าน: 135, ต้องปรับปรุง: 20, ไม่ผ่าน: 4 },
]

// --- Checklist items for a station ---
export const mockChecklistItems: ChecklistItem[] = [
  { id: 'c1', code: 'A1', label: 'Accessible ramp', labelTh: 'ทางลาดสำหรับรถเข็น', category: 'การเข้าถึง', value: 'ได้มาตรฐาน' },
  { id: 'c2', code: 'A2', label: 'Tactile ground surface', labelTh: 'พื้นผิวเตือน', category: 'การเข้าถึง', value: 'มี' },
  { id: 'c3', code: 'A3', label: 'Accessible parking', labelTh: 'ที่จอดรถสำหรับผู้พิการ', category: 'การเข้าถึง', value: null },
  { id: 'c4', code: 'B1', label: 'Elevator availability', labelTh: 'ลิฟต์', category: 'การสัญจร', value: 'ไม่มี' },
  { id: 'c5', code: 'B2', label: 'Handrails on stairs', labelTh: 'ราวจับบันได', category: 'การสัญจร', value: 'ได้มาตรฐาน' },
  { id: 'c6', code: 'B3', label: 'Wide corridors', labelTh: 'ทางเดินกว้างพอเพียง', category: 'การสัญจร', value: 'มี' },
  { id: 'c7', code: 'C1', label: 'Accessible toilet', labelTh: 'ห้องน้ำสำหรับผู้พิการ', category: 'สิ่งอำนวยความสะดวก', value: null },
  { id: 'c8', code: 'C2', label: 'Braille signage', labelTh: 'ป้ายอักษรเบรลล์', category: 'สิ่งอำนวยความสะดวก', value: 'ไม่มี' },
  { id: 'c9', code: 'C3', label: 'Audio announcement system', labelTh: 'ระบบประกาศเสียง', category: 'สิ่งอำนวยความสะดวก', value: 'ได้มาตรฐาน' },
  { id: 'c10', code: 'D1', label: 'Adequate lighting', labelTh: 'แสงสว่างเพียงพอ', category: 'ความปลอดภัย', value: 'มี' },
  { id: 'c11', code: 'D2', label: 'Emergency call system', labelTh: 'ระบบเรียกฉุกเฉิน', category: 'ความปลอดภัย', value: null },
  { id: 'c12', code: 'D3', label: 'Non-slip flooring', labelTh: 'พื้นกันลื่น', category: 'ความปลอดภัย', value: 'ได้มาตรฐาน' },
]