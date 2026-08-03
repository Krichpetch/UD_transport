import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import type { ChecklistTemplateDefinition, TemplateTier, ThresholdOperator } from '@repo/types'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export interface TemplateSummary {
  itemCount: number
  leafCount: number
  measurementCount: number
  confirmedCount: number
  unconfirmedCount: number
  // Session S3b, Part D.3 — coverage indicator.
  lawRefsTaggedCount: number
  lawRefsUntaggedCount: number
}

export interface TemplateListRow {
  id: string
  mode: string
  variantKey: string
  version: number
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED'
  notes: string | null
  createdAt: string
  summary: TemplateSummary
}

export interface TemplateDetail extends TemplateListRow {
  definition: ChecklistTemplateDefinition
  stampedChecklistCount: number
}

export interface ReviewQueueRow {
  templateId: string
  mode: string
  variantKey: string
  version: number
  status: string
  nodeCode: string
  labelTh: string
  measurementKey: string
  operator: ThresholdOperator
  unit: string
  value: number | null
  sourceText?: string
}

export interface ReviewQueueResponse {
  overall: { confirmed: number; total: number }
  perTemplate: { templateId: string; mode: string; variantKey: string; version: number; status: string; confirmed: number; total: number }[]
  rows: ReviewQueueRow[]
}

export interface EditMeasurementBody {
  operator: ThresholdOperator
  value?: number | null
  value2?: number | null
  tiers?: TemplateTier[]
  // Session S3b, Part C.3 — only meaningful when creating a brand-new tiered measurement.
  inputs?: { key: string; labelTh: string }[]
  unit: string
  autoGrade: boolean
  sourceText?: string
  note?: string
}

export interface EditEraBody {
  lawCode: string
  entry?: { value?: number | null; value2?: number | null; tiers?: TemplateTier[] } | null
}

export interface EditGuidanceBody {
  text: string
  reference?: string
}

export interface TemplateExport {
  id: string
  mode: string
  variantKey: string
  version: number
  definition: ChecklistTemplateDefinition
  eraOverridesExtract: { overrides: Record<string, { measurements: unknown[] }> }
}

export function listTemplates() {
  return api.get<TemplateListRow[]>('/admin/templates')
}

export function getTemplate(id: string) {
  return api.get<TemplateDetail>(`/admin/templates/${id}`)
}

export function getReviewQueue(filter: { mode?: string; variantKey?: string }) {
  const params = new URLSearchParams()
  if (filter.mode) params.set('mode', filter.mode)
  if (filter.variantKey) params.set('variantKey', filter.variantKey)
  const qs = params.toString()
  return api.get<ReviewQueueResponse>(`/admin/templates/review-queue${qs ? `?${qs}` : ''}`)
}

export function editMeasurement(templateId: string, nodeCode: string, measurementKey: string, body: EditMeasurementBody) {
  return api.patch<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/measurements/${encodeURIComponent(nodeCode)}/${encodeURIComponent(measurementKey)}`,
    body,
  )
}

export function confirmMeasurement(templateId: string, nodeCode: string, measurementKey: string) {
  return api.post<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/measurements/${encodeURIComponent(nodeCode)}/${encodeURIComponent(measurementKey)}/confirm`,
    {},
  )
}

export function editEra(templateId: string, nodeCode: string, measurementKey: string, body: EditEraBody) {
  return api.patch<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/era/${encodeURIComponent(nodeCode)}/${encodeURIComponent(measurementKey)}`,
    body,
  )
}

export function editGuidance(templateId: string, nodeCode: string, body: EditGuidanceBody) {
  return api.patch<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/guidance/${encodeURIComponent(nodeCode)}`,
    body,
  )
}

export function exportTemplate(id: string) {
  return api.get<TemplateExport>(`/admin/templates/${id}/export`)
}

// Multipart upload — same pattern as lib/api/uploads.ts#uploadPhoto, admin-only endpoint.
export async function uploadTemplateImage(templateId: string, nodeCode: string, file: File) {
  const token = useAuthStore.getState().token
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE_URL}/admin/templates/${templateId}/images/${encodeURIComponent(nodeCode)}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(body.message ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<{ id: string; definition: ChecklistTemplateDefinition; key: string }>
}

export function removeTemplateImage(templateId: string, nodeCode: string, key: string) {
  return api.delete<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/images/${encodeURIComponent(nodeCode)}?key=${encodeURIComponent(key)}`,
  )
}

// Presigned read for a template-images/ key — reuses the same widened /uploads/presign endpoint
// evidence photos already go through (uploads.controller.ts's PRESIGN_KEY_PREFIXES).
export function presignTemplateImage(key: string) {
  return api.get<{ url: string }>(`/uploads/presign?key=${encodeURIComponent(key)}`)
}

// ---- Session S3b, Part C — structural editing (DRAFT-only, enforced server-side). ----

export type QuestionTypeSelector = 'presence' | 'presence_standard' | 'measured'

export function cloneToDraft(templateId: string) {
  return api.post<TemplateDetail>(`/admin/templates/${templateId}/clone-to-draft`, {})
}

export function editLabel(templateId: string, nodeCode: string, body: { labelTh: string; num?: string }) {
  return api.patch<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/nodes/${encodeURIComponent(nodeCode)}/label`,
    body,
  )
}

export function reorderMeasurement(templateId: string, nodeCode: string, measurementKey: string, direction: 'up' | 'down') {
  return api.patch<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/measurements/${encodeURIComponent(nodeCode)}/${encodeURIComponent(measurementKey)}/reorder`,
    { direction },
  )
}

export function setQuestionType(
  templateId: string,
  nodeCode: string,
  body: { type: QuestionTypeSelector; confirmDowngrade?: boolean },
) {
  return api.patch<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/nodes/${encodeURIComponent(nodeCode)}/type`,
    body,
  )
}

// A NEW measurement (distinct from editMeasurement above, which edits one that already exists).
export function addMeasurement(templateId: string, nodeCode: string, body: EditMeasurementBody) {
  return api.post<{ id: string; definition: ChecklistTemplateDefinition; key: string }>(
    `/admin/templates/${templateId}/measurements/${encodeURIComponent(nodeCode)}`,
    body,
  )
}

export interface AddChildBody {
  labelTh: string
  type: QuestionTypeSelector
  threshold?: EditMeasurementBody
  lawRefs?: string[]
}

export function addChildNode(templateId: string, parentCode: string, body: AddChildBody) {
  return api.post<{ id: string; definition: ChecklistTemplateDefinition; code: string }>(
    `/admin/templates/${templateId}/nodes/${encodeURIComponent(parentCode)}/children`,
    body,
  )
}

export function reorderNode(templateId: string, nodeCode: string, direction: 'up' | 'down') {
  return api.patch<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/nodes/${encodeURIComponent(nodeCode)}/reorder`,
    { direction },
  )
}

export function deleteNode(templateId: string, nodeCode: string) {
  return api.delete<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/nodes/${encodeURIComponent(nodeCode)}`,
  )
}

// ---- Session S3b, Part D — lawRefs editing (DRAFT AND ACTIVE). ----

export function editLawRefs(templateId: string, nodeCode: string, body: { lawRefs: string[]; beyondLaw: boolean }) {
  return api.patch<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/nodes/${encodeURIComponent(nodeCode)}/law-refs`,
    body,
  )
}
