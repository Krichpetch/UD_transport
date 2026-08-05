'use client'

import * as React from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const THAI_MONTHS = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
] as const

export interface MonthYearBuiltInputProps {
  /** ISO "YYYY-MM" (Gregorian), '' when unset. */
  value: string
  /** Fires with a complete "YYYY-MM" once both month and year are picked, or '' when incomplete/cleared. */
  onChange: (value: string) => void
  /** Fires right after onChange with a COMPLETE value, receiving that same value directly (never
   *  relies on the caller's own state having settled yet — avoids the stale-closure trap a plain
   *  no-arg callback would hit, since onChange/onCommit fire in the same tick). */
  onCommit?: (value: string) => void
  disabled?: boolean
  /** Buddhist year floor for the year dropdown. Default matches @repo/types#YEAR_BUILT_MIN. */
  minBuddhistYear?: number
  className?: string
}

// 2026-08-06 — replaces a lone `<input type="month">`, which renders inconsistently across
// browsers: Firefox desktop has NO native month picker at all (silently falls back to a plain text
// box), and mobile's wheel-style picker looks and behaves nothing like desktop's calendar-grid
// picker. Two shadcn Selects (เดือน / ปี พ.ศ.) render identically everywhere, work equally well
// with touch or a mouse/keyboard, and match this app's existing filter-bar Select styling.
//
// Month is disabled until a year is chosen — avoids ever having to guess what to do with an
// already-picked month that becomes invalid for a newly-picked year in the OTHER order. A month
// picked while a different year was selected IS still re-validated on year change (see
// handleYearChange) since Select allows reopening the year dropdown after a month is already set.
//
// Semi-controlled by design: `value` seeds initial state and is re-synced whenever it changes
// EXTERNALLY (comparing against this instance's own last-emitted value during render — see the
// sync check below), but the "year picked, month not chosen yet" step is transient local state
// with no representation in `value` at all (mirrors how a native <input type="month"> never
// exposes a half-picked state either). Callers that reset/reload this field's data wholesale
// (e.g. switching stations) should pass `key={someIdThatChangesWithTheContext}` so a full remount
// clears any left-behind half-picked state — see apps/web/app/(audit-layout)/audit/page.tsx.
export function MonthYearBuiltInput({
  value,
  onChange,
  onCommit,
  disabled,
  minBuddhistYear = 2400,
  className,
}: MonthYearBuiltInputProps) {
  const now = new Date()
  const currentGregorianYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1 // 1-12

  const [year, setYear] = React.useState(() => (value ? value.split('-')[0]! : ''))
  const [month, setMonth] = React.useState(() => (value ? value.split('-')[1]! : ''))

  // Re-sync from an EXTERNAL value change (e.g. a background hydrate finishing after this
  // component already mounted with an empty value). After our own commit() below, `value` always
  // equals `combined` by construction, so this can only trigger on a genuinely external update —
  // never on an echo of our own change. Safe to adjust state during render (React's documented
  // pattern for this): the condition is false again before this render commits.
  const combined = year && month ? `${year}-${month}` : ''
  if (value !== combined) {
    const [v, m] = value ? value.split('-') : ['', '']
    if (v !== year) setYear(v ?? '')
    if (m !== month) setMonth(m ?? '')
  }

  const years = React.useMemo(() => {
    const minGregorianYear = minBuddhistYear - 543
    const out: number[] = []
    for (let y = currentGregorianYear; y >= minGregorianYear; y--) out.push(y)
    return out
  }, [currentGregorianYear, minBuddhistYear])

  const maxMonth = year && Number(year) === currentGregorianYear ? currentMonth : 12
  const monthOptions = THAI_MONTHS.slice(0, maxMonth)

  function commit(nextYear: string, nextMonth: string) {
    setYear(nextYear)
    setMonth(nextMonth)
    const nextCombined = nextYear && nextMonth ? `${nextYear}-${nextMonth}` : ''
    onChange(nextCombined)
    if (nextCombined) onCommit?.(nextCombined)
  }

  function handleYearChange(nextYear: string) {
    // A month picked under a different year may now be in the future for this year — clamp it
    // rather than silently submitting an invalid future date.
    const clampedMonth = month && Number(nextYear) === currentGregorianYear && Number(month) > currentMonth
      ? String(currentMonth).padStart(2, '0')
      : month
    commit(nextYear, clampedMonth)
  }

  function handleMonthChange(nextMonth: string) {
    commit(year, nextMonth)
  }

  return (
    <div className={`flex gap-2 ${className ?? ''}`}>
      <Select value={month || undefined} onValueChange={handleMonthChange} disabled={disabled || !year}>
        <SelectTrigger className="flex-1"><SelectValue placeholder="เดือน" /></SelectTrigger>
        <SelectContent>
          {monthOptions.map((label, i) => (
            <SelectItem key={i} value={String(i + 1).padStart(2, '0')}>{label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={year || undefined} onValueChange={handleYearChange} disabled={disabled}>
        <SelectTrigger className="flex-1"><SelectValue placeholder="ปี พ.ศ." /></SelectTrigger>
        <SelectContent>
          {years.map((y) => (
            <SelectItem key={y} value={String(y)}>{y + 543}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
