// E-form redesign (Session E2, Part A.4) — merges per-mode era_overrides_{mode}.json files onto
// the base v2 template seeds. See apps/docs/Checklist_Utils/era_overrides_rail.json's `_readme`
// for the file format this validates against.
//
// Deliberately dumb: a named leaf's `measurements[]` array is REPLACED wholesale (never merged
// field-by-field) — the override file is the single source of truth for that leaf's measurements
// once it has an entry. Idempotent by construction (a full replace, re-applied, yields the same
// result) and refuses unknown leaf codes loudly rather than silently dropping them, since a typo
// in a leaf code would otherwise leave a criterion silently ungraded by era.
import type { ChecklistTemplateDefinition, TemplateLabelByLawEntry, TemplateNode } from './checklist-template.js'
import { parseMeasurement, parseTemplateDefinition } from './checklist-template.js'

export class EraOverrideError extends Error {}

interface OverridesFile {
  overrides?: Record<string, { measurements?: unknown[]; labelByLaw?: Record<string, unknown> }>
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Despite the name, indexes EVERY node (containers included), not leaves only — a container has
// no `measurements` of its own but can still be an override TARGET via `labelByLaw` (see below).
function indexLeavesByCode(def: ChecklistTemplateDefinition): Map<string, TemplateNode> {
  const index = new Map<string, TemplateNode>()
  const visit = (node: TemplateNode) => {
    index.set(node.code, node)
    if (node.subItems) for (const child of node.subItems) visit(child)
  }
  for (const g of def.groups) for (const item of g.items) visit(item)
  return index
}

function parseLabelByLawOverride(raw: Record<string, unknown>, code: string): Record<string, TemplateLabelByLawEntry> {
  const labelByLaw: Record<string, TemplateLabelByLawEntry> = {}
  for (const [lawCode, entry] of Object.entries(raw)) {
    if (!isPlainObject(entry) || typeof entry.labelTh !== 'string' || entry.labelTh.length === 0) {
      throw new EraOverrideError(`era override for "${code}" labelByLaw.${lawCode} must be an object with a non-empty labelTh string`)
    }
    labelByLaw[lawCode] = { labelTh: entry.labelTh, sourceText: typeof entry.sourceText === 'string' ? entry.sourceText : undefined }
  }
  return labelByLaw
}

// Applies `overridesJson` (the parsed contents of an era_overrides_{mode}.json file) onto `def`,
// returning a NEW ChecklistTemplateDefinition — `def` itself is never mutated. Missing/empty
// `overrides` is a no-op (mirrors the "missing file for a mode = no-op" caller contract — an
// empty overrides object inside a present file behaves the same way). Throws EraOverrideError,
// naming the offending code, if an override targets a code the template doesn't have.
//
// Each override entry supplies exactly ONE of `measurements` (leaf targets — replaces the leaf's
// measurements[] wholesale, as always) or `labelByLaw` (container-text targets — Session S5-fix
// follow-up, container-text era resolution: a node with no scored criterion of its own, only an
// era-varying case-condition heading; see TemplateLabelByLawEntry's doc in checklist-template.ts
// for why this is a separate field rather than a value-less measurement). The two are mutually
// exclusive per entry — a target is either a graded leaf or a text-only container, never both in
// this codebase today — so requiring exactly one catches a malformed override file loudly instead
// of silently picking one.
export function applyEraOverrides(def: ChecklistTemplateDefinition, overridesJson: unknown): ChecklistTemplateDefinition {
  if (!isPlainObject(overridesJson)) throw new EraOverrideError('overrides file must be a JSON object')
  const file = overridesJson as OverridesFile
  if (!file.overrides || Object.keys(file.overrides).length === 0) return def

  // Deep clone via round-trip so we never mutate the caller's `def` — the same trees get
  // re-validated below anyway (parseTemplateDefinition), so the extra serialize is not wasted.
  const clone: ChecklistTemplateDefinition = JSON.parse(JSON.stringify(def))
  const leafIndex = indexLeavesByCode(clone)

  for (const [code, override] of Object.entries(file.overrides)) {
    const node = leafIndex.get(code)
    if (!node) {
      throw new EraOverrideError(`era override targets unknown code "${code}" for template mode ${def.mode}`)
    }

    const hasMeasurements = override.measurements !== undefined
    const hasLabelByLaw = override.labelByLaw !== undefined
    if (hasMeasurements === hasLabelByLaw) {
      throw new EraOverrideError(`era override for "${code}" must supply exactly one of measurements or labelByLaw`)
    }

    if (hasLabelByLaw) {
      if (!isPlainObject(override.labelByLaw)) {
        throw new EraOverrideError(`era override for "${code}" labelByLaw must be an object keyed by LawReference code`)
      }
      // Text-only target: deliberately does NOT touch lawRefs (unlike the measurements branch
      // below) — a case-condition heading describes which of several already-applicable sibling
      // sections applies, it never asserts the CONTAINER itself came into existence under a law,
      // so there is nothing to union. Leaving lawRefs untouched is what keeps a labelByLaw-only
      // node permanently outside isItemApplicable/markApplicability's reach (both gate on
      // `answerType`, which a pure container never has), i.e. inert to redaction by construction.
      node.labelByLaw = parseLabelByLawOverride(override.labelByLaw, code)
      continue
    }

    if (!Array.isArray(override.measurements)) {
      throw new EraOverrideError(`era override for "${code}" must supply a measurements array`)
    }
    node.measurements = override.measurements.map((m, i) => parseMeasurement(m, `overrides.${code}.measurements[${i}]`))

    // A byLaw entry asserts "this law gives this item a value" — which only makes sense if the
    // item is already considered to EXIST under that law. isItemApplicable (era-resolution.ts)
    // redacts a leaf whose lawRefs are all still-future relative to a station's build year, so a
    // byLaw code missing from lawRefs is a standing contradiction: the value resolver would apply
    // that law's threshold while the redaction pass hides the item for the very same build year.
    // Union every byLaw code onto lawRefs here, once, at the one place overrides are merged in —
    // never let the two mechanisms disagree about which eras an item exists in.
    const byLawCodes = new Set<string>()
    for (const m of node.measurements) {
      if (m.byLaw) for (const lawCode of Object.keys(m.byLaw)) byLawCodes.add(lawCode)
    }
    if (byLawCodes.size > 0) {
      const existing = new Set(node.lawRefs ?? [])
      for (const lawCode of byLawCodes) existing.add(lawCode)
      node.lawRefs = [...existing]
    }
  }

  // Re-validate the whole merged tree — cheap, and catches a hand-edited overrides file that
  // produced a structurally invalid template (e.g. a leaf that now carries no answerType at all).
  return parseTemplateDefinition(clone)
}
