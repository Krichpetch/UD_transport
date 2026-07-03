// ============================================================
// Shared type re-exports only.
// Station/checklist mock rows moved to lib/__fixtures__ (Phase 0 cutover —
// every screen reads from the live API now). Checklist templates live in
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
