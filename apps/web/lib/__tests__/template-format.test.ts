// Session S5-fix, Part D.1 — a threshold that never got extracted (both value slots null/missing)
// used to render as a broken "≥- mm" / "-–- mm"; it should read as an honest "no threshold
// specified yet" instead, never a dash standing in for a number.
import { describe, expect, it } from 'vitest'
import { NO_THRESHOLD_LABEL, formatMeasurementValue } from '../template-format'

describe('formatMeasurementValue — Part D.1 honest null rendering', () => {
  it('gte with a null value renders the honest label, not "≥- mm"', () => {
    expect(formatMeasurementValue({ operator: 'gte', value: null, unit: 'mm' })).toBe(NO_THRESHOLD_LABEL)
  })

  it('lte with a missing value renders the honest label', () => {
    expect(formatMeasurementValue({ operator: 'lte', value: undefined, unit: 'mm' })).toBe(NO_THRESHOLD_LABEL)
  })

  it('range with BOTH value and value2 null renders the honest label, not "-–- mm"', () => {
    expect(formatMeasurementValue({ operator: 'range', value: null, value2: null, unit: 'mm' })).toBe(NO_THRESHOLD_LABEL)
  })

  it('range with only ONE side null still shows the partial dash (not conflated with "no threshold")', () => {
    expect(formatMeasurementValue({ operator: 'range', value: 300, value2: null, unit: 'mm' })).toBe('300–- mm')
  })

  it('a real value still renders normally', () => {
    expect(formatMeasurementValue({ operator: 'gte', value: 900, unit: 'mm' })).toBe('≥900 mm')
  })

  it('tiered is unaffected by the null-threshold change', () => {
    expect(formatMeasurementValue({ operator: 'tiered', unit: 'mm', tiers: [{ min: 1, required: 1 }] })).toBe('ตารางขั้นบันได (1 ขั้น)')
  })
})
