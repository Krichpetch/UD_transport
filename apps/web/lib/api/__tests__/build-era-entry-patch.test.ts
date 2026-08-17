// Era-editor safety session — pure-function tests for buildEraEntryPatch, the one place that
// turns a per-law draft into the wire shape both MeasurementEditor.tsx's EraOverridesSection and
// GroupedItemEditDialog.tsx's GroupedEraSection now send. Operator-gated (tiered XOR value/value2)
// so a tiered save can never accidentally carry a stray value/value2, and a gte/lte/range save can
// never carry tiers — either would fail the backend's parseByLawEntry shape check.
import { describe, expect, it } from 'vitest'
import { buildEraEntryPatch } from '../templates'

describe('buildEraEntryPatch', () => {
  it('tiered draft sends only tiers + sourceText, never value/value2', () => {
    const patch = buildEraEntryPatch('tiered', { tiers: [{ min: 1, max: 100, required: 1 }], sourceText: 'ตาราง 2564' })
    expect(patch).toEqual({ tiers: [{ min: 1, max: 100, required: 1 }], sourceText: 'ตาราง 2564' })
  })

  it('tiered draft with no tiers yet defaults to an empty array, not undefined', () => {
    const patch = buildEraEntryPatch('tiered', {})
    expect(patch).toEqual({ tiers: [], sourceText: undefined })
  })

  it('gte draft sends value + null value2, never tiers', () => {
    const patch = buildEraEntryPatch('gte', { value: 800, sourceText: 'อ้างอิง' })
    expect(patch).toEqual({ value: 800, value2: null, sourceText: 'อ้างอิง' })
  })

  it('lte draft normalizes a missing value to null', () => {
    const patch = buildEraEntryPatch('lte', {})
    expect(patch).toEqual({ value: null, value2: null, sourceText: undefined })
  })

  it('range draft carries both value and value2', () => {
    const patch = buildEraEntryPatch('range', { value: 300, value2: 500 })
    expect(patch).toEqual({ value: 300, value2: 500, sourceText: undefined })
  })

  it('a gte draft never carries value2 even if one is present on the draft (non-range operator)', () => {
    const patch = buildEraEntryPatch('gte', { value: 100, value2: 999 })
    expect(patch).toEqual({ value: 100, value2: null, sourceText: undefined })
  })

  it('an empty sourceText string normalizes to undefined, not an empty string', () => {
    const patch = buildEraEntryPatch('gte', { value: 1, sourceText: '' })
    expect(patch.sourceText).toBeUndefined()
  })

  // labelTh (the leaf's own era-specific question text — see resolveMeasurement in
  // era-resolution.ts) follows the exact same pass-through/normalization rules as sourceText.
  it('carries labelTh alongside value/tiers regardless of operator', () => {
    expect(buildEraEntryPatch('gte', { value: 800, labelTh: 'ข้อความใหม่' }).labelTh).toBe('ข้อความใหม่')
    expect(buildEraEntryPatch('tiered', { tiers: [], labelTh: 'ข้อความใหม่' }).labelTh).toBe('ข้อความใหม่')
  })

  it('an empty labelTh string normalizes to undefined, not an empty string', () => {
    const patch = buildEraEntryPatch('gte', { value: 1, labelTh: '' })
    expect(patch.labelTh).toBeUndefined()
  })
})
