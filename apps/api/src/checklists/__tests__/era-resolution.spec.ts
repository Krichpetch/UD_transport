/**
 * E-form redesign (Session E2, Part A) — resolveEra / resolveTemplateEras / tiered-grading tests.
 * Pure-function tests against @repo/types; no DB. The A1.1-1 / MHT_2548 vs MHT_2564 example
 * mirrors apps/docs/Checklist_Utils/era_overrides_rail.json's one real override entry.
 */
import {
  resolveEra,
  resolveTemplateEras,
  EraResolutionError,
  isValidYearBuilt,
  YEAR_BUILT_MIN,
  yearBuiltMax,
  tierRequiredFor,
  passesTiered,
  deriveMeasuredStandard,
  type ChecklistTemplateDefinition,
  type EraLawRef,
} from '@repo/types'

const REGISTRY: EraLawRef[] = [
  { code: 'MHT_2548', buddhistYear: 2548, effectiveYear: null },
  { code: 'MHT_2564', buddhistYear: 2564, effectiveYear: null },
]

describe('resolveEra', () => {
  it('picks the latest law whose year <= yearBuilt', () => {
    expect(resolveEra(2550, ['MHT_2548', 'MHT_2564'], REGISTRY)).toEqual({ lawCode: 'MHT_2548', eraUnresolved: false })
    expect(resolveEra(2565, ['MHT_2548', 'MHT_2564'], REGISTRY)).toEqual({ lawCode: 'MHT_2564', eraUnresolved: false })
  })

  it('resolves exactly at a law\'s boundary year to that law', () => {
    expect(resolveEra(2564, ['MHT_2548', 'MHT_2564'], REGISTRY)).toEqual({ lawCode: 'MHT_2564', eraUnresolved: false })
    expect(resolveEra(2563, ['MHT_2548', 'MHT_2564'], REGISTRY)).toEqual({ lawCode: 'MHT_2548', eraUnresolved: false })
  })

  it('yearBuilt below the oldest law applies the oldest, flagged eraUnresolved', () => {
    expect(resolveEra(2500, ['MHT_2548', 'MHT_2564'], REGISTRY)).toEqual({ lawCode: 'MHT_2548', eraUnresolved: true })
  })

  it('yearBuilt null/undefined applies the latest, flagged eraUnresolved', () => {
    expect(resolveEra(null, ['MHT_2548', 'MHT_2564'], REGISTRY)).toEqual({ lawCode: 'MHT_2564', eraUnresolved: true })
    expect(resolveEra(undefined, ['MHT_2548', 'MHT_2564'], REGISTRY)).toEqual({ lawCode: 'MHT_2564', eraUnresolved: true })
  })

  it('falls back to buddhistYear when effectiveYear is null (current registry state)', () => {
    // Both REGISTRY rows have effectiveYear: null — this IS the fallback path, not a special case.
    expect(resolveEra(2564, ['MHT_2548', 'MHT_2564'], REGISTRY).lawCode).toBe('MHT_2564')
  })

  it('prefers effectiveYear over buddhistYear when both are set', () => {
    const withEffective: EraLawRef[] = [
      { code: 'A', buddhistYear: 2500, effectiveYear: 2560 },
      { code: 'B', buddhistYear: 2510, effectiveYear: 2540 },
    ]
    // By buddhistYear, B (2510) < A (2500) would be false — but effectiveYear says B(2540) < A(2560).
    expect(resolveEra(2550, ['A', 'B'], withEffective)).toEqual({ lawCode: 'B', eraUnresolved: false })
  })

  it('throws when no registry law matches the candidate codes', () => {
    expect(() => resolveEra(2560, ['UNKNOWN_CODE'], REGISTRY)).toThrow(EraResolutionError)
  })
})

describe('isValidYearBuilt', () => {
  const now = new Date('2026-07-21')
  it('accepts the sanity range', () => {
    expect(isValidYearBuilt(YEAR_BUILT_MIN, now)).toBe(true)
    expect(isValidYearBuilt(yearBuiltMax(now), now)).toBe(true)
  })
  it('rejects out-of-range and non-integer years', () => {
    expect(isValidYearBuilt(YEAR_BUILT_MIN - 1, now)).toBe(false)
    expect(isValidYearBuilt(yearBuiltMax(now) + 1, now)).toBe(false)
    expect(isValidYearBuilt(2550.5, now)).toBe(false)
  })
})

describe('resolveTemplateEras — A1.1-1 parking-tier example (rail, MHT_2548 vs MHT_2564)', () => {
  const templateDef: ChecklistTemplateDefinition = {
    schemaVersion: 2,
    mode: 'ทางราง',
    groups: [{
      code: 'A1', labelTh: 'ที่จอดรถ', items: [{
        code: 'A1.1', labelTh: 'ที่จอดรถสำหรับคนพิการ', subItems: [{
          code: 'A1.1-1', labelTh: 'กำหนดให้มีที่จอดรถสำหรับคนพิการ',
          answerType: 'presence_standard',
          measurements: [{
            key: 'm1', operator: 'tiered', unit: 'count', autoGrade: true,
            inputs: [{ key: 'basis', labelTh: 'total' }, { key: 'provided', labelTh: 'provided' }],
            byLaw: {
              MHT_2548: { tiers: [
                { min: 10, max: 50, required: 1 },
                { min: 51, max: 100, required: 2 },
                { min: 101, required: 2, incrementPer: 100, incrementBy: 1 },
              ] },
              MHT_2564: { tiers: [
                { min: 1, max: 25, required: 1 },
                { min: 26, max: 50, required: 2 },
                { min: 51, required: 2, incrementPer: 100, incrementBy: 1 },
              ] },
            },
          }],
        }],
      }],
    }],
  }

  it('a station built in 2550 resolves to the MHT_2548 tier table', () => {
    const { resolved, appliedLawRefs, eraUnresolved } = resolveTemplateEras(templateDef, 2550, REGISTRY)
    expect(eraUnresolved).toBe(false)
    expect(appliedLawRefs['A1.1-1#m1']).toBe('MHT_2548')
    const leaf = resolved.groups[0]!.items[0]!.subItems![0]!
    expect(leaf.measurements![0]!.byLaw).toBeUndefined() // stripped — client never sees byLaw
    expect(leaf.measurements![0]!.tiers).toEqual([
      { min: 10, max: 50, required: 1 },
      { min: 51, max: 100, required: 2 },
      { min: 101, required: 2, incrementPer: 100, incrementBy: 1 },
    ])
  })

  it('a station built in 2565 resolves to the MHT_2564 tier table — a DIFFERENT required count for the same basis', () => {
    const { resolved, appliedLawRefs } = resolveTemplateEras(templateDef, 2565, REGISTRY)
    expect(appliedLawRefs['A1.1-1#m1']).toBe('MHT_2564')
    const leaf = resolved.groups[0]!.items[0]!.subItems![0]!
    expect(leaf.measurements![0]!.tiers![1]).toEqual({ min: 26, max: 50, required: 2 })
  })

  it('required parking count for the SAME basis (30 total spots) differs by era', () => {
    const r2550 = resolveTemplateEras(templateDef, 2550, REGISTRY).resolved
    const r2565 = resolveTemplateEras(templateDef, 2565, REGISTRY).resolved
    const tiers2550 = r2550.groups[0]!.items[0]!.subItems![0]!.measurements![0]!.tiers!
    const tiers2565 = r2565.groups[0]!.items[0]!.subItems![0]!.measurements![0]!.tiers!
    expect(tierRequiredFor(tiers2550, 30)).toBe(1) // 2548 table: 10-50 -> 1
    expect(tierRequiredFor(tiers2565, 30)).toBe(2) // 2564 table: 26-50 -> 2
  })

  it('null yearBuilt resolves provisionally to the latest law and flags eraUnresolved', () => {
    const { eraUnresolved, appliedLawRefs } = resolveTemplateEras(templateDef, null, REGISTRY)
    expect(eraUnresolved).toBe(true)
    expect(appliedLawRefs['A1.1-1#m1']).toBe('MHT_2564')
  })

  it('deriveMeasuredStandard grades a resolved leaf using the era-appropriate tiers', () => {
    const leaf2550 = resolveTemplateEras(templateDef, 2550, REGISTRY).resolved.groups[0]!.items[0]!.subItems![0]!
    // 2548 table, basis=30 -> required 1
    expect(deriveMeasuredStandard(leaf2550.measurements, { basis: 30, provided: 1 })).toBe(true)
    expect(deriveMeasuredStandard(leaf2550.measurements, { basis: 30, provided: 0 })).toBe(false)
  })
})

describe('tierRequiredFor / passesTiered — boundary + increment arithmetic', () => {
  const tiers = [
    { min: 10, max: 50, required: 1 },
    { min: 51, max: 100, required: 2 },
    { min: 101, required: 2, incrementPer: 100, incrementBy: 1 },
  ]

  it('returns the exact tier at every boundary', () => {
    expect(tierRequiredFor(tiers, 10)).toBe(1)
    expect(tierRequiredFor(tiers, 50)).toBe(1)
    expect(tierRequiredFor(tiers, 51)).toBe(2)
    expect(tierRequiredFor(tiers, 100)).toBe(2)
    expect(tierRequiredFor(tiers, 101)).toBe(2)
  })

  it('extends the open-ended top tier by incrementBy every incrementPer over min', () => {
    expect(tierRequiredFor(tiers, 200)).toBe(2)  // floor((200-101)/100)=0
    expect(tierRequiredFor(tiers, 201)).toBe(3)  // floor((201-101)/100)=1
    expect(tierRequiredFor(tiers, 300)).toBe(3)
    expect(tierRequiredFor(tiers, 301)).toBe(4)
  })

  it('returns null for a basis below every tier', () => {
    expect(tierRequiredFor(tiers, 5)).toBeNull()
  })

  it('passesTiered compares provided against the looked-up required count', () => {
    expect(passesTiered(tiers, 30, 1)).toBe(true)
    expect(passesTiered(tiers, 30, 0)).toBe(false)
    expect(passesTiered(tiers, 5, 0)).toBeNull()
  })
})
