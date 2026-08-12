// E-form redesign (Session E1) — versioned ChecklistTemplate `definition` JSON shape.
//
// Reconciliation note (see apps/docs/Checklist_Utils/DATA_DICTIONARY_v2.md §2): the E1 kickoff
// spec proposed answerType: 'choice' | 'boolean' | 'measured'. The real สนข. paper forms only
// ever produce two leaf shapes — 'presence' and 'presence_standard' — which the data dictionary
// explicitly maps as: presence ≈ boolean; presence_standard (optionally carrying measurements[])
// ≈ measured. 'choice' is the v1 (today's flat, in-code) shape. No template — v1 or v2 — ever
// uses a literal 'boolean' or 'measured' answerType; this union only has the three that occur.
import type { TransportMode } from './transport.js'

export type TemplateAnswerType = 'choice' | 'presence' | 'presence_standard'

export const TEMPLATE_ANSWER_TYPES: readonly TemplateAnswerType[] = ['choice', 'presence', 'presence_standard']

// The standard 3-state + N/A choice set (v1 shape). A template item may override with its own
// `choices` list; absent means "use this default."
export const DEFAULT_CHOICE_VALUES = ['มี', 'ไม่มี', 'N/A'] as const

export type ThresholdOperator = 'gte' | 'lte' | 'range' | 'tiered'

// A tiered lookup band (DATA_DICTIONARY_v2.md, "Era-dependent criteria" §, `tiered` operator).
// `max` absent means "open-ended" — only valid on the last tier, optionally extended by
// incrementPer/incrementBy (e.g. +1 required per each additional 100 over the tier's `min`).
export interface TemplateTier {
  min: number
  max?: number | null
  required: number
  incrementPer?: number
  incrementBy?: number
}

// One auditor-entered numeric input feeding a `tiered` measurement (e.g. basis/provided).
export interface TemplateMeasurementInput {
  key: string
  labelTh: string
}

// The era-varying slice of a measurement's value fields — keyed by LawReference.code inside
// TemplateMeasurement.byLaw. Only the fields relevant to the measurement's operator are set
// (value/value2 for gte|lte|range, tiers for tiered).
export interface TemplateMeasurementByLawEntry {
  value?: number | null
  value2?: number | null
  tiers?: TemplateTier[]
  // Session F3 follow-up (2026-08-05) — the numeric value isn't the only text that varies by era:
  // the question's own prose (leaf labelTh) and the measurement's sourceText both embed the same
  // number in Thai. Optional here because most byLaw entries don't need it (era-resolution.ts
  // falls back to the leaf's/measurement's flat text when absent) — only set when this law's
  // number differs from the template's base flat text.
  sourceText?: string | null
  labelTh?: string | null
}

// A single numeric criterion attached to a presence_standard leaf (DATA_DICTIONARY_v2.md §2).
// Canonical unit is millimeters (matches the official checklist documents' own wording — every
// threshold is phrased in มิลลิเมตร, so the question text and the auditor's entered value are
// always in the same unit) except the slope convention `ratio_1_x` (auditor enters the X of
// 1:X; larger X passes for a `gte` threshold). Stored on TEMPLATE data (admin-editable, never
// re-derives past submissions' stored answers — only how NEW/re-scored answers are graded).
//
// Era variance (Session E2): any operator's value fields may be wrapped in `byLaw` instead of
// (or in addition to, as a fallback) being set flat — see TemplateMeasurementByLawEntry. Resolved
// server-side (see era-resolution.ts) before a client ever sees the template; `byLaw` is stripped
// from what GET template-for-audit returns. `tiered` is a new operator: the required value is a
// lookup on an auditor-entered basis (`inputs[0]`) compared against an auditor-entered provided
// count (`inputs[1]`) — see TemplateTier.
export interface TemplateMeasurement {
  key: string
  operator: ThresholdOperator
  value?: number | null    // gte/lte/range — absent when only `byLaw` supplies it
  value2?: number | null   // only meaningful for operator === 'range'
  tiers?: TemplateTier[]   // tiered, flat (era-independent) shape — absent when only `byLaw` supplies it
  inputs?: TemplateMeasurementInput[]  // tiered only — the auditor's two numeric entry fields
  unit: string
  byLaw?: Record<string, TemplateMeasurementByLawEntry>  // keyed by LawReference.code
  sourceText?: string
  note?: string
  autoGrade: boolean        // false => guidance only; never feeds a standards verdict
  extracted?: boolean       // true => machine-extracted from source doc, pending human review
  confirmed?: boolean       // admin has reviewed/corrected this threshold
}

// A single-threshold shape for hypothetical non-presence 'measured' items (kept for forward
// compatibility with the original A.2 sketch; no seeded template currently uses it — leaves use
// `measurements[]` on a presence_standard node instead, see above).
export interface TemplateThreshold {
  operator: ThresholdOperator
  value: number
  value2?: number | null
  unit: string
  autoGrade: boolean
}

export interface TemplateGuidance {
  text: string
  reference?: string
}

// One node in the template tree: a group's item, or any depth of criterion/sub-criterion below
// it. Leaves carry `answerType`; containers (nodes with children) never do — see
// DATA_DICTIONARY_v2.md §1/§3. Sub-items are optional at every level: a node with no `subItems`
// is itself a leaf.
export interface TemplateNode {
  code: string          // e.g. 'A1.1', 'A1.1-1', 'A1.1-1.1' — stable, globally unique per template
  labelTh: string
  num?: string           // display numeral for criteria/sub-criteria, e.g. '1', '1.1'

  // ---- leaf-only fields (present iff this node has no subItems) ----
  answerType?: TemplateAnswerType
  choices?: readonly string[]          // 'choice' leaves only; defaults to DEFAULT_CHOICE_VALUES
  threshold?: TemplateThreshold          // single-threshold shape (see TemplateThreshold doc)
  measurements?: TemplateMeasurement[]   // presence_standard leaves with a numeric criterion
  guidance?: TemplateGuidance             // คู่มือการตรวจประเมิน reference, autoGrade=false items etc.

  // ---- facility catalog tagging (Part A2), optional at every level, null/absent = unmatched ----
  facilityCode?: number       // 1-33, apps/docs facility catalog — NOT a unique key (repeats)
  lawRefs?: string[]          // LawReference.code values requiring this item
  cabinetResolution?: boolean // one of the 5 มติ ครม. priority items
  beyondLaw?: boolean         // project-added item, not required by any กฎกระทรวง

  // Session F1, Part C — item-level era redaction. Set ONLY by era-resolution.ts#markApplicability
  // (never by parseTemplateDefinition/seed data) on answerType-bearing nodes: false means this
  // station's frozen build-year stamp predates every law requiring the item — it still exists in
  // the tree (client stays dumb, admin/debug views see the full structure) but is not answerable
  // and excluded from every scoring denominator. Absent/true = applicable (every template not run
  // through markApplicability — v1, or any v2/v3 template read outside the audit-template
  // endpoint — is simply never marked, which is the correct "don't redact" default).
  applicable?: boolean

  // Admin-attached reference images (W2-S3a, Part D) — MinIO keys under template-images/, shown
  // in the auditor's คู่มือการตรวจประเมิน modal. Optional at every level (like lawRefs above), not
  // leaf-only: a container criterion can carry its own illustrative photo even if its children are
  // the answerable leaves. Cap (e.g. 3 per node) is enforced by the admin editor/upload endpoint,
  // not this shape check.
  imageKeys?: string[]

  // Session S4a, Part C — admin-authored ABSOLUTE hide, distinct from both `applicable` (era/year-
  // dependent, marks rather than deletes, still shown to the auditor as a collapsed footer note)
  // and a group's `optional` (still shown, just non-blocking at submit). `hidden: true` means an
  // admin decided this node (and its whole subtree) should never appear on the auditor form at
  // all, unconditionally — not even as a footer note — see era-resolution.ts#filterHiddenItems,
  // which deletes it from the resolved tree before the client ever sees it. May be set on a
  // container OR a leaf; hiding a container hides everything beneath it. Never serialized as an
  // explicit `false` (dropped instead, like beyondLaw) so an untouched node round-trips byte-
  // identically through the admin editor (S3a's parity gate).
  hidden?: boolean

  // Session S4b, Part 2 — the facility-grouped editor's conflict-resolution pass (§7b of
  // facility-type-redundancy-report.md: item texts that are identical across templates but carry
  // DIFFERENT answerType/measurements). Set ONLY via the grouped editor's "leave split — these are
  // genuinely different" action, never auto-computed: it tells detectConflicts() this divergence
  // was a deliberate admin decision, not an unreviewed data bug, so it stops surfacing in the
  // conflict queue. It is NOT a propagation gate by itself — a canonical item with any data
  // divergence never offers a propagate action regardless of this flag (there is nothing to
  // propagate when instances are legitimately different); this only silences the "needs review"
  // signal. Picking a WINNER instead (the other resolution path) needs no flag at all: the
  // propagate write makes every instance identical, so the next detectConflicts() run finds no
  // divergence on its own.
  conflictSplitAcknowledged?: boolean

  // Session S4b-fix, Fix 4 — admin-authored opt-out from the facility-grouped editor's canonical
  // pooling (facility-grouping.core.ts#buildCanonicalItemsForGroup). Grouping is COMPUTED by fuzzy
  // label match, not stored — so excluding one instance from a shared canonical item needs a
  // PERSISTED marker the engine can honor, or the very next groups computation just re-pools it.
  // true = this leaf is edited standalone even though its text matches a shared canonical item
  // elsewhere; the grouped editor's propagate/confirm targets never include it, and its own edits
  // never fan out. Never serialized as an explicit `false` (same convention as `hidden`), so an
  // untouched node round-trips byte-identically through the admin editor (S3a's parity gate).
  // Re-attaching (clearing this) is deliberately a plain field clear, not a bespoke merge: once
  // cleared, the NEXT groups computation naturally re-pools the leaf, and if its data has diverged
  // from the rest, the EXISTING conflict queue (detectConflicts/isPropagatable) surfaces that the
  // same way it would for any other divergence — no separate re-attach-time check needed.
  standalone?: boolean

  // Session S5, Part A — master/reference criterion linkage (see @repo/types' sibling doc on
  // MasterCriterion in apps/api/prisma/schema.prisma for the full design). Orthogonal to
  // `standalone` above: `standalone` opts a leaf OUT of the grouping engine's fuzzy pooling,
  // while `masterId` is an EXPLICIT, admin-created link — a leaf can never carry both (Part E
  // excludes masterId'd leaves from pooling the same way it already excludes standalone ones).
  //
  // `masterId` present means this leaf's write-through fields (answerType/measurements/guidance/
  // imageKeys/lawRefs/labelTh) are owned by that MasterCriterion row and populated by its auto-push
  // (Part D) — they are ALWAYS physically present on this node (Part B's write-through invariant),
  // never looked up live, so every read path (scoring/era-resolution/the E-form) stays exactly as
  // fast and exactly as independent of the MasterCriterion table as before this feature existed.
  // A direct single-node edit on an attached leaf is rejected server-side (Part C) — detach first.
  masterId?: string

  // Set ONLY when a previously-attached leaf is detached (Part C.2) — a breadcrumb naming the
  // master it came FROM, so the master facility editor can list it under "แยกออกแล้ว" (Part D2/F.3)
  // even though `masterId` itself is now cleared. Cleared again on re-attach (Part C.3/D3), which
  // also resets `masterId` and overwrites the node's values from the master's CURRENT state.
  // A node never carries both `masterId` and `detachedFromMasterId` at once.
  detachedFromMasterId?: string

  // Session S3b, Part C.4 — admin bookkeeping only, never read by scoring/the auditor E-form.
  // The high-water mark of child sequence numbers ever assigned under THIS node via the
  // structural editor's "เพิ่มข้อย่อย" action — never decremented, including on delete, so a
  // freed number is never reassigned (the checklist-migration crosswalk depends on codes being
  // stable identifiers; reusing a deleted code would silently alias two different historical
  // items together). Absent on every node from before this feature existed, or that has never
  // had a child added this way — the editor derives a starting value from existing children's
  // codes the first time it's needed (see templates.core.ts#nextChildSeq) and persists it here
  // from then on.
  childSeq?: number

  subItems?: TemplateNode[]
}

export interface ChecklistTemplateGroupDef {
  code: string       // e.g. 'A1'
  labelTh: string
  // Session F3, Part C — an auditor may SUBMIT with this group incomplete (สนข. meeting
  // 2026-08-03: "CheckList ข้อ C สามารถประเมินไม่ครบ แต่ส่งผลการประเมินและคำนวณได้"). Deliberately a
  // per-group DATA flag stamped on the template, not a `/^C/` test at the call site: which groups
  // are optional is a สนข. policy decision that belongs with the checklist definition, and a
  // future template can mark a different group optional without touching the submit gate.
  //
  // NOT a scoring concept. Unanswered leaves are already excluded from every numerator and
  // denominator regardless of which group they sit in (see scoring.ts — `value === null` and
  // `present !== true` both skip), so a blank optional group scores exactly like an absent one.
  optional?: boolean
  items: TemplateNode[]

  // Session S4b-fix, Fix 3 — mirrors TemplateNode.childSeq exactly, one level up: the high-water
  // mark of TOP-LEVEL item sequence numbers ever assigned directly under this GROUP via
  // add-and-place. Needed because some real anchors (e.g. "TTRS") are themselves top-level group
  // items, not nested inside another item's subItems — addChildNode/addPositionedChildNode's
  // existing append-only counter lives on TemplateNode and has no equivalent at the group level
  // until this field. Absent on every group from before this feature existed; the editor derives
  // a starting value from existing items' own codes the first time it's needed and persists it
  // here from then on, same fallback templates.core.ts#currentChildSeq already uses for nodes.
  childSeq?: number
}

// Session F3, Part C.1 — the group codes สนข. has declared optional to complete before submitting
// (meeting 2026-08-03, Dr.Aliz). Consumed ONLY by the seed script, which stamps
// ChecklistTemplateGroupDef.optional onto the matching groups of every template version it writes;
// nothing at runtime tests a group code against this list. That indirection is the point: the
// submit gate reads the per-template flag, so an admin-authored or future template can declare a
// different set without a code change here.
//
// C1 = ความรับรู้ในการเข้าถึงการให้บริการ (Awareness), C2 = การฝึกอบรมของผู้ให้บริการ (Training) — both are
// staff/process questions answered by station personnel, not physical facts an auditor can
// observe unaided, which is why สนข. accepts a partial answer set for them.
export const OPTIONAL_GROUP_CODES: readonly string[] = ['C1', 'C2']

export interface ChecklistTemplateDefinition {
  schemaVersion: 1 | 2
  mode: TransportMode
  answerTypes?: Record<string, string>  // documentation only, mirrors DATA_DICTIONARY_v2.md §2
  source?: string
  provisional?: boolean
  groups: ChecklistTemplateGroupDef[]
}

export class ChecklistTemplateValidationError extends Error {
  constructor(message: string, public path: string) {
    super(`${path}: ${message}`)
    this.name = 'ChecklistTemplateValidationError'
  }
}

function fail(path: string, message: string): never {
  throw new ChecklistTemplateValidationError(message, path)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function checkString(v: unknown, path: string, field: string): string {
  if (typeof v !== 'string' || v.length === 0) fail(path, `missing or invalid ${field}`)
  return v as string
}

function checkThresholdOperator(v: unknown, path: string): ThresholdOperator {
  if (v !== 'gte' && v !== 'lte' && v !== 'range' && v !== 'tiered') {
    fail(path, `operator must be gte|lte|range|tiered, got ${JSON.stringify(v)}`)
  }
  return v
}

function parseTier(raw: unknown, path: string): TemplateTier {
  if (!isPlainObject(raw)) fail(path, 'tier must be an object')
  const o = raw as Record<string, unknown>
  if (typeof o.min !== 'number') fail(`${path}.min`, 'must be a number')
  if (o.max !== undefined && o.max !== null && typeof o.max !== 'number') fail(`${path}.max`, 'must be a number or null')
  if (typeof o.required !== 'number') fail(`${path}.required`, 'must be a number')
  if (o.incrementPer !== undefined && typeof o.incrementPer !== 'number') fail(`${path}.incrementPer`, 'must be a number')
  if (o.incrementBy !== undefined && typeof o.incrementBy !== 'number') fail(`${path}.incrementBy`, 'must be a number')
  return {
    min: o.min as number,
    max: typeof o.max === 'number' ? o.max : null,
    required: o.required as number,
    incrementPer: typeof o.incrementPer === 'number' ? o.incrementPer : undefined,
    incrementBy: typeof o.incrementBy === 'number' ? o.incrementBy : undefined,
  }
}

function parseTiers(raw: unknown, path: string): TemplateTier[] {
  if (!Array.isArray(raw) || raw.length === 0) fail(path, 'must be a non-empty array')
  return (raw as unknown[]).map((t, i) => parseTier(t, `${path}[${i}]`))
}

function parseMeasurementInput(raw: unknown, path: string): TemplateMeasurementInput {
  if (!isPlainObject(raw)) fail(path, 'input must be an object')
  const o = raw as Record<string, unknown>
  return { key: checkString(o.key, path, 'key'), labelTh: checkString(o.labelTh, path, 'labelTh') }
}

function parseByLawEntry(raw: unknown, path: string, operator: ThresholdOperator): TemplateMeasurementByLawEntry {
  if (!isPlainObject(raw)) fail(path, 'byLaw entry must be an object')
  const o = raw as Record<string, unknown>
  if (operator === 'tiered') {
    if (o.tiers === undefined) fail(`${path}.tiers`, 'tiered byLaw entry requires tiers')
    return {
      tiers: parseTiers(o.tiers, `${path}.tiers`),
      sourceText: typeof o.sourceText === 'string' ? o.sourceText : undefined,
      labelTh: typeof o.labelTh === 'string' ? o.labelTh : undefined,
    }
  }
  if (typeof o.value !== 'number') fail(`${path}.value`, 'must be a number')
  if (operator === 'range' && typeof o.value2 !== 'number') fail(`${path}.value2`, 'range operator requires numeric value2')
  return {
    value: o.value as number,
    value2: typeof o.value2 === 'number' ? o.value2 : null,
    sourceText: typeof o.sourceText === 'string' ? o.sourceText : undefined,
    labelTh: typeof o.labelTh === 'string' ? o.labelTh : undefined,
  }
}

// Exported (not just used internally) so era-overrides.ts can validate override measurement
// arrays through the exact same rules a template's own measurements[] are held to.
export function parseMeasurement(raw: unknown, path: string): TemplateMeasurement {
  if (!isPlainObject(raw)) fail(path, 'measurement must be an object')
  const o = raw as Record<string, unknown>
  const key = checkString(o.key, path, 'key')
  const operator = checkThresholdOperator(o.operator, `${path}.operator`)
  const unit = checkString(o.unit, path, 'unit')
  if (typeof o.autoGrade !== 'boolean') fail(`${path}.autoGrade`, 'must be a boolean')

  let byLaw: Record<string, TemplateMeasurementByLawEntry> | undefined
  if (o.byLaw !== undefined) {
    if (!isPlainObject(o.byLaw)) fail(`${path}.byLaw`, 'must be an object keyed by LawReference code')
    byLaw = {}
    for (const [lawCode, entry] of Object.entries(o.byLaw)) {
      byLaw[lawCode] = parseByLawEntry(entry, `${path}.byLaw.${lawCode}`, operator)
    }
  }

  let inputs: TemplateMeasurementInput[] | undefined
  let tiers: TemplateTier[] | undefined
  let value: number | undefined
  let value2: number | undefined

  if (operator === 'tiered') {
    if (!Array.isArray(o.inputs) || o.inputs.length < 2) fail(`${path}.inputs`, 'tiered operator requires at least 2 inputs (basis, provided)')
    inputs = (o.inputs as unknown[]).map((inp, i) => parseMeasurementInput(inp, `${path}.inputs[${i}]`))
    if (o.tiers !== undefined) tiers = parseTiers(o.tiers, `${path}.tiers`)
    if (!tiers && !byLaw) fail(path, 'tiered measurement requires flat tiers or byLaw')
  } else {
    // `null` is accepted as equivalent to absent, NOT rejected: parseMeasurement itself emits
    // `value: value ?? null` below, so a measurement whose value comes only from `byLaw` round-
    // trips as an explicit null. applyEraOverrides re-validates its own merged output through
    // parseTemplateDefinition, so rejecting null here made every byLaw-only override throw
    // "$.….value: must be a number" — i.e. era overrides could never be applied at all for the
    // ordinary gte/lte/range shapes. (The single committed override file, era_overrides_rail.json,
    // is `tiered`, the one operator whose branch above skips this check, which is why the bug
    // stayed invisible until Session F3, Part G wired the remaining modes up.)
    if (o.value !== undefined && o.value !== null) {
      value = typeof o.value === 'number' ? o.value : fail(`${path}.value`, 'must be a number')
    }
    if (operator === 'range' && value !== undefined && typeof o.value2 !== 'number') {
      fail(`${path}.value2`, 'range operator requires numeric value2')
    }
    if (typeof o.value2 === 'number') value2 = o.value2
    if (value === undefined && !byLaw) fail(`${path}.value`, 'must be a number (or supplied via byLaw)')
  }

  return {
    key,
    operator,
    value: value ?? null,
    value2: value2 ?? null,
    tiers,
    inputs,
    unit,
    byLaw,
    sourceText: typeof o.sourceText === 'string' ? o.sourceText : undefined,
    note: typeof o.note === 'string' ? o.note : undefined,
    autoGrade: o.autoGrade as boolean,
    extracted: typeof o.extracted === 'boolean' ? o.extracted : undefined,
    confirmed: typeof o.confirmed === 'boolean' ? o.confirmed : undefined,
  }
}

function parseThreshold(raw: unknown, path: string): TemplateThreshold {
  if (!isPlainObject(raw)) fail(path, 'threshold must be an object')
  const o = raw as Record<string, unknown>
  const operator = checkThresholdOperator(o.operator, `${path}.operator`)
  if (typeof o.value !== 'number') fail(`${path}.value`, 'must be a number')
  const unit = checkString(o.unit, path, 'unit')
  if (typeof o.autoGrade !== 'boolean') fail(`${path}.autoGrade`, 'must be a boolean')
  return {
    operator,
    value: o.value as number,
    value2: typeof o.value2 === 'number' ? o.value2 : null,
    unit,
    autoGrade: o.autoGrade as boolean,
  }
}

function parseNode(raw: unknown, path: string): TemplateNode {
  if (!isPlainObject(raw)) fail(path, 'node must be an object')
  const o = raw as Record<string, unknown>
  const code = checkString(o.code, path, 'code')
  const labelTh = checkString(o.labelTh, path, 'labelTh')

  const hasSubItems = o.subItems !== undefined
  let subItems: TemplateNode[] | undefined
  if (hasSubItems) {
    if (!Array.isArray(o.subItems)) fail(`${path}.subItems`, 'must be an array')
    subItems = (o.subItems as unknown[]).map((s, i) => parseNode(s, `${path}.subItems[${i}]`))
    if (subItems.length === 0) subItems = undefined
  }

  const node: TemplateNode = { code, labelTh }
  if (typeof o.num === 'string') node.num = o.num

  // A node is NOT strictly container-XOR-leaf: real converted data has criteria that are
  // themselves directly answerable (their own answerType) AND carry finer-grained subItems below
  // them (e.g. air template "โถส้วม" B4.1-7: answerType 'presence' of its own, plus two
  // presence_standard+measurements sub-criteria B4.1-7.1/7.2). Both are validated when present;
  // a node must carry at least one of {answerType, subItems} — never neither.
  if (subItems) node.subItems = subItems

  if (o.answerType !== undefined) {
    const at = o.answerType
    if (at !== 'choice' && at !== 'presence' && at !== 'presence_standard') {
      fail(`${path}.answerType`, `must be choice|presence|presence_standard, got ${JSON.stringify(at)}`)
    }
    node.answerType = at

    if (o.choices !== undefined) {
      if (!Array.isArray(o.choices) || o.choices.some((c) => typeof c !== 'string')) {
        fail(`${path}.choices`, 'must be a string array')
      }
      node.choices = o.choices as string[]
    }
    if (o.threshold !== undefined) node.threshold = parseThreshold(o.threshold, `${path}.threshold`)
    if (o.measurements !== undefined) {
      if (!Array.isArray(o.measurements)) fail(`${path}.measurements`, 'must be an array')
      node.measurements = (o.measurements as unknown[]).map((m, i) => parseMeasurement(m, `${path}.measurements[${i}]`))
    }
    if (o.guidance !== undefined) {
      if (!isPlainObject(o.guidance)) fail(`${path}.guidance`, 'must be an object')
      node.guidance = {
        text: checkString(o.guidance.text, `${path}.guidance`, 'text'),
        reference: typeof o.guidance.reference === 'string' ? o.guidance.reference : undefined,
      }
    }
  } else if (!subItems) {
    fail(path, 'node must carry answerType, subItems, or both')
  }

  if (typeof o.facilityCode === 'number') node.facilityCode = o.facilityCode
  if (Array.isArray(o.lawRefs)) node.lawRefs = o.lawRefs as string[]
  if (typeof o.cabinetResolution === 'boolean') node.cabinetResolution = o.cabinetResolution
  if (typeof o.beyondLaw === 'boolean') node.beyondLaw = o.beyondLaw
  if (o.imageKeys !== undefined) {
    if (!Array.isArray(o.imageKeys) || o.imageKeys.some((k) => typeof k !== 'string')) {
      fail(`${path}.imageKeys`, 'must be a string array')
    }
    node.imageKeys = o.imageKeys as string[]
  }
  if (typeof o.childSeq === 'number') node.childSeq = o.childSeq
  if (typeof o.hidden === 'boolean') node.hidden = o.hidden
  if (typeof o.conflictSplitAcknowledged === 'boolean') node.conflictSplitAcknowledged = o.conflictSplitAcknowledged
  if (typeof o.standalone === 'boolean') node.standalone = o.standalone
  if (typeof o.masterId === 'string') node.masterId = o.masterId
  if (typeof o.detachedFromMasterId === 'string') node.detachedFromMasterId = o.detachedFromMasterId

  return node
}

function parseGroup(raw: unknown, path: string): ChecklistTemplateGroupDef {
  if (!isPlainObject(raw)) fail(path, 'group must be an object')
  const o = raw as Record<string, unknown>
  const code = checkString(o.code, path, 'code')
  const labelTh = checkString(o.labelTh, path, 'labelTh')
  if (!Array.isArray(o.items)) fail(`${path}.items`, 'must be an array')
  const items = (o.items as unknown[]).map((it, i) => parseNode(it, `${path}.items[${i}]`))
  // Session F3, Part C.1 — additive: absent stays absent (never serialized back as `false`), so
  // every pre-F3 template still round-trips byte-identically through the admin editor.
  if (o.optional !== undefined && typeof o.optional !== 'boolean') {
    fail(`${path}.optional`, 'must be a boolean when present')
  }
  if (o.childSeq !== undefined && typeof o.childSeq !== 'number') {
    fail(`${path}.childSeq`, 'must be a number when present')
  }
  return {
    code,
    labelTh,
    ...(o.optional === true && { optional: true as const }),
    ...(typeof o.childSeq === 'number' && { childSeq: o.childSeq }),
    items,
  }
}

const VALID_MODES: readonly string[] = ['ทางบก', 'ทางราง', 'ทางน้ำ', 'ทางอากาศ']

// Runtime validator for a ChecklistTemplate.definition JSON blob. Accepts both the v1 parity
// shape (schemaVersion 1, flat items, answerType 'choice') and the v2 shape loaded verbatim from
// apps/docs/Checklist_Utils/template_*_v2.json (schemaVersion 2, nested subItems, presence /
// presence_standard leaves, optional measurements[]). Throws ChecklistTemplateValidationError
// with a path-qualified message on any mismatch — callers should let it propagate (seed scripts
// fail loudly; this is not meant to silently coerce bad data).
export function parseTemplateDefinition(json: unknown): ChecklistTemplateDefinition {
  if (!isPlainObject(json)) fail('$', 'definition must be an object')
  const o = json as Record<string, unknown>
  if (o.schemaVersion !== 1 && o.schemaVersion !== 2) {
    fail('$.schemaVersion', `must be 1 or 2, got ${JSON.stringify(o.schemaVersion)}`)
  }
  const mode = checkString(o.mode, '$.mode', 'mode')
  if (!VALID_MODES.includes(mode)) fail('$.mode', `unknown TransportMode ${JSON.stringify(mode)}`)
  if (!Array.isArray(o.groups)) fail('$.groups', 'must be an array')

  const groups = (o.groups as unknown[]).map((g, i) => parseGroup(g, `$.groups[${i}]`))

  return {
    schemaVersion: o.schemaVersion,
    mode: mode as TransportMode,
    answerTypes: isPlainObject(o.answerTypes) ? (o.answerTypes as Record<string, string>) : undefined,
    source: typeof o.source === 'string' ? o.source : undefined,
    provisional: typeof o.provisional === 'boolean' ? o.provisional : undefined,
    groups,
  }
}

// Depth-first leaf walk — a "leaf" is any node carrying its own answerType, i.e. directly
// answerable. Most nodes are answerable-XOR-container, but some real criteria are both (their
// own answerType AND finer subItems below them — see the hybrid-node note in parseNode above):
// such a node is itself a leaf AND its children are walked too, so nothing is double-dropped or
// silently skipped. Used by both the facility-catalog tagging pass (Part A2.4) and scoring
// (Part E) so "what counts as a leaf" is defined exactly once.
export function walkTemplateLeaves(def: ChecklistTemplateDefinition): TemplateNode[] {
  const leaves: TemplateNode[] = []
  const visit = (node: TemplateNode) => {
    if (node.answerType) leaves.push(node)
    if (node.subItems) {
      for (const child of node.subItems) visit(child)
    }
  }
  for (const g of def.groups) {
    for (const item of g.items) visit(item)
  }
  return leaves
}

// Depth-first index of EVERY node in the tree, keyed by `code` — unlike walkTemplateLeaves, this
// includes containers (criteria/sub-criteria with no answerType of their own), since codes are
// unique across the whole template version (DATA_DICTIONARY_v2.md §1), not just among leaves.
// Used by the admin template editor (W2-S3a) to locate a specific node for an in-place edit —
// mirrors era-overrides.ts's internal indexLeavesByCode but generalized to any node.
export function indexTemplateNodesByCode(def: ChecklistTemplateDefinition): Map<string, TemplateNode> {
  const index = new Map<string, TemplateNode>()
  const visit = (node: TemplateNode) => {
    index.set(node.code, node)
    if (node.subItems) for (const child of node.subItems) visit(child)
  }
  for (const g of def.groups) {
    for (const item of g.items) visit(item)
  }
  return index
}
