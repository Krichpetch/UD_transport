// Thin wrapper around navigator.geolocation — used at both check-in (station confirm-to-start)
// and submit time. The proximity gate itself is enforced server-side; this only captures the
// reading to send along.
export type GeolocationResult =
  | { status: 'ok'; lat: number; lng: number; accuracy: number }
  | { status: 'denied' }
  | { status: 'unavailable' }
  | { status: 'timeout' }

// Payload shape sent to the submit endpoint — mirrors apps/api SubmitGps.
export interface SubmitGps {
  lat: number
  lng: number
  accuracy?: number
}

export function getCurrentPosition(timeoutMs = 10000): Promise<GeolocationResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ status: 'unavailable' })
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        status: 'ok',
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      (err) => resolve(err.code === err.PERMISSION_DENIED ? { status: 'denied' } : { status: 'timeout' }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    )
  })
}

// Haversine — client-side ESTIMATE only, used for the check-in screen's UX (distance display,
// soft pre-check before entering the checklist). The authoritative gate is always server-side
// (PostGIS ST_Distance) at submit time; never trust this number for enforcement.
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// Dev/staging-only escape hatch so the flow can be tested from a desk. Never true in a
// production build — Next.js inlines NEXT_PUBLIC_* at build time, so a prod build with this
// unset (the default) has the bypass compiled out entirely, not just runtime-disabled.
export const PROXIMITY_BYPASS = process.env.NEXT_PUBLIC_PROXIMITY_BYPASS === 'true'
