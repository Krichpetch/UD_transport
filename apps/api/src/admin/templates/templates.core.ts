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
import type { ChecklistTemplateDefinition, TemplateMeasurement, TemplateNode, TemplateTier } from '@repo/types'
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
}

export function summarizeTemplate(def: ChecklistTemplateDefinition): TemplateSummary {
  const leaves = walkTemplateLeaves(def)
  let measurementCount = 0
  let confirmedCount = 0
  for (const leaf of leaves) {
    for (const m of leaf.measurements ?? []) {
      measurementCount++
      if (m.confirmed) confirmedCount++
    }
  }
  return {
    itemCount: def.groups.reduce((sum, g) => sum + g.items.length, 0),
    leafCount: leaves.length,
    measurementCount,
    confirmedCount,
    unconfirmedCount: measurementCount - confirmedCount,
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
