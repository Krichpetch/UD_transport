'use client'

import * as React from 'react'
import { getTransportLabel, CHECKLIST_CATEGORIES, checklistTemplates } from '@/lib/constants'
import { useStationSummary, useStationMetrics, useStationMapNodes } from '@/hooks/use-stations'
import { StatusBadge, TransportBadge } from '@/components/shared/badges'
import type { TransportMode, ChecklistSubItem, Station } from '@repo/types'
import { TRANSPORT_MODES } from '@repo/types'
import { StationBarChart } from '@/components/charts/StationBarChart'
import { ThailandMap } from '@/components/maps/ThailandMap'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { FilterSelect } from '@/components/filters/filter-select'
import {
  TrendingUp, TrendingDown, Building2, CheckCircle2, AlertTriangle,
  XCircle, AlertCircle, Filter, X, Loader2, Maximize2,
} from 'lucide-react'

function MetricRow({ label, value, pct }: { label: string; value: number; pct?: number }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-foreground text-xs font-semibold">
        {value.toLocaleString()}
        {pct !== undefined && (
          <span className="text-muted-foreground ml-1 font-normal">({pct.toFixed(1)}%)</span>
        )}
      </span>
    </div>
  )
}

// SELECT_TRIGGER_CLS is deliberately NOT in lib/ui-classes.ts — stations/page.tsx's
// FILTER_SELECT_TRIGGER_CLS has drifted from this one (py-2/text-sm vs py-1.5/text-xs).
const SELECT_TRIGGER_CLS = 'h-auto rounded-lg bg-background px-3 py-1.5 text-xs'

export default function DashboardPage() {
  const { data: summary } = useStationSummary()
  const { data: mapNodes } = useStationMapNodes()
  const stations: Station[] = mapNodes ?? []

  const [modeFilter,     setModeFilter]     = React.useState<TransportMode | ''>('')
  const [regionFilter,   setRegionFilter]   = React.useState('')
  const [provinceFilter, setProvinceFilter] = React.useState('')
  const [agencyFilter,   setAgencyFilter]   = React.useState('')
  const [categoryFilter, setCategoryFilter] = React.useState<'A' | 'B' | 'C' | ''>('')
  const [subItemFilter,  setSubItemFilter]  = React.useState('')
  const [mapExpanded,    setMapExpanded]    = React.useState(false)
  const PAGE_SIZE = 10
  const [tablePage, setTablePage] = React.useState(1)

  React.useEffect(() => { setProvinceFilter('') }, [regionFilter])
  React.useEffect(() => { setSubItemFilter('') }, [categoryFilter, modeFilter])
  React.useEffect(() => { setTablePage(1) }, [modeFilter, regionFilter, provinceFilter, agencyFilter])

  const REGIONS = React.useMemo(
    () => [...new Set(stations.map(s => s.region))].sort(),
    [stations],
  )
  const PROVINCES = React.useMemo(() => {
    const base = regionFilter ? stations.filter(s => s.region === regionFilter) : stations
    return [...new Set(base.map(s => s.province))].sort()
  }, [stations, regionFilter])
  const AGENCIES = React.useMemo(
    () => [...new Set(stations.map(s => s.responsibleAgency))].sort(),
    [stations],
  )

  const subItemOptions = React.useMemo(() => {
    if (!categoryFilter) return []
    const template = checklistTemplates[(modeFilter || 'ทางบก') as TransportMode] ?? []
    const items: ChecklistSubItem[] = []
    for (const group of template) {
      if (group.groupId.startsWith(categoryFilter)) {
        items.push(...group.items)
      }
    }
    return items
  }, [categoryFilter, modeFilter])

  const hasFilters = !!(modeFilter || regionFilter || provinceFilter || agencyFilter || categoryFilter || subItemFilter)

  function clearFilters() {
    setModeFilter('')
    setRegionFilter('')
    setProvinceFilter('')
    setAgencyFilter('')
    setCategoryFilter('')
    setSubItemFilter('')
  }

  const filteredStations = stations.filter(s =>
    (!modeFilter      || s.mode === modeFilter) &&
    (!regionFilter    || s.region === regionFilter) &&
    (!provinceFilter  || s.province === provinceFilter) &&
    (!agencyFilter    || s.responsibleAgency === agencyFilter)
  )

  const urgentStations = filteredStations.filter(
    s => s.status === 'ไม่ผ่าน' || s.urgentIssues.length > 0
  )

  const chartData = React.useMemo(() =>
    TRANSPORT_MODES.map(mode => {
      const inMode = filteredStations.filter(s => s.mode === mode)
      return {
        type: mode,
        ผ่าน:         inMode.filter(s => s.status === 'ผ่านมาตรฐาน').length,
        ต้องปรับปรุง: inMode.filter(s => s.status === 'ต้องปรับปรุง').length,
        ไม่ผ่าน:      inMode.filter(s => s.status === 'ไม่ผ่าน').length,
      }
    }),
    [filteredStations],
  )

  const tablePageCount = Math.max(1, Math.ceil(filteredStations.length / PAGE_SIZE))
  const pagedStations  = filteredStations.slice((tablePage - 1) * PAGE_SIZE, tablePage * PAGE_SIZE)

  // Server-side aggregation (StationsService.computeMetrics) — replaces the old per-station
  // useQueries fan-out. Same filter set as filteredStations, plus subItem.
  const metricsQuery = useStationMetrics(
    {
      mode:              modeFilter,
      region:            regionFilter,
      province:          provinceFilter,
      responsibleAgency: agencyFilter,
      subItem:           subItemFilter,
    },
    !!subItemFilter,
  )
  const metrics        = metricsQuery.data
  const metricsLoading = !!subItemFilter && metricsQuery.isLoading
  const selectedSubItem = subItemOptions.find(si => si.id === subItemFilter)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-foreground text-xl font-bold">ภาพรวมระบบ</h1>
        <p className="text-muted-foreground text-sm">
          ข้อมูลจากระบบฐานข้อมูล · สถานี {summary?.totalStations.toLocaleString() ?? '…'} แห่งทั่วประเทศ
        </p>
      </div>

      {/* Filter bar */}
      <div className="bg-card border-border rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Filter size={13} className="text-muted-foreground shrink-0" />

          <FilterSelect
            value={modeFilter}
            onChange={v => setModeFilter(v as TransportMode | '')}
            options={TRANSPORT_MODES.map(m => ({ value: m, label: m }))}
            allLabel="ประเภทการขนส่ง"
            triggerClassName={SELECT_TRIGGER_CLS}
          />

          <FilterSelect
            value={regionFilter}
            onChange={setRegionFilter}
            options={REGIONS.map(r => ({ value: r, label: r }))}
            allLabel="ทุกภาค"
            triggerClassName={SELECT_TRIGGER_CLS}
          />

          {PROVINCES.length > 0 && (
            <FilterSelect
              value={provinceFilter}
              onChange={setProvinceFilter}
              options={PROVINCES.map(p => ({ value: p, label: p }))}
              allLabel="ทุกจังหวัด"
              triggerClassName={SELECT_TRIGGER_CLS}
            />
          )}

          <FilterSelect
            value={agencyFilter}
            onChange={setAgencyFilter}
            options={AGENCIES.map(a => ({ value: a, label: a }))}
            allLabel="ทุกหน่วยงาน"
            triggerClassName={SELECT_TRIGGER_CLS}
          />

          <FilterSelect
            value={categoryFilter}
            onChange={v => setCategoryFilter(v as 'A' | 'B' | 'C' | '')}
            options={CHECKLIST_CATEGORIES.map(c => ({ value: c.value, label: c.label }))}
            allLabel="ทุกหมวดรายการ"
            triggerClassName={SELECT_TRIGGER_CLS}
          />

          {categoryFilter && subItemOptions.length > 0 && (
            <FilterSelect
              value={subItemFilter}
              onChange={setSubItemFilter}
              options={subItemOptions.map(si => ({
                value: si.id,
                label: `${si.id} ${si.labelTh}${si.cabinetPriority ? ' ★' : ''}`,
              }))}
              allLabel="รายการย่อย"
              triggerClassName={SELECT_TRIGGER_CLS}
            />
          )}

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs underline"
            >
              <X size={11} /> ล้างตัวกรอง
            </button>
          )}
        </div>
      </div>

      {/* 6-metrics panel */}
      {subItemFilter && (
        <div className="bg-card border-border rounded-xl border p-5">
          <div className="mb-4 flex items-center gap-2">
            <h2 className="text-foreground text-sm font-semibold">
              ผลการตรวจสอบ: {selectedSubItem?.labelTh ?? subItemFilter}
            </h2>
            {selectedSubItem?.cabinetPriority && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                มติ ครม.
              </span>
            )}
          </div>

          {metricsLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 size={14} className="text-muted-foreground animate-spin" />
              <span className="text-muted-foreground text-xs">กำลังโหลดข้อมูลรายการตรวจ...</span>
            </div>
          ) : metrics ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="border-border divide-border divide-y rounded-lg border px-4 py-2">
                <MetricRow label="3.1 จำนวนสถานีทั้งหมด" value={metrics.metrics.total} />
                <MetricRow label="3.2 สถานีที่มีรายการดังกล่าว" value={metrics.metrics.hasItem} />
                <MetricRow label="3.3 สถานีที่ได้มาตรฐาน" value={metrics.metrics.meetsStandard} />
              </div>
              <div className="border-border divide-border divide-y rounded-lg border px-4 py-2">
                <MetricRow label="3.4 ร้อยละความสำเร็จ" value={metrics.metrics.meetsStandard} pct={metrics.metrics.pctSuccess} />
                <MetricRow label="3.5 ร้อยละการจัดให้มีฯ" value={metrics.metrics.hasItem} pct={metrics.metrics.pctHasFacility} />
                <MetricRow label="3.6 ร้อยละการได้มาตรฐาน" value={metrics.metrics.meetsStandard} pct={metrics.metrics.pctMeetsStandard} />
              </div>
              <div className="border-border rounded-lg border px-4 py-3 sm:col-span-2 lg:col-span-1">
                <p className="text-muted-foreground mb-2 text-[10px] font-medium uppercase tracking-wide">
                  สถานีที่ยังไม่ได้มาตรฐาน ({metrics.failingStations.length})
                </p>
                <div className="themed-scrollbar max-h-28 space-y-1 overflow-y-auto">
                  {metrics.failingStations.map(s => (
                    <p key={s.id} className="text-foreground text-[10px]">
                      · {s.nameTh} <span className="text-muted-foreground">({s.province})</span>
                    </p>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground text-xs">ไม่มีข้อมูลรายการตรวจสอบสำหรับสถานีในกลุ่มนี้</p>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="bg-card border-border rounded-xl border p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">สถานีทั้งหมด</p>
            <div className="bg-primary/10 rounded-lg p-1.5">
              <Building2 size={14} className="text-primary" />
            </div>
          </div>
          <p className="text-foreground text-3xl font-bold">{summary ? summary.totalStations.toLocaleString() : '…'}</p>
          <p className="text-muted-foreground mt-1 text-xs">ครอบคลุมทุกประเภท</p>
        </div>

        <div className="bg-card border-border rounded-xl border p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">ผ่านมาตรฐาน</p>
            <div className="rounded-lg bg-[#52aa4e]/10 p-1.5">
              <CheckCircle2 size={14} className="text-[#52aa4e]" />
            </div>
          </div>
          <p className="text-3xl font-bold text-[#52aa4e]">{summary ? summary.passing.toLocaleString() : '…'}</p>
          <div className="mt-1 flex items-center gap-1">
            <TrendingUp size={11} className="text-[#52aa4e]" />
            <p className="text-muted-foreground text-xs">{summary ? `${summary.passRate}%` : '…'} ของทั้งหมด</p>
          </div>
        </div>

        <div className="bg-card border-border rounded-xl border p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">ต้องปรับปรุง</p>
            <div className="rounded-lg bg-[#ffc107]/10 p-1.5">
              <AlertTriangle size={14} className="text-[#ffc107]" />
            </div>
          </div>
          <p className="text-3xl font-bold text-[#ffc107]">{summary ? summary.needsImprovement.toLocaleString() : '…'}</p>
          <p className="text-muted-foreground mt-1 text-xs">รอการแก้ไข</p>
        </div>

        <div className="bg-card border-border rounded-xl border p-5">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">ไม่ผ่านมาตรฐาน</p>
            <div className="rounded-lg bg-[#f44336]/10 p-1.5">
              <XCircle size={14} className="text-[#f44336]" />
            </div>
          </div>
          <p className="text-3xl font-bold text-[#f44336]">{summary ? summary.failing.toLocaleString() : '…'}</p>
          <div className="mt-1 flex items-center gap-1">
            <TrendingDown size={11} className="text-[#f44336]" />
            <p className="text-muted-foreground text-xs">ต้องดำเนินการเร่งด่วน</p>
          </div>
        </div>
      </div>

      {/* Main content: Chart + Map */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="bg-card border-border rounded-xl border p-5 lg:col-span-3">
          <div className="mb-4">
            <h2 className="text-foreground text-sm font-semibold">สถานะสิ่งอำนวยความสะดวก แยกตามประเภทการขนส่ง</h2>
            <p className="text-muted-foreground text-xs">จำแนกตามสถานะการตรวจสอบล่าสุด</p>
          </div>
          <StationBarChart data={chartData} />
        </div>

        <div className="bg-card border-border rounded-xl border p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-foreground text-sm font-semibold">แผนที่สถานีทั่วประเทศ</h2>
              <p className="text-muted-foreground text-xs">แสดงสถานะตามพื้นที่</p>
            </div>
            <button
              onClick={() => setMapExpanded(true)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="ขยายแผนที่เต็มหน้าจอ"
              title="ขยายแผนที่"
            >
              <Maximize2 size={14} />
            </button>
          </div>
          <div className="h-[260px]">
            <ThailandMap stations={filteredStations} />
          </div>
        </div>
      </div>

      {/* Urgent + Table */}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="bg-card border-border rounded-xl border p-5 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <AlertCircle size={14} className="text-[#f44336]" />
            <h2 className="text-foreground text-sm font-semibold">
              สถานีที่ต้องดำเนินการเร่งด่วน
              {hasFilters && <span className="ml-1 text-muted-foreground font-normal">({urgentStations.length})</span>}
            </h2>
          </div>
          {urgentStations.length === 0 ? (
            <p className="text-muted-foreground text-xs">ไม่พบสถานีตามเงื่อนไข</p>
          ) : (
            <div className="space-y-3">
              {urgentStations.slice(0, 5).map(station => (
                <div key={station.id} className="border-border rounded-lg border p-3">
                  <div className="mb-1.5 flex items-start justify-between gap-2">
                    <p className="text-foreground text-xs font-medium leading-snug">{station.nameTh}</p>
                    <StatusBadge status={station.status} />
                  </div>
                  <p className="text-muted-foreground mb-2 text-[10px]">
                    {station.province} · {getTransportLabel(station)} · {station.responsibleAgency}
                  </p>
                  {station.urgentIssues.length > 0 && (
                    <ul className="space-y-0.5">
                      {station.urgentIssues.map((issue, i) => (
                        <li key={i} className="text-muted-foreground flex items-start gap-1 text-[10px]">
                          <span className="mt-1 size-1 shrink-0 rounded-full bg-[#f44336]" />
                          {issue}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border-border rounded-xl border lg:col-span-3">
          <div className="border-border flex items-center justify-between border-b px-5 py-4">
            <h2 className="text-foreground text-sm font-semibold">
              รายการสถานี
              {hasFilters && <span className="ml-1 text-muted-foreground font-normal text-xs">({filteredStations.length})</span>}
            </h2>
            <a href="/stations" className="text-accent text-xs hover:underline">
              ดูทั้งหมด →
            </a>
          </div>
          <div className="themed-scrollbar overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-border border-b">
                  <th className="text-muted-foreground px-5 py-2.5 text-left font-medium">ชื่อสถานี</th>
                  <th className="text-muted-foreground px-3 py-2.5 text-left font-medium">ประเภท</th>
                  <th className="text-muted-foreground px-3 py-2.5 text-left font-medium">หน่วยงาน</th>
                  <th className="text-muted-foreground px-3 py-2.5 text-right font-medium">คะแนน</th>
                  <th className="text-muted-foreground px-5 py-2.5 text-left font-medium">สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {filteredStations.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-muted-foreground py-8 text-center">
                      ไม่พบสถานีตามเงื่อนไข
                    </td>
                  </tr>
                ) : (
                  pagedStations.map(station => (
                    <tr
                      key={station.id}
                      className="border-border hover:bg-secondary/50 border-b transition-colors last:border-0"
                    >
                      <td className="px-5 py-3">
                        <p className="text-foreground font-medium">{station.nameTh}</p>
                        <p className="text-muted-foreground">{station.province}</p>
                      </td>
                      <td className="px-3 py-3">
                        <TransportBadge type={getTransportLabel(station)} />
                      </td>
                      <td className="px-3 py-3">
                        <span className="text-foreground font-medium">{station.responsibleAgency}</span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span
                          className="font-bold"
                          style={{
                            color: station.score >= 75
                              ? 'var(--status-pass)'
                              : station.score >= 50
                                ? 'var(--status-warn)'
                                : 'var(--status-fail)',
                          }}
                        >
                          {station.score}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={station.status} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {tablePageCount > 1 && (
            <div className="border-border flex items-center justify-between border-t px-5 py-3">
              <span className="text-muted-foreground text-xs">
                {(tablePage - 1) * PAGE_SIZE + 1}–{Math.min(tablePage * PAGE_SIZE, filteredStations.length)} จาก {filteredStations.length}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setTablePage(p => p - 1)}
                  disabled={tablePage === 1}
                  className="border-border text-foreground rounded-lg border px-3 py-1 text-xs disabled:opacity-40"
                >
                  ← ก่อนหน้า
                </button>
                <button
                  onClick={() => setTablePage(p => p + 1)}
                  disabled={tablePage === tablePageCount}
                  className="border-border text-foreground rounded-lg border px-3 py-1 text-xs disabled:opacity-40"
                >
                  ถัดไป →
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <Dialog open={mapExpanded} onOpenChange={setMapExpanded}>
        <DialogContent
          className="max-w-5xl overflow-hidden p-0"
          style={{ height: '80vh' }}
        >
          <div className="flex h-full flex-col">
            <div className="border-border flex items-center justify-between border-b px-5 py-3 pr-12">
              <div>
                <DialogTitle>แผนที่สถานีทั่วประเทศ</DialogTitle>
                <p className="text-muted-foreground text-xs">
                  แสดง {filteredStations.length} สถานี
                  {filteredStations.length !== stations.length && ` (กรองจาก ${stations.length})`}
                </p>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ThailandMap stations={filteredStations} />
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
