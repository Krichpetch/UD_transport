'use client'

import * as React from 'react'
import type { FacilityMetrics, GroupSummaryEntry, ItemSummaryEntry } from '@/lib/api/stations'
import type { ValueHistogram } from '@repo/types'
import { ChecklistItemPieChart, HistogramLegend } from '@/components/charts/ChecklistItemPieChart'

// Score → color, same exact threshold DESIGN.md mandates everywhere a raw score/percentage
// drives a color (see ScoreBar).
function pctColor(pct: number): string {
  if (pct >= 75) return 'var(--status-pass)'
  if (pct >= 50) return 'var(--status-warn)'
  return 'var(--status-fail)'
}

type ViewMode = 'groups' | 'items'

// One row shape both views render into — groups and items carry the same metrics/histogram
// shape, just a different id/label source.
interface Row {
  id: string
  label: string
  cabinetPriority: boolean
  metrics: FacilityMetrics
  histogram: ValueHistogram
}

function groupRow(g: GroupSummaryEntry): Row {
  return { id: g.groupId, label: g.groupName, cabinetPriority: g.cabinetPriority, metrics: g.metrics, histogram: g.histogram }
}
function itemRow(i: ItemSummaryEntry): Row {
  return { id: i.id, label: `${i.id} ${i.labelTh}`, cabinetPriority: i.cabinetPriority, metrics: i.metrics, histogram: i.histogram }
}

// UDT-17 — "ประเด็นที่ควรปรับปรุง": worst-performing areas across the currently filtered station
// set. Defaults to the "bigger picture" (grouped facility, e.g. "(B2) ห้องน้ำ") per user request;
// the finer per-item breakdown is kept as a drill-down option via the view toggle, not the
// headline (see StationsService.computeIssueSummary).
export function IssueSummaryPanel({
  groups,
  items,
  loading,
  limit = 8,
}: {
  groups: GroupSummaryEntry[] | undefined
  items: ItemSummaryEntry[] | undefined
  loading: boolean
  limit?: number
}) {
  const [mode, setMode] = React.useState<ViewMode>('groups')

  const rows: Row[] = mode === 'groups' ? (groups ?? []).map(groupRow) : (items ?? []).map(itemRow)
  const top = rows.slice(0, limit)

  return (
    <div className="bg-card border-border rounded-xl border p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-foreground text-sm font-semibold">ประเด็นที่ควรปรับปรุง</h2>
          <p className="text-muted-foreground text-xs">
            {mode === 'groups'
              ? 'กลุ่มสิ่งอำนวยความสะดวกที่ได้มาตรฐานต่ำที่สุดในกลุ่มสถานีที่กรองไว้ (เรียงจากแย่ที่สุด)'
              : 'รายการตรวจสอบย่อยที่ได้มาตรฐานต่ำที่สุดในกลุ่มสถานีที่กรองไว้ (เรียงจากแย่ที่สุด)'}
          </p>
        </div>

        {/* Bigger picture (groups) by default; per-item drill-down kept as an option, not the
            headline. */}
        <div className="border-border flex shrink-0 rounded-lg border p-0.5 text-xs">
          <button
            onClick={() => setMode('groups')}
            className={`rounded-md px-2.5 py-1 transition-colors ${
              mode === 'groups' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            ภาพรวมกลุ่ม
          </button>
          <button
            onClick={() => setMode('items')}
            className={`rounded-md px-2.5 py-1 transition-colors ${
              mode === 'items' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            รายรายการย่อย
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-muted-foreground text-xs">กำลังประมวลผล...</p>
      ) : top.length === 0 ? (
        <p className="text-muted-foreground text-xs">ไม่มีข้อมูลรายการตรวจสอบสำหรับสถานีในกลุ่มนี้</p>
      ) : (
        <div>
          {/* One shared legend for the whole list — a pie repeated down every row shouldn't
              repeat its own legend too (see ChecklistItemPieChart's showLegend doc). */}
          <div className="border-border mb-1 flex justify-end border-b pb-2">
            <HistogramLegend />
          </div>
          <div className="divide-border divide-y">
            {top.map(row => (
              <div
                key={row.id}
                className="grid grid-cols-1 items-center gap-3 py-3 sm:grid-cols-[1fr_auto_88px]"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground text-xs font-medium">{row.label}</span>
                    {row.cabinetPriority && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-3xs font-medium text-amber-700">
                        มติ ครม.
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-0.5 text-3xs">
                    ได้มาตรฐาน {row.metrics.meetsStandard}/{row.metrics.total} · มีสิ่งอำนวยความสะดวก {row.metrics.hasItem}
                  </p>
                </div>
                <p
                  className="text-lg font-bold sm:text-right"
                  style={{ color: pctColor(row.metrics.pctSuccess) }}
                >
                  {row.metrics.pctSuccess.toFixed(1)}%
                </p>
                <div className="h-20">
                  <ChecklistItemPieChart histogram={row.histogram} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
