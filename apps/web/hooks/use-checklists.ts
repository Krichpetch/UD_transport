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
    mutationFn: ({ items, score }: { items: ChecklistGroup[]; score: number }) =>
      submitChecklist(stationId, items, score),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklist', stationId] })
      qc.invalidateQueries({ queryKey: ['station', stationId] })
      qc.invalidateQueries({ queryKey: ['stations', 'summary'] })
    },
  })
}
