// Era-editor safety follow-up (live feedback, 2026-08-17) — mirrors the grouping engine's own
// matching algorithm (apps/api/src/admin/templates/facility-grouping.core.ts's matchKey +
// levenshteinRatio, FUZZY_THRESHOLD = 0.95) so the admin gets the SAME verdict here, before saving,
// that the grouped editor's pooling will actually compute afterward. Not imported directly — that
// file lives in apps/api, not a shared package — but kept in lockstep intentionally; a real bug
// motivated this: a hand-typed label one syllable short of an existing group's text (0.917 ratio,
// human-eye "basically the same") silently failed to link with zero feedback anywhere in the UI.
export const FUZZY_THRESHOLD = 0.95

function matchKey(s: string): string {
  return s.replace(/\s+/g, '')
}

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i]![0] = i
  for (let j = 0; j <= n; j++) dp[0]![j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!)
    }
  }
  return dp[m]![n]!
}

export function levenshteinRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1
  return 1 - levenshteinDistance(a, b) / Math.max(a.length, b.length)
}

export interface FuzzyMatch<T> {
  item: T
  ratio: number
  willGroup: boolean
}

// Best match for `label` among `candidates` — used to warn the admin BEFORE they save, not just
// report what already happened. `willGroup` mirrors the backend's own >= FUZZY_THRESHOLD cutoff;
// a match found but `willGroup: false` is exactly the "close but not close enough" trap this exists
// to surface (the UI shows this as a warning, not a silent nothing).
export function bestFuzzyMatch<T>(label: string, candidates: T[], getLabel: (item: T) => string): FuzzyMatch<T> | null {
  const key = matchKey(label)
  if (!key) return null
  let best: FuzzyMatch<T> | null = null
  for (const item of candidates) {
    const candidateKey = matchKey(getLabel(item))
    const ratio = key === candidateKey ? 1 : levenshteinRatio(key, candidateKey)
    if (!best || ratio > best.ratio) best = { item, ratio, willGroup: ratio >= FUZZY_THRESHOLD }
  }
  return best
}
