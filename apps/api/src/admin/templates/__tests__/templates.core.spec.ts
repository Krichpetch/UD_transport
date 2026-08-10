import type { ChecklistTemplateDefinition } from '@repo/types'
import { ChecklistTemplateValidationError } from '@repo/types'
import {
  MAX_IMAGES_PER_NODE,
  TemplateEditError,
  acknowledgeConflictSplit,
  addImageKey,
  confirmMeasurement,
  deriveEraOverridesExtract,
  editEraOverride,
  editGuidance,
  editMeasurementValue,
  overwriteLeafData,
  removeImageKey,
  summarizeTemplate,
  unconfirmedMeasurementRows,
} from '../templates.core'

// Synthetic fixture (not real สนข. data — see root CLAUDE.md's confidential-data rule) covering
// one flat gte leaf and one tiered+byLaw leaf, enough surface for every core function below.
function fixture(): ChecklistTemplateDefinition {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      {
        code: 'A1',
        labelTh: 'ที่จอดรถ',
        items: [
          {
            code: 'A1.1',
            labelTh: 'ที่จอดรถสำหรับคนพิการ',
            subItems: [
              {
                code: 'A1.1-1',
                num: '1',
                labelTh: 'ความกว้าง',
                answerType: 'presence_standard',
                guidance: { text: 'guidance text', reference: 'ref1' },
                measurements: [
                  { key: 'm1', operator: 'gte', value: 900, unit: 'mm', autoGrade: true, confirmed: false, extracted: true },
                ],
              },
              {
                code: 'A1.1-2',
                num: '2',
                labelTh: 'จำนวน',
                answerType: 'presence_standard',
                measurements: [
                  {
                    key: 'm1',
                    operator: 'tiered',
                    unit: 'count',
                    autoGrade: true,
                    inputs: [
                      { key: 'basis', labelTh: 'จำนวนที่จอดรถทั้งหมด' },
                      { key: 'provided', labelTh: 'จำนวนที่จอดรถสำหรับคนพิการ' },
                    ],
                    // Flat tiers AND a byLaw override present — lets a byLaw-removal test exercise
                    // the "falls back to the flat table" case, as opposed to A1.1-3 below (byLaw
                    // is the ONLY source of tiers, so removing it must be rejected).
                    tiers: [{ min: 1, max: 100, required: 1 }],
                    byLaw: { MHT_2548: { tiers: [{ min: 10, max: 50, required: 1 }] } },
                    confirmed: false,
                  },
                ],
              },
              {
                code: 'A1.1-3',
                num: '3',
                labelTh: 'จำนวน (byLaw-only)',
                answerType: 'presence_standard',
                measurements: [
                  {
                    key: 'm1',
                    operator: 'tiered',
                    unit: 'count',
                    autoGrade: true,
                    inputs: [
                      { key: 'basis', labelTh: 'จำนวนที่จอดรถทั้งหมด' },
                      { key: 'provided', labelTh: 'จำนวนที่จอดรถสำหรับคนพิการ' },
                    ],
                    byLaw: { MHT_2548: { tiers: [{ min: 10, max: 50, required: 1 }] } },
                    confirmed: false,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

describe('editMeasurementValue', () => {
  it('updates operator/value/unit and sets confirmed:true', () => {
    const { definition, before, after } = editMeasurementValue(fixture(), 'A1.1-1', 'm1', {
      operator: 'lte',
      value: 1200,
      unit: 'mm',
      autoGrade: true,
    })
    expect(before.value).toBe(900)
    expect(before.confirmed).toBe(false)
    expect(after.operator).toBe('lte')
    expect(after.value).toBe(1200)
    expect(after.confirmed).toBe(true)

    const leaf = definition.groups[0]!.items[0]!.subItems![0]!
    expect(leaf.measurements![0]!.operator).toBe('lte')
    expect(leaf.measurements![0]!.value).toBe(1200)
  })

  it('never mutates the input definition (clone discipline)', () => {
    const original = fixture()
    editMeasurementValue(original, 'A1.1-1', 'm1', { operator: 'lte', value: 1200, unit: 'mm', autoGrade: true })
    expect(original.groups[0]!.items[0]!.subItems![0]!.measurements![0]!.value).toBe(900)
  })

  it('throws TemplateEditError for an unknown node code', () => {
    expect(() =>
      editMeasurementValue(fixture(), 'NOPE', 'm1', { operator: 'gte', value: 1, unit: 'mm', autoGrade: true }),
    ).toThrow(TemplateEditError)
  })

  it('throws TemplateEditError for an unknown measurement key', () => {
    expect(() =>
      editMeasurementValue(fixture(), 'A1.1-1', 'nope', { operator: 'gte', value: 1, unit: 'mm', autoGrade: true }),
    ).toThrow(TemplateEditError)
  })

  it('throws ChecklistTemplateValidationError for a structurally invalid patch (range without value2)', () => {
    expect(() =>
      editMeasurementValue(fixture(), 'A1.1-1', 'm1', { operator: 'range', value: 100, unit: 'mm', autoGrade: true }),
    ).toThrow(ChecklistTemplateValidationError)
  })

  it('switching to tiered requires flat tiers or byLaw', () => {
    expect(() =>
      editMeasurementValue(fixture(), 'A1.1-1', 'm1', { operator: 'tiered', unit: 'count', autoGrade: true }),
    ).toThrow(ChecklistTemplateValidationError)
  })
})

describe('confirmMeasurement', () => {
  it('sets confirmed:true without touching the value', () => {
    const { before, after, definition } = confirmMeasurement(fixture(), 'A1.1-1', 'm1')
    expect(before.confirmed).toBe(false)
    expect(after.confirmed).toBe(true)
    expect(definition.groups[0]!.items[0]!.subItems![0]!.measurements![0]!.value).toBe(900)
  })
})

describe('editEraOverride', () => {
  it('adds a new byLaw entry (value2 normalized to null by the shared parser)', () => {
    const { before, after, definition } = editEraOverride(fixture(), 'A1.1-1', 'm1', 'MHT_2564', { value: 800 })
    expect(before).toBeNull()
    expect(after).toEqual({ value: 800, value2: null })
    const m = definition.groups[0]!.items[0]!.subItems![0]!.measurements![0]!
    expect(m.byLaw?.MHT_2564).toEqual({ value: 800, value2: null })
    expect(m.confirmed).toBe(true)
  })

  it('removes a byLaw entry (entry: null) when a flat tiers fallback still covers the measurement', () => {
    const { after, definition } = editEraOverride(fixture(), 'A1.1-2', 'm1', 'MHT_2548', null)
    expect(after).toBeNull()
    const m = definition.groups[0]!.items[0]!.subItems![1]!.measurements![0]!
    expect(m.byLaw).toBeUndefined()
    expect(m.tiers).toEqual([{ min: 1, max: 100, required: 1, incrementPer: undefined, incrementBy: undefined }])
  })

  it('rejects removing the only byLaw entry when no flat tiers fallback exists', () => {
    expect(() => editEraOverride(fixture(), 'A1.1-3', 'm1', 'MHT_2548', null)).toThrow(ChecklistTemplateValidationError)
  })

  // 2026-08-05 — same invariant as applyEraOverrides (era-overrides.ts): a byLaw entry means
  // "this law gives this item a value", which contradicts isItemApplicable redacting the item
  // below that law. A1.1-1 starts with no lawRefs at all (untagged), so this also covers the
  // "lawRefs array doesn't exist yet" branch, not just the append-to-existing-array case.
  it('adds the law code onto the node lawRefs when setting a new byLaw entry', () => {
    const { definition } = editEraOverride(fixture(), 'A1.1-1', 'm1', 'MHT_2564', { value: 800 })
    const node = definition.groups[0]!.items[0]!.subItems![0]!
    expect(node.lawRefs).toEqual(['MHT_2564'])
  })

  it('does not duplicate an already-present lawRef', () => {
    // A1.1-2 already carries MHT_2548 via its byLaw fixture entry — but nothing has unioned it
    // into lawRefs yet in this synthetic fixture, so exercise it directly first.
    const once = editEraOverride(fixture(), 'A1.1-2', 'm1', 'MHT_2548', { tiers: [{ min: 10, max: 50, required: 1 }] })
    const twice = editEraOverride(once.definition, 'A1.1-2', 'm1', 'MHT_2548', { tiers: [{ min: 10, max: 60, required: 1 }] })
    const node = twice.definition.groups[0]!.items[0]!.subItems![1]!
    expect(node.lawRefs).toEqual(['MHT_2548'])
  })

  it('removing a byLaw entry does not strip its lawRef (may still be intentionally gated)', () => {
    const withRef = editEraOverride(fixture(), 'A1.1-1', 'm1', 'MHT_2564', { value: 800 })
    const removed = editEraOverride(withRef.definition, 'A1.1-1', 'm1', 'MHT_2564', null)
    const node = removed.definition.groups[0]!.items[0]!.subItems![0]!
    expect(node.lawRefs).toEqual(['MHT_2564'])
  })
})

describe('editGuidance', () => {
  it('replaces guidance text/reference', () => {
    const { before, after } = editGuidance(fixture(), 'A1.1-1', 'new guidance', 'new-ref')
    expect(before).toEqual({ text: 'guidance text', reference: 'ref1' })
    expect(after).toEqual({ text: 'new guidance', reference: 'new-ref' })
  })
})

describe('image keys', () => {
  it('adds up to MAX_IMAGES_PER_NODE then throws TemplateEditError on the next add', () => {
    let def = fixture()
    for (let i = 0; i < MAX_IMAGES_PER_NODE; i++) {
      const result = addImageKey(def, 'A1.1-1', `template-images/img${i}.jpg`)
      def = result.definition
    }
    const leaf = def.groups[0]!.items[0]!.subItems![0]!
    expect(leaf.imageKeys).toHaveLength(MAX_IMAGES_PER_NODE)
    expect(() => addImageKey(def, 'A1.1-1', 'template-images/one-too-many.jpg')).toThrow(TemplateEditError)
  })

  it('removes a key, and throws for a key that is not attached', () => {
    const { definition } = addImageKey(fixture(), 'A1.1-1', 'template-images/img0.jpg')
    const { after } = removeImageKey(definition, 'A1.1-1', 'template-images/img0.jpg')
    expect(after).toEqual([])
    expect(() => removeImageKey(definition, 'A1.1-1', 'template-images/never-added.jpg')).toThrow(TemplateEditError)
  })

  // Session S4b — re-adding an ALREADY-attached key is a no-op, not a duplicate push or an error.
  // Needed because the grouped editor's image propagation calls addImageKey once per instance with
  // the same already-uploaded key, including the instance the file was originally uploaded to.
  it('adding an already-attached key is a no-op — never pushes a duplicate, even at the cap', () => {
    let def = fixture()
    for (let i = 0; i < MAX_IMAGES_PER_NODE; i++) {
      def = addImageKey(def, 'A1.1-1', `template-images/img${i}.jpg`).definition
    }
    const { after } = addImageKey(def, 'A1.1-1', 'template-images/img0.jpg') // already attached, node is at the cap
    expect(after).toHaveLength(MAX_IMAGES_PER_NODE)
    expect(after.filter((k) => k === 'template-images/img0.jpg')).toHaveLength(1)
  })
})

describe('summarizeTemplate', () => {
  it('counts items/leaves/measurements and confirmed/unconfirmed', () => {
    const summary = summarizeTemplate(fixture())
    expect(summary.itemCount).toBe(1)
    expect(summary.leafCount).toBe(3)
    expect(summary.measurementCount).toBe(3)
    expect(summary.confirmedCount).toBe(0)
    expect(summary.unconfirmedCount).toBe(3)
  })
})

describe('unconfirmedMeasurementRows', () => {
  it('lists all unconfirmed measurements by node code', () => {
    const rows = unconfirmedMeasurementRows(fixture())
    expect(rows.map((r) => r.nodeCode).sort()).toEqual(['A1.1-1', 'A1.1-2', 'A1.1-3'].sort())
  })

  it('excludes a measurement once confirmed', () => {
    const { definition } = confirmMeasurement(fixture(), 'A1.1-1', 'm1')
    const rows = unconfirmedMeasurementRows(definition)
    expect(rows.map((r) => r.nodeCode).sort()).toEqual(['A1.1-2', 'A1.1-3'].sort())
  })
})

describe('deriveEraOverridesExtract', () => {
  it('only includes leaves that carry a byLaw-wrapped measurement', () => {
    const extract = deriveEraOverridesExtract(fixture())
    expect(Object.keys(extract.overrides).sort()).toEqual(['A1.1-2', 'A1.1-3'].sort())
    expect(extract.overrides['A1.1-2']!.measurements).toHaveLength(1)
  })
})

// Session S4b, Part 2 — the facility-grouped editor's conflict-resolution actions.
describe('acknowledgeConflictSplit', () => {
  it('sets conflictSplitAcknowledged:true and never mutates the input', () => {
    const original = fixture()
    const { before, after, definition } = acknowledgeConflictSplit(original, 'A1.1-1')
    expect(before).toBe(false)
    expect(after).toBe(true)
    expect(definition.groups[0]!.items[0]!.subItems![0]!.conflictSplitAcknowledged).toBe(true)
    expect(original.groups[0]!.items[0]!.subItems![0]!.conflictSplitAcknowledged).toBeUndefined()
  })

  it('throws TemplateEditError for an unknown node code', () => {
    expect(() => acknowledgeConflictSplit(fixture(), 'nope')).toThrow(TemplateEditError)
  })
})

describe('overwriteLeafData', () => {
  it('replaces answerType and measurements wholesale, and confirms every copied measurement', () => {
    const target = fixture()
    const source = {
      answerType: 'presence_standard' as const,
      measurements: [{ key: 'm9', operator: 'gte' as const, value: 500, unit: 'mm', autoGrade: true, confirmed: false }],
    }
    const { before, after, definition } = overwriteLeafData(target, 'A1.1-1', source)
    expect(before.answerType).toBe('presence_standard')
    expect(before.measurements).toHaveLength(1)
    expect(after.measurements).toHaveLength(1)
    expect(after.measurements![0]!.key).toBe('m9')
    expect(after.measurements![0]!.confirmed).toBe(true) // a winning copy is admin-reviewed by definition

    const leaf = definition.groups[0]!.items[0]!.subItems![0]!
    expect(leaf.measurements![0]!.value).toBe(500)
  })

  it('never lets the target row share object references with the source', () => {
    const target = fixture()
    const source = { answerType: 'presence_standard' as const, measurements: [{ key: 'm1', operator: 'gte' as const, value: 900, unit: 'mm', autoGrade: true }] }
    const { definition } = overwriteLeafData(target, 'A1.1-1', source)
    definition.groups[0]!.items[0]!.subItems![0]!.measurements![0]!.value = 12345
    expect(source.measurements[0]!.value).toBe(900) // unaffected by mutating the written-back tree
  })

  it('throws TemplateEditError for an unknown node code', () => {
    expect(() => overwriteLeafData(fixture(), 'nope', { answerType: 'presence' })).toThrow(TemplateEditError)
  })
})
