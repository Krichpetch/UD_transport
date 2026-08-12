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
// Session S5-fix (round 2) — the engine is now a RECURSIVE TREE, not a fixed two-level
// (container -> leaf) model. Real checklists have an arbitrary number of intermediate hierarchy
// levels (e.g. the slope/ramp container "ทางลาดสำหรับคนพิการ" carries THREE length-tier
// sub-containers — "case ≤2500mm" / "2500-6000mm" / "≥6000mm" — each with its own near-identical
// sub-leaves). The old model only grouped at "items directly under a `group`" (depth 0) and
// "leaves anywhere below that" (flattened via walkLeaves, erasing the tier boundary), which both
// hid that middle layer from the admin AND wrongly flattened same-text leaves from DIFFERENT
// tiers into occurrence-index siblings. `CanonicalItem` is now the ONE recursive node type used at
// every depth — a depth-0 entry (what used to be a "FacilityContainerGroup") IS a CanonicalItem,
// same shape as a leaf edit unit, just with `isLeaf: false` and a populated `children[]`. This
// mirrors the individual per-node editor (TemplateTree.tsx), which already renders and edits every
// node — container or leaf — uniformly.
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
// "Blast radius" breakdown, computed once per node, so an admin sees it on the browse cards/rows —
// not only in the write-time fan-out preview. version+status are both carried through (not just
// version) so a mixed-scope computation (Part 5 — pre/post v1/v2 retirement) stays legible: two
// rows at the same version can differ in status while a retirement is in flight.

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

// ---- tree instances -------------------------------------------------------------------------

// One template's occurrence of ONE tree node (leaf or container, any depth). `parentCode` is the
// code of the node's immediate container — the enclosing GROUP's code at depth 0 (e.g. 'A1'), or
// the immediate parent NODE's own code at any deeper level. This is exactly what
// addPositionedChildNode already needs as its `containerCode` argument (it tries a group-code
// lookup first, falling back to a node-code lookup — see templates.core.ts), so a single field
// serves both depths without the caller needing to know which kind it is.
export interface ItemInstance {
  templateId: string
  mode: TransportMode
  variantKey: string
  version: number
  status: TemplateRowStatus
  parentCode: string
  nodeCode: string
  // Raw sibling index within this instance's OWN parent's children array (group.items or
  // node.subItems), exactly as stored in the source template — i.e. real checklist reading order.
  // Used both to order display (Part C's "sort by where it appears in the checklist, not by id or
  // count") and, at depth >= 1, to bucket same-text occurrences within one parent instance (see
  // clusterAndSplitByOccurrence) — the same array position serves both purposes since occurrence
  // detection only ever looks at DIRECT siblings of one already-matched parent.
  docOrder: number
  labelTh: string
  node: TemplateNode
}

export type CanonicalItemClassification = 'SHARED' | 'MODE_SPECIFIC'

// The one recursive node type. `isLeaf` is independent of `children.length > 0` — a "hybrid" node
// (own answerType AND subItems, see checklist-template.ts's parseNode doc) is both editable as a
// leaf AND has children, matching @repo/types#walkTemplateLeaves' own independent-checks semantics.
export interface CanonicalItem {
  id: string
  parentId: string | null
  // The depth-0 ancestor's id (equals `id` itself for a depth-0 node) — lets a caller resolve
  // "which top-level container group does this leaf ultimately belong to" in O(1) regardless of
  // how many intermediate hierarchy levels sit between them (see master-migration.core.ts's
  // facility-type filter, the one consumer that needs this).
  rootId: string
  depth: number
  labelTh: string
  instances: ItemInstance[]
  children: CanonicalItem[]
  isLeaf: boolean
  classification: CanonicalItemClassification
  breakdown: InstanceBreakdown
  // §7d (generalized to any depth) — true iff SOME instance's own subtree carries a facilityCode
  // on any leaf. Read-only display aid, never used for grouping.
  facilityTagged: boolean
  // Session S5-fix (round 3) — this node's OWN representative facilityCode (the FIRST tagged code
  // found among its own instances, same "any instance is representative once conflict-free" logic
  // used elsewhere — see containerFacilityCode), distinct from `facilityTagged` which only asks
  // yes/no and also looks into children. Used to sort depth-0 groups by the FACILITY_CATALOG's own
  // 1-33 numbering (@repo/types) instead of document order — see facility-groups.service.ts's
  // getGroups doc. undefined for an untagged group, which the frontend sorts to the bottom.
  facilityCode?: number
  // Session S5-fix, Part C — set once this node has an explicit MasterCriterion behind it (any
  // instance carries a live `masterId`; all linked instances point at the SAME master by
  // construction — see facility-groups.service.ts#propagateItemEdit's promote-on-edit flow).
  masterId?: string
  // Session S5-fix (round 2), Part C — minimum docOrder across this node's own instances; siblings
  // sort by this ascending, so the display order matches "which one appears first in the actual
  // checklist" rather than alphabetical label or instance count.
  sortKey: number
}

function walkLeaves(node: TemplateNode): TemplateNode[] {
  const leaves: TemplateNode[] = []
  if (node.answerType) leaves.push(node)
  if (node.subItems) for (const child of node.subItems) leaves.push(...walkLeaves(child))
  return leaves
}

function containerFacilityCode(node: TemplateNode): number | undefined {
  return walkLeaves(node).find((l) => l.facilityCode !== undefined)?.facilityCode
}

function rootInstances(templates: FacilityLoadedTemplate[]): ItemInstance[] {
  const raw: ItemInstance[] = []
  for (const t of templates) {
    for (const g of t.definition.groups) {
      g.items.forEach((item, i) => {
        raw.push({
          templateId: t.templateId,
          mode: t.mode,
          variantKey: t.variantKey,
          version: t.version,
          status: t.status,
          parentCode: g.code,
          nodeCode: item.code,
          docOrder: i,
          labelTh: item.labelTh,
          node: item,
        })
      })
    }
  }
  return raw
}

function childInstancesOf(members: ItemInstance[]): ItemInstance[] {
  const out: ItemInstance[] = []
  for (const inst of members) {
    ;(inst.node.subItems ?? []).forEach((child, i) => {
      out.push({
        templateId: inst.templateId,
        mode: inst.mode,
        variantKey: inst.variantKey,
        version: inst.version,
        status: inst.status,
        parentCode: inst.nodeCode,
        nodeCode: child.code,
        docOrder: i,
        labelTh: child.labelTh,
        node: child,
      })
    })
  }
  return out
}

interface RawCluster {
  masterId: string | undefined
  members: ItemInstance[]
}

// Fix 4 — a leaf marked `standalone` opted out of pooling entirely (see TemplateNode.standalone's
// doc in @repo/types); masterId'd nodes are NOT excluded (Session S5-fix, Part C — the fuzzy
// matcher is discovery-only, see composeMasterAndFuzzyClusters below).
function eligible(instances: ItemInstance[]): ItemInstance[] {
  return instances.filter((i) => i.node.standalone !== true)
}

function groupByMasterId(instances: ItemInstance[]): RawCluster[] {
  const byMaster = new Map<string, ItemInstance[]>()
  for (const inst of instances) {
    const id = inst.node.masterId!
    if (!byMaster.has(id)) byMaster.set(id, [])
    byMaster.get(id)!.push(inst)
  }
  return [...byMaster.entries()].map(([masterId, members]) => ({ masterId: masterId as string | undefined, members }))
}

// Session S5-fix, Part C — compose masterId clusters (stable identity, immune to text drift) with
// fuzzy-text clusters (discovery) into ONE set of RawClusters. An unlinked cluster only merges into
// a master cluster when EXACTLY ONE master cluster shares its text — an occurrence-duplicated item
// (rare; the ramp width's two-sides case is the only known real one) can have one occurrence
// promoted and the other not, leaving two same-text master-vs-unlinked clusters; guessing which one
// a leftover belongs to would risk attaching it to the wrong occurrence's master, so an ambiguous
// match is left standalone instead of guessed.
function composeMasterAndFuzzyClusters(instances: ItemInstance[], fuzzyClusters: ItemInstance[][]): RawCluster[] {
  const linked = instances.filter((i) => i.node.masterId !== undefined)
  const masterClusters = groupByMasterId(linked)

  const remainingUnlinked: ItemInstance[][] = []
  for (const cluster of fuzzyClusters) {
    const key = matchKey(cluster[0]!.labelTh)
    const matches = masterClusters.filter((mc) => {
      const repKey = matchKey(mc.members[0]!.labelTh)
      return key === repKey || levenshteinRatio(key, repKey) >= FUZZY_THRESHOLD
    })
    if (matches.length === 1) matches[0]!.members.push(...cluster)
    else remainingUnlinked.push(cluster)
  }

  return [...masterClusters, ...remainingUnlinked.map((members) => ({ masterId: undefined as string | undefined, members }))]
}

// Occurrence-split: if a SINGLE parent instance repeats the same item text twice (rare, but not
// assumed impossible — e.g. two sides of a ramp), a same-instance duplicate must not collapse into
// one node with two "instances" pointing at the same parent. Only meaningful for depth >= 1, where
// `instances` are already scoped to the children of ONE already-matched parent cluster — see
// buildChildren below. `docOrder` (this level's own sibling position) decides bucket assignment.
function occurrenceSplitFuzzyClusters(unlinked: ItemInstance[]): ItemInstance[][] {
  const textClusters = clusterByFuzzyLabel(unlinked, (l) => l.labelTh, FUZZY_THRESHOLD)
  const split: ItemInstance[][] = []
  for (const cluster of textClusters) {
    const byParent = new Map<string, ItemInstance[]>()
    for (const inst of cluster) {
      const key = `${inst.mode}::${inst.variantKey}::${inst.parentCode}::${inst.templateId}`
      if (!byParent.has(key)) byParent.set(key, [])
      byParent.get(key)!.push(inst)
    }
    const maxOccurrences = Math.max(...[...byParent.values()].map((v) => v.length))
    const buckets: ItemInstance[][] = Array.from({ length: maxOccurrences }, () => [])
    for (const siblings of byParent.values()) {
      siblings.sort((a, b) => a.docOrder - b.docOrder)
      siblings.forEach((inst, i) => buckets[i]!.push(inst))
    }
    split.push(...buckets)
  }
  return split
}

function sortClusters(clusters: RawCluster[]): RawCluster[] {
  return [...clusters].sort((a, b) => {
    const byLabel = normalizeLabel(a.members[0]!.labelTh).localeCompare(normalizeLabel(b.members[0]!.labelTh), 'th')
    return byLabel !== 0 ? byLabel : b.members.length - a.members.length
  })
}

function buildNode(cluster: RawCluster, parentId: string | null, rootId: string | null, depth: number, id: string): CanonicalItem {
  const members = cluster.members
  const isLeaf = members.some((m) => m.node.answerType !== undefined)
  const resolvedRootId = rootId ?? id
  const childRaw = childInstancesOf(members)
  const children = childRaw.length > 0 ? buildChildren(childRaw, id, resolvedRootId, depth + 1) : []
  const facilityCode = members.map((m) => containerFacilityCode(m.node)).find((c) => c !== undefined)
  const facilityTagged = facilityCode !== undefined || children.some((c) => c.facilityTagged)

  return {
    id,
    parentId,
    rootId: resolvedRootId,
    depth,
    labelTh: normalizeLabel(members[0]!.labelTh),
    instances: members,
    children,
    isLeaf,
    classification: members.length > 1 ? ('SHARED' as const) : ('MODE_SPECIFIC' as const),
    breakdown: buildBreakdown(members),
    facilityTagged,
    facilityCode,
    masterId: cluster.masterId,
    sortKey: Math.min(...members.map((m) => m.docOrder)),
  }
}

// Depth >= 1 — children of an already-matched parent cluster. Occurrence-aware (see
// occurrenceSplitFuzzyClusters) since these instances are already scoped to ONE real container's
// worth of pooled data across templates, exactly like the old buildCanonicalItemsForGroup did for
// leaves specifically; now applies at every depth, so an intermediate hierarchy level (e.g. the
// ramp's length-tier sub-containers) is preserved as its OWN node instead of being flattened away.
function buildChildren(instances: ItemInstance[], parentId: string, rootId: string, depth: number): CanonicalItem[] {
  const pool = eligible(instances)
  const unlinked = pool.filter((i) => i.node.masterId === undefined)
  const fuzzyClusters = occurrenceSplitFuzzyClusters(unlinked)
  const clusters = sortClusters(composeMasterAndFuzzyClusters(pool, fuzzyClusters))
  return clusters.map((cluster, i) => buildNode(cluster, parentId, rootId, depth, `${parentId}-${i}`))
}

// Depth 0 — items directly under a `group`, pooled GLOBALLY across every group in every template
// (not scoped per-group: report §6's whole point is that the "same real facility" can recur at
// different points in one template's own document, e.g. a curb ramp appearing under both A1 and
// A2). No occurrence-split here — this mirrors the original (pre round-2) buildContainerGroups
// behavior exactly, which facility-grouping.spec.ts's real-data numbers are pinned against; only
// depth >= 1 (buildChildren) needed the occurrence-aware treatment this round-2 rewrite added.
export function buildContainerGroups(templates: FacilityLoadedTemplate[]): CanonicalItem[] {
  const pool = eligible(rootInstances(templates))
  const unlinked = pool.filter((i) => i.node.masterId === undefined)
  const fuzzyClusters = clusterByFuzzyLabel(unlinked, (l) => l.labelTh, FUZZY_THRESHOLD)
  const clusters = sortClusters(composeMasterAndFuzzyClusters(pool, fuzzyClusters))
  return clusters.map((cluster, i) => buildNode(cluster, null, null, 0, `cg-${i}`))
}

// Every node in the tree, any depth, in no particular guaranteed order (callers that need a
// specific order — e.g. the frontend's display — sort separately, see sortKey).
export function flattenTree(roots: CanonicalItem[]): CanonicalItem[] {
  const out: CanonicalItem[] = []
  const walk = (nodes: CanonicalItem[]) => {
    for (const n of nodes) {
      out.push(n)
      walk(n.children)
    }
  }
  walk(roots)
  return out
}

// Every LEAF node in the tree (isLeaf === true), any depth — the edit-unit list conflict
// detection/propagation/review-queue logic operates over. A non-leaf (pure container) node is
// simply never a member of this list, so it can never surface in the conflict queue or review
// queue — it has no answerType/measurements to diverge or confirm in the first place.
export function flattenLeaves(roots: CanonicalItem[]): CanonicalItem[] {
  return flattenTree(roots).filter((n) => n.isLeaf)
}

// ---- top-level result -----------------------------------------------------------------------

export interface FacilityGroupsStats {
  totalContainerInstances: number
  totalLeaves: number
  distinctContainerGroups: number
  editUnits: number
}

export interface FacilityGroupsResult {
  containerGroups: CanonicalItem[] // depth-0 roots; each carries its full subtree via .children
  canonicalItems: CanonicalItem[] // every LEAF node anywhere in the tree, flattened
  stats: FacilityGroupsStats
}

export function buildFacilityGroups(templates: FacilityLoadedTemplate[]): FacilityGroupsResult {
  const containerGroups = buildContainerGroups(templates)
  const canonicalItems = flattenLeaves(containerGroups)

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
// the grouping key already); this is only the DATA a shared edit would actually overwrite. A
// non-leaf (container) node's answerType/measurements are always empty on every instance, so this
// trivially signs identically across instances — containers can never conflict, correctly (there's
// nothing measurement-shaped to diverge on).
export function leafDataSignature(node: TemplateNode): string {
  return `${node.answerType ?? ''}##${(node.measurements ?? []).map(measurementSignature).join('&&')}`
}

export interface ConflictVariant {
  signature: string
  instances: ItemInstance[]
}

export interface ItemConflict {
  canonicalItemId: string
  containerGroupId: string | null
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
// SHARED canonical items (>1 instance) can conflict by definition. Only ever computed over LEAF
// nodes (result.canonicalItems) — a container node has nothing measurement-shaped to conflict on.
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
      containerGroupId: item.parentId,
      labelTh: item.labelTh,
      variants,
      acknowledged: item.instances.every((inst) => inst.node.conflictSplitAcknowledged === true),
    })
  }
  // Biggest conflicts (most occurrences) first — matches the report's own ranking.
  conflicts.sort((a, b) => b.variants.reduce((s, v) => s + v.instances.length, 0) - a.variants.reduce((s, v) => s + v.instances.length, 0))
  return conflicts
}

// A canonical item (leaf OR container) is eligible for a propagated (fan-out) edit iff it has more
// than one instance AND none of those instances currently diverge in data — i.e. it has no live
// conflict. This is the single gate every propagation code path must call through; see
// templates.service.ts#propagateItemEdit and #confirmGroupedMeasurement. For a container node this
// is always true once instances.length > 1 (leafDataSignature is trivially uniform — see its doc),
// which is the correct answer: nothing about a container's own fields (label/images/lawRefs/hidden)
// is gated by this function, only by instance count.
export function isPropagatable(item: CanonicalItem): boolean {
  if (item.instances.length < 2) return false
  const signatures = new Set(item.instances.map((inst) => leafDataSignature(inst.node)))
  return signatures.size <= 1
}

// Session S5-fix (round 4) — a SECOND, independent gate alongside isPropagatable. leafDataSignature
// only compares answerType+measurements — a canonical item can be "propagatable" by that narrower
// definition while its instances still diverge in lawRefs/facilityCode/cabinetResolution/beyondLaw,
// none of which the fuzzy grouping/conflict engine was ever asked to compare. The master push
// (facility-groups.service.ts#propagateThroughMaster) collapses ALL of a leaf's write-through
// fields onto one row, wholesale — so an edit to ANY field (say, just the label) would otherwise
// silently overwrite lawRefs on every OTHER instance with whichever one happened to be
// "representative," discarding real era-override/law-applicability data nobody touched. Originally
// written for master-migration.core.ts's dry-run report (still used there, re-exported for
// backward compat); now also the live gate propagateItemEdit checks before ANY master-routed field
// write, not just the offline migration script.
export function extendedFieldsAgree(item: CanonicalItem): boolean {
  const key = (n: ItemInstance['node']) =>
    JSON.stringify([[...(n.lawRefs ?? [])].sort(), n.facilityCode ?? null, n.cabinetResolution ?? false, n.beyondLaw ?? false])
  const firstKey = key(item.instances[0]!.node)
  return item.instances.every((inst) => key(inst.node) === firstKey)
}
