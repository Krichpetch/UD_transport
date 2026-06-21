import type { ChecklistGroup, ChecklistValue, TransportMode } from '@repo/types'
import { checklistTemplates, PROVINCE_REGION, PROVINCE_COORDS, OTP_AGENCY_MAP, OTP_MODE_MAP } from './constants'

export interface OtpParsedRow {
  station: {
    nameTh: string
    name: string
    mode: string
    railSubtype?: string
    province: string
    region: string
    responsibleAgency: string
    lat: number
    lng: number
  }
  items: ChecklistGroup[]
  score: number
  status: string
  lastInspected: string
}

const RESERVED_KEYS = new Set(['ลำดับ', 'ปี', 'หน่วยงาน', 'ด้าน'])

function parseChecklistValue(raw: unknown): { value: ChecklistValue; meetsStandard: boolean; note: string } {
  const s = String(raw ?? '').trim()
  if (!s) return { value: null, meetsStandard: false, note: '' }
  if (s === 'N/A' || s === 'n/a') return { value: 'N/A', meetsStandard: false, note: '' }
  if (s.startsWith('ไม่มี')) {
    const note = s.includes('-') ? s.split('-').slice(1).join('-').trim() : ''
    return { value: 'ไม่มี', meetsStandard: false, note }
  }
  if (s.startsWith('มี')) {
    const meetsStandard = s.includes('ได้มาตรฐาน') && !s.includes('ไม่ได้มาตรฐาน')
    return { value: 'มี', meetsStandard, note: '' }
  }
  return { value: null, meetsStandard: false, note: '' }
}

export function detectOtpFormat(raw: Record<string, unknown>[]): boolean {
  if (raw.length === 0) return false
  return Object.keys(raw[0]!).some(k => /^\(A\d/.test(k))
}

export function parseOtpRows(raw: Record<string, unknown>[]): { rows: OtpParsedRow[]; errors: string[] } {
  const errors: string[] = []
  const rows: OtpParsedRow[] = []

  for (let i = 0; i < raw.length; i++) {
    const obj = raw[i]!

    // Find station name column — first key that isn't reserved and doesn't start with '('
    const stationKey = Object.keys(obj).find(k => !RESERVED_KEYS.has(k) && !k.startsWith('('))
    const stationCol = stationKey ? String(obj[stationKey] ?? '').trim() : ''
    if (!stationCol) { errors.push(`แถว ${i + 2}: ไม่มีชื่อสถานี`); continue }

    const agencyCol = String(obj['หน่วยงาน'] ?? '').trim()
    const danCol    = String(obj['ด้าน'] ?? '').trim()
    const yearCol   = obj['ปี']

    // Mode mapping — exact first, then prefix fallback for long OTP ด้าน values
    const modeInfo = OTP_MODE_MAP[danCol]
      ?? Object.entries(OTP_MODE_MAP).find(([key]) => danCol.startsWith(key))?.[1]
    if (!modeInfo) { errors.push(`แถว ${i + 2}: ด้าน "${danCol}" ไม่รู้จัก`); continue }

    // Province — strip parenthetical suffix; if still unrecognised, scan ด้าน for embedded province name
    let province = stationCol.replace(/\s*\(.*\)$/, '').trim()
    if (!PROVINCE_COORDS[province]) {
      province = Object.keys(PROVINCE_COORDS).find(p => danCol.includes(p)) ?? province
    }
    const region = PROVINCE_REGION[province] ?? 'กลาง'
    const coords = PROVINCE_COORDS[province] ?? [13.7563, 100.5018]

    const responsibleAgency = OTP_AGENCY_MAP[agencyCol] ?? 'อื่นๆ'

    // Buddhist year → CE
    const be = parseInt(String(yearCol ?? ''), 10)
    const ce = isNaN(be) ? new Date().getFullYear() : be - 543
    const lastInspected = `${ce}-12-31`

    // Build checklist groups from template, filling values from OTP columns
    const template = checklistTemplates[modeInfo.mode as TransportMode]
    const groups: ChecklistGroup[] = template.map(group => ({
      ...group,
      items: group.items.map(item => {
        const raw = obj[`(${item.id})`]
        const { value, meetsStandard, note } = parseChecklistValue(raw)
        return { ...item, value, meetsStandard, note, photos: [], flagged: false }
      }),
    }))

    // Score per CLAUDE.md formula
    const allItems  = groups.flatMap(g => g.items)
    const eligible  = allItems.filter(it => it.value !== null && it.value !== 'N/A')
    const standard  = eligible.filter(it => it.value === 'มี' && it.meetsStandard)
    const score     = eligible.length > 0 ? Math.round((standard.length / eligible.length) * 100) : 0
    const status    = score >= 75 ? 'ผ่านมาตรฐาน' : score >= 50 ? 'ต้องปรับปรุง' : 'ไม่ผ่าน'

    rows.push({
      station: {
        nameTh: stationCol,
        name:   stationCol,
        mode:   modeInfo.mode,
        railSubtype: modeInfo.railSubtype,
        province,
        region,
        responsibleAgency,
        lat: coords[0],
        lng: coords[1],
      },
      items: groups,
      score,
      status,
      lastInspected,
    })
  }

  return { rows, errors }
}
