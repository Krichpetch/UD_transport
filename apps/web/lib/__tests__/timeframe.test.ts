// UDT-16 — preset→range math and the lastInspected inclusion check, pinned against a fixed "now"
// so the tests are deterministic regardless of when they run.
import { describe, it, expect } from 'vitest'
import { resolveTimeframeRange, isWithinTimeframe, formatTimeframeLabel } from '../timeframe'

const NOW = new Date('2026-09-08T10:00:00.000Z')

describe('resolveTimeframeRange', () => {
  it("'all' has no bounds", () => {
    expect(resolveTimeframeRange('all', '', '', NOW)).toEqual({})
  })

  it("'30d' spans the trailing 30 days up to today", () => {
    expect(resolveTimeframeRange('30d', '', '', NOW)).toEqual({ from: '2026-08-09', to: '2026-09-08' })
  })

  it("'90d' spans the trailing 90 days up to today", () => {
    expect(resolveTimeframeRange('90d', '', '', NOW)).toEqual({ from: '2026-06-10', to: '2026-09-08' })
  })

  it("'thisYear' spans Jan 1 of the current year through today", () => {
    expect(resolveTimeframeRange('thisYear', '', '', NOW)).toEqual({ from: '2026-01-01', to: '2026-09-08' })
  })

  it("'lastYear' spans the full previous calendar year", () => {
    expect(resolveTimeframeRange('lastYear', '', '', NOW)).toEqual({ from: '2025-01-01', to: '2025-12-31' })
  })

  it("'custom' passes the given dates through, treating '' as unset", () => {
    expect(resolveTimeframeRange('custom', '2026-01-15', '2026-02-01', NOW))
      .toEqual({ from: '2026-01-15', to: '2026-02-01' })
    expect(resolveTimeframeRange('custom', '', '2026-02-01', NOW))
      .toEqual({ from: undefined, to: '2026-02-01' })
  })
})

describe('isWithinTimeframe', () => {
  it('an unbounded range (no from/to) matches anything, including no inspection at all', () => {
    expect(isWithinTimeframe(null, {})).toBe(true)
    expect(isWithinTimeframe('2020-01-01T00:00:00.000Z', {})).toBe(true)
  })

  it('a bounded range excludes a station with no lastInspected', () => {
    expect(isWithinTimeframe(null, { from: '2026-01-01', to: '2026-12-31' })).toBe(false)
  })

  it('includes an inspection date exactly on the from boundary', () => {
    expect(isWithinTimeframe('2026-01-01T00:00:00.000Z', { from: '2026-01-01', to: '2026-12-31' })).toBe(true)
  })

  it("includes an inspection on the to boundary's own day (end-of-day inclusive)", () => {
    expect(isWithinTimeframe('2026-12-31T23:00:00.000Z', { from: '2026-01-01', to: '2026-12-31' })).toBe(true)
  })

  it('excludes an inspection before from or after to', () => {
    expect(isWithinTimeframe('2025-12-31T00:00:00.000Z', { from: '2026-01-01', to: '2026-12-31' })).toBe(false)
    expect(isWithinTimeframe('2027-01-01T00:00:00.000Z', { from: '2026-01-01', to: '2026-12-31' })).toBe(false)
  })

  it('a from-only range has no upper bound', () => {
    expect(isWithinTimeframe('2099-01-01T00:00:00.000Z', { from: '2026-01-01' })).toBe(true)
  })
})

// UDT-16 (navbar follow-up) — the navbar box always shows the resolved date RANGE, not the
// preset name, so a viewer can see exactly what's applied without opening the dropdown.
describe('formatTimeframeLabel', () => {
  it('an unbounded range shows ทั้งหมด', () => {
    expect(formatTimeframeLabel({})).toBe('ทั้งหมด')
  })

  it('a bounded range shows both dates, Thai locale, UTC-anchored', () => {
    expect(formatTimeframeLabel({ from: '2026-01-01', to: '2026-12-31' })).toBe('1/1/2569 – 31/12/2569')
  })

  it('a from-only range is prefixed ตั้งแต่', () => {
    expect(formatTimeframeLabel({ from: '2026-01-01' })).toBe('ตั้งแต่ 1/1/2569')
  })

  it('a to-only range is prefixed ถึง', () => {
    expect(formatTimeframeLabel({ to: '2026-12-31' })).toBe('ถึง 31/12/2569')
  })
})
