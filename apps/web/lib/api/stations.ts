import { api } from '@/lib/api'
import type { Station, KpiSummary } from '@repo/types'

export interface StationFilters {
  mode?: string
  region?: string
  agency?: string
  status?: string
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
