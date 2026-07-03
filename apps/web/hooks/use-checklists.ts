'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getLatestChecklist,
  getChecklistHistory,
  getMyDraft,
  saveDraft,
  submitChecklist,
} from '@/lib/api/checklists'
import type { ChecklistGroup } from '@repo/types'
import type { SubmitGps } from '@/lib/geolocation'

export function useChecklist(stationId: string) {
  return useQuery({
    queryKey: ['checklist', stationId],
    queryFn:  () => getLatestChecklist(stationId),
    enabled:  !!stationId,
  })
}

export function useMyDraft(stationId: string) {
  return useQuery({
    queryKey: ['checklist', stationId, 'draft'],
    queryFn:  () => getMyDraft(stationId),
    enabled:  !!stationId,
    staleTime: Infinity,         // draft only changes when this user saves it
    refetchOnWindowFocus: false, // never trigger a re-seed by refetching on tab focus
  })
}

export function useChecklistHistory(stationId: string) {
  return useQuery({
    queryKey: ['checklist', stationId, 'history'],
    queryFn:  () => getChecklistHistory(stationId),
    enabled:  !!stationId,
  })
}

export function useSaveDraft(stationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: ChecklistGroup[]) => saveDraft(stationId, items),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['checklist', stationId] }),
  })
}

export function useSubmitChecklist(stationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ items, score, gps, bypassRequested }: {
      items: ChecklistGroup[]; score: number; gps?: SubmitGps; bypassRequested?: boolean
    }) => submitChecklist(stationId, items, score, gps, bypassRequested),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklist', stationId] })
      qc.invalidateQueries({ queryKey: ['station', stationId] })
      qc.invalidateQueries({ queryKey: ['stations', 'summary'] })
    },
  })
}
