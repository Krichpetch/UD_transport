'use client'

import * as React from 'react'
import { MapContainer, TileLayer, Marker, Popup, ZoomControl, useMap } from 'react-leaflet'
import { renderToStaticMarkup } from 'react-dom/server'
import Link from 'next/link'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import MarkerClusterGroup from 'react-leaflet-cluster'
import 'react-leaflet-cluster/dist/assets/MarkerCluster.css'
import 'react-leaflet-cluster/dist/assets/MarkerCluster.Default.css'
import { BusFront, TrainFront, TramFront, Ship, Plane, Layers, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Station, StationStatus, TransportMode, RailSubtype } from '@repo/types'
import { getTransportLabel } from '@/lib/constants'
import { statusColor } from '@/components/checklist/ChecklistSummaryPanel'
import thailandProvinceMapRaw from '@svg-maps/thailand'

// The package's own .d.ts references an uninstalled type module (svg-maps__common), which
// resolves to `any` even under skipLibCheck — cast once here to the shape it actually exports
// (an SVG path string per region) rather than let `any` leak into the component below.
interface SvgProvinceMap { viewBox: string; locations: { id: string; name: string; path: string }[] }
const thailandProvinceMap = thailandProvinceMapRaw as unknown as SvgProvinceMap

// A station with coordinates confirmed present (post-filter).
type PlottableStation = Station & { lat: number; lng: number }

type ViewMode = 'pins' | 'province'

// ── colour map — CSS var tokens, not hex (DESIGN.md) ───────────────────────────

const STATUS_COLOR_VARS: Record<StationStatus, string> = {
  'ผ่านมาตรฐาน': 'var(--status-pass)',
  'ต้องปรับปรุง': 'var(--status-warn)',
  'ไม่ผ่าน':      'var(--status-fail)',
}

const NOT_ASSESSED_COLOR = 'var(--muted-foreground)'

// UDT-23 — a station with no completed inspection reads as its own ⚪ state, never a false
// "ต้องปรับปรุง" read just because a status field happens to default there.
function isNotAssessed(s: Station): boolean {
  return s.lastInspected == null
}

function markerColor(s: Station): string {
  if (isNotAssessed(s)) return NOT_ASSESSED_COLOR
  return STATUS_COLOR_VARS[s.status] ?? NOT_ASSESSED_COLOR
}

const LEGEND_STATUSES: { label: string; color: string }[] = [
  { label: 'ผ่านมาตรฐาน',  color: STATUS_COLOR_VARS['ผ่านมาตรฐาน'] },
  { label: 'ต้องปรับปรุง', color: STATUS_COLOR_VARS['ต้องปรับปรุง'] },
  { label: 'ไม่ผ่าน',      color: STATUS_COLOR_VARS['ไม่ผ่าน'] },
  { label: 'ยังไม่ได้ตรวจ', color: NOT_ASSESSED_COLOR },
]

// ── icon maps — swap a line here to restyle all markers of a type ─────────────

const MODE_ICONS: Record<TransportMode, LucideIcon> = {
  'ทางบก':    BusFront,
  'ทางราง':   TrainFront,
  'ทางน้ำ':   Ship,
  'ทางอากาศ': Plane,
}

const RAIL_ICONS: Record<RailSubtype, LucideIcon> = {
  'รถไฟ':    TrainFront,
  'รถไฟฟ้า': TramFront,
}

const THAILAND_CENTER: [number, number] = [13.0, 101.5]

// ── helpers ───────────────────────────────────────────────────────────────────

function getStationIcon(station: Station): LucideIcon {
  if (station.mode === 'ทางราง' && station.railSubtype) {
    return RAIL_ICONS[station.railSubtype]
  }
  return MODE_ICONS[station.mode]
}

// A station only counts as having a real, mappable location when it has both
// coordinates and hasn't been marked INVALID (e.g. 0,0 placeholder).
function isPlottable(s: Station): s is PlottableStation {
  return s.lat != null && s.lng != null && s.coordStatus !== 'INVALID'
}

// Coordinates that aren't a verified, station-specific fix — centroid/province
// fallback or not yet checked. Rendered distinctly so it never reads as precise.
function isUnverified(s: Station): boolean {
  return s.coordStatus === 'APPROXIMATE' || s.coordStatus === 'PENDING' || !s.coordStatus
}

function coordKey(s: PlottableStation): string {
  return `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`
}

// UDT-22 — same match rule as the navbar's ⌘K station search (AppNavbar.tsx), applied here
// against only plottable stations since a match with no coordinates has nowhere to fly to.
function matchesQuery(s: PlottableStation, q: string): boolean {
  return (
    s.nameTh.includes(q) ||
    s.name.toLowerCase().includes(q) ||
    (s.province?.includes(q) ?? false)
  )
}

function createMarkerIcon(station: PlottableStation): L.DivIcon {
  const color = markerColor(station)
  const unverified = isUnverified(station)
  const IconComponent = getStationIcon(station)
  const label = `${station.nameTh} · ${getTransportLabel(station)} · ${station.status}${unverified ? ' · ตำแหน่งโดยประมาณ' : ''}`
  const svg = renderToStaticMarkup(
    React.createElement(IconComponent, {
      size: 14,
      color: 'white',
      strokeWidth: 2.5,
      'aria-hidden': 'true',
    }),
  )
  const border = unverified
    ? 'border:2px dashed rgba(255,255,255,0.9);opacity:0.75'
    : 'border:2px solid rgba(255,255,255,0.85)'
  return L.divIcon({
    className: '',
    html: `<div
      role="img"
      aria-label="${label}"
      tabindex="0"
      style="background:${color};${border};border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer">
      ${svg}
    </div>`,
    iconSize:    [28, 28],
    iconAnchor:  [14, 14],
    popupAnchor: [0, -18],
  })
}

function createClusterIcon(count: number): L.DivIcon {
  const svg = renderToStaticMarkup(
    React.createElement(Layers, { size: 13, color: 'white', strokeWidth: 2.5, 'aria-hidden': 'true' }),
  )
  return L.divIcon({
    className: '',
    html: `<div
      role="img"
      aria-label="${count} สถานีในตำแหน่งใกล้เคียงกัน (ตำแหน่งโดยประมาณ)"
      tabindex="0"
      style="background:#475569;border:2px dashed rgba(255,255,255,0.9);border-radius:8px;width:30px;height:30px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.35);cursor:pointer;color:white;font:700 10px sans-serif">
      ${svg}
      <span style="line-height:1;margin-top:1px">${count}</span>
    </div>`,
    iconSize:    [30, 30],
    iconAnchor:  [15, 15],
    popupAnchor: [0, -20],
  })
}

// UDT-23 — proximity cluster bubble (markercluster groups nearby markers by zoom, distinct from
// the dashed same-coordinate ClusterMarker above which merges only an exact centroid fallback).
// Solid + primary-token so the two kinds of grouping never look like the same thing.
function createClusterGroupIcon(cluster: L.MarkerCluster): L.DivIcon {
  const count = cluster.getChildCount()
  const svg = renderToStaticMarkup(
    React.createElement(Layers, { size: 13, color: 'white', strokeWidth: 2.5, 'aria-hidden': 'true' }),
  )
  return L.divIcon({
    className: '',
    html: `<div
      role="img"
      aria-label="${count} สถานีในบริเวณใกล้เคียงกัน"
      style="background:var(--primary);border:2px solid rgba(255,255,255,0.85);border-radius:50%;width:32px;height:32px;display:flex;flex-direction:column;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer;color:white;font:700 10px sans-serif">
      ${svg}
      <span style="line-height:1;margin-top:1px">${count}</span>
    </div>`,
    iconSize:   [32, 32],
    iconAnchor: [16, 16],
  })
}

// ── sub-components ────────────────────────────────────────────────────────────

function StationMarker({ station, registerMarker }: {
  station: PlottableStation
  registerMarker: (id: string, marker: L.Marker | null) => void
}) {
  const markerRef = React.useRef<L.Marker | null>(null)
  const timerRef  = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const icon = React.useMemo(
    () => createMarkerIcon(station),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [station.id, station.status, station.coordStatus, station.lastInspected],
  )

  const open = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    markerRef.current?.openPopup()
  }, [])

  const close = React.useCallback(() => {
    timerRef.current = setTimeout(() => markerRef.current?.closePopup(), 300)
  }, [])

  // Leaflet's eventHandlers map only covers its own (mouse/drag/etc.) events —
  // focus/blur are plain DOM events, so they're bound directly on the marker's
  // element for keyboard accessibility (tabindex is set in createMarkerIcon).
  React.useEffect(() => {
    const el = markerRef.current?.getElement()
    if (!el) return
    el.addEventListener('focus', open)
    el.addEventListener('blur', close)
    return () => {
      el.removeEventListener('focus', open)
      el.removeEventListener('blur', close)
    }
  }, [open, close])

  // UDT-22 — exposes this marker instance to the search control by station id.
  React.useEffect(() => {
    registerMarker(station.id, markerRef.current)
    return () => registerMarker(station.id, null)
  }, [station.id, registerMarker])

  const color = markerColor(station)
  const unverified = isUnverified(station)

  return (
    <Marker
      ref={markerRef}
      position={[station.lat, station.lng]}
      icon={icon}
      eventHandlers={{ mouseover: open, mouseout: close }}
    >
      <Popup autoClose={false} closeOnClick={false}>
        <div onMouseEnter={open} onMouseLeave={close} style={{ minWidth: 160 }}>
          <p style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, display: 'inline-block' }} />
            {station.nameTh}
          </p>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>
            {station.province} · {getTransportLabel(station)}
          </p>
          {unverified && (
            <p style={{ fontSize: 11, color: '#b45309', marginBottom: 2 }}>
              ⚠ ตำแหน่งโดยประมาณ — ยังไม่ยืนยันพิกัดจริง
            </p>
          )}
          <p style={{ fontSize: 12 }}>
            คะแนน:{' '}
            <strong style={{ color }}>{station.score}</strong>
          </p>
          <Link
            href={`/stations/${station.id}`}
            style={{
              display: 'block',
              marginTop: 8,
              fontSize: 12,
              color: '#3b82f6',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            ดูรายละเอียด →
          </Link>
        </div>
      </Popup>
    </Marker>
  )
}

// Renders several stations that share the same (usually fallback/centroid) coordinate
// as one distinguishable cluster marker — never silently as a single station's pin.
function ClusterMarker({ stations, registerMarker }: {
  stations: PlottableStation[]
  registerMarker: (id: string, marker: L.Marker | null) => void
}) {
  const markerRef = React.useRef<L.Marker | null>(null)
  const timerRef  = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const first = stations[0]!

  const icon = React.useMemo(() => createClusterIcon(stations.length), [stations.length])

  const open = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    markerRef.current?.openPopup()
  }, [])
  const close = React.useCallback(() => {
    timerRef.current = setTimeout(() => markerRef.current?.closePopup(), 300)
  }, [])

  React.useEffect(() => {
    const el = markerRef.current?.getElement()
    if (!el) return
    el.addEventListener('focus', open)
    el.addEventListener('blur', close)
    return () => {
      el.removeEventListener('focus', open)
      el.removeEventListener('blur', close)
    }
  }, [open, close])

  // UDT-22 — every member station id resolves search to this one shared marker.
  const ids = stations.map(s => s.id).join(',')
  React.useEffect(() => {
    for (const s of stations) registerMarker(s.id, markerRef.current)
    return () => { for (const s of stations) registerMarker(s.id, null) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, registerMarker])

  return (
    <Marker
      ref={markerRef}
      position={[first.lat, first.lng]}
      icon={icon}
      eventHandlers={{ mouseover: open, mouseout: close }}
    >
      <Popup autoClose={false} closeOnClick={false}>
        <div onMouseEnter={open} onMouseLeave={close} className="themed-scrollbar" style={{ minWidth: 190, maxHeight: 220, overflowY: 'auto' }}>
          <p style={{ fontWeight: 700, marginBottom: 4 }}>
            {stations.length} สถานีในตำแหน่งโดยประมาณเดียวกัน
          </p>
          <p style={{ fontSize: 11, color: '#b45309', marginBottom: 6 }}>
            ⚠ พิกัดยังไม่ยืนยันแยกแต่ละสถานี — แสดงรวมกันชั่วคราว
          </p>
          {stations.map(s => (
            <div key={s.id} style={{ marginBottom: 6 }}>
              <p style={{ fontSize: 12, fontWeight: 600 }}>{s.nameTh}</p>
              <p style={{ fontSize: 11, color: '#64748b' }}>{s.province} · {getTransportLabel(s)}</p>
              <Link
                href={`/stations/${s.id}`}
                style={{ fontSize: 11, color: '#3b82f6', fontWeight: 600, textDecoration: 'none' }}
              >
                ดูรายละเอียด →
              </Link>
            </div>
          ))}
        </div>
      </Popup>
    </Marker>
  )
}

// UDT-23 — svg-maps ships English names; this app's data uses official Thai province names.
// Keyed by the package's stable region id (not its English label) so a label wording change
// upstream can't silently break the mapping. 'lksg' (Lake Songkhla) isn't a province — excluded.
const PROVINCE_ID_TO_TH: Record<string, string> = {
  bkk: 'กรุงเทพมหานคร',      spk: 'สมุทรปราการ',    nbi: 'นนทบุรี',
  pte: 'ปทุมธานี',           aya: 'พระนครศรีอยุธยา', atg: 'อ่างทอง',
  lri: 'ลพบุรี',             sbr: 'สิงห์บุรี',       cnt: 'ชัยนาท',
  sri: 'สระบุรี',            cbi: 'ชลบุรี',          ryg: 'ระยอง',
  cti: 'จันทบุรี',           trt: 'ตราด',            cco: 'ฉะเชิงเทรา',
  pri: 'ปราจีนบุรี',         nyk: 'นครนายก',         skw: 'สระแก้ว',
  nma: 'นครราชสีมา',         brm: 'บุรีรัมย์',        srn: 'สุรินทร์',
  ssk: 'ศรีสะเกษ',           ubn: 'อุบลราชธานี',      yst: 'ยโสธร',
  cpm: 'ชัยภูมิ',            acr: 'อำนาจเจริญ',       bkn: 'บึงกาฬ',
  nbp: 'หนองบัวลำภู',        kkn: 'ขอนแก่น',         udn: 'อุดรธานี',
  lei: 'เลย',                nki: 'หนองคาย',         mkm: 'มหาสารคาม',
  ret: 'ร้อยเอ็ด',           ksn: 'กาฬสินธุ์',        snk: 'สกลนคร',
  npm: 'นครพนม',             mdh: 'มุกดาหาร',        cmi: 'เชียงใหม่',
  lpn: 'ลำพูน',              lpg: 'ลำปาง',           utd: 'อุตรดิตถ์',
  pre: 'แพร่',               nan: 'น่าน',            pyo: 'พะเยา',
  cri: 'เชียงราย',           msn: 'แม่ฮ่องสอน',       nsn: 'นครสวรรค์',
  uti: 'อุทัยธานี',          kpt: 'กำแพงเพชร',       tak: 'ตาก',
  sti: 'สุโขทัย',            plk: 'พิษณุโลก',         pct: 'พิจิตร',
  pnb: 'เพชรบูรณ์',          rbr: 'ราชบุรี',          kri: 'กาญจนบุรี',
  spb: 'สุพรรณบุรี',         npt: 'นครปฐม',          skn: 'สมุทรสาคร',
  skm: 'สมุทรสงคราม',        pbi: 'เพชรบุรี',         pkn: 'ประจวบคีรีขันธ์',
  nrt: 'นครศรีธรรมราช',      kbi: 'กระบี่',           pna: 'พังงา',
  pkt: 'ภูเก็ต',             sni: 'สุราษฎร์ธานี',     rng: 'ระนอง',
  cpn: 'ชุมพร',              ska: 'สงขลา',           stn: 'สตูล',
  trg: 'ตรัง',               plg: 'พัทลุง',           ptn: 'ปัตตานี',
  yla: 'ยะลา',               nwt: 'นราธิวาส',
}

const NO_DATA_COLOR = 'var(--muted)'

interface ProvinceStat { total: number; assessed: number; avgScore: number }

// UDT-23 — one metric per province: average score among ASSESSED stations only (unassessed
// stations have no score yet and would silently drag every average toward failing otherwise).
function computeProvinceStats(stations: Station[]): Map<string, ProvinceStat> {
  const byProvince = new Map<string, Station[]>()
  for (const s of stations) {
    if (!s.province) continue
    const arr = byProvince.get(s.province)
    if (arr) arr.push(s)
    else byProvince.set(s.province, [s])
  }
  const stats = new Map<string, ProvinceStat>()
  for (const [province, list] of byProvince) {
    const assessed = list.filter(s => !isNotAssessed(s))
    const avgScore = assessed.length === 0 ? 0 : assessed.reduce((sum, s) => sum + s.score, 0) / assessed.length
    stats.set(province, { total: list.length, assessed: assessed.length, avgScore })
  }
  return stats
}

// UDT-23 — colors each province by its average score (same pass/warn/fail thresholds as every
// other score color in the app — see DESIGN.md's statusColor rule), not by pin density. Needs
// no station coordinates at all, so a station with no lat/lng still counts here.
function ProvinceChoropleth({ stations }: { stations: Station[] }) {
  const stats = React.useMemo(() => computeProvinceStats(stations), [stations])

  return (
    <div style={{ height: '100%', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card)', borderRadius: '0.5rem' }}>
      <svg viewBox={thailandProvinceMap.viewBox} style={{ height: '100%', maxWidth: '100%' }}>
        {thailandProvinceMap.locations.map(loc => {
          // `var(...)` tokens don't reliably resolve through the `fill`/`stroke` XML attributes —
          // only through `style`, which is parsed as real CSS. Plain attributes silently fall back
          // to the SVG initial fill (black) when the value doesn't parse as a <paint>.
          if (loc.id === 'lksg') {
            return <path key={loc.id} d={loc.path} style={{ fill: 'var(--border)', stroke: 'var(--card)', strokeWidth: 0.5, pointerEvents: 'none' }} />
          }
          const nameTh = PROVINCE_ID_TO_TH[loc.id]
          const stat = nameTh ? stats.get(nameTh) : undefined
          const fill = !stat || stat.assessed === 0 ? NO_DATA_COLOR : statusColor(stat.avgScore)
          const title = !nameTh
            ? loc.name
            : !stat || stat.assessed === 0
              ? `${nameTh} — ไม่มีข้อมูลการตรวจ`
              : `${nameTh} — เฉลี่ย ${stat.avgScore.toFixed(0)} คะแนน (ตรวจแล้ว ${stat.assessed}/${stat.total})`
          return (
            <path key={loc.id} d={loc.path} style={{ fill, stroke: 'var(--card)', strokeWidth: 0.5 }}>
              <title>{title}</title>
            </path>
          )
        })}
      </svg>
    </div>
  )
}

// Leaflet caches its container's pixel size at init and never re-measures it on its own — a
// container that resizes without the window itself resizing (grid breakpoint change, dialog
// reveal, sidebar collapse) leaves the map showing stale/half-rendered gray tiles until the user
// pans or zooms. A ResizeObserver on the map's own container catches every such case generically.
function InvalidateSizeOnResize() {
  const map = useMap()
  React.useEffect(() => {
    const container = map.getContainer()
    const ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(container)
    return () => ro.disconnect()
  }, [map])
  return null
}

function FitBoundsOnChange({ stations }: { stations: PlottableStation[] }) {
  const map = useMap()
  React.useEffect(() => {
    if (stations.length === 0) return
    const t = setTimeout(() => {
      map.fitBounds(
        L.latLngBounds(stations.map((s) => [s.lat, s.lng] as [number, number])),
        { padding: [28, 28], maxZoom: 10, animate: true, duration: 0.4 },
      )
    }, 300)
    return () => clearTimeout(t)
  }, [stations, map])
  return null
}

// UDT-23 — top-left search box. Lives outside <MapContainer>; the fly-to itself runs through
// the clusterGroup ref + marker registry passed down from the root, not useMap().
function MapSearch({ stations, onSelect }: {
  stations: PlottableStation[]
  onSelect: (id: string) => void
}) {
  const [open, setOpen]   = React.useState(false)
  const [query, setQuery] = React.useState('')

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return stations.filter(s => matchesQuery(s, q)).slice(0, 8)
  }, [stations, query])

  function select(id: string) {
    setOpen(false)
    setQuery('')
    onSelect(id)
  }

  return (
    <div style={{ position: 'absolute', top: 8, left: 8, zIndex: 1000, width: 220 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
          padding: '6px 10px', boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        }}
      >
        <Search size={13} color="var(--muted-foreground)" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => { setTimeout(() => setOpen(false), 150) }}
          placeholder="ค้นหาสถานี..."
          style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 12, color: 'var(--foreground)' }}
        />
      </div>
      {open && query && (
        <div
          className="themed-scrollbar"
          style={{
            marginTop: 4, maxHeight: 220, overflowY: 'auto',
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          }}
        >
          {results.length === 0 ? (
            <p style={{ padding: '8px 10px', fontSize: 11, color: 'var(--muted-foreground)' }}>ไม่พบสถานีที่ตรงกัน</p>
          ) : results.map(s => (
            <button
              key={s.id}
              // onMouseDown (not onClick) fires before the input's onBlur closes the list.
              onMouseDown={() => select(s.id)}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', fontSize: 12, border: 'none', background: 'none', cursor: 'pointer', color: 'var(--foreground)' }}
            >
              {s.nameTh} <span style={{ color: 'var(--muted-foreground)', fontSize: 11 }}>· {s.province}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ViewModeToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const OPTIONS: { value: ViewMode; label: string }[] = [
    { value: 'pins', label: 'หมุด' },
    { value: 'province', label: 'รายจังหวัด' },
  ]
  return (
    <div
      style={{
        position: 'absolute', top: 8, right: 8, zIndex: 1000,
        display: 'flex', gap: 2, background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 2, boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      }}
    >
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          style={{
            padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500, border: 'none', cursor: 'pointer',
            background: mode === value ? 'var(--primary)' : 'transparent',
            color: mode === value ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function MapLegend({ mode }: { mode: ViewMode }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 28,
        right: 8,
        zIndex: 1000,
        background: 'rgba(255,255,255,0.95)',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 11,
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        lineHeight: 1.6,
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      {mode === 'pins' ? (
        <>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>สถานะ</div>
          {LEGEND_STATUSES.map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }} />
              {label}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px dashed #64748b', flexShrink: 0 }} />
            ตำแหน่งโดยประมาณ
          </div>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>คะแนนเฉลี่ยของจังหวัด</div>
          {/* Province mode's 4th state is "no assessed stations at all", a different thing from
              a single station's ยังไม่ได้ตรวจ — its own label/token, not LEGEND_STATUSES' gray. */}
          {LEGEND_STATUSES.slice(0, 3).map(({ label, color }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
              {label}
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: NO_DATA_COLOR, flexShrink: 0 }} />
            ไม่มีข้อมูล
          </div>
        </>
      )}
    </div>
  )
}

// UDT-23 — no-coordinate stations get a caption below the map (not stuffed into the legend
// box), with an expandable inline list rather than a separate page.
function NoCoordNote({ stations, count }: { stations: Station[]; count: number }) {
  const [expanded, setExpanded] = React.useState(false)
  return (
    <div style={{ padding: '6px 4px 0', fontSize: 11, color: 'var(--status-warn-foreground)' }}>
      <span>⚠️ {count} สถานีไม่มีพิกัด · แสดงตามจังหวัดที่ตั้งเท่านั้น · </span>
      <button
        onClick={() => setExpanded(v => !v)}
        style={{ textDecoration: 'underline', color: 'inherit', background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
      >
        {expanded ? 'ซ่อนรายการ' : 'ดูรายการ →'}
      </button>
      {expanded && (
        <div className="themed-scrollbar" style={{ marginTop: 6, maxHeight: 120, overflowY: 'auto', color: 'var(--muted-foreground)' }}>
          {stations.map(s => (
            <div key={s.id} style={{ padding: '2px 0' }}>{s.nameTh} · {s.province ?? '—'}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── root ──────────────────────────────────────────────────────────────────────

export default function ThailandMapInner({ stations }: { stations: Station[] }) {
  const [viewMode, setViewMode] = React.useState<ViewMode>('pins')
  const clusterRef  = React.useRef<L.MarkerClusterGroup | null>(null)
  const markersRef  = React.useRef<Record<string, L.Marker>>({})

  const registerMarker = React.useCallback((id: string, marker: L.Marker | null) => {
    if (marker) markersRef.current[id] = marker
    else delete markersRef.current[id]
  }, [])

  const plottable = React.useMemo(() => stations.filter(isPlottable), [stations])
  const hiddenStations = React.useMemo(() => stations.filter(s => !isPlottable(s)), [stations])
  const hiddenCount = hiddenStations.length

  // Group stations that share an exact coordinate (typically a province/centroid
  // fallback) so they render as one honest cluster marker, never as a fake single pin.
  const groups = React.useMemo(() => {
    const map = new Map<string, PlottableStation[]>()
    for (const s of plottable) {
      const key = coordKey(s)
      const arr = map.get(key)
      if (arr) arr.push(s)
      else map.set(key, [s])
    }
    return [...map.values()]
  }, [plottable])

  // UDT-22 — reveal a searched station: expand its cluster (or same-coordinate group) and open
  // its popup. If the province view is showing, switch to pins first — that remounts the whole
  // Leaflet map, so the marker/cluster refs aren't ready on the very next tick; poll briefly
  // rather than guess a fixed delay.
  function handleSearchSelect(id: string) {
    function reveal(attemptsLeft: number) {
      const marker = markersRef.current[id]
      if (marker && clusterRef.current) {
        clusterRef.current.zoomToShowLayer(marker, () => marker.openPopup())
      } else if (attemptsLeft > 0) {
        setTimeout(() => reveal(attemptsLeft - 1), 50)
      }
    }
    if (viewMode !== 'pins') {
      setViewMode('pins')
      reveal(20)
    } else {
      reveal(1)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%' }}>
      <div style={{ position: 'relative', flex: 1, minHeight: 0, isolation: 'isolate' }}>
        <MapSearch stations={plottable} onSelect={handleSearchSelect} />
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
        {viewMode === 'pins' ? (
          <MapContainer
            center={THAILAND_CENTER}
            zoom={5}
            scrollWheelZoom={false}
            zoomControl={false}
            style={{ height: '100%', width: '100%', borderRadius: '0.5rem' }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {/* Default zoom control sits top-left, same corner as the search box above —
                moved to the one corner nothing else uses (toggle: top-right, legend: bottom-right). */}
            <ZoomControl position="bottomleft" />
            <FitBoundsOnChange stations={plottable} />
            <InvalidateSizeOnResize />
            <MarkerClusterGroup
              ref={clusterRef}
              chunkedLoading
              maxClusterRadius={48}
              showCoverageOnHover={false}
              iconCreateFunction={createClusterGroupIcon}
            >
              {groups.map(group =>
                group.length === 1
                  ? <StationMarker key={group[0]!.id} station={group[0]!} registerMarker={registerMarker} />
                  : <ClusterMarker key={coordKey(group[0]!)} stations={group} registerMarker={registerMarker} />
              )}
            </MarkerClusterGroup>
          </MapContainer>
        ) : (
          // Province view needs no coordinates at all, so it uses every station — including the
          // ones with no lat/lng that never show up as a pin.
          <ProvinceChoropleth stations={stations} />
        )}
        <MapLegend mode={viewMode} />
      </div>
      {viewMode === 'pins' && hiddenCount > 0 && <NoCoordNote stations={hiddenStations} count={hiddenCount} />}
    </div>
  )
}
