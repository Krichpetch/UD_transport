// Station masterlist cutover, import hardening (Task B3): the masterlist is closed — an import
// row may only UPDATE a masterlist station, never INSERT a new one. Every incoming row must
// resolve against the masterlist through these three tiers, scoped WITHIN mode so a shared name
// across modes (e.g. ท่าช้าง: both a pier and a rail station) never cross-matches.
import { normalizeKey, fuzzyKey } from '../common/text-normalize'
import { tokenSetRatio } from '../common/token-set-ratio'

export type MatchTier = 'EXACT' | 'NORMALIZED' | 'FUZZY'
export type MatchResolutionStatus = 'MATCHED' | 'MATCHED_FUZZY' | 'REVIEW' | 'NOT_ON_MASTERLIST'

export interface MasterlistStation {
  id: string
  mode: string
  nameTh: string
  line: string
}

export interface IncomingStationRow {
  mode: string
  nameTh: string
  line?: string | null
}

export interface MatchResult {
  status: MatchResolutionStatus
  tier: MatchTier | null
  matchedStation: MasterlistStation | null
  score: number
}

const FUZZY_AUTO_THRESHOLD = 0.92
const FUZZY_REVIEW_THRESHOLD = 0.75

export function resolveStationMatch(row: IncomingStationRow, masterlist: MasterlistStation[]): MatchResult {
  const rowLine = row.line ?? ''
  const candidatesInMode = masterlist.filter((s) => s.mode === row.mode)

  // Tier 1: exact raw (mode, name, line) equality -- the masterlist's own identity key.
  const exact = candidatesInMode.find((s) => s.nameTh === row.nameTh && s.line === rowLine)
  if (exact) return { status: 'MATCHED', tier: 'EXACT', matchedStation: exact, score: 1 }

  // Tier 2: normalized-name match (whitespace/paren/Thai-digit variance) within mode. When the
  // row carries a line, normalized line equality disambiguates same-named stations on different
  // lines (e.g. กรุงธนบุรี on two metro lines) instead of picking one arbitrarily.
  const nameKey = normalizeKey(row.nameTh)
  const nameMatches = candidatesInMode.filter((s) => normalizeKey(s.nameTh) === nameKey)
  if (nameMatches.length > 0) {
    const lineFiltered = rowLine
      ? nameMatches.filter((s) => normalizeKey(s.line) === normalizeKey(rowLine))
      : nameMatches
    if (lineFiltered.length === 1) {
      return { status: 'MATCHED', tier: 'NORMALIZED', matchedStation: lineFiltered[0]!, score: 1 }
    }
    if (lineFiltered.length > 1) {
      // Still ambiguous after considering line -- never guess, send to human review.
      return { status: 'REVIEW', tier: 'NORMALIZED', matchedStation: null, score: 1 }
    }
    if (!rowLine && nameMatches.length > 1) {
      // No line on the incoming row, and the name alone doesn't disambiguate.
      return { status: 'REVIEW', tier: 'NORMALIZED', matchedStation: null, score: 1 }
    }
    // rowLine was given but matched none of the name-matched candidates' lines -- fall through
    // to fuzzy rather than force-picking a possibly-wrong station.
  }

  // Tier 3: fuzzy (token_set_ratio-equivalent), scoped within mode.
  const rowFuzzy = fuzzyKey(row.nameTh)
  let best: { station: MasterlistStation; score: number } | null = null
  for (const s of candidatesInMode) {
    const score = tokenSetRatio(rowFuzzy, fuzzyKey(s.nameTh))
    if (!best || score > best.score) best = { station: s, score }
  }
  if (!best) return { status: 'NOT_ON_MASTERLIST', tier: null, matchedStation: null, score: 0 }
  if (best.score >= FUZZY_AUTO_THRESHOLD) {
    return { status: 'MATCHED_FUZZY', tier: 'FUZZY', matchedStation: best.station, score: best.score }
  }
  if (best.score >= FUZZY_REVIEW_THRESHOLD) {
    return { status: 'REVIEW', tier: 'FUZZY', matchedStation: best.station, score: best.score }
  }
  return { status: 'NOT_ON_MASTERLIST', tier: 'FUZZY', matchedStation: null, score: best.score }
}
