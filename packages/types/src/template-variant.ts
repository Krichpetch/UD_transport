// E-form redesign (Session E3, Part A) — สนข. now issues SEPARATE checklists for metro
// (รถไฟฟ้า) vs conventional rail (รถไฟ) stations. variantKey is the ChecklistTemplate row
// selector that carries this split; every other mode still has exactly one variant.
//
// DECISION (Session E3 kickoff): the rail v2 template seeded in Session E1/E2 IS the รถไฟ
// (rail_train) checklist. The รถไฟฟ้า (rail_metro) workbook has not been delivered yet — the
// mapping below must be ready for it without being blocked by its absence (see seed-templates.ts).
import type { TransportMode, RailSubtype } from './transport.js'

export const RAIL_TRAIN_VARIANT_KEY = 'rail_train'
export const RAIL_METRO_VARIANT_KEY = 'rail_metro'
export const STANDARD_VARIANT_KEY = 'standard'

// Declared default when a rail station's railSubtype is missing/unrecognized — a real audit must
// still get SOME checklist rather than throwing, but the caller is told this was a guess.
export const DEFAULT_RAIL_VARIANT_KEY = RAIL_TRAIN_VARIANT_KEY

const RAIL_VARIANT_BY_SUBTYPE: Record<RailSubtype, string> = {
  'รถไฟฟ้า': RAIL_METRO_VARIANT_KEY,
  'รถไฟ':    RAIL_TRAIN_VARIANT_KEY,
}

export interface VariantResolution {
  variantKey: string
  // True only when the mode is rail and the subtype was missing/unrecognized — the resolved
  // variantKey is the declared default, not a real answer. Mirrors the naming (and the
  // fail-open, never-throw contract) of @repo/types#EraResolution.eraUnresolved.
  variantUnresolved: boolean
}

// mode + railSubtype -> the ChecklistTemplate.variantKey to select against. Never throws — an
// unrecognized/missing subtype on a rail station resolves to DEFAULT_RAIL_VARIANT_KEY, flagged.
export function resolveVariantKey(mode: TransportMode, railSubtype: string | null | undefined): VariantResolution {
  if (mode !== 'ทางราง') return { variantKey: STANDARD_VARIANT_KEY, variantUnresolved: false }

  const known = railSubtype != null ? RAIL_VARIANT_BY_SUBTYPE[railSubtype as RailSubtype] : undefined
  if (known) return { variantKey: known, variantUnresolved: false }
  return { variantKey: DEFAULT_RAIL_VARIANT_KEY, variantUnresolved: true }
}
