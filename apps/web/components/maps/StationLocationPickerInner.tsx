'use client'

import * as React from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const THAILAND_CENTER: [number, number] = [13.0, 101.5]

const PIN_ICON = L.divIcon({
  className: '',
  html: `<div style="background:#dc2626;border:2px solid white;border-radius:50% 50% 50% 0;width:24px;height:24px;transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,0.35)"></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 24],
})

function ClickToPlace({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng)
    },
  })
  return null
}

function RecenterOnChange({ lat, lng }: { lat: number | null; lng: number | null }) {
  const map = useMap()
  React.useEffect(() => {
    if (lat == null || lng == null) return
    map.setView([lat, lng], Math.max(map.getZoom(), 13), { animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng])
  return null
}

interface StationLocationPickerInnerProps {
  lat: number | null
  lng: number | null
  onChange: (lat: number, lng: number) => void
}

export default function StationLocationPickerInner({ lat, lng, onChange }: StationLocationPickerInnerProps) {
  const center: [number, number] = lat != null && lng != null ? [lat, lng] : THAILAND_CENTER

  return (
    <MapContainer
      center={center}
      zoom={lat != null && lng != null ? 13 : 5}
      scrollWheelZoom
      style={{ height: '100%', width: '100%', borderRadius: '0.5rem' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickToPlace onPick={onChange} />
      <RecenterOnChange lat={lat} lng={lng} />
      {lat != null && lng != null && <Marker position={[lat, lng]} icon={PIN_ICON} />}
    </MapContainer>
  )
}
