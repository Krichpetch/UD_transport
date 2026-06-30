import type { ChecklistGroup, ChecklistValue, TransportMode } from '@repo/types'
import { checklistTemplates, PROVINCE_REGION, PROVINCE_COORDS, OTP_AGENCY_MAP, OTP_MODE_MAP } from './constants'
import { canonicalProvince } from './thai-geography'

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

export interface OtpParseResult {
  rows:             OtpParsedRow[]
  errors:           string[]
  outOfTimeframe:   { rowIndex: number; nameTh: string; year: number }[]
  unknownCodes:     string[]
  stats: {
    มีได้มาตรฐาน:    number
    มีไม่ได้มาตรฐาน: number
    มีไม่ระบุ:       number
    ไม่มี:           number
    na:              number
    other:           number
  }
}

const RESERVED_KEYS = new Set(['ลำดับ', 'ปี', 'หน่วยงาน', 'ด้าน'])

const LAT_KEYS = ['lat', 'latitude', 'ละติจูด']
const LNG_KEYS = ['lng', 'longitude', 'ลองจิจูด']

// Regex for Thai standard/non-standard tokens (tolerates typos: มาตราฐาน, มาตฐาน, ด้า instead of ได้)
const RE_NOT_STANDARD = /ไม่.*(ได้|ด้า)?มาตร?(าฐาน|ฐาน|ราฐาน)/
const RE_STANDARD     = /(ได้|ด้า)?มาตร?(าฐาน|ฐาน|ราฐาน)/

function parseChecklistValue(raw: unknown): {
  value: ChecklistValue
  meetsStandard: boolean
  note: string
  flagged: boolean
  isOther: boolean
} {
  const s = String(raw ?? '').trim().replace(/\s+/g, ' ')

  if (!s || s === '-' || s === '0') return { value: 'N/A', meetsStandard: false, note: '', flagged: false, isOther: false }
  if (s.toLowerCase() === 'n/a')    return { value: 'N/A', meetsStandard: false, note: '', flagged: false, isOther: false }

  // ไม่มี (includes ไม่ม่ typo)
  if (/^ไม่ม[ี่]/.test(s)) {
    const note = s.includes('-') ? s.split('-').slice(1).join('-').trim() : ''
    return { value: 'ไม่มี', meetsStandard: false, note, flagged: false, isOther: false }
  }

  if (s.startsWith('มี')) {
    if (RE_NOT_STANDARD.test(s)) {
      // มี ไม่ได้มาตรฐาน (+ typos)
      return { value: 'มี', meetsStandard: false, note: '', flagged: false, isOther: false }
    }
    if (RE_STANDARD.test(s)) {
      // มี ได้มาตรฐาน (+ typos)
      return { value: 'มี', meetsStandard: true, note: '', flagged: false, isOther: false }
    }
    // bare มี or มี + unrecognised text — flag as standard-unspecified
    return { value: 'มี', meetsStandard: false, note: '', flagged: true, isOther: false }
  }

  // Nothing matched
  return { value: null, meetsStandard: false, note: s, flagged: false, isOther: true }
}

export function detectOtpFormat(raw: Record<string, unknown>[]): boolean {
  if (raw.length === 0) return false
  return Object.keys(raw[0]!).some(k => /^\(A\d/.test(k))
}

export function parseOtpRows(raw: Record<string, unknown>[]): OtpParseResult {
  const errors: string[] = []
  const rows: OtpParsedRow[] = []
  const outOfTimeframe: OtpParseResult['outOfTimeframe'] = []
  const unknownCodesSet = new Set<string>()
  const stats: OtpParseResult['stats'] = {
    มีได้มาตรฐาน: 0, มีไม่ได้มาตรฐาน: 0, มีไม่ระบุ: 0, ไม่มี: 0, na: 0, other: 0,
  }

  // Detect coordinate columns once from the first row
  const firstKeys = Object.keys(raw[0] ?? {})
  const latKey = firstKeys.find(k => LAT_KEYS.includes(k.toLowerCase().trim()))
  const lngKey = firstKeys.find(k => LNG_KEYS.includes(k.toLowerCase().trim()))

  // Dynamic year range based on current date
  const currentBE   = new Date().getFullYear() + 543
  const VALID_BE_MIN = currentBE - 10
  const VALID_BE_MAX = currentBE + 1

  for (let i = 0; i < raw.length; i++) {
    const obj = raw[i]!

    // Find station name column — first key that isn't reserved and doesn't start with '('
    const stationKey = Object.keys(obj).find(k => !RESERVED_KEYS.has(k) && !k.startsWith('('))
    const stationCol = stationKey ? String(obj[stationKey] ?? '').trim() : ''
    if (!stationCol) { errors.push(`แถว ${i + 2}: ไม่มีชื่อสถานี`); continue }

    const agencyCol = String(obj['หน่วยงาน'] ?? '').trim()
    const danCol    = String(obj['ด้าน'] ?? '').trim()
    const yearCol   = obj['ปี']

    // Buddhist year → CE; validate range
    const be = parseInt(String(yearCol ?? ''), 10)
    if (isNaN(be) || be < VALID_BE_MIN || be > VALID_BE_MAX) {
      outOfTimeframe.push({ rowIndex: i + 2, nameTh: stationCol, year: be })
      continue
    }
    const ce = be - 543
    const lastInspected = `${ce}-12-31`

    // Mode mapping — exact first, then prefix fallback for long OTP ด้าน values
    const modeInfo = OTP_MODE_MAP[danCol]
      ?? Object.entries(OTP_MODE_MAP).find(([key]) => danCol.startsWith(key))?.[1]
    if (!modeInfo) { errors.push(`แถว ${i + 2}: ด้าน "${danCol}" ไม่รู้จัก`); continue }

    // Province — canonical lookup: stripped name, then parens content, then full-string scan
    const stripped      = stationCol.replace(/\s*\([^)]*\)$/, '').trim()
    const parensContent = stationCol.match(/\(([^)]+)\)/)?.[1]?.trim() ?? ''
    const province =
      canonicalProvince(stripped) ??
      canonicalProvince(parensContent) ??
      canonicalProvince(stationCol) ??
      'ไม่ระบุจังหวัด'
    const region = PROVINCE_REGION[province] ?? 'กลาง'

    // Coordinates — from file columns first, then province centroid fallback
    const fileLat = latKey ? parseFloat(String(obj[latKey] ?? '')) : NaN
    const fileLng = lngKey ? parseFloat(String(obj[lngKey] ?? '')) : NaN
    const centroid = PROVINCE_COORDS[province] ?? [13.7563, 100.5018]
    const lat = isNaN(fileLat) ? centroid[0] : fileLat
    const lng = isNaN(fileLng) ? centroid[1] : fileLng

    const responsibleAgency = OTP_AGENCY_MAP[agencyCol] ?? 'อื่นๆ'

    // Build checklist groups from template, filling values from OTP columns
    const template = checklistTemplates[modeInfo.mode as TransportMode]

    // Collect known item ids for unknown-code detection
    const knownIds = new Set(template.flatMap(g => g.items.map(it => `(${it.id})`)))

    // Scan for unknown (XX.X) codes in this row
    for (const key of Object.keys(obj)) {
      if (/^\([A-Z]\d+\.\d+\)$/.test(key) && !knownIds.has(key)) {
        unknownCodesSet.add(key)
      }
    }

    const groups: ChecklistGroup[] = template.map(group => ({
      ...group,
      items: group.items.map(item => {
        const rawVal = obj[`(${item.id})`]
        const { value, meetsStandard, note, flagged } = parseChecklistValue(rawVal)

        // Accumulate stats
        if (value === 'มี' && meetsStandard)       stats['มีได้มาตรฐาน']++
        else if (value === 'มี' && flagged)         stats['มีไม่ระบุ']++
        else if (value === 'มี')                    stats['มีไม่ได้มาตรฐาน']++
        else if (value === 'ไม่มี')                 stats['ไม่มี']++
        else if (value === 'N/A')                   stats['na']++
        else                                        stats['other']++

        return { ...item, value, meetsStandard, note, photos: [], flagged }
      }),
    }))

    // Score per CLAUDE.md formula
    const allItems = groups.flatMap(g => g.items)
    const eligible = allItems.filter(it => it.value !== null && it.value !== 'N/A')
    const standard = eligible.filter(it => it.value === 'มี' && it.meetsStandard)
    const score    = eligible.length > 0 ? Math.round((standard.length / eligible.length) * 100) : 0
    const status   = score >= 75 ? 'ผ่านมาตรฐาน' : score >= 50 ? 'ต้องปรับปรุง' : 'ไม่ผ่าน'

    rows.push({
      station: {
        nameTh: stationCol,
        name:   stationCol,
        mode:   modeInfo.mode,
        railSubtype: modeInfo.railSubtype,
        province,
        region,
        responsibleAgency,
        lat,
        lng,
      },
      items: groups,
      score,
      status,
      lastInspected,
    })
  }

  return { rows, errors, outOfTimeframe, unknownCodes: [...unknownCodesSet], stats }
}
