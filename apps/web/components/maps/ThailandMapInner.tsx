'use client'

import * as React from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { renderToStaticMarkup } from 'react-dom/server'
import Link from 'next/link'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BusFront, TrainFront, TramFront, Ship, Plane, Layers } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Station, StationStatus, TransportMode, RailSubtype } from '@repo/types'
import { getTransportLabel } from '@/lib/constants'

// A station with coordinates confirmed present (post-filter).
type PlottableStation = Station & { lat: number; lng: number }

// ── colour map ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<StationStatus, string> = {
  'ผ่านมาตรฐาน': '#52aa4e',
  'ต้องปรับปรุง': '#ffc107',
  'ไม่ผ่าน':      '#f44336',
}

// ── icon maps — swap a line here to restyle all markers of a type ─────────────

const MODE_ICONS: Record<TransportMode, LucideIcon> = {
  'ทางบก':    BusFront,
  'ทางราง':   TrainFront,
  'ทางเรือ':  Ship,
  'ทางอากาศ': Plane,
}

const RAIL_ICONS: Record<RailSubtype, LucideIcon> = {
  'รถไฟ':    TrainFront,
  'รถไฟฟ้า': TramFront,
}

const LEGEND_TYPES: { label: string; Icon: LucideIcon }[] = [
  { label: 'สถานีขนส่ง',   Icon: BusFront   },
  { label: 'สถานีรถไฟ',    Icon: TrainFront  },
  { label: 'สถานีรถไฟฟ้า', Icon: TramFront   },
  { label: 'ท่าเรือ',      Icon: Ship        },
  { label: 'ท่าอากาศยาน', Icon: Plane       },
]

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

function createMarkerIcon(station: PlottableStation): L.DivIcon {
  const color = STATUS_COLORS[station.status] ?? '#64748b'
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

// ── sub-components ────────────────────────────────────────────────────────────

function StationMarker({ station }: { station: PlottableStation }) {
  const markerRef = React.useRef<L.Marker | null>(null)
  const timerRef  = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const icon = React.useMemo(
    () => createMarkerIcon(station),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [station.id, station.status, station.coordStatus],
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

  const color = STATUS_COLORS[station.status] ?? '#64748b'
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
function ClusterMarker({ stations }: { stations: PlottableStation[] }) {
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

function MapLegend({ hiddenCount }: { hiddenCount: number }) {
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
      <div style={{ fontWeight: 700, marginBottom: 4 }}>สถานะ</div>
      {(Object.entries(STATUS_COLORS) as [StationStatus, string][]).map(([label, color]) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: color,
              flexShrink: 0,
            }}
          />
          {label}
        </div>
      ))}
      <div style={{ fontWeight: 700, marginTop: 8, marginBottom: 4 }}>ประเภทสถานี</div>
      {LEGEND_TYPES.map(({ label, Icon }) => (
        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
          <div
            style={{
              width: 16,
              height: 16,
              borderRadius: '50%',
              background: '#64748b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Icon size={10} color="white" />
          </div>
          {label}
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <div style={{ width: 10, height: 10, borderRadius: '50%', border: '2px dashed #64748b', flexShrink: 0 }} />
        ตำแหน่งโดยประมาณ
      </div>
      {hiddenCount > 0 && (
        <div style={{ marginTop: 6, color: '#b45309' }}>
          {hiddenCount} สถานีไม่มีพิกัด (ไม่แสดงบนแผนที่)
        </div>
      )}
    </div>
  )
}

// ── root ──────────────────────────────────────────────────────────────────────

export default function ThailandMapInner({ stations }: { stations: Station[] }) {
  const plottable = React.useMemo(() => stations.filter(isPlottable), [stations])
  const hiddenCount = stations.length - plottable.length

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

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%', isolation: 'isolate' }}>
      <MapContainer
        center={THAILAND_CENTER}
        zoom={5}
        scrollWheelZoom={false}
        style={{ height: '100%', width: '100%', borderRadius: '0.5rem' }}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBoundsOnChange stations={plottable} />
        {groups.map(group =>
          group.length === 1
            ? <StationMarker key={group[0]!.id} station={group[0]!} />
            : <ClusterMarker key={coordKey(group[0]!)} stations={group} />
        )}
      </MapContainer>
      <MapLegend hiddenCount={hiddenCount} />
    </div>
  )
}
