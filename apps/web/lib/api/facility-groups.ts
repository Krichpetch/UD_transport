// Session S4b — the facility-grouped editor's API client. Mirrors lib/api/templates.ts's
// conventions, against the separate admin/template-groups base path (see
// facility-groups.controller.ts's doc for why it's not nested under admin/templates/:id).
//
// Part 5 — the backend also accepts ?scope=active|all (VersionScope) instead of ?version=N, for
// the retirement-planning comparison views; this client only exposes the exact-version form
// (`version: number`) since the grouped EDITOR itself always targets one version at a time (see
// facility-groups.service.ts's VersionScope doc for why 'active'/'all' are analysis-only, not
// alternate defaults for editing).
//
// Session S5-fix (round 2) — the response is now a RECURSIVE TREE (`GroupNodeRow`, any depth),
// not a flat container-list + flat leaf-list. A leaf and a container are the same row shape —
// `isLeaf` discriminates — matching the individual per-node editor's own "every node is
// selectable" tree (TemplateTree.tsx). flattenGroupNodes/flattenLeafNodes below replace what used
// to be the separate top-level `canonicalItems` array.
import { api } from '@/lib/api'
import type { TemplateTier, ThresholdOperator } from '@repo/types'

export type TemplateRowStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED'

// The grouped editor is pinned to v3 (see facility-groups.service.ts's VersionScope doc) — one
// shared constant so every caller (the groups pages, and Fix 4's individual-editor provenance
// lookup) agrees on it rather than each hardcoding `3`.
export const GROUPED_EDITOR_VERSION = 3

// ---- Part 1 addition — impact counts (mode -> variant -> version breakdown) ------------------

export interface VersionCount {
  version: number
  status: TemplateRowStatus
  count: number
}
export interface VariantCount {
  variantKey: string
  total: number
  byVersion: VersionCount[]
}
export interface ModeCount {
  mode: string
  total: number
  byVariant: VariantCount[]
}
export interface InstanceBreakdown {
  total: number
  byMode: ModeCount[]
}

export interface InstanceMeasurement {
  key: string
  operator: ThresholdOperator
  value: number | null
  value2: number | null
  unit: string
  tiers: TemplateTier[] | null
  byLaw: Record<string, { value?: number | null; value2?: number | null; tiers?: TemplateTier[] }> | null
  autoGrade: boolean
  sourceText: string | null
  confirmed: boolean
}

export interface ItemInstanceRow {
  templateId: string
  mode: string
  variantKey: string
  version: number
  status: TemplateRowStatus
  // Code of this instance's immediate parent — the enclosing GROUP's code at depth 0 (e.g. 'A1'),
  // or the immediate parent NODE's own code at any deeper level.
  parentCode: string
  nodeCode: string
  labelTh: string
  // Prefill data (Session S4b follow-up) — this instance's OWN current value for every field the
  // grouped editor can propagate. Used to seed the edit dialog's form (from instances[0] by
  // convention) and to detect a since-fetch divergence before writing. Meaningful for a container
  // instance too (round 2) — answerType/measurements just come back empty, reflecting that this
  // node has nothing of its own to answer.
  answerType?: string
  facilityCode?: number
  lawRefs: string[]
  beyondLaw: boolean
  hidden: boolean
  imageKeys: string[]
  measurements: InstanceMeasurement[]
}

export type GroupNodeClassification = 'SHARED' | 'MODE_SPECIFIC'

// The one recursive row type — a depth-0 container ("ทางลาดสำหรับคนพิการ"), an intermediate
// hierarchy level (a length-tier sub-container), and a leaf measurement item are all the SAME
// shape; `isLeaf`/`children.length` discriminate what's actually editable/nested.
export interface GroupNodeRow {
  id: string
  parentId: string | null
  depth: number
  labelTh: string
  isLeaf: boolean
  classification: GroupNodeClassification
  instanceCount: number
  breakdown: InstanceBreakdown
  facilityTagged: boolean
  // Session S5-fix (round 3) — this node's own FACILITY_CATALOG code (@repo/types, 1-33),
  // undefined if untagged — the sort key groups/page.tsx uses for depth-0 ordering (catalog order,
  // not document order); untagged groups sort to the bottom.
  facilityCode?: number
  masterId?: string
  sortKey: number
  instances: ItemInstanceRow[]
  hasConflict: boolean
  conflictAcknowledged: boolean
  propagatable: boolean
  children: GroupNodeRow[]
}

export interface FacilityGroupsResponse {
  stats: {
    totalContainerInstances: number
    totalLeaves: number
    distinctContainerGroups: number
    editUnits: number
  }
  containerGroups: GroupNodeRow[]
}

// Every node, any depth, in the given subtree(s) — no particular guaranteed order (sort by
// sortKey for "reads in checklist order" display, same field the backend already sorted roots by).
export function flattenGroupNodes(nodes: GroupNodeRow[]): GroupNodeRow[] {
  const out: GroupNodeRow[] = []
  const walk = (ns: GroupNodeRow[]) => {
    for (const n of ns) {
      out.push(n)
      walk(n.children)
    }
  }
  walk(nodes)
  return out
}

// Every LEAF node (isLeaf === true), any depth — replaces the old top-level `canonicalItems` list.
export function flattenLeafNodes(nodes: GroupNodeRow[]): GroupNodeRow[] {
  return flattenGroupNodes(nodes).filter((n) => n.isLeaf)
}

export interface ConflictVariantRow {
  signature: string
  instances: ItemInstanceRow[]
}

export interface ItemConflictRow {
  canonicalItemId: string
  containerGroupId: string | null
  labelTh: string
  acknowledged: boolean
  variants: ConflictVariantRow[]
}

export interface GroupedReviewQueueRow {
  canonicalItemId: string
  containerGroupId: string | null
  labelTh: string
  sampleNodeCode: string
  measurementKey: string
  operator: ThresholdOperator
  unit: string
  value: number | null
  instanceCount: number
  unconfirmedCount: number
}

export interface GroupedReviewQueueResponse {
  rows: GroupedReviewQueueRow[]
  totalUnconfirmedRows: number
  distinctRows: number
}

export interface GroupedEditBody {
  field: 'measurement' | 'guidance' | 'lawRefs' | 'hidden' | 'label' | 'era' | 'image'
  measurementKey?: string
  measurement?: {
    operator: ThresholdOperator
    value?: number | null
    value2?: number | null
    tiers?: TemplateTier[]
    unit: string
    autoGrade: boolean
    sourceText?: string
    note?: string
  }
  guidance?: { text: string; reference?: string }
  lawRefs?: { lawRefs: string[]; beyondLaw: boolean }
  hidden?: { hidden: boolean }
  label?: { labelTh: string; num?: string }
  era?: { lawCode: string; entry?: { value?: number | null; value2?: number | null; tiers?: TemplateTier[] } | null }
  imageKey?: string
  imageOp?: 'add' | 'remove'
}

export interface PropagateResult {
  correlationId: string
  field: string
  // Session S5-fix, Part B — set once this edit ran through the master (every field except
  // 'hidden'); `promoted: true` means this specific call is the one that just created the master.
  masterId?: string
  promoted: boolean
  wroteCount: number
  targets: ItemInstanceRow[]
}

export interface ResolveConflictBody {
  resolution: 'winner' | 'split'
  winnerSignature?: string
  notes?: string
}

export interface ResolveConflictResult {
  correlationId: string
  resolution: 'winner' | 'split'
  wroteCount: number
}

export function getFacilityGroups(version: number) {
  return api.get<FacilityGroupsResponse>(`/admin/template-groups?version=${version}`)
}

export function getGroupConflicts(version: number) {
  return api.get<ItemConflictRow[]>(`/admin/template-groups/conflicts?version=${version}`)
}

export function getGroupedReviewQueue(version: number) {
  return api.get<GroupedReviewQueueResponse>(`/admin/template-groups/review-queue?version=${version}`)
}

export function propagateItemEdit(version: number, itemId: string, body: GroupedEditBody) {
  return api.post<PropagateResult>(`/admin/template-groups/items/${encodeURIComponent(itemId)}/propagate?version=${version}`, body)
}

export function confirmGroupedMeasurement(version: number, itemId: string, measurementKey: string) {
  return api.post<{ correlationId: string; wroteCount: number }>(
    `/admin/template-groups/items/${encodeURIComponent(itemId)}/measurements/${encodeURIComponent(measurementKey)}/confirm?version=${version}`,
    {},
  )
}

export function resolveConflict(version: number, itemId: string, body: ResolveConflictBody) {
  return api.post<ResolveConflictResult>(`/admin/template-groups/items/${encodeURIComponent(itemId)}/resolve-conflict?version=${version}`, body)
}

// Image upload for the grouped editor's image field: uploads the file ONCE against a single
// representative instance (reuses the existing per-item upload endpoint), returning the MinIO
// key the caller then propagates via propagateItemEdit({ field: 'image', imageKey, imageOp: 'add' }).
export { uploadGroupedImage, presignTemplateImage, MAX_TEMPLATE_IMAGES_PER_NODE } from './templates'

// ---- Session S4b-fix, Fix 3 — add-and-place ---------------------------------------------------

export interface AddAndPlaceContent {
  labelTh: string
  type: 'presence' | 'presence_standard' | 'measured'
  threshold?: {
    operator: ThresholdOperator
    value?: number | null
    value2?: number | null
    tiers?: TemplateTier[]
    inputs?: { key: string; labelTh: string }[]
    unit: string
    autoGrade: boolean
    sourceText?: string
  }
  lawRefs?: string[]
  facilityCode?: number
}

export interface AddAndPlaceRequest {
  // Session S5-fix (round 2) — a single id into the unified recursive tree (any depth — a leaf and
  // a container are the same node type now, so "insert before/after this node" resolves the same
  // regardless of whether the anchor is a top-level item like TTRS or a deeply-nested leaf).
  anchorNodeId: string
  side: 'before' | 'after'
  targetTemplateIds: string[]
  content: AddAndPlaceContent
  confirm: boolean
}

export interface AddAndPlaceResolved {
  templateId: string
  mode: string
  variantKey: string
  containerCode: string
  anchorCode: string
  code?: string
}

export interface AddAndPlaceSkipped {
  templateId: string
  mode: string | null
  variantKey: string | null
  reason: string
}

export interface AddAndPlaceResponse {
  correlationId: string | null
  wroteCount: number
  resolved: AddAndPlaceResolved[]
  skipped: AddAndPlaceSkipped[]
}

export function addAndPlace(version: number, body: AddAndPlaceRequest) {
  return api.post<AddAndPlaceResponse>(`/admin/template-groups/add-and-place?version=${version}`, body)
}
