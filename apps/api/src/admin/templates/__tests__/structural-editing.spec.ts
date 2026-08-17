/**
 * Session S3b, Part C — structural editing core logic (DRAFT-only gating is enforced one layer
 * up, in templates.service.ts#applyStructuralEdit; these are the pure tree-editing functions
 * exercised directly, same convention as templates.core.spec.ts).
 */
import type { ChecklistTemplateDefinition } from '@repo/types'
import {
  TemplateEditError,
  addChildNode,
  addMeasurement,
  deleteNode,
  deriveEraOverridesExtract,
  editEraOverride,
  editNodeLabel,
  reorderMeasurement,
  reorderNode,
  setNodeQuestionType,
} from '../templates.core'

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
              { code: 'A1.1-1', num: '1', labelTh: 'ทางลาด', answerType: 'presence' },
              { code: 'A1.1-2', num: '2', labelTh: 'ป้าย', answerType: 'presence' },
            ],
          },
          { code: 'A1.2', labelTh: 'ห้องน้ำ', answerType: 'presence' },
        ],
      },
    ],
  }
}

describe('setNodeQuestionType — Part C.2 type switch', () => {
  it('presence -> measured requires no confirm and sets answerType to presence_standard', () => {
    const def = fixture()
    const result = setNodeQuestionType(def, 'A1.1-1', 'measured', false)
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.answerType).toBe('presence_standard')
  })

  it('measured (with an existing measurement) -> presence requires confirmDowngrade', () => {
    let def = fixture()
    def = addMeasurement(def, 'A1.1-1', { operator: 'gte', value: 900, unit: 'mm', autoGrade: true }).definition

    expect(() => setNodeQuestionType(def, 'A1.1-1', 'presence', false)).toThrow(TemplateEditError)

    const confirmed = setNodeQuestionType(def, 'A1.1-1', 'presence', true)
    const node = confirmed.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.answerType).toBe('presence')
    expect(node.measurements).toBeUndefined()
  })

  it('measured -> presence_standard (bare) also requires confirm when measurements exist', () => {
    let def = fixture()
    def = addMeasurement(def, 'A1.1-2', { operator: 'lte', value: 5, unit: 'count', autoGrade: true }).definition
    expect(() => setNodeQuestionType(def, 'A1.1-2', 'presence_standard', false)).toThrow(TemplateEditError)
    const after = setNodeQuestionType(def, 'A1.1-2', 'presence_standard', true)
    const node = after.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-2')!
    expect(node.measurements).toBeUndefined()
  })
})

describe('addMeasurement — Part C.3 anchor persistence + tiered round-trip', () => {
  it('persists sourceText (the anchor) on a brand-new measurement', () => {
    const def = fixture()
    const result = addMeasurement(def, 'A1.1-1', {
      operator: 'gte', value: 900, unit: 'mm', autoGrade: true, sourceText: 'ความกว้างไม่น้อยกว่า',
    })
    expect(result.after.sourceText).toBe('ความกว้างไม่น้อยกว่า')
    expect(result.after.confirmed).toBe(true)
    expect(result.after.extracted).toBe(false)
  })

  it('round-trips a tiered threshold end to end', () => {
    const def = fixture()
    const tiers = [{ min: 1, max: 100, required: 1 }, { min: 101, max: null, required: 2 }]
    const inputs = [{ key: 'basis', labelTh: 'จำนวนทั้งหมด' }, { key: 'provided', labelTh: 'จำนวนที่มี' }]
    const result = addMeasurement(def, 'A1.1-1', { operator: 'tiered', tiers, inputs, unit: 'count', autoGrade: true })
    expect(result.after.operator).toBe('tiered')
    expect(result.after.tiers).toEqual(tiers)
    // Re-reading the leaf from the returned (re-validated) definition agrees with `after`.
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.measurements![0]!.tiers).toEqual(tiers)
  })

  it('assigns non-colliding keys across multiple measurements on the same leaf', () => {
    let def = fixture()
    def = addMeasurement(def, 'A1.1-1', { operator: 'gte', value: 1, unit: 'mm', autoGrade: true }).definition
    const second = addMeasurement(def, 'A1.1-1', { operator: 'lte', value: 2, unit: 'mm', autoGrade: true })
    expect(second.key).toBe('m2')
  })

  it('forces answerType to presence_standard even if the leaf was presence', () => {
    const def = fixture()
    const result = addMeasurement(def, 'A1.2', { operator: 'gte', value: 1, unit: 'mm', autoGrade: true })
    expect(result.definition.groups[0]!.items[1]!.answerType).toBe('presence_standard')
  })
})

describe('addMeasurement + editEraOverride — Part C.3.c era-fork export round-trip', () => {
  it('a flat measurement forked to byLaw survives deriveEraOverridesExtract unchanged', () => {
    let def = fixture()
    def = addMeasurement(def, 'A1.1-1', { operator: 'gte', value: 900, unit: 'mm', autoGrade: true }).definition
    def = editEraOverride(def, 'A1.1-1', 'm1', 'MHT_2548', { value: 800, value2: null }).definition

    const extract = deriveEraOverridesExtract(def)
    expect(extract.overrides['A1.1-1']).toBeDefined()
    const measurement = (extract.overrides['A1.1-1']!.measurements[0] as { byLaw: Record<string, unknown> })
    expect(measurement.byLaw.MHT_2548).toEqual({ value: 800, value2: null })
  })
})

describe('addChildNode — Part C.4 append-only code assignment', () => {
  it('assigns the next free number under an item using "-" separator', () => {
    const def = fixture()
    const result = addChildNode(def, 'A1.1', { labelTh: 'ใหม่', type: 'presence' })
    expect(result.code).toBe('A1.1-3') // A1.1-1, A1.1-2 already exist
  })

  it('assigns using "." separator one level deeper (under a criterion)', () => {
    const def = fixture()
    const result = addChildNode(def, 'A1.1-1', { labelTh: 'ย่อย', type: 'presence' })
    expect(result.code).toBe('A1.1-1.1')
  })

  it('never reuses a deleted code — codes are append-only per parent', () => {
    let def = fixture()
    const first = addChildNode(def, 'A1.1', { labelTh: 'หนึ่ง', type: 'presence' })
    def = first.definition
    expect(first.code).toBe('A1.1-3')

    def = deleteNode(def, first.code).definition

    const second = addChildNode(def, 'A1.1', { labelTh: 'สอง', type: 'presence' })
    expect(second.code).toBe('A1.1-4') // NOT A1.1-3 again
  })

  it('creates the child with an initial threshold + lawRefs in one call', () => {
    const def = fixture()
    const result = addChildNode(def, 'A1.1', {
      labelTh: 'มีเกณฑ์',
      type: 'measured',
      threshold: { operator: 'gte', value: 5, unit: 'mm', autoGrade: true },
      lawRefs: ['MHT_2548'],
    })
    const child = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === result.code)!
    expect(child.answerType).toBe('presence_standard')
    expect(child.measurements).toHaveLength(1)
    expect(child.lawRefs).toEqual(['MHT_2548'])
  })
})

describe('deleteNode — Part C.4', () => {
  it('removes the node and reports its subtree leaf count', () => {
    const def = fixture()
    const result = deleteNode(def, 'A1.1-1')
    expect(result.subtreeLeafCount).toBe(1)
    const remaining = result.definition.groups[0]!.items[0]!.subItems!.map((n) => n.code)
    expect(remaining).toEqual(['A1.1-2'])
  })

  it('throws on an unknown code', () => {
    const def = fixture()
    expect(() => deleteNode(def, 'Z9.9')).toThrow(TemplateEditError)
  })
})

describe('editNodeLabel — Part C follow-up (question text editing)', () => {
  it('updates labelTh and num, never touching code', () => {
    const def = fixture()
    const result = editNodeLabel(def, 'A1.1-1', 'ทางลาดใหม่', '1ก')
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.labelTh).toBe('ทางลาดใหม่')
    expect(node.num).toBe('1ก')
    expect(node.code).toBe('A1.1-1')
  })

  it('reports before/after for the audit log', () => {
    const def = fixture()
    const result = editNodeLabel(def, 'A1.1-1', 'ใหม่')
    expect(result.before).toEqual({ labelTh: 'ทางลาด', num: '1' })
    expect(result.after.labelTh).toBe('ใหม่')
  })

  it('throws on an unknown code', () => {
    const def = fixture()
    expect(() => editNodeLabel(def, 'Z9.9', 'x')).toThrow(TemplateEditError)
  })
})

describe('reorderMeasurement — Part C follow-up (measurement display order)', () => {
  function twoMeasurementFixture(): ChecklistTemplateDefinition {
    let def = fixture()
    def = addMeasurement(def, 'A1.1-1', { operator: 'gte', value: 900, unit: 'mm', autoGrade: true }).definition
    def = addMeasurement(def, 'A1.1-1', { operator: 'gte', value: 1200, unit: 'mm', autoGrade: true }).definition
    return def
  }

  it('moves a measurement up, swapping with the previous one', () => {
    const def = twoMeasurementFixture()
    const result = reorderMeasurement(def, 'A1.1-1', 'm2', 'up')
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.measurements!.map((m) => m.key)).toEqual(['m2', 'm1'])
  })

  it('never renumbers keys — only positions change', () => {
    const def = twoMeasurementFixture()
    const result = reorderMeasurement(def, 'A1.1-1', 'm2', 'up')
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.measurements!.map((m) => m.value)).toEqual([1200, 900])
  })

  it('is a no-op at the edge', () => {
    const def = twoMeasurementFixture()
    const result = reorderMeasurement(def, 'A1.1-1', 'm1', 'up')
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.measurements!.map((m) => m.key)).toEqual(['m1', 'm2'])
  })

  it('throws on an unknown measurement key', () => {
    const def = twoMeasurementFixture()
    expect(() => reorderMeasurement(def, 'A1.1-1', 'm99', 'up')).toThrow(TemplateEditError)
  })
})

describe('reorderNode — Part C.4 reorder persistence', () => {
  // Era-editor safety follow-up (live feedback, 2026-08-17) — codes are now PINNED TO THE SLOT:
  // moving a node swaps its content onto the sibling's former code, not the other way around, so
  // code order always stays monotonic with display order (a printed line number, not an opaque id
  // that drifts out of sequence the moment something moves past it).
  it('moves a node up: content swaps, but codes stay pinned to their slot (ascending)', () => {
    const def = fixture()
    const result = reorderNode(def, 'A1.1-2', 'up')
    const subItems = result.definition.groups[0]!.items[0]!.subItems!
    expect(subItems.map((n) => n.code)).toEqual(['A1.1-1', 'A1.1-2'])
    // A1.1-2's content ('ป้าย') is now displayed first, under the code that used to be A1.1-1's.
    expect(subItems.map((n) => n.labelTh)).toEqual(['ป้าย', 'ทางลาด'])
  })

  it('reports the moved content\'s new code via movedToCode', () => {
    const def = fixture()
    const result = reorderNode(def, 'A1.1-2', 'up')
    expect(result.movedToCode).toBe('A1.1-1')
  })

  it('is a no-op at the top edge (moving the first sibling up)', () => {
    const def = fixture()
    const result = reorderNode(def, 'A1.1-1', 'up')
    const subItems = result.definition.groups[0]!.items[0]!.subItems!
    expect(subItems.map((n) => n.code)).toEqual(['A1.1-1', 'A1.1-2'])
    expect(subItems.map((n) => n.labelTh)).toEqual(['ทางลาด', 'ป้าย'])
    expect(result.movedToCode).toBe('A1.1-1')
  })

  it('throws on an unknown code', () => {
    const def = fixture()
    expect(() => reorderNode(def, 'Z9.9', 'up')).toThrow(TemplateEditError)
  })

  it('cascades the rename onto descendants when the moved node has its own subItems', () => {
    const def = fixture()
    // Top-level: A1.1 (has subItems A1.1-1/A1.1-2) moves down past the leaf A1.2.
    const result = reorderNode(def, 'A1.1', 'down')
    const items = result.definition.groups[0]!.items

    expect(items.map((n) => n.code)).toEqual(['A1.1', 'A1.2'])
    // A1.2's old content (the leaf 'ห้องน้ำ') now sits under code A1.1, with no subItems.
    expect(items[0]!.labelTh).toBe('ห้องน้ำ')
    expect(items[0]!.subItems).toBeUndefined()
    // A1.1's old content now sits under code A1.2, and its OWN subItems were renumbered onto the
    // new A1.2- prefix so they still nest correctly under their (relocated) parent's code.
    expect(items[1]!.labelTh).toBe('ที่จอดรถสำหรับคนพิการ')
    expect(items[1]!.subItems!.map((n) => n.code)).toEqual(['A1.2-1', 'A1.2-2'])
    expect(items[1]!.subItems!.map((n) => n.labelTh)).toEqual(['ทางลาด', 'ป้าย'])
    expect(result.movedToCode).toBe('A1.2')
  })
})
