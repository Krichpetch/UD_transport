import type { TransportMode } from './transport.js'

export type ChecklistValue = 'มี' | 'ไม่มี' | 'N/A' | null

export interface ChecklistPhoto {
  id: string
  url: string
  filename: string
  uploadedAt: string
  // Part C (auditor self-unsubmit/summary session) — optional per-photo note, authored by the
  // auditor (which photo shows what) and read by an admin reviewer. Additive/optional: a photo
  // uploaded before this field existed simply has none and renders identically. Kept separate
  // from the existing per-ITEM `note` (StoredChecklistNode.note / ChecklistSubItem.note), which
  // is untouched — this is a note about one specific photo, not the item as a whole.
  caption?: string
}

export interface ChecklistSubItem {
  id: string
  labelTh: string
  value: ChecklistValue
  meetsStandard: boolean
  cabinetPriority: boolean
  note: string
  photos: ChecklistPhoto[]
  flagged: boolean       // scoring concept: bare-มี / standard-unspecified (excluded from score) — do not repurpose
  reviewFlag: boolean    // admin review concept: "พบปัญหา" — blocks approval, has no effect on scoring
}

export interface ChecklistGroup {
  groupId: string
  groupName: string
  items: ChecklistSubItem[]
}

export type ChecklistTemplate = Record<TransportMode, ChecklistGroup[]>
