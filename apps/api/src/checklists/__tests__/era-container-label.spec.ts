/**
 * Container-text era resolution (Session S5-fix follow-up) — TemplateNode.labelByLaw.
 *
 * Real bug this closes: era overrides resolve on LEAF measurements (see
 * era-resolution.spec.ts's "sourceText/labelTh follow the resolved value" suite) but NOT on
 * container/item-level labelTh text that states a case threshold with no scored criterion of its
 * own — e.g. ทางลาด's "กรณี...ไม่เกิน 2,500 มิลลิเมตร" case-condition heading. `labelByLaw` is a
 * new, separate TemplateNode field (independent of `measurements`) that lets exactly this kind of
 * pure-container node resolve its own labelTh by era.
 *
 * Two properties are load-bearing and load-tested here: the fix must be (1) completely inert to
 * scoring — a container's labelTh must never feed computeScoreFromItems/computeFacilityMetrics —
 * and (2) completely inert to era-redaction — adding labelByLaw must never cause
 * isItemApplicable/markApplicability to hide the container, and must never touch its lawRefs.
 */
import {
  resolveTemplateEras,
  applyEraOverrides,
  markApplicability,
  computeScoreFromItems,
  computeFacilityMetrics,
  EraOverrideError,
  type ChecklistTemplateDefinition,
  type EraLawRef,
} from '@repo/types'

const REGISTRY: EraLawRef[] = [
  { code: 'MHT_2548', buddhistYear: 2548, effectiveYear: null },
  { code: 'MHT_2564', buddhistYear: 2564, effectiveYear: null },
]

// Mirrors the real ทางลาด shape: a pure container (no answerType, no measurements) whose own
// labelTh states a case-condition threshold, with a sibling LEAF underneath that already
// era-varies correctly via the existing measurement byLaw mechanism (Session F3/2026-08-05 fix) —
// proving the two mechanisms coexist without interfering with each other.
function rampDef(): ChecklistTemplateDefinition {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [{
      code: 'A2', labelTh: 'ทางลาด', items: [{
        code: 'A2.2-1',
        labelTh: 'กรณีทางลาดที่ความยาวไม่เกิน 2,500 มิลลิเมตร',
        labelByLaw: {
          MHT_2548: { labelTh: 'กรณีทางลาดที่ความยาวไม่เกิน 2,500 มิลลิเมตร' },
          MHT_2564: { labelTh: 'กรณีทางลาดที่ความยาวไม่เกิน 1,800 มิลลิเมตร' },
        },
        subItems: [{
          code: 'A2.2-1.5',
          labelTh: 'ทางลาดด้านที่ไม่มีผนังกั้นให้ยกขอบสูงจากพื้นผิว ของทางลาดไม่น้อยกว่า 50 มิลลิเมตร',
          answerType: 'presence_standard',
          measurements: [{
            key: 'm1', operator: 'gte', unit: 'mm', autoGrade: true,
            sourceText: 'ไม่น้อยกว่า 50 มิลลิเมตร',
            byLaw: {
              MHT_2548: { value: 50 },
              MHT_2564: { value: 100, sourceText: 'ไม่น้อยกว่า 100 มิลลิเมตร' },
            },
          }],
        }],
      }],
    }],
  }
}

describe('resolveTemplateEras — container labelByLaw (text-only, no measurement)', () => {
  it('a pre-2564 station resolves the container heading to the 2548 text (2,500mm)', () => {
    const { resolved, appliedLawRefs } = resolveTemplateEras(rampDef(), 2550, REGISTRY)
    const container = resolved.groups[0]!.items[0]!
    expect(container.labelTh).toBe('กรณีทางลาดที่ความยาวไม่เกิน 2,500 มิลลิเมตร')
    expect(appliedLawRefs['A2.2-1#label']).toBe('MHT_2548')
  })

  it('a 2564+ station resolves the container heading to the 2564 text (1,800mm) — AND the sibling leaf still resolves independently to 100mm', () => {
    const { resolved, appliedLawRefs } = resolveTemplateEras(rampDef(), 2565, REGISTRY)
    const container = resolved.groups[0]!.items[0]!
    expect(container.labelTh).toBe('กรณีทางลาดที่ความยาวไม่เกิน 1,800 มิลลิเมตร')
    expect(appliedLawRefs['A2.2-1#label']).toBe('MHT_2564')
    const leaf = container.subItems![0]!
    expect(leaf.measurements![0]!.value).toBe(100)
    expect(appliedLawRefs['A2.2-1.5#m1']).toBe('MHT_2564')
  })

  it('labelByLaw is stripped from the resolved output — the client never sees the raw multi-era map', () => {
    const { resolved } = resolveTemplateEras(rampDef(), 2550, REGISTRY)
    const container = resolved.groups[0]!.items[0]!
    expect(container.labelByLaw).toBeUndefined()
  })

  it('null yearBuilt resolves provisionally to the latest law and flags eraUnresolved, same as measurement byLaw', () => {
    const { resolved, eraUnresolved, appliedLawRefs } = resolveTemplateEras(rampDef(), null, REGISTRY)
    expect(eraUnresolved).toBe(true)
    expect(appliedLawRefs['A2.2-1#label']).toBe('MHT_2564')
    expect(resolved.groups[0]!.items[0]!.labelTh).toBe('กรณีทางลาดที่ความยาวไม่เกิน 1,800 มิลลิเมตร')
  })
})

describe('inertness to scoring — the load-bearing guarantee', () => {
  // Both sides go through the SAME resolveTemplateEras call at the SAME build year — the only
  // difference is whether the raw definition carried labelByLaw on the container BEFORE
  // resolution. This isolates exactly the property under test (does labelByLaw change the
  // resolved leaf's measurements or the score derived from them) from any resolution-vs-
  // unresolved noise.
  function resolvedWithout(yearBuilt: number): ChecklistTemplateDefinition {
    const raw = rampDef()
    delete raw.groups[0]!.items[0]!.labelByLaw
    return resolveTemplateEras(raw, yearBuilt, REGISTRY).resolved
  }

  const storedItems = [{
    items: [{
      code: 'A2.2-1',
      subItems: [{ id: 'A2.2-1.5', answerType: 'presence_standard', present: true, values: { m1: 120 } }],
    }],
  }]

  it('computeScoreFromItems is byte-identical whether or not the container carries labelByLaw', () => {
    const withLabel = resolveTemplateEras(rampDef(), 2565, REGISTRY).resolved
    const without = resolvedWithout(2565)
    expect(computeScoreFromItems(storedItems, withLabel)).toBe(computeScoreFromItems(storedItems, without))
    expect(computeScoreFromItems(storedItems, withLabel)).toBe(100) // sanity: this isn't just two zeros agreeing
  })

  it('computeFacilityMetrics never reads labelTh — total/hasItem/meetsStandard identical with or without labelByLaw', () => {
    const withLabel = resolveTemplateEras(rampDef(), 2565, REGISTRY).resolved
    const without = resolvedWithout(2565)
    const metrics = computeFacilityMetrics(storedItems, withLabel)
    expect(metrics).toEqual(computeFacilityMetrics(storedItems, without))
    expect(metrics.total).toBe(1) // sanity: this isn't just two zeros agreeing
  })
})

describe('inertness to redaction — the other load-bearing guarantee', () => {
  it('markApplicability never marks the labelByLaw container (or its subtree) inapplicable at any build year, and never touches its lawRefs', () => {
    for (const yearBuilt of [2400, 2548, 2555, 2564, 2570]) {
      const marked = markApplicability(rampDef(), yearBuilt, REGISTRY)
      const container = marked.groups[0]!.items[0]!
      // Pure container: markNode only ever stamps `applicable` on answerType-bearing nodes.
      expect(container.applicable).toBeUndefined()
      expect(container.lawRefs).toBeUndefined()
      // The sibling leaf's own era-applicability is untouched by the container carrying labelByLaw.
      expect(container.subItems![0]!.applicable).not.toBe(false)
    }
  })

  it('applyEraOverrides: a labelByLaw-only override entry does NOT union any law code into the container\'s lawRefs (unlike a measurements entry)', () => {
    const base: ChecklistTemplateDefinition = {
      schemaVersion: 2,
      mode: 'ทางบก',
      groups: [{
        code: 'A2', labelTh: 'ทางลาด', items: [{
          code: 'A2.2-1', labelTh: 'กรณีทางลาดที่ความยาวไม่เกิน 2,500 มิลลิเมตร',
          subItems: [{ code: 'A2.2-1.1', labelTh: 'leaf', answerType: 'presence' }],
        }],
      }],
    }
    const merged = applyEraOverrides(base, {
      overrides: {
        'A2.2-1': {
          labelByLaw: {
            MHT_2548: { labelTh: 'กรณีทางลาดที่ความยาวไม่เกิน 2,500 มิลลิเมตร' },
            MHT_2564: { labelTh: 'กรณีทางลาดที่ความยาวไม่เกิน 1,800 มิลลิเมตร' },
          },
        },
      },
    })
    const container = merged.groups[0]!.items[0]!
    expect(container.labelByLaw).toBeDefined()
    expect(container.lawRefs).toBeUndefined() // no union — text-only, never asserts existence
  })
})

describe('applyEraOverrides — labelByLaw / measurements are mutually exclusive per override entry', () => {
  it('throws when an override entry supplies neither measurements nor labelByLaw', () => {
    const base: ChecklistTemplateDefinition = {
      schemaVersion: 2, mode: 'ทางบก',
      groups: [{ code: 'A2', labelTh: 'g', items: [{ code: 'A2.2-1', labelTh: 'x' }] }],
    }
    expect(() => applyEraOverrides(base, { overrides: { 'A2.2-1': {} } })).toThrow(EraOverrideError)
  })

  it('throws when an override entry supplies BOTH measurements and labelByLaw', () => {
    const base: ChecklistTemplateDefinition = {
      schemaVersion: 2, mode: 'ทางบก',
      groups: [{ code: 'A2', labelTh: 'g', items: [{
        code: 'A2.2-1.5', labelTh: 'x', answerType: 'presence_standard',
        measurements: [{ key: 'm1', operator: 'gte', unit: 'mm', value: 50, autoGrade: true }],
      }] }],
    }
    expect(() => applyEraOverrides(base, {
      overrides: {
        'A2.2-1.5': {
          measurements: [{ key: 'm1', operator: 'gte', unit: 'mm', autoGrade: true, byLaw: { MHT_2548: { value: 50 } } }],
          labelByLaw: { MHT_2548: { labelTh: 'x' } },
        },
      },
    })).toThrow(EraOverrideError)
  })

  it('throws naming the code when the override targets a code the template does not have', () => {
    const base: ChecklistTemplateDefinition = {
      schemaVersion: 2, mode: 'ทางบก',
      groups: [{ code: 'A2', labelTh: 'g', items: [{ code: 'A2.2-1', labelTh: 'x' }] }],
    }
    expect(() => applyEraOverrides(base, {
      overrides: { 'NOT-A-REAL-CODE': { labelByLaw: { MHT_2548: { labelTh: 'x' } } } },
    })).toThrow(/NOT-A-REAL-CODE/)
  })
})
