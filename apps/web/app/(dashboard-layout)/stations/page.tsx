'use client'

import * as React from 'react'
import * as XLSX from 'xlsx'
import { getTransportLabel, getChecklistTemplate } from '@/lib/constants'
import { useStations, useCreateStation, usePendingReviews, useApproveChecklist } from '@/hooks/use-stations'
import { getChecklistHistory } from '@/lib/api/checklists'
import { saveDraft } from '@/lib/api/checklists'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { useQueryClient } from '@tanstack/react-query'
import type { TransportMode, StationStatus } from '@repo/types'
import type { CreateStationInput, ParsedRow } from '@/lib/api/stations'
import { StatusBadge, ScoreBar } from '@/components/shared/badges'
import { Search, Filter, ClipboardList, Building2, CheckCircle, Loader2, Upload, X } from 'lucide-react'
import Link from 'next/link'

function ApproveButton({ stationId }: { stationId: string }) {
  const qc = useQueryClient()
  const approveMutation = useApproveChecklist()
  const [loading, setLoading] = React.useState(false)

  async function handleApprove(e: React.MouseEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const history = await qc.fetchQuery({
        queryKey: ['checklist', stationId, 'history'],
        queryFn: () => getChecklistHistory(stationId),
      })
      const submitted = history.find(c => c.status === 'SUBMITTED')
      if (submitted) {
        await approveMutation.mutateAsync({ stationId, checklistId: submitted.id })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleApprove}
      disabled={loading}
      className="flex items-center gap-1 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-60"
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle size={11} />}
      อนุมัติ
    </button>
  )
}

// ---- Constants ----
const TRANSPORT_MODES: TransportMode[] = ['ทางบก', 'ทางราง', 'ทางเรือ', 'ทางอากาศ']
const RAIL_SUBTYPES = ['รถไฟ', 'รถไฟฟ้า']
const STATUS_OPTIONS: StationStatus[] = ['ผ่านมาตรฐาน', 'ต้องปรับปรุง', 'ไม่ผ่าน']
const SELECT_CLS = 'border-input bg-background text-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1'
const INPUT_CLS  = 'border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1'

const REQUIRED_BULK_COLS = ['nameth', 'mode', 'province', 'region', 'responsibleagency', 'lat', 'lng'] as const

function normalizeKey(k: string) { return k.toLowerCase().replace(/\s/g, '') }

function parseRows(raw: Record<string, unknown>[]): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = []
  const rows: ParsedRow[] = []
  raw.forEach((obj, i) => {
    const row: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) row[normalizeKey(k)] = obj[k]
    const missing = REQUIRED_BULK_COLS.filter(c => !row[c])
    if (missing.length) { errors.push(`แถว ${i + 2}: ขาดคอลัมน์ ${missing.join(', ')}`); return }
    const lat = parseFloat(String(row['lat']))
    const lng = parseFloat(String(row['lng']))
    if (isNaN(lat) || isNaN(lng)) { errors.push(`แถว ${i + 2}: lat/lng ไม่ใช่ตัวเลข`); return }
    if (!TRANSPORT_MODES.includes(row['mode'] as TransportMode)) {
      errors.push(`แถว ${i + 2}: mode "${row['mode']}" ไม่ถูกต้อง`); return
    }
    rows.push({
      nameTh: String(row['nameth'] ?? ''),
      name:   String(row['name'] ?? row['nameth'] ?? ''),
      mode:   String(row['mode']),
      railSubtype: row['railsubtype'] ? String(row['railsubtype']) : undefined,
      province:          String(row['province']),
      region:            String(row['region']),
      responsibleAgency: String(row['responsibleagency']),
      lat, lng,
    })
  })
  return { rows, errors }
}

// ---- Page ----
export default function StationsPage() {
  const { data: stations = [], isLoading, error } = useStations()
  const { data: pendingIds = [] } = usePendingReviews()
  const createStation = useCreateStation()

  const REGIONS = React.useMemo(() => [...new Set(stations.map(s => s.region))].sort(), [stations])
  const AGENCIES = React.useMemo(() => [...new Set(stations.map(s => s.responsibleAgency))].sort(), [stations])

  // Filters
  const [search,       setSearch]       = React.useState('')
  const [typeFilter,   setTypeFilter]   = React.useState<TransportMode | ''>('')
  const [statusFilter, setStatusFilter] = React.useState<StationStatus | ''>('')
  const [agencyFilter, setAgencyFilter] = React.useState('')
  const [regionFilter, setRegionFilter] = React.useState('')

  // Sheet
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [sheetMode, setSheetMode] = React.useState<'single' | 'bulk'>('single')

  // Single form
  const emptyForm: CreateStationInput = { nameTh: '', name: '', mode: 'ทางบก', province: '', region: '', responsibleAgency: '', lat: 0, lng: 0 }
  const [form, setForm] = React.useState<CreateStationInput>(emptyForm)
  const [formError, setFormError] = React.useState('')
  const [formSaving, setFormSaving] = React.useState(false)

  // Bulk import
  const [bulkRows,   setBulkRows]   = React.useState<ParsedRow[]>([])
  const [bulkErrors, setBulkErrors] = React.useState<string[]>([])
  const [bulkProgress, setBulkProgress] = React.useState<string>('')
  const fileRef = React.useRef<HTMLInputElement>(null)

  function patchForm(patch: Partial<CreateStationInput>) {
    setForm(f => ({ ...f, ...patch }))
  }

  async function handleSingleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.nameTh || !form.mode || !form.province || !form.region || !form.responsibleAgency) {
      setFormError('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน')
      return
    }
    setFormError('')
    setFormSaving(true)
    try {
      const station = await createStation.mutateAsync(form)
      const template = getChecklistTemplate(form.mode as TransportMode)
      await saveDraft(station.id, template)
      setForm(emptyForm)
      setSheetOpen(false)
    } catch (err) {
      setFormError((err as Error).message ?? 'เกิดข้อผิดพลาด')
    } finally {
      setFormSaving(false)
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()

    if (file.name.endsWith('.json')) {
      reader.onload = ev => {
        try {
          const parsed = JSON.parse(ev.target?.result as string) as unknown
          if (!Array.isArray(parsed)) { setBulkErrors(['ไฟล์ JSON ต้องเป็น array']); setBulkRows([]); return }
          const { rows, errors } = parseRows(parsed as Record<string, unknown>[])
          setBulkRows(rows); setBulkErrors(errors)
        } catch {
          setBulkErrors(['ไฟล์ JSON ไม่ถูกต้อง']); setBulkRows([])
        }
      }
      reader.readAsText(file)
    } else {
      reader.onload = ev => {
        try {
          const wb = XLSX.read(ev.target?.result, { type: 'array' })
          const sheetName = wb.SheetNames[0]
          if (!sheetName) { setBulkErrors(['ไฟล์ว่างเปล่า']); setBulkRows([]); return }
          const ws = wb.Sheets[sheetName]
          if (!ws) { setBulkErrors(['ไม่พบชีตข้อมูล']); setBulkRows([]); return }
          const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
          const { rows, errors } = parseRows(raw)
          setBulkRows(rows); setBulkErrors(errors)
        } catch {
          setBulkErrors(['ไม่สามารถอ่านไฟล์ได้']); setBulkRows([])
        }
      }
      reader.readAsArrayBuffer(file)
    }
  }

  async function handleBulkImport() {
    if (bulkRows.length === 0) return
    const total = bulkRows.length
    setBulkProgress(`กำลังสร้าง 0/${total}...`)
    let done = 0
    for (const row of bulkRows) {
      try {
        const station = await createStation.mutateAsync(row)
        const template = getChecklistTemplate(row.mode as TransportMode)
        await saveDraft(station.id, template)
      } catch {
        // individual failures: skip and continue
      }
      done++
      setBulkProgress(`กำลังสร้าง ${done}/${total}...`)
    }
    setBulkProgress('')
    setBulkRows([])
    setBulkErrors([])
    if (fileRef.current) fileRef.current.value = ''
    setSheetOpen(false)
  }

  if (isLoading) return (
    <div className="flex items-center justify-center p-16 text-sm text-muted-foreground">กำลังโหลด…</div>
  )
  if (error) return (
    <div className="flex items-center justify-center p-16 text-sm text-red-500">เกิดข้อผิดพลาด: {(error as Error).message}</div>
  )

  const filtered = stations.filter(s => {
    const matchSearch  = !search       || s.nameTh.includes(search) || s.name.toLowerCase().includes(search.toLowerCase()) || s.province.includes(search)
    const matchType    = !typeFilter   || s.mode === typeFilter
    const matchStatus  = !statusFilter || s.status === statusFilter
    const matchAgency  = !agencyFilter || s.responsibleAgency === agencyFilter
    const matchRegion  = !regionFilter || s.region === regionFilter
    return matchSearch && matchType && matchStatus && matchAgency && matchRegion
  })

  const hasFilters = !!(search || typeFilter || statusFilter || agencyFilter || regionFilter)

  function clearFilters() {
    setSearch(''); setTypeFilter(''); setStatusFilter(''); setAgencyFilter(''); setRegionFilter('')
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold">จัดการสถานี</h1>
          <p className="text-muted-foreground text-sm">
            สถานีทั้งหมด {stations.length} แห่ง · แสดงผล {filtered.length} รายการ
            {pendingIds.length > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                {pendingIds.length} รายการรอรีวิว
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => { setSheetOpen(true); setSheetMode('single') }}
          className="bg-primary text-primary-foreground flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
        >
          <Building2 size={14} />
          เพิ่มสถานี
        </button>
      </div>

      {/* Filters */}
      <div className="bg-card border-border rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search size={13} className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2" />
            <input
              type="text"
              placeholder="ค้นหาสถานี จังหวัด..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border py-2 pr-3 pl-8 text-sm focus:outline-none focus:ring-1"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={13} className="text-muted-foreground" />
            <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as TransportMode | '')} className={SELECT_CLS.replace('w-full ', '')}>
              <option value="">ประเภทการขนส่ง</option>
              {TRANSPORT_MODES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StationStatus | '')} className={SELECT_CLS.replace('w-full ', '')}>
            <option value="">สถานะทั้งหมด</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={regionFilter} onChange={e => setRegionFilter(e.target.value)} className={SELECT_CLS.replace('w-full ', '')}>
            <option value="">ทุกภาค</option>
            {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={agencyFilter} onChange={e => setAgencyFilter(e.target.value)} className={SELECT_CLS.replace('w-full ', '')}>
            <option value="">ทุกหน่วยงาน</option>
            {AGENCIES.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="text-muted-foreground hover:text-foreground text-sm underline">
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
                filtered.map(station => {
                  const hasPending = pendingIds.includes(station.id)
                  return (
                    <tr key={station.id} className="border-border hover:bg-secondary/30 border-b transition-colors last:border-0">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          <div>
                            <p className="text-foreground font-medium">{station.nameTh}</p>
                            <p className="text-muted-foreground text-xs">{station.name}</p>
                          </div>
                          {hasPending && (
                            <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                              รอรีวิว
                            </span>
                          )}
                        </div>
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
                          {station.lastInspected
                            ? new Date(station.lastInspected).toLocaleDateString('th-TH')
                            : '—'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-2">
                          {hasPending && <ApproveButton stationId={station.id} />}
                          <Link
                            href={`/stations/${station.id}`}
                            className="border-border text-foreground hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
                          >
                            <ClipboardList size={12} />
                            Checklist
                          </Link>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Station Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader className="mb-6">
            <SheetTitle>เพิ่มสถานี</SheetTitle>
          </SheetHeader>

          {/* Mode toggle */}
          <div className="mb-6 flex gap-2">
            <button
              onClick={() => setSheetMode('single')}
              className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${sheetMode === 'single' ? 'bg-primary text-primary-foreground border-transparent' : 'border-border text-muted-foreground hover:bg-secondary'}`}
            >
              เพิ่มสถานีใหม่
            </button>
            <button
              onClick={() => setSheetMode('bulk')}
              className={`flex-1 rounded-lg border py-2 text-sm font-medium transition-colors ${sheetMode === 'bulk' ? 'bg-primary text-primary-foreground border-transparent' : 'border-border text-muted-foreground hover:bg-secondary'}`}
            >
              นำเข้าหลายสถานี
            </button>
          </div>

          {/* Single form */}
          {sheetMode === 'single' && (
            <form onSubmit={handleSingleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-foreground mb-1 block text-xs font-medium">ชื่อสถานี (ภาษาไทย) *</label>
                  <input className={INPUT_CLS} value={form.nameTh} onChange={e => patchForm({ nameTh: e.target.value })} placeholder="สถานีรถไฟ..." required />
                </div>
                <div>
                  <label className="text-foreground mb-1 block text-xs font-medium">Station Name (EN)</label>
                  <input className={INPUT_CLS} value={form.name} onChange={e => patchForm({ name: e.target.value })} placeholder="Railway Station..." />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-foreground mb-1 block text-xs font-medium">ประเภทการขนส่ง *</label>
                  <select className={SELECT_CLS} value={form.mode} onChange={e => patchForm({ mode: e.target.value, railSubtype: undefined })} required>
                    {TRANSPORT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {form.mode === 'ทางราง' && (
                  <div>
                    <label className="text-foreground mb-1 block text-xs font-medium">ประเภทย่อย</label>
                    <select className={SELECT_CLS} value={form.railSubtype ?? ''} onChange={e => patchForm({ railSubtype: e.target.value || undefined })}>
                      <option value="">ไม่ระบุ</option>
                      {RAIL_SUBTYPES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-foreground mb-1 block text-xs font-medium">จังหวัด *</label>
                  <input className={INPUT_CLS} value={form.province} onChange={e => patchForm({ province: e.target.value })} placeholder="กรุงเทพมหานคร" required />
                </div>
                <div>
                  <label className="text-foreground mb-1 block text-xs font-medium">ภาค *</label>
                  <input className={INPUT_CLS} value={form.region} list="regions-list" onChange={e => patchForm({ region: e.target.value })} placeholder="กลาง" required />
                  <datalist id="regions-list">
                    {REGIONS.map(r => <option key={r} value={r} />)}
                  </datalist>
                </div>
              </div>

              <div>
                <label className="text-foreground mb-1 block text-xs font-medium">หน่วยงานรับผิดชอบ *</label>
                <input className={INPUT_CLS} value={form.responsibleAgency} list="agencies-list" onChange={e => patchForm({ responsibleAgency: e.target.value })} placeholder="รฟท." required />
                <datalist id="agencies-list">
                  {AGENCIES.map(a => <option key={a} value={a} />)}
                </datalist>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-foreground mb-1 block text-xs font-medium">ละติจูด *</label>
                  <input type="number" step="any" className={INPUT_CLS} value={form.lat || ''} onChange={e => patchForm({ lat: parseFloat(e.target.value) || 0 })} placeholder="13.7563" required />
                </div>
                <div>
                  <label className="text-foreground mb-1 block text-xs font-medium">ลองจิจูด *</label>
                  <input type="number" step="any" className={INPUT_CLS} value={form.lng || ''} onChange={e => patchForm({ lng: parseFloat(e.target.value) || 0 })} placeholder="100.5018" required />
                </div>
              </div>

              {formError && <p className="text-destructive text-xs">{formError}</p>}

              <div className="flex gap-3 pt-2">
                <button
                  type="submit"
                  disabled={formSaving}
                  className="bg-primary text-primary-foreground flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium disabled:opacity-60"
                >
                  {formSaving ? <Loader2 size={14} className="animate-spin" /> : null}
                  {formSaving ? 'กำลังบันทึก...' : 'บันทึกสถานี'}
                </button>
                <button type="button" onClick={() => setSheetOpen(false)} className="border-border rounded-lg border px-4 py-2 text-sm">
                  ยกเลิก
                </button>
              </div>
            </form>
          )}

          {/* Bulk import */}
          {sheetMode === 'bulk' && (
            <div className="space-y-4">
              <p className="text-muted-foreground text-xs">
                รองรับไฟล์ .xlsx, .xls, .csv, .json · คอลัมน์ที่จำเป็น: nameTh, mode, province, region, responsibleAgency, lat, lng
              </p>

              <label className="border-border hover:bg-secondary flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors">
                <Upload size={20} className="text-muted-foreground" />
                <span className="text-muted-foreground text-sm">คลิกเพื่อเลือกไฟล์</span>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.json" className="hidden" onChange={handleFileChange} />
              </label>

              {bulkErrors.length > 0 && (
                <div className="bg-destructive/5 rounded-lg p-3">
                  <p className="text-destructive mb-1 text-xs font-medium">พบข้อผิดพลาด {bulkErrors.length} รายการ</p>
                  {bulkErrors.slice(0, 5).map((e, i) => <p key={i} className="text-muted-foreground text-[10px]">{e}</p>)}
                  {bulkErrors.length > 5 && <p className="text-muted-foreground text-[10px]">และอีก {bulkErrors.length - 5} รายการ</p>}
                </div>
              )}

              {bulkRows.length > 0 && (
                <div className="bg-secondary/50 rounded-lg p-3">
                  <p className="text-foreground text-sm font-medium">พบ {bulkRows.length} สถานี พร้อมนำเข้า</p>
                  <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                    {bulkRows.slice(0, 10).map((r, i) => (
                      <p key={i} className="text-muted-foreground text-xs">· {r.nameTh} ({r.mode})</p>
                    ))}
                    {bulkRows.length > 10 && <p className="text-muted-foreground text-xs">และอีก {bulkRows.length - 10} สถานี</p>}
                  </div>
                </div>
              )}

              {bulkProgress && (
                <div className="flex items-center gap-2">
                  <Loader2 size={14} className="text-muted-foreground animate-spin" />
                  <span className="text-muted-foreground text-sm">{bulkProgress}</span>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={handleBulkImport}
                  disabled={bulkRows.length === 0 || !!bulkProgress}
                  className="bg-primary text-primary-foreground flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                >
                  นำเข้า {bulkRows.length > 0 ? `${bulkRows.length} สถานี` : ''}
                </button>
                <button
                  type="button"
                  onClick={() => { setBulkRows([]); setBulkErrors([]); if (fileRef.current) fileRef.current.value = '' }}
                  className="border-border rounded-lg border px-3 py-2"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
