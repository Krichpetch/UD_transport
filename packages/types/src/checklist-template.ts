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

export type ThresholdOperator = 'gte' | 'lte' | 'range'

// A single numeric criterion attached to a presence_standard leaf (DATA_DICTIONARY_v2.md §2).
// Canonical unit is centimeters except the slope convention `ratio_1_x` (auditor enters the X of
// 1:X; larger X passes for a `gte` threshold). Stored on TEMPLATE data (admin-editable, never
// re-derives past submissions' stored answers — only how NEW/re-scored answers are graded).
export interface TemplateMeasurement {
  key: string
  operator: ThresholdOperator
  value: number
  value2?: number | null   // only meaningful for operator === 'range'
  unit: string
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

  subItems?: TemplateNode[]
}

export interface ChecklistTemplateGroupDef {
  code: string       // e.g. 'A1'
  labelTh: string
  items: TemplateNode[]
}

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
  if (v !== 'gte' && v !== 'lte' && v !== 'range') fail(path, `operator must be gte|lte|range, got ${JSON.stringify(v)}`)
  return v
}

function parseMeasurement(raw: unknown, path: string): TemplateMeasurement {
  if (!isPlainObject(raw)) fail(path, 'measurement must be an object')
  const o = raw as Record<string, unknown>
  const key = checkString(o.key, path, 'key')
  const operator = checkThresholdOperator(o.operator, `${path}.operator`)
  if (typeof o.value !== 'number') fail(`${path}.value`, 'must be a number')
  if (operator === 'range' && typeof o.value2 !== 'number') {
    fail(`${path}.value2`, 'range operator requires numeric value2')
  }
  const unit = checkString(o.unit, path, 'unit')
  if (typeof o.autoGrade !== 'boolean') fail(`${path}.autoGrade`, 'must be a boolean')
  return {
    key,
    operator,
    value: o.value as number,
    value2: typeof o.value2 === 'number' ? o.value2 : null,
    unit,
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

  return node
}

function parseGroup(raw: unknown, path: string): ChecklistTemplateGroupDef {
  if (!isPlainObject(raw)) fail(path, 'group must be an object')
  const o = raw as Record<string, unknown>
  const code = checkString(o.code, path, 'code')
  const labelTh = checkString(o.labelTh, path, 'labelTh')
  if (!Array.isArray(o.items)) fail(`${path}.items`, 'must be an array')
  const items = (o.items as unknown[]).map((it, i) => parseNode(it, `${path}.items[${i}]`))
  return { code, labelTh, items }
}

const VALID_MODES: readonly string[] = ['ทางบก', 'ทางราง', 'ทางเรือ', 'ทางอากาศ']

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
