'use client'

import * as React from 'react'
import { Search, X, Loader2, ChevronRight, ChevronLeft, Bus, Train, TrainFront, Ship, Plane, LocateFixed, MapPin } from 'lucide-react'
import { RAIL_SUBTYPES } from '@repo/types'
import type { TransportMode, RailSubtype } from '@repo/types'
import { searchStations, getNearbyStations, getStationLines } from '@/lib/api/stations'
import type { StationSearchResult, NearbyStation } from '@/lib/api/stations'
import { getCurrentPosition } from '@/lib/geolocation'
import { getLineColor } from '@/lib/line-colors'

// Session F3, Part A.3 — the line/route badge. Station identity is (mode, nameTh, line), so two
// same-named stations on different lines are ONLY distinguishable by this: it must be visible on
// every row and on the selected-station chip, without the auditor having to open the station.
// Renders nothing for the empty-string "no line" case (the deliberate sentinel, never null).
// Uses the operator's own brand color when one is known (getLineColor), falling back to the
// generic primary-tint badge for lines outside that fixed palette.
export function LineBadge({ line, className = '' }: { line?: string | null; className?: string }) {
  if (!line) return null
  const color = getLineColor(line)
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[10px] font-semibold leading-tight ${color ? '' : 'bg-primary/10 text-primary'} ${className}`}
      style={color ? { backgroundColor: `${color}1a`, color } : undefined}
    >
      {line}
    </span>
  )
}

// ── Mode tabs ──────────────────────────────────────────────────────────────────

type ModeTab = { label: string; value: TransportMode | '' }

const MODE_TABS: ModeTab[] = [
  { label: 'ทั้งหมด',   value: '' },
  { label: 'ทางบก',    value: 'ทางบก' },
  { label: 'ทางราง',   value: 'ทางราง' },
  { label: 'ทางน้ำ',   value: 'ทางน้ำ' },
  { label: 'ทางอากาศ', value: 'ทางอากาศ' },
]

export function ModeIcon({ mode, railSubtype, line, size = 14 }: {
  mode: string; railSubtype?: string; line?: string | null; size?: number
}) {
  const cls = 'shrink-0'
  // Colored via inline style (overriding the wrapping span's text color) only when the line
  // has a known brand color — otherwise it inherits the caller's default icon color as before.
  const style = { color: getLineColor(line) }
  if (mode === 'ทางอากาศ') return <Plane      size={size} className={cls} style={style} />
  if (mode === 'ทางน้ำ')   return <Ship       size={size} className={cls} style={style} />
  if (mode === 'ทางราง')   return railSubtype === 'รถไฟฟ้า'
    ? <TrainFront size={size} className={cls} style={style} />
    : <Train      size={size} className={cls} style={style} />
  return <Bus size={size} className={cls} style={style} />
}

// ── Public interface ───────────────────────────────────────────────────────────

interface SelectedStation {
  nameTh: string
  province: string | null
  mode: TransportMode
  railSubtype?: RailSubtype
  // Part A.3 — shown on the closed trigger chip, so the auditor can confirm they picked the
  // right one of two same-named stations without reopening the picker.
  line?: string
}

interface Props {
  value: string
  selectedStation?: SelectedStation
  onSelect: (id: string) => void
}

const PAGE_SIZE = 20

type PickerTab = 'search' | 'nearby'
type NearbyStatus = 'idle' | 'locating' | 'ok' | 'denied' | 'error'

// ── Component ──────────────────────────────────────────────────────────────────

export function StationSearchPicker({ value, selectedStation, onSelect }: Props) {
  const [open, setOpen]             = React.useState(false)
  const [tab, setTab]               = React.useState<PickerTab>('search')
  const [query, setQuery]           = React.useState('')
  const [mode, setMode]             = React.useState<TransportMode | ''>('')
  // Session S3b, Part B — mirrors the F2 admin rail subtype filter; only shown/sent when
  // mode === 'ทางราง', cleared whenever mode changes (see the mode-chip onClick below).
  const [railSubtype, setRailSubtype] = React.useState<RailSubtype | ''>('')
  // Session F3, Part A.4 — line filter. `lineOptions` drives whether the control renders at all:
  // "the lines endpoint returned something for this scope", never a hardcoded mode list, so a
  // mode that gains lines later works with no code change. Cleared whenever mode/railSubtype
  // changes, exactly like railSubtype is cleared on a mode change above.
  const [line, setLine]               = React.useState('')
  const [lineOptions, setLineOptions] = React.useState<string[]>([])
  const [results, setResults]       = React.useState<StationSearchResult[]>([])
  const [loading, setLoading]       = React.useState(false)
  const [page, setPage]             = React.useState(1)
  const [totalPages, setTotalPages] = React.useState(1)
  const [total, setTotal]           = React.useState(0)
  const inputRef                    = React.useRef<HTMLInputElement>(null)
  const abortRef                    = React.useRef<AbortController | null>(null)
  const listRef                     = React.useRef<HTMLDivElement>(null)

  const [nearbyResults, setNearbyResults] = React.useState<NearbyStation[]>([])
  const [nearbyStatus, setNearbyStatus]   = React.useState<NearbyStatus>('idle')

  // Focus input and reset all transient state on open/close
  React.useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 80)
      return () => clearTimeout(t)
    }
    setTab('search')
    setQuery('')
    setRailSubtype('')
    setLine('')
    setLineOptions([])
    setResults([])
    setTotal(0)
    setTotalPages(1)
    setPage(1)
    setLoading(false)
    setNearbyResults([])
    setNearbyStatus('idle')
  }, [open])

  // Fetch nearby stations once the "ใกล้ฉัน" tab is opened
  React.useEffect(() => {
    if (!open || tab !== 'nearby') return
    let cancelled = false
    setNearbyStatus('locating')
    getCurrentPosition().then((pos) => {
      if (cancelled) return
      if (pos.status !== 'ok') {
        setNearbyStatus(pos.status === 'denied' ? 'denied' : 'error')
        return
      }
      getNearbyStations(pos.lat, pos.lng)
        .then((stations) => {
          if (cancelled) return
          setNearbyResults(stations)
          setNearbyStatus('ok')
        })
        .catch(() => {
          if (!cancelled) setNearbyStatus('error')
        })
    })
    return () => { cancelled = true }
  }, [open, tab])

  // Part A.4 — refresh the available lines whenever the mode/railSubtype scope changes, and drop
  // any line selection that the new scope can't satisfy (mirrors the mode-chip's railSubtype
  // reset). One bounded query per scope change, never derived from a page of results.
  // Positive gate: only ทางราง + รถไฟฟ้า specifically. Anything else (no mode chosen at all, a
  // different mode, or ทางราง with no/other subtype) must clear rather than fall through to an
  // unscoped fetch — an empty `mode` previously slipped past a `mode === 'ทางราง'` negative check
  // and queried lines across every mode.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    setLine('')
    if (!(mode === 'ทางราง' && railSubtype === 'รถไฟฟ้า')) {
      setLineOptions([])
      return
    }
    getStationLines({ mode: 'ทางราง', railSubtype: 'รถไฟฟ้า' })
      .then((lines) => { if (!cancelled) setLineOptions(lines) })
      .catch(() => { if (!cancelled) setLineOptions([]) })
    return () => { cancelled = true }
  }, [open, mode, railSubtype])

  // Reset to page 1 when search terms change
  React.useEffect(() => {
    setPage(1)
  }, [query, mode, railSubtype, line])

  // Scroll list to top on page change
  React.useEffect(() => {
    listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [page])

  // Unified fetch: immediate for browse (empty query), debounced 300ms for search
  React.useEffect(() => {
    if (!open) return

    const q     = query.trim()
    const delay = q ? 300 : 0

    setLoading(true)
    const timer = setTimeout(() => {
      abortRef.current?.abort()
      const ctrl = new AbortController()
      abortRef.current = ctrl

      searchStations({
        q: q || undefined,
        mode: mode || undefined,
        railSubtype: mode === 'ทางราง' ? (railSubtype || undefined) : undefined,
        line: line || undefined,
        limit: PAGE_SIZE,
        page,
      }, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return
          setResults(res.data)
          setTotal(res.total)
          setTotalPages(res.totalPages)
        })
        .catch(() => {
          if (ctrl.signal.aborted) return
          setResults([])
          setTotal(0)
          setTotalPages(1)
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false)
        })
    }, delay)

    return () => clearTimeout(timer)
  }, [query, mode, railSubtype, line, page, open])

  function handleSelect(id: string) {
    onSelect(id)
    setOpen(false)
  }

  function close() {
    abortRef.current?.abort()
    setOpen(false)
  }

  // ── Closed trigger ───────────────────────────────────────────────────────────

  return (
    <>
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <label className="mb-2 block text-xs font-medium text-muted-foreground">
          เลือกสถานีที่จะตรวจสอบ
        </label>
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center gap-2.5 rounded-xl bg-white px-4 py-3 text-left shadow-sm focus:outline-none focus:ring-2 focus:ring-white/60"
        >
          {selectedStation ? (
            <>
              <span className="text-gray-500">
                <ModeIcon mode={selectedStation.mode} railSubtype={selectedStation.railSubtype} line={selectedStation.line} size={15} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900">
                {selectedStation.nameTh}
              </span>
              <LineBadge line={selectedStation.line} />
              <span className="shrink-0 text-xs text-gray-400">{selectedStation.province}</span>
            </>
          ) : (
            <>
              <Search size={15} className="shrink-0 text-gray-400" />
              <span className="flex-1 text-sm text-gray-400">เลือกสถานีที่จะตรวจสอบ…</span>
            </>
          )}
          <ChevronRight size={14} className="shrink-0 text-gray-300" />
        </button>
      </div>

      {/* ── Full-screen picker ─────────────────────────────────────────────── */}
      {open && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-border bg-white px-4 pb-3 pt-5">
            <button
              onClick={close}
              aria-label="ปิด"
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground"
            >
              <X size={18} />
            </button>
            <h2 className="flex-1 text-sm font-semibold text-foreground">เลือกสถานีที่จะตรวจสอบ</h2>
            {tab === 'search' && !loading && total > 0 && (
              <span className="text-xs text-muted-foreground">{total.toLocaleString()} สถานี</span>
            )}
          </div>

          {/* Search / Nearby tabs */}
          <div className="flex gap-2 bg-white px-4 pb-3 pt-3">
            <button
              onClick={() => setTab('search')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors ${
                tab === 'search' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
              }`}
            >
              <Search size={13} /> ค้นหา
            </button>
            <button
              onClick={() => setTab('nearby')}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-colors ${
                tab === 'nearby' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
              }`}
            >
              <LocateFixed size={13} /> ใกล้ฉัน
            </button>
          </div>

          {tab === 'search' && (
            <>
              {/* Search input */}
              <div className="bg-white px-4 pb-3">
                <div className="flex items-center gap-2 rounded-xl border border-border bg-white px-3.5 py-3 shadow-sm">
                  <Search size={15} className="shrink-0 text-muted-foreground" />
                  <input
                    ref={inputRef}
                    type="search"
                    inputMode="search"
                    autoComplete="off"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="พิมพ์ชื่อสถานี สายรถไฟ หรือจังหวัด…"
                    className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                  {loading && <Loader2 size={14} className="shrink-0 animate-spin text-muted-foreground" />}
                  {!loading && query && (
                    <button onClick={() => setQuery('')} aria-label="ล้าง">
                      <X size={14} className="text-muted-foreground" />
                    </button>
                  )}
                </div>
              </div>

              {/* Mode chips */}
              <div className="flex gap-2 overflow-x-auto bg-white px-4 pb-3 [scrollbar-none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {MODE_TABS.map((modeTab) => (
                  <button
                    key={modeTab.value}
                    onClick={() => { setMode(modeTab.value); setRailSubtype('') }}
                    className={`flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      mode === modeTab.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    {modeTab.value === 'ทางบก'    && <Bus       size={11} />}
                    {modeTab.value === 'ทางราง'   && <Train     size={11} />}
                    {modeTab.value === 'ทางน้ำ'   && <Ship      size={11} />}
                    {modeTab.value === 'ทางอากาศ' && <Plane     size={11} />}
                    {modeTab.label}
                  </button>
                ))}
              </div>

              {/* Session S3b, Part B — rail subtype chips, same values/labels as the F2 admin
                  filter (RAIL_SUBTYPES). Only meaningful/shown alongside mode='ทางราง'. */}
              {mode === 'ทางราง' && (
                <div className="flex gap-2 overflow-x-auto bg-white px-4 pb-3 [scrollbar-none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  <button
                    onClick={() => setRailSubtype('')}
                    className={`flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      railSubtype === ''
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    ทุกประเภทย่อย
                  </button>
                  {RAIL_SUBTYPES.map((r) => (
                    <button
                      key={r}
                      onClick={() => setRailSubtype(r)}
                      className={`flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                        railSubtype === r
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-secondary-foreground'
                      }`}
                    >
                      <ModeIcon mode="ทางราง" railSubtype={r} size={11} />
                      {r}
                    </button>
                  ))}
                </div>
              )}

              {/* Session F3, Part A.4 — line chips. Rendered purely on "this scope has lines",
                  never on a hardcoded mode list, so land terminals with lines work later with no
                  code change. Cleared on any mode/railSubtype change (see the effect above). */}
              {lineOptions.length > 0 && (
                <div className="flex gap-2 overflow-x-auto bg-white px-4 pb-3 [scrollbar-none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  <button
                    onClick={() => setLine('')}
                    className={`flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                      line === ''
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    ทุกสาย
                  </button>
                  {lineOptions.map((l) => (
                    <button
                      key={l}
                      onClick={() => setLine(l)}
                      className={`flex shrink-0 items-center gap-1 rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors ${
                        line === l
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-secondary text-secondary-foreground'
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Results list */}
          <div ref={listRef} className="themed-scrollbar flex-1 overflow-y-auto">
            {tab === 'nearby' ? (
              nearbyStatus === 'locating' ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16">
                  <Loader2 size={24} className="animate-spin text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">กำลังระบุตำแหน่ง…</p>
                </div>
              ) : nearbyStatus === 'denied' ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง (GPS) กรุณาเปิดใช้งานแล้วลองใหม่
                </p>
              ) : nearbyStatus === 'error' ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  ไม่สามารถระบุตำแหน่งได้ กรุณาลองใหม่อีกครั้ง
                </p>
              ) : nearbyResults.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                  ไม่พบสถานีในระยะ 1 กม.
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {nearbyResults.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => handleSelect(r.id)}
                      className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-secondary ${
                        r.id === value ? 'bg-secondary' : 'bg-white hover:bg-secondary'
                      }`}
                    >
                      <span className="shrink-0 text-muted-foreground">
                        <ModeIcon mode={r.mode} railSubtype={r.railSubtype} line={r.line} size={16} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="min-w-0 truncate text-sm font-medium text-foreground">
                            {r.nameTh}
                          </span>
                          <LineBadge line={r.line} />
                        </span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin size={10} className="shrink-0" />
                          {r.province} · {r.distanceM.toLocaleString()} ม.
                        </span>
                      </span>
                      {r.id === value && (
                        <span className="shrink-0 text-xs font-semibold text-accent">✓</span>
                      )}
                      <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              )
            ) : loading && results.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16">
                <Loader2 size={24} className="animate-spin text-muted-foreground" />
                <p className="text-xs text-muted-foreground">กำลังโหลด…</p>
              </div>
            ) : results.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                ไม่พบสถานีที่ตรงกัน
              </p>
            ) : (
              <div className="divide-y divide-border">
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handleSelect(r.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-secondary ${
                      r.id === value ? 'bg-secondary' : 'bg-white hover:bg-secondary'
                    }`}
                  >
                    <span className="shrink-0 text-muted-foreground">
                      <ModeIcon mode={r.mode} railSubtype={r.railSubtype} line={r.line} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">
                          {r.nameTh}
                        </span>
                        <LineBadge line={r.line} />
                      </span>
                      <span className="text-xs text-muted-foreground">{r.province}</span>
                    </span>
                    {r.id === value && (
                      <span className="shrink-0 text-xs font-semibold text-accent">✓</span>
                    )}
                    <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pagination */}
          {tab === 'search' && totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border bg-white px-4 py-3">
              <button
                onClick={() => setPage((p) => p - 1)}
                disabled={page === 1 || loading}
                className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground disabled:opacity-30"
              >
                <ChevronLeft size={13} />
                ก่อนหน้า
              </button>
              <span className="text-xs text-muted-foreground">หน้า {page} / {totalPages}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={page >= totalPages || loading}
                className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-medium text-secondary-foreground disabled:opacity-30"
              >
                ถัดไป
                <ChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
