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

export function getMyDraft(stationId: string) {
  return api.get<ChecklistRecord | null>(`/stations/${stationId}/checklist/draft`)
}

// E-form redesign (Session E2, Part A.6) — the mode's ACTIVE template, era-resolved server-side
// (byLaw already flattened to the applicable values — the client never picks between eras).
export interface TemplateForAudit {
  template: ChecklistTemplateDefinition | null
  templateId: string | null
  templateVersion: number | null
  appliedYearBuilt: number | null
  appliedLawRefs: Record<string, string> | null
  eraUnresolved: boolean
  preview: boolean
}

// `preview: true` requests the mode's un-activated v2 DRAFT definition — server-gated to ADMIN
// (Part B.2); a non-admin caller gets a 403, not a silent fallback to v1.
export function getTemplateForAudit(stationId: string, preview?: boolean) {
  return api.get<TemplateForAudit>(`/stations/${stationId}/checklist/template${preview ? '?preview=v2' : ''}`)
}

export function getChecklistHistory(stationId: string) {
  return api.get<ChecklistRecord[]>(`/stations/${stationId}/checklist/history`)
}

// `items` is deliberately `unknown[]` rather than `ChecklistGroup[]` — v2 nested trees don't fit
// that flat shape (see @repo/types#StoredChecklistNode); every ChecklistGroup[] value is still
// assignable here, so this is a strict widening, not a breaking change for v1 callers.
export function saveDraft(stationId: string, items: unknown[], finalThoughts?: string) {
  return api.post<ChecklistRecord>(`/stations/${stationId}/checklist/draft`, { items, finalThoughts })
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
