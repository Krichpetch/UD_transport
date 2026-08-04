/**
 * Session F3, Part G — regression: a byLaw-ONLY override must survive applyEraOverrides.
 *
 * The bug: parseMeasurement emits `value: value ?? null` for a measurement whose value comes only
 * from `byLaw`, but then REJECTED that same explicit null on re-parse ("must be a number").
 * applyEraOverrides re-validates its whole merged result through parseTemplateDefinition, so every
 * gte/lte/range byLaw override threw instead of applying — era overrides could not work at all
 * for the ordinary operators.
 *
 * Why it stayed invisible: the only override file ever committed (era_overrides_rail.json) uses
 * `tiered`, whose branch in parseMeasurement never looks at `value`. Four of the five declared v2
 * override files never existed, and the v3 loop applied no overrides at all — so nothing else
 * ever exercised the path. Part G wired the rest up, which is what surfaced it.
 */
import {
  applyEraOverrides,
  parseTemplateDefinition,
  parseMeasurement,
  resolveTemplateEras,
  type ChecklistTemplateDefinition,
  type EraLawRef,
} from '@repo/types'

const REGISTRY: EraLawRef[] = [
  { code: 'MHT_2548', buddhistYear: 2548, effectiveYear: null },
  { code: 'MHT_2564', buddhistYear: 2564, effectiveYear: null },
]

function baseDef(): ChecklistTemplateDefinition {
  return parseTemplateDefinition({
    schemaVersion: 2,
    mode: 'ทางบก',
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
                code: 'A1.1-1',
                labelTh: 'ramp edge height',
                answerType: 'presence_standard',
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

// The exact shape era_overrides_convert.py emits: operator/unit/key carried over, flat `value`
// dropped, values supplied per law.
const BYLAW_OVERRIDE = {
  overrides: {
    'A1.1-1': {
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

describe('Part G — byLaw-only overrides apply and resolve', () => {
  it('applies a gte byLaw-only override without throwing', () => {
    expect(() => applyEraOverrides(baseDef(), BYLAW_OVERRIDE)).not.toThrow()
  })

  it('resolves different thresholds for two build years (the end-to-end point of Part G)', () => {
    const merged = applyEraOverrides(baseDef(), BYLAW_OVERRIDE)

    const at = (yearBuilt: number) => {
      const { resolved, appliedLawRefs } = resolveTemplateEras(merged, yearBuilt, REGISTRY)
      const leaf = resolved.groups[0]!.items[0]!.subItems![0]!
      return { value: leaf.measurements![0]!.value, law: appliedLawRefs['A1.1-1#m1'] }
    }

    expect(at(2550)).toEqual({ value: 50, law: 'MHT_2548' })
    expect(at(2570)).toEqual({ value: 100, law: 'MHT_2564' })
  })

  it('parseMeasurement round-trips its own output (value: null means "absent")', () => {
    const once = parseMeasurement(
      { key: 'm1', operator: 'gte', unit: 'mm', autoGrade: true, byLaw: { MHT_2548: { value: 50 } } },
      '$.m',
    )
    expect(once.value).toBeNull()
    // Re-parsing the parser's own output must not throw — this is what applyEraOverrides does.
    expect(() => parseMeasurement(once, '$.m')).not.toThrow()
    expect(parseMeasurement(once, '$.m')).toEqual(once)
  })

  it('still rejects a non-numeric, non-null value', () => {
    expect(() =>
      parseMeasurement({ key: 'm1', operator: 'gte', unit: 'mm', autoGrade: true, value: 'fifty' }, '$.m'),
    ).toThrow(/value/)
  })

  it('still rejects a measurement with neither a value nor byLaw', () => {
    expect(() =>
      parseMeasurement({ key: 'm1', operator: 'gte', unit: 'mm', autoGrade: true }, '$.m'),
    ).toThrow(/value/)
  })

  it('still rejects an override naming a leaf the template does not have', () => {
    expect(() =>
      applyEraOverrides(baseDef(), { overrides: { 'Z9.9': { measurements: [] } } }),
    ).toThrow(/Z9\.9/)
  })

  it('is idempotent — re-applying the same override yields the same template', () => {
    const once = applyEraOverrides(baseDef(), BYLAW_OVERRIDE)
    const twice = applyEraOverrides(once, BYLAW_OVERRIDE)
    expect(twice).toEqual(once)
  })
})
