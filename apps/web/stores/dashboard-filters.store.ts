import { create } from 'zustand'
import type { TimeframePreset } from '@/lib/timeframe'

// UDT-16 — the executive dashboard's timeframe control now lives in AppNavbar (rendered by the
// shared (dashboard-layout)/layout.tsx), while the filtering logic that consumes it lives in
// dashboard/page.tsx. Those are SIBLINGS under the layout, not parent/child, so plain component
// state can't bridge them — hence a small store, same pattern as stores/auth.store.ts. In-memory
// only (resets on reload), same as every other dashboard filter.
interface DashboardFiltersState {
  timeframe: TimeframePreset
  customFrom: string
  customTo: string
  setTimeframe: (timeframe: TimeframePreset) => void
  setCustomFrom: (value: string) => void
  setCustomTo: (value: string) => void
  resetTimeframe: () => void
}

export const useDashboardFiltersStore = create<DashboardFiltersState>()((set) => ({
  timeframe: 'all',
  customFrom: '',
  customTo: '',
  setTimeframe: (timeframe) => set({ timeframe }),
  setCustomFrom: (customFrom) => set({ customFrom }),
  setCustomTo: (customTo) => set({ customTo }),
  resetTimeframe: () => set({ timeframe: 'all', customFrom: '', customTo: '' }),
}))
