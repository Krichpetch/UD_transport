import { api } from '@/lib/api'
import type { ChecklistGroup } from '@repo/types'

export interface ChecklistRecord {
  id: string
  stationId: string
  auditorId: string
  items: ChecklistGroup[]
  score: number | null
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED'
  submittedAt: string | null
  createdAt: string
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

export function submitChecklist(stationId: string, items: ChecklistGroup[], score: number) {
  return api.post<ChecklistRecord>(`/stations/${stationId}/checklist/submit`, { items, score })
}
