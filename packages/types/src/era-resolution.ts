// E-form redesign (Session E2, Part A) — build-year -> law-era resolution.
//
// Two mechanisms described in DATA_DICTIONARY_v2.md's "Era-dependent criteria" section:
//   1. resolveEra: pure lookup — given a station's build year and a set of candidate
//      LawReference codes (one `byLaw` group), picks which law's values apply.
//   2. resolveTemplateEras: walks a whole ChecklistTemplateDefinition and flattens every
//      `byLaw`-wrapped measurement to its resolved (era-independent) value/value2/tiers, so a
//      client (or the scoring path) never sees or picks between eras — see checklist-template.ts.
//
// Resolution rule: for each byLaw group, pick the latest law whose effective year is <= the
// station's build year. "Effective year" is LawReference.effectiveYear when set, falling back to
// buddhistYear — see the TODO below; every LawReference row currently seeded has effectiveYear
// null, so resolution is provisional today by construction, not by exception.
import type {
  ChecklistTemplateDefinition,
  TemplateMeasurement,
  TemplateNode,
  ChecklistTemplateGroupDef,
} from './checklist-template.js'
import { LAW_REFERENCE_SEED } from './facility-catalog.js'

export interface EraResolution {
  lawCode: string
  eraUnresolved: boolean
}

// Structural subset of LawReferenceSeed (and of a DB-backed LawReference row, whose `code` is a
// plain string, not the closed LawReferenceCode union) — deliberately loose so a future
// DB-sourced registry doesn't need to satisfy the seed-data union type.
export interface EraLawRef {
  code: string
  buddhistYear: number
  effectiveYear?: number | null
}

export class EraResolutionError extends Error {}

// TODO(snk-effective-years): replace the buddhistYear fallback once สนข. supplies real
// enforcement dates for every LawReference row (LawReference.effectiveYear).
function lawYear(law: EraLawRef): number {
  return law.effectiveYear ?? law.buddhistYear
}

// Pure function — no DB access, no template awareness. `registry` defaults to the shared seed
// data so callers don't need to thread it through, but tests / a future DB-backed registry can
// override it.
export function resolveEra(
  yearBuilt: number | null | undefined,
  candidateLawCodes: readonly string[],
  registry: readonly EraLawRef[] = LAW_REFERENCE_SEED,
): EraResolution {
  const candidates = registry
    .filter((l) => candidateLawCodes.includes(l.code))
    .map((l) => ({ code: l.code, year: lawYear(l) }))
    .sort((a, b) => a.year - b.year)

  if (candidates.length === 0) {
    throw new EraResolutionError(`no LawReference in the registry matches any of [${candidateLawCodes.join(', ')}]`)
  }

  // Unknown build year: latest (most current) law applies, but flagged provisional — the auditor
  // hasn't supplied a year yet, so this is a best guess, not a resolved fact.
  if (yearBuilt == null) {
    const latest = candidates[candidates.length - 1]!
    return { lawCode: latest.code, eraUnresolved: true }
  }

  let picked: { code: string; year: number } | null = null
  for (const c of candidates) {
    if (c.year <= yearBuilt) picked = c
  }
  // Build year predates every law in this group — apply the oldest, flagged provisional.
  if (!picked) return { lawCode: candidates[0]!.code, eraUnresolved: true }
  return { lawCode: picked.code, eraUnresolved: false }
}

export interface ResolvedTemplateResult {
  resolved: ChecklistTemplateDefinition
  // Keyed by `${leafCode}#${measurementKey}` -> the resolved LawReference.code. One entry per
  // byLaw-bearing measurement in the template.
  appliedLawRefs: Record<string, string>
  // True if ANY byLaw group in the template resolved provisionally (null year, or a year
  // predating every law in that group).
  eraUnresolved: boolean
}

function resolveMeasurement(
  m: TemplateMeasurement,
  leafCode: string,
  yearBuilt: number | null | undefined,
  registry: readonly EraLawRef[],
  appliedLawRefs: Record<string, string>,
): { measurement: TemplateMeasurement; eraUnresolved: boolean } {
  if (!m.byLaw) return { measurement: m, eraUnresolved: false }

  const { lawCode, eraUnresolved } = resolveEra(yearBuilt, Object.keys(m.byLaw), registry)
  const entry = m.byLaw[lawCode]
  if (!entry) {
    throw new EraResolutionError(`resolved law code ${lawCode} has no byLaw entry on measurement ${leafCode}#${m.key}`)
  }
  appliedLawRefs[`${leafCode}#${m.key}`] = lawCode

  // Strip byLaw from what the client sees — it never picks between eras, only the resolved
  // flat value. Fields not supplied by the resolved entry fall back to the measurement's own
  // flat value (lets a byLaw group override only some fields while others stay constant).
  const { byLaw: _byLaw, ...flat } = m
  return {
    measurement: {
      ...flat,
      value: entry.value !== undefined ? entry.value : m.value,
      value2: entry.value2 !== undefined ? entry.value2 : m.value2,
      tiers: entry.tiers !== undefined ? entry.tiers : m.tiers,
    },
    eraUnresolved,
  }
}

function resolveNode(
  node: TemplateNode,
  yearBuilt: number | null | undefined,
  registry: readonly EraLawRef[],
  appliedLawRefs: Record<string, string>,
  unresolvedFlag: { value: boolean },
): TemplateNode {
  let measurements = node.measurements
  if (measurements) {
    measurements = measurements.map((m) => {
      const { measurement, eraUnresolved } = resolveMeasurement(m, node.code, yearBuilt, registry, appliedLawRefs)
      if (eraUnresolved) unresolvedFlag.value = true
      return measurement
    })
  }
  const subItems = node.subItems?.map((c) => resolveNode(c, yearBuilt, registry, appliedLawRefs, unresolvedFlag))
  return { ...node, ...(measurements ? { measurements } : {}), ...(subItems ? { subItems } : {}) }
}

// Walks the whole template, resolving every byLaw-wrapped measurement against `yearBuilt`.
// Non-era-varying measurements (the ~95% majority, per the data dictionary) pass through
// untouched. Safe to call with yearBuilt = null/undefined (resolves everything provisionally to
// the latest law in each group, per resolveEra).
export function resolveTemplateEras(
  def: ChecklistTemplateDefinition,
  yearBuilt: number | null | undefined,
  registry: readonly EraLawRef[] = LAW_REFERENCE_SEED,
): ResolvedTemplateResult {
  const appliedLawRefs: Record<string, string> = {}
  const unresolvedFlag = { value: false }
  const groups: ChecklistTemplateGroupDef[] = def.groups.map((g) => ({
    ...g,
    items: g.items.map((item) => resolveNode(item, yearBuilt, registry, appliedLawRefs, unresolvedFlag)),
  }))
  return {
    resolved: { ...def, groups },
    appliedLawRefs,
    eraUnresolved: unresolvedFlag.value,
  }
}

// ---- Item applicability by build year ("redaction") ----------------------------------------
//
// Separate from resolveTemplateEras above: that function keeps every leaf but swaps VALUES
// (byLaw-wrapped measurement thresholds) per era. This section instead REMOVES leaves entirely
// when a station's build year predates every law that would require them (product decision:
// "hide the item entirely" — items literally exist/vanish per era, not merely marked N/A).
//
// A leaf survives filtering when ANY of these holds:
//   - yearBuilt is null/undefined (no year captured yet — never hide without a year to judge by)
//   - it carries no lawRefs at all (untagged — no data to filter on, fail open)
//   - one of its lawRefs is 'PROJECT', or it's flagged beyondLaw — these are not กฎกระทรวง
//     requirements at all (the สนข. project checklist superset / beyond-law additions), so they
//     are never era-gated
//   - at least one of its lawRefs is a law already in force (lawYear <= yearBuilt)
//   - one of its lawRefs is a code missing from the registry entirely — fails open (missing
//     registry data is a data-quality gap, not grounds to hide a real checklist item)
function isItemApplicable(
  node: TemplateNode,
  yearBuilt: number | null | undefined,
  registry: readonly EraLawRef[],
): boolean {
  if (yearBuilt == null) return true
  if (!node.lawRefs || node.lawRefs.length === 0) return true
  if (node.beyondLaw || node.lawRefs.includes('PROJECT')) return true
  return node.lawRefs.some((code) => {
    const law = registry.find((l) => l.code === code)
    if (!law) return true
    return lawYear(law) <= yearBuilt
  })
}

// Recurses depth-first. An answerable node (own answerType) whose own applicability fails is
// dropped WHOLESALE — its subItems go with it, since a criterion that doesn't apply makes its
// finer sub-criteria moot too. A pure container (no own answerType) survives only if at least one
// child survived filtering; left with none, it is pruned as well (an empty container conveys
// nothing to the auditor). facilityCode/lawRefs are only ever tagged onto LEAVES (see
// seed-templates.ts#tagLeaves), so containers are never filtered directly, only as a consequence
// of their children.
function filterNodeApplicability(
  node: TemplateNode,
  yearBuilt: number | null | undefined,
  registry: readonly EraLawRef[],
): TemplateNode | null {
  if (node.answerType && !isItemApplicable(node, yearBuilt, registry)) return null

  const result: TemplateNode = { ...node }
  if (node.subItems) {
    const survivors = node.subItems
      .map((c) => filterNodeApplicability(c, yearBuilt, registry))
      .filter((c): c is TemplateNode => c !== null)
    if (survivors.length > 0) {
      result.subItems = survivors
    } else if (!node.answerType) {
      // Pure container, every child filtered out — nothing left to show under this heading.
      return null
    } else {
      delete result.subItems
    }
  }
  return result
}

// Filters a whole template's groups/items by build-year applicability (see above). Groups left
// with zero items after filtering are dropped too. Safe to call with yearBuilt = null/undefined —
// resolves to a no-op (isItemApplicable fails open on an unknown year).
export function filterApplicableItems(
  def: ChecklistTemplateDefinition,
  yearBuilt: number | null | undefined,
  registry: readonly EraLawRef[] = LAW_REFERENCE_SEED,
): ChecklistTemplateDefinition {
  const groups: ChecklistTemplateGroupDef[] = def.groups
    .map((g) => {
      const items = g.items
        .map((item) => filterNodeApplicability(item, yearBuilt, registry))
        .filter((n): n is TemplateNode => n !== null)
      return items.length > 0 ? { ...g, items } : null
    })
    .filter((g): g is ChecklistTemplateGroupDef => g !== null)
  return { ...def, groups }
}

// Station.yearBuilt sanity range (Buddhist year) — 2400 is well before any UD-transport
// infrastructure in Thailand; current+1 allows for stations under construction/imminent opening.
export const YEAR_BUILT_MIN = 2400

export function yearBuiltMax(now: Date = new Date()): number {
  return now.getFullYear() + 543 + 1
}

export function isValidYearBuilt(yearBuilt: number, now: Date = new Date()): boolean {
  return Number.isInteger(yearBuilt) && yearBuilt >= YEAR_BUILT_MIN && yearBuilt <= yearBuiltMax(now)
}
