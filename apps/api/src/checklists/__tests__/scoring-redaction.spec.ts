/**
 * Session F1, Part C.4 — era-redacted leaves (StoredItem.applicable === false, baked in once at
 * submit time by ChecklistsService#applyRedactionFlags from markApplicability) are excluded from
 * EVERY scoring denominator, exactly like N/A — proven directly against scoring.ts (the verified
 * denominator mechanism: answers-based, walking the STORED items tree, not the template) so this
 * holds regardless of how the flag got there.
 *
 * The two fixtures below share the exact same ANSWERS (every leaf marked มี+ได้มาตรฐาน / present
 * standard) — only the `applicable` flag differs, standing in for a 2550-built vs a 2565-built
 * station scored against the identical template. This proves the exclusion is real (driven by the
 * flag), not an accident of the redacted leaf happening to stay unanswered.
 */
import { computeScoreFromItems, buildHistogram, computeFacilityMetrics } from '@repo/types'

function items(includeEraGatedLeafApplicable: boolean) {
  return [{
    groupId: 'A1', groupName: 'A1', items: [
      { id: 'A1.1-1', labelTh: 'always applicable', value: 'มี', meetsStandard: true },
      // Stands in for a leaf whose law postdates an earlier station's build year — applicable
      // only for the "newer" (2565) fixture.
      { id: 'A1.1-2', labelTh: 'era-gated', value: 'มี', meetsStandard: true, applicable: includeEraGatedLeafApplicable ? undefined : false },
      { id: 'A1.1-3', labelTh: 'era-gated, fails standard', value: 'มี', meetsStandard: false, applicable: includeEraGatedLeafApplicable ? undefined : false },
    ],
  }]
}

describe('scoring.ts — Part C.4 redaction exclusion', () => {
  it('computeScoreFromItems excludes an applicable:false leaf from both numerator and denominator', () => {
    const redacted = computeScoreFromItems(items(false))   // only A1.1-1 counts: 1/1 standard
    const applicable = computeScoreFromItems(items(true))  // all 3 count: 2/3 standard
    expect(redacted).toBe(100)
    expect(applicable).toBe(67)
  })

  it('buildHistogram tracks redacted leaves in their own bucket, excluded from every other bucket', () => {
    const h = buildHistogram(items(false))
    expect(h.redacted).toBe(2)
    expect(h.hasStandard).toBe(1)
    expect(h.hasSubstandard).toBe(0)
    expect(h.na).toBe(0)
  })

  it('a redacted leaf with no applicable field set at all (legacy/v1 row) is never treated as redacted', () => {
    const h = buildHistogram([{ groupId: 'A', groupName: 'A', items: [
      { id: 'x', labelTh: 'x', value: 'มี', meetsStandard: true },
    ] }])
    expect(h.redacted).toBe(0)
    expect(h.hasStandard).toBe(1)
  })

  it('computeFacilityMetrics denominators (total/hasItem/meetsStandard) exclude redacted leaves', () => {
    const metricsRedacted = computeFacilityMetrics(items(false))
    const metricsApplicable = computeFacilityMetrics(items(true))
    expect(metricsRedacted.total).toBe(1)
    expect(metricsApplicable.total).toBe(3)
  })

  it('same template, 2550 vs 2565 station: different item counts and denominators (Part C fixture)', () => {
    // 2550-built station: A1.1-2/-3 predate the law that requires them -> excluded (baked in at
    // submit as applicable:false). 2565-built: the law is already in force -> counted normally.
    const station2550Items = items(false)
    const station2565Items = items(true)

    const metrics2550 = computeFacilityMetrics(station2550Items)
    const metrics2565 = computeFacilityMetrics(station2565Items)

    expect(metrics2550.total).toBe(1)   // fewer applicable items than the newer station
    expect(metrics2565.total).toBe(3)
    expect(metrics2550.total).not.toBe(metrics2565.total)

    const h2550 = buildHistogram(station2550Items)
    const h2565 = buildHistogram(station2565Items)
    expect(h2550.redacted).toBe(2)
    expect(h2565.redacted).toBe(0)
  })
})
