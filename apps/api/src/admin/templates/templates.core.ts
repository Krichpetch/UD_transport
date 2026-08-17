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
import type {
  ChecklistTemplateDefinition,
  TemplateAnswerType,
  TemplateLabelByLawEntry,
  TemplateMeasurement,
  TemplateMeasurementByLawEntry,
  TemplateNode,
  TemplateTier,
} from '@repo/types'
import { FACILITY_CATALOG, indexTemplateNodesByCode, parseTemplateDefinition, walkTemplateLeaves } from '@repo/types'

export class TemplateEditError extends Error {}

export const MAX_IMAGES_PER_NODE = 8

// Shared with facility-groups.service.ts's upload-only endpoint (Session S5-fix multi-image
// follow-up) — one source of truth for what an "image" is and where its bytes live in MinIO,
// since both the per-node editor and the grouped/master editor upload through it.
export const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const TEMPLATE_IMAGE_KEY_PREFIX = 'template-images/'

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

// Sourced from the real byLaw entry type, not hand-duplicated — any future field added to
// TemplateMeasurementByLawEntry (@repo/types) is automatically patchable here without a second
// edit. See editEraOverride's merge below, which relies on this being exactly Partial<...>.
export type EraEntryPatch = Partial<TemplateMeasurementByLawEntry>

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
    // Merge onto the existing per-law entry, never replace it wholesale — `entry` is often a
    // PARTIAL patch (e.g. just `{tiers}` from the grouped editor's era save), and a plain replace
    // would silently delete whatever fields it didn't carry (sourceText/labelTh in particular).
    // Safe because `entry` always comes from JSON.parse'd HTTP body: a key is either
    // present-with-a-value (incl. explicit null, which correctly overwrites/clears) or fully
    // absent (JSON.stringify drops `undefined` keys client-side) — plain object spread does the
    // right thing with no extra handling.
    measurement.byLaw = {
      ...(measurement.byLaw ?? {}),
      [lawCode]: { ...(measurement.byLaw?.[lawCode] ?? {}), ...entry },
    }
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

export interface LabelByLawEntryPatch {
  labelTh: string
  sourceText?: string | null
}

export interface EditLabelByLawResult {
  definition: ChecklistTemplateDefinition
  before: TemplateLabelByLawEntry | null
  after: TemplateLabelByLawEntry | null
}

// The labelByLaw sibling of editEraOverride above (Era-editor safety session, Part C). Deliberately
// does NOT union lawCode into node.lawRefs (unlike editEraOverride) — a labelByLaw entry never
// asserts the container came into existence under a law, it only swaps case-condition heading
// text; see era-overrides.ts's applyEraOverrides (the seed-time equivalent, same invariant) and
// era-container-label.spec.ts's inertness tests, which this must not break.
export function editLabelByLawOverride(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  lawCode: string,
  entry: LabelByLawEntryPatch | null,
): EditLabelByLawResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = node.labelByLaw?.[lawCode] ?? null

  if (entry === null) {
    if (node.labelByLaw) {
      const { [lawCode]: _removed, ...rest } = node.labelByLaw
      node.labelByLaw = Object.keys(rest).length > 0 ? rest : undefined
    }
  } else {
    node.labelByLaw = { ...(node.labelByLaw ?? {}), [lawCode]: { ...(node.labelByLaw?.[lawCode] ?? {}), ...entry } }
    // No lawRefs union — see doc comment above. Do not add one.
  }

  const validated = parseTemplateDefinition(clone)
  const after = findNode(validated, nodeCode).labelByLaw?.[lawCode] ?? null
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

// Idempotent on an already-attached key (Session S4b addition): the grouped editor's image
// propagation calls this once per instance with the SAME already-uploaded key, including the
// instance the file was originally uploaded to — without this check that instance would gain the
// same key twice (MAX_IMAGES_PER_NODE has no duplicate-detection of its own) on every propagate.
export function addImageKey(def: ChecklistTemplateDefinition, nodeCode: string, key: string): EditImagesResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = node.imageKeys ? [...node.imageKeys] : []
  if (before.includes(key)) {
    return { definition: clone, before, after: before }
  }
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

// ---- Session S4b-fix, Fix 3 — add-and-place: insert a new sibling at a chosen POSITION relative
// to a named anchor, rather than always at the end (addChildNode above). Era-editor safety
// follow-up: the code now renumbers to match that position too (see addPositionedChildNode's own
// doc below) — a "before N" insert takes over N's own code, shifting N (and everything after it)
// up by one, rather than always appending the next free number regardless of where it lands. ----

export interface AddPositionedChildPatch {
  labelTh: string
  type: QuestionTypeSelector
  threshold?: NewMeasurementPatch
  lawRefs?: string[]
  facilityCode?: number
  cabinetResolution?: boolean
  beyondLaw?: boolean
}

export interface FacilityCodeDefaults {
  lawRefs?: string[]
  cabinetResolution?: boolean
  beyondLaw?: boolean
}

// facilityCode -> lawRefs/cabinetResolution/beyondLaw, the same derivation tagContainers does at
// seed time — shared by addAndPlace (facility-groups.service.ts) and addTopLevelItem
// (templates.service.ts) so a new top-level item gets identical catalog resolution regardless of
// which admin flow created it. Explicit `explicitLawRefs`, when supplied, always wins over the
// catalog's own. Returns `null` for an unknown facilityCode — kept Nest-free (no
// BadRequestException) matching this file's "no @nestjs/common" convention; each caller turns that
// into its own error.
export function resolveFacilityCodeDefaults(facilityCode: number | undefined, explicitLawRefs: string[] | undefined): FacilityCodeDefaults | null {
  if (facilityCode === undefined) return { lawRefs: explicitLawRefs }
  const entry = FACILITY_CATALOG.find((e) => e.code === facilityCode)
  if (!entry) return null
  return {
    lawRefs: explicitLawRefs ?? [...entry.lawRefs],
    cabinetResolution: entry.cabinetResolution,
    beyondLaw: entry.beyondLaw,
  }
}

function buildPositionedChild(code: string, patch: AddPositionedChildPatch): TemplateNode {
  const child: TemplateNode = { code, labelTh: patch.labelTh }
  child.answerType = patch.type === 'presence' ? 'presence' : 'presence_standard'
  if (patch.lawRefs && patch.lawRefs.length > 0) child.lawRefs = patch.lawRefs
  if (patch.facilityCode !== undefined) child.facilityCode = patch.facilityCode
  if (patch.cabinetResolution) child.cabinetResolution = true
  if (patch.beyondLaw) child.beyondLaw = true
  return child
}

// Session S4b-fix, Fix 3 — like addChildNode, but inserts the new sibling at a chosen POSITION
// relative to a named anchor, rather than always at the end.
//
// Era-editor safety follow-up (live feedback, 2026-08-17) — code assignment REVERSED from the
// original "always append-only, never adjacent to the anchor's code" design: the whole level now
// renumbers via renumberLevelByPosition immediately after the splice, so the new item's code lands
// in sequence with its new neighbors right away (an item inserted before some code N takes over N
// itself, and N's old content — along with everything after it — shifts up by one). Same
// motivation and same DRAFT-only safety argument as reorderNode's doc above.
//
// `containerCode` may name either an ordinary TemplateNode (inserts into its `subItems`) OR a
// GROUP's own code (inserts into that group's top-level `items[]`) — real anchors are not always
// nested inside another item. "เครื่องบริการถ่ายทอดการสื่อสารสาธารณะ (TTRS)" (Fix 5's anchor) is
// itself a top-level item directly under its group, a peer of other top-level items, not a child
// of one — see the group branch below, which addChildNode (item-nesting only) has no equivalent
// for. Group code is checked FIRST since group codes ('B1') and node codes ('B1.1') never collide
// (node codes always carry a '.' or '-' segment a bare group code never has).
export function addPositionedChildNode(
  def: ChecklistTemplateDefinition,
  containerCode: string,
  anchorCode: string,
  side: 'before' | 'after',
  patch: AddPositionedChildPatch,
): AddChildResult {
  const clone = cloneDefinition(def)

  const group = clone.groups.find((g) => g.code === containerCode)
  if (group) {
    const anchorIndex = group.items.findIndex((n) => n.code === anchorCode)
    if (anchorIndex === -1) {
      throw new TemplateEditError(`anchor node "${anchorCode}" not found as a top-level item of group "${containerCode}"`)
    }
    // Placeholder code — overwritten immediately below by renumberLevelByPosition, which reassigns
    // every sibling's code (this new one included) to match its post-insert array position.
    const child = buildPositionedChild(`${containerCode}${childSeparator(containerCode)}0`, patch)

    const insertAt = side === 'before' ? anchorIndex : anchorIndex + 1
    const nextItems = [...group.items]
    nextItems.splice(insertAt, 0, child)
    group.items = renumberLevelByPosition(nextItems, containerCode)
    group.childSeq = group.items.length
    const code = group.items[insertAt]!.code

    let validated = parseTemplateDefinition(clone)
    if (patch.threshold) validated = addMeasurement(validated, code, patch.threshold).definition
    return { definition: validated, code }
  }

  const parent = findNode(clone, containerCode)
  const siblings = parent.subItems ?? []
  const anchorIndex = siblings.findIndex((n) => n.code === anchorCode)
  if (anchorIndex === -1) {
    throw new TemplateEditError(`anchor node "${anchorCode}" not found under container "${containerCode}"`)
  }

  const child = buildPositionedChild(`${containerCode}${childSeparator(containerCode)}0`, patch)

  const insertAt = side === 'before' ? anchorIndex : anchorIndex + 1
  const nextSiblings = [...siblings]
  nextSiblings.splice(insertAt, 0, child)
  parent.subItems = renumberLevelByPosition(nextSiblings, containerCode)
  parent.childSeq = parent.subItems.length
  const code = parent.subItems[insertAt]!.code

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
  // The code the MOVED node's own content now carries (see below — codes are pinned to their
  // slot, not the content, so a moved node's code changes too). Equal to the original `nodeCode`
  // on a no-op (already at the edge). The caller uses this to keep an open editor pointed at the
  // content the admin was actually looking at, rather than snapping to whatever now sits under
  // the old code.
  movedToCode: string
}

// Renames a node's own code plus every descendant's, preserving each descendant's suffix past
// the old prefix (child codes are always `${parentCode}${separator}${seq}`, so every descendant
// code literally starts with its ancestor's code — see childSeparator/addChildNode above).
// Everything other than `code` travels with the node unchanged (labelTh, measurements, masterId,
// childSeq, ...) — only the printed code label is being reassigned to a new slot.
function renumberSubtreeCodes(node: TemplateNode, oldPrefix: string, newPrefix: string): TemplateNode {
  const code = node.code.startsWith(oldPrefix) ? newPrefix + node.code.slice(oldPrefix.length) : node.code
  return {
    ...node,
    code,
    subItems: node.subItems ? node.subItems.map((c) => renumberSubtreeCodes(c, oldPrefix, newPrefix)) : node.subItems,
  }
}

// Era-editor safety follow-up — reassigns an entire sibling level's codes to match CURRENT array
// order (1, 2, 3, ... under `containerCode`'s own separator), cascading each node's own
// descendants via renumberSubtreeCodes above. Used by addPositionedChildNode so a positioned
// insert's code reads in sequence with its new neighbors immediately, not just its position — see
// that function's doc for why (live feedback: a code is a printed line number, and an insert
// should renumber what it displaces the way editing a numbered list would).
function renumberLevelByPosition(nodes: TemplateNode[], containerCode: string): TemplateNode[] {
  const sep = childSeparator(containerCode)
  return nodes.map((n, i) => {
    const newCode = `${containerCode}${sep}${i + 1}`
    return n.code === newCode ? n : renumberSubtreeCodes(n, n.code, newCode)
  })
}

// Part C.4 — up/down reordering within a level (siblings under the same parent), the simpler of
// the two options the spec offered over drag-and-drop.
//
// Era-editor safety follow-up (live feedback, 2026-08-17) — REVERSED from the original "codes are
// untouched, only display order changes" design. In practice a code reads as a printed line
// number on the physical checklist document, and admins expect moving an item before another one
// to renumber them the way a human editing a numbered list would — not leave the display order
// and the code order silently disagreeing (e.g. a newly-inserted item displayed above "B2.18"
// while itself still labelled "B2.19"). Codes are now PINNED TO THE SLOT: the two nodes swap
// positions, and each swaps onto the OTHER's former code (cascading into any of its own
// descendants via renumberSubtreeCodes), so code order always stays monotonic with display order.
// Safe specifically because this is DRAFT-only (applyStructuralEdit's gate) — no live audit
// answer ever references a DRAFT template's codes, so there is nothing to leave dangling.
export function reorderNode(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  direction: 'up' | 'down',
): ReorderNodeResult {
  const clone = cloneDefinition(def)
  let found = false
  let moved = false
  let movedToCode = nodeCode

  const reorderIn = (nodes: TemplateNode[]): TemplateNode[] => {
    const idx = nodes.findIndex((n) => n.code === nodeCode)
    if (idx === -1) {
      return nodes.map((n) => (n.subItems ? { ...n, subItems: reorderIn(n.subItems) } : n))
    }
    found = true
    const swapWith = direction === 'up' ? idx - 1 : idx + 1
    if (swapWith < 0 || swapWith >= nodes.length) return nodes
    const a = nodes[idx]!
    const b = nodes[swapWith]!
    const copy = [...nodes]
    copy[idx] = renumberSubtreeCodes(b, b.code, a.code)
    copy[swapWith] = renumberSubtreeCodes(a, a.code, b.code)
    moved = true
    movedToCode = b.code
    return copy
  }
  for (const g of clone.groups) g.items = reorderIn(g.items)

  if (!found) throw new TemplateEditError(`unknown node code "${nodeCode}"`)
  // Not-moved (already at the edge of its level) is a silent no-op, not an error — the frontend
  // simply disables the button at the edge; this guards a direct API call the same way.
  void moved

  const validated = parseTemplateDefinition(clone)
  return { definition: validated, movedToCode }
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

// ---- Session S4b-fix, Fix 4 — detach-to-standalone (any status, same RETIRED-only gate as
// hidden/lawRefs above: this is grouping metadata, not structure). Setting standalone:true opts
// this ONE instance out of the facility-grouped editor's canonical pooling even though its text
// still matches a shared item elsewhere; clearing it lets the next groups computation re-pool it —
// see TemplateNode.standalone's doc in @repo/types for why re-attach needs no bespoke merge here. --

export interface EditStandaloneResult {
  definition: ChecklistTemplateDefinition
  before: boolean
  after: boolean
}

export function editStandalone(def: ChecklistTemplateDefinition, nodeCode: string, standalone: boolean): EditStandaloneResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = node.standalone ?? false
  node.standalone = standalone ? true : undefined

  const validated = parseTemplateDefinition(clone)
  const after = findNode(validated, nodeCode).standalone ?? false
  return { definition: validated, before, after }
}

// ---- Session S4b, Part 2 — the facility-grouped editor's conflict-resolution "leave split"
// action. See @repo/types#TemplateNode.conflictSplitAcknowledged's doc: this only silences the
// conflict queue for a canonical item the admin has reviewed and deliberately decided stays
// divergent across templates; it never gates propagation by itself (see
// facility-grouping.core.ts#isPropagatable). facility-groups.service.ts calls this once per
// divergent instance (one Prisma row per call, same as every other edit here). ----

export interface EditConflictSplitAcknowledgedResult {
  definition: ChecklistTemplateDefinition
  before: boolean
  after: boolean
}

export function acknowledgeConflictSplit(def: ChecklistTemplateDefinition, nodeCode: string): EditConflictSplitAcknowledgedResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = node.conflictSplitAcknowledged ?? false
  node.conflictSplitAcknowledged = true

  const validated = parseTemplateDefinition(clone)
  const after = findNode(validated, nodeCode).conflictSplitAcknowledged ?? false
  return { definition: validated, before, after }
}

// ---- Session S4b, Part 2 — "pick a winner" conflict resolution. Replaces a leaf's ENTIRE
// answerType + measurements[] with another instance's (the admin-chosen authoritative copy) in one
// shot — deliberately coarser than editMeasurementValue (which only ever touches one measurement
// slot the caller already knows the key of): a conflict can diverge in answerType itself
// (presence vs presence_standard, report §7b) or in which measurement keys exist at all, so a
// single-slot edit can't always reconcile two divergent leaves. facility-groups.service.ts calls
// this once per divergent instance; instances already matching the winner are skipped by the
// caller before this is ever invoked. ----

export interface OverwriteLeafDataResult {
  definition: ChecklistTemplateDefinition
  before: { answerType?: TemplateAnswerType; measurements?: TemplateMeasurement[] }
  after: { answerType?: TemplateAnswerType; measurements?: TemplateMeasurement[] }
}

export function overwriteLeafData(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  source: { answerType?: TemplateAnswerType; measurements?: TemplateMeasurement[] },
): OverwriteLeafDataResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = { answerType: node.answerType, measurements: node.measurements }

  node.answerType = source.answerType
  // Deep-clone via the same JSON round-trip cloneDefinition uses, so the target row never shares
  // object references with whichever OTHER template's in-memory tree `source` was read from.
  node.measurements = source.measurements ? (JSON.parse(JSON.stringify(source.measurements)) as TemplateMeasurement[]) : undefined
  // A winning copy is, by definition, an admin-reviewed value — same "editing sets confirmed:true"
  // rule editMeasurementValue already follows.
  for (const m of node.measurements ?? []) m.confirmed = true

  const validated = parseTemplateDefinition(clone)
  const after = findNode(validated, nodeCode)
  return { definition: validated, before, after: { answerType: after.answerType, measurements: after.measurements } }
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
