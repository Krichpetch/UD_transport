/**
 * 2026-08-05 — regression for the byLaw/lawRefs contradiction found while previewing the water
 * v3 checklist (see memory bug-bylaw-lawrefs-contradiction.md, Notion Open decision #18).
 *
 * A leaf's `byLaw` map (era-overrides.ts) asserts "this law gives this item a value" for a given
 * build year, which only makes sense if isItemApplicable (era-resolution.ts) also considers the
 * item to EXIST under that law. Before this fix, era_overrides files supplied `byLaw` without ever
 * touching the leaf's own `lawRefs` (set earlier, by S3b's lawRefs tagging) — so a leaf could carry
 * byLaw: { MHT_2548: ... } while lawRefs only said ['PSD_2555', 'MOT_2556'], and a station built
 * under MHT_2548 alone (e.g. 2550) would have the item silently redacted despite an explicit
 * MHT_2548 value being defined for it. applyEraOverrides now unions every byLaw code into lawRefs
 * at merge time, so a build year that resolves a value for an item can never simultaneously hide
 * that same item — matches the intended legal model: laws are cumulative, so a station's
 * checklist only grows more items as later laws come into force, never regresses one already shown.
 */
import {
  applyEraOverrides,
  parseTemplateDefinition,
  filterApplicableItems,
  type ChecklistTemplateDefinition,
  type EraLawRef,
} from '@repo/types'

const REGISTRY: EraLawRef[] = [
  { code: 'MHT_2548', buddhistYear: 2548, effectiveYear: null },
  { code: 'PSD_2555', buddhistYear: 2555, effectiveYear: 2556 },
  { code: 'MOT_2556', buddhistYear: 2556, effectiveYear: 2556 },
  { code: 'MHT_2564', buddhistYear: 2564, effectiveYear: 2564 },
]

// Mirrors the real water v3 shape: A1.1-1.5 tagged with PSD_2555/MOT_2556 lawRefs (S3b), then an
// era override (F3) adds a byLaw group spanning MHT_2548 -> MHT_2564 without ever having named
// MHT_2548 in lawRefs.
function baseDef(): ChecklistTemplateDefinition {
  return parseTemplateDefinition({
    schemaVersion: 2,
    mode: 'ทางน้ำ',
    groups: [
      {
        code: 'A1',
        labelTh: 'group',
        items: [
          {
            code: 'A1.1',
            labelTh: 'container',
            subItems: [
              {
                code: 'A1.1-1.5',
                labelTh: 'ramp edge height',
                answerType: 'presence_standard',
                lawRefs: ['PSD_2555', 'MOT_2556'],
                measurements: [
                  { key: 'm1', operator: 'gte', unit: 'mm', value: 50, autoGrade: true, confirmed: false },
                ],
              },
            ],
          },
        ],
      },
    ],
  })
}

const WATER_OVERRIDE = {
  overrides: {
    'A1.1-1.5': {
      measurements: [
        {
          key: 'm1',
          operator: 'gte',
          unit: 'mm',
          autoGrade: true,
          confirmed: false,
          byLaw: { MHT_2548: { value: 50 }, MHT_2564: { value: 100 } },
        },
      ],
    },
  },
}

describe('applyEraOverrides — unions byLaw codes into lawRefs', () => {
  it('adds byLaw-only codes onto the leaf lawRefs, without dropping the pre-existing ones', () => {
    const merged = applyEraOverrides(baseDef(), WATER_OVERRIDE)
    const leaf = merged.groups[0]!.items[0]!.subItems![0]!
    expect(leaf.lawRefs).toEqual(expect.arrayContaining(['PSD_2555', 'MOT_2556', 'MHT_2548', 'MHT_2564']))
    expect(leaf.lawRefs).toHaveLength(4)
  })

  it('is idempotent — re-applying the same override does not duplicate lawRefs', () => {
    const once = applyEraOverrides(baseDef(), WATER_OVERRIDE)
    const twice = applyEraOverrides(once, WATER_OVERRIDE)
    expect(twice.groups[0]!.items[0]!.subItems![0]!.lawRefs).toEqual(once.groups[0]!.items[0]!.subItems![0]!.lawRefs)
  })

  it('the water bug: a 2548-era station no longer loses A1.1-1.5 (was vanishing before this fix)', () => {
    const merged = applyEraOverrides(baseDef(), WATER_OVERRIDE)
    const result = filterApplicableItems(merged, 2550, REGISTRY)
    const codes = result.groups[0]!.items[0]!.subItems!.map((n) => n.code)
    expect(codes).toEqual(['A1.1-1.5'])
  })

  it('nothing regresses across brackets — every later build year keeps every earlier item', () => {
    const merged = applyEraOverrides(baseDef(), WATER_OVERRIDE)
    const years = [2549, 2555, 2556, 2564, 2570]
    let previousCodes: string[] = []
    for (const year of years) {
      const result = filterApplicableItems(merged, year, REGISTRY)
      const codes = result.groups[0]?.items[0]?.subItems?.map((n) => n.code) ?? []
      for (const code of previousCodes) {
        expect(codes).toContain(code) // monotonic: once visible, an item stays visible at every later year
      }
      previousCodes = codes
    }
    expect(previousCodes).toEqual(['A1.1-1.5'])
  })
})
