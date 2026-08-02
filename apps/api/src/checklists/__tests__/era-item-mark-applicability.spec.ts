/**
 * Session F1, Part C — markApplicability: item-level era redaction that MARKS (applicable:false)
 * instead of deleting (supersedes filterApplicableItems for the audit-template endpoint and the
 * submit-time redaction bake — see era-item-applicability.spec.ts for the older delete-based
 * function, still exported/tested unchanged for any other caller). Same isItemApplicable rule as
 * filterApplicableItems, mirrored here node-for-node so the two never disagree on WHETHER an item
 * applies, only on what happens to it once they decide.
 */
import { markApplicability, type ChecklistTemplateDefinition, type EraLawRef } from '@repo/types'

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
    ],
  }
}

function leaf(result: ChecklistTemplateDefinition, code: string) {
  const found = result.groups[0]!.items[0]!.subItems!.find((n) => n.code === code)
  if (!found) throw new Error(`leaf ${code} not found — markApplicability must never delete nodes`)
  return found
}

describe('markApplicability', () => {
  it('never removes nodes — every leaf survives regardless of applicability', () => {
    const result = markApplicability(def(), 2550, REGISTRY)
    const codes = result.groups[0]!.items[0]!.subItems!.map((n) => n.code)
    expect(codes).toEqual(['A1.1-1', 'A1.1-2', 'A1.1-3', 'A1.1-4'])
  })

  it('flags a leaf whose only law postdates the build year as applicable:false', () => {
    const result = markApplicability(def(), 2550, REGISTRY)
    expect(leaf(result, 'A1.1-2').applicable).toBe(false) // MHT_2564, 2564 > 2550
  })

  it('leaves a leaf whose law is already in force as applicable (true or undefined, never false)', () => {
    const result = markApplicability(def(), 2550, REGISTRY)
    expect(leaf(result, 'A1.1-1').applicable).not.toBe(false)
  })

  it('a station built after the newer law marks everything applicable', () => {
    const result = markApplicability(def(), 2565, REGISTRY)
    for (const code of ['A1.1-1', 'A1.1-2', 'A1.1-3', 'A1.1-4']) {
      expect(leaf(result, code).applicable).not.toBe(false)
    }
  })

  it('PROJECT/beyondLaw and untagged leaves are never marked inapplicable, regardless of build year', () => {
    const result = markApplicability(def(), 2400, REGISTRY)
    expect(leaf(result, 'A1.1-3').applicable).not.toBe(false)
    expect(leaf(result, 'A1.1-4').applicable).not.toBe(false)
  })

  it('null/undefined yearBuilt is a no-op — nothing marked inapplicable without a year to judge by', () => {
    const result = markApplicability(def(), null, REGISTRY)
    for (const code of ['A1.1-1', 'A1.1-2', 'A1.1-3', 'A1.1-4']) {
      expect(leaf(result, code).applicable).not.toBe(false)
    }
  })

  it('a hybrid node (own answerType, inapplicable) forces applicable:false onto every descendant too', () => {
    const hybridDef: ChecklistTemplateDefinition = {
      schemaVersion: 2, mode: 'ทางราง',
      groups: [{
        code: 'B', labelTh: 'B', items: [{
          code: 'B1', labelTh: 'hybrid, new-law only', answerType: 'presence', lawRefs: ['MHT_2564'],
          subItems: [{ code: 'B1.1', labelTh: 'child', answerType: 'presence' }],
        }],
      }],
    }
    const result = markApplicability(hybridDef, 2500, REGISTRY)
    const b1 = result.groups[0]!.items[0]!
    expect(b1.applicable).toBe(false)
    expect(b1.subItems![0]!.applicable).toBe(false) // forced, even though the child itself is untagged
  })

  it('a pure container never carries its own applicable field, only its leaves do', () => {
    const result = markApplicability(def(), 2550, REGISTRY)
    expect(result.groups[0]!.items[0]!.applicable).toBeUndefined()
  })

  it('does not mutate the input definition', () => {
    const original = def()
    const before = JSON.stringify(original)
    markApplicability(original, 2550, REGISTRY)
    expect(JSON.stringify(original)).toBe(before)
  })
})
