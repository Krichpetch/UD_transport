'use client'

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { ValueHistogram } from '@repo/types'

// UDT-19 — the 4 CLAUDE.md display states ("ChecklistValue — 4 states, not 3"), built off
// buildHistogram's canonical buckets (never re-derive value/meetsStandard classification here).
// hasSubstandard + standardUnspecified both mean "has it, not confirmed meeting standard", so
// they share the "มี แต่ไม่ได้มาตรฐาน" slice; redacted counts exactly like N/A (buildHistogram's
// own documented convention) and shares the "ไม่เกี่ยวข้อง" slice.
//
// Single source of truth for label/color, shared by every pie instance AND by HistogramLegend
// (a legend rendered ONCE above a list of many small pies, rather than repeating recharts' own
// Legend on every row) — so the two can never drift apart.
const HISTOGRAM_SLICE_DEFS: { label: string; color: string; pick: (h: ValueHistogram) => number }[] = [
  { label: 'มีและได้มาตรฐาน',     color: 'var(--status-pass)',      pick: h => h.hasStandard },
  { label: 'มีแต่ไม่ได้มาตรฐาน',   color: 'var(--status-warn)',      pick: h => h.hasSubstandard + h.standardUnspecified },
  { label: 'ไม่มี',               color: 'var(--status-fail)',      pick: h => h.none },
  { label: 'ไม่เกี่ยวข้อง (N/A)',  color: 'var(--muted-foreground)', pick: h => h.na + h.redacted },
]

function toSlices(h: ValueHistogram) {
  return HISTOGRAM_SLICE_DEFS
    .map(d => ({ name: d.label, value: d.pick(h), color: d.color }))
    .filter(s => s.value > 0)
}

interface SliceTooltipPayloadEntry {
  name?: string
  value?: number
  payload?: { color?: string }
  color?: string
}

// Custom tooltip — the status label, its count, and a color badge matching the slice, in place
// of recharts' bare default content.
function SliceTooltip({ active, payload }: { active?: boolean; payload?: SliceTooltipPayloadEntry[] }) {
  const entry = active ? payload?.[0] : undefined
  if (!entry) return null
  const color = entry.payload?.color ?? entry.color
  return (
    <div className="bg-card border-border rounded-lg border px-2.5 py-1.5 text-xs shadow-lg">
      <div className="flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: color }} />
        <span className="text-foreground font-medium">{entry.name}</span>
      </div>
      <p className="text-muted-foreground mt-0.5">{(entry.value ?? 0).toLocaleString()} รายการ</p>
    </div>
  )
}

// A single shared legend for a list of many small pies (e.g. IssueSummaryPanel's ranked rows) —
// render this once above the list instead of showLegend-ing every row's own pie.
export function HistogramLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      {HISTOGRAM_SLICE_DEFS.map(d => (
        <span key={d.label} className="text-muted-foreground flex items-center gap-1.5">
          <span className="size-2 shrink-0 rounded-full" style={{ background: d.color }} />
          {d.label}
        </span>
      ))}
    </div>
  )
}

// height defaults to filling a sized parent, same convention as StationBarChart. showLegend
// defaults to false — a pie repeated down a list of rows shouldn't repeat its own legend too;
// pass true only for a single, non-repeated pie (e.g. the sub-item drill-down panel).
export function ChecklistItemPieChart({
  histogram,
  height = '100%',
  showLegend = false,
}: {
  histogram: ValueHistogram
  height?: number | string
  showLegend?: boolean
}) {
  const slices = toSlices(histogram)
  if (slices.length === 0) {
    return <p className="text-muted-foreground flex h-full items-center justify-center text-xs">ไม่มีข้อมูล</p>
  }
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
        <Pie data={slices} dataKey="value" nameKey="name" innerRadius="45%" outerRadius="75%" paddingAngle={2}>
          {slices.map(s => <Cell key={s.name} fill={s.color} />)}
        </Pie>
        <Tooltip content={<SliceTooltip />} />
        {showLegend && <Legend wrapperStyle={{ fontSize: 11, paddingTop: 4 }} iconType="circle" iconSize={8} />}
      </PieChart>
    </ResponsiveContainer>
  )
}
