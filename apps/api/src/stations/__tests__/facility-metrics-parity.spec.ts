/**
 * Session 3 (CODE_REVIEW.md 4.5) — computeFacilityMetrics(items) in @repo/types consolidates
 * two inline formula copies:
 *   - apps/web/app/(dashboard-layout)/dashboard/page.tsx:130-162 (per-subitem, across stations)
 *   - apps/web/app/(dashboard-layout)/stations/[id]/page.tsx:224-237 (whole-checklist, one station)
 *
 * dashboardFormula()/stationPageFormula() below are verbatim ports of those two pages' inline
 * arithmetic (not reimplementations of buildHistogram/computeScoreFromItems, which are imported
 * from @repo/types exactly as both pages already do).
 *
 * Two genuine edge-case divergences were found and resolved with the user before implementation
 * (not silently picked):
 *   1. Bare-มี (value='มี', flagged=true, meetsStandard=false — a data-entry gap): dashboard's old
 *      formula counted it toward hasItem/total; the canonical buildHistogram convention (used by
 *      the station page) excludes it entirely, same bucket as N/A. Canonical won.
 *   2. Missing data (null value, or — at the API aggregation layer — a station with no checklist
 *      at all / no matching sub-item): dashboard's old formula kept it in the total denominator;
 *      canonical convention excludes it entirely (same as station-page's existing
 *      getChecklistTemplate-fallback-to-null-items behavior). Canonical won.
 * Both are asserted explicitly below as INTENTIONAL divergences from the old dashboard formula,
 * not silent regressions.
 */

import { buildHistogram, computeScoreFromItems, computeFacilityMetrics, type ChecklistGroup, type ChecklistSubItem } from '@repo/types'

function makeItem(overrides: Partial<ChecklistSubItem> & { id: string }): ChecklistSubItem {
  return {
    labelTh: overrides.id,
    value: null,
    meetsStandard: false,
    cabinetPriority: false,
    note: '',
    photos: [],
    flagged: false,
    reviewFlag: false,
    ...overrides,
  }
}

// Verbatim port of dashboard/page.tsx:134-161 — operates on one resolved sub-item per "station"
// (undefined = that station had no checklist data, or the sub-item wasn't found in it).
function dashboardFormula(perStationSubItem: Array<ChecklistSubItem | undefined>) {
  let total = perStationSubItem.length
  let hasItem = 0
  let meetsStd = 0
  for (const found of perStationSubItem) {
    if (!found) continue
    if (found.value === 'N/A') { total--; continue }
    if (found.value === 'มี') {
      hasItem++
      if (found.meetsStandard) meetsStd++
    }
  }
  return {
    total, hasItem, meetsStd,
    pctSuccess: total > 0 ? (meetsStd / total) * 100 : 0,
    pctHas:     total > 0 ? (hasItem / total) * 100 : 0,
    pctStd:     hasItem > 0 ? (meetsStd / hasItem) * 100 : 0,
  }
}

// Verbatim port of stations/[id]/page.tsx:224-237 — whole-checklist, one station.
function stationPageFormula(groups: ChecklistGroup[]) {
  const histogram = buildHistogram(groups)
  const T = histogram.hasStandard + histogram.hasSubstandard + histogram.none
  const miCount = histogram.hasStandard + histogram.hasSubstandard
  const standardCount = histogram.hasStandard
  const pctSuccess = computeScoreFromItems(groups)
  const pctHasFacility = T > 0 ? Math.round((miCount / T) * 100) : 0
  const pctMeetsStandard = miCount > 0 ? Math.round((standardCount / miCount) * 100) : 0
  return { T, miCount, standardCount, pctSuccess, pctHasFacility, pctMeetsStandard }
}

function asGroups(items: ChecklistSubItem[]): ChecklistGroup[] {
  return [{ groupId: 'x', groupName: 'x', items }]
}

describe('computeFacilityMetrics — parity with the two inline formulas it replaces', () => {
  it('matches both pages on a realistic mixed fixture (ผ่าน / มี-not-standard / ไม่มี / N/A, no bare-มี, no null)', () => {
    const items = [
      makeItem({ id: 'a1', value: 'มี', meetsStandard: true }),
      makeItem({ id: 'a2', value: 'มี', meetsStandard: true }),
      makeItem({ id: 'a3', value: 'มี', meetsStandard: false }),
      makeItem({ id: 'a4', value: 'ไม่มี' }),
      makeItem({ id: 'a5', value: 'ไม่มี' }),
      makeItem({ id: 'a6', value: 'N/A' }),
    ]
    const groups = asGroups(items)

    const fromStationPage = stationPageFormula(groups)
    const fromDashboard    = dashboardFormula(items)
    const fromShared       = computeFacilityMetrics(groups)

    expect(fromShared.total).toBe(fromStationPage.T)
    expect(fromShared.hasItem).toBe(fromStationPage.miCount)
    expect(fromShared.meetsStandard).toBe(fromStationPage.standardCount)
    expect(Math.round(fromShared.pctSuccess)).toBe(fromStationPage.pctSuccess)
    expect(Math.round(fromShared.pctHasFacility)).toBe(fromStationPage.pctHasFacility)
    expect(Math.round(fromShared.pctMeetsStandard)).toBe(fromStationPage.pctMeetsStandard)

    expect(fromShared.total).toBe(fromDashboard.total)
    expect(fromShared.hasItem).toBe(fromDashboard.hasItem)
    expect(fromShared.meetsStandard).toBe(fromDashboard.meetsStd)
    expect(fromShared.pctSuccess).toBeCloseTo(fromDashboard.pctSuccess)
    expect(fromShared.pctHasFacility).toBeCloseTo(fromDashboard.pctHas)
    expect(fromShared.pctMeetsStandard).toBeCloseTo(fromDashboard.pctStd)
  })

  it('empty groups → all zeros, no NaN/division errors', () => {
    const result = computeFacilityMetrics(asGroups([]))
    expect(result).toEqual({
      total: 0, hasItem: 0, meetsStandard: 0,
      pctSuccess: 0, pctHasFacility: 0, pctMeetsStandard: 0,
    })
    expect(dashboardFormula([])).toMatchObject({ total: 0, hasItem: 0, meetsStd: 0, pctSuccess: 0, pctHas: 0, pctStd: 0 })
    expect(stationPageFormula(asGroups([]))).toMatchObject({ T: 0, miCount: 0, standardCount: 0, pctSuccess: 0, pctHasFacility: 0, pctMeetsStandard: 0 })
  })

  it('bare-มี (flagged, standard-unspecified) — INTENTIONAL divergence from dashboard\'s old formula, resolved to canonical', () => {
    const items = [
      makeItem({ id: 'a1', value: 'มี', meetsStandard: true }), // 1 eligible, 1 standard
      makeItem({ id: 'a2', value: 'มี', meetsStandard: false, flagged: true }), // bare-มี
    ]
    const groups = asGroups(items)

    const shared = computeFacilityMetrics(groups)
    // Canonical: bare-มี excluded from both total and hasItem, same as N/A.
    expect(shared.total).toBe(1)
    expect(shared.hasItem).toBe(1)
    expect(shared.meetsStandard).toBe(1)
    expect(shared.pctHasFacility).toBe(100)

    const oldDashboard = dashboardFormula(items)
    // Old dashboard behavior counted the bare-มี item toward both total and hasItem —
    // documented here as the behavior being deliberately changed, not silently dropped.
    expect(oldDashboard.total).toBe(2)
    expect(oldDashboard.hasItem).toBe(2)
    expect(oldDashboard.total).not.toBe(shared.total)
    expect(oldDashboard.hasItem).not.toBe(shared.hasItem)
  })

  it('null (unanswered) value — INTENTIONAL divergence from dashboard\'s old formula, resolved to canonical', () => {
    const items = [
      makeItem({ id: 'a1', value: 'มี', meetsStandard: true }),
      makeItem({ id: 'a2', value: null }),
    ]
    const groups = asGroups(items)

    const shared = computeFacilityMetrics(groups)
    // Canonical: null excluded from total entirely (buildHistogram's nullOrOther bucket).
    expect(shared.total).toBe(1)
    expect(shared.pctHasFacility).toBe(100)

    const oldDashboard = dashboardFormula(items)
    // Old dashboard behavior left null items in the total denominator (fell through every
    // branch without decrementing) — documented divergence, not a silent regression.
    expect(oldDashboard.total).toBe(2)
    expect(oldDashboard.total).not.toBe(shared.total)
  })
})
