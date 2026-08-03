import type { TransportMode, RailSubtype, StationStatus } from './transport.js'

// Session F2, Part D — canonical responsible-agency list, full org name + abbreviation
// (previously bare abbreviations). Position-for-position replacement of the old 11 values —
// see prisma/migrations/*_canonical_agency_names for the data migration that renames existing
// Station.responsibleAgency / User.agency rows to match.
export const RESPONSIBLE_AGENCIES = [
  'กรมการขนส่งทางบก (ขบ.)',
  'องค์การขนส่งมวลชนกรุงเทพ (ขสมก.)',
  'บริษัท ขนส่ง จำกัด (บขส.)',
  'การรถไฟแห่งประเทศไทย (รฟท.)',
  'การรถไฟฟ้าขนส่งมวลชนแห่งประเทศไทย (รฟม.)',
  'บริษัท รถไฟฟ้า ร.ฟ.ท. จำกัด (รฟฟท.)',
  'บริษัท ทางด่วนและรถไฟฟ้ากรุงเทพ จำกัด (BEM)',
  'กรมเจ้าท่า (จท.)',
  'กรมท่าอากาศยาน (ทย.)',
  'บริษัท ท่าอากาศยานไทย จำกัด (มหาชน) (ทอท.)',
  'หน่วยงานอื่นที่เกี่ยวข้อง',
] as const

export type ResponsibleAgency = typeof RESPONSIBLE_AGENCIES[number]

// Named sentinel for the catch-all agency value — import this instead of the literal string so
// a future rename of the "other" label can't silently drift out of sync the way the old bare
// 'อื่นๆ' abbreviation did across the OTP import path.
export const OTHER_AGENCY: ResponsibleAgency = 'หน่วยงานอื่นที่เกี่ยวข้อง'

// A stored responsibleAgency isn't guaranteed to be one of the 11 canonical strings — a
// masterlist-sourced private rail operator (BTS, a monorail, ARL) keeps its own raw legal
// name in the DB rather than being force-mapped onto a bucket it doesn't belong to (see
// apps/api/prisma/migrate-agency-names.ts). This classifies a raw value into its filter/
// display bucket without ever touching the underlying data: exact matches pass through,
// anything else counts as OTHER_AGENCY.
export function classifyAgency(raw: string): ResponsibleAgency {
  return (RESPONSIBLE_AGENCIES as readonly string[]).includes(raw) ? (raw as ResponsibleAgency) : OTHER_AGENCY
}

// Grouping unchanged from before the Part D rename — same agencies under the same modes,
// only the labels changed. (Note: 'กรมท่าอากาศยาน (ทย.)' sits under ทางน้ำ here, not ทางอากาศ,
// which looks like a pre-existing mis-categorization — ทย. is the Department of AIRPORTS.
// Left as-is; flagged separately rather than silently changed as part of this rename.)
export const TRANSPORT_MODE_AGENCIES: Record<TransportMode, readonly ResponsibleAgency[]> = {
  'ทางบก':    ['กรมการขนส่งทางบก (ขบ.)', 'องค์การขนส่งมวลชนกรุงเทพ (ขสมก.)', 'บริษัท ขนส่ง จำกัด (บขส.)', 'หน่วยงานอื่นที่เกี่ยวข้อง'],
  'ทางราง':   ['การรถไฟแห่งประเทศไทย (รฟท.)', 'การรถไฟฟ้าขนส่งมวลชนแห่งประเทศไทย (รฟม.)', 'บริษัท รถไฟฟ้า ร.ฟ.ท. จำกัด (รฟฟท.)', 'บริษัท ทางด่วนและรถไฟฟ้ากรุงเทพ จำกัด (BEM)', 'หน่วยงานอื่นที่เกี่ยวข้อง'],
  'ทางน้ำ':   ['กรมเจ้าท่า (จท.)', 'กรมท่าอากาศยาน (ทย.)', 'หน่วยงานอื่นที่เกี่ยวข้อง'],
  'ทางอากาศ': ['บริษัท ท่าอากาศยานไทย จำกัด (มหาชน) (ทอท.)', 'หน่วยงานอื่นที่เกี่ยวข้อง'],
}

export type CoordSource = 'OFFICIAL' | 'GEOCODED' | 'MANUAL' | 'NONE'
export type CoordStatus = 'OK' | 'APPROXIMATE' | 'PENDING' | 'INVALID'
export type StationScope = 'IN_SCOPE' | 'OUT_OF_SCOPE'

export interface Station {
  id: string
  name: string
  nameTh: string
  mode: TransportMode
  railSubtype?: RailSubtype
  // Nullable: the masterlist has no province for ~447 rail rows (schema.prisma's own comment
  // on this column) — never fabricate one. Was mistyped as non-nullable `string` here, which is
  // how AppNavbar's `.includes()` crash and excel-export's `.localeCompare()` crash both slipped
  // past the compiler; fixed at the type so every unsafe access gets caught, not just these two.
  province: string | null
  region: string | null
  // Station masterlist cutover — สาย/เส้นทาง the station sits on (e.g. a metro line). Empty
  // string (never null) when the source had none; part of the (mode, nameTh, line) identity key.
  line?: string
  responsibleAgency: string
  score: number
  status: StationStatus
  lastInspected: string | null
  lat: number | null
  lng: number | null
  coordSource?: CoordSource
  coordStatus?: CoordStatus
  scope?: StationScope
  isOperational?: boolean
  urgentIssues: string[]
  // E-form redesign (Session E2, Part A) — Buddhist year, auditor-entered at confirm-to-start.
  // Nullable until an auditor first captures it; drives era resolution (see era-resolution.ts).
  yearBuilt?: number | null
  // Session S3b, Part A — practice/tutorial fixture, never a real inspection target. Drives the
  // client-side proximity-gate bypass (server-enforced regardless — see ChecklistsService.submit).
  isTraining?: boolean
}

export interface KpiSummary {
  totalStations: number
  passing: number
  needsImprovement: number
  failing: number
  passRate: number
}
