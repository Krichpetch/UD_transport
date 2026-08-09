// W2-S3a — admin template data editor. Pure tree-editing functions over a
// ChecklistTemplateDefinition: no Prisma, no MinIO, no Nest DI (same "plain function, not
// DI-bound" convention as reimport.core.ts, so these are directly unit-testable). The Nest
// wrapper (templates.service.ts) handles the DB read/write, LawReference lookups, and audit
// logging around these.
//
// Every mutating function clones the input definition (never mutates the caller's object),
// applies the edit, then re-validates the WHOLE definition via parseTemplateDefinition before
// returning — matching era-overrides.ts's "re-validate the merged tree" discipline. A
// structurally-invalid edit throws ChecklistTemplateValidationError (from @repo/types) rather
// than silently producing a bad definition.
import type { ChecklistTemplateDefinition, TemplateAnswerType, TemplateMeasurement, TemplateNode, TemplateTier } from '@repo/types'
import { indexTemplateNodesByCode, parseTemplateDefinition, walkTemplateLeaves } from '@repo/types'

export class TemplateEditError extends Error {}

export const MAX_IMAGES_PER_NODE = 3

function cloneDefinition(def: ChecklistTemplateDefinition): ChecklistTemplateDefinition {
  return JSON.parse(JSON.stringify(def)) as ChecklistTemplateDefinition
}

function findNode(def: ChecklistTemplateDefinition, nodeCode: string): TemplateNode {
  const node = indexTemplateNodesByCode(def).get(nodeCode)
  if (!node) throw new TemplateEditError(`unknown node code "${nodeCode}"`)
  return node
}

function findMeasurement(node: TemplateNode, measurementKey: string): TemplateMeasurement {
  const m = node.measurements?.find((mm) => mm.key === measurementKey)
  if (!m) throw new TemplateEditError(`unknown measurement key "${measurementKey}" on node "${node.code}"`)
  return m
}

export interface MeasurementValuePatch {
  operator: TemplateMeasurement['operator']
  value?: number | null
  value2?: number | null
  tiers?: TemplateTier[]
  unit: string
  autoGrade: boolean
  sourceText?: string
  note?: string
}

export interface EditMeasurementResult {
  definition: ChecklistTemplateDefinition
  before: Partial<TemplateMeasurement>
  after: Partial<TemplateMeasurement>
}

// Value-only patch — never touches `key` (the edit target's own identity) or `byLaw` (edited
// exclusively through editEraOverride, so a threshold edit can never accidentally clobber era
// data). Editing always sets confirmed:true (Part B.3: "editing... sets confirmed:true").
export function editMeasurementValue(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  measurementKey: string,
  patch: MeasurementValuePatch,
): EditMeasurementResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const measurement = findMeasurement(node, measurementKey)
  const before = { ...measurement }

  measurement.operator = patch.operator
  measurement.unit = patch.unit
  measurement.autoGrade = patch.autoGrade
  measurement.sourceText = patch.sourceText
  measurement.note = patch.note
  measurement.confirmed = true

  if (patch.operator === 'tiered') {
    measurement.tiers = patch.tiers
    measurement.value = undefined
    measurement.value2 = undefined
  } else {
    measurement.value = patch.value ?? null
    measurement.value2 = patch.operator === 'range' ? (patch.value2 ?? null) : null
    measurement.tiers = undefined
  }

  const validated = parseTemplateDefinition(clone)
  const after = { ...findMeasurement(findNode(validated, nodeCode), measurementKey) }

  return { definition: validated, before, after }
}

// Explicit "confirm without changing the value" action (Part B.3's review-queue confirm button).
export function confirmMeasurement(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  measurementKey: string,
): EditMeasurementResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const measurement = findMeasurement(node, measurementKey)
  const before = { confirmed: measurement.confirmed ?? false }
  measurement.confirmed = true
  const validated = parseTemplateDefinition(clone)
  return { definition: validated, before, after: { confirmed: true } }
}

export interface EraEntryPatch {
  value?: number | null
  value2?: number | null
  tiers?: TemplateTier[]
}

export interface EditEraResult {
  definition: ChecklistTemplateDefinition
  before: EraEntryPatch | null
  after: EraEntryPatch | null
}

// entry === null removes that law's override slice entirely (Part C.1: "removing it entirely
// are both allowed"). lawCode's validity against real LawReference rows is the caller's job
// (templates.service.ts has Prisma access; this function only enforces shape via revalidation).
export function editEraOverride(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  measurementKey: string,
  lawCode: string,
  entry: EraEntryPatch | null,
): EditEraResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const measurement = findMeasurement(node, measurementKey)
  const before = measurement.byLaw?.[lawCode] ?? null

  if (entry === null) {
    if (measurement.byLaw) {
      const { [lawCode]: _removed, ...rest } = measurement.byLaw
      measurement.byLaw = Object.keys(rest).length > 0 ? rest : undefined
    }
  } else {
    measurement.byLaw = { ...(measurement.byLaw ?? {}), [lawCode]: entry }
    // A byLaw entry asserts "this law gives this item a value" — isItemApplicable
    // (era-resolution.ts) redacts the whole item below any law missing from node.lawRefs, so a
    // byLaw code absent from lawRefs is a standing contradiction (2026-08-05, see
    // era-overrides.ts's applyEraOverrides, the same invariant enforced at seed time). Only
    // ADDS here — removing a byLaw entry never strips its lawRef, since the item may still be
    // legitimately gated by that law for reasons independent of this one measurement.
    if (!node.lawRefs?.includes(lawCode)) {
      node.lawRefs = [...(node.lawRefs ?? []), lawCode]
    }
  }
  measurement.confirmed = true

  const validated = parseTemplateDefinition(clone)
  const after = findMeasurement(findNode(validated, nodeCode), measurementKey).byLaw?.[lawCode] ?? null

  return { definition: validated, before, after }
}

export interface EditGuidanceResult {
  definition: ChecklistTemplateDefinition
  before: { text: string; reference?: string } | null
  after: { text: string; reference?: string } | null
}

export function editGuidance(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  text: string,
  reference?: string,
): EditGuidanceResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = node.guidance ?? null
  node.guidance = { text, reference }

  const validated = parseTemplateDefinition(clone)
  const after = findNode(validated, nodeCode).guidance ?? null
  return { definition: validated, before, after }
}

export interface EditImagesResult {
  definition: ChecklistTemplateDefinition
  before: string[]
  after: string[]
}

export function addImageKey(def: ChecklistTemplateDefinition, nodeCode: string, key: string): EditImagesResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = node.imageKeys ? [...node.imageKeys] : []
  if (before.length >= MAX_IMAGES_PER_NODE) {
    throw new TemplateEditError(`node "${nodeCode}" already has the maximum of ${MAX_IMAGES_PER_NODE} images`)
  }
  node.imageKeys = [...before, key]

  const validated = parseTemplateDefinition(clone)
  const after = findNode(validated, nodeCode).imageKeys ?? []
  return { definition: validated, before, after }
}

// Returns the removed key alongside the result so the caller (templates.service.ts) knows
// exactly which MinIO object to delete — never derived by diffing before/after, to avoid any
// ambiguity if the same key somehow appeared twice.
export function removeImageKey(def: ChecklistTemplateDefinition, nodeCode: string, key: string): EditImagesResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = node.imageKeys ? [...node.imageKeys] : []
  if (!before.includes(key)) throw new TemplateEditError(`node "${nodeCode}" does not have image key "${key}"`)
  const remaining = before.filter((k) => k !== key)
  node.imageKeys = remaining.length > 0 ? remaining : undefined

  const validated = parseTemplateDefinition(clone)
  const after = findNode(validated, nodeCode).imageKeys ?? []
  return { definition: validated, before, after }
}

// ---- read-only summary / review-queue helpers (Part A picker, Part B.3 review queue) ----

export interface TemplateSummary {
  itemCount: number
  leafCount: number
  measurementCount: number
  confirmedCount: number
  unconfirmedCount: number
  // Session S3b, Part D.3 — coverage indicator: how many leaves carry a non-empty lawRefs tag
  // vs how many don't, live in the editor (the F1 report number, now computed on demand rather
  // than a one-off script run).
  lawRefsTaggedCount: number
  lawRefsUntaggedCount: number
}

export function summarizeTemplate(def: ChecklistTemplateDefinition): TemplateSummary {
  const leaves = walkTemplateLeaves(def)
  let measurementCount = 0
  let confirmedCount = 0
  let lawRefsTaggedCount = 0
  for (const leaf of leaves) {
    for (const m of leaf.measurements ?? []) {
      measurementCount++
      if (m.confirmed) confirmedCount++
    }
    if (leaf.lawRefs && leaf.lawRefs.length > 0) lawRefsTaggedCount++
  }
  return {
    itemCount: def.groups.reduce((sum, g) => sum + g.items.length, 0),
    leafCount: leaves.length,
    measurementCount,
    confirmedCount,
    unconfirmedCount: measurementCount - confirmedCount,
    lawRefsTaggedCount,
    lawRefsUntaggedCount: leaves.length - lawRefsTaggedCount,
  }
}

export interface ReviewQueueRow {
  nodeCode: string
  labelTh: string
  measurementKey: string
  operator: TemplateMeasurement['operator']
  unit: string
  value: number | null
  sourceText?: string
}

export function unconfirmedMeasurementRows(def: ChecklistTemplateDefinition): ReviewQueueRow[] {
  const rows: ReviewQueueRow[] = []
  for (const leaf of walkTemplateLeaves(def)) {
    for (const m of leaf.measurements ?? []) {
      if (!m.confirmed) {
        rows.push({
          nodeCode: leaf.code,
          labelTh: leaf.labelTh,
          measurementKey: m.key,
          operator: m.operator,
          unit: m.unit,
          value: m.value ?? null,
          sourceText: m.sourceText,
        })
      }
    }
  }
  return rows
}

// ---- Session S3b, Part C — structural editing (DRAFT templates only; the DRAFT-status gate is
// enforced by the caller, templates.service.ts#applyStructuralEdit — these functions themselves
// don't know or care what status the template has, same separation of concerns as the rest of
// this file). ----

export type QuestionTypeSelector = 'presence' | 'presence_standard' | 'measured'

export interface SetQuestionTypeResult {
  definition: ChecklistTemplateDefinition
  before: { answerType?: TemplateAnswerType; measurementCount: number }
  after: { answerType?: TemplateAnswerType; measurementCount: number }
}

// Part C.2 — the 3-way question type selector collapses onto 2 real answerTypes: 'measured' is
// just 'presence_standard' with at least the INTENT to carry measurements (the measurement(s)
// themselves are added separately via addMeasurement below — this only sets/clears answerType and,
// on a genuine downgrade, drops the measurements that no longer make sense under the new type).
export function setNodeQuestionType(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  type: QuestionTypeSelector,
  confirmDowngrade: boolean,
): SetQuestionTypeResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = { answerType: node.answerType, measurementCount: node.measurements?.length ?? 0 }

  const hadMeasurements = (node.measurements?.length ?? 0) > 0
  // Downgrading AWAY from 'measured' (i.e. the target type isn't 'measured') while measurements
  // already exist would silently discard admin-authored threshold data — require an explicit
  // confirm, same pattern as any other destructive structural action this session.
  const droppingMeasurements = hadMeasurements && type !== 'measured'
  if (droppingMeasurements && !confirmDowngrade) {
    throw new TemplateEditError(
      `node "${nodeCode}" has ${node.measurements!.length} measurement(s); switching to "${type}" discards them — pass confirmDowngrade to proceed`,
    )
  }

  if (type === 'presence') {
    node.answerType = 'presence'
    node.choices = undefined
    node.threshold = undefined
    node.measurements = undefined
  } else {
    node.answerType = 'presence_standard'
    if (droppingMeasurements) node.measurements = undefined
  }

  const validated = parseTemplateDefinition(clone)
  const after = findNode(validated, nodeCode)
  return {
    definition: validated,
    before,
    after: { answerType: after.answerType, measurementCount: after.measurements?.length ?? 0 },
  }
}

export interface NewMeasurementPatch {
  operator: TemplateMeasurement['operator']
  value?: number | null
  value2?: number | null
  tiers?: TemplateTier[]
  inputs?: TemplateMeasurement['inputs']
  unit: string
  autoGrade: boolean
  sourceText?: string
  note?: string
}

export interface AddMeasurementResult {
  definition: ChecklistTemplateDefinition
  key: string
  after: TemplateMeasurement
}

// Local-to-the-leaf key, not a globally append-only identifier like node codes below — a
// measurement has no cross-version crosswalk meaning of its own (it's scoped to its leaf), so
// simple "first unused mN" is enough; there's no delete-then-reuse hazard to guard against here.
function nextMeasurementKey(existing: TemplateMeasurement[]): string {
  const used = new Set(existing.map((m) => m.key))
  let n = existing.length + 1
  while (used.has(`m${n}`)) n++
  return `m${n}`
}

function buildMeasurement(key: string, patch: NewMeasurementPatch): TemplateMeasurement {
  return {
    key,
    operator: patch.operator,
    unit: patch.unit,
    autoGrade: patch.autoGrade,
    sourceText: patch.sourceText,
    note: patch.note,
    // Part C.3 — "new thresholds are confirmed:true, extracted:false (human-authored)", the
    // opposite defaults from a machine-extracted one pending review.
    confirmed: true,
    extracted: false,
    ...(patch.operator === 'tiered'
      ? { tiers: patch.tiers, inputs: patch.inputs }
      : { value: patch.value ?? null, value2: patch.operator === 'range' ? (patch.value2 ?? null) : null }),
  }
}

// Part C.3 — creates a brand-new measurement threshold on a leaf (as opposed to S3a's
// editMeasurementValue, which only edits a threshold that already exists). The anchor
// (Part C.3.a) is `sourceText` — the SAME field S3a's measurement editor already reads/writes;
// this session adds no new anchor field, it just makes that field settable on a leaf's first
// measurement. Forces the node onto answerType='presence_standard' — a measurement only makes
// sense there — mirroring setNodeQuestionType's 'measured' branch, so calling this after already
// switching the type (or in one step, before switching) both land the node in the same state.
export function addMeasurement(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  patch: NewMeasurementPatch,
): AddMeasurementResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const existing = node.measurements ?? []
  const key = nextMeasurementKey(existing)
  node.measurements = [...existing, buildMeasurement(key, patch)]
  if (node.answerType !== 'presence_standard') node.answerType = 'presence_standard'

  const validated = parseTemplateDefinition(clone)
  const after = findMeasurement(findNode(validated, nodeCode), key)
  return { definition: validated, key, after }
}

// Part C.4 — the high-water mark of child sequence numbers ever assigned under this node/group.
// Falls back to deriving one from the current children's own codes (their last `-N`/`.N` segment)
// for a node that predates this feature or has never had a child added through it; from then on
// the caller persists the incremented value onto `childSeq` so a later delete can never cause a
// number to be handed out twice.
function parseLastCodeSegment(code: string): number {
  const m = /[.-](\d+)$/.exec(code)
  return m ? parseInt(m[1]!, 10) : 0
}

function currentChildSeq(node: TemplateNode): number {
  if (typeof node.childSeq === 'number') return node.childSeq
  const children = node.subItems ?? []
  return children.reduce((max, c) => Math.max(max, parseLastCodeSegment(c.code)), 0)
}

// Item-under-group and every deeper level (criterion-under-item, sub-criterion-under-criterion,
// ...) use '.'; ONLY the first sub-item level under a plain item ('A1.1' -> 'A1.1-1') uses '-'.
// An item code matches exactly {group}.{n} — one dot, no dash; anything else (a group code with
// no dot at all, or a criterion code that already has a dash) falls through to '.'.
function childSeparator(parentCode: string): '.' | '-' {
  return parentCode.includes('.') && !parentCode.includes('-') ? '-' : '.'
}

export interface AddChildPatch {
  labelTh: string
  type: QuestionTypeSelector
  threshold?: NewMeasurementPatch
  lawRefs?: string[]
}

export interface AddChildResult {
  definition: ChecklistTemplateDefinition
  code: string
}

// Adds one child under an existing item or criterion (Part C.4, "เพิ่มข้อย่อย"). The code is
// ALWAYS auto-assigned, append-only per parent (see currentChildSeq/childSeparator above) — there
// is no way to pass an explicit code in, by design, since a human-chosen code is exactly what
// could collide with or shadow a future auto-assigned one.
export function addChildNode(
  def: ChecklistTemplateDefinition,
  parentCode: string,
  patch: AddChildPatch,
): AddChildResult {
  const clone = cloneDefinition(def)
  const parent = findNode(clone, parentCode)
  const seq = currentChildSeq(parent) + 1
  parent.childSeq = seq
  const code = `${parentCode}${childSeparator(parentCode)}${seq}`

  const child: TemplateNode = { code, labelTh: patch.labelTh }
  child.answerType = patch.type === 'presence' ? 'presence' : 'presence_standard'
  if (patch.lawRefs && patch.lawRefs.length > 0) child.lawRefs = patch.lawRefs
  parent.subItems = [...(parent.subItems ?? []), child]

  let validated = parseTemplateDefinition(clone)
  if (patch.threshold) {
    validated = addMeasurement(validated, code, patch.threshold).definition
  }
  return { definition: validated, code }
}

export interface DeleteNodeResult {
  definition: ChecklistTemplateDefinition
  deletedCode: string
  // The number of leaves in the deleted subtree (including the node itself if it's a leaf) — for
  // the frontend's confirm dialog to name a size BEFORE calling this (Part C.4: "deletion allowed
  // on DRAFT with a confirm naming the subtree size"). The frontend can also compute this itself
  // from the tree it already has loaded; returned here too so a server-driven confirm is possible.
  subtreeLeafCount: number
}

function countLeaves(node: TemplateNode): number {
  const own = node.answerType ? 1 : 0
  const children = (node.subItems ?? []).reduce((sum, c) => sum + countLeaves(c), 0)
  return own + children
}

// Part C.4 — removes a node (item or criterion) from wherever it lives in the tree. Never
// touches the parent's `childSeq` (that's the whole point — a deleted child's number is gone for
// good, never reassigned to a later addChildNode call).
export function deleteNode(def: ChecklistTemplateDefinition, nodeCode: string): DeleteNodeResult {
  const clone = cloneDefinition(def)
  const target = findNode(clone, nodeCode) // throws if unknown, before we bother removing anything
  const subtreeLeafCount = countLeaves(target)

  const removeFrom = (nodes: TemplateNode[]): TemplateNode[] =>
    nodes
      .filter((n) => n.code !== nodeCode)
      .map((n) => (n.subItems ? { ...n, subItems: removeFrom(n.subItems) } : n))
  for (const g of clone.groups) g.items = removeFrom(g.items)

  const validated = parseTemplateDefinition(clone)
  return { definition: validated, deletedCode: nodeCode, subtreeLeafCount }
}

export interface ReorderNodeResult {
  definition: ChecklistTemplateDefinition
}

// Part C.4 — up/down reordering within a level (siblings under the same parent), the simpler of
// the two options the spec offered over drag-and-drop. Codes are untouched — only display order
// changes — matching the crosswalk convention that codes are stable identifiers, not positions.
export function reorderNode(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  direction: 'up' | 'down',
): ReorderNodeResult {
  const clone = cloneDefinition(def)
  let found = false
  let moved = false

  const reorderIn = (nodes: TemplateNode[]): TemplateNode[] => {
    const idx = nodes.findIndex((n) => n.code === nodeCode)
    if (idx === -1) {
      return nodes.map((n) => (n.subItems ? { ...n, subItems: reorderIn(n.subItems) } : n))
    }
    found = true
    const swapWith = direction === 'up' ? idx - 1 : idx + 1
    if (swapWith < 0 || swapWith >= nodes.length) return nodes
    const copy = [...nodes]
    ;[copy[idx], copy[swapWith]] = [copy[swapWith]!, copy[idx]!]
    moved = true
    return copy
  }
  for (const g of clone.groups) g.items = reorderIn(g.items)

  if (!found) throw new TemplateEditError(`unknown node code "${nodeCode}"`)
  // Not-moved (already at the edge of its level) is a silent no-op, not an error — the frontend
  // simply disables the button at the edge; this guards a direct API call the same way.
  void moved

  const validated = parseTemplateDefinition(clone)
  return { definition: validated }
}

export interface EditLabelResult {
  definition: ChecklistTemplateDefinition
  before: { labelTh: string; num?: string }
  after: { labelTh: string; num?: string }
}

// Session S3b, Part C follow-up (live feedback) — the question TEXT itself is editable on a
// DRAFT, same gate as every other structural action. `code` is deliberately NOT part of this
// patch — it stays server-assigned/append-only (see addChildNode) because it's the stable
// identifier the crosswalk, era_overrides, and byLaw all key off; renaming it would silently
// orphan those references. If a real rename is ever needed, that's a crosswalk-aware migration,
// not a text-field edit.
export function editNodeLabel(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  labelTh: string,
  num?: string,
): EditLabelResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = { labelTh: node.labelTh, num: node.num }

  node.labelTh = labelTh
  if (num !== undefined) node.num = num || undefined

  const validated = parseTemplateDefinition(clone)
  const after = findNode(validated, nodeCode)
  return { definition: validated, before, after: { labelTh: after.labelTh, num: after.num } }
}

export interface ReorderMeasurementResult {
  definition: ChecklistTemplateDefinition
}

// Session S3b, Part C follow-up (live feedback) — a measurement's position in `measurements[]`
// is what the auditor's E-form renders in (LeafAnswerRow.tsx maps the array in order), so it
// should track the reading order of the question text. Scoring/era-resolution key everything by
// `measurement.key`, never by position, so reordering is safe — this only changes display order.
export function reorderMeasurement(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  measurementKey: string,
  direction: 'up' | 'down',
): ReorderMeasurementResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const measurements = node.measurements ?? []
  const idx = measurements.findIndex((m) => m.key === measurementKey)
  if (idx === -1) throw new TemplateEditError(`unknown measurement key "${measurementKey}" on node "${nodeCode}"`)

  const swapWith = direction === 'up' ? idx - 1 : idx + 1
  if (swapWith >= 0 && swapWith < measurements.length) {
    const copy = [...measurements]
    ;[copy[idx], copy[swapWith]] = [copy[swapWith]!, copy[idx]!]
    node.measurements = copy
  }
  // Already at the edge — silent no-op, same convention as reorderNode.

  const validated = parseTemplateDefinition(clone)
  return { definition: validated }
}

// ---- Session S3b, Part D — lawRefs (ข้อยกเว้นทางกฎหมาย) editing ----
// Editable on DRAFT AND ACTIVE (applicability data, not structure — gated by the ordinary
// applyEdit's RETIRED-only check, never the DRAFT-only applyStructuralEdit gate).

export interface EditLawRefsResult {
  definition: ChecklistTemplateDefinition
  before: { lawRefs: string[]; beyondLaw: boolean }
  after: { lawRefs: string[]; beyondLaw: boolean }
}

export function editLawRefs(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  lawRefs: string[],
  beyondLaw: boolean,
): EditLawRefsResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = { lawRefs: node.lawRefs ?? [], beyondLaw: node.beyondLaw ?? false }

  node.lawRefs = lawRefs.length > 0 ? lawRefs : undefined
  node.beyondLaw = beyondLaw ? true : undefined

  const validated = parseTemplateDefinition(clone)
  const after = findNode(validated, nodeCode)
  return { definition: validated, before, after: { lawRefs: after.lawRefs ?? [], beyondLaw: after.beyondLaw ?? false } }
}

// ---- Session S4a, Part C — hidden-node editing (any status; not gated behind the DRAFT-only
// structural editor, same reasoning as lawRefs above: this is applicability data, not structure) --

export interface EditHiddenResult {
  definition: ChecklistTemplateDefinition
  before: boolean
  after: boolean
}

export function editHidden(def: ChecklistTemplateDefinition, nodeCode: string, hidden: boolean): EditHiddenResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = node.hidden ?? false
  node.hidden = hidden ? true : undefined

  const validated = parseTemplateDefinition(clone)
  const after = findNode(validated, nodeCode).hidden ?? false
  return { definition: validated, before, after }
}

// ---- export (Part C.3 round-trip guard) ----

// Derives an era_overrides_{mode}.json-shaped extract (see @repo/types#applyEraOverrides'
// header doc for the file format) from the current DB definition's byLaw-bearing leaves, so the
// repo seed files can be regenerated from live DB state. Only leaves that actually carry a
// byLaw-wrapped measurement are included — flat (non-era-varying) leaves have nothing to extract.
export function deriveEraOverridesExtract(def: ChecklistTemplateDefinition): { overrides: Record<string, { measurements: unknown[] }> } {
  const overrides: Record<string, { measurements: unknown[] }> = {}
  for (const leaf of walkTemplateLeaves(def)) {
    const eraMeasurements = (leaf.measurements ?? []).filter((m) => m.byLaw !== undefined)
    if (eraMeasurements.length > 0) {
      overrides[leaf.code] = { measurements: eraMeasurements }
    }
  }
  return { overrides }
}
