import { computeScoreFromItems, scoreToStatus, buildHistogram } from '../scoring'

// Shared fixture: the SAME data the web-parser formula must produce identical results for.
// One group; covers every value class.
const FIXTURE_ITEMS = [
  { value: 'มี',   meetsStandard: true,  flagged: false }, // hasStandard   — in eligible, in numerator
  { value: 'มี',   meetsStandard: true,  flagged: false }, // hasStandard   — in eligible, in numerator
  { value: 'มี',   meetsStandard: false, flagged: false }, // hasSubstandard — in eligible, not in numerator
  { value: 'มี',   meetsStandard: false, flagged: true  }, // bare มี       — EXCLUDED from eligible
  { value: 'มี',   meetsStandard: false, flagged: true  }, // bare มี       — EXCLUDED from eligible
  { value: 'ไม่มี', meetsStandard: false, flagged: false }, // none          — in eligible, not in numerator
  { value: 'N/A',  meetsStandard: false, flagged: false }, // N/A           — EXCLUDED from eligible
  { value: null,   meetsStandard: false, flagged: false }, // null/OTHER    — EXCLUDED from eligible
]

// eligible = standard(2) + substandard(1) + none(1) = 4
// standard = 2
// score    = round(2/4 * 100) = 50
const EXPECTED_SCORE = 50

const FIXTURE_GROUP = [{ items: FIXTURE_ITEMS }]

describe('computeScoreFromItems', () => {
  it('returns 0 for non-array input', () => {
    expect(computeScoreFromItems(null)).toBe(0)
    expect(computeScoreFromItems({})).toBe(0)
    expect(computeScoreFromItems('')).toBe(0)
  })

  it('returns 0 when all items are excluded', () => {
    const items = [{ items: [
      { value: null,  meetsStandard: false, flagged: false },
      { value: 'N/A', meetsStandard: false, flagged: false },
      { value: 'มี',  meetsStandard: false, flagged: true  },
    ] }]
    expect(computeScoreFromItems(items)).toBe(0)
  })

  it('excludes bare-มี (flagged=true) from denominator', () => {
    expect(computeScoreFromItems(FIXTURE_GROUP)).toBe(EXPECTED_SCORE)
  })

  it('excludes N/A from denominator', () => {
    const withoutNa = [{ items: FIXTURE_ITEMS.filter(it => it.value !== 'N/A') }]
    // eligible without N/A: standard(2) + substandard(1) + none(1) = 4 (unchanged)
    expect(computeScoreFromItems(withoutNa)).toBe(EXPECTED_SCORE)
  })

  it('100% when all eligible items meet standard', () => {
    const allGood = [{ items: [
      { value: 'มี', meetsStandard: true,  flagged: false },
      { value: 'มี', meetsStandard: true,  flagged: false },
    ] }]
    expect(computeScoreFromItems(allGood)).toBe(100)
  })

  it('0% when no eligible items meet standard', () => {
    const allBad = [{ items: [
      { value: 'ไม่มี', meetsStandard: false, flagged: false },
      { value: 'ไม่มี', meetsStandard: false, flagged: false },
    ] }]
    expect(computeScoreFromItems(allBad)).toBe(0)
  })

  /**
   * Web-parser formula consistency check.
   *
   * The inline formula in otp-import.ts must produce the same result.
   * This function mirrors that formula exactly — if scoring.ts changes, update both.
   */
  function webParserFormula(groups: { items: { value: string | null; meetsStandard: boolean; flagged?: boolean }[] }[]): number {
    const allItems = groups.flatMap(g => g.items)
    const eligible = allItems.filter(it => it.value !== null && it.value !== 'N/A' && !(it.value === 'มี' && it.flagged))
    const standard = eligible.filter(it => it.value === 'มี' && it.meetsStandard)
    return eligible.length > 0 ? Math.round((standard.length / eligible.length) * 100) : 0
  }

  it('matches web-parser inline formula on shared fixture', () => {
    expect(computeScoreFromItems(FIXTURE_GROUP)).toBe(webParserFormula(FIXTURE_GROUP))
  })

  it('matches web-parser formula on all-zero fixture', () => {
    const zero = [{ items: [{ value: null, meetsStandard: false, flagged: false }] }]
    expect(computeScoreFromItems(zero)).toBe(webParserFormula(zero))
  })

  it('matches web-parser formula on all-passing fixture', () => {
    const allGood = [{ items: [
      { value: 'มี', meetsStandard: true, flagged: false },
      { value: 'มี', meetsStandard: true, flagged: false },
    ] }]
    expect(computeScoreFromItems(allGood)).toBe(webParserFormula(allGood))
  })
})

describe('scoreToStatus', () => {
  it('ผ่านมาตรฐาน at 75', () => expect(scoreToStatus(75)).toBe('ผ่านมาตรฐาน'))
  it('ผ่านมาตรฐาน at 100', () => expect(scoreToStatus(100)).toBe('ผ่านมาตรฐาน'))
  it('ต้องปรับปรุง at 74', () => expect(scoreToStatus(74)).toBe('ต้องปรับปรุง'))
  it('ต้องปรับปรุง at 50', () => expect(scoreToStatus(50)).toBe('ต้องปรับปรุง'))
  it('ไม่ผ่าน at 49', () => expect(scoreToStatus(49)).toBe('ไม่ผ่าน'))
  it('ไม่ผ่าน at 0', () => expect(scoreToStatus(0)).toBe('ไม่ผ่าน'))
})

describe('buildHistogram', () => {
  it('classifies fixture correctly', () => {
    const h = buildHistogram(FIXTURE_GROUP)
    expect(h.hasStandard).toBe(2)
    expect(h.hasSubstandard).toBe(1)
    expect(h.standardUnspecified).toBe(2)  // bare มี = flagged
    expect(h.none).toBe(1)
    expect(h.na).toBe(1)
    expect(h.nullOrOther).toBe(1)
    expect(h.total).toBe(8)
  })
})
