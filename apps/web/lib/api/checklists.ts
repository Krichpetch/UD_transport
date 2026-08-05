import { api } from '@/lib/api'
import type { ChecklistGroup, ChecklistTemplateDefinition } from '@repo/types'
import type { SubmitGps } from '@/lib/geolocation'

export interface ChecklistRecord {
  id: string
  stationId: string
  auditorId: string
  items: ChecklistGroup[]
  score: number | null
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'
  submittedAt: string | null
  createdAt: string
  reviewNotes: string | null
  reviewedAt: string | null
  auditorUsername?: string | null
  gpsLat: number | null
  gpsLng: number | null
  gpsAccuracy: number | null
  gpsDistanceM: number | null
  locationVerified: boolean | null
  proximityBypassed: boolean | null
  finalThoughts?: string | null
  appliedYearBuilt?: number | null
  appliedLawRefs?: Record<string, string> | null
  // Session E3, Part B.4 — set when this checklist is a resubmission fixing a rejection; the id
  // of the REJECTED checklist it responds to, or null for an ordinary (non-resubmission) submit.
  respondsToChecklistId?: string | null
  templateVersion?: number | null
  template?: { variantKey: string } | null
  // Session S3b, Part A — stamped from the station at creation; drives the ฝึกหัด badge on the
  // history list/detail. Never affects scoring/display logic beyond that badge — the underlying
  // record renders exactly like any other completed checklist.
  isTraining?: boolean
}

export interface PaginatedChecklistHistory {
  data: ChecklistRecord[]
  total: number
  page: number
  totalPages: number
}

// Session E3, Part B.1 — "งานที่ถูกตีกลับ" on the auditor home.
export interface RejectedChecklistSummary {
  id: string
  stationId: string
  reviewNotes: string | null
  reviewedAt: string | null
  station: { nameTh: string; province: string; mode: string }
}

export function getLatestChecklist(stationId: string) {
  return api.get<ChecklistRecord | null>(`/stations/${stationId}/checklist`)
}

// 2026-08-06 — pre-existing, unrelated to the year-reload work: ChecklistsService.findDraft
// returns `null` for "no draft yet," but Nest serializes that as a genuinely EMPTY response body
// (200, content-length 0), not JSON `null` — so api.get's empty-body handling (see request() in
// lib/api.ts) resolves this to `undefined`, not `null`. Harmless in itself (every call site already
// does draft?.items etc.), but react-query hard-forbids a queryFn ever resolving to `undefined`
// ("Query data cannot be undefined") — fires on literally every fresh audit start, for any station
// with no draft, independent of anything else. Coerced back to `null` here, at the one place this
// function is actually wired into a useQuery (useMyDraft, hooks/use-checklists.ts).
export function getMyDraft(stationId: string) {
  return api.get<ChecklistRecord | null>(`/stations/${stationId}/checklist/draft`).then((r) => r ?? null)
}

// E-form redesign (Session E2, Part A.6) — the mode's ACTIVE template, era-resolved server-side
// (byLaw already flattened to the applicable values — the client never picks between eras).
export interface TemplateForAudit {
  template: ChecklistTemplateDefinition | null
  templateId: string | null
  templateVersion: number | null
  appliedYearBuilt: number | null
  // 2026-08-05 — the exact-date companion to appliedYearBuilt, ISO yyyy-mm-dd, present whenever
  // resolution used one (a real capture, or a preview buildDateOverride) — see checklists.service.ts.
  appliedYearBuiltDate?: string | null
  appliedLawRefs: Record<string, string> | null
  eraUnresolved: boolean
  preview: boolean
}

// `preview: true` requests read-only rendering (no draft hydration/autosave) of the station's
// ACTIVE template — server-gated to ADMIN (Part B.2); a non-admin caller gets a 403. `version`
// pins a specific template version instead (e.g. an un-activated DRAFT), also ADMIN-only.
// `yearBuilt` (Session F1 follow-up) substitutes any build year for era resolution/redaction —
// preview-only (the server rejects it without `preview`/`version`), never persists anything.
// `buildDate` (2026-08-05, ISO yyyy-mm-dd) is its exact-date companion — only meaningful alongside
// `yearBuilt` (server rejects it standalone), lets a preview distinguish the two same-พ.ศ.-year law
// cutovers (PSD_2555 vs MOT_2556, both 2556).
export function getTemplateForAudit(stationId: string, opts?: { preview?: boolean; version?: number; yearBuilt?: number; buildDate?: string }) {
  const params = new URLSearchParams()
  if (opts?.version != null) params.set('version', String(opts.version))
  else if (opts?.preview) params.set('preview', '1')
  if (opts?.yearBuilt != null) params.set('yearBuilt', String(opts.yearBuilt))
  if (opts?.buildDate) params.set('buildDate', opts.buildDate)
  const qs = params.toString()
  return api.get<TemplateForAudit>(`/stations/${stationId}/checklist/template${qs ? `?${qs}` : ''}`)
}

export function getChecklistHistory(stationId: string) {
  return api.get<ChecklistRecord[]>(`/stations/${stationId}/checklist/history`)
}

// Part E (W2-S1) — admin station-detail History tab. Passing page/limit switches the same
// endpoint to a paginated envelope (see ChecklistsController.findAll) rather than the full
// unpaginated array getChecklistHistory above returns.
export function getChecklistHistoryPaginated(stationId: string, page: number, limit: number) {
  return api.get<PaginatedChecklistHistory>(
    `/stations/${stationId}/checklist/history?page=${page}&limit=${limit}`,
  )
}

// `items` is deliberately `unknown[]` rather than `ChecklistGroup[]` — v2 nested trees don't fit
// that flat shape (see @repo/types#StoredChecklistNode); every ChecklistGroup[] value is still
// assignable here, so this is a strict widening, not a breaking change for v1 callers.
// Session F3, Part H.1 — `gps` is sent so the server can run the proximity gate when this call
// CREATES the draft (starting an inspection). The server decides whether that's the case; the
// client never claims it. Autosave ticks on an existing draft carry it harmlessly and ungated.
export function saveDraft(stationId: string, items: unknown[], finalThoughts?: string, gps?: SubmitGps) {
  return api.post<ChecklistRecord>(`/stations/${stationId}/checklist/draft`, { items, finalThoughts, gps })
}

// 2026-08-06 — pairs with the auditor confirm-to-start screen's year-change reload: re-stamps an
// EXISTING draft's frozen appliedYearBuilt/appliedYearBuiltDate against the station's current year,
// so the final submit's scoring actually matches whatever era the auditor just reloaded to on
// screen. A no-op (null) when there's no draft yet — see restampDraftEra's doc in checklists.service.ts.
export function restampDraftEra(stationId: string) {
  return api.post<ChecklistRecord | null>(`/stations/${stationId}/checklist/restamp-era`, {})
}

export function submitChecklist(
  stationId: string,
  items: unknown[],
  score: number,
  gps?: SubmitGps,
  finalThoughts?: string,
) {
  return api.post<ChecklistRecord>(`/stations/${stationId}/checklist/submit`, {
    items, score, gps, finalThoughts,
  })
}

// Session E3, Part C.3 — auditor removes a photo they uploaded, while the checklist is still
// DRAFT or REJECTED. photoId is the MinIO object key (contains a slash) — always sent as a
// query param, never a route segment, matching the presign endpoint's convention.
export function deleteChecklistPhoto(stationId: string, checklistId: string, itemId: string, photoId: string) {
  return api.delete<ChecklistRecord>(
    `/stations/${stationId}/checklist/${checklistId}/items/${encodeURIComponent(itemId)}/photo?photoId=${encodeURIComponent(photoId)}`,
  )
}

// Session E3, Part B.1 — cheap dedicated badge count; never fetches the full list.
export function getMyRejectedCount() {
  return api.get<number>('/checklists/rejected/count')
}

export function getMyRejectedChecklists() {
  return api.get<RejectedChecklistSummary[]>('/checklists/rejected')
}

// Session F1, Part E — "งานของฉัน" (my work): every checklist belonging to the logged-in
// auditor, auditor-scoped server-side by the JWT (never a client-suppliable filter).
export type MyChecklistStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED'

export interface MyChecklistRow {
  id: string
  stationId: string
  status: MyChecklistStatus
  createdAt: string
  updatedAt: string
  submittedAt: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  score: number | null
  station: { nameTh: string; line?: string; mode: string; railSubtype: string | null; province: string | null }
  // Only populated for status === 'DRAFT' — server-computed from stored items, no template fetch.
  progress: { answered: number; total: number } | null
  // Session S3b, Part A.5 — drives the ฝึกหัด badge on this list.
  isTraining: boolean
}

export interface PaginatedMyChecklists {
  data: MyChecklistRow[]
  total: number
  page: number
  totalPages: number
}

export function getMyChecklists(page: number, limit: number, status?: MyChecklistStatus) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status) params.set('status', status)
  return api.get<PaginatedMyChecklists>(`/checklists/mine?${params.toString()}`)
}

// Session F1, Part E.2 — read-only detail for a SUBMITTED/APPROVED row on the my-work list.
export function getMyChecklistDetail(id: string) {
  return api.get<ChecklistRecord & { station: { nameTh: string; line?: string; mode: string; railSubtype: string | null; province: string | null } }>(
    `/checklists/mine/${id}`,
  )
}
