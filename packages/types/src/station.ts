import type { TransportMode, RailSubtype, StationStatus } from './transport'

export const RESPONSIBLE_AGENCIES = [
  'ขบ.', 'ขสมก.', 'บขส.', 'รฟท.', 'รฟม.', 'รฟฟท.', 'BEM', 'จท.', 'ทย.', 'ทอท.', 'อื่นๆ',
] as const

export type ResponsibleAgency = typeof RESPONSIBLE_AGENCIES[number]

export const TRANSPORT_MODE_AGENCIES: Record<TransportMode, readonly ResponsibleAgency[]> = {
  'ทางบก':    ['ขบ.', 'ขสมก.', 'บขส.', 'อื่นๆ'],
  'ทางราง':   ['รฟท.', 'รฟม.', 'รฟฟท.', 'BEM', 'อื่นๆ'],
  'ทางเรือ':  ['จท.', 'ทย.', 'อื่นๆ'],
  'ทางอากาศ': ['ทอท.', 'อื่นๆ'],
}

export interface Station {
  id: string
  name: string
  nameTh: string
  mode: TransportMode
  railSubtype?: RailSubtype
  province: string
  region: string
  responsibleAgency: string
  score: number
  status: StationStatus
  lastInspected: string | null
  lat: number
  lng: number
  urgentIssues: string[]
}

export interface KpiSummary {
  totalStations: number
  passing: number
  needsImprovement: number
  failing: number
  passRate: number
}
