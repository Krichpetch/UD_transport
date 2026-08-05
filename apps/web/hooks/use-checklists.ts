'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getLatestChecklist,
  getChecklistHistory,
  getChecklistHistoryPaginated,
  getMyDraft,
  getTemplateForAudit,
  saveDraft,
  submitChecklist,
  deleteChecklistPhoto,
  getMyRejectedCount,
  getMyRejectedChecklists,
  getMyChecklists,
  getMyChecklistDetail,
} from '@/lib/api/checklists'
import type { SubmitGps } from '@/lib/geolocation'
import type { MyChecklistStatus } from '@/lib/api/checklists'

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
// `yearBuiltOverride` (Session F1 follow-up) is included in the query key so picking a different
// preview year re-fetches and re-hydrates rather than reusing a stale cached resolution.
// `buildDateOverride` (2026-08-05) is its exact-date companion, same reasoning.
export function useTemplateForAudit(stationId: string, preview?: boolean, version?: number, yearBuiltOverride?: number, buildDateOverride?: string) {
  return useQuery({
    queryKey: ['checklist', stationId, 'template', preview ?? false, version ?? null, yearBuiltOverride ?? null, buildDateOverride ?? null],
    queryFn:  () => getTemplateForAudit(stationId, { preview, version, yearBuilt: yearBuiltOverride, buildDate: buildDateOverride }),
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

// Part E (W2-S1) — paginated variant for the admin station-detail History tab.
export function useChecklistHistoryPaginated(stationId: string, page: number, limit: number) {
  return useQuery({
    queryKey: ['checklist', stationId, 'history', 'paginated', page, limit],
    queryFn:  () => getChecklistHistoryPaginated(stationId, page, limit),
    enabled:  !!stationId,
  })
}

export function useSaveDraft(stationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ items, finalThoughts, gps }: { items: unknown[]; finalThoughts?: string; gps?: SubmitGps }) =>
      saveDraft(stationId, items, finalThoughts, gps),
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
      qc.invalidateQueries({ queryKey: ['checklists', 'rejected'] })
    },
  })
}

// Session E3, Part C.3 — deleting a photo the auditor uploaded themselves (wrong-evidence case).
export function useDeleteChecklistPhoto(stationId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ checklistId, itemId, photoId }: { checklistId: string; itemId: string; photoId: string }) =>
      deleteChecklistPhoto(stationId, checklistId, itemId, photoId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['checklist', stationId] })
    },
  })
}

// Session E3, Part B.1 — auditor home's "งานที่ถูกตีกลับ" badge/list.
export function useMyRejectedCount(enabled = true) {
  return useQuery({
    queryKey: ['checklists', 'rejected', 'count'],
    queryFn: getMyRejectedCount,
    enabled,
  })
}

export function useMyRejectedChecklists(enabled: boolean) {
  return useQuery({
    queryKey: ['checklists', 'rejected'],
    queryFn: getMyRejectedChecklists,
    enabled,
  })
}

// Session F1, Part E — "งานของฉัน" full history, paginated + status-filterable.
export function useMyChecklists(page: number, limit: number, status?: MyChecklistStatus) {
  return useQuery({
    queryKey: ['checklists', 'mine', page, limit, status ?? null],
    queryFn: () => getMyChecklists(page, limit, status),
  })
}

export function useMyChecklistDetail(id: string) {
  return useQuery({
    queryKey: ['checklists', 'mine', 'detail', id],
    queryFn: () => getMyChecklistDetail(id),
    enabled: !!id,
  })
}
