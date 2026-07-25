// Shared text normalization for matching station/entity names across data sources with
// inconsistent spacing, punctuation, and digit scripts. Ported from the normalization family
// in tools/checklist-migration/normalize.py (label_key / fuzz_key) — that module is the single
// source of truth for "how do we key Thai text for matching" on this project; this is the same
// approach applied to station names/lines instead of checklist item labels (no numbering-prefix
// stripping, since station names don't carry "1.2.3 " style prefixes).

const THAI_DIGITS: Record<string, string> = {
  '๐': '0', '๑': '1', '๒': '2', '๓': '3', '๔': '4',
  '๕': '5', '๖': '6', '๗': '7', '๘': '8', '๙': '9',
}

function translateThaiDigits(text: string): string {
  return text.replace(/[๐-๙]/g, (d) => THAI_DIGITS[d] ?? d)
}

function baseClean(text: string | null | undefined): string {
  let t = (text ?? '').normalize('NFC')
  t = translateThaiDigits(t)
  t = t.replace(/[()\[\]“”"'`]/g, '') // paren/quote noise
  t = t.replace(/[–—-]+/g, '-') // en/em dash -> hyphen
  return t
}

/**
 * Deterministic exact-match key: all whitespace removed. Use for equality checks (tier-1/tier-2
 * matching) — spacing is the most volatile artifact of source-file extraction, so it must not
 * affect equality.
 */
export function normalizeKey(text: string | null | undefined): string {
  return baseClean(text).replace(/\s+/g, '')
}

/**
 * Matching key for fuzzy scoring only: same cleanup as normalizeKey(), but whitespace is
 * collapsed to single spaces rather than stripped — token-based fuzzy ratios need token
 * boundaries, which a fully spaceless Thai string does not have.
 */
export function fuzzyKey(text: string | null | undefined): string {
  return baseClean(text).replace(/\s+/g, ' ').trim()
}
