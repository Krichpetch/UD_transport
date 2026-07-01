'use client'

import * as React from 'react'
import * as XLSX from 'xlsx'
import { getTransportLabel, getChecklistTemplate } from '@/lib/constants'
import {
  useStations,
  useCreateStation,
  usePendingReviews,
  useApproveChecklist,
  useStationFilterOptions,
} from '@/hooks/use-stations'
import { getChecklistHistory } from '@/lib/api/checklists'
import { saveDraft } from '@/lib/api/checklists'
import { useQueryClient } from '@tanstack/react-query'
import type { TransportMode, StationStatus, ResponsibleAgency } from '@repo/types'
import { TRANSPORT_MODE_AGENCIES } from '@repo/types'
import type { CreateStationInput, ParsedRow } from '@/lib/api/stations'
import { batchOtpImport } from '@/lib/api/stations'
import { parseOtpRows, detectOtpFormat } from '@/lib/otp-import'
import type { OtpParsedRow, OtpParseResult } from '@/lib/otp-import'
import { StatusBadge, ScoreBar } from '@/components/shared/badges'
import {
  Search,
  Filter,
  ClipboardList,
  Building2,
  CheckCircle,
  Loader2,
  Upload,
  X,
  FileSpreadsheet,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from 'lucide-react'
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
      const submitted = history.find((c) => c.status === 'SUBMITTED')
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
const SELECT_CLS =
  'border-input bg-background text-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1'
const INPUT_CLS =
  'border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1'

const REQUIRED_BULK_COLS = [
  'nameth',
  'mode',
  'province',
  'region',
  'responsibleagency',
  'lat',
  'lng',
] as const

function normalizeKey(k: string) {
  return k.toLowerCase().replace(/\s/g, '')
}

function parseRows(raw: Record<string, unknown>[]): { rows: ParsedRow[]; errors: string[] } {
  const errors: string[] = []
  const rows: ParsedRow[] = []
  raw.forEach((obj, i) => {
    const row: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) row[normalizeKey(k)] = obj[k]
    const missing = REQUIRED_BULK_COLS.filter((c) => !row[c])
    if (missing.length) {
      errors.push(`แถว ${i + 2}: ขาดคอลัมน์ ${missing.join(', ')}`)
      return
    }
    const lat = parseFloat(String(row['lat']))
    const lng = parseFloat(String(row['lng']))
    if (isNaN(lat) || isNaN(lng)) {
      errors.push(`แถว ${i + 2}: lat/lng ไม่ใช่ตัวเลข`)
      return
    }
    if (!TRANSPORT_MODES.includes(row['mode'] as TransportMode)) {
      errors.push(`แถว ${i + 2}: mode "${row['mode']}" ไม่ถูกต้อง`)
      return
    }
    rows.push({
      nameTh: String(row['nameth'] ?? ''),
      name: String(row['name'] ?? row['nameth'] ?? ''),
      mode: String(row['mode']),
      railSubtype: row['railsubtype'] ? String(row['railsubtype']) : undefined,
      province: String(row['province']),
      region: String(row['region']),
      responsibleAgency: String(row['responsibleagency']),
      lat,
      lng,
    })
  })
  return { rows, errors }
}

const PAGE_SIZE = 20

type SortableCol = 'nameTh' | 'province' | 'responsibleAgency' | 'score' | 'status' | 'lastInspected'

// ---- Page ----
export default function StationsPage() {
  // Filters — declared before useStations so they can be passed as params
  const [search, setSearch] = React.useState('')
  const [typeFilter, setTypeFilter] = React.useState<TransportMode | ''>('')
  const [statusFilter, setStatusFilter] = React.useState<StationStatus | ''>('')
  const [agencyFilter, setAgencyFilter] = React.useState('')
  const [regionFilter, setRegionFilter] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [sortBy, setSortBy] = React.useState<SortableCol>('nameTh')
  const [sortOrder, setSortOrder] = React.useState<'asc' | 'desc'>('asc')
  const [excelExporting, setExcelExporting] = React.useState(false)

  const {
    data: stationsPage,
    isLoading,
    error,
  } = useStations({
    mode:      typeFilter || undefined,
    status:    statusFilter || undefined,
    agency:    agencyFilter || undefined,
    region:    regionFilter || undefined,
    search:    search || undefined,
    page,
    limit:     PAGE_SIZE,
    sortBy,
    sortOrder,
  })
  const stations = stationsPage?.data ?? []
  const total = stationsPage?.total ?? 0
  const totalPages = stationsPage?.totalPages ?? 1

  const { data: filterOptions } = useStationFilterOptions()
  const { data: pendingIds = [] } = usePendingReviews()
  const createStation = useCreateStation()

  const availableAgencies = typeFilter
    ? TRANSPORT_MODE_AGENCIES[typeFilter]
    : (filterOptions?.agencies ?? [])
  const availableModes: TransportMode[] = agencyFilter
    ? (Object.entries(TRANSPORT_MODE_AGENCIES) as [TransportMode, readonly string[]][])
        .filter(([, agencies]) => agencies.includes(agencyFilter))
        .map(([mode]) => mode)
    : TRANSPORT_MODES

  // Sheet
  const [sheetOpen, setSheetOpen] = React.useState(false)
  const [sheetMode, setSheetMode] = React.useState<'single' | 'bulk'>('single')

  // Single form
  const emptyForm: CreateStationInput = {
    nameTh: '',
    name: '',
    mode: 'ทางบก',
    province: '',
    region: '',
    responsibleAgency: '',
    lat: 0,
    lng: 0,
  }
  const [form, setForm] = React.useState<CreateStationInput>(emptyForm)
  const [formError, setFormError] = React.useState('')
  const [formSaving, setFormSaving] = React.useState(false)

  // Bulk import
  const [bulkRows, setBulkRows] = React.useState<ParsedRow[]>([])
  const [otpRows, setOtpRows] = React.useState<OtpParsedRow[]>([])
  const [bulkFormat, setBulkFormat] = React.useState<'standard' | 'otp'>('standard')
  const [bulkErrors, setBulkErrors] = React.useState<string[]>([])
  const [bulkProgress, setBulkProgress] = React.useState<string>('')
  const [otpStats, setOtpStats] = React.useState<OtpParseResult['stats'] | null>(null)
  const [otpOutOfTimeframe, setOtpOutOfTimeframe] = React.useState<
    OtpParseResult['outOfTimeframe']
  >([])
  const [otpUnknownCodes, setOtpUnknownCodes] = React.useState<string[]>([])
  const fileRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false)
    }
    if (sheetOpen) window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [sheetOpen])

  function patchForm(patch: Partial<CreateStationInput>) {
    setForm((f) => ({ ...f, ...patch }))
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
    setBulkRows([])
    setOtpRows([])
    setBulkErrors([])
    const reader = new FileReader()

    if (file.name.endsWith('.json')) {
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string) as unknown
          if (!Array.isArray(parsed)) {
            setBulkErrors(['ไฟล์ JSON ต้องเป็น array'])
            return
          }
          const { rows, errors } = parseRows(parsed as Record<string, unknown>[])
          setBulkFormat('standard')
          setBulkRows(rows)
          setBulkErrors(errors)
        } catch {
          setBulkErrors(['ไฟล์ JSON ไม่ถูกต้อง'])
        }
      }
      reader.readAsText(file)
    } else {
      reader.onload = (ev) => {
        try {
          const wb = XLSX.read(ev.target?.result, { type: 'array' })
          const sheetName = wb.SheetNames[0]
          if (!sheetName) {
            setBulkErrors(['ไฟล์ว่างเปล่า'])
            return
          }
          const ws = wb.Sheets[sheetName]
          if (!ws) {
            setBulkErrors(['ไม่พบชีตข้อมูล'])
            return
          }
          const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
          if (detectOtpFormat(raw)) {
            const { rows, errors, outOfTimeframe, unknownCodes, stats } = parseOtpRows(raw)
            setBulkFormat('otp')
            setOtpRows(rows)
            setBulkErrors(errors)
            setOtpStats(stats)
            setOtpOutOfTimeframe(outOfTimeframe)
            setOtpUnknownCodes(unknownCodes)
          } else {
            const { rows, errors } = parseRows(raw)
            setBulkFormat('standard')
            setBulkRows(rows)
            setBulkErrors(errors)
          }
        } catch {
          setBulkErrors(['ไม่สามารถอ่านไฟล์ได้'])
        }
      }
      reader.readAsArrayBuffer(file)
    }
  }

  async function handleBulkImport() {
    if (bulkRows.length === 0) return
    const bulkTotal = bulkRows.length
    setBulkProgress(`กำลังสร้าง 0/${bulkTotal}...`)
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
      setBulkProgress(`กำลังสร้าง ${done}/${bulkTotal}...`)
    }
    setBulkProgress('')
    setBulkRows([])
    setBulkErrors([])
    if (fileRef.current) fileRef.current.value = ''
    setSheetOpen(false)
  }

  async function handleOtpImport() {
    if (otpRows.length === 0) return
    const otpTotal = otpRows.length
    const CHUNK = 50
    let done = 0
    setBulkProgress(`กำลังนำเข้าข้อมูล OTP 0/${otpTotal}...`)
    try {
      for (let i = 0; i < otpTotal; i += CHUNK) {
        await batchOtpImport(otpRows.slice(i, i + CHUNK))
        done = Math.min(i + CHUNK, otpTotal)
        setBulkProgress(`กำลังนำเข้าข้อมูล OTP ${done}/${otpTotal}...`)
      }
      setBulkProgress('')
      setOtpRows([])
      setBulkErrors([])
      setOtpStats(null)
      setOtpOutOfTimeframe([])
      setOtpUnknownCodes([])
      if (fileRef.current) fileRef.current.value = ''
      setSheetOpen(false)
    } catch (err) {
      setBulkProgress('')
      setBulkErrors([(err as Error).message ?? 'เกิดข้อผิดพลาด'])
    }
  }

  async function handleExportAll() {
    if (excelExporting) return
    setExcelExporting(true)
    try {
      const res = await fetch('/api/export/stations')
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `stations_export_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExcelExporting(false)
    }
  }

  if (isLoading)
    return (
      <div className="text-muted-foreground flex items-center justify-center p-16 text-sm">
        กำลังโหลด…
      </div>
    )
  if (error)
    return (
      <div className="flex items-center justify-center p-16 text-sm text-red-500">
        เกิดข้อผิดพลาด: {(error as Error).message}
      </div>
    )

  const hasFilters = !!(search || typeFilter || statusFilter || agencyFilter || regionFilter)

  function handleSort(col: SortableCol) {
    if (sortBy === col) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(col)
      setSortOrder('asc')
    }
    setPage(1)
  }

  function sortIcon(col: SortableCol) {
    if (sortBy !== col) return <ChevronsUpDown size={11} className="opacity-30" />
    return sortOrder === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
  }

  function clearFilters() {
    setSearch('')
    setTypeFilter('')
    setStatusFilter('')
    setAgencyFilter('')
    setRegionFilter('')
    setPage(1)
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold">จัดการสถานี</h1>
          <p className="text-muted-foreground text-sm">
            พบ {total} สถานี · แสดงผล {stations.length} รายการ
            {pendingIds.length > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                {pendingIds.length} รายการรอรีวิว
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExportAll}
            disabled={excelExporting}
            className="border-border text-muted-foreground hover:bg-secondary flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60"
          >
            {excelExporting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <FileSpreadsheet size={14} />
            )}
            Export ทั้งหมด
          </button>
          <button
            onClick={() => {
              setSheetOpen(true)
              setSheetMode('single')
            }}
            className="bg-primary text-primary-foreground flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
          >
            <Building2 size={14} />
            เพิ่มสถานี
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card border-border rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search
              size={13}
              className="text-muted-foreground absolute top-1/2 left-3 -translate-y-1/2"
            />
            <input
              type="text"
              placeholder="ค้นหาสถานี จังหวัด..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border py-2 pr-3 pl-8 text-sm focus:ring-1 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <Filter size={13} className="text-muted-foreground" />
            <select
              value={typeFilter}
              onChange={(e) => {
                const v = e.target.value as TransportMode | ''
                setTypeFilter(v)
                setPage(1)
                if (
                  agencyFilter &&
                  v &&
                  !TRANSPORT_MODE_AGENCIES[v].includes(agencyFilter as ResponsibleAgency)
                ) {
                  setAgencyFilter('')
                }
              }}
              className={SELECT_CLS.replace('w-full', '')}
            >
              <option value="">ประเภทการขนส่ง</option>
              {availableModes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as StationStatus | '')
              setPage(1)
            }}
            className={SELECT_CLS.replace('w-full', '')}
          >
            <option value="">สถานะทั้งหมด</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={regionFilter}
            onChange={(e) => {
              setRegionFilter(e.target.value)
              setPage(1)
            }}
            className={SELECT_CLS.replace('w-full', '')}
          >
            <option value="">ทุกภาค</option>
            {(filterOptions?.regions ?? []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            value={agencyFilter}
            onChange={(e) => {
              const v = e.target.value
              setAgencyFilter(v)
              setPage(1)
              if (typeFilter && v) {
                const modesForAgency = (
                  Object.entries(TRANSPORT_MODE_AGENCIES) as [TransportMode, readonly string[]][]
                )
                  .filter(([, agencies]) => agencies.includes(v))
                  .map(([mode]) => mode)
                if (!modesForAgency.includes(typeFilter)) setTypeFilter('')
              }
            }}
            className={SELECT_CLS.replace('w-full', '')}
          >
            <option value="">ทุกหน่วยงาน</option>
            {availableAgencies.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
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
                <th className="text-muted-foreground px-5 py-3 text-left text-xs font-medium tracking-wide uppercase">
                  <button onClick={() => handleSort('nameTh')} className="flex items-center gap-1 hover:text-foreground transition-colors">
                    ชื่อสถานี {sortIcon('nameTh')}
                  </button>
                </th>
                <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium tracking-wide uppercase">
                  ประเภท
                </th>
                <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium tracking-wide uppercase">
                  <button onClick={() => handleSort('province')} className="flex items-center gap-1 hover:text-foreground transition-colors">
                    จังหวัด / ภาค {sortIcon('province')}
                  </button>
                </th>
                <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium tracking-wide uppercase">
                  <button onClick={() => handleSort('responsibleAgency')} className="flex items-center gap-1 hover:text-foreground transition-colors">
                    หน่วยงาน {sortIcon('responsibleAgency')}
                  </button>
                </th>
                <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium tracking-wide uppercase">
                  <button onClick={() => handleSort('score')} className="flex items-center gap-1 hover:text-foreground transition-colors">
                    คะแนน UD {sortIcon('score')}
                  </button>
                </th>
                <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium tracking-wide uppercase">
                  <button onClick={() => handleSort('status')} className="flex items-center gap-1 hover:text-foreground transition-colors">
                    สถานะ {sortIcon('status')}
                  </button>
                </th>
                <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium tracking-wide uppercase">
                  <button onClick={() => handleSort('lastInspected')} className="flex items-center gap-1 hover:text-foreground transition-colors">
                    ตรวจล่าสุด {sortIcon('lastInspected')}
                  </button>
                </th>
                <th className="text-muted-foreground px-5 py-3 text-right text-xs font-medium tracking-wide uppercase">
                  ดำเนินการ
                </th>
              </tr>
            </thead>
            <tbody>
              {stations.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-muted-foreground py-12 text-center text-sm">
                    ไม่พบสถานีที่ตรงกับเงื่อนไข
                  </td>
                </tr>
              ) : (
                stations.map((station) => {
                  const hasPending = pendingIds.includes(station.id)
                  return (
                    <tr
                      key={station.id}
                      className="border-border hover:bg-secondary/30 border-b transition-colors last:border-0"
                    >
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
                        <span className="text-foreground text-xs">
                          {getTransportLabel(station)}
                        </span>
                      </td>
                      <td className="px-3 py-3.5">
                        <p className="text-foreground text-xs">{station.province}</p>
                        <p className="text-muted-foreground text-xs">{station.region}</p>
                      </td>
                      <td className="px-3 py-3.5">
                        <span className="text-foreground text-xs font-medium">
                          {station.responsibleAgency}
                        </span>
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

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="border-border flex items-center justify-between border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">
              แสดง {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} จาก {total}{' '}
              สถานี
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 1}
                className="border-border hover:bg-secondary rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
              >
                ก่อนหน้า
              </button>
              <span className="text-muted-foreground text-xs">
                หน้า {page} / {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages}
                className="border-border hover:bg-secondary rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
              >
                ถัดไป
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add Station Modal */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="bg-card max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
              <h2 className="text-foreground text-lg font-semibold">เพิ่มสถานี</h2>
              <button
                onClick={() => setSheetOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X size={18} />
              </button>
            </div>

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
                    <label className="text-foreground mb-1 block text-xs font-medium">
                      ชื่อสถานี (ภาษาไทย) *
                    </label>
                    <input
                      className={INPUT_CLS}
                      value={form.nameTh}
                      onChange={(e) => patchForm({ nameTh: e.target.value })}
                      placeholder="สถานีรถไฟ..."
                      required
                    />
                  </div>
                  <div>
                    <label className="text-foreground mb-1 block text-xs font-medium">
                      Station Name (EN)
                    </label>
                    <input
                      className={INPUT_CLS}
                      value={form.name}
                      onChange={(e) => patchForm({ name: e.target.value })}
                      placeholder="Railway Station..."
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-foreground mb-1 block text-xs font-medium">
                      ประเภทการขนส่ง *
                    </label>
                    <select
                      className={SELECT_CLS}
                      value={form.mode}
                      onChange={(e) => patchForm({ mode: e.target.value, railSubtype: undefined })}
                      required
                    >
                      {TRANSPORT_MODES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  {form.mode === 'ทางราง' && (
                    <div>
                      <label className="text-foreground mb-1 block text-xs font-medium">
                        ประเภทย่อย
                      </label>
                      <select
                        className={SELECT_CLS}
                        value={form.railSubtype ?? ''}
                        onChange={(e) => patchForm({ railSubtype: e.target.value || undefined })}
                      >
                        <option value="">ไม่ระบุ</option>
                        {RAIL_SUBTYPES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-foreground mb-1 block text-xs font-medium">
                      จังหวัด *
                    </label>
                    <input
                      className={INPUT_CLS}
                      value={form.province}
                      onChange={(e) => patchForm({ province: e.target.value })}
                      placeholder="กรุงเทพมหานคร"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-foreground mb-1 block text-xs font-medium">ภาค *</label>
                    <input
                      className={INPUT_CLS}
                      value={form.region}
                      list="regions-list"
                      onChange={(e) => patchForm({ region: e.target.value })}
                      placeholder="กลาง"
                      required
                    />
                    <datalist id="regions-list">
                      {(filterOptions?.regions ?? []).map((r) => (
                        <option key={r} value={r} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div>
                  <label className="text-foreground mb-1 block text-xs font-medium">
                    หน่วยงานรับผิดชอบ *
                  </label>
                  <input
                    className={INPUT_CLS}
                    value={form.responsibleAgency}
                    list="agencies-list"
                    onChange={(e) => patchForm({ responsibleAgency: e.target.value })}
                    placeholder="รฟท."
                    required
                  />
                  <datalist id="agencies-list">
                    {(filterOptions?.agencies ?? []).map((a) => (
                      <option key={a} value={a} />
                    ))}
                  </datalist>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-foreground mb-1 block text-xs font-medium">
                      ละติจูด *
                    </label>
                    <input
                      type="number"
                      step="any"
                      className={INPUT_CLS}
                      value={form.lat || ''}
                      onChange={(e) => patchForm({ lat: parseFloat(e.target.value) || 0 })}
                      placeholder="13.7563"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-foreground mb-1 block text-xs font-medium">
                      ลองจิจูด *
                    </label>
                    <input
                      type="number"
                      step="any"
                      className={INPUT_CLS}
                      value={form.lng || ''}
                      onChange={(e) => patchForm({ lng: parseFloat(e.target.value) || 0 })}
                      placeholder="100.5018"
                      required
                    />
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
                  <button
                    type="button"
                    onClick={() => setSheetOpen(false)}
                    className="border-border rounded-lg border px-4 py-2 text-sm"
                  >
                    ยกเลิก
                  </button>
                </div>
              </form>
            )}

            {/* Bulk import */}
            {sheetMode === 'bulk' && (
              <div className="space-y-4">
                <p className="text-muted-foreground text-xs">
                  รองรับไฟล์ .xlsx, .xls, .csv, .json · ระบบจะตรวจสอบรูปแบบไฟล์อัตโนมัติ (มาตรฐาน
                  หรือ OTP)
                </p>

                <label className="border-border hover:bg-secondary flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors">
                  <Upload size={20} className="text-muted-foreground" />
                  <span className="text-muted-foreground text-sm">คลิกเพื่อเลือกไฟล์</span>
                  {bulkFormat === 'otp' && (otpRows.length > 0 || bulkErrors.length > 0) && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                      ตรวจพบรูปแบบ OTP
                    </span>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv,.json"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                </label>

                {bulkErrors.length > 0 && (
                  <div className="bg-destructive/5 rounded-lg p-3">
                    <p className="text-destructive mb-1 text-xs font-medium">
                      พบข้อผิดพลาด {bulkErrors.length} รายการ
                    </p>
                    {bulkErrors.slice(0, 5).map((e, i) => (
                      <p key={i} className="text-muted-foreground text-[10px]">
                        {e}
                      </p>
                    ))}
                    {bulkErrors.length > 5 && (
                      <p className="text-muted-foreground text-[10px]">
                        และอีก {bulkErrors.length - 5} รายการ
                      </p>
                    )}
                  </div>
                )}

                {(() => {
                  const previewRows =
                    bulkFormat === 'otp'
                      ? otpRows.map((r) => ({
                          nameTh: r.station.nameTh,
                          mode: r.station.mode,
                          province: r.station.province,
                        }))
                      : bulkRows
                  const count = previewRows.length
                  if (count === 0) return null
                  return (
                    <div className="bg-secondary/50 space-y-3 rounded-lg p-3">
                      <p className="text-foreground text-sm font-medium">
                        พบ {count} สถานี พร้อมนำเข้า
                      </p>
                      <div className="max-h-40 space-y-1 overflow-y-auto">
                        {previewRows.slice(0, 10).map((r, i) => (
                          <p key={i} className="text-muted-foreground text-xs">
                            · {r.nameTh} ({r.mode})
                          </p>
                        ))}
                        {count > 10 && (
                          <p className="text-muted-foreground text-xs">และอีก {count - 10} สถานี</p>
                        )}
                      </div>

                      {/* Value-class stats — OTP only */}
                      {bulkFormat === 'otp' && otpStats && (
                        <div className="flex flex-wrap gap-1.5 border-t pt-2">
                          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                            มี ได้มาตรฐาน {otpStats['มีได้มาตรฐาน']}
                          </span>
                          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-700">
                            มี ไม่ได้มาตรฐาน {otpStats['มีไม่ได้มาตรฐาน']}
                          </span>
                          {otpStats['มีไม่ระบุ'] > 0 && (
                            <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700">
                              มี ไม่ระบุมาตรฐาน ⚑ {otpStats['มีไม่ระบุ']}
                            </span>
                          )}
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                            ไม่มี {otpStats['ไม่มี']}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                            N/A {otpStats['na']}
                          </span>
                          {otpStats['other'] > 0 && (
                            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-medium text-purple-700">
                              ไม่รู้จัก {otpStats['other']}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Unknown codes */}
                      {bulkFormat === 'otp' && otpUnknownCodes.length > 0 && (
                        <p className="text-[10px] text-amber-600">
                          ⚠ พบรหัสที่ไม่รู้จัก: {otpUnknownCodes.slice(0, 8).join(', ')}
                          {otpUnknownCodes.length > 8
                            ? ` และอีก ${otpUnknownCodes.length - 8} รหัส`
                            : ''}
                        </p>
                      )}

                      {/* Out-of-timeframe rows */}
                      {bulkFormat === 'otp' && otpOutOfTimeframe.length > 0 && (
                        <p className="text-[10px] text-red-600">
                          ⚠ ปีนอกเหนือจากช่วงที่ยอมรับ: {otpOutOfTimeframe.length} แถว — ไม่นำเข้า
                        </p>
                      )}
                    </div>
                  )
                })()}

                {bulkProgress && (
                  <div className="flex items-center gap-2">
                    <Loader2 size={14} className="text-muted-foreground animate-spin" />
                    <span className="text-muted-foreground text-sm">{bulkProgress}</span>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={bulkFormat === 'otp' ? handleOtpImport : handleBulkImport}
                    disabled={
                      (bulkFormat === 'otp' ? otpRows.length : bulkRows.length) === 0 ||
                      !!bulkProgress
                    }
                    className="bg-primary text-primary-foreground flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium disabled:opacity-50"
                  >
                    {bulkFormat === 'otp'
                      ? `นำเข้าข้อมูล OTP${otpRows.length > 0 ? ` ${otpRows.length} สถานี` : ''}`
                      : `สร้าง${bulkRows.length > 0 ? ` ${bulkRows.length} สถานี` : ''}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkRows([])
                      setOtpRows([])
                      setBulkErrors([])
                      setOtpStats(null)
                      setOtpOutOfTimeframe([])
                      setOtpUnknownCodes([])
                      if (fileRef.current) fileRef.current.value = ''
                    }}
                    className="border-border rounded-lg border px-3 py-2"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
