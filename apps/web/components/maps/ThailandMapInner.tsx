'use client'

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import { mockStations, getTransportLabel } from '@/lib/mock-data'

const STATUS_COLORS: Record<string, string> = {
  'ผ่านมาตรฐาน': '#52aa4e',
  'ต้องปรับปรุง': '#ffc107',
  'ไม่ผ่าน': '#f44336',
}

// Thailand center
const THAILAND_CENTER: [number, number] = [13.0, 101.5]

export default function ThailandMapInner() {
  return (
    <MapContainer
      center={THAILAND_CENTER}
      zoom={5}
      scrollWheelZoom={false}
      style={{ height: '100%', width: '100%', borderRadius: '0.5rem' }}
    >
      {/* OpenStreetMap tiles — free, no API key */}
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {mockStations.map((station) => (
        <CircleMarker
          key={station.id}
          center={[station.lat, station.lng]}
          radius={8}
          pathOptions={{
            color: '#fff',
            weight: 2,
            fillColor: STATUS_COLORS[station.status] ?? '#64748b',
            fillOpacity: 0.9,
          }}
        >
          <Popup>
            <div style={{ minWidth: 160 }}>
              <p style={{ fontWeight: 700, marginBottom: 4 }}>{station.nameTh}</p>
              <p style={{ fontSize: 12, color: '#64748b', marginBottom: 2 }}>{station.province} · {getTransportLabel(station)}</p>
              <p style={{ fontSize: 12 }}>
                คะแนน:{' '}
                <strong style={{ color: STATUS_COLORS[station.status] }}>
                  {station.score}
                </strong>
              </p>
              <span
                style={{
                  display: 'inline-block',
                  marginTop: 4,
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: 11,
                  background: STATUS_COLORS[station.status] + '20',
                  color: STATUS_COLORS[station.status],
                  fontWeight: 600,
                }}
              >
                {station.status}
              </span>
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}