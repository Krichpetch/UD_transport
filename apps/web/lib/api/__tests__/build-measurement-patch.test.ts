// Era-editor safety session, Part A.5 — pure-function tests for buildMeasurementPatch, the flat/
// base-measurement sibling of buildEraEntryPatch. Closes the bug where GroupedMeasurementCard.save()
// had no tier state at all and silently couldn't carry tiers even though the DTO already supported
// them (facility-groups.service.ts's editMeasurementValue always did a correct full-replace).
import { describe, expect, it } from 'vitest'
import { buildMeasurementPatch } from '../templates'

describe('buildMeasurementPatch', () => {
  it('tiered draft sends operator/tiers/unit/autoGrade/sourceText, never value/value2', () => {
    const patch = buildMeasurementPatch('tiered', { tiers: [{ min: 1, max: 100, required: 1 }], unit: 'count', sourceText: 'ref' })
    expect(patch).toEqual({ operator: 'tiered', tiers: [{ min: 1, max: 100, required: 1 }], unit: 'count', autoGrade: true, sourceText: 'ref' })
  })

  it('tiered draft with no tiers yet defaults to an empty array', () => {
    const patch = buildMeasurementPatch('tiered', { unit: 'count' })
    expect(patch).toEqual({ operator: 'tiered', tiers: [], unit: 'count', autoGrade: true, sourceText: undefined })
  })

  it('gte draft normalizes an empty-string value to null', () => {
    const patch = buildMeasurementPatch('gte', { value: '', unit: 'mm' })
    expect(patch).toEqual({ operator: 'gte', value: null, value2: undefined, unit: 'mm', autoGrade: true, sourceText: undefined })
  })

  it('gte draft carries a real value, value2 stays undefined (not applicable to this operator)', () => {
    const patch = buildMeasurementPatch('gte', { value: 900, unit: 'mm' })
    expect(patch).toEqual({ operator: 'gte', value: 900, value2: undefined, unit: 'mm', autoGrade: true, sourceText: undefined })
  })

  it('range draft carries both value and value2, empty strings normalized to null', () => {
    const patch = buildMeasurementPatch('range', { value: 300, value2: '', unit: 'mm' })
    expect(patch).toEqual({ operator: 'range', value: 300, value2: null, unit: 'mm', autoGrade: true, sourceText: undefined })
  })

  it('an empty sourceText string normalizes to undefined', () => {
    const patch = buildMeasurementPatch('gte', { value: 1, unit: 'mm', sourceText: '' })
    expect(patch.sourceText).toBeUndefined()
  })
})
