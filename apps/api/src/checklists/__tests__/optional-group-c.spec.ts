/**
 * Session F3, Part C — group C submittable incomplete.
 *
 * สนข. meeting 2026-08-03: "CheckList ข้อ C สามารถประเมินไม่ครบ แต่ส่งผลการประเมินและคำนวณได้."
 *
 * The optionality itself is a per-group DATA flag stamped on the template
 * (ChecklistTemplateGroupDef.optional, seeded onto C1/C2 — see seed-templates.ts#markOptionalGroups),
 * consumed by the auditor form's submit gate. Nothing about SCORING keys off it, and that is the
 * point of this suite: an unanswered leaf is already excluded from every numerator and denominator
 * no matter which group it lives in, so a blank optional group must score EXACTLY like one that
 * isn't in the checklist at all.
 *
 * Part C.3 turned out to be a TEST, not a code change — scoring.ts already skipped
 * `value === null` (choice) and `present !== true` (presence_standard), and routed unanswered
 * leaves to buildHistogram's nullOrOther/presenceUnanswered buckets, neither of which feeds
 * total/hasItem/facilityEligible. These tests pin that down so it can't silently regress into
 * counting a blank C as ไม่มี, which WOULD depress every station's score.
 */
import { computeScoreFromItems, buildHistogram, computeFacilityMetrics } from '../scoring'
import { parseTemplateDefinition, parseChecklistItems, OPTIONAL_GROUP_CODES } from '@repo/types'
import type { ChecklistTemplateDefinition } from '@repo/types'

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

// A/B answered, deliberately mixed so the metrics are non-degenerate.
const GROUP_A = {
  groupId: 'A1',
  groupName: 'ที่จอดรถ',
  items: [
    { id: 'A1.1', labelTh: 'ที่จอดรถคนพิการ', answerType: 'choice', value: 'มี', meetsStandard: true },
    { id: 'A1.2', labelTh: 'ป้ายสัญลักษณ์', answerType: 'choice', value: 'มี', meetsStandard: false },
  ],
}
const GROUP_B = {
  groupId: 'B1',
  groupName: 'โถงผู้โดยสาร',
  items: [
    { id: 'B1.1', labelTh: 'ทางลาด', answerType: 'choice', value: 'ไม่มี', meetsStandard: false },
    { id: 'B1.2', labelTh: 'ลิฟต์', answerType: 'presence_standard', present: true, meetsStandard: true },
  ],
}

// Group C, entirely blank — every leaf unanswered, one per answerType so all three scoring
// branches ('choice', 'presence', 'presence_standard') are exercised.
const GROUP_C_BLANK = {
  groupId: 'C1',
  groupName: 'ความรับรู้ในการเข้าถึงฯ (Awareness)',
  items: [
    { id: 'C1.1', labelTh: 'คู่มือการให้ความช่วยเหลือฯ', answerType: 'choice', value: null, meetsStandard: false },
    { id: 'C1.2', labelTh: 'คู่มือแปลภาษา', answerType: 'presence', present: null },
    { id: 'C1.3', labelTh: 'เจ้าหน้าที่ผ่านการอบรม', answerType: 'presence_standard', present: null, meetsStandard: null },
  ],
}

const WITH_BLANK_C = [GROUP_A, GROUP_B, GROUP_C_BLANK]
const WITHOUT_C = [GROUP_A, GROUP_B]

// ── Part C.3 — blank optional group is invisible to scoring ───────────────────────────────────

describe('Part C.3 — unanswered leaves in an optional group are excluded from every denominator', () => {
  it('scores a checklist with a blank group C identically to one with no group C at all', () => {
    expect(computeScoreFromItems(WITH_BLANK_C)).toBe(computeScoreFromItems(WITHOUT_C))
  })

  it('produces byte-identical FacilityMetrics with and without the blank group', () => {
    expect(computeFacilityMetrics(WITH_BLANK_C)).toEqual(computeFacilityMetrics(WITHOUT_C))
  })

  it('never counts a blank leaf as ไม่มี — the `none` bucket is unchanged', () => {
    const withC = buildHistogram(WITH_BLANK_C)
    const withoutC = buildHistogram(WITHOUT_C)
    expect(withC.none).toBe(withoutC.none)
    expect(withC.hasStandard).toBe(withoutC.hasStandard)
    expect(withC.hasSubstandard).toBe(withoutC.hasSubstandard)
    expect(withC.presenceHas).toBe(withoutC.presenceHas)
    expect(withC.presenceNone).toBe(withoutC.presenceNone)
  })

  it('books the blank leaves into the non-scoring buckets instead', () => {
    const withC = buildHistogram(WITH_BLANK_C)
    const withoutC = buildHistogram(WITHOUT_C)
    // 3 extra leaves visited in total…
    expect(withC.total).toBe(withoutC.total + 3)
    // …all of them parked: 2 in nullOrOther (choice + presence_standard), 1 presenceUnanswered.
    expect(withC.nullOrOther).toBe(withoutC.nullOrOther + 2)
    expect(withC.presenceUnanswered).toBe(withoutC.presenceUnanswered + 1)
  })

  it('would have depressed the score if blanks counted as ไม่มี (guards the regression)', () => {
    const asAbsent = [
      GROUP_A,
      GROUP_B,
      {
        ...GROUP_C_BLANK,
        items: [
          { id: 'C1.1', labelTh: 'คู่มือการให้ความช่วยเหลือฯ', answerType: 'choice', value: 'ไม่มี', meetsStandard: false },
          { id: 'C1.2', labelTh: 'คู่มือแปลภาษา', answerType: 'presence', present: false },
          { id: 'C1.3', labelTh: 'เจ้าหน้าที่ผ่านการอบรม', answerType: 'presence_standard', present: false, meetsStandard: false },
        ],
      },
    ]
    // Sanity: the two really are different, so the equality assertions above have teeth.
    expect(computeScoreFromItems(asAbsent)).toBeLessThan(computeScoreFromItems(WITH_BLANK_C))
  })
})

// ── Part C.1 — the flag itself ────────────────────────────────────────────────────────────────

describe('Part C.1 — ChecklistTemplateGroupDef.optional', () => {
  function defWith(groupExtra: Record<string, unknown>): unknown {
    return {
      schemaVersion: 2,
      mode: 'ทางบก',
      groups: [
        { code: 'A1', labelTh: 'ที่จอดรถ', items: [{ code: 'A1.1', labelTh: 'x', answerType: 'presence' }] },
        { code: 'C1', labelTh: 'Awareness', items: [{ code: 'C1.1', labelTh: 'y', answerType: 'presence' }], ...groupExtra },
      ],
    }
  }

  it('parses and preserves optional: true', () => {
    const def = parseTemplateDefinition(defWith({ optional: true }))
    expect(def.groups[1]!.optional).toBe(true)
  })

  it('is additive — a group without it stays without it (never serialized back as false)', () => {
    const def = parseTemplateDefinition(defWith({}))
    expect('optional' in def.groups[1]!).toBe(false)
    expect(def.groups[0]!.optional).toBeUndefined()
  })

  it('drops an explicit optional: false rather than storing it (byte-parity for old templates)', () => {
    const def = parseTemplateDefinition(defWith({ optional: false }))
    expect('optional' in def.groups[1]!).toBe(false)
  })

  it('rejects a non-boolean optional', () => {
    expect(() => parseTemplateDefinition(defWith({ optional: 'yes' }))).toThrow(/optional/)
  })

  it('declares exactly C1 and C2 as the seeded optional groups', () => {
    expect([...OPTIONAL_GROUP_CODES]).toEqual(['C1', 'C2'])
  })
})

// ── Part C.2 — what the submit gate must compute ──────────────────────────────────────────────
//
// The gate itself lives in the auditor page (apps/web), but the RULE it applies is a property of
// the template: "every group not marked optional must be fully answered". Pinned here so a
// template change that forgets the flag is caught server-side too.

describe('Part C.4 — submit must not start rejecting a partially-answered optional group', () => {
  // validateItemsPayload() delegates to parseChecklistItems(), which validates the payload's
  // STRUCTURE against the stamped template (every code known, every answerType shaped right).
  // Answeredness is deliberately not part of that contract, so an incomplete group has always
  // been acceptable — this pins it down so Part C can't be broken from the server side later.
  const def: ChecklistTemplateDefinition = parseTemplateDefinition({
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      { code: 'A1', labelTh: 'A', items: [{ code: 'A1.1', labelTh: 'a', answerType: 'choice' }] },
      {
        code: 'C1',
        labelTh: 'Awareness',
        optional: true,
        items: [
          { code: 'C1.1', labelTh: 'c1', answerType: 'choice' },
          { code: 'C1.2', labelTh: 'c2', answerType: 'presence' },
        ],
      },
    ],
  })

  const payload = [
    { groupId: 'A1', groupName: 'A', items: [{ id: 'A1.1', labelTh: 'a', answerType: 'choice', value: 'มี', meetsStandard: true }] },
    {
      groupId: 'C1',
      groupName: 'Awareness',
      items: [
        { id: 'C1.1', labelTh: 'c1', answerType: 'choice', value: null, meetsStandard: false },
        { id: 'C1.2', labelTh: 'c2', answerType: 'presence', present: null },
      ],
    },
  ]

  it('accepts an entirely blank optional group', () => {
    expect(() => parseChecklistItems(payload, def)).not.toThrow()
  })

  it('accepts a PARTIALLY answered optional group too', () => {
    const partial = JSON.parse(JSON.stringify(payload))
    partial[1].items[0].value = 'ไม่มี'
    expect(() => parseChecklistItems(partial, def)).not.toThrow()
  })

  it('still rejects a structurally invalid payload (unknown code) — validation is not weakened', () => {
    const bad = JSON.parse(JSON.stringify(payload))
    bad[1].items[0].id = 'C1.99'
    expect(() => parseChecklistItems(bad, def)).toThrow()
  })
})

describe('Part C.2 — required-group selection', () => {
  const def: ChecklistTemplateDefinition = parseTemplateDefinition({
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      { code: 'A1', labelTh: 'A', items: [{ code: 'A1.1', labelTh: 'a', answerType: 'presence' }] },
      { code: 'B1', labelTh: 'B', items: [{ code: 'B1.1', labelTh: 'b', answerType: 'presence' }] },
      { code: 'C1', labelTh: 'C1', optional: true, items: [{ code: 'C1.1', labelTh: 'c', answerType: 'presence' }] },
      { code: 'C2', labelTh: 'C2', optional: true, items: [{ code: 'C2.1', labelTh: 'd', answerType: 'presence' }] },
    ],
  })

  it('leaves A and B required', () => {
    expect(def.groups.filter((g) => !g.optional).map((g) => g.code)).toEqual(['A1', 'B1'])
  })

  it('marks both C groups optional', () => {
    expect(def.groups.filter((g) => g.optional).map((g) => g.code)).toEqual(['C1', 'C2'])
  })
})
