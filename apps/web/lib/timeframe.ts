// UDT-16 — executive dashboard timeframe filter. Pure preset→range math, kept separate from
// dashboard/page.tsx so it's unit-testable without React. Semantic: keep stations whose latest
// inspection falls within [from, to] (inclusive, `to` treated as end-of-day).

export type TimeframePreset = 'all' | '30d' | '90d' | 'thisYear' | 'lastYear' | 'custom'

export interface TimeframeRange {
  from?: string // ISO date (yyyy-mm-dd), inclusive
  to?: string   // ISO date (yyyy-mm-dd), inclusive
}

export const TIMEFRAME_PRESETS: { value: TimeframePreset; label: string }[] = [
  { value: 'all',      label: 'ทั้งหมด' },
  { value: '30d',      label: '30 วัน' },
  { value: '90d',      label: '90 วัน' },
  { value: 'thisYear', label: 'ปีนี้' },
  { value: 'lastYear', label: 'ปีที่แล้ว' },
  { value: 'custom',   label: 'กำหนดเอง' },
]

function addDays(d: Date, days: number): Date {
  const copy = new Date(d)
  copy.setDate(copy.getDate() + days)
  return copy
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// customFrom/customTo are only consulted for the 'custom' preset — pass the raw <input
// type="date"> values (each '' or 'yyyy-mm-dd').
export function resolveTimeframeRange(
  preset: TimeframePreset,
  customFrom: string,
  customTo: string,
  now: Date = new Date(),
): TimeframeRange {
  switch (preset) {
    case 'all':
      return {}
    case '30d':
      return { from: toIsoDate(addDays(now, -30)), to: toIsoDate(now) }
    case '90d':
      return { from: toIsoDate(addDays(now, -90)), to: toIsoDate(now) }
    case 'thisYear':
      return { from: `${now.getFullYear()}-01-01`, to: toIsoDate(now) }
    case 'lastYear': {
      const y = now.getFullYear() - 1
      return { from: `${y}-01-01`, to: `${y}-12-31` }
    }
    case 'custom':
      return { from: customFrom || undefined, to: customTo || undefined }
  }
}

// Navbar timeframe box label — always the resolved date range, not the preset name (e.g. "30
// วัน" resolves to an actual "9/8/2569 – 8/9/2569" range so the box always shows what's really
// applied). Date-only strings are anchored to UTC so the label never drifts a day off the range
// the user actually picked, regardless of the viewer's local timezone.
export function formatTimeframeLabel(range: TimeframeRange): string {
  if (!range.from && !range.to) return 'ทั้งหมด'
  const fmt = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('th-TH', { timeZone: 'UTC' })
  if (range.from && range.to) return `${fmt(range.from)} – ${fmt(range.to)}`
  if (range.from) return `ตั้งแต่ ${fmt(range.from)}`
  return `ถึง ${fmt(range.to!)}`
}

// Inclusive [from, to] check against a station's lastInspected ISO datetime string. A station
// with no inspection at all never matches a bounded range (it has nothing to place in it), but
// always matches the unbounded 'all' range.
export function isWithinTimeframe(lastInspected: string | null, range: TimeframeRange): boolean {
  if (!range.from && !range.to) return true
  if (!lastInspected) return false
  const inspected = new Date(lastInspected).getTime()
  if (Number.isNaN(inspected)) return false
  if (range.from && inspected < new Date(range.from).getTime()) return false
  if (range.to) {
    // A date-only ISO string ('yyyy-mm-dd') parses as UTC midnight — mutating it with the
    // LOCAL-time setHours would shift the cutoff by the runtime's UTC offset (e.g. 7h early on a
    // UTC+7 machine). setUTCHours keeps the same UTC calendar day the string actually named.
    const endOfDay = new Date(range.to)
    endOfDay.setUTCHours(23, 59, 59, 999)
    if (inspected > endOfDay.getTime()) return false
  }
  return true
}
