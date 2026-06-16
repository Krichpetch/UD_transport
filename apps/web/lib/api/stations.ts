import { api } from '@/lib/api'
import type { Station, KpiSummary } from '@repo/types'

export interface StationFilters {
  mode?: string
  region?: string
  agency?: string
  status?: string
}

export interface CreateStationInput {
  name: string
  nameTh: string
  mode: string
  railSubtype?: string
  province: string
  region: string
  responsibleAgency: string
  lat: number
  lng: number
}

export interface ParsedRow {
  nameTh: string
  name: string
  mode: string
  railSubtype?: string
  province: string
  region: string
  responsibleAgency: string
  lat: number
  lng: number
}

export function getStations(filters?: StationFilters) {
  const params = new URLSearchParams()
  if (filters?.mode)   params.set('mode',   filters.mode)
  if (filters?.region) params.set('region', filters.region)
  if (filters?.agency) params.set('agency', filters.agency)
  if (filters?.status) params.set('status', filters.status)
  const qs = params.toString()
  return api.get<Station[]>(`/stations${qs ? `?${qs}` : ''}`)
}

export function getStation(id: string) {
  return api.get<Station>(`/stations/${id}`)
}

export function getStationSummary() {
  return api.get<KpiSummary>('/stations/summary')
}

export function createStation(data: CreateStationInput) {
  return api.post<Station>('/stations', data)
}

export function getPendingReviews() {
  return api.get<string[]>('/stations/pending-reviews')
}

export function approveChecklist(stationId: string, checklistId: string) {
  return api.post<void>(`/stations/${stationId}/checklist/${checklistId}/approve`, {})
}
