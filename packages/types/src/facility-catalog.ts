// E-form redesign (Session E1, Part A2) — law registry + 33-item facility catalog.
//
// PROVISIONAL: สนข. draft comparison table "Checklist ตามปี" (2566-04 revision). Expect
// revisions. `code` values (both LawReference.code and facility catalog `code`) are stable
// identifiers — do not rename; only the Thai names/mappings may be corrected later.
//
// This is pure seed data (Part A2.3 chose "constant module in @repo/types" over a seed table,
// since apps/api/prisma/seed-templates.ts already imports @repo/types for template validation —
// keeping the catalog here means one import, and it's trivially unit-testable alongside the
// rest of this package).

export const LAW_REFERENCE_CODES = ['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564', 'PROJECT'] as const
export type LawReferenceCode = typeof LAW_REFERENCE_CODES[number]

export interface LawReferenceSeed {
  code: LawReferenceCode
  nameTh: string
  ministry: string
  buddhistYear: number
  effectiveYear?: number | null  // nullable — enforcement start dates need สนข. confirmation; never guessed
  notes?: string
}

export const LAW_REFERENCE_SEED: LawReferenceSeed[] = [
  {
    code: 'MHT_2548',
    nameTh: 'กฎกระทรวงฯ กระทรวงมหาดไทย พ.ศ. 2548',
    ministry: 'กระทรวงมหาดไทย',
    buddhistYear: 2548,
    effectiveYear: null,
  },
  {
    code: 'PSD_2555',
    nameTh: 'กฎกระทรวงฯ กระทรวงการพัฒนาสังคมและความมั่นคงของมนุษย์ พ.ศ. 2555',
    ministry: 'กระทรวงการพัฒนาสังคมและความมั่นคงของมนุษย์',
    buddhistYear: 2555,
    effectiveYear: null,
  },
  {
    code: 'MOT_2556',
    nameTh: 'กฎกระทรวงฯ กระทรวงคมนาคม พ.ศ. 2556',
    ministry: 'กระทรวงคมนาคม',
    buddhistYear: 2556,
    effectiveYear: null,
  },
  {
    code: 'MHT_2564',
    nameTh: 'กฎกระทรวงฯ กระทรวงมหาดไทย พ.ศ. 2564',
    ministry: 'กระทรวงมหาดไทย',
    buddhistYear: 2564,
    effectiveYear: null,
  },
  {
    code: 'PROJECT',
    nameTh: 'รายการตรวจสอบในโครงการฯ (สนข. project checklist — superset)',
    ministry: 'สนข.',
    buddhistYear: 2566,
    effectiveYear: null,
    notes: 'Not a กฎกระทรวง — the project checklist superset, includes beyond-law items.',
  },
]

export interface FacilityCatalogEntry {
  code: number  // 1-33 — identifies a facility TYPE, not a unique key (repeats across groups/modes)
  nameTh: string
  lawRefs: LawReferenceCode[]
  cabinetResolution?: boolean  // one of the 5 มติ ครม. priority items
  beyondLaw?: boolean          // starred (31-33): project-added, not required by any กฎกระทรวง
  confidence?: 'low'           // source table row was low-fidelity — flag, don't force-guess
  note?: string
}

// มติ ครม. note (source table): the 5 priority items are ทางลาด, ที่จอดรถ, ห้องน้ำ, ป้ายสัญลักษณ์,
// การบริการข้อมูล. "การบริการข้อมูล" has been mapped to facilityCode 16 (จุดบริการให้ข้อมูลการเดินทาง)
// below — plausible alternates are 17 (การประกาศเตือนภัย) or 18 (การประกาศข้อมูล). FLAG: needs
// สนข. confirmation before this mapping is treated as final.
export const FACILITY_CATALOG: FacilityCatalogEntry[] = [
  { code: 1, nameTh: 'ประตูสำหรับคนพิการ', lawRefs: ['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564', 'PROJECT'] },
  { code: 2, nameTh: 'ที่นั่งคนพิการ/พื้นที่จอดรถเข็น', lawRefs: ['PSD_2555', 'MOT_2556', 'PROJECT'] },
  { code: 3, nameTh: 'ทางลาด', lawRefs: ['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564', 'PROJECT'], cabinetResolution: true },
  // PROVISIONAL-LOW-CONFIDENCE: PSD_2555 blank in source table (low-fidelity extraction)
  { code: 4, nameTh: 'บันไดและราวจับสำหรับคนพิการ', lawRefs: ['MHT_2548', 'MOT_2556', 'MHT_2564', 'PROJECT'], confidence: 'low' },
  { code: 5, nameTh: 'พื้นผิวต่างสัมผัส (ทุกชนิด Tactile)', lawRefs: ['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564', 'PROJECT'], note: 'Collapses Warning/Guiding/Positioning tactile variants — template items stay granular, share this facilityCode.' },
  { code: 6, nameTh: 'ช่องขายตั๋ว/ช่องเก็บตั๋วสำหรับคนพิการ', lawRefs: ['MOT_2556', 'PROJECT'] },
  { code: 7, nameTh: 'อุปกรณ์นำพาคนพิการ/รถเข็นขึ้นลงจากรถ', lawRefs: ['MOT_2556', 'PROJECT'] },
  { code: 8, nameTh: 'ราวกันตก/ผนังกันตก/ประตูกั้นชานชาลา', lawRefs: ['PSD_2555', 'MOT_2556', 'PROJECT'] },
  { code: 9, nameTh: 'ห้องน้ำสำหรับคนพิการ', lawRefs: ['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564', 'PROJECT'], cabinetResolution: true },
  { code: 10, nameTh: 'ลิฟต์สำหรับคนพิการ', lawRefs: ['PSD_2555', 'MOT_2556', 'PROJECT'] },
  { code: 11, nameTh: 'โทรศัพท์สาธารณะสำหรับคนพิการ', lawRefs: ['PSD_2555', 'MOT_2556', 'PROJECT'] },
  { code: 12, nameTh: 'ที่จอดรถสำหรับคนพิการ', lawRefs: ['MHT_2548', 'MOT_2556', 'MHT_2564', 'PROJECT'], cabinetResolution: true, confidence: 'low' },
  { code: 13, nameTh: 'พื้นที่หนีภัย/หลบภัยของคนพิการ', lawRefs: ['PSD_2555', 'MOT_2556', 'PROJECT'] },
  { code: 14, nameTh: 'ป้ายแสดงอุปกรณ์/สิ่งอำนวยความสะดวก', lawRefs: ['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564', 'PROJECT'], cabinetResolution: true },
  { code: 15, nameTh: 'แผนที่การเดินทาง (คนพิการทางการเห็น)', lawRefs: ['MOT_2556', 'PROJECT'] },
  // มติครม. "การบริการข้อมูล" mapped here — see FLAG note above the catalog.
  { code: 16, nameTh: 'จุดบริการให้ข้อมูลการเดินทาง', lawRefs: ['PSD_2555', 'MOT_2556', 'PROJECT'], cabinetResolution: true, confidence: 'low', note: 'มติ ครม. "การบริการข้อมูล" mapped here; plausible alternates: facilityCode 17 or 18. Needs สนข. confirmation. MHT_2548 blank in source table (low-fidelity extraction).' },
  { code: 17, nameTh: 'การประกาศเตือนภัย (เห็น/ได้ยิน)', lawRefs: ['PSD_2555', 'MOT_2556', 'PROJECT'] },
  { code: 18, nameTh: 'การประกาศข้อมูล (เห็น/ได้ยิน)', lawRefs: ['PSD_2555', 'MOT_2556', 'PROJECT'] },
  { code: 19, nameTh: 'คู่มือการให้ความช่วยเหลือฯ', lawRefs: ['PSD_2555', 'MOT_2556', 'PROJECT'] },
  { code: 20, nameTh: 'คู่มือแปลภาษา/ป้ายสัญลักษณ์ภาษา', lawRefs: ['PSD_2555', 'MOT_2556', 'PROJECT'] },
  { code: 21, nameTh: 'เจ้าหน้าที่ผ่านการฝึกอบรมฯ อย่างน้อย 1 คน', lawRefs: ['PSD_2555', 'MOT_2556', 'PROJECT'] },
  { code: 22, nameTh: 'ทางเท้าสำหรับคนพิการ', lawRefs: ['MOT_2556', 'PROJECT'] },
  { code: 23, nameTh: 'สัญญาณ/ทางข้ามถนนสำหรับคนพิการ', lawRefs: ['MOT_2556', 'PROJECT'] },
  { code: 24, nameTh: 'สะพานลอยข้ามถนนสำหรับคนพิการ', lawRefs: ['MOT_2556', 'PROJECT'] },
  { code: 25, nameTh: 'บันไดเลื่อนสำหรับคนพิการ', lawRefs: ['PSD_2555', 'PROJECT'] },
  { code: 26, nameTh: 'ทางลาดเลื่อน/ทางเลื่อนแนวราบ', lawRefs: ['PSD_2555', 'PROJECT'] },
  { code: 27, nameTh: 'ถังขยะแบบยกเคลื่อนที่ได้', lawRefs: ['PSD_2555', 'PROJECT'] },
  { code: 28, nameTh: 'จุดบริการน้ำดื่มสำหรับคนพิการ', lawRefs: ['PSD_2555', 'PROJECT'] },
  { code: 29, nameTh: 'ตู้บริการเงินด่วนสำหรับคนพิการ', lawRefs: ['PSD_2555', 'PROJECT'] },
  { code: 30, nameTh: 'ตู้ไปรษณีย์สำหรับคนพิการ', lawRefs: ['PSD_2555', 'PROJECT'] },
  { code: 31, nameTh: 'ราวจับคู่ (Double rail) สำหรับเด็ก', lawRefs: ['PROJECT'], beyondLaw: true },
  { code: 32, nameTh: 'ห้องเปลี่ยนผ้าอ้อมสำหรับเด็ก', lawRefs: ['PROJECT'], beyondLaw: true },
  { code: 33, nameTh: 'ตู้โทรศัพท์ล่ามภาษามือ (TTRS)', lawRefs: ['PROJECT'], beyondLaw: true },
]

// The 5 มติ ครม. priority items, by facilityCode (CLAUDE.md cabinetPriority list, cross-referenced
// against the catalog above): ทางลาด(3), ที่จอดรถ(12), ห้องน้ำ(9), ป้ายสัญลักษณ์(14), การบริการข้อมูล(16, provisional).
export const CABINET_RESOLUTION_FACILITY_CODES = [3, 9, 12, 14, 16] as const
