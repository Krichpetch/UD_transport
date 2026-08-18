/**
 * Part B (auditor self-unsubmit/summary session) — groupSummaryByCategory groups a submitted
 * checklist's stored items by category (A/B/C) and re-derives pass/total per group via
 * computeFacilityMetrics on slices of the SAME items array. This proves those numbers can never
 * drift from the stored score: category sums match the whole-checklist computeFacilityMetrics
 * output, and the overall rounded pctSuccess matches computeScoreFromItems — the two independent
 * scoring entrypoints this codebase actually ships — with redacted/N/A/optional items present.
 */
import { describe, it, expect } from 'vitest'
import { computeFacilityMetrics, computeScoreFromItems } from '@repo/types'
import { groupSummaryByCategory } from '../audit-form'

function choiceLeaf(id: string, value: 'มี' | 'ไม่มี' | 'N/A' | null, meetsStandard = false, extra: Record<string, unknown> = {}) {
  return { id, labelTh: id, value, meetsStandard, ...extra }
}

// Category A: two stored groups (A1, A2) — exercises the multi-group breakdown.
// Category B: one stored group (B1) — exercises the singleton case (groups.length === 1).
// Category C: no stored groups at all — an entirely-unanswered optional group never even makes it
// into the stored items (buildStoredGroups always emits a row per template group, but this test
// simulates the "nothing here" case directly) and must not appear in the result.
const ITEMS = [
  {
    groupId: 'A1', groupName: '(A1) ที่จอดรถ', items: [
      choiceLeaf('A1.1', 'มี', true),        // eligible, standard
      choiceLeaf('A1.2', 'มี', false),        // eligible, substandard
      choiceLeaf('A1.3', 'N/A', false),       // excluded entirely
      choiceLeaf('A1.4', null, false, { applicable: false }), // era-redacted — excluded entirely
    ],
  },
  {
    groupId: 'A2', groupName: '(A2) ลิฟต์', items: [
      choiceLeaf('A2.1', 'ไม่มี', false),     // eligible, not-has
      choiceLeaf('A2.2', 'มี', true),         // eligible, standard
    ],
  },
  {
    groupId: 'B1', groupName: '(B1) การให้บริการ', items: [
      choiceLeaf('B1.1', 'มี', true),
      choiceLeaf('B1.2', 'มี', true),
    ],
  },
]

describe('groupSummaryByCategory', () => {
  it('sums each category from its own groups, and every category from the whole checklist — no drift', () => {
    const buckets = groupSummaryByCategory(ITEMS)
    const catA = buckets.find((c) => c.value === 'A')!
    const catB = buckets.find((c) => c.value === 'B')!

    // Category A: 4 eligible (A1.1/A1.2/A2.1/A2.2 — N/A and redacted excluded), 2 meet standard.
    expect(catA.metrics.total).toBe(4)
    expect(catA.metrics.meetsStandard).toBe(2)
    // Category A's own total is the sum of its two groups' totals — not an independent count.
    const sumOfGroups = catA.groups.reduce((n, g) => n + g.metrics.total, 0)
    const sumOfGroupsStandard = catA.groups.reduce((n, g) => n + g.metrics.meetsStandard, 0)
    expect(sumOfGroups).toBe(catA.metrics.total)
    expect(sumOfGroupsStandard).toBe(catA.metrics.meetsStandard)

    // Category B: one group, both leaves meet standard.
    expect(catB.metrics.total).toBe(2)
    expect(catB.metrics.meetsStandard).toBe(2)
    expect(catB.groups).toHaveLength(1)
  })

  it('never invents a category that has no stored groups (an empty optional group stays absent, same as scoring already treats it)', () => {
    const buckets = groupSummaryByCategory(ITEMS)
    expect(buckets.find((c) => c.value === 'C')).toBeUndefined()
  })

  it('the sum across every category equals the whole-checklist computeFacilityMetrics — the exact function submitResult.score is not, but this summary IS, built from', () => {
    const buckets = groupSummaryByCategory(ITEMS)
    const wholeMetrics = computeFacilityMetrics(ITEMS)
    const summedTotal = buckets.reduce((n, c) => n + c.metrics.total, 0)
    const summedStandard = buckets.reduce((n, c) => n + c.metrics.meetsStandard, 0)
    expect(summedTotal).toBe(wholeMetrics.total)
    expect(summedStandard).toBe(wholeMetrics.meetsStandard)
  })

  it('the rounded overall pctSuccess matches computeScoreFromItems — the two independent scoring entrypoints agree, redacted/N/A excluded from both', () => {
    const wholeMetrics = computeFacilityMetrics(ITEMS)
    const storedScore = computeScoreFromItems(ITEMS)
    expect(Math.round(wholeMetrics.pctSuccess)).toBe(storedScore)
    // Sanity: N/A + redacted (2 leaves) must not have inflated the denominator — 6 eligible of
    // 8 stored leaves total (4 + 2 + 2), matching the fixture's construction exactly.
    expect(wholeMetrics.total).toBe(6)
  })

  // Live feedback fix — a category made entirely of 'presence' leaves (มี/ไม่มี, no ได้มาตรฐาน
  // concept — group C's staffing/training items are exactly this, see optional-group-c.spec.ts's
  // own fixture) genuinely has total===0 and meetsStandard===0 BY CONSTRUCTION even when every
  // item was answered — computeFacilityMetrics excludes presence-only leaves from both (see its
  // own doc). hasItem is what actually reflects the answered content in that case; a caller that
  // only reads meetsStandard/total (as ChecklistSummaryPanel did before this fix) sees a
  // misleading "0/0" for a fully-answered category. This pins down that hasItem is there to read.
  it('a presence-only category (group C staffing items) has total=0 but hasItem reflects what was actually answered', () => {
    const itemsWithPresenceOnlyC = [
      ...ITEMS,
      {
        groupId: 'C1', groupName: '(C1) การฝึกอบรมผู้ให้บริการ', items: [
          { id: 'C1.1', labelTh: 'เจ้าหน้าที่ผ่านการฝึกอบรม', answerType: 'presence', present: true },
          { id: 'C1.2', labelTh: 'มีล่ามภาษามือ', answerType: 'presence', present: true },
        ],
      },
    ]
    const buckets = groupSummaryByCategory(itemsWithPresenceOnlyC)
    const catC = buckets.find((c) => c.value === 'C')!
    expect(catC.metrics.total).toBe(0)
    expect(catC.metrics.meetsStandard).toBe(0)
    expect(catC.metrics.hasItem).toBe(2)
    // facilityEligible is pctHasFacility's own denominator — what ChecklistSummaryPanel shows as
    // "hasItem/facilityEligible" (a real percentage, pctHasFacility) instead of pctSuccess/total
    // whenever there's nothing eligible for a standard at all.
    expect(catC.metrics.facilityEligible).toBe(2)
    expect(catC.metrics.pctHasFacility).toBe(100)
  })
})
