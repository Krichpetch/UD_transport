'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as templatesApi from '@/lib/api/templates'

const TEMPLATES_KEY = ['admin', 'templates'] as const
const templateKey = (id: string) => [...TEMPLATES_KEY, id] as const
const reviewQueueKey = (filter: { mode?: string; variantKey?: string }) => [...TEMPLATES_KEY, 'review-queue', filter] as const

export function useTemplateList() {
  return useQuery({ queryKey: TEMPLATES_KEY, queryFn: templatesApi.listTemplates })
}

export function useTemplateDetail(id: string | null) {
  return useQuery({
    queryKey: id ? templateKey(id) : [...TEMPLATES_KEY, 'none'],
    queryFn: () => templatesApi.getTemplate(id!),
    enabled: !!id,
  })
}

export function useReviewQueue(filter: { mode?: string; variantKey?: string }) {
  return useQuery({ queryKey: reviewQueueKey(filter), queryFn: () => templatesApi.getReviewQueue(filter) })
}

// Every mutation below invalidates both this template's detail (definition changed) and the
// list (summary counts changed) and the review queue (confirmed counts changed) — cheap given
// only 13 templates exist, and correctness here matters more than shaving a refetch.
function useInvalidateAfterEdit(templateId: string) {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: templateKey(templateId) })
    void qc.invalidateQueries({ queryKey: TEMPLATES_KEY, exact: true })
    void qc.invalidateQueries({ queryKey: [...TEMPLATES_KEY, 'review-queue'] })
  }
}

export function useEditMeasurement(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, measurementKey, body }: { nodeCode: string; measurementKey: string; body: templatesApi.EditMeasurementBody }) =>
      templatesApi.editMeasurement(templateId, nodeCode, measurementKey, body),
    onSuccess: invalidate,
  })
}

export function useConfirmMeasurement(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, measurementKey }: { nodeCode: string; measurementKey: string }) =>
      templatesApi.confirmMeasurement(templateId, nodeCode, measurementKey),
    onSuccess: invalidate,
  })
}

export function useEditEra(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, measurementKey, body }: { nodeCode: string; measurementKey: string; body: templatesApi.EditEraBody }) =>
      templatesApi.editEra(templateId, nodeCode, measurementKey, body),
    onSuccess: invalidate,
  })
}

// ---- Era-editor safety session, Part C — container-only labelByLaw editing (any status) ----

export function useEditLabelByLaw(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, body }: { nodeCode: string; body: templatesApi.EditLabelByLawBody }) =>
      templatesApi.editLabelByLaw(templateId, nodeCode, body),
    onSuccess: invalidate,
  })
}

export function useEditGuidance(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, body }: { nodeCode: string; body: templatesApi.EditGuidanceBody }) =>
      templatesApi.editGuidance(templateId, nodeCode, body),
    onSuccess: invalidate,
  })
}

export function useAddTemplateImage(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, file }: { nodeCode: string; file: File }) =>
      templatesApi.uploadTemplateImage(templateId, nodeCode, file),
    onSuccess: invalidate,
  })
}

export function useRemoveTemplateImage(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, key }: { nodeCode: string; key: string }) =>
      templatesApi.removeTemplateImage(templateId, nodeCode, key),
    onSuccess: invalidate,
  })
}

// ---- Session S3b, Part C — structural editing (DRAFT-only) ----

// Cloning creates a NEW template row — invalidates the list (and its own future detail query,
// once the caller navigates to it) rather than this template's own detail.
export function useCloneToDraft() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (templateId: string) => templatesApi.cloneToDraft(templateId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: TEMPLATES_KEY, exact: true })
    },
  })
}

// 2026-08-05 — DRAFT -> ACTIVE. Invalidates the list too since another row (the one being
// superseded) may flip to RETIRED server-side as part of the same call.
export function useActivateTemplate(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: (force: boolean) => templatesApi.activateTemplate(templateId, force),
    onSuccess: invalidate,
  })
}

export function useEditLabel(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, labelTh, num }: { nodeCode: string; labelTh: string; num?: string }) =>
      templatesApi.editLabel(templateId, nodeCode, { labelTh, num }),
    onSuccess: invalidate,
  })
}

export function useReorderMeasurement(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, measurementKey, direction }: { nodeCode: string; measurementKey: string; direction: 'up' | 'down' }) =>
      templatesApi.reorderMeasurement(templateId, nodeCode, measurementKey, direction),
    onSuccess: invalidate,
  })
}

export function useSetQuestionType(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, type, confirmDowngrade }: { nodeCode: string; type: templatesApi.QuestionTypeSelector; confirmDowngrade?: boolean }) =>
      templatesApi.setQuestionType(templateId, nodeCode, { type, confirmDowngrade }),
    onSuccess: invalidate,
  })
}

export function useAddMeasurement(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, body }: { nodeCode: string; body: templatesApi.EditMeasurementBody }) =>
      templatesApi.addMeasurement(templateId, nodeCode, body),
    onSuccess: invalidate,
  })
}

export function useAddChildNode(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ parentCode, body }: { parentCode: string; body: templatesApi.AddChildBody }) =>
      templatesApi.addChildNode(templateId, parentCode, body),
    onSuccess: invalidate,
  })
}

export function useReorderNode(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, direction }: { nodeCode: string; direction: 'up' | 'down' }) =>
      templatesApi.reorderNode(templateId, nodeCode, direction),
    onSuccess: invalidate,
  })
}

export function useDeleteNode(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode }: { nodeCode: string }) => templatesApi.deleteNode(templateId, nodeCode),
    onSuccess: invalidate,
  })
}

// ---- Session S3b, Part D — lawRefs editing (DRAFT AND ACTIVE) ----

export function useEditLawRefs(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, lawRefs, beyondLaw }: { nodeCode: string; lawRefs: string[]; beyondLaw: boolean }) =>
      templatesApi.editLawRefs(templateId, nodeCode, { lawRefs, beyondLaw }),
    onSuccess: invalidate,
  })
}

// ---- Session S4a, Part C — hide/unhide a node (any status) ----

export function useEditHidden(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  return useMutation({
    mutationFn: ({ nodeCode, hidden }: { nodeCode: string; hidden: boolean }) =>
      templatesApi.editHidden(templateId, nodeCode, hidden),
    onSuccess: invalidate,
  })
}

// ---- Session S4b-fix, Fix 4 — detach/re-attach a leaf from the grouped editor's pooling ----

export function useEditStandalone(templateId: string) {
  const invalidate = useInvalidateAfterEdit(templateId)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ nodeCode, standalone }: { nodeCode: string; standalone: boolean }) =>
      templatesApi.editStandalone(templateId, nodeCode, standalone),
    onSuccess: () => {
      invalidate()
      // Standalone status changes what the grouped editor's canonical pooling looks like —
      // invalidate its cache too, not just this template's own detail/list.
      void qc.invalidateQueries({ queryKey: ['admin', 'template-groups'] })
    },
  })
}
