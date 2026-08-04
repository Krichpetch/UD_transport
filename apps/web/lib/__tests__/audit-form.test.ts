/**
 * Session F1, Part A — the audit-form engine's pure cascade/progress helpers. No React/Zustand
 * involved here (that's audit-form.store.test.ts); this file proves the answer-shape and
 * traversal logic the store's actions build on.
 */
import { describe, it, expect } from 'vitest'
import type { ChecklistTemplateDefinition, TemplateNode } from '@repo/types'
import {
  collectLeafCodes,
  collectLeaves,
  absentPatchFor,
  isLeafAnswered,
  countProgressForNodes,
  computeContainerStatus,
  collectRedactedLeaves,
  isNodeFullyRedacted,
  seedAnswers,
  hydrateAnswers,
  buildStoredGroups,
  defaultAnswer,
  type AnswerMap,
} from '../audit-form'

// A 3-level tree: A1.1 (pure container) -> A1.1-1 (choice leaf), A1.1-2 (hybrid: presence leaf
// AND its own subItems) -> A1.1-2.1 (presence_standard leaf, deepest level).
const TREE: TemplateNode = {
  code: 'A1.1', labelTh: 'container', subItems: [
    { code: 'A1.1-1', labelTh: 'choice leaf', answerType: 'choice' },
    {
      code: 'A1.1-2', labelTh: 'hybrid leaf', answerType: 'presence', subItems: [
        { code: 'A1.1-2.1', labelTh: 'deepest leaf', answerType: 'presence_standard', measurements: [
          { key: 'm1', operator: 'gte', value: 90, unit: 'mm', autoGrade: true },
        ] },
      ],
    },
  ],
}

function def(): ChecklistTemplateDefinition {
  return { schemaVersion: 2, mode: 'ทางบก', groups: [{ code: 'A1', labelTh: 'g', items: [TREE] }] }
}

describe('collectLeafCodes / collectLeaves — multi-level traversal', () => {
  it('collects every descendant leaf across all 3 levels, not just direct children', () => {
    expect(collectLeafCodes(TREE)).toEqual(['A1.1-1', 'A1.1-2', 'A1.1-2.1'])
  })

  it('collectLeaves returns the actual node refs (answerType intact) for the same set', () => {
    const leaves = collectLeaves(TREE)
    expect(leaves.map((l) => l.code)).toEqual(['A1.1-1', 'A1.1-2', 'A1.1-2.1'])
    expect(leaves.find((l) => l.code === 'A1.1-1')!.answerType).toBe('choice')
    expect(leaves.find((l) => l.code === 'A1.1-2.1')!.answerType).toBe('presence_standard')
  })
})

describe('absentPatchFor — Part A.3 answer-type-aware ไม่มี cascade patch', () => {
  it('a choice leaf gets a real ไม่มี value', () => {
    expect(absentPatchFor({ code: 'x', labelTh: 'x', answerType: 'choice' })).toEqual({
      value: 'ไม่มี', meetsStandard: false, flagged: false,
    })
  })

  it('a presence/presence_standard leaf gets present:false and cleared measured values', () => {
    expect(absentPatchFor({ code: 'x', labelTh: 'x', answerType: 'presence_standard' })).toEqual({
      present: false, value: null, meetsStandard: false, values: {},
    })
  })
})

describe('isLeafAnswered — Part A.6 auto-filled/N/A count as answered', () => {
  it('an auto-filled ไม่มี choice answer counts as answered', () => {
    const node: TemplateNode = { code: 'x', labelTh: 'x', answerType: 'choice' }
    expect(isLeafAnswered(node, { ...defaultAnswer(), value: 'ไม่มี' })).toBe(true)
  })

  it('an auto-filled present:false presence answer counts as answered', () => {
    const node: TemplateNode = { code: 'x', labelTh: 'x', answerType: 'presence' }
    expect(isLeafAnswered(node, { ...defaultAnswer(), present: false })).toBe(true)
  })

  it('a cascaded N/A answer counts as answered, for any answerType', () => {
    const node: TemplateNode = { code: 'x', labelTh: 'x', answerType: 'presence_standard' }
    expect(isLeafAnswered(node, { ...defaultAnswer(), value: 'N/A' })).toBe(true)
  })

  it('a genuinely untouched leaf does not count as answered', () => {
    const node: TemplateNode = { code: 'x', labelTh: 'x', answerType: 'choice' }
    expect(isLeafAnswered(node, defaultAnswer())).toBe(false)
  })
})

describe('countProgressForNodes — cascade progress + Part C.5 redaction exclusion', () => {
  it('every leaf across all 3 levels counts toward total', () => {
    const answers = seedAnswers(def())
    const { total } = countProgressForNodes([TREE], answers)
    expect(total).toBe(3)
  })

  it('a container-level ไม่มี cascade (every descendant auto-filled) reads as fully answered', () => {
    const answers: AnswerMap = {
      'A1.1-1': { ...defaultAnswer(), value: 'ไม่มี' },
      'A1.1-2': { ...defaultAnswer(), present: false },
      'A1.1-2.1': { ...defaultAnswer(), present: false },
    }
    const { answered, total } = countProgressForNodes([TREE], answers)
    expect(answered).toBe(total)
    expect(total).toBe(3)
  })

  it('an era-redacted leaf (applicable: false) is excluded from both total and answered', () => {
    const redactedTree: TemplateNode = {
      ...TREE,
      subItems: [
        TREE.subItems![0]!,
        { ...TREE.subItems![1]!, applicable: false, subItems: TREE.subItems![1]!.subItems!.map((n) => ({ ...n, applicable: false })) },
      ],
    }
    const { total } = countProgressForNodes([redactedTree], seedAnswers(def()))
    expect(total).toBe(1) // only A1.1-1 counts; A1.1-2 and A1.1-2.1 are redacted
  })
})

describe('computeContainerStatus — Part A derived choice (มี/ไม่มี/ไม่เกี่ยวข้อง/บางส่วน/ยังไม่ตอบ)', () => {
  it('untouched container reads as ยังไม่ตอบ', () => {
    expect(computeContainerStatus(TREE, seedAnswers(def()))).toBe('ยังไม่ตอบ')
  })

  it('every descendant auto-filled ไม่มี reads as ไม่มี (Part A.3 — real answers, not N/A)', () => {
    const answers: AnswerMap = {
      'A1.1-1': { ...defaultAnswer(), value: 'ไม่มี' },
      'A1.1-2': { ...defaultAnswer(), present: false },
      'A1.1-2.1': { ...defaultAnswer(), present: false },
    }
    expect(computeContainerStatus(TREE, answers)).toBe('ไม่มี')
  })

  it('every descendant cascaded N/A reads as ไม่เกี่ยวข้อง', () => {
    const answers: AnswerMap = {
      'A1.1-1': { ...defaultAnswer(), value: 'N/A' },
      'A1.1-2': { ...defaultAnswer(), value: 'N/A' },
      'A1.1-2.1': { ...defaultAnswer(), value: 'N/A' },
    }
    expect(computeContainerStatus(TREE, answers)).toBe('ไม่เกี่ยวข้อง')
  })

  it('any descendant มี reads as มี, even mixed with others unanswered', () => {
    const answers: AnswerMap = {
      'A1.1-1': { ...defaultAnswer(), value: 'มี' },
    }
    expect(computeContainerStatus(TREE, answers)).toBe('มี')
  })
})

describe('collectRedactedLeaves / isNodeFullyRedacted — Part C.3', () => {
  it('collects only the leaves marked applicable:false', () => {
    const redactedTree: TemplateNode = {
      ...TREE,
      subItems: [
        TREE.subItems![0]!,
        { ...TREE.subItems![1]!, applicable: false },
      ],
    }
    const redacted = collectRedactedLeaves([redactedTree])
    expect(redacted.map((n) => n.code)).toEqual(['A1.1-2'])
  })

  it('a pure container with every leaf redacted is itself fully redacted', () => {
    const allRedacted: TemplateNode = { ...TREE, subItems: TREE.subItems!.map((n) => ({ ...n, applicable: false, subItems: n.subItems?.map((c) => ({ ...c, applicable: false })) })) }
    expect(isNodeFullyRedacted(allRedacted)).toBe(true)
  })

  it('a container with at least one applicable leaf is not fully redacted', () => {
    const partiallyRedacted: TemplateNode = { ...TREE, subItems: [TREE.subItems![0]!, { ...TREE.subItems![1]!, applicable: false }] }
    expect(isNodeFullyRedacted(partiallyRedacted)).toBe(false)
  })
})

describe('hydrateAnswers / buildStoredGroups — Part D draft round-trip', () => {
  it('save -> reload round-trips every field for each answer kind', () => {
    const template = def()
    const answers: AnswerMap = {
      'A1.1-1': { ...defaultAnswer(), value: 'มี', meetsStandard: true, note: 'สังเกต' },
      'A1.1-2': { ...defaultAnswer(), present: false },
      'A1.1-2.1': { ...defaultAnswer(), present: true, values: { m1: 95 } },
    }
    const stored = buildStoredGroups(template, answers)
    const rehydrated = hydrateAnswers(template, stored)
    expect(rehydrated['A1.1-1']).toMatchObject({ value: 'มี', meetsStandard: true, note: 'สังเกต' })
    expect(rehydrated['A1.1-2']).toMatchObject({ present: false })
    expect(rehydrated['A1.1-2.1']).toMatchObject({ present: true, values: { m1: 95 } })
  })

  it('a cascaded ไม่มี answer round-trips as a real answer, not lost on reload', () => {
    const template = def()
    const answers: AnswerMap = { ...seedAnswers(template), 'A1.1-1': { ...defaultAnswer(), value: 'ไม่มี' } }
    const stored = buildStoredGroups(template, answers)
    const rehydrated = hydrateAnswers(template, stored)
    expect(rehydrated['A1.1-1']!.value).toBe('ไม่มี')
  })

  it('a cascaded ไม่เกี่ยวข้อง (N/A) subtree round-trips correctly', () => {
    const template = def()
    const answers: AnswerMap = {
      ...seedAnswers(template),
      'A1.1-2': { ...defaultAnswer(), value: 'N/A' },
      'A1.1-2.1': { ...defaultAnswer(), value: 'N/A' },
    }
    const stored = buildStoredGroups(template, answers)
    const rehydrated = hydrateAnswers(template, stored)
    expect(rehydrated['A1.1-2']!.value).toBe('N/A')
    expect(rehydrated['A1.1-2.1']!.value).toBe('N/A')
  })

  it('Part D — tiered measurement inputs round-trip (basis/provided keys, not measurement-key-prefixed)', () => {
    const tieredTemplate: ChecklistTemplateDefinition = {
      schemaVersion: 2, mode: 'ทางบก',
      groups: [{ code: 'A1', labelTh: 'g', items: [
        { code: 'T1', labelTh: 'tiered leaf', answerType: 'presence_standard', measurements: [
          { key: 'm1', operator: 'tiered', unit: 'จุด', autoGrade: true,
            inputs: [{ key: 'basis', labelTh: 'พื้นฐาน' }, { key: 'provided', labelTh: 'จัดให้' }],
            tiers: [{ min: 0, max: 100, required: 1 }] },
        ] },
      ] }],
    }
    const answers: AnswerMap = { T1: { ...defaultAnswer(), present: true, values: { basis: 50, provided: 2 } } }
    const stored = buildStoredGroups(tieredTemplate, answers)
    const rehydrated = hydrateAnswers(tieredTemplate, stored)
    expect(rehydrated['T1']).toMatchObject({ present: true, values: { basis: 50, provided: 2 } })
  })

  it('Part D — notes, photos, and flagged all round-trip on a choice leaf', () => {
    const template = def()
    const photo = { id: 'p1', url: 'https://example.test/p1.jpg', filename: 'p1.jpg', uploadedAt: '2026-08-01T00:00:00.000Z' }
    const answers: AnswerMap = {
      ...seedAnswers(template),
      'A1.1-1': { ...defaultAnswer(), value: 'มี', flagged: true, note: 'พบปัญหาเล็กน้อย', photos: [photo] },
    }
    const stored = buildStoredGroups(template, answers)
    const rehydrated = hydrateAnswers(template, stored)
    expect(rehydrated['A1.1-1']).toMatchObject({ value: 'มี', flagged: true, note: 'พบปัญหาเล็กน้อย', photos: [photo] })
  })
})
