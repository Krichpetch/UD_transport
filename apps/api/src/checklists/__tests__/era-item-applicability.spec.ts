/**
 * E-form redesign (Session E2 follow-up) — filterApplicableItems: build-year "redaction."
 * A criterion required only by a law that postdates the station's construction is removed from
 * the tree entirely (product decision: "hide the item", not merely mark it N/A) — see
 * era-resolution.ts's doc comment for the full applicability rule.
 */
import { filterApplicableItems, type ChecklistTemplateDefinition, type EraLawRef } from '@repo/types'

const REGISTRY: EraLawRef[] = [
  { code: 'MHT_2548', buddhistYear: 2548, effectiveYear: null },
  { code: 'MHT_2564', buddhistYear: 2564, effectiveYear: null },
  { code: 'PROJECT', buddhistYear: 2566, effectiveYear: null },
]

function def(): ChecklistTemplateDefinition {
  return {
    schemaVersion: 2,
    mode: 'ทางราง',
    groups: [
      {
        code: 'A1', labelTh: 'group A1', items: [
          {
            code: 'A1.1', labelTh: 'container', subItems: [
              { code: 'A1.1-1', labelTh: 'requires old law', answerType: 'presence', lawRefs: ['MHT_2548'] },
              { code: 'A1.1-2', labelTh: 'requires new law only', answerType: 'presence', lawRefs: ['MHT_2564'] },
              { code: 'A1.1-3', labelTh: 'beyond-law addition', answerType: 'presence', lawRefs: ['PROJECT'], beyondLaw: true },
              { code: 'A1.1-4', labelTh: 'untagged', answerType: 'presence' },
            ],
          },
        ],
      },
      {
        code: 'A2', labelTh: 'group A2 — entirely new-law', items: [
          { code: 'A2.1', labelTh: 'new-law only item', answerType: 'presence', lawRefs: ['MHT_2564'] },
        ],
      },
    ],
  }
}

describe('filterApplicableItems', () => {
  it('a station built before every law requiring a criterion loses that criterion, keeps the rest', () => {
    const result = filterApplicableItems(def(), 2550, REGISTRY)
    const codes = result.groups[0]!.items[0]!.subItems!.map((n) => n.code)
    expect(codes).toEqual(['A1.1-1', 'A1.1-3', 'A1.1-4']) // A1.1-2 (MHT_2564, 2564 > 2550) is gone
  })

  it('a station built after the newer law keeps everything', () => {
    const result = filterApplicableItems(def(), 2565, REGISTRY)
    const codes = result.groups[0]!.items[0]!.subItems!.map((n) => n.code)
    expect(codes).toEqual(['A1.1-1', 'A1.1-2', 'A1.1-3', 'A1.1-4'])
  })

  it('PROJECT / beyondLaw items are never era-gated, regardless of how old the station is', () => {
    const result = filterApplicableItems(def(), 2400, REGISTRY)
    const codes = result.groups[0]!.items[0]!.subItems!.map((n) => n.code)
    expect(codes).toContain('A1.1-3') // survives even though the station predates every real law
  })

  it('untagged leaves (no lawRefs) are never filtered — no data to judge by, fail open', () => {
    const result = filterApplicableItems(def(), 2400, REGISTRY)
    const codes = result.groups[0]!.items[0]!.subItems!.map((n) => n.code)
    expect(codes).toContain('A1.1-4')
  })

  it('a group left with zero items after filtering is pruned entirely', () => {
    const result = filterApplicableItems(def(), 2500, REGISTRY) // predates MHT_2564 -> A2.1 gone
    expect(result.groups.map((g) => g.code)).toEqual(['A1']) // A2 dropped, not left empty
  })

  it('null/undefined yearBuilt is a no-op — nothing hidden without a year to judge by', () => {
    const result = filterApplicableItems(def(), null, REGISTRY)
    const codes = result.groups[0]!.items[0]!.subItems!.map((n) => n.code)
    expect(codes).toEqual(['A1.1-1', 'A1.1-2', 'A1.1-3', 'A1.1-4'])
    expect(result.groups.map((g) => g.code)).toEqual(['A1', 'A2'])
  })

  it('a hybrid node (own answerType, inapplicable) is dropped wholesale, subItems included', () => {
    const hybridDef: ChecklistTemplateDefinition = {
      schemaVersion: 2, mode: 'ทางราง',
      groups: [{
        code: 'B', labelTh: 'B', items: [{
          code: 'B1', labelTh: 'hybrid, new-law only', answerType: 'presence', lawRefs: ['MHT_2564'],
          subItems: [{ code: 'B1.1', labelTh: 'child', answerType: 'presence' }],
        }],
      }],
    }
    const result = filterApplicableItems(hybridDef, 2500, REGISTRY)
    expect(result.groups).toHaveLength(0) // B1 (and its child) gone, group B left empty -> pruned
  })

  it('does not mutate the input definition', () => {
    const original = def()
    const before = JSON.stringify(original)
    filterApplicableItems(original, 2550, REGISTRY)
    expect(JSON.stringify(original)).toBe(before)
  })
})
