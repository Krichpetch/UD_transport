/**
 * Session F3, Part D — tactile / Guiding Block is never era-gated.
 *
 * สนข. meeting 2026-08-03 (Dr.Aliz): "ตัว Guiding Block และตัว พื้นผิว ไม่ผูกกับปีที่ก่อสร้าง."
 *
 * FACILITY_CATALOG code 5 (พื้นผิวต่างสัมผัส — collapses Warning/Guiding/Positioning tactile
 * variants) lists all four กฎกระทรวง, so before F3 it redacted like anything else: a station built
 * in พ.ศ. 2540 lost every tactile item, because 2540 predates MHT_2548.
 *
 * Scope confirmed as case (a) only — never REDACTED by build year. Case (b) (thresholds never
 * varying by era) is moot: verified 2026-08-04 that no code-5 leaf carries a `byLaw` measurement
 * in any seeded template, and none would gain one from the era-override candidates either.
 * So this touches isItemApplicable ONLY, never resolveEra.
 *
 * Expressed as its own `neverEraGated` flag rather than by reusing `beyondLaw`: these items ARE
 * required by law (their lawRefs stay real and complete), they are simply not gated by build
 * year. beyondLaw means "in no กฎกระทรวง at all" and S3b's lawRefs editor + coverage indicator
 * depend on that meaning — the tests at the bottom pin that separation down.
 */
import {
  filterApplicableItems,
  markApplicability,
  isNeverEraGated,
  FACILITY_CATALOG,
  type ChecklistTemplateDefinition,
  type EraLawRef,
} from '@repo/types'

const REGISTRY: EraLawRef[] = [
  { code: 'MHT_2548', buddhistYear: 2548, effectiveYear: null },
  { code: 'PSD_2555', buddhistYear: 2555, effectiveYear: null },
  { code: 'MOT_2556', buddhistYear: 2556, effectiveYear: null },
  { code: 'MHT_2564', buddhistYear: 2564, effectiveYear: null },
]

// The catalog's real code-5 lawRefs, so the fixture matches what tagLeaves actually stamps.
const TACTILE_LAW_REFS = ['MHT_2548', 'PSD_2555', 'MOT_2556', 'MHT_2564'] as const

function def(): ChecklistTemplateDefinition {
  return {
    schemaVersion: 2,
    mode: 'ทางราง',
    groups: [
      {
        code: 'A1',
        labelTh: 'ที่จอดรถ',
        items: [
          {
            code: 'A1.1',
            labelTh: 'container',
            subItems: [
              {
                code: 'A1.1-1',
                labelTh: 'พื้นผิวต่างสัมผัส ชนิดปูนำทาง (Guiding Tactile)',
                answerType: 'presence',
                facilityCode: 5,
                lawRefs: [...TACTILE_LAW_REFS],
              },
              {
                // Same group, same lawRefs, DIFFERENT facility — the control. Must still redact.
                code: 'A1.1-2',
                labelTh: 'ห้องน้ำสำหรับคนพิการ',
                answerType: 'presence',
                facilityCode: 9,
                lawRefs: [...TACTILE_LAW_REFS],
              },
            ],
          },
        ],
      },
    ],
  }
}

function codesAfterFilter(yearBuilt: number): string[] {
  const out: string[] = []
  const walk = (nodes: NonNullable<ChecklistTemplateDefinition['groups'][number]['items']>) => {
    for (const n of nodes) {
      if (n.answerType) out.push(n.code)
      if (n.subItems) walk(n.subItems)
    }
  }
  for (const g of filterApplicableItems(def(), yearBuilt, REGISTRY).groups) walk(g.items)
  return out
}

describe('Part D — a code-5 (tactile) leaf survives every build year', () => {
  // 2540 predates all four laws; 2547 is one year before the earliest; the rest straddle each.
  it.each([2400, 2500, 2540, 2547, 2548, 2555, 2556, 2564, 2570])(
    'stays applicable at yearBuilt = %i',
    (year) => {
      expect(codesAfterFilter(year)).toContain('A1.1-1')
    },
  )

  it('a non-flagged sibling with the SAME lawRefs still redacts at a pre-law year', () => {
    const codes = codesAfterFilter(2540)
    expect(codes).toContain('A1.1-1')    // tactile — exempt
    expect(codes).not.toContain('A1.1-2') // ห้องน้ำ — redacted, as before F3
  })

  it('both survive once the earliest law is in force (no over-broad exemption)', () => {
    const codes = codesAfterFilter(2548)
    expect(codes).toContain('A1.1-1')
    expect(codes).toContain('A1.1-2')
  })

  it('markApplicability agrees with filterApplicableItems (same isItemApplicable)', () => {
    const marked = markApplicability(def(), 2540, REGISTRY)
    const leaves = marked.groups[0]!.items[0]!.subItems!
    expect(leaves.find((l) => l.code === 'A1.1-1')!.applicable).toBe(true)
    expect(leaves.find((l) => l.code === 'A1.1-2')!.applicable).toBe(false)
  })
})

describe('Part D — the flag is exactly code 5, and is not beyondLaw', () => {
  it('isNeverEraGated is true for 5 and false for everything else in the catalog', () => {
    const flagged = FACILITY_CATALOG.filter((e) => e.neverEraGated).map((e) => e.code)
    expect(flagged).toEqual([5])
    expect(isNeverEraGated(5)).toBe(true)
    expect(isNeverEraGated(9)).toBe(false)
    expect(isNeverEraGated(undefined)).toBe(false)
    expect(isNeverEraGated(null)).toBe(false)
  })

  it('code 5 keeps its real lawRefs — it is in law, just not gated by build year', () => {
    const five = FACILITY_CATALOG.find((e) => e.code === 5)!
    expect(five.lawRefs).toEqual([...TACTILE_LAW_REFS])
    expect(five.lawRefs).not.toContain('PROJECT')
  })

  it('code 5 is NOT marked beyondLaw — that flag keeps its original meaning', () => {
    const five = FACILITY_CATALOG.find((e) => e.code === 5)!
    expect(five.beyondLaw).toBeUndefined()
    // beyondLaw remains exactly the three starred project-only additions (31-33).
    expect(FACILITY_CATALOG.filter((e) => e.beyondLaw).map((e) => e.code)).toEqual([31, 32, 33])
  })

  it('an untagged leaf still fails open, and PROJECT/beyondLaw still exempt independently', () => {
    const mixed: ChecklistTemplateDefinition = {
      schemaVersion: 2,
      mode: 'ทางบก',
      groups: [
        {
          code: 'A1',
          labelTh: 'g',
          items: [
            { code: 'A1.1', labelTh: 'untagged', answerType: 'presence' },
            { code: 'A1.2', labelTh: 'project', answerType: 'presence', lawRefs: ['PROJECT'], beyondLaw: true },
            { code: 'A1.3', labelTh: 'gated', answerType: 'presence', facilityCode: 9, lawRefs: ['MHT_2564'] },
          ],
        },
      ],
    }
    const survivors = filterApplicableItems(mixed, 2540, REGISTRY).groups[0]!.items.map((i) => i.code)
    expect(survivors).toEqual(['A1.1', 'A1.2'])
  })
})
