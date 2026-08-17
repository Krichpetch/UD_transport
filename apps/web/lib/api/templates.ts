import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth.store'
import type { ChecklistTemplateDefinition, MasterCriterionExport, TemplateTier, ThresholdOperator } from '@repo/types'

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

// Mirrors MAX_IMAGES_PER_NODE in apps/api/src/admin/templates/templates.core.ts — the server is
// the real enforcement point (this only drives the picker UI / early client-side stop).
export const MAX_TEMPLATE_IMAGES_PER_NODE = 8

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
  entry?: { value?: number | null; value2?: number | null; tiers?: TemplateTier[]; sourceText?: string | null; labelTh?: string | null } | null
}

// ---- Shared patch builders (era + flat measurement) --------------------------------------------
//
// The one place that turns a per-law/per-measurement DRAFT into the wire shape the backend
// expects — both the individual editor (MeasurementEditor.tsx) and the grouped editor
// (GroupedItemEditDialog.tsx) build their request bodies through these, so the two can't
// independently re-diverge on "which fields does this operator actually carry" again (that
// divergence — the grouped editor hardcoding {value, value2} and dropping tiers/sourceText — is
// exactly the bug this session fixes). Operator-gated: a tiered draft sends ONLY tiers (+
// sourceText); a gte/lte/range draft sends ONLY value/value2 (+ sourceText) — never both, since
// parseByLawEntry/parseMeasurement reject a byLaw/measurement entry that mixes shapes.

export interface EraEntryDraft {
  value?: number | null
  value2?: number | null
  tiers?: TemplateTier[]
  sourceText?: string | null
  // The LEAF's own question text for this law era (TemplateMeasurementByLawEntry.labelTh) — a
  // sibling of sourceText, resolved onto the containing node's labelTh by
  // era-resolution.ts#resolveMeasurement when set. Distinct from the CONTAINER-only
  // TemplateNode.labelByLaw mechanism (LabelByLawEditor.tsx) — this is the leaf/measurement
  // version, for a node that DOES carry the graded measurement itself.
  labelTh?: string | null
}

export function buildEraEntryPatch(operator: ThresholdOperator, draft: EraEntryDraft): NonNullable<EditEraBody['entry']> {
  return {
    ...(operator === 'tiered'
      ? { tiers: draft.tiers ?? [] }
      : { value: draft.value ?? null, value2: operator === 'range' ? (draft.value2 ?? null) : null }),
    sourceText: draft.sourceText || undefined,
    labelTh: draft.labelTh || undefined,
  }
}

export interface MeasurementDraft {
  value?: number | ''
  value2?: number | ''
  tiers?: TemplateTier[]
  unit: string
  sourceText?: string
}

export function buildMeasurementPatch(
  operator: ThresholdOperator,
  draft: MeasurementDraft,
): NonNullable<import('./facility-groups').GroupedEditBody['measurement']> {
  return {
    operator,
    ...(operator === 'tiered'
      ? { tiers: draft.tiers ?? [] }
      : { value: draft.value === '' ? null : (draft.value ?? null), value2: operator === 'range' ? (draft.value2 === '' ? null : (draft.value2 ?? null)) : undefined }),
    unit: draft.unit,
    autoGrade: true,
    sourceText: draft.sourceText || undefined,
  }
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
  // Session S5, Part 1 — every MasterCriterion this definition's nodes reference (via masterId/
  // detachedFromMasterId), so the downloaded file is self-contained and round-trips master state.
  masterCriteria: MasterCriterionExport[]
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

// ---- Era-editor safety session, Part C — container-only labelByLaw editing (any status). ----

export interface EditLabelByLawBody {
  lawCode: string
  entry?: { labelTh: string; sourceText?: string | null } | null
}

export function editLabelByLaw(templateId: string, nodeCode: string, body: EditLabelByLawBody) {
  return api.patch<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/nodes/${encodeURIComponent(nodeCode)}/label-by-law`,
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

// Upload-only, no nodeCode — used by the grouped/master editor (GroupedImageEditor), NOT the
// individual editor above. uploadTemplateImage's endpoint commits the key onto one node through a
// guard that rejects nodes already attached to a master; the grouped editor's representative
// instance is very often already attached, so it uploads bytes here and lets propagateItemEdit's
// 'image' field (master-aware, no attach guard) write the key to every instance instead.
export async function uploadGroupedImage(file: File) {
  const token = useAuthStore.getState().token
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${BASE_URL}/admin/template-groups/images`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: form,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { message?: string }
    throw new Error(body.message ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<{ key: string }>
}

// ---- Session S3b, Part C — structural editing (DRAFT-only, enforced server-side). ----

export type QuestionTypeSelector = 'presence' | 'presence_standard' | 'measured'

export function cloneToDraft(templateId: string) {
  return api.post<TemplateDetail>(`/admin/templates/${templateId}/clone-to-draft`, {})
}

// 2026-08-05 — DRAFT -> ACTIVE. On a 409, the ApiError's `.data` carries
// { code: 'DRAFTS_AT_RISK', stations: string[], count: number } — the caller re-submits with
// force=true to proceed anyway (see [id]/page.tsx's activation dialog).
export function activateTemplate(templateId: string, force = false) {
  return api.post<TemplateDetail>(`/admin/templates/${templateId}/activate`, { force })
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

// ---- Session S4a, Part C — hide/unhide a node (any status). ----

export function editHidden(templateId: string, nodeCode: string, hidden: boolean) {
  return api.patch<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/nodes/${encodeURIComponent(nodeCode)}/hidden`,
    { hidden },
  )
}

// ---- Session S4b-fix, Fix 4 — detach/re-attach a leaf from the grouped editor's pooling. ----

export function editStandalone(templateId: string, nodeCode: string, standalone: boolean) {
  return api.patch<{ id: string; definition: ChecklistTemplateDefinition }>(
    `/admin/templates/${templateId}/nodes/${encodeURIComponent(nodeCode)}/standalone`,
    { standalone },
  )
}
