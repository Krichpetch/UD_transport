// Score re-derivation from stored ChecklistGroup[]-shaped JSON.
// Formula (CLAUDE.md): (ได้มาตรฐาน / eligible) × 100
// Eligible excludes: null (unanswered), N/A, and flagged bare-มี (standard not yet recorded).
// Bare มี is a data-entry gap — not a confirmed failure — so it is parked like N/A until resolved.
//
// Single source of truth: apps/api and apps/web both import this — do not reimplement the formula.
//
// ---- E-form redesign (Session E1, Part E) — subItems / v2 answer extension ----
// PARITY: every function below still accepts a flat v1 ChecklistGroup[]-shaped `items` argument
// with NO subItems and NO `templateDef`, and produces byte-identical output to before this
// session (see apps/api/src/checklists/__tests__/scoring.spec.ts, the parity anchor). The
// extension is purely additive:
//   - `items` nodes may now carry `subItems`; a node with (non-empty) subItems is a CONTAINER —
//     only leaves (no subItems) are counted. v1 rows never have subItems, so every v1 leaf is
//     counted exactly as it always was — this IS the sub-item rollup rule: scoring operates on
//     the flattened leaf population of a group, regardless of how many container levels sit above
//     a leaf. (A separate, display-only "one grade per A1.1 item" rollup is NOT built here — no
//     established 3-way item-grade vocabulary exists in this codebase yet; see final report.)
//   - a leaf's `answerType` (denormalized onto the stored node itself, defaulting to 'choice' when
//     absent — exactly what every existing v1 row already is) selects how it's classified:
//     'choice' (v1, unchanged), 'presence' (v2 มี/ไม่มี only — counts toward การจัดให้มีฯ, never
//     toward การได้มาตรฐาน, per DATA_DICTIONARY_v2.md §2), or 'presence_standard' (v2 มี/ไม่มี +
//     ได้มาตรฐาน — manual, or measured via `values` + the template's thresholds).
//   - the optional trailing `templateDef` parameter is ONLY consulted to auto-grade measured
//     presence_standard leaves (comparing stored `values` against the template's `measurements[]`
//     thresholds — re-derived every call, per DATA_DICTIONARY_v2.md §2: "store the entered
//     values, never the derived verdict"). Every existing call site omits it and is unaffected.

import type { ChecklistTemplateDefinition, TemplateMeasurement, TemplateNode, TemplateTier } from './checklist-template.js'
import { walkTemplateLeaves } from './checklist-template.js'

type TemplateAnswerKind = 'choice' | 'presence' | 'presence_standard'

interface StoredItem {
  value?: string | null
  meetsStandard?: boolean
  flagged?: boolean       // true = bare มี; standard-unspecified; excluded from denominator
  reviewFlag?: boolean    // admin "พบปัญหา" review flag — never affects scoring
  answerType?: TemplateAnswerKind
  present?: boolean | null
  values?: Record<string, number>
  subItems?: StoredItem[]
  id?: string
  // Session F1, Part C.4 — baked in once at submit time (frozen forever, see
  // StoredChecklistNode.applicable's doc); false excludes this leaf from every bucket below,
  // exactly like N/A, tracked separately (ValueHistogram.redacted) for visibility.
  applicable?: boolean
}

interface StoredGroup {
  items: StoredItem[]
}

// Tiered lookup (Session E2) — the required value for `basis` is the tier whose [min, max] band
// contains it; an open-ended top tier (`max` absent) may extend the required count every
// `incrementPer` over `min`, adding `incrementBy` each step. Returns null if `basis` falls
// outside every tier (no band covers it — treated as ungraded, not a failure).
export function tierRequiredFor(tiers: TemplateTier[], basis: number): number | null {
  const sorted = [...tiers].sort((a, b) => a.min - b.min)
  for (const t of sorted) {
    const max = t.max ?? Infinity
    if (basis < t.min || basis > max) continue
    if (t.incrementPer && t.incrementBy) {
      const extra = Math.floor((basis - t.min) / t.incrementPer) * t.incrementBy
      return t.required + extra
    }
    return t.required
  }
  return null
}

export function passesTiered(tiers: TemplateTier[], basis: number, provided: number): boolean | null {
  const required = tierRequiredFor(tiers, basis)
  if (required === null) return null
  return provided >= required
}

// gte/lte/range-inclusive/tiered comparison against a leaf's measurements[]. All autoGrade=true
// measurements on the leaf must pass. Returns null when a verdict can't be derived yet (missing
// numeric entry, an unresolved byLaw group, or every measurement on the leaf is autoGrade=false /
// guidance-only) — callers treat null like bare-มี: parked, excluded from standards eligibility,
// not a confirmed failure. `values` is keyed by measurement `key` for gte/lte/range, and by each
// `inputs[].key` (e.g. "basis"/"provided") for tiered — never prefixed by the measurement key.
export function deriveMeasuredStandard(
  measurements: TemplateMeasurement[] | undefined,
  values: Record<string, number> | undefined,
): boolean | null {
  if (!measurements || measurements.length === 0) return null
  const graded = measurements.filter(m => m.autoGrade)
  if (graded.length === 0) return null
  if (!values) return null
  for (const m of graded) {
    if (m.operator === 'tiered') {
      if (!m.tiers || !m.inputs || m.inputs.length < 2) return null // byLaw not resolved, or malformed
      const basis = values[m.inputs[0]!.key]
      const provided = values[m.inputs[1]!.key]
      if (typeof basis !== 'number' || typeof provided !== 'number') return null
      const pass = passesTiered(m.tiers, basis, provided)
      if (pass === null) return null
      if (!pass) return false
      continue
    }
    if (m.value == null) return null // byLaw not resolved
    let v: number | undefined
    if (m.unit === 'ratio_1_x' || m.unit === 'percent') {
      // Slope convention, revised 2026-08-09 (Session S4a, Part A) — pilot feedback: auditors
      // cannot physically measure a ramp's horizontal run (it's the one dimension with no fixed
      // endpoint to hook a tape on), but CAN measure the vertical rise (แนวดิ่ง) and the length
      // along the sloped surface itself (ความยาวตามแนวลาด, the hypotenuse). run is derived via
      // Pythagoras: run = sqrt(hypotenuse² − rise²), then graded exactly as before — ratio_1_x's
      // X = run ÷ rise (unchanged formula, just a derived run instead of an entered one), percent
      // = (rise ÷ run) × 100. NOT extended to unit:'degree' — see ratioRiseKey's doc.
      const rise = values[ratioRiseKey(m.key)]
      const hypotenuse = values[ratioHypotenuseKey(m.key)]
      let run: number, riseValue: number
      if (typeof rise === 'number' && typeof hypotenuse === 'number' && rise > 0 && hypotenuse > rise) {
        run = Math.sqrt(hypotenuse * hypotenuse - rise * rise)
        riseValue = rise
      } else if (typeof rise === 'number' && typeof hypotenuse === 'number') {
        // hypotenuse <= rise (or rise <= 0) is not a valid right triangle — ungraded, never NaN.
        return null
      } else {
        // Legacy fallback — checklists submitted before this redesign (2026-08-09) stored raw
        // ความยาว/ความสูง (run/rise) directly under the old key pair; re-deriving their score must
        // keep working exactly as it always did. Never used by the current auditor form, which
        // only ever writes the rise/hypotenuse keys from now on.
        const length = values[ratioLengthKey(m.key)]
        const height = values[ratioHeightKey(m.key)]
        if (typeof length !== 'number' || typeof height !== 'number' || length === 0 || height === 0) return null
        run = length
        riseValue = height
      }
      v = m.unit === 'percent' ? (riseValue / run) * 100 : run / riseValue
    } else {
      v = values[m.key]
    }
    if (typeof v !== 'number') return null
    const pass =
      m.operator === 'gte' ? v >= m.value :
      m.operator === 'lte' ? v <= m.value :
      (m.value2 != null && v >= m.value && v <= m.value2)
    if (!pass) return false
  }
  return true
}

// Slope convention, revised 2026-08-09 (Session S4a, Part A) — ความชัน measurements (unit
// 'ratio_1_x' or 'percent') are entered as raw rise/hypotenuse (mm); deriveMeasuredStandard
// derives run = sqrt(hypotenuse² − rise²) via Pythagoras, then computes run ÷ rise (ratio) or
// (rise ÷ run) × 100 (percent) and compares it against the threshold like any other gte/lte/range
// value. Keys are scoped per-measurement so two slope measurements on the same leaf (none
// currently seeded, but not structurally forbidden) can't collide. Exported so the entry form and
// the scoring path always agree on the exact key names — never two independent guesses at the
// same convention.
export function ratioRiseKey(measurementKey: string): string {
  return `${measurementKey}__rise`
}
export function ratioHypotenuseKey(measurementKey: string): string {
  return `${measurementKey}__hypotenuse`
}

// Legacy key pair (pre-2026-08-09) — the auditor form entered raw run/rise directly under these
// names (labelled ความยาว/ความสูง). Kept ONLY so deriveMeasuredStandard can still re-derive the
// score of a checklist submitted before the rise/hypotenuse redesign; never written by the current
// form. Do not use these for new capture — see ratioRiseKey/ratioHypotenuseKey above.
export function ratioLengthKey(measurementKey: string): string {
  return `${measurementKey}__length`
}
export function ratioHeightKey(measurementKey: string): string {
  return `${measurementKey}__height`
}

function buildLeafTemplateIndex(templateDef?: ChecklistTemplateDefinition): Map<string, TemplateNode> {
  const map = new Map<string, TemplateNode>()
  if (!templateDef) return map
  for (const leaf of walkTemplateLeaves(templateDef)) map.set(leaf.code, leaf)
  return map
}

// Flatten a group's items into its leaves. A node is "answerable" (counted) when it carries its
// own answer data (v1: `value` always present, even null; v2: `present` or an explicit
// `answerType`) — v1 rows never have subItems, so this is an identity walk for them, unchanged.
// A node CAN be answerable AND still have subItems below it (a criterion with its own มี/ไม่มี
// plus finer measured sub-criteria — see checklist-template.ts's hybrid-node note); both the node
// itself and its children are then counted, never one at the expense of the other.
function flattenLeaves(items: StoredItem[]): StoredItem[] {
  const leaves: StoredItem[] = []
  const visit = (it: StoredItem) => {
    const isAnswerable = it.answerType !== undefined || it.value !== undefined || it.present !== undefined
    if (isAnswerable) leaves.push(it)
    if (Array.isArray(it.subItems) && it.subItems.length > 0) {
      for (const child of it.subItems) visit(child)
    }
  }
  for (const it of items) visit(it)
  return leaves
}

export function computeScoreFromItems(items: unknown, templateDef?: ChecklistTemplateDefinition): number {
  if (!Array.isArray(items)) return 0
  const groups = items as StoredGroup[]
  const allLeaves = groups.flatMap(g => Array.isArray(g?.items) ? flattenLeaves(g.items) : [])
  const leafIndex = buildLeafTemplateIndex(templateDef)

  let eligible = 0
  let standard = 0
  for (const it of allLeaves) {
    // Universal not-applicable marker (Session E2 follow-up) — `value: 'N/A'` may be set on ANY
    // answerType, not just 'choice' (e.g. a v2 presence_standard leaf the auditor marked
    // ไม่เกี่ยวข้อง because a sibling mutually-exclusive criterion applies instead). Excluded from
    // every bucket, exactly like v1's N/A always was.
    if (it.value === 'N/A') continue
    if (it.applicable === false) continue // Part C.4 — era-redacted, excluded like N/A
    const kind: TemplateAnswerKind = it.answerType ?? (it.value !== undefined ? 'choice' : it.present !== undefined ? 'presence' : 'choice')
    if (kind === 'presence') continue // never eligible for standards — จัดให้มีฯ only, see module doc
    if (kind === 'presence_standard') {
      if (it.present !== true) continue // ไม่มี / unanswered — not eligible
      const verdict = it.values !== undefined
        ? deriveMeasuredStandard(leafIndex.get(it.id ?? '')?.measurements, it.values)
        : (it.meetsStandard ?? null)
      if (verdict === null) continue // bare "present" — standard not yet resolved, parked
      eligible++
      if (verdict === true) standard++
      continue
    }
    // 'choice' — original v1 formula, unchanged (note: a missing/undefined `value` key falls
    // through as eligible-but-not-standard, exactly as the pre-E1 filter predicate did — this
    // looks odd but is deliberate parity with the byte-for-byte original, not a new decision).
    // N/A is handled above, universally, before this branch is ever reached.
    if (it.value === null) continue
    if (it.value === 'มี' && it.flagged === true) continue
    eligible++
    if (it.value === 'มี' && it.meetsStandard === true) standard++
  }
  return eligible > 0 ? Math.round((standard / eligible) * 100) : 0
}

// Session F1, Part E.1 — server-side "answered/total" progress for a DRAFT, computed from the
// STORED items JSON alone, never a template fan-out (the auditor history list endpoint must stay
// a cheap, bounded query across potentially many drafts — fetching/resolving each one's template
// would defeat that). "Answered" mirrors lib/audit-form.ts#isLeafAnswered exactly (N/A counts,
// a definite choice/present value counts) so the auditor's own in-progress % never disagrees with
// this list's number. Era-redacted leaves (applicable === false) are excluded from both, same as
// scoring — they're not part of this checklist's answerable set at all.
export function computeStoredProgress(items: unknown): { answered: number; total: number } {
  if (!Array.isArray(items)) return { answered: 0, total: 0 }
  const groups = items as StoredGroup[]
  let total = 0
  let answered = 0
  for (const g of groups) {
    const leaves = Array.isArray(g?.items) ? flattenLeaves(g.items) : []
    for (const it of leaves) {
      if (it.applicable === false) continue
      total++
      if (it.value === 'N/A') { answered++; continue }
      const kind: TemplateAnswerKind = it.answerType ?? (it.value !== undefined ? 'choice' : it.present !== undefined ? 'presence' : 'choice')
      if (kind === 'choice') { if (it.value !== null && it.value !== undefined) answered++; continue }
      if (it.present !== null && it.present !== undefined) answered++
    }
  }
  return { answered, total }
}

// Admin review gate — checked before approval, never mixed into the score formula above.
export function hasReviewFlag(items: unknown): boolean {
  if (!Array.isArray(items)) return false
  const groups = items as StoredGroup[]
  const visit = (it: StoredItem): boolean =>
    it.reviewFlag === true || (Array.isArray(it.subItems) && it.subItems.some(visit))
  return groups.some(g => Array.isArray(g?.items) && g.items.some(visit))
}

export function scoreToStatus(score: number): string {
  if (score >= 75) return 'ผ่านมาตรฐาน'
  if (score >= 50) return 'ต้องปรับปรุง'
  return 'ไม่ผ่าน'
}

export interface ValueHistogram {
  hasStandard:         number  // มี + meetsStandard=true (choice, or presence_standard)
  hasSubstandard:      number  // มี + meetsStandard=false + flagged=false
  standardUnspecified: number  // มี + meetsStandard=false + flagged=true  (bare มี, or presence_standard "present" pending standard)
  none:                number  // ไม่มี
  na:                  number  // N/A — universal marker, any answerType (Session E2 follow-up:
                                // some v2 criteria are mutually-exclusive alternatives, e.g. three
                                // ramp-length bands where only one applies; the other two are N/A)
  redacted:            number  // Part C.4 — era-redacted (applicable === false); excluded from
                                // every metric exactly like N/A, tracked separately for visibility
  nullOrOther:         number  // null (unanswered / OTHER that slipped through)
  total:               number  // every leaf visited, of every answerType
  // v2 pure-'presence' leaves (มี/ไม่มี only — no ได้มาตรฐาน concept). Deliberately kept OUT of
  // every field above: they must never affect การได้มาตรฐาน. See computeFacilityMetrics.
  presenceHas:         number  // present === true
  presenceNone:        number  // present === false
  presenceUnanswered:  number  // present === null/undefined
}

// The six สนข.-spec metrics (CLAUDE.md "Scoring formulas"), derived from buildHistogram's
// canonical bucketing — never re-derive value/flagged eligibility rules here directly.
// Bare-มี (standardUnspecified) and unanswered (nullOrOther) are excluded from every field
// below, same as N/A: eligible = hasStandard + hasSubstandard + none only.
//
// v2 'presence'-only leaves (DATA_DICTIONARY_v2.md §2, "recommended" rollup, Part A.3.4): they
// count toward hasItem/pctHasFacility (การจัดให้มีฯ) but are excluded from total/pctSuccess and
// from pctMeetsStandard's denominator (การได้มาตรฐาน) — the structural heir of the bare-มี
// exclusion. When a checklist has zero presence-only leaves (every v1 row, by construction) these
// formulas reduce to exactly the pre-E1 formulas.
export interface FacilityMetrics {
  total:             number  // 3.1 จำนวนรายการทั้งหมด (ไม่รวม N/A / bare-มี / unanswered / presence-only)
  hasItem:           number  // 3.2 จำนวนรายการที่มีสิ่งอำนวยความสะดวก (includes presence-only "has")
  meetsStandard:     number  // 3.3 จำนวนรายการที่ได้มาตรฐาน
  pctSuccess:        number  // 3.4 ร้อยละความสำเร็จ — unrounded; callers format for display
  pctHasFacility:    number  // 3.5 ร้อยละการจัดให้มีสิ่งอำนวยความสะดวก
  pctMeetsStandard:  number  // 3.6 ร้อยละการได้มาตรฐาน (among items that have it; presence-only excluded)
  // Live feedback fix — pctHasFacility's own denominator (total + presenceHas + presenceNone), so
  // a caller displaying "hasItem/N" (e.g. for a presence-only-heavy category, where total===0
  // makes pctSuccess/`meetsStandard/total` meaningless) doesn't have to reverse-derive it from a
  // rounded percentage. Was already computed internally; this just also returns it.
  facilityEligible:  number
}

export function computeFacilityMetrics(items: unknown, templateDef?: ChecklistTemplateDefinition): FacilityMetrics {
  const h = buildHistogram(items, templateDef)
  const total               = h.hasStandard + h.hasSubstandard + h.none
  const standardsHasItem    = h.hasStandard + h.hasSubstandard
  const hasItem             = standardsHasItem + h.presenceHas
  const meetsStandard       = h.hasStandard
  const facilityEligible    = total + h.presenceHas + h.presenceNone
  return {
    total,
    hasItem,
    meetsStandard,
    pctSuccess:       total            > 0 ? (meetsStandard / total)            * 100 : 0,
    pctHasFacility:   facilityEligible > 0 ? (hasItem / facilityEligible)        * 100 : 0,
    pctMeetsStandard: standardsHasItem > 0 ? (meetsStandard / standardsHasItem)  * 100 : 0,
    facilityEligible,
  }
}

export function buildHistogram(items: unknown, templateDef?: ChecklistTemplateDefinition): ValueHistogram {
  const h: ValueHistogram = {
    hasStandard: 0, hasSubstandard: 0, standardUnspecified: 0,
    none: 0, na: 0, redacted: 0, nullOrOther: 0, total: 0,
    presenceHas: 0, presenceNone: 0, presenceUnanswered: 0,
  }
  if (!Array.isArray(items)) return h
  const groups = items as StoredGroup[]
  const leafIndex = buildLeafTemplateIndex(templateDef)

  for (const g of groups) {
    const leaves = Array.isArray(g?.items) ? flattenLeaves(g.items) : []
    for (const it of leaves) {
      h.total++
      // Part C.4 — era-redacted, a structural fact independent of any auditor answer; checked
      // before N/A since a redacted leaf is never even presented for the auditor to answer.
      if (it.applicable === false) { h.redacted++; continue }
      // Universal not-applicable marker — see the matching comment in computeScoreFromItems.
      if (it.value === 'N/A') { h.na++; continue }
      const kind: TemplateAnswerKind = it.answerType ?? (it.value !== undefined ? 'choice' : it.present !== undefined ? 'presence' : 'choice')

      if (kind === 'presence') {
        if (it.present === true) h.presenceHas++
        else if (it.present === false) h.presenceNone++
        else h.presenceUnanswered++
        continue
      }

      if (kind === 'presence_standard') {
        if (it.present === null || it.present === undefined) { h.nullOrOther++; continue }
        if (it.present === false) { h.none++; continue }
        // present === true
        const verdict = it.values !== undefined
          ? deriveMeasuredStandard(leafIndex.get(it.id ?? '')?.measurements, it.values)
          : (it.meetsStandard ?? null)
        if (verdict === true) h.hasStandard++
        else if (verdict === false) h.hasSubstandard++
        else h.standardUnspecified++
        continue
      }

      // 'choice' — original v1 classification, unchanged (a missing/undefined `value` key
      // silently falls through with only `total` counted — matches the pre-E1 original exactly).
      // N/A is handled above, universally, before this branch is ever reached.
      if (it.value === null)    { h.nullOrOther++; continue }
      if (it.value === 'ไม่มี') { h.none++;        continue }
      if (it.value === 'มี') {
        if (it.meetsStandard)        h.hasStandard++
        else if (it.flagged)         h.standardUnspecified++
        else                         h.hasSubstandard++
      }
    }
  }
  return h
}
