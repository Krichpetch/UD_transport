// Session S5, Part G — pure dry-run computation for the master-criteria migration tool. Same
// "no Prisma/DI" convention as facility-grouping.core.ts (directly unit-testable against the real
// committed v3 JSONs, no DB needed) — the CLI wrapper (apps/api/prisma/migrate-to-master-criteria.ts)
// is the only thing that touches Prisma, and only for loading rows / (behind --confirm) writing.
import type { TransportMode } from '@repo/types'
import {
  buildFacilityGroups,
  detectConflicts,
  extendedFieldsAgree,
  isPropagatable,
  type CanonicalItem,
  type FacilityLoadedTemplate,
  type TemplateRowStatus,
} from './facility-grouping.core'

// Session S5-fix (round 4) — re-exported for backward compat with anything importing
// extendedFieldsAgree from this module specifically; the real definition now lives in
// facility-grouping.core.ts (one source of truth, also used by the live propagateItemEdit gate).
export { extendedFieldsAgree }

// Phase-1 facility types (Part G.3), matched by a substring of the container group's canonical
// labelTh (buildContainerGroups' fuzzy-clustered display label) — the same eyeball-matching style
// the grouped editor's own browse view already uses. 'ramp' also catches the slope-tier tables
// (ทางลาด IS the ramp container); 'tactile' catches both Warning and Positioning tactile/block
// containers together, where the flat-vs-byLaw "ระดับต่างกันเกิน 200 มม." split (Session S4b's own
// conflict list) is expected to show up as BLOCKED, not silently migrated.
export const PHASE1_FACILITIES: Record<string, string[]> = {
  ramp: ['ทางลาด'],
  tactile: ['ตัวเตือน', 'พื้นผิวต่างสัมผัส', 'Tactile', 'Warning'],
}

export interface MigrationInstanceRef {
  mode: TransportMode
  variantKey: string
  version: number
  status: TemplateRowStatus
  templateId: string
  nodeCode: string
}

export interface EligibleMigrationItem {
  containerGroupLabel: string
  itemLabel: string
  instanceCount: number
  instances: MigrationInstanceRef[]
}

export interface BlockedMigrationItem {
  containerGroupLabel: string
  itemLabel: string
  instanceCount: number
  reason: string
}

export interface MigrationDryRunReport {
  matchedGroups: string[]
  eligible: EligibleMigrationItem[]
  blocked: BlockedMigrationItem[]
  skippedSingleInstance: number
}

export function matchesFacility(group: CanonicalItem, needles: string[]): boolean {
  return needles.some((n) => group.labelTh.includes(n))
}

export function computeDryRun(templates: FacilityLoadedTemplate[], needles: string[]): MigrationDryRunReport {
  const result = buildFacilityGroups(templates)
  const conflicts = detectConflicts(result)
  const conflictByItem = new Map(conflicts.map((c) => [c.canonicalItemId, c]))

  // Session S5-fix (round 2) — result.containerGroups are now depth-0 roots of a recursive tree,
  // and result.canonicalItems (leaves) can sit at ANY depth below one, not just directly under it —
  // matching by `rootId` (the depth-0 ancestor's id, resolved once per leaf regardless of how many
  // intermediate hierarchy levels sit in between) replaces the old direct containerGroupId match.
  const targetGroups = result.containerGroups.filter((g) => matchesFacility(g, needles))
  const targetGroupIds = new Set(targetGroups.map((g) => g.id))
  const targetItems = result.canonicalItems.filter((it) => targetGroupIds.has(it.rootId))

  const eligible: EligibleMigrationItem[] = []
  const blocked: BlockedMigrationItem[] = []
  let skippedSingleInstance = 0

  for (const item of targetItems) {
    const group = targetGroups.find((g) => g.id === item.rootId)!
    if (item.instances.length < 2) {
      skippedSingleInstance++ // MODE_SPECIFIC — nothing to synchronize, not a migration candidate
      continue
    }
    if (!isPropagatable(item)) {
      const conflict = conflictByItem.get(item.id)
      blocked.push({
        containerGroupLabel: group.labelTh,
        itemLabel: item.labelTh,
        instanceCount: item.instances.length,
        reason: conflict
          ? `unresolved conflict — ${conflict.variants.length} divergent variant(s), resolve via the conflict queue first`
          : 'not propagatable',
      })
      continue
    }
    if (!extendedFieldsAgree(item)) {
      blocked.push({
        containerGroupLabel: group.labelTh,
        itemLabel: item.labelTh,
        instanceCount: item.instances.length,
        reason: "lawRefs/facilityCode/cabinetResolution/beyondLaw diverge across instances (outside the conflict engine's own comparison) — needs manual reconciliation first",
      })
      continue
    }
    eligible.push({
      containerGroupLabel: group.labelTh,
      itemLabel: item.labelTh,
      instanceCount: item.instances.length,
      instances: item.instances.map((i) => ({ mode: i.mode, variantKey: i.variantKey, version: i.version, status: i.status, templateId: i.templateId, nodeCode: i.nodeCode })),
    })
  }

  return { matchedGroups: targetGroups.map((g) => g.labelTh), eligible, blocked, skippedSingleInstance }
}
