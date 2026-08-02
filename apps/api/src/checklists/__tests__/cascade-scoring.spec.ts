/**
 * Session F1, Part A — scoring-side proof that the visibility cascade's two outcomes score
 * correctly differently:
 *   (a) a container-level ไม่มี cascade writes REAL ไม่มี answers onto every descendant — they
 *       count in การจัดให้มีฯ's denominator (as absent), unlike the old N/A-both-cases behavior.
 *   (b) a container-level ไม่เกี่ยวข้อง cascade writes N/A onto every descendant — fully excluded
 *       from every denominator, exactly as before.
 * Exercises computeFacilityMetrics/buildHistogram directly against the stored-item shapes
 * V2PagerForm's ContainerNode/audit-form.store actually produce (see stores/audit-form.store.ts,
 * lib/audit-form.ts), not synthetic values.
 */
import { computeFacilityMetrics, buildHistogram } from '@repo/types'

// Mirrors a 2-leaf container (e.g. ทางลาด with 2 sub-criteria) after each of the 3 cascades.
function itemsAfter(outcome: 'มี-filled' | 'ไม่มี-cascade' | 'ไม่เกี่ยวข้อง-cascade') {
  if (outcome === 'มี-filled') {
    return [{ groupId: 'A1', groupName: 'A1', items: [
      { id: 'A1.1-1', labelTh: 'ความกว้าง', value: 'มี', meetsStandard: true },
      { id: 'A1.1-2', labelTh: 'ความลาดชัน', value: 'มี', meetsStandard: false },
    ] }]
  }
  if (outcome === 'ไม่มี-cascade') {
    // Part A.3 — real ไม่มี answers, auto-filled by the container's ไม่มี button.
    return [{ groupId: 'A1', groupName: 'A1', items: [
      { id: 'A1.1-1', labelTh: 'ความกว้าง', value: 'ไม่มี', meetsStandard: false, flagged: false },
      { id: 'A1.1-2', labelTh: 'ความลาดชัน', value: 'ไม่มี', meetsStandard: false, flagged: false },
    ] }]
  }
  // ไม่เกี่ยวข้อง-cascade — universal N/A marker, unchanged from the E2-era behavior.
  return [{ groupId: 'A1', groupName: 'A1', items: [
    { id: 'A1.1-1', labelTh: 'ความกว้าง', value: 'N/A', meetsStandard: false, flagged: false },
    { id: 'A1.1-2', labelTh: 'ความลาดชัน', value: 'N/A', meetsStandard: false, flagged: false },
  ] }]
}

describe('Part A scoring fixtures — cascade outcomes score differently', () => {
  it('(a) a ไม่มี cascade counts both children in จัดให้มีฯ\'s denominator, as absent (none)', () => {
    const h = buildHistogram(itemsAfter('ไม่มี-cascade'))
    expect(h.none).toBe(2)      // both counted as "does not have it"
    expect(h.na).toBe(0)
    expect(h.hasStandard).toBe(0)

    const metrics = computeFacilityMetrics(itemsAfter('ไม่มี-cascade'))
    expect(metrics.total).toBe(2)        // การจัดให้มีฯ denominator includes both
    expect(metrics.hasItem).toBe(0)      // neither counted as "has it"
    expect(metrics.pctHasFacility).toBe(0)
  })

  it('(b) a ไม่เกี่ยวข้อง cascade excludes the whole subtree from every denominator', () => {
    const h = buildHistogram(itemsAfter('ไม่เกี่ยวข้อง-cascade'))
    expect(h.na).toBe(2)
    expect(h.none).toBe(0)

    const metrics = computeFacilityMetrics(itemsAfter('ไม่เกี่ยวข้อง-cascade'))
    expect(metrics.total).toBe(0)          // fully excluded, not even counted
    expect(metrics.pctHasFacility).toBe(0) // 0/0 -> 0, not NaN
  })

  it('the two outcomes are NOT scored identically — the A.3 fix from the old shared-N/A behavior', () => {
    const metricsAbsent = computeFacilityMetrics(itemsAfter('ไม่มี-cascade'))
    const metricsNA = computeFacilityMetrics(itemsAfter('ไม่เกี่ยวข้อง-cascade'))
    expect(metricsAbsent.total).not.toBe(metricsNA.total) // 2 vs 0 — genuinely distinguishable now
  })

  it('a normally-filled container (มี, mixed standard) scores both children as eligible', () => {
    const metrics = computeFacilityMetrics(itemsAfter('มี-filled'))
    expect(metrics.total).toBe(2)
    expect(metrics.hasItem).toBe(2)
    expect(metrics.meetsStandard).toBe(1)
  })
})
