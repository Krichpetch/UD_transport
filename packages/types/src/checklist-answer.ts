// E-form redesign (Session E1, Part B) — typed answers + parseChecklistItems.
//
// Two different shapes are in play and must not be confused:
//  - ChecklistTemplateDefinition (checklist-template.ts): the FORM, keyed by `code`/`labelTh`.
//  - StoredChecklistNode (this file): one checklist SUBMISSION's answers, keyed by `id`/`labelTh`
//    — this is the existing on-disk shape (ChecklistGroup[]/ChecklistSubItem from checklist.ts),
//    extended with optional v2 fields so old pilot rows parse completely unchanged.
import type { ChecklistValue, ChecklistPhoto } from './checklist.js'
import type { ChecklistTemplateDefinition, TemplateNode, TemplateAnswerType } from './checklist-template.js'
import { walkTemplateLeaves } from './checklist-template.js'

// The normalized "just the answer" projection of a leaf, keyed to the leaf's answerType.
export type ChecklistAnswer =
  | { kind: 'choice'; value: ChecklistValue; meetsStandard: boolean }
  | { kind: 'presence'; present: boolean | null }
  | { kind: 'presence_standard'; present: boolean | null; meetsStandard: boolean | null; values?: Record<string, number> }

// One node of a stored checklist's items tree. v1 rows (today's pilot data) only ever populate
// {id, labelTh, value, meetsStandard, cabinetPriority, note, photos, flagged, reviewFlag} — every
// v2 field below is optional and simply absent on those rows.
export interface StoredChecklistNode {
  id: string
  labelTh: string

  // Denormalized from the template at answer time so scoring is self-describing and never needs
  // a template lookup for the common case (Part E). Absent = legacy v1 row, defaults to 'choice'.
  answerType?: TemplateAnswerType

  // v1 (choice) leaf fields
  value?: ChecklistValue
  meetsStandard?: boolean
  cabinetPriority?: boolean

  // v2 (presence / presence_standard) leaf fields
  present?: boolean | null
  values?: Record<string, number>

  // shared, all leaves
  note?: string
  photos?: ChecklistPhoto[]
  flagged?: boolean
  reviewFlag?: boolean

  subItems?: StoredChecklistNode[]
}

export interface ParsedChecklistGroup {
  groupId: string
  groupName: string
  items: StoredChecklistNode[]
}

export class ChecklistItemsParseError extends Error {
  constructor(message: string, public path: string) {
    super(`${path}: ${message}`)
    this.name = 'ChecklistItemsParseError'
  }
}

function fail(path: string, message: string): never {
  throw new ChecklistItemsParseError(message, path)
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

const CHECKLIST_VALUES: readonly (ChecklistValue)[] = ['มี', 'ไม่มี', 'N/A', null]

function parseStoredNode(raw: unknown, path: string): StoredChecklistNode {
  if (!isPlainObject(raw)) fail(path, 'item must be an object')
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || o.id.length === 0) fail(path, 'missing id')
  if (typeof o.labelTh !== 'string') fail(path, 'missing labelTh')

  const node: StoredChecklistNode = { id: o.id, labelTh: o.labelTh }

  if (o.answerType !== undefined) {
    if (o.answerType !== 'choice' && o.answerType !== 'presence' && o.answerType !== 'presence_standard') {
      fail(`${path}.answerType`, `must be choice|presence|presence_standard, got ${JSON.stringify(o.answerType)}`)
    }
    node.answerType = o.answerType
  }

  if (o.subItems !== undefined) {
    if (!Array.isArray(o.subItems)) fail(`${path}.subItems`, 'must be an array')
    node.subItems = (o.subItems as unknown[]).map((s, i) => parseStoredNode(s, `${path}.subItems[${i}]`))
  }

  if (o.value !== undefined) {
    if (!CHECKLIST_VALUES.includes(o.value as ChecklistValue)) fail(`${path}.value`, `invalid ChecklistValue ${JSON.stringify(o.value)}`)
    node.value = o.value as ChecklistValue
  }
  if (o.meetsStandard !== undefined) {
    if (typeof o.meetsStandard !== 'boolean') fail(`${path}.meetsStandard`, 'must be a boolean')
    node.meetsStandard = o.meetsStandard
  }
  if (o.present !== undefined) {
    if (o.present !== null && typeof o.present !== 'boolean') fail(`${path}.present`, 'must be a boolean or null')
    node.present = o.present as boolean | null
  }
  if (o.values !== undefined) {
    if (!isPlainObject(o.values) || Object.values(o.values).some((v) => typeof v !== 'number')) {
      fail(`${path}.values`, 'must be a map of string -> number')
    }
    node.values = o.values as Record<string, number>
  }
  if (typeof o.cabinetPriority === 'boolean') node.cabinetPriority = o.cabinetPriority
  if (typeof o.note === 'string') node.note = o.note
  if (Array.isArray(o.photos)) node.photos = o.photos as ChecklistPhoto[]
  if (typeof o.flagged === 'boolean') node.flagged = o.flagged
  if (typeof o.reviewFlag === 'boolean') node.reviewFlag = o.reviewFlag

  return node
}

function parseStoredGroup(raw: unknown, path: string): ParsedChecklistGroup {
  if (!isPlainObject(raw)) fail(path, 'group must be an object')
  const o = raw as Record<string, unknown>
  if (typeof o.groupId !== 'string') fail(`${path}.groupId`, 'missing groupId')
  if (typeof o.groupName !== 'string') fail(`${path}.groupName`, 'missing groupName')
  if (!Array.isArray(o.items)) fail(`${path}.items`, 'must be an array')
  return {
    groupId: o.groupId,
    groupName: o.groupName,
    items: (o.items as unknown[]).map((it, i) => parseStoredNode(it, `${path}.items[${i}]`)),
  }
}

// Runtime-guarded parser for a Checklist.items JSON blob. Structurally validates the tree and
// throws ChecklistItemsParseError with a path-qualified message on any mismatch — callers that
// need read-path resilience against pre-existing malformed rows (dashboards aggregating across
// many historical checklists) should catch-and-skip explicitly; this function itself never
// silently coerces bad data. `templateDef` is accepted for future code-cross-checking (Part C
// submit validation uses it to reject unknown codes) but is optional — old pilot rows parse with
// no template at all, exactly as they do today.
export function parseChecklistItems(json: unknown, templateDef?: ChecklistTemplateDefinition): ParsedChecklistGroup[] {
  if (!Array.isArray(json)) fail('$', 'items must be an array of groups')
  const groups = json.map((g, i) => parseStoredGroup(g, `$[${i}]`))

  if (templateDef) {
    const knownCodes = new Set(walkTemplateLeaves(templateDef).map((n: TemplateNode) => n.code))
    // A node may be answerable (checked against knownCodes) AND still have subItems below it —
    // see the hybrid-node note in checklist-template.ts#parseNode / walkTemplateLeaves — so both
    // checks run independently rather than one excluding the other.
    const flatten = (nodes: StoredChecklistNode[], path: string): void => {
      nodes.forEach((n, i) => {
        const isAnswerable = n.value !== undefined || n.present !== undefined || n.answerType !== undefined
        if (isAnswerable && !knownCodes.has(n.id)) {
          fail(`${path}[${i}].id`, `unknown item code ${JSON.stringify(n.id)} for this template`)
        }
        if (n.subItems && n.subItems.length > 0) flatten(n.subItems, `${path}[${i}].subItems`)
      })
    }
    groups.forEach((g, i) => flatten(g.items, `$[${i}].items`))
  }

  return groups
}
