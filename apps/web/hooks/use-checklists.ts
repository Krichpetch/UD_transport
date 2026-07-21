'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getLatestChecklist,
  getChecklistHistory,
  getMyDraft,
  getTemplateForAudit,
  saveDraft,
  submitChecklist,
} from '@/lib/api/checklists'
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

// E-form redesign (Session E2, Part A.6/D) — the era-resolved template driving the audit-form
// engine. staleTime: Infinity + refetchOnWindowFocus: false for the same reason as useMyDraft:
// a background refetch must never race the in-progress form's hydration (Part D P0 fix).
export function useTemplateForAudit(stationId: string, preview?: boolean) {
  return useQuery({
    queryKey: ['checklist', stationId, 'template', preview ?? false],
    queryFn:  () => getTemplateForAudit(stationId, preview),
    enabled:  !!stationId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
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
    mutationFn: ({ items, finalThoughts }: { items: unknown[]; finalThoughts?: string }) =>
      saveDraft(stationId, items, finalThoughts),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['checklist', stationId] }),
  })
}

export function useSubmitChecklist(stationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ items, score, gps, finalThoughts }: {
      items: unknown[]; score: number; gps?: SubmitGps; finalThoughts?: string
    }) => submitChecklist(stationId, items, score, gps, finalThoughts),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklist', stationId] })
      qc.invalidateQueries({ queryKey: ['station', stationId] })
      qc.invalidateQueries({ queryKey: ['stations', 'summary'] })
    },
  })
}
