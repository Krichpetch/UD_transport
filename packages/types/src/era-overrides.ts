// E-form redesign (Session E2, Part A.4) — merges per-mode era_overrides_{mode}.json files onto
// the base v2 template seeds. See apps/docs/Checklist_Utils/era_overrides_rail.json's `_readme`
// for the file format this validates against.
//
// Deliberately dumb: a named leaf's `measurements[]` array is REPLACED wholesale (never merged
// field-by-field) — the override file is the single source of truth for that leaf's measurements
// once it has an entry. Idempotent by construction (a full replace, re-applied, yields the same
// result) and refuses unknown leaf codes loudly rather than silently dropping them, since a typo
// in a leaf code would otherwise leave a criterion silently ungraded by era.
import type { ChecklistTemplateDefinition, TemplateNode } from './checklist-template.js'
import { parseMeasurement, parseTemplateDefinition } from './checklist-template.js'

export class EraOverrideError extends Error {}

interface OverridesFile {
  overrides?: Record<string, { measurements?: unknown[] }>
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function indexLeavesByCode(def: ChecklistTemplateDefinition): Map<string, TemplateNode> {
  const index = new Map<string, TemplateNode>()
  const visit = (node: TemplateNode) => {
    index.set(node.code, node)
    if (node.subItems) for (const child of node.subItems) visit(child)
  }
  for (const g of def.groups) for (const item of g.items) visit(item)
  return index
}

// Applies `overridesJson` (the parsed contents of an era_overrides_{mode}.json file) onto `def`,
// returning a NEW ChecklistTemplateDefinition — `def` itself is never mutated. Missing/empty
// `overrides` is a no-op (mirrors the "missing file for a mode = no-op" caller contract — an
// empty overrides object inside a present file behaves the same way). Throws EraOverrideError,
// naming the offending code, if an override targets a leaf code the template doesn't have.
export function applyEraOverrides(def: ChecklistTemplateDefinition, overridesJson: unknown): ChecklistTemplateDefinition {
  if (!isPlainObject(overridesJson)) throw new EraOverrideError('overrides file must be a JSON object')
  const file = overridesJson as OverridesFile
  if (!file.overrides || Object.keys(file.overrides).length === 0) return def

  // Deep clone via round-trip so we never mutate the caller's `def` — the same trees get
  // re-validated below anyway (parseTemplateDefinition), so the extra serialize is not wasted.
  const clone: ChecklistTemplateDefinition = JSON.parse(JSON.stringify(def))
  const leafIndex = indexLeavesByCode(clone)

  for (const [leafCode, override] of Object.entries(file.overrides)) {
    const leaf = leafIndex.get(leafCode)
    if (!leaf) {
      throw new EraOverrideError(`era override targets unknown leaf code "${leafCode}" for template mode ${def.mode}`)
    }
    if (!Array.isArray(override.measurements)) {
      throw new EraOverrideError(`era override for leaf "${leafCode}" must supply a measurements array`)
    }
    leaf.measurements = override.measurements.map((m, i) => parseMeasurement(m, `overrides.${leafCode}.measurements[${i}]`))
  }

  // Re-validate the whole merged tree — cheap, and catches a hand-edited overrides file that
  // produced a structurally invalid template (e.g. a leaf that now carries no answerType at all).
  return parseTemplateDefinition(clone)
}
