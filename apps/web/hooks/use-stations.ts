'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getStations,
  getStation,
  getStationSummary,
  createStation,
  getPendingReviews,
  approveChecklist,
  type CreateStationInput,
} from '@/lib/api/stations'
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

export function useCreateStation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: CreateStationInput) => createStation(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stations'] })
    },
  })
}

export function usePendingReviews() {
  return useQuery({
    queryKey: ['stations', 'pending-reviews'],
    queryFn:  getPendingReviews,
  })
}

export function useApproveChecklist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ stationId, checklistId }: { stationId: string; checklistId: string }) =>
      approveChecklist(stationId, checklistId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stations'] })
      void qc.invalidateQueries({ queryKey: ['stations', 'pending-reviews'] })
    },
  })
}
