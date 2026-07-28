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
