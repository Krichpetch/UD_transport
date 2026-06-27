'use client'

import * as React from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import { renderToStaticMarkup } from 'react-dom/server'
import Link from 'next/link'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BusFront, TrainFront, TramFront, Ship, Plane } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Station, StationStatus, TransportMode, RailSubtype } from '@repo/types'
import { getTransportLabel } from '@/lib/mock-data'

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

function createMarkerIcon(station: Station): L.DivIcon {
  const color = STATUS_COLORS[station.status] ?? '#64748b'
  const IconComponent = getStationIcon(station)
  const label = `${station.nameTh} · ${getTransportLabel(station)} · ${station.status}`
  const svg = renderToStaticMarkup(
    React.createElement(IconComponent, {
      size: 14,
      color: 'white',
      strokeWidth: 2.5,
      'aria-hidden': 'true',
    }),
  )
  return L.divIcon({
    className: '',
    html: `<div
      role="img"
      aria-label="${label}"
      tabindex="0"
      style="background:${color};border:2px solid rgba(255,255,255,0.85);border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.3);cursor:pointer">
      ${svg}
    </div>`,
    iconSize:    [28, 28],
    iconAnchor:  [14, 14],
    popupAnchor: [0, -18],
  })
}

// ── sub-components ────────────────────────────────────────────────────────────

function StationMarker({ station }: { station: Station }) {
  const markerRef = React.useRef<L.Marker | null>(null)
  const timerRef  = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const icon = React.useMemo(
    () => createMarkerIcon(station),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [station.id, station.status],
  )

  const open = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    markerRef.current?.openPopup()
  }, [])

  const close = React.useCallback(() => {
    timerRef.current = setTimeout(() => markerRef.current?.closePopup(), 300)
  }, [])

  const color = STATUS_COLORS[station.status] ?? '#64748b'

  return (
    <Marker
      ref={markerRef}
      position={[station.lat, station.lng]}
      icon={icon}
      eventHandlers={{ mouseover: open, mouseout: close, focus: open, blur: close }}
    >
      <Popup autoClose={false} closeOnClick={false}>
        <div onMouseEnter={open} onMouseLeave={close} style={{ minWidth: 160 }}>
          <p style={{ fontWeight: 700, marginBottom: 4 }}>{station.nameTh}</p>
          <p style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>
            {station.province} · {getTransportLabel(station)}
          </p>
          <p style={{ fontSize: 12 }}>
            คะแนน:{' '}
            <strong style={{ color }}>{station.score}</strong>
          </p>
          <span
            style={{
              display: 'inline-block',
              marginTop: 4,
              padding: '2px 8px',
              borderRadius: 999,
              fontSize: 11,
              background: color + '20',
              color,
              fontWeight: 600,
            }}
          >
            {station.status}
          </span>
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

function FitBoundsOnChange({ stations }: { stations: Station[] }) {
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

function MapLegend() {
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
    </div>
  )
}

// ── root ──────────────────────────────────────────────────────────────────────

export default function ThailandMapInner({ stations }: { stations: Station[] }) {
  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
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
        <FitBoundsOnChange stations={stations} />
        {stations.map((s) => (
          <StationMarker key={s.id} station={s} />
        ))}
      </MapContainer>
      <MapLegend />
    </div>
  )
}
