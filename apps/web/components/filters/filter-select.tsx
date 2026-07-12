'use client'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ALL_VALUE } from '@/lib/ui-classes'

export interface FilterSelectOption {
  value: string
  label: string
}

interface FilterSelectProps {
  value: string // '' means "all" / unset
  onChange: (value: string) => void
  options: FilterSelectOption[]
  allLabel: string
  triggerClassName?: string
}

// Collapses the repeated Select/SelectTrigger/SelectValue/SelectContent + __all__ sentinel
// dance used by every filter bar in the app. Radix forbids an empty-string item value, so
// ALL_VALUE is translated to/from '' entirely inside here — callers work in plain filter
// terms ('' = all) and never touch the sentinel. Stays dumb: any cross-filter orchestration
// (e.g. resetting a dependent filter) belongs in the caller's onChange, not here.
export function FilterSelect({ value, onChange, options, allLabel, triggerClassName }: FilterSelectProps) {
  return (
    <Select value={value || ALL_VALUE} onValueChange={(v) => onChange(v === ALL_VALUE ? '' : v)}>
      <SelectTrigger className={triggerClassName}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
