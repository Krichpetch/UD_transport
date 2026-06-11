'use client'

import { useQuery } from '@tanstack/react-query'
import { getStations, getStation, getStationSummary } from '@/lib/api/stations'
import type { TransportMode, StationStatus } from '@repo/types'

export interface StationFilters {
  mode?: TransportMode | ''
  region?: string
  agency?: string
  status?: StationStatus | ''
}

export function useStations(filters?: StationFilters) {
  const f = {
    mode:   filters?.mode   || undefined,
    region: filters?.region || undefined,
    agency: filters?.agency || undefined,
    status: filters?.status || undefined,
  }
  return useQuery({
    queryKey: ['stations', f],
    queryFn:  () => getStations(f),
  })
}

export function useStation(id: string) {
  return useQuery({
    queryKey: ['station', id],
    queryFn:  () => getStation(id),
    enabled:  !!id,
  })
}

export function useStationSummary() {
  return useQuery({
    queryKey: ['stations', 'summary'],
    queryFn:  getStationSummary,
  })
}
