/**
 * Session F1, Part D — draft lifecycle regression coverage for the pieces that live in the store
 * itself (hydrate-once discipline, tab-switch survival, rejected-checklist resume carrying its
 * stamps). The debounced-autosave timer and actual browser tab-switch are page-level (React
 * component) behavior with no test harness in this repo (see final report) — this file proves the
 * STORE-level guarantees those behaviors depend on.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { ChecklistTemplateDefinition } from '@repo/types'
import { useAuditFormStore } from '../audit-form.store'
import { defaultAnswer } from '@/lib/audit-form'

const TEMPLATE: ChecklistTemplateDefinition = {
  schemaVersion: 1, mode: 'ทางบก',
  groups: [{ code: 'A1', labelTh: 'g', items: [{ code: 'A1.1', labelTh: 'x', answerType: 'choice' }] }],
}

beforeEach(() => useAuditFormStore.getState().reset())

describe('Part D — tab-switch mid-edit loses nothing', () => {
  it('the store is a module-level singleton: edits survive independent of any component re-render/remount', () => {
    useAuditFormStore.getState().hydrate({
      stationId: 's1', templateDef: TEMPLATE, storedItems: null, finalThoughts: '',
      yearBuilt: 2560, eraUnresolved: false, resumedFromDraft: false, checklistId: null,
    })
    useAuditFormStore.getState().setAnswer('A1.1', { value: 'มี', meetsStandard: true })
    useAuditFormStore.getState().setFinalThoughts('งานเขียนกลางคัน')

    // Re-reading getState() fresh (as a remounted component's selector would) sees the SAME
    // state — nothing is scoped to a component instance or reset by a re-render.
    const state = useAuditFormStore.getState()
    expect(state.answers['A1.1']).toMatchObject({ value: 'มี', meetsStandard: true })
    expect(state.finalThoughts).toBe('งานเขียนกลางคัน')
    expect(state.dirty).toBe(true)
  })

  it('markSaved clears dirty without touching answers (an autosave success mid-edit does not lose the next edit)', () => {
    useAuditFormStore.getState().hydrate({
      stationId: 's1', templateDef: TEMPLATE, storedItems: null, finalThoughts: '',
      yearBuilt: 2560, eraUnresolved: false, resumedFromDraft: false, checklistId: null,
    })
    useAuditFormStore.getState().setAnswer('A1.1', { value: 'มี' })
    useAuditFormStore.getState().markSaved()
    expect(useAuditFormStore.getState().answers['A1.1']!.value).toBe('มี')
    expect(useAuditFormStore.getState().dirty).toBe(false)
  })
})

describe('Part D — rejected-checklist draft resume keeps stamps + pinned notes', () => {
  it('hydrate carries the frozen appliedYearBuilt/eraUnresolved stamp and resumedFromDraft flag through', () => {
    useAuditFormStore.getState().hydrate({
      stationId: 's1', templateDef: TEMPLATE,
      storedItems: [{ groupId: 'A1', groupName: 'A1', items: [{ id: 'A1.1', labelTh: 'x', value: 'ไม่มี', meetsStandard: false }] }],
      finalThoughts: 'ข้อสังเกตเดิม',
      yearBuilt: 2555, eraUnresolved: true, resumedFromDraft: true, checklistId: 'draft-1',
    })
    const state = useAuditFormStore.getState()
    expect(state.yearBuilt).toBe(2555)         // frozen stamp, not re-resolved
    expect(state.eraUnresolved).toBe(true)
    expect(state.resumedFromDraft).toBe(true)
    expect(state.checklistId).toBe('draft-1')
    expect(state.finalThoughts).toBe('ข้อสังเกตเดิม')
    expect(state.answers['A1.1']!.value).toBe('ไม่มี') // the rejected draft's prior answer, carried forward
    expect(state.dirty).toBe(false) // a resume is not itself an edit
  })

  it('a fresh hydrate() overwrites the previous checklist entirely — no cross-station bleed', () => {
    useAuditFormStore.getState().hydrate({
      stationId: 's1', templateDef: TEMPLATE, storedItems: null, finalThoughts: '',
      yearBuilt: 2560, eraUnresolved: false, resumedFromDraft: false, checklistId: null,
    })
    useAuditFormStore.getState().setAnswer('A1.1', { value: 'มี' })

    useAuditFormStore.getState().hydrate({
      stationId: 's2', templateDef: TEMPLATE, storedItems: null, finalThoughts: '',
      yearBuilt: 2560, eraUnresolved: false, resumedFromDraft: false, checklistId: null,
    })
    expect(useAuditFormStore.getState().answers['A1.1']).toEqual(defaultAnswer())
    expect(useAuditFormStore.getState().stationId).toBe('s2')
  })
})
