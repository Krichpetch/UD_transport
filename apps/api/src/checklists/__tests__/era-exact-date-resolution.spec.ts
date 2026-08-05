/**
 * 2026-08-05 — exact-date era resolution (Station.yearBuiltDate / LawReference.effectiveDate).
 *
 * The gap this closes: Station.yearBuilt is a Buddhist YEAR, but PSD_2555 (effective 16 ม.ค. 2556)
 * and MOT_2556 (effective 3 เม.ย. 2556) both land in the same พ.ศ. 2556 — a station permitted
 * anywhere in 2556 could not be told apart as "before or after 3 เม.ย." Auditor-captured exact
 * dates (Station.yearBuiltDate) plus real LawReference.effectiveDate values resolve that, but ONLY
 * when both sides have one; a year-only station must keep resolving exactly as it always has.
 */
import {
  resolveEra,
  filterApplicableItems,
  eraYearBrackets,
  buddhistYearOfIsoDate,
  isValidYearBuiltDate,
  LAW_REFERENCE_SEED,
  type ChecklistTemplateDefinition,
  type EraLawRef,
} from '@repo/types'

// Mirrors the real PSD_2555/MOT_2556 collision: two laws, same Buddhist year (2556), distinct
// exact Gregorian dates.
const REGISTRY: EraLawRef[] = [
  { code: 'PSD_2555', buddhistYear: 2555, effectiveYear: 2556, effectiveDate: '2013-01-16' },
  { code: 'MOT_2556', buddhistYear: 2556, effectiveYear: 2556, effectiveDate: '2013-04-03' },
]

describe('resolveEra — exact-date tie-break within the same Buddhist year', () => {
  it('without a buildDate, both laws are indistinguishable — yearBuilt 2556 resolves to the later one (existing year-only rule, unchanged)', () => {
    expect(resolveEra(2556, ['PSD_2555', 'MOT_2556'], REGISTRY)).toEqual({ lawCode: 'MOT_2556', eraUnresolved: false })
  })

  it('a buildDate between the two exact dates resolves to the EARLIER law, not the later one a year-only comparison would pick', () => {
    // 1 กุมภาพันธ์ 2556 — after PSD_2555 (16 ม.ค.) but before MOT_2556 (3 เม.ย.)
    expect(resolveEra(2556, ['PSD_2555', 'MOT_2556'], REGISTRY, '2013-02-01')).toEqual({ lawCode: 'PSD_2555', eraUnresolved: false })
  })

  it('a buildDate on or after the later exact date resolves to the later law', () => {
    expect(resolveEra(2556, ['PSD_2555', 'MOT_2556'], REGISTRY, '2013-04-03')).toEqual({ lawCode: 'MOT_2556', eraUnresolved: false })
    expect(resolveEra(2556, ['PSD_2555', 'MOT_2556'], REGISTRY, '2013-12-31')).toEqual({ lawCode: 'MOT_2556', eraUnresolved: false })
  })

  it('a buildDate before the earlier exact date resolves to the earlier law, flagged provisional', () => {
    // Still พ.ศ. 2556 but before 16 ม.ค. — a real-world impossible date for these two laws, but the
    // resolver must still degrade sanely rather than crash.
    expect(resolveEra(2556, ['PSD_2555', 'MOT_2556'], REGISTRY, '2013-01-01')).toEqual({ lawCode: 'PSD_2555', eraUnresolved: true })
  })

  it('a buildDate that disagrees with a DIFFERENT candidate set (no effectiveDate on either side) falls back to year-only, byte-identical to before this feature existed', () => {
    const yearOnly: EraLawRef[] = [
      { code: 'MHT_2548', buddhistYear: 2548, effectiveYear: null },
      { code: 'MHT_2564', buddhistYear: 2564, effectiveYear: null },
    ]
    expect(resolveEra(2550, ['MHT_2548', 'MHT_2564'], yearOnly, '2013-02-01')).toEqual({ lawCode: 'MHT_2548', eraUnresolved: false })
    expect(resolveEra(2550, ['MHT_2548', 'MHT_2564'], yearOnly)).toEqual(resolveEra(2550, ['MHT_2548', 'MHT_2564'], yearOnly, '2013-02-01'))
  })
})

function defWithLawRef(lawRef: string): ChecklistTemplateDefinition {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      {
        code: 'A1', labelTh: 'group', items: [
          { code: 'A1.1', labelTh: 'leaf', answerType: 'presence', lawRefs: [lawRef] },
        ],
      },
    ],
  }
}

describe('filterApplicableItems — exact-date redaction within the same Buddhist year', () => {
  it('an item gated by MOT_2556 is redacted for a station permitted in early 2556, even though yearBuilt=2556 alone would NOT redact it', () => {
    // Year-only sanity check first: yearBuilt=2556 alone keeps the item (2556 <= 2556).
    const yearOnlyResult = filterApplicableItems(defWithLawRef('MOT_2556'), 2556, REGISTRY)
    expect(yearOnlyResult.groups).toHaveLength(1)

    // With the exact date supplied, a station permitted 1 กุมภาพันธ์ 2556 predates MOT_2556
    // (3 เม.ย. 2556) — the item must now be redacted.
    const dateResult = filterApplicableItems(defWithLawRef('MOT_2556'), 2556, REGISTRY, '2013-02-01')
    expect(dateResult.groups).toHaveLength(0)
  })

  it('the same station date keeps an item gated by PSD_2555 (already in force by 16 ม.ค. 2556)', () => {
    const result = filterApplicableItems(defWithLawRef('PSD_2555'), 2556, REGISTRY, '2013-02-01')
    expect(result.groups).toHaveLength(1)
  })
})

describe('eraYearBrackets — real LAW_REFERENCE_SEED now splits the พ.ศ. 2556 collision into two dated brackets', () => {
  const brackets = eraYearBrackets(LAW_REFERENCE_SEED, new Date('2026-08-05'))

  it('produces 5 brackets (not 4) — PSD_2555 and MOT_2556 no longer collapse into one พ.ศ. 2556 boundary', () => {
    expect(brackets).toHaveLength(5)
  })

  it('the two 2556 brackets share representativeYear but carry distinct representativeDate values', () => {
    const at2556 = brackets.filter((b) => b.representativeYear === 2556)
    expect(at2556).toHaveLength(2)
    expect(at2556[0]!.representativeDate).toBe('2013-01-16')
    expect(at2556[1]!.representativeDate).toBe('2013-04-03')
  })

  it('every bracket is still a valid resolveEra input (round-trips cleanly)', () => {
    for (const b of brackets) {
      expect(() => resolveEra(b.representativeYear, ['MHT_2548', 'MHT_2564'], LAW_REFERENCE_SEED, b.representativeDate)).not.toThrow()
    }
  })
})

describe('buddhistYearOfIsoDate / isValidYearBuiltDate', () => {
  it('converts a Gregorian ISO date to its Buddhist year', () => {
    expect(buddhistYearOfIsoDate('2013-01-16')).toBe(2556)
    expect(buddhistYearOfIsoDate('2021-05-03')).toBe(2564)
  })

  it('accepts a date whose implied Buddhist year matches the supplied yearBuilt', () => {
    expect(isValidYearBuiltDate('2013-01-16', 2556)).toBe(true)
  })

  it('rejects a date whose implied Buddhist year disagrees with the supplied yearBuilt', () => {
    expect(isValidYearBuiltDate('2013-01-16', 2558)).toBe(false)
  })

  it('accepts a date with no yearBuilt to check against', () => {
    expect(isValidYearBuiltDate('2013-01-16', null)).toBe(true)
  })

  it('rejects an unparseable date', () => {
    expect(isValidYearBuiltDate('not-a-date', null)).toBe(false)
  })
})
