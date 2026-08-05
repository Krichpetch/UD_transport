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
// buddhistYear — see the TODO below. As of 2026-08-05, PSD_2555/MOT_2556/MHT_2564 carry real
// effectiveYear values (see facility-catalog.ts); MHT_2548 still falls back to its buddhistYear
// pending an exact enforcement date.
import type {
  ChecklistTemplateDefinition,
  TemplateMeasurement,
  TemplateNode,
  ChecklistTemplateGroupDef,
} from './checklist-template.js'
import { LAW_REFERENCE_SEED, FACILITY_CATALOG } from './facility-catalog.js'

// Session F3, Part D — facility codes flagged neverEraGated in FACILITY_CATALOG (today: 5,
// พื้นผิวต่างสัมผัส / tactile of every kind). Precomputed once rather than scanning the catalog per
// leaf, since isItemApplicable runs over every node of every template resolution.
const NEVER_ERA_GATED_FACILITY_CODES: ReadonlySet<number> = new Set(
  FACILITY_CATALOG.filter((e) => e.neverEraGated).map((e) => e.code),
)

// Session F3, Part D — is this node exempt from build-year redaction by its facility type?
// Exported so the admin lawRefs editor can show an admin WHY an item never redacts (read-only
// indicator — the flag itself is catalog data, not admin-editable).
export function isNeverEraGated(facilityCode: number | undefined | null): boolean {
  return facilityCode != null && NEVER_ERA_GATED_FACILITY_CODES.has(facilityCode)
}

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
  effectiveDate?: string | null   // ISO yyyy-mm-dd, Gregorian — see facility-catalog.ts
}

export class EraResolutionError extends Error {}

// TODO(snk-effective-years): replace the buddhistYear fallback once สนข. supplies real
// enforcement dates for every LawReference row (LawReference.effectiveYear).
function lawYear(law: EraLawRef): number {
  return law.effectiveYear ?? law.buddhistYear
}

// 2026-08-05, revised same day after PM review — a station's build "instant" is now either a
// Buddhist YEAR (as always) or, when the auditor captured it, a Gregorian MONTH (Station.
// yearBuiltDate — the PM decided month/year precision is enough, day-of-month is not asked for).
// Compares a law's enforcement start against whichever precision the station actually has,
// TRUNCATED TO MONTH (`yyyy-mm`, the first 7 chars of the ISO string) on both sides — the exact
// day either one carries (if any) is deliberately ignored, never compared. This is what resolves
// same-Buddhist-year law collisions, e.g. PSD_2555 (16 ม.ค. 2556) vs MOT_2556 (3 เม.ย. 2556), both
// พ.ศ. 2556 (see facility-catalog.ts's file-level note): at month granularity these become "ม.ค.
// 2556" and "เม.ย. 2556" — a station the PM classifies as built มกรา-มีนา 2556 (Jan-Mar 2556, before
// MOT_2556's เม.ย. cutover) correctly lands in the PSD_2555-only bracket, exactly as ruled. Falls
// back to the pre-existing year-only comparison whenever either side lacks month precision at all.
// Never synthesizes a month that wasn't actually supplied: a yearBuilt-only station compares
// exactly as it always has, byte-for-byte.
function isLawInForce(law: EraLawRef, yearBuilt: number | null | undefined, buildDate?: string | null): boolean {
  if (buildDate && law.effectiveDate) return law.effectiveDate.slice(0, 7) <= buildDate.slice(0, 7)
  if (yearBuilt == null) return false
  return lawYear(law) <= yearBuilt
}

// Pure function — no DB access, no template awareness. `registry` defaults to the shared seed
// data so callers don't need to thread it through, but tests / a future DB-backed registry can
// override it. `buildDate` (ISO yyyy-mm-dd, Gregorian) is optional and refines resolution only
// when both it and a candidate law's effectiveDate are present — see isLawInForce.
export function resolveEra(
  yearBuilt: number | null | undefined,
  candidateLawCodes: readonly string[],
  registry: readonly EraLawRef[] = LAW_REFERENCE_SEED,
  buildDate?: string | null,
): EraResolution {
  const candidates = registry
    .filter((l) => candidateLawCodes.includes(l.code))
    .map((l) => ({ code: l.code, year: lawYear(l), law: l }))
    // Same-year ties (only possible via effectiveDate-bearing laws today) break by exact date —
    // pure tie-break, never changes order for the common case of one law per distinct year.
    .sort((a, b) => a.year - b.year || (a.law.effectiveDate ?? '').localeCompare(b.law.effectiveDate ?? ''))

  if (candidates.length === 0) {
    throw new EraResolutionError(`no LawReference in the registry matches any of [${candidateLawCodes.join(', ')}]`)
  }

  // Unknown build year: latest (most current) law applies, but flagged provisional — the auditor
  // hasn't supplied a year yet, so this is a best guess, not a resolved fact.
  if (yearBuilt == null) {
    const latest = candidates[candidates.length - 1]!
    return { lawCode: latest.code, eraUnresolved: true }
  }

  let picked: { code: string; year: number; law: EraLawRef } | null = null
  for (const c of candidates) {
    if (isLawInForce(c.law, yearBuilt, buildDate)) picked = c
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
  buildDate?: string | null,
): { measurement: TemplateMeasurement; eraUnresolved: boolean } {
  if (!m.byLaw) return { measurement: m, eraUnresolved: false }

  const { lawCode, eraUnresolved } = resolveEra(yearBuilt, Object.keys(m.byLaw), registry, buildDate)
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
  buildDate?: string | null,
): TemplateNode {
  let measurements = node.measurements
  if (measurements) {
    measurements = measurements.map((m) => {
      const { measurement, eraUnresolved } = resolveMeasurement(m, node.code, yearBuilt, registry, appliedLawRefs, buildDate)
      if (eraUnresolved) unresolvedFlag.value = true
      return measurement
    })
  }
  const subItems = node.subItems?.map((c) => resolveNode(c, yearBuilt, registry, appliedLawRefs, unresolvedFlag, buildDate))
  return { ...node, ...(measurements ? { measurements } : {}), ...(subItems ? { subItems } : {}) }
}

// Walks the whole template, resolving every byLaw-wrapped measurement against `yearBuilt`.
// Non-era-varying measurements (the ~95% majority, per the data dictionary) pass through
// untouched. Safe to call with yearBuilt = null/undefined (resolves everything provisionally to
// the latest law in each group, per resolveEra). `buildDate` (ISO yyyy-mm-dd, Gregorian) is
// optional — only refines resolution where a candidate law also carries an effectiveDate.
export function resolveTemplateEras(
  def: ChecklistTemplateDefinition,
  yearBuilt: number | null | undefined,
  registry: readonly EraLawRef[] = LAW_REFERENCE_SEED,
  buildDate?: string | null,
): ResolvedTemplateResult {
  const appliedLawRefs: Record<string, string> = {}
  const unresolvedFlag = { value: false }
  const groups: ChecklistTemplateGroupDef[] = def.groups.map((g) => ({
    ...g,
    items: g.items.map((item) => resolveNode(item, yearBuilt, registry, appliedLawRefs, unresolvedFlag, buildDate)),
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
//   - Session F3, Part D: its facility type is flagged neverEraGated (tactile surfaces / Guiding
//     Block). Distinct from the beyondLaw case above — these items ARE in law, they are just not
//     gated by build year — which is why it is a separate flag and a separate clause, not a
//     beyondLaw reuse (see FacilityCatalogEntry.neverEraGated)
//   - at least one of its lawRefs is a law already in force (lawYear <= yearBuilt)
//   - one of its lawRefs is a code missing from the registry entirely — fails open (missing
//     registry data is a data-quality gap, not grounds to hide a real checklist item)
function isItemApplicable(
  node: TemplateNode,
  yearBuilt: number | null | undefined,
  registry: readonly EraLawRef[],
  buildDate?: string | null,
): boolean {
  if (yearBuilt == null) return true
  // Session F3, Part D — checked BEFORE the lawRefs tests: a neverEraGated facility survives every
  // build year precisely BECAUSE of what it is, regardless of how completely it is law-tagged.
  if (isNeverEraGated(node.facilityCode)) return true
  if (!node.lawRefs || node.lawRefs.length === 0) return true
  if (node.beyondLaw || node.lawRefs.includes('PROJECT')) return true
  return node.lawRefs.some((code) => {
    const law = registry.find((l) => l.code === code)
    if (!law) return true
    return isLawInForce(law, yearBuilt, buildDate)
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
  buildDate?: string | null,
): TemplateNode | null {
  if (node.answerType && !isItemApplicable(node, yearBuilt, registry, buildDate)) return null

  const result: TemplateNode = { ...node }
  if (node.subItems) {
    const survivors = node.subItems
      .map((c) => filterNodeApplicability(c, yearBuilt, registry, buildDate))
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
  buildDate?: string | null,
): ChecklistTemplateDefinition {
  const groups: ChecklistTemplateGroupDef[] = def.groups
    .map((g) => {
      const items = g.items
        .map((item) => filterNodeApplicability(item, yearBuilt, registry, buildDate))
        .filter((n): n is TemplateNode => n !== null)
      return items.length > 0 ? { ...g, items } : null
    })
    .filter((g): g is ChecklistTemplateGroupDef => g !== null)
  return { ...def, groups }
}

// Session F1, Part C — MARKS applicability instead of deleting (closes the A2 gap left open by
// filterApplicableItems above, per the same isItemApplicable rule). The template-for-audit
// endpoint uses this now, not filterApplicableItems: the client stays "dumb" and admin/debug views
// can still see the full structure, with the era-gated items simply flagged, not removed. Scope is
// v2/v3 templates only — callers gate by schemaVersion (see checklists.service.ts), never called
// here, since this function has no template-version awareness of its own (mirrors
// filterApplicableItems, which is likewise version-agnostic and simply a no-op on v1's untagged
// nodes).
//
// Cascade: an answerable (own answerType) node whose own applicability fails forces every
// descendant leaf to `applicable: false` too, regardless of the descendant's own lawRefs — the
// same "dropped wholesale" semantics filterApplicableItems already has, just marked instead of
// removed (a criterion that doesn't apply makes its finer sub-criteria moot too). Pure containers
// (no own answerType) never carry `applicable` themselves — lawRefs/facilityCode are only ever
// tagged on leaves (see seed-templates.ts#tagLeaves) — but still propagate a forced-inapplicable
// cascade down to their children.
function markNode(
  node: TemplateNode,
  yearBuilt: number | null | undefined,
  registry: readonly EraLawRef[],
  forcedInapplicable: boolean,
  buildDate?: string | null,
): TemplateNode {
  const ownApplicable = node.answerType
    ? (!forcedInapplicable && isItemApplicable(node, yearBuilt, registry, buildDate))
    : undefined
  const childForced = forcedInapplicable || ownApplicable === false
  const subItems = node.subItems?.map((c) => markNode(c, yearBuilt, registry, childForced, buildDate))
  return {
    ...node,
    ...(node.answerType ? { applicable: ownApplicable } : {}),
    ...(subItems ? { subItems } : {}),
  }
}

export function markApplicability(
  def: ChecklistTemplateDefinition,
  yearBuilt: number | null | undefined,
  registry: readonly EraLawRef[] = LAW_REFERENCE_SEED,
  buildDate?: string | null,
): ChecklistTemplateDefinition {
  const groups: ChecklistTemplateGroupDef[] = def.groups.map((g) => ({
    ...g,
    items: g.items.map((item) => markNode(item, yearBuilt, registry, false, buildDate)),
  }))
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

// 2026-08-05 — an ISO yyyy-mm-dd (Gregorian) date's Buddhist year, i.e. the same year a Thai
// auditor would read off that same calendar date. Parsed as UTC midnight so the result never
// shifts with the server's local timezone (a date-only value has no "time of day" to begin with).
export function buddhistYearOfIsoDate(isoDate: string): number {
  return new Date(isoDate).getUTCFullYear() + 543
}

// Sanity + internal-consistency check for Station.yearBuiltDate: must be a real calendar date
// within the same overall range as yearBuilt, and — when yearBuilt is also supplied — must name
// the SAME Buddhist year as yearBuilt. A mismatch means the auditor typed a year that disagrees
// with the exact date they picked; reject rather than silently trust one over the other.
export function isValidYearBuiltDate(isoDate: string, yearBuilt?: number | null, now: Date = new Date()): boolean {
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) return false
  const impliedYear = buddhistYearOfIsoDate(isoDate)
  if (!isValidYearBuilt(impliedYear, now)) return false
  if (yearBuilt != null && impliedYear !== yearBuilt) return false
  return true
}

// Session F1 follow-up — derives the actual era BRACKETS from the real law registry, so an admin
// picking a "test build year" for preview redaction can choose a bracket by name (e.g. "ก่อน พ.ศ.
// 2548" / "2548–2554") instead of guessing a raw year and hoping it lands on the right side of an
// undocumented boundary. Each bracket's `representativeYear` is the value actually sent to
// getTemplateForAudit's yearBuiltOverride — the EARLIEST year in the bracket (so "2548–2554"
// resolves as "just barely in force," the most conservative reading of that era, not
// "practically the next era's boundary"). PROJECT (the สนข. superset, never era-gated) and any
// row missing a real buddhistYear are excluded — they don't mark a redaction boundary at all.
export interface EraYearBracket {
  label: string             // e.g. "ก่อน พ.ศ. 2548" or "พ.ศ. 2548–2554"
  representativeYear: number // the value to send as yearBuiltOverride for this bracket
  // 2026-08-05 — ISO yyyy-mm-dd (Gregorian), the value to send as a companion buildDateOverride,
  // present ONLY when this bracket's boundary law itself has an effectiveDate. Two laws can share
  // a representativeYear (PSD_2555/MOT_2556 both พ.ศ. 2556) and still be distinct brackets once
  // dates are known — see the boundary-key note below. Omitted (not null) when no exact date
  // marks this boundary, so existing year-only callers/tests are unaffected.
  representativeDate?: string
}

// Structural subset (code/buddhistYear/effectiveYear + a real-vs-PROJECT flag), same looseness
// rationale as EraLawRef above — deliberately NOT LawReferenceSeed's closed `code` union, so a
// synthetic test registry or future DB-backed registry can supply this without satisfying the
// full seed shape (nameTh/ministry aren't needed here at all).
export interface EraBracketLawRef extends EraLawRef {
  code: string
}

// A boundary's sort/dedup key, always a Gregorian ISO date string so law rows with and without an
// exact effectiveDate compare correctly against each other (mixing a raw Buddhist year like 2548
// into the same lexicographic sort as a Gregorian ISO date like 2013-01-16 would sort backwards —
// 2548 as a string outranks every real Gregorian year in this app's lifetime). Falls back to
// Jan 1 of the law's Gregorian year when no exact date is known, which preserves the pre-date
// year-level boundary/dedup behaviour exactly for every law that still only has a year.
function boundaryKey(law: EraBracketLawRef): string {
  if (law.effectiveDate) return law.effectiveDate
  const gregorianYear = (law.effectiveYear ?? law.buddhistYear) - 543
  return `${String(gregorianYear).padStart(4, '0')}-01-01`
}

export function eraYearBrackets(
  registry: readonly EraBracketLawRef[] = LAW_REFERENCE_SEED,
  now: Date = new Date(),
): EraYearBracket[] {
  // One entry per distinct boundary key — two laws sharing a key (year-only laws with the same
  // year, or a genuine same-date coincidence) collapse to one boundary, same as before dates
  // existed; two laws sharing only a Buddhist YEAR but distinct exact dates (PSD_2555/MOT_2556,
  // both พ.ศ. 2556) now correctly stay separate boundaries.
  const boundaries = [...new Map(
    registry.filter((l) => l.code !== 'PROJECT').map((l) => [boundaryKey(l), l] as const),
  ).values()].sort((a, b) => boundaryKey(a).localeCompare(boundaryKey(b)))

  if (boundaries.length === 0) return []

  const displayYear = (l: EraBracketLawRef) => l.effectiveYear ?? l.buddhistYear

  const brackets: EraYearBracket[] = [
    { label: `ก่อน พ.ศ. ${displayYear(boundaries[0]!)}`, representativeYear: YEAR_BUILT_MIN },
  ]
  for (let i = 0; i < boundaries.length; i++) {
    const law = boundaries[i]!
    const start = displayYear(law)
    const next = boundaries[i + 1] // undefined for the last (open-ended) bracket
    const end = next ? displayYear(next) : undefined
    const label = end === undefined
      ? `พ.ศ. ${start} เป็นต้นไป`
      // Same-year boundary split (e.g. PSD_2555 -> MOT_2556, both พ.ศ. 2556) — only distinguishable
      // by exact date, so name the law rather than print a backwards/empty "2556–2555" range.
      : start === end
        ? `พ.ศ. ${start} (${law.code} เป็นต้นไป)`
        : `พ.ศ. ${start}–${end - 1}`
    brackets.push({
      label,
      representativeYear: start,
      ...(law.effectiveDate ? { representativeDate: law.effectiveDate } : {}),
    })
  }
  // Clamp the very last bracket's representative year to the valid range in case `now` has
  // somehow moved earlier than the newest law's year (never realistic, but keeps this function
  // total rather than emitting a year isValidYearBuilt would reject).
  const max = yearBuiltMax(now)
  return brackets.map((b) => ({ ...b, representativeYear: Math.min(b.representativeYear, max) }))
}
