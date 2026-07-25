import { normalizeKey, fuzzyKey } from '../text-normalize'

describe('normalizeKey', () => {
  it('collapses whitespace variance to identical keys', () => {
    expect(normalizeKey('สถานี  บางซ่อน')).toBe(normalizeKey('สถานีบางซ่อน'))
  })

  it('canonicalizes Thai digits to Arabic digits', () => {
    expect(normalizeKey('แห่งที่ ๒')).toBe(normalizeKey('แห่งที่ 2'))
  })

  it('strips parens/quote noise but keeps the inner text', () => {
    expect(normalizeKey('สถานีขนส่งผู้โดยสารกรุงเทพฯ (จตุจักร)')).toBe(
      normalizeKey('สถานีขนส่งผู้โดยสารกรุงเทพฯจตุจักร'),
    )
  })

  it('unifies en-dash/em-dash with hyphen', () => {
    expect(normalizeKey('สุไหงโก–ลก')).toBe(normalizeKey('สุไหงโก-ลก'))
    expect(normalizeKey('สุไหงโก—ลก')).toBe(normalizeKey('สุไหงโก-ลก'))
  })

  it('treats null/undefined as empty string', () => {
    expect(normalizeKey(null)).toBe('')
    expect(normalizeKey(undefined)).toBe('')
  })

  it('is not automatically case-insensitive beyond what NFC gives (no latin text in scope)', () => {
    expect(normalizeKey('MRT')).toBe('MRT')
  })
})

describe('fuzzyKey', () => {
  it('collapses runs of whitespace to a single space instead of stripping', () => {
    expect(fuzzyKey('สถานี   บางซ่อน')).toBe('สถานี บางซ่อน')
  })

  it('trims leading/trailing whitespace', () => {
    expect(fuzzyKey('  สถานีบางซ่อน  ')).toBe('สถานีบางซ่อน')
  })

  it('still strips paren noise like normalizeKey', () => {
    expect(fuzzyKey('กรุงเทพฯ (จตุจักร)')).toBe('กรุงเทพฯ จตุจักร')
  })
})
