/**
 * Session F1, Part A — the Zustand audit-form store's stashAndCascade/restoreStash actions: the
 * mechanics behind ContainerNode's มี/ไม่มี/ไม่เกี่ยวข้อง buttons and LeafAnswerRow's hybrid-node
 * cascade (V2PagerForm.tsx / LeafAnswerRow.tsx). Exercises the store directly (no React rendering
 * needed — Zustand's vanilla store works standalone in Node).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { ChecklistTemplateDefinition } from '@repo/types'
import { useAuditFormStore } from '../audit-form.store'
import { collectLeafCodes, collectLeaves, absentPatchFor, defaultAnswer } from '@/lib/audit-form'

const TEMPLATE: ChecklistTemplateDefinition = {
  schemaVersion: 2, mode: 'ทางบก',
  groups: [{
    code: 'A1', labelTh: 'g', items: [{
      code: 'A1.1', labelTh: 'container', subItems: [
        { code: 'A1.1-1', labelTh: 'choice leaf', answerType: 'choice' },
        { code: 'A1.1-2', labelTh: 'presence leaf', answerType: 'presence', subItems: [
          { code: 'A1.1-2.1', labelTh: 'deepest leaf', answerType: 'presence_standard' },
        ] },
      ],
    }],
  }],
}
const CONTAINER = TEMPLATE.groups[0]!.items[0]!

function resetStore() {
  useAuditFormStore.getState().reset()
  useAuditFormStore.getState().hydrate({
    stationId: 's1', templateDef: TEMPLATE, storedItems: null, finalThoughts: '',
    yearBuilt: 2560, eraUnresolved: false, resumedFromDraft: false, checklistId: null,
  })
}

describe('audit-form.store — Part A.3/A.5 cascade + restore-on-toggle-back', () => {
  beforeEach(resetStore)

  it('stashAndCascade sets a real ไม่มี answer on every descendant across multiple levels', () => {
    const leaves = collectLeaves(CONTAINER)
    useAuditFormStore.getState().stashAndCascade(Object.fromEntries(leaves.map((l) => [l.code, absentPatchFor(l)])))
    const { answers } = useAuditFormStore.getState()
    expect(answers['A1.1-1']!.value).toBe('ไม่มี')
    expect(answers['A1.1-2']!.present).toBe(false)
    expect(answers['A1.1-2.1']!.present).toBe(false) // deepest level, 2 containers down
  })

  it('restore-on-toggle-back brings back a hand-entered answer, not the auto-filled one', () => {
    // Auditor manually fills A1.1-1 = มี before touching the container's ไม่มี button.
    useAuditFormStore.getState().setAnswer('A1.1-1', { value: 'มี', meetsStandard: true })

    const leaves = collectLeaves(CONTAINER)
    useAuditFormStore.getState().stashAndCascade(Object.fromEntries(leaves.map((l) => [l.code, absentPatchFor(l)])))
    expect(useAuditFormStore.getState().answers['A1.1-1']!.value).toBe('ไม่มี') // cascaded over the manual answer

    useAuditFormStore.getState().restoreStash(collectLeafCodes(CONTAINER))
    const restored = useAuditFormStore.getState().answers['A1.1-1']!
    expect(restored.value).toBe('มี')
    expect(restored.meetsStandard).toBe(true)
  })

  it('a leaf with no prior manual answer resets to the blank default on restore, not the auto-filled value', () => {
    const leaves = collectLeaves(CONTAINER)
    useAuditFormStore.getState().stashAndCascade(Object.fromEntries(leaves.map((l) => [l.code, absentPatchFor(l)])))
    useAuditFormStore.getState().restoreStash(collectLeafCodes(CONTAINER))
    expect(useAuditFormStore.getState().answers['A1.1-1']).toEqual(defaultAnswer())
  })

  // Session F3, Part B — REWRITTEN, not deleted. This test used to drive ไม่มี -> ไม่เกี่ยวข้อง,
  // a chain that no longer exists now that the ไม่เกี่ยวข้อง button is gone (สนข. 2026-08-03: ไม่มี
  // is used in its place). The INVARIANT it protects is unchanged and still reachable in the
  // 2-way world — a second cascade over already-cascaded leaves (a re-click, or an ancestor
  // container cascading over a descendant that already did) must never overwrite the stashed
  // ORIGINAL manual answer with the intermediate auto-filled one. So the chain is now ไม่มี ->
  // ไม่มี, which exercises exactly the same `if (!(code in stash))` guard in stashAndCascade.
  it('a second ไม่มี cascade never re-stashes the already-cascaded value over the original manual one', () => {
    useAuditFormStore.getState().setAnswer('A1.1-1', { value: 'มี', meetsStandard: true })

    const leaves = collectLeaves(CONTAINER)
    const codes = collectLeafCodes(CONTAINER)
    const absentPatches = Object.fromEntries(leaves.map((l) => [l.code, absentPatchFor(l)]))
    useAuditFormStore.getState().stashAndCascade(absentPatches) // -> ไม่มี
    useAuditFormStore.getState().stashAndCascade(absentPatches) // -> ไม่มี again, no restore between

    expect(useAuditFormStore.getState().answers['A1.1-1']!.value).toBe('ไม่มี')

    useAuditFormStore.getState().restoreStash(codes) // back to มี
    const restored = useAuditFormStore.getState().answers['A1.1-1']!
    expect(restored.value).toBe('มี') // the ORIGINAL manual answer, not the intermediate ไม่มี cascade
    expect(restored.meetsStandard).toBe(true)
  })

  it('hydrate() clears any leftover stash from a previous station/checklist', () => {
    const leaves = collectLeaves(CONTAINER)
    useAuditFormStore.getState().stashAndCascade(Object.fromEntries(leaves.map((l) => [l.code, absentPatchFor(l)])))
    expect(Object.keys(useAuditFormStore.getState().containerStash).length).toBeGreaterThan(0)

    resetStore()
    expect(useAuditFormStore.getState().containerStash).toEqual({})
  })
})
