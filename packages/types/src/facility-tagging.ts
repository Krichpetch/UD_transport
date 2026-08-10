// Facility-catalog matching + container-level tagging — extracted from
// apps/api/prisma/seed-templates.ts (Session S4b) so it can be reused by the facility-grouped
// editor's grouping engine (apps/api/src/admin/templates/facility-grouping.core.ts) without that
// module reaching outside apps/api/src (tsconfig's `rootDir: "./src"` forbids importing the
// prisma/ scripts directory from src/). Pure data transformation, no Prisma/DB access — the same
// reason FACILITY_CATALOG itself already lives here rather than in a seed script.
//
// Behavior is unchanged from the original seed-templates.ts functions; seed-templates.ts now
// imports these instead of defining them inline.
import type { ChecklistTemplateDefinition, TemplateNode } from './checklist-template.js'
import { FACILITY_CATALOG } from './facility-catalog.js'

export function normalizeFacilityLabel(s: string): string {
  return s.replace(/[（(][^)）]*[)）]/g, '').replace(/\s+/g, ' ').trim()
}

export interface FacilityMatch {
  code: number
  matchedText: string
}

export function matchFacility(labelTh: string): FacilityMatch | null {
  const normLabel = normalizeFacilityLabel(labelTh)
  let best: (FacilityMatch & { length: number }) | null = null
  for (const entry of FACILITY_CATALOG) {
    const alternatives = normalizeFacilityLabel(entry.nameTh).split('/').map((s) => s.trim()).filter((s) => s.length >= 4)
    for (const alt of alternatives) {
      const isMatch = normLabel === alt || normLabel.includes(alt) || alt.includes(normLabel)
      if (isMatch && (!best || alt.length > best.length)) {
        best = { code: entry.code, matchedText: alt, length: alt.length }
      }
    }
  }
  return best ? { code: best.code, matchedText: best.matchedText } : null
}

export interface TagStats {
  total: number
  tagged: number
  unmatched: string[]
}

export function tagLeaves(def: ChecklistTemplateDefinition): TagStats {
  const stats: TagStats = { total: 0, tagged: 0, unmatched: [] }
  const visit = (node: TemplateNode) => {
    if (node.subItems && node.subItems.length > 0) {
      for (const child of node.subItems) visit(child)
      return
    }
    stats.total++
    const match = matchFacility(node.labelTh)
    if (!match) {
      stats.unmatched.push(node.labelTh)
      return
    }
    stats.tagged++
    const catalogEntry = FACILITY_CATALOG.find((e) => e.code === match.code)!
    node.facilityCode = catalogEntry.code
    node.lawRefs = [...catalogEntry.lawRefs]
    if (catalogEntry.cabinetResolution) node.cabinetResolution = true
    if (catalogEntry.beyondLaw) node.beyondLaw = true
  }
  for (const g of def.groups) for (const item of g.items) visit(item)
  return stats
}

// ---- container-level facility-catalog tagging (all 5 v3 modes) ------------------------------

export interface ContainerFacilityOverride {
  facilityCode?: number
  beyondLaw?: true
}

export function facilityKey(mode: string, variantKey: string, containerCode: string): string {
  return `${mode}:${variantKey}:${containerCode}`
}

const LAND_MODE = 'ทางบก'
const WATER_MODE = 'ทางน้ำ'
const AIR_MODE = 'ทางอากาศ'
const RAIL_MODE = 'ทางราง'
const RAIL_TRAIN = 'rail_train'
const RAIL_METRO = 'rail_metro'
const STANDARD = 'standard'

// Keyed by `${mode}:${variantKey}:${containerCode}`. Each entry is a container the automated
// matcher (matchFacility, same substring logic as tagLeaves) can't resolve on its own — decided
// by the user 2026-08-05 from the facility-type cross-mode comparison report's "71 containers to
// map" table. See seed-templates.ts's git history for the original inline copy of this table.
export const CONTAINER_FACILITY_OVERRIDES: Record<string, ContainerFacilityOverride> = {
  // ---- ทางบก (land, standard) ----
  [facilityKey(LAND_MODE, STANDARD, 'A2.3')]: { facilityCode: 4 },
  [facilityKey(LAND_MODE, STANDARD, 'B4.1')]: { facilityCode: 4 },
  [facilityKey(LAND_MODE, STANDARD, 'B3.1')]: { facilityCode: 10 },
  [facilityKey(LAND_MODE, STANDARD, 'B1.6')]: { facilityCode: 2 },
  [facilityKey(LAND_MODE, STANDARD, 'B6.1')]: { facilityCode: 2 },
  [facilityKey(LAND_MODE, STANDARD, 'B1.7')]: { facilityCode: 2 },
  [facilityKey(LAND_MODE, STANDARD, 'B6.2')]: { facilityCode: 2 },
  [facilityKey(LAND_MODE, STANDARD, 'B1.3')]: { facilityCode: 16 },
  [facilityKey(LAND_MODE, STANDARD, 'B1.18')]: { facilityCode: 33 },
  [facilityKey(LAND_MODE, STANDARD, 'B2.3')]: { facilityCode: 32 },
  [facilityKey(LAND_MODE, STANDARD, 'B5.1')]: { facilityCode: 13 },
  [facilityKey(LAND_MODE, STANDARD, 'C1.1')]: { facilityCode: 19 },
  [facilityKey(LAND_MODE, STANDARD, 'C2.1')]: { facilityCode: 21 },
  [facilityKey(LAND_MODE, STANDARD, 'A2.8')]: { facilityCode: 12 },
  [facilityKey(LAND_MODE, STANDARD, 'A2.9')]: { beyondLaw: true },

  // ---- ทางน้ำ (water, standard) ----
  [facilityKey(WATER_MODE, STANDARD, 'B3.1')]: { facilityCode: 2 },
  [facilityKey(WATER_MODE, STANDARD, 'B3.2')]: { facilityCode: 2 },
  [facilityKey(WATER_MODE, STANDARD, 'B2.2')]: { facilityCode: 16 },
  [facilityKey(WATER_MODE, STANDARD, 'B4.2')]: { beyondLaw: true },
  [facilityKey(WATER_MODE, STANDARD, 'C1.1')]: { facilityCode: 19 },
  [facilityKey(WATER_MODE, STANDARD, 'C2.1')]: { facilityCode: 21 },

  // ---- ทางอากาศ (air, standard) ----
  [facilityKey(AIR_MODE, STANDARD, 'A2.5')]: { facilityCode: 4 },
  [facilityKey(AIR_MODE, STANDARD, 'B6.1')]: { facilityCode: 4 },
  [facilityKey(AIR_MODE, STANDARD, 'B1.6')]: { facilityCode: 4 },
  [facilityKey(AIR_MODE, STANDARD, 'B5.1')]: { facilityCode: 10 },
  [facilityKey(AIR_MODE, STANDARD, 'B2.8')]: { facilityCode: 2 },
  [facilityKey(AIR_MODE, STANDARD, 'B3.1')]: { facilityCode: 2 },
  [facilityKey(AIR_MODE, STANDARD, 'B2.9')]: { facilityCode: 2 },
  [facilityKey(AIR_MODE, STANDARD, 'B3.2')]: { facilityCode: 2 },
  [facilityKey(AIR_MODE, STANDARD, 'B2.1')]: { facilityCode: 16 },
  [facilityKey(AIR_MODE, STANDARD, 'B2.2')]: { facilityCode: 16 },
  [facilityKey(AIR_MODE, STANDARD, 'B3.11')]: { facilityCode: 33 },
  [facilityKey(AIR_MODE, STANDARD, 'B4.3')]: { facilityCode: 32 },
  [facilityKey(AIR_MODE, STANDARD, 'B7.1')]: { facilityCode: 13 },
  [facilityKey(AIR_MODE, STANDARD, 'C1.1')]: { facilityCode: 19 },
  [facilityKey(AIR_MODE, STANDARD, 'C2.1')]: { facilityCode: 21 },
  [facilityKey(AIR_MODE, STANDARD, 'A2.8')]: { facilityCode: 12 },
  [facilityKey(AIR_MODE, STANDARD, 'A2.9')]: { beyondLaw: true },
  [facilityKey(AIR_MODE, STANDARD, 'B2.4')]: { facilityCode: 6 },

  // ---- ทางราง / rail_train ----
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'A2.3')]: { facilityCode: 4 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'B5.1')]: { facilityCode: 4 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'B4.1')]: { facilityCode: 10 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'B2.5')]: { facilityCode: 2 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'B7.1')]: { facilityCode: 2 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'B2.6')]: { facilityCode: 2 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'B7.2')]: { facilityCode: 2 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'B2.2')]: { facilityCode: 16 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'B2.17')]: { facilityCode: 33 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'B3.3')]: { facilityCode: 32 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'B6.1')]: { facilityCode: 13 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'C1.1')]: { facilityCode: 19 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'C2.1')]: { facilityCode: 21 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'A2.8')]: { facilityCode: 12 },
  [facilityKey(RAIL_MODE, RAIL_TRAIN, 'A2.9')]: { beyondLaw: true },

  // ---- ทางราง / rail_metro ----
  [facilityKey(RAIL_MODE, RAIL_METRO, 'A2.3')]: { facilityCode: 4 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'A3.2')]: { facilityCode: 4 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'B5.1')]: { facilityCode: 4 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'A3.1')]: { facilityCode: 10 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'B4.1')]: { facilityCode: 10 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'B2.6')]: { facilityCode: 2 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'B7.1')]: { facilityCode: 2 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'B2.7')]: { facilityCode: 2 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'B7.2')]: { facilityCode: 2 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'B2.3')]: { facilityCode: 16 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'B2.18')]: { facilityCode: 33 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'B3.3')]: { facilityCode: 32 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'B6.1')]: { facilityCode: 13 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'C1.1')]: { facilityCode: 19 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'C2.1')]: { facilityCode: 21 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'A2.8')]: { facilityCode: 12 },
  [facilityKey(RAIL_MODE, RAIL_METRO, 'A2.9')]: { beyondLaw: true },
}

export interface ContainerTagStats extends TagStats {
  containersAutoMatched: number
  containersOverridden: number
  containersFallenBackToLeaf: number
}

// Stamps every LEAF beneath `container` (recursively) with the same facility identity — never the
// container node itself, preserving the "facilityCode/lawRefs live on leaves only" invariant every
// other reader (era-resolution.ts, the admin lawRefs editor, summarizeTemplate) already assumes.
function stampFacilityOnLeaves(
  container: TemplateNode,
  tag: { facilityCode?: number; lawRefs?: readonly string[]; cabinetResolution?: boolean; beyondLaw?: boolean },
  stats: TagStats,
): void {
  const visit = (node: TemplateNode) => {
    if (node.subItems && node.subItems.length > 0) {
      for (const child of node.subItems) visit(child)
      return
    }
    stats.total++
    stats.tagged++
    if (tag.facilityCode !== undefined) node.facilityCode = tag.facilityCode
    if (tag.lawRefs) node.lawRefs = [...tag.lawRefs]
    if (tag.cabinetResolution) node.cabinetResolution = true
    if (tag.beyondLaw) node.beyondLaw = true
  }
  visit(container)
}

// Resolves facility identity per CONTAINER (the node directly under a group) rather than per leaf
// — see seed-templates.ts's git history / the facility-type-redundancy-report.md for why: two
// sibling leaves under the same facility container could otherwise independently match different
// catalog entries and disagree about which laws gate them. Order: explicit override -> auto-match
// on the container's own label -> fall back to the original per-leaf matcher for that container's
// subtree only (so anything not yet reviewed behaves exactly as tagLeaves() would).
export function tagContainers(def: ChecklistTemplateDefinition, mode: string, variantKey: string): ContainerTagStats {
  const stats: ContainerTagStats = {
    total: 0,
    tagged: 0,
    unmatched: [],
    containersAutoMatched: 0,
    containersOverridden: 0,
    containersFallenBackToLeaf: 0,
  }

  for (const g of def.groups) {
    for (const container of g.items) {
      const override = CONTAINER_FACILITY_OVERRIDES[facilityKey(mode, variantKey, container.code)]
      if (override) {
        stats.containersOverridden++
        if (override.beyondLaw) {
          stampFacilityOnLeaves(container, { beyondLaw: true }, stats)
        } else if (override.facilityCode !== undefined) {
          const entry = FACILITY_CATALOG.find((e) => e.code === override.facilityCode)!
          stampFacilityOnLeaves(
            container,
            { facilityCode: entry.code, lawRefs: entry.lawRefs, cabinetResolution: entry.cabinetResolution, beyondLaw: entry.beyondLaw },
            stats,
          )
        }
        continue
      }

      const match = matchFacility(container.labelTh)
      if (match) {
        stats.containersAutoMatched++
        const entry = FACILITY_CATALOG.find((e) => e.code === match.code)!
        stampFacilityOnLeaves(
          container,
          { facilityCode: entry.code, lawRefs: entry.lawRefs, cabinetResolution: entry.cabinetResolution, beyondLaw: entry.beyondLaw },
          stats,
        )
        continue
      }

      // Neither an override nor an auto-match at container level — fall back to the ORIGINAL
      // per-leaf matcher for this one container's subtree, so anything not yet reviewed behaves
      // exactly as tagLeaves() already did (no regression for the un-decided remainder).
      stats.containersFallenBackToLeaf++
      const visit = (node: TemplateNode) => {
        if (node.subItems && node.subItems.length > 0) {
          for (const child of node.subItems) visit(child)
          return
        }
        stats.total++
        const leafMatch = matchFacility(node.labelTh)
        if (!leafMatch) {
          stats.unmatched.push(node.labelTh)
          return
        }
        stats.tagged++
        const catalogEntry = FACILITY_CATALOG.find((e) => e.code === leafMatch.code)!
        node.facilityCode = catalogEntry.code
        node.lawRefs = [...catalogEntry.lawRefs]
        if (catalogEntry.cabinetResolution) node.cabinetResolution = true
        if (catalogEntry.beyondLaw) node.beyondLaw = true
      }
      visit(container)
    }
  }
  return stats
}
