'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  LabelList,
  ResponsiveContainer,
} from 'recharts'

type ChartRow = {
  type: string
  ผ่าน: number
  ต้องปรับปรุง: number
  ไม่ผ่าน: number
  ยังไม่ตรวจ: number
}

// Zero-value labels clutter an otherwise-empty segment — only print a count that's actually there.
function nonZeroLabel(value: number): string {
  return value > 0 ? value.toLocaleString() : ''
}

// UDT-75 — horizontal stacked bar (one row per transport mode, segments = status split) per the
// ticket's own mockup, replacing the earlier grouped/vertical layout. Each segment gets its count
// centered inside it; the label fill is picked per series for contrast against that segment's
// solid color — reusing --status-warn-foreground (the token that exists precisely because amber
// text needs a darker shade to stay readable) rather than introducing a new color.
const SERIES: { key: keyof Omit<ChartRow, 'type'>; fill: string; labelFill: string }[] = [
  { key: 'ผ่าน',         fill: 'var(--status-pass)',      labelFill: 'var(--primary-foreground)' },
  { key: 'ต้องปรับปรุง', fill: 'var(--status-warn)',      labelFill: 'var(--status-warn-foreground)' },
  { key: 'ไม่ผ่าน',      fill: 'var(--status-fail)',      labelFill: 'var(--primary-foreground)' },
  { key: 'ยังไม่ตรวจ',   fill: 'var(--muted-foreground)', labelFill: 'var(--primary-foreground)' },
]

// height defaults to filling a sized parent (dashboard's fixed-height card row) — pass a pixel
// value instead only where the parent doesn't already establish a definite height.
export function StationBarChart({ data, height = '100%' }: { data: ChartRow[]; height?: number | string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="type"
          width={72}
          tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            fontSize: 12,
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, paddingTop: 8 }}
          iconType="circle"
          iconSize={8}
        />
        {SERIES.map((s, i) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            stackId="status"
            fill={s.fill}
            // Round only the outer ends of the stack — the first segment's left corners, the
            // last segment's right corners — so the whole row reads as one rounded bar.
            radius={i === 0 ? [4, 0, 0, 4] : i === SERIES.length - 1 ? [0, 4, 4, 0] : 0}
          >
            <LabelList dataKey={s.key} position="center" formatter={nonZeroLabel} fontSize={12} fill={s.labelFill} />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}
