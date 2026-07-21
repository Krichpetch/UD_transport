/**
 * E-form redesign (Session E2 follow-up) — N/A is no longer a 'choice'-only concept. A v2
 * presence/presence_standard leaf may carry `value: 'N/A'` (e.g. three mutually-exclusive
 * ramp-length criteria where only one applies) and must be excluded from every scoring bucket,
 * exactly like v1's N/A always was — never counted, not even as "unanswered."
 */
import { computeScoreFromItems, buildHistogram, computeFacilityMetrics } from '../scoring'

describe('universal N/A — presence leaves', () => {
  const items = [{
    groupId: 'A', groupName: 'A', items: [
      { id: 'p1', labelTh: 'applicable', answerType: 'presence', present: true },
      { id: 'p2', labelTh: 'not applicable here', answerType: 'presence', present: null, value: 'N/A' },
    ],
  }]

  it('excludes the N/A presence leaf from the histogram entirely (not even presenceUnanswered)', () => {
    const h = buildHistogram(items)
    expect(h.presenceHas).toBe(1)
    expect(h.presenceNone).toBe(0)
    expect(h.presenceUnanswered).toBe(0)
    expect(h.na).toBe(1)
  })
})

describe('universal N/A — presence_standard leaves (including measured)', () => {
  const templateDef = {
    schemaVersion: 2 as const,
    mode: 'ทางราง' as const,
    groups: [{
      code: 'A1', labelTh: 'ramp bands', items: [
        { code: 'A1.1-1', labelTh: 'band 1 (<=2500mm)', answerType: 'presence_standard' as const, measurements: [{ key: 'm1', operator: 'gte' as const, value: 90, unit: 'cm', autoGrade: true }] },
        { code: 'A1.1-2', labelTh: 'band 2', answerType: 'presence_standard' as const, measurements: [{ key: 'm1', operator: 'gte' as const, value: 90, unit: 'cm', autoGrade: true }] },
        { code: 'A1.1-3', labelTh: 'band 3', answerType: 'presence_standard' as const, measurements: [{ key: 'm1', operator: 'gte' as const, value: 90, unit: 'cm', autoGrade: true }] },
      ],
    }],
  }

  // Physical reality: only band 1 applies to this station's actual ramp; bands 2 and 3 are marked
  // ไม่เกี่ยวข้อง by the auditor rather than left unanswered or (incorrectly) "ไม่มี".
  const items = [{
    groupId: 'A1', groupName: 'A1', items: [
      { id: 'A1.1-1', labelTh: 'band 1', answerType: 'presence_standard', present: true, values: { m1: 90 } },
      { id: 'A1.1-2', labelTh: 'band 2', answerType: 'presence_standard', present: null, value: 'N/A' },
      { id: 'A1.1-3', labelTh: 'band 3', answerType: 'presence_standard', present: null, value: 'N/A' },
    ],
  }]

  it('scores only the applicable band; the two N/A bands never enter eligible/standard', () => {
    // eligible = 1 (band 1, passes) -> 100%, not diluted by the two N/A siblings
    expect(computeScoreFromItems(items, templateDef)).toBe(100)
  })

  it('buildHistogram buckets the N/A bands as na, not standardUnspecified/none/nullOrOther', () => {
    const h = buildHistogram(items, templateDef)
    expect(h.hasStandard).toBe(1)
    expect(h.na).toBe(2)
    expect(h.standardUnspecified).toBe(0)
    expect(h.none).toBe(0)
    expect(h.nullOrOther).toBe(0)
  })

  it('computeFacilityMetrics denominator excludes the N/A bands entirely', () => {
    const m = computeFacilityMetrics(items, templateDef)
    expect(m.total).toBe(1)
    expect(m.meetsStandard).toBe(1)
    expect(m.pctSuccess).toBeCloseTo(100)
  })
})
