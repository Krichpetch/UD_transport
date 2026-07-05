import { api } from '@/lib/api'
import type { ChecklistGroup } from '@repo/types'
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
  gpsLat: number | null
  gpsLng: number | null
  gpsAccuracy: number | null
  gpsDistanceM: number | null
  locationVerified: boolean | null
  proximityBypassed: boolean | null
}

export function getLatestChecklist(stationId: string) {
  return api.get<ChecklistRecord | null>(`/stations/${stationId}/checklist`)
}

export function getMyDraft(stationId: string) {
  return api.get<ChecklistRecord | null>(`/stations/${stationId}/checklist/draft`)
}

export function getChecklistHistory(stationId: string) {
  return api.get<ChecklistRecord[]>(`/stations/${stationId}/checklist/history`)
}

export function saveDraft(stationId: string, items: ChecklistGroup[]) {
  return api.post<ChecklistRecord>(`/stations/${stationId}/checklist/draft`, { items })
}

export function submitChecklist(
  stationId: string,
  items: ChecklistGroup[],
  score: number,
  gps?: SubmitGps,
) {
  return api.post<ChecklistRecord>(`/stations/${stationId}/checklist/submit`, {
    items, score, gps,
  })
}
