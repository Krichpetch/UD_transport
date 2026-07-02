// Server-side score re-derivation from stored ChecklistGroup[] JSON.
// Mirrors the formula in CLAUDE.md: (ได้มาตรฐาน / total_non_NA) × 100.
// Called at submit and at admin approval so the score is never trusted from the client.

interface StoredItem {
  value: string | null
  meetsStandard: boolean
}

interface StoredGroup {
  items: StoredItem[]
}

export function computeScoreFromItems(items: unknown): number {
  if (!Array.isArray(items)) return 0
  const groups = items as StoredGroup[]
  const allItems = groups.flatMap(g => Array.isArray(g?.items) ? g.items : [])
  const eligible = allItems.filter(it => it.value !== null && it.value !== 'N/A')
  const standard = eligible.filter(it => it.value === 'มี' && it.meetsStandard === true)
  return eligible.length > 0 ? Math.round((standard.length / eligible.length) * 100) : 0
}

export function scoreToStatus(score: number): string {
  if (score >= 75) return 'ผ่านมาตรฐาน'
  if (score >= 50) return 'ต้องปรับปรุง'
  return 'ไม่ผ่าน'
}

export interface ValueHistogram {
  hasStandard:         number  // มี + meetsStandard=true
  hasSubstandard:      number  // มี + meetsStandard=false + flagged=false
  standardUnspecified: number  // มี + meetsStandard=false + flagged=true  (bare มี)
  none:                number  // ไม่มี
  na:                  number  // N/A
  nullOrOther:         number  // null (unanswered / OTHER that slipped through)
  total:               number
}

export function buildHistogram(items: unknown): ValueHistogram {
  const h: ValueHistogram = {
    hasStandard: 0, hasSubstandard: 0, standardUnspecified: 0,
    none: 0, na: 0, nullOrOther: 0, total: 0,
  }
  if (!Array.isArray(items)) return h
  const groups = items as (StoredGroup & { items: (StoredItem & { flagged?: boolean })[] })[]
  for (const g of groups) {
    for (const it of g?.items ?? []) {
      h.total++
      if (it.value === null)    { h.nullOrOther++; continue }
      if (it.value === 'N/A')   { h.na++;          continue }
      if (it.value === 'ไม่มี') { h.none++;        continue }
      if (it.value === 'มี') {
        if (it.meetsStandard)        h.hasStandard++
        else if (it.flagged)         h.standardUnspecified++
        else                         h.hasSubstandard++
      }
    }
  }
  return h
}
