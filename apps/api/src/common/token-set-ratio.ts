// TS re-implementation of rapidfuzz's fuzz.token_set_ratio, since the checklist-migration tool's
// rapidfuzz dependency is Python-only and this matcher runs inside the NestJS backend. Same
// algorithm shape (tokenize -> set overlap -> compare recombined strings), scored with a
// Levenshtein-based similarity ratio in place of rapidfuzz's native (Indel) ratio. Not a literal
// port — no npm package reproduces rapidfuzz's exact ratio formula — but same behavior: near-1
// for strings sharing most tokens regardless of order/duplication, degrading smoothly otherwise.

function levenshteinDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const prev = new Array(n + 1)
  const curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]
  }
  return prev[n]
}

/** Levenshtein similarity ratio in [0, 1]. Empty/empty compares equal (ratio 1). */
export function levenshteinRatio(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1
  const dist = levenshteinDistance(a, b)
  return 1 - dist / Math.max(a.length, b.length)
}

/**
 * token_set_ratio: tokenize both strings on whitespace, then compare the sorted-intersection
 * string against (intersection + each side's unique remainder), taking the best of the three
 * pairings. Robust to token order, duplication, and one side being a strict superset of the
 * other's words — the case that plain ratio() scores poorly but is a strong match in practice
 * (e.g. "สถานีรถไฟ บางซ่อน" vs "บางซ่อน").
 */
export function tokenSetRatio(a: string, b: string): number {
  const tokensA = new Set(a.split(' ').filter(Boolean))
  const tokensB = new Set(b.split(' ').filter(Boolean))

  const intersection = [...tokensA].filter((t) => tokensB.has(t)).sort()
  const diffA = [...tokensA].filter((t) => !tokensB.has(t)).sort()
  const diffB = [...tokensB].filter((t) => !tokensA.has(t)).sort()

  const t0 = intersection.join(' ')
  const t1 = [t0, diffA.join(' ')].filter(Boolean).join(' ')
  const t2 = [t0, diffB.join(' ')].filter(Boolean).join(' ')

  return Math.max(
    levenshteinRatio(t0, t1),
    levenshteinRatio(t0, t2),
    levenshteinRatio(t1, t2),
  )
}
