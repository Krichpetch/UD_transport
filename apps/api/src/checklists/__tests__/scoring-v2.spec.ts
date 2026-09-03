/**
 * E-form redesign (Session E1, Part E) — new fixture tests for the v2 extension of
 * computeScoreFromItems/buildHistogram/computeFacilityMetrics: subItems rollup, presence-only
 * leaves, and measured (presence_standard + measurements) auto-grading against template
 * thresholds. These are NOT parity tests — v2 has no pre-existing behavior to match — but they
 * pin down the "extended, never forked" contract documented in scoring.ts's module header.
 *
 * scoring.spec.ts (unmodified) remains the parity anchor for v1: every test there must still
 * pass byte-for-byte, proving these additions never touched the v1 (flat, no subItems, no
 * templateDef) code path.
 */
import { computeScoreFromItems, buildHistogram, computeFacilityMetrics, deriveMeasuredStandard, ratioLengthKey, ratioHeightKey, ratioRiseKey, ratioHypotenuseKey, slopeRunKey } from '../scoring'
import type { ChecklistTemplateDefinition } from '@repo/types'

describe('deriveMeasuredStandard', () => {
  const gte90 = [{ key: 'm1', operator: 'gte' as const, value: 90, unit: 'cm', autoGrade: true }]

  it('flips to pass exactly at the boundary (90 >= 90)', () => {
    expect(deriveMeasuredStandard(gte90, { m1: 90 })).toBe(true)
  })

  it('fails just below the boundary (89 < 90)', () => {
    expect(deriveMeasuredStandard(gte90, { m1: 89 })).toBe(false)
  })

  it('returns null (undetermined) when the value is missing', () => {
    expect(deriveMeasuredStandard(gte90, {})).toBeNull()
  })

  it('returns null when every measurement is autoGrade=false (guidance only)', () => {
    const guidanceOnly = [{ key: 'm1', operator: 'gte' as const, value: 90, unit: 'cm', autoGrade: false }]
    expect(deriveMeasuredStandard(guidanceOnly, { m1: 999 })).toBeNull()
  })

  it('requires ALL autoGrade measurements on a leaf to pass', () => {
    const two = [
      { key: 'm1', operator: 'gte' as const, value: 90, unit: 'cm', autoGrade: true },
      { key: 'm2', operator: 'lte' as const, value: 50, unit: 'cm', autoGrade: true },
    ]
    expect(deriveMeasuredStandard(two, { m1: 90, m2: 50 })).toBe(true)
    expect(deriveMeasuredStandard(two, { m1: 90, m2: 51 })).toBe(false)
  })

  it('range operator is inclusive on both ends', () => {
    const range = [{ key: 'm1', operator: 'range' as const, value: 45, value2: 50, unit: 'cm', autoGrade: true }]
    expect(deriveMeasuredStandard(range, { m1: 45 })).toBe(true)
    expect(deriveMeasuredStandard(range, { m1: 50 })).toBe(true)
    expect(deriveMeasuredStandard(range, { m1: 44 })).toBe(false)
    expect(deriveMeasuredStandard(range, { m1: 51 })).toBe(false)
  })

  it('ratio_1_x (ความชัน) is computed from raw ความยาว/ความสูง, not entered directly', () => {
    // 1:12 slope, gte -- flatter (larger ratio) passes
    const ratio = [{ key: 'm1', operator: 'gte' as const, value: 12, unit: 'ratio_1_x', autoGrade: true }]
    // length 1200cm / height 100cm = ratio 12 -> exactly at the boundary, passes
    expect(deriveMeasuredStandard(ratio, { [ratioLengthKey('m1')]: 1200, [ratioHeightKey('m1')]: 100 })).toBe(true)
    // length 1100cm / height 100cm = ratio 11 -> steeper than 1:12, fails
    expect(deriveMeasuredStandard(ratio, { [ratioLengthKey('m1')]: 1100, [ratioHeightKey('m1')]: 100 })).toBe(false)
  })

  it('ratio_1_x returns null (ungraded) when height is missing or zero', () => {
    const ratio = [{ key: 'm1', operator: 'gte' as const, value: 12, unit: 'ratio_1_x', autoGrade: true }]
    expect(deriveMeasuredStandard(ratio, { [ratioLengthKey('m1')]: 1200 })).toBeNull()
    expect(deriveMeasuredStandard(ratio, { [ratioLengthKey('m1')]: 1200, [ratioHeightKey('m1')]: 0 })).toBeNull()
  })

  it('percent slope (ความลาดชัน ร้อยละ) is ALSO computed from raw ความยาว/ความสูง — same real criterion, seeded as unit:percent instead of ratio_1_x', () => {
    // "ความลาดชัน ไม่เกิน ร้อยละ 10" -- lte 10
    const percent = [{ key: 'm1', operator: 'lte' as const, value: 10, unit: 'percent', autoGrade: true }]
    // height 100cm / length 1000cm * 100 = 10% -- exactly at the boundary, passes
    expect(deriveMeasuredStandard(percent, { [ratioLengthKey('m1')]: 1000, [ratioHeightKey('m1')]: 100 })).toBe(true)
    // height 110cm / length 1000cm * 100 = 11% -- steeper than 10%, fails
    expect(deriveMeasuredStandard(percent, { [ratioLengthKey('m1')]: 1000, [ratioHeightKey('m1')]: 110 })).toBe(false)
  })

  it('percent slope returns null (ungraded) when length is missing or zero', () => {
    const percent = [{ key: 'm1', operator: 'lte' as const, value: 10, unit: 'percent', autoGrade: true }]
    expect(deriveMeasuredStandard(percent, { [ratioHeightKey('m1')]: 100 })).toBeNull()
    expect(deriveMeasuredStandard(percent, { [ratioLengthKey('m1')]: 0, [ratioHeightKey('m1')]: 100 })).toBeNull()
  })

  // Session S4a, Part A (2026-08-09) — slope capture redesigned to rise (แนวดิ่ง) + hypotenuse
  // (ความยาวตามแนวลาด). run is derived via Pythagoras (run = sqrt(hyp² − rise²)) and graded
  // exactly as the old length/height path was — same formulas, a derived run instead of an
  // entered one. The length/height tests above are UNCHANGED and must keep passing: they now
  // exercise the legacy fallback for checklists submitted before this redesign.
  it('ratio_1_x derives run via Pythagoras from rise + hypotenuse (5-12-13 triangle: rise 5, hyp 13 -> run 12 -> ratio 12/5 = 2.4)', () => {
    const ratio = [{ key: 'm1', operator: 'gte' as const, value: 2.4, unit: 'ratio_1_x', autoGrade: true }]
    expect(deriveMeasuredStandard(ratio, { [ratioRiseKey('m1')]: 5, [ratioHypotenuseKey('m1')]: 13 })).toBe(true)
    // Same rise, a shorter hypotenuse -> a smaller run -> a steeper (smaller) ratio -> fails a 2.4 gte.
    const steeper = { [ratioRiseKey('m1')]: 5, [ratioHypotenuseKey('m1')]: 12 }
    expect(deriveMeasuredStandard(ratio, steeper)).toBe(false)
  })

  it('matches the worked example (rise 100, hypotenuse 1300 -> run ~1296.15 -> ~1:12.96)', () => {
    const values = { [ratioRiseKey('m1')]: 100, [ratioHypotenuseKey('m1')]: 1300 }
    const passesAt12 = [{ key: 'm1', operator: 'gte' as const, value: 12, unit: 'ratio_1_x', autoGrade: true }]
    const failsAt13 = [{ key: 'm1', operator: 'gte' as const, value: 13, unit: 'ratio_1_x', autoGrade: true }]
    expect(deriveMeasuredStandard(passesAt12, values)).toBe(true)
    expect(deriveMeasuredStandard(failsAt13, values)).toBe(false)
  })

  it('percent also derives from rise + hypotenuse (rise 5, hyp 13 -> run 12 -> 5/12*100 ~= 41.67%)', () => {
    const percent = [{ key: 'm1', operator: 'lte' as const, value: 42, unit: 'percent', autoGrade: true }]
    const values = { [ratioRiseKey('m1')]: 5, [ratioHypotenuseKey('m1')]: 13 }
    expect(deriveMeasuredStandard(percent, values)).toBe(true)
    expect(deriveMeasuredStandard([{ ...percent[0]!, value: 41 }], values)).toBe(false)
  })

  it('invalid geometry (hypotenuse <= rise) is rejected as ungraded, never NaN', () => {
    const ratio = [{ key: 'm1', operator: 'gte' as const, value: 12, unit: 'ratio_1_x', autoGrade: true }]
    expect(deriveMeasuredStandard(ratio, { [ratioRiseKey('m1')]: 100, [ratioHypotenuseKey('m1')]: 100 })).toBeNull()
    expect(deriveMeasuredStandard(ratio, { [ratioRiseKey('m1')]: 100, [ratioHypotenuseKey('m1')]: 50 })).toBeNull()
    expect(deriveMeasuredStandard(ratio, { [ratioRiseKey('m1')]: 0, [ratioHypotenuseKey('m1')]: 100 })).toBeNull()
  })

  it('rise/hypotenuse present takes priority over any stray legacy length/height on the same values map', () => {
    const ratio = [{ key: 'm1', operator: 'gte' as const, value: 2.4, unit: 'ratio_1_x', autoGrade: true }]
    const values = {
      [ratioRiseKey('m1')]: 5, [ratioHypotenuseKey('m1')]: 13, // -> ratio 2.4, passes
      [ratioLengthKey('m1')]: 1, [ratioHeightKey('m1')]: 100,  // legacy pair that would fail if read
    }
    expect(deriveMeasuredStandard(ratio, values)).toBe(true)
  })

  it('unit:degree WITHOUT slopeAngle is left alone (not treated as a slope) — direct entry', () => {
    // Door hinge-opening angle (e.g. a 90 องศา opening) has no rise/run to derive from; an
    // unflagged unit:'degree' measurement must still use the plain single-value path (values[m.key]).
    const angle = [{ key: 'm1', operator: 'gte' as const, value: 90, unit: 'degree', autoGrade: true }]
    expect(deriveMeasuredStandard(angle, { m1: 90 })).toBe(true)
    expect(deriveMeasuredStandard(angle, { m1: 89 })).toBe(false)
  })

  // UDT-30 — the ธรณีประตู 45° door-edge slope is a genuine slope-ANGLE degree measurement. When
  // flagged slopeAngle, deriveMeasuredStandard gains a mode switch: cm-input (rise + run, angle
  // derived via arctangent) OR the auditor's directly-entered angle. Only slopeAngle-flagged
  // degree measurements take this path — the unflagged test above proves hinge angles are untouched.
  it('slopeAngle degree: cm-input derives the angle via arctangent from rise + run (rise 1, run 1 -> 45°)', () => {
    const edge = [{ key: 'm1', operator: 'lte' as const, value: 45, unit: 'degree', autoGrade: true, slopeAngle: true }]
    // rise 1 / run 1 -> atan(1) = 45° -> exactly at the boundary, passes lte 45
    expect(deriveMeasuredStandard(edge, { [ratioRiseKey('m1')]: 1, [slopeRunKey('m1')]: 1 })).toBe(true)
    // rise 2 / run 1 -> atan(2) ≈ 63.4° -> steeper than 45°, fails
    expect(deriveMeasuredStandard(edge, { [ratioRiseKey('m1')]: 2, [slopeRunKey('m1')]: 1 })).toBe(false)
  })

  it('slopeAngle degree: falls back to the directly-entered angle when no legs are present', () => {
    const edge = [{ key: 'm1', operator: 'lte' as const, value: 45, unit: 'degree', autoGrade: true, slopeAngle: true }]
    expect(deriveMeasuredStandard(edge, { m1: 45 })).toBe(true)
    expect(deriveMeasuredStandard(edge, { m1: 46 })).toBe(false)
  })

  it('slopeAngle degree: leg-derived angle takes priority over any stray direct value', () => {
    const edge = [{ key: 'm1', operator: 'lte' as const, value: 45, unit: 'degree', autoGrade: true, slopeAngle: true }]
    // legs -> 45° (passes) even though the direct m1:80 would fail lte 45 on its own
    expect(deriveMeasuredStandard(edge, { [ratioRiseKey('m1')]: 1, [slopeRunKey('m1')]: 1, m1: 80 })).toBe(true)
  })

  it('slopeAngle degree: null (ungraded) when run is zero or nothing is entered', () => {
    const edge = [{ key: 'm1', operator: 'lte' as const, value: 45, unit: 'degree', autoGrade: true, slopeAngle: true }]
    expect(deriveMeasuredStandard(edge, {})).toBeNull()
    expect(deriveMeasuredStandard(edge, { [ratioRiseKey('m1')]: 1, [slopeRunKey('m1')]: 0 })).toBeNull()
  })
})

describe('buildHistogram / computeScoreFromItems — subItems rollup', () => {
  it('counts only leaves, not the container above them (v1 has no subItems, so this is new behavior)', () => {
    const items = [{
      groupId: 'A1', groupName: 'A1', items: [
        {
          id: 'A1.1', labelTh: 'container criterion', subItems: [
            { id: 'A1.1-1', labelTh: 'leaf 1', answerType: 'presence', present: true },
            { id: 'A1.1-2', labelTh: 'leaf 2', answerType: 'presence', present: false },
          ],
        },
      ],
    }]
    const h = buildHistogram(items)
    expect(h.total).toBe(2) // the container itself is never counted
    expect(h.presenceHas).toBe(1)
    expect(h.presenceNone).toBe(1)
  })

  it('hybrid node (its own answerType AND subItems) counts both itself and its children', () => {
    const items = [{
      groupId: 'B4', groupName: 'B4', items: [
        {
          id: 'B4.1-7', labelTh: 'โถส้วม', answerType: 'presence', present: true,
          subItems: [
            { id: 'B4.1-7.1', labelTh: 'seat height', answerType: 'presence_standard', present: true, meetsStandard: true },
            { id: 'B4.1-7.2', labelTh: 'side clearance', answerType: 'presence_standard', present: true, meetsStandard: false },
          ],
        },
      ],
    }]
    const h = buildHistogram(items)
    expect(h.total).toBe(3) // B4.1-7 itself + its 2 children
    expect(h.presenceHas).toBe(1)      // B4.1-7 itself, present=true
    expect(h.hasStandard).toBe(1)      // B4.1-7.1
    expect(h.hasSubstandard).toBe(1)   // B4.1-7.2
  })
})

describe('presence-only leaves — excluded from standards, counted toward จัดให้มีฯ', () => {
  const items = [{
    groupId: 'A', groupName: 'A', items: [
      { id: 'p1', labelTh: 'presence has', answerType: 'presence', present: true },
      { id: 'p2', labelTh: 'presence none', answerType: 'presence', present: false },
      { id: 'c1', labelTh: 'choice has+standard', value: 'มี', meetsStandard: true, flagged: false },
      { id: 'c2', labelTh: 'choice none', value: 'ไม่มี', meetsStandard: false, flagged: false },
    ],
  }]

  it('computeScoreFromItems ignores presence-only leaves entirely (การได้มาตรฐาน never sees them)', () => {
    // eligible = c1(hasStandard) + c2(none) = 2; standard = c1 = 1 -> 50%
    expect(computeScoreFromItems(items)).toBe(50)
  })

  it('computeFacilityMetrics folds presence-only "has" into hasItem/pctHasFacility but not total/pctMeetsStandard', () => {
    const m = computeFacilityMetrics(items)
    expect(m.total).toBe(2)          // c1 + c2 only — presence leaves excluded from the standards denominator
    expect(m.meetsStandard).toBe(1)  // c1
    expect(m.hasItem).toBe(2)        // c1 (has+standard) + p1 (presence has)
    expect(m.pctSuccess).toBeCloseTo(50) // 1/2
    // facilityEligible = total(2) + presenceHas(1) + presenceNone(1) = 4; hasItem(2)/4 = 50%
    expect(m.pctHasFacility).toBeCloseTo(50)
    // pctMeetsStandard denominator stays choice-only (hasStandard+hasSubstandard = 1) — presence excluded
    expect(m.pctMeetsStandard).toBeCloseTo(100)
  })

  it('reduces to the pre-E1 formulas when there are zero presence leaves (pure v1 parity)', () => {
    const v1Only = [{ groupId: 'A', groupName: 'A', items: items[0]!.items.filter(it => it.id.startsWith('c')) }]
    const m = computeFacilityMetrics(v1Only)
    expect(m.hasItem).toBe(1)
    expect(m.pctHasFacility).toBeCloseTo(50) // hasItem(1)/total(2) — identical to the original formula
  })
})

describe('measured presence_standard leaves — template-driven auto-grading', () => {
  const templateDef: ChecklistTemplateDefinition = {
    schemaVersion: 2,
    mode: 'ทางน้ำ',
    groups: [{
      code: 'A1', labelTh: 'test group', items: [
        {
          code: 'A1.1', labelTh: 'ramp width', answerType: 'presence_standard',
          measurements: [{ key: 'm1', operator: 'gte', value: 90, unit: 'cm', autoGrade: true }],
        },
        {
          code: 'A1.2', labelTh: 'guidance only', answerType: 'presence_standard',
          measurements: [{ key: 'm1', operator: 'gte', value: 12, unit: 'ratio_1_x', autoGrade: false }],
        },
      ],
    }],
  }

  function itemsWithValues(m1: number | undefined, guidancePresent = true) {
    return [{
      groupId: 'A1', groupName: 'A1', items: [
        { id: 'A1.1', labelTh: 'ramp width', answerType: 'presence_standard', present: true, ...(m1 !== undefined ? { values: { m1 } } : {}) },
        { id: 'A1.2', labelTh: 'guidance only', answerType: 'presence_standard', present: guidancePresent, values: { m1: 999 } },
      ],
    }]
  }

  it('derives ได้มาตรฐาน from the template threshold, not a stored verdict — passes at the boundary', () => {
    const h = buildHistogram(itemsWithValues(90), templateDef)
    expect(h.hasStandard).toBe(1)       // A1.1 passes
    expect(h.standardUnspecified).toBe(1) // A1.2 — autoGrade:false, parked like bare-มี
  })

  it('fails just below the boundary', () => {
    const h = buildHistogram(itemsWithValues(89), templateDef)
    expect(h.hasSubstandard).toBe(1)
  })

  it('an admin threshold edit re-grades the SAME stored values on the next recompute', () => {
    const stricterTemplate: ChecklistTemplateDefinition = {
      ...templateDef,
      groups: [{
        ...templateDef.groups[0]!,
        items: [{ ...templateDef.groups[0]!.items[0]!, measurements: [{ key: 'm1', operator: 'gte', value: 95, unit: 'cm', autoGrade: true }] }, templateDef.groups[0]!.items[1]!],
      }],
    }
    // Same stored answer (values.m1 = 90) that PASSED against a gte:90 threshold now fails
    // against a gte:95 threshold — proving the verdict is derived fresh, never cached.
    expect(computeScoreFromItems(itemsWithValues(90), templateDef)).toBe(100)
    expect(computeScoreFromItems(itemsWithValues(90), stricterTemplate)).toBe(0)
  })

  it('missing numeric entry is parked (standardUnspecified), not counted as a failure', () => {
    const h = buildHistogram(itemsWithValues(undefined), templateDef)
    expect(h.standardUnspecified).toBe(2) // both A1.1 (no values) and A1.2 (autoGrade false)
    expect(h.hasSubstandard).toBe(0)
  })
})

describe('mixed tree — v1 choice + v2 presence + v2 measured leaves together', () => {
  const templateDef: ChecklistTemplateDefinition = {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [{
      code: 'X', labelTh: 'mixed', items: [
        { code: 'X.1', labelTh: 'measured', answerType: 'presence_standard', measurements: [{ key: 'm1', operator: 'gte', value: 90, unit: 'cm', autoGrade: true }] },
      ],
    }],
  }

  it('scores a tree combining all three answer shapes without cross-contamination', () => {
    const items = [{
      groupId: 'mixed', groupName: 'mixed', items: [
        { id: 'v1', labelTh: 'legacy choice', value: 'มี', meetsStandard: true, flagged: false },
        { id: 'v2p', labelTh: 'presence only', answerType: 'presence', present: true },
        { id: 'X.1', labelTh: 'measured', answerType: 'presence_standard', present: true, values: { m1: 90 } },
      ],
    }]
    // eligible for standards: v1 (pass) + X.1 (pass, derived) = 2 eligible, 2 standard -> 100%
    expect(computeScoreFromItems(items, templateDef)).toBe(100)
    const h = buildHistogram(items, templateDef)
    expect(h.presenceHas).toBe(1) // v2p only
    expect(h.hasStandard).toBe(2) // v1 + X.1
  })
})
