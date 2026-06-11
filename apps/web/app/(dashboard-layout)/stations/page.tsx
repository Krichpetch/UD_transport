'use client'

import * as React from 'react'
import {
  mockStations,
  getTransportLabel,
  RESPONSIBLE_AGENCIES,
} from '@/lib/mock-data'
import type { Station, TransportMode, StationStatus } from '@repo/types'
import { Search, Filter, ClipboardList, Pencil, Building2 } from 'lucide-react'
import Link from 'next/link'

function StatusBadge({ status }: { status: StationStatus }) {
  const map: Record<StationStatus, string> = {
    'ผ่านมาตรฐาน': 'bg-[#52aa4e]/10 text-[#52aa4e]',
    'ต้องปรับปรุง': 'bg-[#ffc107]/10 text-[#b38600]',
    'ไม่ผ่าน': 'bg-[#f44336]/10 text-[#f44336]',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${map[status]}`}>
      {status}
    </span>
  )
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 75 ? '#52aa4e' : score >= 50 ? '#ffc107' : '#f44336'
  return (
    <div className="flex items-center gap-2">
      <div className="bg-secondary h-1.5 w-16 overflow-hidden rounded-full">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-foreground text-xs font-semibold" style={{ color }}>{score}</span>
    </div>
  )
}

const TRANSPORT_MODES: TransportMode[] = ['ทางบก', 'ทางราง', 'ทางเรือ', 'ทางอากาศ']
const STATUS_OPTIONS: StationStatus[] = ['ผ่านมาตรฐาน', 'ต้องปรับปรุง', 'ไม่ผ่าน']
const REGIONS = [...new Set(mockStations.map(s => s.region))].sort()

export default function StationsPage() {
  const [search, setSearch] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState<TransportMode | ''>('')
  const [statusFilter, setStatusFilter] = React.useState<StationStatus | ''>('')
  const [agencyFilter, setAgencyFilter] = React.useState('')
  const [regionFilter, setRegionFilter] = React.useState('')

  const filtered = mockStations.filter((s) => {
    const matchSearch =
      !search ||
      s.nameTh.includes(search) ||
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.province.includes(search)
    const matchType   = !typeFilter   || s.mode === typeFilter
    const matchStatus = !statusFilter || s.status === statusFilter
    const matchAgency = !agencyFilter || s.responsibleAgency === agencyFilter
    const matchRegion = !regionFilter || s.region === regionFilter
    return matchSearch && matchType && matchStatus && matchAgency && matchRegion
  })

  const hasFilters = !!(search || typeFilter || statusFilter || agencyFilter || regionFilter)

  function clearFilters() {
    setSearch('')
    setTypeFilter('')
    setStatusFilter('')
    setAgencyFilter('')
    setRegionFilter('')
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold">จัดการสถานี</h1>
          <p className="text-muted-foreground text-sm">
            สถานีทั้งหมด {mockStations.length} แห่ง · แสดงผล {filtered.length} รายการ
          </p>
        </div>
        <button className="bg-primary text-primary-foreground flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90">
          <Building2 size={14} />
          เพิ่มสถานี
        </button>
      </div>

      {/* Filters */}
      <div className="bg-card border-border rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative min-w-[200px] flex-1">
            <Search size={13} className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ค้นหาสถานี จังหวัด..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border py-2 pr-3 pl-8 text-sm focus:outline-none focus:ring-1"
            />
          </div>

          {/* Transport type */}
          <div className="flex items-center gap-1.5">
            <Filter size={13} className="text-muted-foreground" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as TransportMode | '')}
              className="border-input bg-background text-foreground focus:ring-ring rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
            >
              <option value="">ประเภทการขนส่ง</option>
              {TRANSPORT_MODES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StationStatus | '')}
            className="border-input bg-background text-foreground focus:ring-ring rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
          >
            <option value="">สถานะทั้งหมด</option>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>

          {/* Region */}
          <select
            value={regionFilter}
            onChange={(e) => setRegionFilter(e.target.value)}
            className="border-input bg-background text-foreground focus:ring-ring rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
          >
            <option value="">ทุกภาค</option>
            {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>

          {/* Agency */}
          <select
            value={agencyFilter}
            onChange={(e) => setAgencyFilter(e.target.value)}
            className="border-input bg-background text-foreground focus:ring-ring rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1"
          >
            <option value="">ทุกหน่วยงาน</option>
            {RESPONSIBLE_AGENCIES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>

          {hasFilters && (
            <button
              onClick={clearFilters}
              className="text-muted-foreground hover:text-foreground text-sm underline"
            >
              ล้างตัวกรอง
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border-border overflow-hidden rounded-xl border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border bg-secondary/30 border-b">
                <th className="text-muted-foreground px-5 py-3 text-left text-xs font-medium uppercase tracking-wide">ชื่อสถานี</th>
                <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium uppercase tracking-wide">ประเภท</th>
                <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium uppercase tracking-wide">จังหวัด / ภาค</th>
                <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium uppercase tracking-wide">หน่วยงาน</th>
                <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium uppercase tracking-wide">คะแนน UD</th>
                <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium uppercase tracking-wide">สถานะ</th>
                <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium uppercase tracking-wide">ตรวจล่าสุด</th>
                <th className="text-muted-foreground px-5 py-3 text-right text-xs font-medium uppercase tracking-wide">ดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-muted-foreground py-12 text-center text-sm">
                    ไม่พบสถานีที่ตรงกับเงื่อนไข
                  </td>
                </tr>
              ) : (
                filtered.map((station) => (
                  <tr
                    key={station.id}
                    className="border-border hover:bg-secondary/30 border-b transition-colors last:border-0"
                  >
                    <td className="px-5 py-3.5">
                      <p className="text-foreground font-medium">{station.nameTh}</p>
                      <p className="text-muted-foreground text-xs">{station.name}</p>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="text-foreground text-xs">{getTransportLabel(station)}</span>
                    </td>
                    <td className="px-3 py-3.5">
                      <p className="text-foreground text-xs">{station.province}</p>
                      <p className="text-muted-foreground text-xs">{station.region}</p>
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="text-foreground text-xs font-medium">{station.responsibleAgency}</span>
                    </td>
                    <td className="px-3 py-3.5">
                      <ScoreBar score={station.score} />
                    </td>
                    <td className="px-3 py-3.5">
                      <StatusBadge status={station.status} />
                    </td>
                    <td className="px-3 py-3.5">
                      <span className="text-muted-foreground text-xs">
                        {station.lastInspected ?? '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/stations/${station.id}`}
                          className="border-border text-foreground hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
                        >
                          <ClipboardList size={12} />
                          Checklist
                        </Link>
                        <button className="border-border text-muted-foreground hover:bg-secondary rounded-lg border p-1.5 transition-colors">
                          <Pencil size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
