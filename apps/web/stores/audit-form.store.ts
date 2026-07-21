import { create } from 'zustand'
import type { ChecklistTemplateDefinition } from '@repo/types'
import { seedAnswers, hydrateAnswers, defaultAnswer, type AnswerMap, type AuditAnswer } from '@/lib/audit-form'

// E-form redesign (Session E2, Part D) — the audit form's single source of truth. User edits live
// ONLY here; server data (template + draft) hydrates the store ONCE per checklist load via
// hydrate() below, and background refetches (React Query) never call hydrate() again for the same
// checklist — see the audit page's seededForRef guard. This is what closes both P0 bugs:
//   - Tab-switch reset: nothing here is wiped by a refetch: the store is not React Query state,
//     and the queries that feed hydrate() are configured refetchOnWindowFocus:false besides.
//   - Draft resume: hydrate() is called from the draft's stored items on cold mount, not from
//     empty defaults — see hydrateAnswers in lib/audit-form.ts.
//
// Deliberately scoped to just this feature (audit-form slice), not a global mega-store — see the
// E2 kickoff note. A NEW station selection calls hydrate() again (or reset() first via the page's
// station-change effect), overwriting the previous station's answers; this store only ever holds
// one checklist's worth of state at a time, matching the page's one-checklist-at-a-time UI.
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

interface HydrateParams {
  stationId: string
  templateDef: ChecklistTemplateDefinition
  storedItems: unknown          // draft.items, or undefined/null for a fresh checklist
  finalThoughts: string
  yearBuilt: number | null
  eraUnresolved: boolean
  resumedFromDraft: boolean
}

interface AuditFormState {
  stationId: string | null
  templateDef: ChecklistTemplateDefinition | null
  answers: AnswerMap
  finalThoughts: string
  yearBuilt: number | null
  eraUnresolved: boolean
  resumedFromDraft: boolean
  hydrated: boolean
  dirty: boolean            // true once an edit has happened since the last successful save
  saveStatus: SaveStatus

  hydrate: (params: HydrateParams) => void
  setAnswer: (code: string, patch: Partial<AuditAnswer>) => void
  // Session E2 follow-up — one atomic update across several leaf codes at once (the
  // container-level ไม่มี/มี cascade in V2PagerForm's ContainerNode). A single set() call, not N
  // sequential setAnswer() calls, so it's one re-render and one `dirty` flip, not N of each.
  setAnswersBulk: (patch: Record<string, Partial<AuditAnswer>>) => void
  setFinalThoughts: (text: string) => void
  setSaveStatus: (status: SaveStatus) => void
  markSaved: () => void
  reset: () => void
}

const EMPTY_ANSWERS: AnswerMap = {}

export const useAuditFormStore = create<AuditFormState>((set) => ({
  stationId: null,
  templateDef: null,
  answers: EMPTY_ANSWERS,
  finalThoughts: '',
  yearBuilt: null,
  eraUnresolved: false,
  resumedFromDraft: false,
  hydrated: false,
  dirty: false,
  saveStatus: 'idle',

  hydrate: ({ stationId, templateDef, storedItems, finalThoughts, yearBuilt, eraUnresolved, resumedFromDraft }) => set({
    stationId,
    templateDef,
    answers: storedItems ? hydrateAnswers(templateDef, storedItems) : seedAnswers(templateDef),
    finalThoughts,
    yearBuilt,
    eraUnresolved,
    resumedFromDraft,
    hydrated: true,
    dirty: false,
    saveStatus: 'idle',
  }),

  setAnswer: (code, patch) => set((state) => ({
    answers: { ...state.answers, [code]: { ...(state.answers[code] ?? defaultAnswer()), ...patch } },
    dirty: true,
  })),

  setAnswersBulk: (patch) => set((state) => {
    const answers = { ...state.answers }
    for (const [code, p] of Object.entries(patch)) {
      answers[code] = { ...(answers[code] ?? defaultAnswer()), ...p }
    }
    return { answers, dirty: true }
  }),

  setFinalThoughts: (text) => set({ finalThoughts: text, dirty: true }),

  setSaveStatus: (status) => set({ saveStatus: status }),

  markSaved: () => set({ dirty: false, saveStatus: 'saved' }),

  reset: () => set({
    stationId: null,
    templateDef: null,
    answers: EMPTY_ANSWERS,
    finalThoughts: '',
    yearBuilt: null,
    eraUnresolved: false,
    resumedFromDraft: false,
    hydrated: false,
    dirty: false,
    saveStatus: 'idle',
  }),
}))
