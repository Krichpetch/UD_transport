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
  // ISO yyyy-mm-dd, GREGORIAN (not Buddhist) — matches a DB DateTime column and compares
  // lexicographically against Station.yearBuiltDate (also ISO). Buddhist-year math (-543) happens
  // only at the UI/display layer, never here. Refines effectiveYear when both an exact station
  // build date AND an exact law date are known (era-resolution.ts#isLawInForce); falls back to
  // effectiveYear/buddhistYear otherwise, same nullable-never-guessed rule as effectiveYear.
  effectiveDate?: string | null
  notes?: string
}

// Effective-date cutovers below (2026-08-05, user-supplied). PSD_2555's cutover (16 ม.ค. 2556) and
// MOT_2556's cutover (3 เม.ย. 2556) both land in the same พ.ศ. 2556 — collapsed to the same
// effectiveYear (2556) since that field only has year resolution. Resolving which of the two
// actually applies for a station permitted somewhere in 2556 needs the exact effectiveDate here
// AND an exact Station.yearBuiltDate (optional — auditor-captured when known, see
// era-resolution.ts#isLawInForce); with only a year on either side, the two stay indistinguishable
// and resolution falls back to the coarser effectiveYear comparison, same as before this field existed.
export const LAW_REFERENCE_SEED: LawReferenceSeed[] = [
  {
    code: 'MHT_2548',
    nameTh: 'กฎกระทรวงฯ กระทรวงมหาดไทย พ.ศ. 2548',
    ministry: 'กระทรวงมหาดไทย',
    buddhistYear: 2548,
    effectiveYear: null,
    effectiveDate: null,
    notes: 'Base law — already in force before the 2556 cutovers below. No exact enforcement date supplied yet; buddhistYear fallback (2548) stands.',
  },
  {
    code: 'PSD_2555',
    nameTh: 'กฎกระทรวงฯ กระทรวงการพัฒนาสังคมและความมั่นคงของมนุษย์ พ.ศ. 2555',
    ministry: 'กระทรวงการพัฒนาสังคมและความมั่นคงของมนุษย์',
    buddhistYear: 2555,
    effectiveYear: 2556,
    effectiveDate: '2013-01-16', // 16 มกราคม 2556 (Gregorian: 2556 - 543 = 2013)
    notes: 'Effective 16 มกราคม 2556 (not พ.ศ. 2555, the law\'s own year — enforcement lagged promulgation by about a year). Collides at year granularity with MOT_2556\'s cutover, both in 2556 — see file-level note.',
  },
  {
    code: 'MOT_2556',
    nameTh: 'กฎกระทรวงฯ กระทรวงคมนาคม พ.ศ. 2556',
    ministry: 'กระทรวงคมนาคม',
    buddhistYear: 2556,
    effectiveYear: 2556,
    effectiveDate: '2013-04-03', // 3 เมษายน 2556
    notes: 'Effective 3 เมษายน 2556.',
  },
  {
    code: 'MHT_2564',
    nameTh: 'กฎกระทรวงฯ กระทรวงมหาดไทย พ.ศ. 2564',
    ministry: 'กระทรวงมหาดไทย',
    buddhistYear: 2564,
    effectiveYear: 2564,
    effectiveDate: '2021-05-03', // 3 พฤษภาคม 2564
    notes: 'Effective 3 พฤษภาคม 2564.',
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
  // Session F3, Part D — "ตัว Guiding Block และตัว พื้นผิว ไม่ผูกกับปีที่ก่อสร้าง" (สนข. meeting
  // 2026-08-03, Dr.Aliz). The item IS required by law — its lawRefs stay real and complete — it is
  // simply never REDACTED by a station's build year: tactile surfaces are expected at every
  // station regardless of when it was built.
  //
  // Deliberately NOT expressed by reusing `beyondLaw`. That flag means "not in any กฎกระทรวง at
  // all", and S3b's admin lawRefs editor and its law-coverage indicator both read it with exactly
  // that meaning; overloading it here would mark a legally-mandated facility as beyond-law and
  // silently corrupt both. Two different facts, two different flags.
  //
  // Affects ONLY isItemApplicable (item-level redaction). It does NOT touch resolveEra, which
  // picks byLaw measurement VALUES per era — a neverEraGated item with a byLaw measurement would
  // still resolve its thresholds normally. (Verified 2026-08-04: no code-5 leaf carries a byLaw
  // measurement in any seeded template, and none would gain one from the era-override candidates,
  // so that combination does not arise today.)
  neverEraGated?: boolean
  confidence?: 'low'           // source table row was low-fidelity — flag, don't force-guess
  note?: string
}

// มติ ครม. note (source table): the 5 priority items are ทางลาด, ที่จอดรถ, ห้องน้ำ, ป้ายสัญลักษณ์,
// การบริการข้อมูล. "การบริการข้อมูล" has been mapped to facilityCode 16 (จุดบริการให้ข้อมูลการเดินทาง)
// below — plausible alternates are 17 (การประกาศเตือนภัย) or 18 (การประกาศข้อมูล). FLAG: needs
// สนข. confirmation before this mapping is treated as final.
//
// Session F1 follow-up — 'PROJECT' REMOVED from every entry below that also carries a real
// กฎกระทรวง code (1-30). Originally every entry (1-33) listed PROJECT alongside its real laws,
// meaning to say "this item is also part of the สนข. project checklist" — but
// era-resolution.ts#isItemApplicable treats ANY lawRefs entry containing 'PROJECT' as NEVER
// era-gated, full stop, regardless of what other real laws are also listed. That made every
// legally-gated facility in the catalog un-redactable (verified: 0/33 entries could ever redact,
// for any yearBuilt), silently defeating Part C's whole item-level redaction feature. PROJECT is
// kept ONLY on 31-33, which have no real law at all (beyondLaw: true) — those are correctly never
// era-gated.
export const FACILITY_CATALOG: FacilityCatalogEntry[] = [
  { code: 1, nameTh: 'ประตูสำหรับคนพิการ', lawRefs: ['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564'] },
  { code: 2, nameTh: 'ที่นั่งคนพิการ/พื้นที่จอดรถเข็น', lawRefs: ['PSD_2555', 'MOT_2556'] },
  { code: 3, nameTh: 'ทางลาด', lawRefs: ['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564'], cabinetResolution: true },
  // PROVISIONAL-LOW-CONFIDENCE: PSD_2555 blank in source table (low-fidelity extraction)
  { code: 4, nameTh: 'บันไดและราวจับสำหรับคนพิการ', lawRefs: ['MHT_2548', 'MOT_2556', 'MHT_2564'], confidence: 'low' },
  // Session F3, Part D — never era-gated (see FacilityCatalogEntry.neverEraGated). lawRefs below
  // stay complete and real; only build-year REDACTION is switched off for this facility.
  { code: 5, nameTh: 'พื้นผิวต่างสัมผัส (ทุกชนิด Tactile)', lawRefs: ['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564'], neverEraGated: true, note: 'Collapses Warning/Guiding/Positioning tactile variants — template items stay granular, share this facilityCode. Session F3: never era-gated per สนข. — Guiding Block / พื้นผิวต่างสัมผัส is not tied to build year.' },
  { code: 6, nameTh: 'ช่องขายตั๋ว/ช่องเก็บตั๋วสำหรับคนพิการ', lawRefs: ['MOT_2556'] },
  { code: 7, nameTh: 'อุปกรณ์นำพาคนพิการ/รถเข็นขึ้นลงจากรถ', lawRefs: ['MOT_2556'] },
  { code: 8, nameTh: 'ราวกันตก/ผนังกันตก/ประตูกั้นชานชาลา', lawRefs: ['PSD_2555', 'MOT_2556'] },
  { code: 9, nameTh: 'ห้องน้ำสำหรับคนพิการ', lawRefs: ['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564'], cabinetResolution: true },
  { code: 10, nameTh: 'ลิฟต์สำหรับคนพิการ', lawRefs: ['PSD_2555', 'MOT_2556'] },
  { code: 11, nameTh: 'โทรศัพท์สาธารณะสำหรับคนพิการ', lawRefs: ['PSD_2555', 'MOT_2556'] },
  { code: 12, nameTh: 'ที่จอดรถสำหรับคนพิการ', lawRefs: ['MHT_2548', 'MOT_2556', 'MHT_2564'], cabinetResolution: true, confidence: 'low' },
  { code: 13, nameTh: 'พื้นที่หนีภัย/หลบภัยของคนพิการ', lawRefs: ['PSD_2555', 'MOT_2556'] },
  { code: 14, nameTh: 'ป้ายแสดงอุปกรณ์/สิ่งอำนวยความสะดวก', lawRefs: ['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564'], cabinetResolution: true },
  { code: 15, nameTh: 'แผนที่การเดินทาง (คนพิการทางการเห็น)', lawRefs: ['MOT_2556'] },
  // มติครม. "การบริการข้อมูล" mapped here — see FLAG note above the catalog.
  { code: 16, nameTh: 'จุดบริการให้ข้อมูลการเดินทาง', lawRefs: ['PSD_2555', 'MOT_2556'], cabinetResolution: true, confidence: 'low', note: 'มติ ครม. "การบริการข้อมูล" mapped here; plausible alternates: facilityCode 17 or 18. Needs สนข. confirmation. MHT_2548 blank in source table (low-fidelity extraction).' },
  { code: 17, nameTh: 'การประกาศเตือนภัย (เห็น/ได้ยิน)', lawRefs: ['PSD_2555', 'MOT_2556'] },
  { code: 18, nameTh: 'การประกาศข้อมูล (เห็น/ได้ยิน)', lawRefs: ['PSD_2555', 'MOT_2556'] },
  { code: 19, nameTh: 'คู่มือการให้ความช่วยเหลือฯ', lawRefs: ['PSD_2555', 'MOT_2556'] },
  { code: 20, nameTh: 'คู่มือแปลภาษา/ป้ายสัญลักษณ์ภาษา', lawRefs: ['PSD_2555', 'MOT_2556'] },
  { code: 21, nameTh: 'เจ้าหน้าที่ผ่านการฝึกอบรมฯ อย่างน้อย 1 คน', lawRefs: ['PSD_2555', 'MOT_2556'] },
  { code: 22, nameTh: 'ทางเท้าสำหรับคนพิการ', lawRefs: ['MOT_2556'] },
  { code: 23, nameTh: 'สัญญาณ/ทางข้ามถนนสำหรับคนพิการ', lawRefs: ['MOT_2556'] },
  { code: 24, nameTh: 'สะพานลอยข้ามถนนสำหรับคนพิการ', lawRefs: ['MOT_2556'] },
  { code: 25, nameTh: 'บันไดเลื่อนสำหรับคนพิการ', lawRefs: ['PSD_2555'] },
  { code: 26, nameTh: 'ทางลาดเลื่อน/ทางเลื่อนแนวราบ', lawRefs: ['PSD_2555'] },
  { code: 27, nameTh: 'ถังขยะแบบยกเคลื่อนที่ได้', lawRefs: ['PSD_2555'] },
  { code: 28, nameTh: 'จุดบริการน้ำดื่มสำหรับคนพิการ', lawRefs: ['PSD_2555'] },
  { code: 29, nameTh: 'ตู้บริการเงินด่วนสำหรับคนพิการ', lawRefs: ['PSD_2555'] },
  { code: 30, nameTh: 'ตู้ไปรษณีย์สำหรับคนพิการ', lawRefs: ['PSD_2555'] },
  { code: 31, nameTh: 'ราวจับคู่ (Double rail) สำหรับเด็ก', lawRefs: ['PROJECT'], beyondLaw: true },
  { code: 32, nameTh: 'ห้องเปลี่ยนผ้าอ้อมสำหรับเด็ก', lawRefs: ['PROJECT'], beyondLaw: true },
  { code: 33, nameTh: 'ตู้โทรศัพท์ล่ามภาษามือ (TTRS)', lawRefs: ['PROJECT'], beyondLaw: true },
]

// The 5 มติ ครม. priority items, by facilityCode (CLAUDE.md cabinetPriority list, cross-referenced
// against the catalog above): ทางลาด(3), ที่จอดรถ(12), ห้องน้ำ(9), ป้ายสัญลักษณ์(14), การบริการข้อมูล(16, provisional).
export const CABINET_RESOLUTION_FACILITY_CODES = [3, 9, 12, 14, 16] as const
