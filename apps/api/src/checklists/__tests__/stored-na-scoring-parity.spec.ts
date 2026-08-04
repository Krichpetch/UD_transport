/**
 * Session F3, Part B — stored 'N/A' must score EXACTLY as it always has.
 *
 * The ไม่เกี่ยวข้อง button was removed from the auditor form (สนข. 2026-08-03, Dr.Aliz; audit team
 * confirmed ไม่มี is used instead). Only the BUTTON went. 'N/A' remains a valid ChecklistValue and
 * thousands of already-submitted checklists contain it.
 *
 * This is the regression that would hurt most and show up latest: if a future cleanup "finished
 * the job" by teaching scoring to treat stored N/A as ไม่มี, every historical checklist would
 * silently re-score downward — N/A is excluded from both numerator and denominator, ไม่มี counts
 * in the denominator. Government inspection results would change retroactively with no migration
 * and no audit trail.
 *
 * So the expected values below are written as literal, byte-comparable numbers rather than
 * computed from the same helpers under test. If the exclusion semantics ever change, these fail.
 */
import { computeScoreFromItems, buildHistogram, computeFacilityMetrics } from '../scoring'

// A realistic mixed checklist: มี+ได้มาตรฐาน, มี+ไม่ได้มาตรฐาน, ไม่มี, N/A (choice AND
// presence_standard AND presence — N/A is a universal marker, valid on every answerType), and
// an unanswered leaf.
const STORED_WITH_NA = [
  {
    groupId: 'A1',
    groupName: 'ที่จอดรถ',
    items: [
      { id: 'A1.1', labelTh: 'ที่จอดรถคนพิการ', answerType: 'choice', value: 'มี', meetsStandard: true },
      { id: 'A1.2', labelTh: 'ป้ายสัญลักษณ์', answerType: 'choice', value: 'มี', meetsStandard: false },
      { id: 'A1.3', labelTh: 'ทางลาด', answerType: 'choice', value: 'ไม่มี', meetsStandard: false },
      // The three mutually-exclusive ramp bands: one applied, two were marked ไม่เกี่ยวข้อง.
      { id: 'A1.4', labelTh: 'กรณีทางลาดยาวไม่เกิน 2,500 มม.', answerType: 'presence_standard', present: true, meetsStandard: true },
      { id: 'A1.5', labelTh: 'กรณีทางลาดยาว 2,500-6,000 มม.', answerType: 'presence_standard', value: 'N/A', present: null, meetsStandard: false },
      { id: 'A1.6', labelTh: 'กรณีทางลาดยาวเกิน 6,000 มม.', answerType: 'presence_standard', value: 'N/A', present: null, meetsStandard: false },
      { id: 'A1.7', labelTh: 'ลิฟต์ (choice N/A)', answerType: 'choice', value: 'N/A', meetsStandard: false },
      { id: 'A1.8', labelTh: 'ราวจับ (presence N/A)', answerType: 'presence', value: 'N/A', present: null },
      { id: 'A1.9', labelTh: 'ยังไม่ได้ตอบ', answerType: 'choice', value: null, meetsStandard: false },
      { id: 'A1.10', labelTh: 'ทางเท้า (presence มี)', answerType: 'presence', present: true },
      { id: 'A1.11', labelTh: 'ทางข้าม (presence ไม่มี)', answerType: 'presence', present: false },
    ],
  },
]

describe('Part B — stored N/A scores identically (byte-comparable fixture)', () => {
  it('computeScoreFromItems returns the exact historical value', () => {
    // eligible = A1.1(มี/std) + A1.2(มี/not) + A1.3(ไม่มี) + A1.4(present+std) = 4
    // standard = A1.1 + A1.4 = 2  ->  round(2/4*100) = 50
    expect(computeScoreFromItems(STORED_WITH_NA)).toBe(50)
  })

  it('buildHistogram buckets every N/A leaf into `na`, and nowhere else', () => {
    expect(buildHistogram(STORED_WITH_NA)).toEqual({
      hasStandard: 2,          // A1.1, A1.4
      hasSubstandard: 1,       // A1.2
      standardUnspecified: 0,
      none: 1,                 // A1.3
      na: 4,                   // A1.5, A1.6, A1.7, A1.8 — all four answerTypes
      redacted: 0,
      nullOrOther: 1,          // A1.9
      total: 11,
      presenceHas: 1,          // A1.10
      presenceNone: 1,         // A1.11
      presenceUnanswered: 0,
    })
  })

  it('computeFacilityMetrics returns the exact historical six metrics', () => {
    const m = computeFacilityMetrics(STORED_WITH_NA)
    expect(m.total).toBe(4)              // hasStandard + hasSubstandard + none
    expect(m.hasItem).toBe(4)            // 3 standards-bearing + 1 presence-only มี
    expect(m.meetsStandard).toBe(2)
    expect(m.pctSuccess).toBeCloseTo(50, 10)
    expect(m.pctHasFacility).toBeCloseTo((4 / 6) * 100, 10)   // facilityEligible = 4 + 1 + 1
    expect(m.pctMeetsStandard).toBeCloseTo((2 / 3) * 100, 10)
  })

  it('N/A is excluded from BOTH numerator and denominator — dropping those leaves changes nothing', () => {
    const withoutNa = [
      { ...STORED_WITH_NA[0]!, items: STORED_WITH_NA[0]!.items.filter((i) => i.value !== 'N/A') },
    ]
    expect(computeScoreFromItems(withoutNa)).toBe(computeScoreFromItems(STORED_WITH_NA))
    expect(computeFacilityMetrics(withoutNa)).toEqual(computeFacilityMetrics(STORED_WITH_NA))
  })

  it('N/A is NOT equivalent to ไม่มี — the guard against a future "cleanup"', () => {
    const naAsAbsent = [
      {
        ...STORED_WITH_NA[0]!,
        items: STORED_WITH_NA[0]!.items.map((i) =>
          i.value === 'N/A'
            ? (i.answerType === 'choice'
                ? { ...i, value: 'ไม่มี' }
                : { ...i, value: null, present: false })
            : i,
        ),
      },
    ]
    // Coercing stored N/A to ไม่มี would drag the score down — exactly the retroactive re-scoring
    // this suite exists to prevent.
    expect(computeScoreFromItems(naAsAbsent)).toBeLessThan(computeScoreFromItems(STORED_WITH_NA))
    expect(computeFacilityMetrics(naAsAbsent).pctHasFacility)
      .toBeLessThan(computeFacilityMetrics(STORED_WITH_NA).pctHasFacility)
  })

  it('era redaction stays a separate mechanism from the auditor N/A', () => {
    // applicable:false is structural (build-year redaction), not an auditor answer. It must keep
    // bucketing to `redacted`, never to `na`, so the two remain distinguishable in reporting.
    const redacted = [
      {
        groupId: 'A1',
        groupName: 'g',
        items: [
          { id: 'A1.1', labelTh: 'x', answerType: 'choice', value: 'มี', meetsStandard: true },
          { id: 'A1.2', labelTh: 'y', answerType: 'choice', value: null, meetsStandard: false, applicable: false },
        ],
      },
    ]
    const h = buildHistogram(redacted)
    expect(h.redacted).toBe(1)
    expect(h.na).toBe(0)
  })
})
