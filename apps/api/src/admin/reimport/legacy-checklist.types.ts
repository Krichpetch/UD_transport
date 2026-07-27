// Part F (W2-S1) — input shape for the pre-cutover historical checklist export (1,394 rows
// incl. 1,385 APPROVED, keyed to 764 old-schema stations). Hand-derived from the schema as it
// existed at commit f139bca (immediately before the masterlist cutover, db2e3a4): old Station
// identity was (nameTh, mode, responsibleAgency, province) with no `line` concept, and
// Checklist.items has always been a Json ChecklistGroup[] snapshot (confirmed back to the very
// first schema commit, ad7a344) — so "flat v1-shaped" just means no `subItems` nesting, which
// ChecklistGroup/ChecklistSubItem (@repo/types) already model exactly.
import type { ChecklistGroup } from '@repo/types'

export interface LegacyChecklistExportRow {
  // Stable identifier from the original export (e.g. the old row's database id or a composite
  // key) — the sole idempotency key: re-running the tool against the same export must never
  // create duplicate checklists.
  sourceId: string
  station: {
    nameTh: string
    mode: string
    responsibleAgency: string
    province: string
  }
  auditorUsername: string
  items: ChecklistGroup[]
  status: 'APPROVED' | 'REJECTED' | 'SUBMITTED'
  submittedAt?: string | null
  createdAt: string
  reviewedAt?: string | null
  reviewNotes?: string | null
  // Old stored score — carried through for reference only. NEVER trusted: every imported row's
  // score is recomputed server-side via computeScoreFromItems.
  score?: number
}

export type ReimportSkipReason =
  | 'REVIEW'
  | 'NOT_ON_MASTERLIST'
  | 'AUDITOR_NOT_FOUND'
  | 'ALREADY_IMPORTED'
  | 'NO_ACTIVE_TEMPLATE'

export interface ReimportRowResult {
  sourceId: string
  nameTh: string
  index: number
  imported?: { checklistId: string; stationId: string }
  skipped?: { reason: ReimportSkipReason; detail?: string }
  error?: string
}

export interface ReimportReport {
  dryRun: boolean
  results: ReimportRowResult[]
  reconciliationCsvPath?: string
}
