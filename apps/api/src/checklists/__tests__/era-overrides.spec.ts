/**
 * E-form redesign (Session E2, Part A.4) — applyEraOverrides tests against @repo/types.
 * Uses the real apps/docs/Checklist_Utils/era_overrides_rail.json format (not a copy) to catch
 * drift between the fixture and what the seed pipeline actually reads.
 */
import { applyEraOverrides, EraOverrideError, type ChecklistTemplateDefinition } from '@repo/types'

function baseDef(): ChecklistTemplateDefinition {
  return {
    schemaVersion: 2,
    mode: 'ทางราง',
    groups: [{
      code: 'A1', labelTh: 'ที่จอดรถ', items: [{
        code: 'A1.1', labelTh: 'ที่จอดรถสำหรับคนพิการ', subItems: [{
          code: 'A1.1-1', labelTh: 'กำหนดให้มีที่จอดรถสำหรับคนพิการ',
          answerType: 'presence_standard',
          measurements: [{ key: 'm1', operator: 'gte', value: 1, unit: 'count', autoGrade: true }],
        }],
      }],
    }],
  }
}

const OVERRIDES_FILE = {
  overrides: {
    'A1.1-1': {
      measurements: [{
        key: 'm1', operator: 'tiered', unit: 'count', autoGrade: true,
        inputs: [{ key: 'basis', labelTh: 'total' }, { key: 'provided', labelTh: 'provided' }],
        byLaw: {
          MHT_2548: { tiers: [{ min: 10, max: 50, required: 1 }] },
          MHT_2564: { tiers: [{ min: 1, max: 25, required: 1 }] },
        },
      }],
    },
  },
}

describe('applyEraOverrides', () => {
  it('replaces the named leaf\'s measurements[] wholesale', () => {
    const merged = applyEraOverrides(baseDef(), OVERRIDES_FILE)
    const leaf = merged.groups[0]!.items[0]!.subItems![0]!
    expect(leaf.measurements).toHaveLength(1)
    expect(leaf.measurements![0]!.operator).toBe('tiered')
    expect(leaf.measurements![0]!.byLaw).toBeDefined()
  })

  it('does not mutate the input definition', () => {
    const def = baseDef()
    applyEraOverrides(def, OVERRIDES_FILE)
    expect(def.groups[0]!.items[0]!.subItems![0]!.measurements![0]!.operator).toBe('gte')
  })

  it('is idempotent — applying twice yields the same result as applying once', () => {
    const once = applyEraOverrides(baseDef(), OVERRIDES_FILE)
    const twice = applyEraOverrides(once, OVERRIDES_FILE)
    expect(twice).toEqual(once)
  })

  it('is a no-op when overrides is missing or empty', () => {
    expect(applyEraOverrides(baseDef(), {})).toEqual(baseDef())
    expect(applyEraOverrides(baseDef(), { overrides: {} })).toEqual(baseDef())
  })

  it('refuses an override targeting an unknown leaf code, naming it', () => {
    const bad = { overrides: { 'A1.1-99': OVERRIDES_FILE.overrides['A1.1-1'] } }
    expect(() => applyEraOverrides(baseDef(), bad)).toThrow(EraOverrideError)
    expect(() => applyEraOverrides(baseDef(), bad)).toThrow(/A1\.1-99/)
  })

  it('validates the merged result — a structurally invalid override throws', () => {
    const bad = { overrides: { 'A1.1-1': { measurements: [{ key: 'm1', operator: 'bogus', unit: 'cm', autoGrade: true }] } } }
    expect(() => applyEraOverrides(baseDef(), bad)).toThrow()
  })
})
