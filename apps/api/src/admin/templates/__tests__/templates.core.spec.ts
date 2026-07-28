import type { ChecklistTemplateDefinition } from '@repo/types'
import { ChecklistTemplateValidationError } from '@repo/types'
import {
  MAX_IMAGES_PER_NODE,
  TemplateEditError,
  addImageKey,
  confirmMeasurement,
  deriveEraOverridesExtract,
  editEraOverride,
  editGuidance,
  editMeasurementValue,
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
