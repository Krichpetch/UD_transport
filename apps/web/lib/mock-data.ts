// ============================================================
// Shared type re-exports only.
// Every screen reads from the live API now. Checklist templates live in
// lib/constants.ts (OTP data-dictionary spec constants, not mock data).
// ============================================================

export type {
  TransportMode,
  RailSubtype,
  StationStatus,
  UserRole,
  Station,
  KpiSummary,
  ChecklistValue,
  ChecklistPhoto,
  ChecklistSubItem,
  ChecklistGroup,
  ChecklistTemplate,
  ResponsibleAgency,
} from '@repo/types'

export { RESPONSIBLE_AGENCIES } from '@repo/types'
