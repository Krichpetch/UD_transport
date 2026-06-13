'use client'

import * as React from 'react'
import { getTransportLabel, RESPONSIBLE_AGENCIES } from '@/lib/mock-data'
import { useStations, useStationSummary } from '@/hooks/use-stations'
import type { TransportMode, StationStatus } from '@repo/types'
import { StationBarChart } from '@/components/charts/StationBarChart'
import { ThailandMap } from '@/components/maps/ThailandMap'
import { TrendingUp, TrendingDown, Building2, CheckCircle2, AlertTriangle, XCircle, AlertCircle, Filter, X } from 'lucide-react'

// ---- Helpers ----
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string }> = {
    'ผ่านมาตรฐาน': { bg: 'bg-[#52aa4e]/10 text-[#52aa4e]', text: 'ผ่านมาตรฐาน' },
    'ต้องปรับปรุง': { bg: 'bg-[#ffc107]/10 text-[#b38600]', text: 'ต้องปรับปรุง' },
    'ไม่ผ่าน': { bg: 'bg-[#f44336]/10 text-[#f44336]', text: 'ไม่ผ่าน' },
  }
  const s = map[status] ?? { bg: 'bg-secondary text-muted-foreground', text: status }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${s.bg}`}>
      {s.text}
    </span>
  )
}

function TransportBadge({ type }: { type: string }) {
  const map: Record<string, string> = {
    'ทางบก':    'bg-blue-50 text-blue-700',
    'ทางราง':   'bg-purple-50 text-purple-700',
    'ทางเรือ':  'bg-cyan-50 text-cyan-700',
    'ทางอากาศ': 'bg-orange-50 text-orange-700',
    'รถไฟ':     'bg-purple-50 text-purple-700',
    'รถไฟฟ้า':  'bg-indigo-50 text-indigo-700',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[type] ?? 'bg-secondary text-muted-foreground'}`}>
      {type}
    </span>
  )
}

const TRANSPORT_MODES: TransportMode[] = ['ทางบก', 'ทางราง', 'ทางเรือ', 'ทางอากาศ']
const CHECKLIST_CATEGORIES = [
  { value: 'A', label: 'A — การเข้าถึง (Accessibility)' },
  { value: 'B', label: 'B — การดำเนินงาน (Operation)' },
  { value: 'C', label: 'C — บุคลากร (Staff)' },
]

const SELECT_CLS = 'border-input bg-background text-foreground focus:ring-ring rounded-lg border px-3 py-1.5 text-xs focus:outline-none focus:ring-1'

// ---- Page ----
export default function DashboardPage() {
  const { data: summary } = useStationSummary()
  const { data: stations = [] } = useStations()
  const REGIONS = React.useMemo(
    () => [...new Set(stations.map(s => s.region))].sort(),
    [stations],
  )

  const [modeFilter, setModeFilter] = React.useState<TransportMode | ''>('')
  const [regionFilter, setRegionFilter] = React.useState('')
  const [agencyFilter, setAgencyFilter] = React.useState('')
  const [categoryFilter, setCategoryFilter] = React.useState<'A' | 'B' | 'C' | ''>('')

  const hasFilters = !!(modeFilter || regionFilter || agencyFilter || categoryFilter)

  function clearFilters() {
    setModeFilter('')
    setRegionFilter('')
    setAgencyFilter('')
    setCategoryFilter('')
  }

  const filteredStations = stations.filter(s =>
    (!modeFilter   || s.mode === modeFilter) &&
    (!regionFilter || s.region === regionFilter) &&
    (!agencyFilter || s.responsibleAgency === agencyFilter)
  )

  const urgentStations = filteredStations.filter(
    (s) => s.status === 'ไม่ผ่าน' || s.urgentIssues.length > 0
  )

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-foreground text-xl font-bold">ภาพรวมระบบ</h1>
        <p className="text-muted-foreground text-sm">
          ข้อมูล ณ วันที่ 4 มิถุนายน 2569 · สถานี 831 แห่งทั่วประเทศ
        </p>
      </div>

      {/* Filter bar */}
      <div className="bg-card border-border rounded-xl border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Filter size={13} className="text-muted-foreground shrink-0" />

          <select
            value={modeFilter}
            onChange={(e) => setModeFilter(e.target.value as TransportMode | '')}
            className={SELECT_CLS}
          >
            <option value="">ประเภทการขนส่ง</option>
            {TRANSPORT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>

          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">ทุกภาค</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>

          <select
            value={agencyFilter}
            onChange={(e) => setAgencyFilter(e.target.value)}
            className={SELECT_CLS}
          >
            <option value="">ทุกหน่วยงาน</option>
            {RESPONSIBLE_AGENCIES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'A' | 'B' | 'C' | '')}
            className={SELECT_CLS}
          >
            <option value="">ทุกหมวดรายการ</option>
            {CHECKLIST_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>

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

      {/* KPI Cards — static aggregate (full 831-station dataset) */}
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
          <StationBarChart />
        </div>

        <div className="bg-card border-border rounded-xl border p-5 lg:col-span-2">
          <div className="mb-4">
            <h2 className="text-foreground text-sm font-semibold">แผนที่สถานีทั่วประเทศ</h2>
            <p className="text-muted-foreground text-xs">แสดงสถานะตามพื้นที่</p>
          </div>
          <div className="h-[260px]">
            <ThailandMap />
          </div>
        </div>
      </div>

      {/* Urgent + Table */}
      <div className="grid gap-4 lg:grid-cols-5">
        {/* Urgent stations */}
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
              {urgentStations.slice(0, 5).map((station) => (
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

        {/* Station table */}
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
          <div className="overflow-x-auto">
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
                  filteredStations.map((station) => (
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
                            color: station.score >= 75 ? 'var(--status-pass)' : station.score >= 50 ? 'var(--status-warn)' : 'var(--status-fail)',
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
        </div>
      </div>
    </div>
  )
}
