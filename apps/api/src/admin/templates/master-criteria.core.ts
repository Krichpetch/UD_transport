// Session S5 — master/reference criterion nodes. Pure tree-editing helpers over a
// ChecklistTemplateDefinition, same "no Prisma/DI" convention as templates.core.ts and
// facility-grouping.core.ts (directly unit-testable, no framework wiring). The Nest wrapper
// (master-criteria.service.ts + templates.service.ts's attach/detach endpoints) handles the DB
// read/write, MasterCriterion CRUD, and audit logging around these.
//
// See apps/api/prisma/schema.prisma's MasterCriterion doc for the model this operates against, and
// checklist-template.ts's TemplateNode.masterId/detachedFromMasterId doc for the two node-level
// breadcrumb fields.
import type { ChecklistTemplateDefinition, MasterCriterionPayload, TemplateMeasurement, TemplateNode } from '@repo/types'
import { indexTemplateNodesByCode, parseTemplateDefinition } from '@repo/types'
import { TemplateEditError } from './templates.core'

// MasterCriterionPayload, MasterCriterionExport, and the export/import round-trip helpers
// (collectReferencedMasterIds/toMasterCriterionExport/parseMasterCriteriaBlock) live in
// @repo/types, not here — apps/api/prisma/seed-templates.ts (Part 0's import path) needs to read
// them too, and apps/api's own tsconfig `rootDir: "./src"` forbids importing FROM src INTO prisma/
// scripts (same constraint that moved tagContainers/tagLeaves to @repo/types in Session S4b). This
// module re-exports them for convenience so callers inside src/ can import everything from one
// place; seed-templates.ts imports the same two directly from @repo/types.
export type { MasterCriterionPayload, MasterCriterionExport } from '@repo/types'
export { collectReferencedMasterIds, toMasterCriterionExport, parseMasterCriteriaBlock } from '@repo/types'

// Part B.1 — the write-through field set a MasterCriterion owns on an attached node. Deliberately
// wider than Part B.1's own prose example list (measurements/guidance/imageKeys/lawRefs/
// answerType/labelTh): Part A's schema also gives MasterCriterion facilityCode/cabinetResolution/
// beyondLaw, and those three are exactly the "criterion identity" bundle add-and-place already
// treats as one unit (facility-groups.service.ts#addAndPlace) — a master is meaningless if it can
// diverge from its own facility tagging across instances, so this module write-throughs all nine
// fields as a single invariant, not six.
export type WriteThroughFields = Pick<
  TemplateNode,
  'labelTh' | 'answerType' | 'measurements' | 'guidance' | 'imageKeys' | 'lawRefs' | 'cabinetResolution' | 'beyondLaw' | 'facilityCode'
>

function cloneDefinition(def: ChecklistTemplateDefinition): ChecklistTemplateDefinition {
  return JSON.parse(JSON.stringify(def)) as ChecklistTemplateDefinition
}

function findNode(def: ChecklistTemplateDefinition, nodeCode: string): TemplateNode {
  const node = indexTemplateNodesByCode(def).get(nodeCode)
  if (!node) throw new TemplateEditError(`unknown node code "${nodeCode}"`)
  return node
}

// Session S5-fix, Part B — exported so facility-groups.service.ts's promote-on-edit flow can
// derive a master payload's fields from an already-edited node without re-implementing this same
// field list a second time.
export function snapshotWriteThroughFields(node: TemplateNode): WriteThroughFields {
  return {
    labelTh: node.labelTh,
    answerType: node.answerType,
    measurements: node.measurements,
    guidance: node.guidance,
    imageKeys: node.imageKeys,
    lawRefs: node.lawRefs,
    cabinetResolution: node.cabinetResolution,
    beyondLaw: node.beyondLaw,
    facilityCode: node.facilityCode,
  }
}

// Part B — physically populates every write-through field onto ONE node from a master payload.
// Deep-clones measurements/guidance so the target node never shares object references with the
// master's own in-memory shape (same discipline overwriteLeafData already follows in
// templates.core.ts). Every measurement is marked confirmed:true — a master-authored value is, by
// definition, an admin-reviewed value, same convention "pick winner" conflict resolution follows.
// Mutates the node in place; caller owns cloning the definition first.
function applyMasterToNode(node: TemplateNode, master: MasterCriterionPayload): void {
  node.labelTh = master.labelTh
  node.answerType = master.answerType ?? undefined
  node.measurements = master.measurements
    ? (JSON.parse(JSON.stringify(master.measurements)) as TemplateMeasurement[]).map((m) => ({ ...m, confirmed: true }))
    : undefined
  node.guidance = master.guidance ? { ...master.guidance } : undefined
  node.imageKeys = master.imageKeys.length > 0 ? [...master.imageKeys] : undefined
  node.lawRefs = master.lawRefs.length > 0 ? [...master.lawRefs] : undefined
  node.cabinetResolution = master.cabinetResolution ?? undefined
  node.beyondLaw = master.beyondLaw ?? undefined
  node.facilityCode = master.facilityCode ?? undefined
}

export interface PushMasterResult {
  definition: ChecklistTemplateDefinition
  before: WriteThroughFields
  after: WriteThroughFields
}

// Part D.1 / Part C.3 (re-attach) shared primitive — one instance's write. `setMasterId`/
// `clearDetached` are separate flags (not always both true) so a caller that already knows the
// node's masterId is correctly set (e.g. an ordinary master-edit push, Part D) doesn't need to
// re-assert it, while first-attach/re-attach (Part C.3) sets both in one call.
export function pushMasterToInstance(
  def: ChecklistTemplateDefinition,
  nodeCode: string,
  master: MasterCriterionPayload,
  opts: { setMasterId: boolean; clearDetached: boolean },
): PushMasterResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  const before = snapshotWriteThroughFields(node)

  applyMasterToNode(node, master)
  if (opts.setMasterId) node.masterId = master.id
  if (opts.clearDetached) node.detachedFromMasterId = undefined

  const validated = parseTemplateDefinition(clone)
  const after = snapshotWriteThroughFields(findNode(validated, nodeCode))
  return { definition: validated, before, after }
}

export interface DetachResult {
  definition: ChecklistTemplateDefinition
  masterId: string
}

// Part C.2 — detach: values are already physically present on the node (Part B's write-through
// invariant), so this is a plain masterId-clear + detachedFromMasterId-set. Never touches the
// write-through fields themselves — the node keeps exactly the values it had at the moment of
// detach, from then on an independent snapshot, editable like any ordinary node.
export function detachFromMaster(def: ChecklistTemplateDefinition, nodeCode: string): DetachResult {
  const clone = cloneDefinition(def)
  const node = findNode(clone, nodeCode)
  if (!node.masterId) throw new TemplateEditError(`node "${nodeCode}" is not attached to a master`)
  const masterId = node.masterId
  node.masterId = undefined
  node.detachedFromMasterId = masterId

  const validated = parseTemplateDefinition(clone)
  return { definition: validated, masterId }
}

// Part C.1 guard primitive — every single-node edit path in templates.service.ts checks this
// before mutating (mirrors the RETIRED-status guard, just node-scoped instead of row-scoped).
export function isNodeAttached(def: ChecklistTemplateDefinition, nodeCode: string): boolean {
  return !!indexTemplateNodesByCode(def).get(nodeCode)?.masterId
}

// Full-tree scan (not just leaves — masterId only ever appears on leaves in practice, but the
// scan itself makes no assumption about that) for every node currently linked to `masterId`,
// either attached (masterId) or detached-with-breadcrumb (detachedFromMasterId). Used by
// master-criteria.service.ts to find the write targets for a push and the "แยกออกแล้ว" list (Part
// D2/F.3) across ALL ChecklistTemplate rows, not just one.
export interface MasterLinkedNode {
  nodeCode: string
  node: TemplateNode
}

export function findAttachedNodes(def: ChecklistTemplateDefinition, masterId: string): MasterLinkedNode[] {
  return [...indexTemplateNodesByCode(def).entries()]
    .filter(([, node]) => node.masterId === masterId)
    .map(([nodeCode, node]) => ({ nodeCode, node }))
}

export function findDetachedNodes(def: ChecklistTemplateDefinition, masterId: string): MasterLinkedNode[] {
  return [...indexTemplateNodesByCode(def).entries()]
    .filter(([, node]) => node.detachedFromMasterId === masterId)
    .map(([nodeCode, node]) => ({ nodeCode, node }))
}

