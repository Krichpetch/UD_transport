'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

type ChartRow = { type: string; ผ่าน: number; ต้องปรับปรุง: number; ไม่ผ่าน: number }

// height defaults to filling a sized parent (dashboard's fixed-height card row) — pass a pixel
// value instead only where the parent doesn't already establish a definite height.
export function StationBarChart({ data, height = '100%' }: { data: ChartRow[]; height?: number | string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="type"
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
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
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          iconType="circle"
          iconSize={8}
        />
        <Bar dataKey="ผ่าน" fill="var(--status-pass)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="ต้องปรับปรุง" fill="var(--status-warn)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="ไม่ผ่าน" fill="var(--status-fail)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}