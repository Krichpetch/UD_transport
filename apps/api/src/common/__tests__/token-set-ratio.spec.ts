import { tokenSetRatio, levenshteinRatio } from '../token-set-ratio'

describe('levenshteinRatio', () => {
  it('returns 1 for identical strings', () => {
    expect(levenshteinRatio('abc', 'abc')).toBe(1)
  })

  it('returns 1 for two empty strings', () => {
    expect(levenshteinRatio('', '')).toBe(1)
  })

  it('returns 0 for completely different single chars of same length', () => {
    expect(levenshteinRatio('a', 'b')).toBe(0)
  })

  it('scores partial overlap between 0 and 1', () => {
    const r = levenshteinRatio('สถานีบางซ่อน', 'สถานีบางโพ')
    expect(r).toBeGreaterThan(0)
    expect(r).toBeLessThan(1)
  })
})

describe('tokenSetRatio', () => {
  it('scores 1 for identical token sets regardless of order', () => {
    expect(tokenSetRatio('สถานี รถไฟ บางซ่อน', 'บางซ่อน รถไฟ สถานี')).toBe(1)
  })

  it('scores high when one side is a strict superset of tokens', () => {
    // "สถานีรถไฟบางซ่อน" vs "บางซ่อน" -- a common real-world variant (mode prefix included)
    const r = tokenSetRatio('สถานีรถไฟ บางซ่อน', 'บางซ่อน')
    expect(r).toBeGreaterThanOrEqual(0.92)
  })

  it('scores low for unrelated names', () => {
    const r = tokenSetRatio('ท่าอากาศยานสุวรรณภูมิ', 'ท่าเรือคลองเตย')
    expect(r).toBeLessThan(0.75)
  })

  it('is symmetric', () => {
    const a = 'สถานีขนส่งผู้โดยสารกรุงเทพ เอกมัย'
    const b = 'สถานีขนส่งผู้โดยสารกรุงเทพฯ (เอกมัย)'
    expect(tokenSetRatio(a, b)).toBeCloseTo(tokenSetRatio(b, a), 10)
  })
})
