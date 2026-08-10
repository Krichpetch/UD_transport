// Session S4b — the facility-grouped editor's grouping engine. Implements
// tools/checklist-migration/output/facility-type-redundancy-report.md's design: the same facility
// checklist (e.g. "ทางลาดสำหรับคนพิการ") is transcribed once per station area and once per
// transport-mode template, so 2161 leaf rows across the 5 v3 templates collapse to ~432 "edit
// units". This module groups the raw redundancy into that edit-unit shape; templates.core.ts's
// existing per-definition edit functions still perform the actual writes (looped once per
// instance by the service layer — see templates.service.ts's propagateEdit).
//
// Pure, no Prisma/DI, same "plain function" convention as templates.core.ts — directly
// unit-testable against the real committed tools/checklist_json/*_v3.json files (see
// __tests__/facility-grouping.spec.ts, which also reproduces the report's headline numbers).
//
// Grouping key (report §6): the container `labelTh` — NOT `facilityCode`, which is coarser than
// the templates and merges genuinely different checklists (e.g. facilityCode 5 collapses Warning/
// Guiding/Positioning tactile variants into one code). facilityCode is read here only to flag
// untagged containers (§7d), never to group.
//
// Callers are expected to pass ALREADY-TAGGED definitions — i.e. exactly what
// TemplatesAdminService reads from the DB (seed-templates.ts already ran tagContainers() before
// writing each row). This module never calls tagContainers itself, so it stays agnostic to
// mode/variantKey-specific override tables and just reads whatever facilityCode ended up on each
// leaf.
import type { ChecklistTemplateDefinition, TemplateMeasurement, TemplateNode, TransportMode } from '@repo/types'
import { levenshteinRatio } from '../../common/token-set-ratio'

// Fuzzy-merge threshold for both container labels and item text (report §7a: "fuzzy-match at
// ~0.95, or the UI will show near-duplicate groups that should be one" — the 4 OCR typos in the
// ramp checklist, e.g. ทำด้วยวัสดุ vs ทำด้วยวัสด, land in this band).
const FUZZY_THRESHOLD = 0.95

// Display form only — collapses runs of whitespace to a single space, for a canonical label an
// admin can read.
function normalizeLabel(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// Matching key: whitespace REMOVED entirely, not just collapsed. Source-file spacing noise isn't
// limited to double-spaces — report §7a's own example is "ไม่น้อยกว่า1,500" vs "ไม่น้อยกว่า 1,500",
// a genuine no-space-vs-one-space difference that collapsing alone would not equate. Levenshtein
// fuzzy matching runs on TOP of this stripped key so it only has to catch real character-level
// typos (§4's 4 OCR examples), not spacing — matches the reference analysis scripts' TIGHT().
function matchKey(s: string): string {
  return s.replace(/\s+/g, '')
}

// Greedy single-pass clustering: an item joins the first existing cluster whose representative
// (the first-seen member) scores >= threshold against it, else starts a new cluster. Deterministic
// for a fixed input order (which is always the same here — VARIANT list order is fixed), so the
// same template set always produces the same clusters, in the same order.
function clusterByFuzzyLabel<T>(items: T[], getLabel: (t: T) => string, threshold: number): T[][] {
  const clusters: { repKey: string; members: T[] }[] = []
  for (const item of items) {
    const key = matchKey(getLabel(item))
    const cluster = clusters.find((c) => key === c.repKey || levenshteinRatio(key, c.repKey) >= threshold)
    if (cluster) cluster.members.push(item)
    else clusters.push({ repKey: key, members: [item] })
  }
  return clusters.map((c) => c.members)
}

// ---- input shape --------------------------------------------------------------------------

export type TemplateRowStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED'

export interface FacilityLoadedTemplate {
  templateId: string
  mode: TransportMode
  variantKey: string
  version: number
  status: TemplateRowStatus
  definition: ChecklistTemplateDefinition
}

// ---- impact counts (Part 1 addition) ----------------------------------------------------------
//
// "Blast radius" breakdown, computed once per container group AND per canonical item, so an admin
// sees it on the browse cards/rows — not only in the write-time fan-out preview. version+status
// are both carried through (not just version) so a mixed-scope computation (Part 5 — pre/post
// v1/v2 retirement) stays legible: two rows at the same version can differ in status while a
// retirement is in flight.

export interface VersionCount {
  version: number
  status: TemplateRowStatus
  count: number
}

export interface VariantCount {
  variantKey: string
  total: number
  byVersion: VersionCount[]
}

export interface ModeCount {
  mode: TransportMode
  total: number
  byVariant: VariantCount[]
}

export interface InstanceBreakdown {
  total: number
  byMode: ModeCount[]
}

function buildBreakdown(instances: { mode: TransportMode; variantKey: string; version: number; status: TemplateRowStatus }[]): InstanceBreakdown {
  const byMode = new Map<TransportMode, Map<string, Map<string, number>>>()
  for (const inst of instances) {
    if (!byMode.has(inst.mode)) byMode.set(inst.mode, new Map())
    const byVariant = byMode.get(inst.mode)!
    if (!byVariant.has(inst.variantKey)) byVariant.set(inst.variantKey, new Map())
    const byVersion = byVariant.get(inst.variantKey)!
    const key = `${inst.version}::${inst.status}`
    byVersion.set(key, (byVersion.get(key) ?? 0) + 1)
  }

  const modeCounts: ModeCount[] = [...byMode.entries()]
    .map(([mode, byVariant]) => {
      const variantCounts: VariantCount[] = [...byVariant.entries()]
        .map(([variantKey, byVersion]) => {
          const versionCounts: VersionCount[] = [...byVersion.entries()]
            .map(([key, count]) => {
              const [versionRaw, status] = key.split('::') as [string, TemplateRowStatus]
              return { version: Number(versionRaw), status, count }
            })
            .sort((a, b) => a.version - b.version)
          return { variantKey, total: versionCounts.reduce((s, v) => s + v.count, 0), byVersion: versionCounts }
        })
        .sort((a, b) => a.variantKey.localeCompare(b.variantKey))
      return { mode, total: variantCounts.reduce((s, v) => s + v.total, 0), byVariant: variantCounts }
    })
    .sort((a, b) => a.mode.localeCompare(b.mode, 'th'))

  return { total: instances.length, byMode: modeCounts }
}

// ---- container groups ----------------------------------------------------------------------

export interface ContainerInstance {
  templateId: string
  mode: TransportMode
  variantKey: string
  version: number
  status: TemplateRowStatus
  groupCode: string
  containerCode: string
  labelTh: string
  facilityCode?: number
  node: TemplateNode
}

export interface FacilityContainerGroup {
  id: string
  labelTh: string
  instances: ContainerInstance[]
  // §7d — true iff NOT ONE instance in this group carries a facilityCode on any leaf. A group is
  // never partially untagged in practice (the same container label resolves the same way every
  // time it's seen — see facility-tagging.ts's tagContainers), but the check is instance-wise
  // rather than assumed, so a genuine partial-tagging case still surfaces as untagged (fail safe:
  // never silently claim "tagged" for a group missing coverage anywhere).
  facilityTagged: boolean
  breakdown: InstanceBreakdown
}

// Mirrors @repo/types' walkTemplateLeaves exactly: answerType and subItems are checked
// independently, not else-if — some real criteria are BOTH directly answerable AND carry finer
// subItems below them (see checklist-template.ts's parseNode doc), so such a node is itself a leaf
// AND its children are walked too.
function walkLeaves(node: TemplateNode): TemplateNode[] {
  const leaves: TemplateNode[] = []
  if (node.answerType) leaves.push(node)
  if (node.subItems) for (const child of node.subItems) leaves.push(...walkLeaves(child))
  return leaves
}

function containerFacilityCode(container: TemplateNode): number | undefined {
  return walkLeaves(container).find((l) => l.facilityCode !== undefined)?.facilityCode
}

export function buildContainerGroups(templates: FacilityLoadedTemplate[]): FacilityContainerGroup[] {
  const raw: ContainerInstance[] = []
  for (const t of templates) {
    for (const g of t.definition.groups) {
      for (const container of g.items) {
        raw.push({
          templateId: t.templateId,
          mode: t.mode,
          variantKey: t.variantKey,
          version: t.version,
          status: t.status,
          groupCode: g.code,
          containerCode: container.code,
          labelTh: container.labelTh,
          facilityCode: containerFacilityCode(container),
          node: container,
        })
      }
    }
  }

  const clusters = clusterByFuzzyLabel(raw, (c) => c.labelTh, FUZZY_THRESHOLD)
  // Deterministic display order: alphabetical by canonical (first-seen) label, so the same input
  // always yields the same id for the same group (ids are `cg-{n}` after this sort) — see the
  // module doc for why id stability only needs to hold within one grouping computation, not
  // across concurrent edits.
  clusters.sort((a, b) => normalizeLabel(a[0]!.labelTh).localeCompare(normalizeLabel(b[0]!.labelTh), 'th'))

  return clusters.map((instances, i) => ({
    id: `cg-${i}`,
    labelTh: normalizeLabel(instances[0]!.labelTh),
    instances,
    facilityTagged: instances.some((inst) => inst.facilityCode !== undefined),
    breakdown: buildBreakdown(instances),
  }))
}

// ---- canonical items -------------------------------------------------------------------------

export interface ItemInstance {
  templateId: string
  mode: TransportMode
  variantKey: string
  version: number
  status: TemplateRowStatus
  containerCode: string
  nodeCode: string
  position: number
  labelTh: string
  node: TemplateNode
}

export type CanonicalItemClassification = 'SHARED' | 'MODE_SPECIFIC'

export interface CanonicalItem {
  id: string
  containerGroupId: string
  labelTh: string
  instances: ItemInstance[]
  classification: CanonicalItemClassification
  breakdown: InstanceBreakdown
}

interface InstanceKeyed {
  instanceKey: string // `${mode}::${variantKey}::${containerCode}` — one container instance
}

// A container-group's items are pooled from every instance and clustered by fuzzy text alone
// (never position) — report §7c: tactile/signage containers carry per-area SUBSETS of a shared
// item library, so requiring every instance to have the same item at the same position would
// wrongly fragment (or wrongly merge unrelated items at) those containers. "Used in N places"
// falls straight out of a canonical item's instances.length once grouped this way.
//
// The one place position still matters: if a SINGLE container instance repeats the same item text
// twice (rare, but not assumed impossible), a same-instance duplicate must not collapse into one
// canonical item with two "instances" pointing at the same container — see
// splitClusterByOccurrence below.
function buildCanonicalItemsForGroup(group: FacilityContainerGroup): CanonicalItem[] {
  const allLeaves: (ItemInstance & InstanceKeyed)[] = []
  for (const inst of group.instances) {
    // Fix 4 — a leaf marked `standalone` opted out of canonical pooling (see TemplateNode.standalone's
    // doc in @repo/types); it still exists in the container and still counts toward the container's
    // own instance/breakdown numbers, it just never becomes part of a CanonicalItem, so it can never
    // be a propagate/confirm target and its own edits never fan out.
    const leaves = walkLeaves(inst.node).filter((l) => l.standalone !== true)
    leaves.forEach((leaf, position) => {
      allLeaves.push({
        templateId: inst.templateId,
        mode: inst.mode,
        variantKey: inst.variantKey,
        version: inst.version,
        status: inst.status,
        containerCode: inst.containerCode,
        nodeCode: leaf.code,
        position,
        labelTh: leaf.labelTh,
        node: leaf,
        instanceKey: `${inst.mode}::${inst.variantKey}::${inst.containerCode}`,
      })
    })
  }

  const textClusters = clusterByFuzzyLabel(allLeaves, (l) => l.labelTh, FUZZY_THRESHOLD)

  const occurrenceSplit: (ItemInstance & InstanceKeyed)[][] = []
  for (const cluster of textClusters) {
    const byInstance = new Map<string, (ItemInstance & InstanceKeyed)[]>()
    for (const leaf of cluster) {
      if (!byInstance.has(leaf.instanceKey)) byInstance.set(leaf.instanceKey, [])
      byInstance.get(leaf.instanceKey)!.push(leaf)
    }
    const maxOccurrences = Math.max(...[...byInstance.values()].map((v) => v.length))
    const buckets: (ItemInstance & InstanceKeyed)[][] = Array.from({ length: maxOccurrences }, () => [])
    for (const leaves of byInstance.values()) {
      // Same container instance's own leaf order (walkLeaves' document order) decides which
      // occurrence bucket a repeated-text leaf lands in.
      leaves.sort((a, b) => a.position - b.position)
      leaves.forEach((leaf, i) => buckets[i]!.push(leaf))
    }
    occurrenceSplit.push(...buckets)
  }

  // Deterministic order within the group: by canonical text, then by instance count descending
  // (so the highest-fan-out item — the one worth propagating most — sorts first).
  occurrenceSplit.sort((a, b) => {
    const byLabel = normalizeLabel(a[0]!.labelTh).localeCompare(normalizeLabel(b[0]!.labelTh), 'th')
    return byLabel !== 0 ? byLabel : b.length - a.length
  })

  return occurrenceSplit.map((instances, i) => {
    const cleanInstances = instances.map(({ instanceKey: _instanceKey, ...rest }) => rest)
    return {
      id: `${group.id}-item-${i}`,
      containerGroupId: group.id,
      labelTh: normalizeLabel(instances[0]!.labelTh),
      instances: cleanInstances,
      classification: instances.length > 1 ? ('SHARED' as const) : ('MODE_SPECIFIC' as const),
      breakdown: buildBreakdown(cleanInstances),
    }
  })
}

// ---- top-level result -----------------------------------------------------------------------

export interface FacilityGroupsStats {
  totalContainerInstances: number
  totalLeaves: number
  distinctContainerGroups: number
  editUnits: number
}

export interface FacilityGroupsResult {
  containerGroups: FacilityContainerGroup[]
  canonicalItems: CanonicalItem[]
  stats: FacilityGroupsStats
}

export function buildFacilityGroups(templates: FacilityLoadedTemplate[]): FacilityGroupsResult {
  const containerGroups = buildContainerGroups(templates)
  const canonicalItems = containerGroups.flatMap(buildCanonicalItemsForGroup)

  const totalContainerInstances = containerGroups.reduce((sum, g) => sum + g.instances.length, 0)
  const totalLeaves = canonicalItems.reduce((sum, it) => sum + it.instances.length, 0)

  return {
    containerGroups,
    canonicalItems,
    stats: {
      totalContainerInstances,
      totalLeaves,
      distinctContainerGroups: containerGroups.length,
      editUnits: canonicalItems.length,
    },
  }
}

// ---- Part 2 — conflict detection (gates propagation) -----------------------------------------

function measurementSignature(m: TemplateMeasurement): string {
  const byLaw = m.byLaw
    ? Object.entries(m.byLaw)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, e]) => `${k}=${e.value ?? ''}/${e.value2 ?? ''}/${e.tiers ? JSON.stringify(e.tiers) : ''}`)
        .join(';')
    : ''
  return [m.operator, m.value ?? '', m.value2 ?? '', m.unit, m.tiers ? JSON.stringify(m.tiers) : '', byLaw, m.autoGrade].join('|')
}

// The signature two "identical" leaves are compared under — text is deliberately EXCLUDED (that's
// the grouping key already); this is only the DATA a shared edit would actually overwrite.
export function leafDataSignature(node: TemplateNode): string {
  return `${node.answerType ?? ''}##${(node.measurements ?? []).map(measurementSignature).join('&&')}`
}

export interface ConflictVariant {
  signature: string
  instances: ItemInstance[]
}

export interface ItemConflict {
  canonicalItemId: string
  containerGroupId: string
  labelTh: string
  variants: ConflictVariant[]
  // True once every divergent instance carries `conflictSplitAcknowledged` — an admin decision
  // that this item is legitimately different per template, not an unreviewed data bug. Still
  // reported (never silently dropped) so the queue stays an honest record, just no longer counted
  // toward "needs review".
  acknowledged: boolean
}

// report §7b: 19 item texts share wording but diverge in answerType/measurements — pre-existing
// migration artifacts (air/water flat-vs-byLaw, presence vs presence_standard drift). Only
// SHARED canonical items (>1 instance) can conflict by definition.
export function detectConflicts(result: FacilityGroupsResult): ItemConflict[] {
  const conflicts: ItemConflict[] = []
  for (const item of result.canonicalItems) {
    if (item.instances.length < 2) continue
    const bySignature = new Map<string, ItemInstance[]>()
    for (const inst of item.instances) {
      const sig = leafDataSignature(inst.node)
      if (!bySignature.has(sig)) bySignature.set(sig, [])
      bySignature.get(sig)!.push(inst)
    }
    if (bySignature.size < 2) continue

    const variants: ConflictVariant[] = [...bySignature.entries()].map(([signature, instances]) => ({ signature, instances }))
    variants.sort((a, b) => b.instances.length - a.instances.length)
    conflicts.push({
      canonicalItemId: item.id,
      containerGroupId: item.containerGroupId,
      labelTh: item.labelTh,
      variants,
      acknowledged: item.instances.every((inst) => inst.node.conflictSplitAcknowledged === true),
    })
  }
  // Biggest conflicts (most occurrences) first — matches the report's own ranking.
  conflicts.sort((a, b) => b.variants.reduce((s, v) => s + v.instances.length, 0) - a.variants.reduce((s, v) => s + v.instances.length, 0))
  return conflicts
}

// A canonical item is eligible for a propagated (fan-out) edit iff it has more than one instance
// AND none of those instances currently diverge in data — i.e. it has no live conflict. This is
// the single gate every propagation code path must call through; see
// templates.service.ts#propagateItemEdit and #confirmGroupedMeasurement.
export function isPropagatable(item: CanonicalItem): boolean {
  if (item.instances.length < 2) return false
  const signatures = new Set(item.instances.map((inst) => leafDataSignature(inst.node)))
  return signatures.size <= 1
}
