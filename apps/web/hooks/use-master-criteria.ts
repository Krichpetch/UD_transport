'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as mastersApi from '@/lib/api/master-criteria'

// Session S5-fix, Part A — the standalone browse/edit page (and its list/detail/create/update
// hooks) is gone; masters are now created and edited transparently from the facility-grouped
// editor (facility-groups.service.ts#propagateItemEdit), never through these hooks. What remains
// is the individual per-node editor's detach/(re)attach affordance (MasterAttachedBanner.tsx),
// which Part A explicitly keeps.

// A master edit changes: the master's own attached/detached instances, AND every attached
// template's own detail/list (its definition just changed via the auto-push) — invalidate the
// whole admin/templates cache too rather than trying to name each affected templateId, same
// "cheap given how few rows exist, correctness first" reasoning use-templates-admin.ts already
// documents for its own invalidation.
function useInvalidateAfterMasterEdit() {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'templates'] })
    void qc.invalidateQueries({ queryKey: ['admin', 'template-groups'] })
  }
}

export function useDetachMasterNode() {
  const invalidate = useInvalidateAfterMasterEdit()
  return useMutation({
    mutationFn: ({ templateId, nodeCode }: { templateId: string; nodeCode: string }) => mastersApi.detachMasterNode(templateId, nodeCode),
    onSuccess: invalidate,
  })
}

export function useAttachMasterNode() {
  const invalidate = useInvalidateAfterMasterEdit()
  return useMutation({
    mutationFn: ({ templateId, nodeCode, masterId }: { templateId: string; nodeCode: string; masterId: string }) =>
      mastersApi.attachMasterNode(templateId, nodeCode, masterId),
    onSuccess: invalidate,
  })
}
