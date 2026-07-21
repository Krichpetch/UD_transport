'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  getStations,
  getStation,
  getStationSummary,
  getStationFilterOptions,
  createStation,
  updateStation,
  updateStationYearBuilt,
  getPendingReviews,
  approveChecklist,
  rejectChecklist,
  setItemFlag,
  getStationMetrics,
  getStationMapNodes,
  type CreateStationInput,
  type UpdateStationInput,
  type StationFilters,
  type StationMetricsFilters,
} from '@/lib/api/stations'

export function useStations(filters?: StationFilters) {
  const f = {
    mode:            filters?.mode            || undefined,
    region:          filters?.region          || undefined,
    agency:          filters?.agency          || undefined,
    status:          filters?.status          || undefined,
    checklistStatus: filters?.checklistStatus || undefined,
    search:          filters?.search          || undefined,
    page:            filters?.page            ?? 1,
    limit:           filters?.limit,
    sortBy:          filters?.sortBy,
    sortOrder:       filters?.sortOrder,
  }
  return useQuery({
    queryKey: ['stations', f],
    queryFn:  () => getStations(f),
    // Keep showing the previous page's rows while a new query/filter/sort fetches —
    // otherwise isLoading flips true on every keystroke and unmounts the whole page.
    placeholderData: keepPreviousData,
  })
}

export function useStationFilterOptions() {
  return useQuery({
    queryKey: ['station-filters'],
    queryFn:  getStationFilterOptions,
    staleTime: 5 * 60 * 1000,
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

// Server-side facility-metrics aggregation — replaces the old per-station useQueries fan-out.
// Only meaningful once a sub-item is picked, but the endpoint accepts the call unconditionally.
export function useStationMetrics(filters: StationMetricsFilters, enabled: boolean) {
  return useQuery({
    queryKey: ['stations', 'metrics', filters],
    queryFn:  () => getStationMetrics(filters),
    enabled,
  })
}

// Slim uncapped station list for the dashboard's map/table/filters (findAll() is capped at 100).
export function useStationMapNodes() {
  return useQuery({
    queryKey: ['stations', 'map-nodes'],
    queryFn:  getStationMapNodes,
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

export function useUpdateStation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateStationInput }) => updateStation(id, data),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['stations'] })
      void qc.invalidateQueries({ queryKey: ['station', vars.id] })
    },
  })
}

// E-form redesign (Session E2, Part A/C.6) — auditor-editable build year, set at confirm-to-start.
export function useUpdateYearBuilt() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, yearBuilt }: { id: string; yearBuilt: number }) => updateStationYearBuilt(id, yearBuilt),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['station', vars.id] })
      void qc.invalidateQueries({ queryKey: ['checklist', vars.id, 'template'] })
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

export function useRejectChecklist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ stationId, checklistId, notes }: { stationId: string; checklistId: string; notes: string }) =>
      rejectChecklist(stationId, checklistId, notes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['stations'] })
      void qc.invalidateQueries({ queryKey: ['stations', 'pending-reviews'] })
    },
  })
}

export function useSetItemFlag() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ stationId, checklistId, itemId, reviewFlag }: {
      stationId: string; checklistId: string; itemId: string; reviewFlag: boolean
    }) => setItemFlag(stationId, checklistId, itemId, reviewFlag),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['checklist', vars.stationId] })
    },
  })
}
