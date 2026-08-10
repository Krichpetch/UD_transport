// Session S4b-fix, Fix 2 — checklist codes ('A1.1', 'A1.1-1', 'A1.10', 'B7.9') sort wrong under
// plain string comparison ('A1.10' < 'A1.2' lexically). Tokenizes into alternating digit/non-digit
// runs and compares digit runs numerically, everything else lexically — the standard "natural
// sort" approach. Display-only: never touches stored order, scoring, or the codes themselves.
function tokenize(code: string): (string | number)[] {
  return code.split(/(\d+)/).map((part) => (/^\d+$/.test(part) ? Number(part) : part))
}

export function compareTemplateCodes(a: string, b: string): number {
  const ta = tokenize(a)
  const tb = tokenize(b)
  const len = Math.max(ta.length, tb.length)
  for (let i = 0; i < len; i++) {
    const x = ta[i]
    const y = tb[i]
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (typeof x === 'number' && typeof y === 'number') {
      if (x !== y) return x - y
    } else {
      const sx = String(x)
      const sy = String(y)
      if (sx !== sy) return sx < sy ? -1 : 1
    }
  }
  return 0
}

export function sortByNodeCode<T>(items: readonly T[], getCode: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareTemplateCodes(getCode(a), getCode(b)))
}
