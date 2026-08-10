'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as groupsApi from '@/lib/api/facility-groups'

const GROUPS_KEY = ['admin', 'template-groups'] as const
const groupsKey = (version: number) => [...GROUPS_KEY, version] as const
const conflictsKey = (version: number) => [...GROUPS_KEY, 'conflicts', version] as const
const reviewQueueKey = (version: number) => [...GROUPS_KEY, 'review-queue', version] as const

export function useFacilityGroups(version: number) {
  return useQuery({ queryKey: groupsKey(version), queryFn: () => groupsApi.getFacilityGroups(version) })
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
