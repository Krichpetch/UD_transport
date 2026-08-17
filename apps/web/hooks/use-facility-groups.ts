'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as groupsApi from '@/lib/api/facility-groups'

const GROUPS_KEY = ['admin', 'template-groups'] as const
const groupsKey = (version: number) => [...GROUPS_KEY, version] as const
const conflictsKey = (version: number) => [...GROUPS_KEY, 'conflicts', version] as const
const reviewQueueKey = (version: number) => [...GROUPS_KEY, 'review-queue', version] as const

// Session S4b-fix, Fix 4 — `enabled` lets the individual template editor reuse this same query
// (for the provenance banner) without firing it against a non-v3 template, which the grouping
// engine isn't scoped for (see facility-groups.service.ts's VersionScope doc).
export function useFacilityGroups(version: number, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: groupsKey(version),
    queryFn: () => groupsApi.getFacilityGroups(version),
    enabled: options?.enabled ?? true,
  })
}

export function useGroupConflicts(version: number) {
  return useQuery({ queryKey: conflictsKey(version), queryFn: () => groupsApi.getGroupConflicts(version) })
}

export function useGroupedReviewQueue(version: number) {
  return useQuery({ queryKey: reviewQueueKey(version), queryFn: () => groupsApi.getGroupedReviewQueue(version) })
}

// Every mutation below touches N template rows at once, so it invalidates the whole
// admin/template-groups query family (groups, conflicts, review-queue) rather than trying to
// patch individual cache entries — cheap given how few templates/items exist, and correctness
// here matters far more than shaving a refetch (same tradeoff use-templates-admin.ts already made).
function useInvalidateGroups(version: number) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: GROUPS_KEY })
    void qc.invalidateQueries({ queryKey: ['admin', 'templates'] })
    void qc.invalidateQueries({ queryKey: groupsKey(version) })
  }
}

export function usePropagateItemEdit(version: number) {
  const invalidate = useInvalidateGroups(version)
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: groupsApi.GroupedEditBody }) => groupsApi.propagateItemEdit(version, itemId, body),
    onSuccess: invalidate,
  })
}

// Era-editor safety session, Part E — moves an unattached node onto a different existing group.
export function useAttachNodeToGroup(version: number) {
  const invalidate = useInvalidateGroups(version)
  return useMutation({
    mutationFn: ({ targetItemId, body }: { targetItemId: string; body: groupsApi.AttachNodeToGroupBody }) =>
      groupsApi.attachNodeToGroup(version, targetItemId, body),
    onSuccess: invalidate,
  })
}

export function useConfirmGroupedMeasurement(version: number) {
  const invalidate = useInvalidateGroups(version)
  return useMutation({
    mutationFn: ({ itemId, measurementKey }: { itemId: string; measurementKey: string }) =>
      groupsApi.confirmGroupedMeasurement(version, itemId, measurementKey),
    onSuccess: invalidate,
  })
}

export function useResolveConflict(version: number) {
  const invalidate = useInvalidateGroups(version)
  return useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: groupsApi.ResolveConflictBody }) => groupsApi.resolveConflict(version, itemId, body),
    onSuccess: invalidate,
  })
}

// Session S4b-fix, Fix 3 — invalidates on confirm:true (a structural change) but a confirm:false
// preview call is read-only and shouldn't bust the cache.
export function useAddAndPlace(version: number) {
  const invalidate = useInvalidateGroups(version)
  return useMutation({
    mutationFn: (body: groupsApi.AddAndPlaceRequest) => groupsApi.addAndPlace(version, body),
    onSuccess: (_data, variables) => {
      if (variables.confirm) invalidate()
    },
  })
}

// Live feedback (2026-08-17) — delete-group, the symmetric counterpart to useAddAndPlace above.
export function useDeleteGroup(version: number) {
  const invalidate = useInvalidateGroups(version)
  return useMutation({
    mutationFn: (body: groupsApi.DeleteGroupRequest) => groupsApi.deleteGroup(version, body),
    onSuccess: (_data, variables) => {
      if (variables.confirm) invalidate()
    },
  })
}
