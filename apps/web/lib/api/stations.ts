import { api } from '@/lib/api'
import type { Station, KpiSummary } from '@repo/types'

export interface StationFilters {
  mode?: string
  region?: string
  agency?: string
  status?: string
  search?: string
  page?: number
  limit?: number
}

export interface PaginatedStations {
  data: Station[]
  total: number
  page: number
  totalPages: number
}

export interface StationFilterOptions {
  regions: string[]
  agencies: string[]
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
  if (filters?.search) params.set('search', filters.search)
  if (filters?.page)   params.set('page',   String(filters.page))
  if (filters?.limit)  params.set('limit',  String(filters.limit))
  const qs = params.toString()
  return api.get<PaginatedStations>(`/stations${qs ? `?${qs}` : ''}`)
}

export function getStationFilterOptions() {
  return api.get<StationFilterOptions>('/stations/filters')
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

export interface OtpStationPayload {
  nameTh: string; name: string; mode: string; railSubtype?: string
  province: string; region: string; responsibleAgency: string; lat: number; lng: number
}

export interface OtpRowPayload {
  station: OtpStationPayload
  items: unknown
  score: number
  status: string
  lastInspected: string
}

export function batchOtpImport(rows: OtpRowPayload[]) {
  return api.post<{ id: string; nameTh: string }[]>('/stations/batch-otp', { rows })
}
