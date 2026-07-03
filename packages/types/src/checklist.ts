import type { TransportMode } from './transport.js'

export type ChecklistValue = 'มี' | 'ไม่มี' | 'N/A' | null

export interface ChecklistPhoto {
  id: string
  url: string
  filename: string
  uploadedAt: string
}

export interface ChecklistSubItem {
  id: string
  labelTh: string
  value: ChecklistValue
  meetsStandard: boolean
  cabinetPriority: boolean
  note: string
  photos: ChecklistPhoto[]
  flagged: boolean
}

export interface ChecklistGroup {
  groupId: string
  groupName: string
  items: ChecklistSubItem[]
}

export type ChecklistTemplate = Record<TransportMode, ChecklistGroup[]>
