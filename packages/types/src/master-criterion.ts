// Session S5, Part A/1 — master/reference criterion data shapes + the export/import round-trip
// block. Lives in @repo/types (not apps/api/src, where the rest of the S5 write-through/push logic
// lives) for the same reason tagContainers/tagLeaves were extracted here in Session S4b: apps/api's
// tsconfig `rootDir: "./src"` forbids importing FROM apps/api/src INTO apps/api/prisma/ scripts,
// and prisma/seed-templates.ts (Part 0's import path) needs to read a template file's
// `masterCriteria` sibling block the exact same way the export endpoint (apps/api/src) writes it —
// so both sides share this one parser/serializer pair via the package both already depend on.
import type { ChecklistTemplateDefinition, TemplateAnswerType, TemplateGuidance, TemplateMeasurement } from './checklist-template.js'
import { ChecklistTemplateValidationError, indexTemplateNodesByCode } from './checklist-template.js'

// Framework-agnostic mirror of the MasterCriterion Prisma row (apps/api/prisma/schema.prisma) —
// the payload every write-through push/export ultimately reads from.
export interface MasterCriterionPayload {
  id: string
  labelTh: string
  answerType?: TemplateAnswerType | null
  measurements?: TemplateMeasurement[] | null
  guidance?: TemplateGuidance | null
  imageKeys: string[]
  lawRefs: string[]
  cabinetResolution?: boolean | null
  beyondLaw?: boolean | null
  facilityCode?: number | null
}

// The shape one MasterCriterion takes inside a template export/import file's top-level
// `masterCriteria[]` sibling key (Part 1). Deliberately NOT the same TS type as
// MasterCriterionPayload even though the fields overlap: this one drops empty/default values
// entirely (no `imageKeys: []`, no `cabinetResolution: false`) to match the rest of this package's
// "never serialize a default as an explicit value" convention (see hidden/standalone in
// checklist-template.ts), so an export is minimal and stable.
export interface MasterCriterionExport {
  id: string
  labelTh: string
  answerType?: TemplateAnswerType
  measurements?: TemplateMeasurement[]
  guidance?: TemplateGuidance
  imageKeys?: string[]
  lawRefs?: string[]
  cabinetResolution?: boolean
  beyondLaw?: boolean
  facilityCode?: number
  updatedBy?: string
}

// Every distinct masterId a definition's nodes reference — attached (masterId) OR detached-with-
// breadcrumb (detachedFromMasterId), first-seen order. A detached instance's master is still worth
// exporting: without it, a later re-attach in a freshly-imported environment would have nothing to
// link back to.
export function collectReferencedMasterIds(def: ChecklistTemplateDefinition): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const node of indexTemplateNodesByCode(def).values()) {
    for (const id of [node.masterId, node.detachedFromMasterId]) {
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
    }
  }
  return ids
}

export function toMasterCriterionExport(m: MasterCriterionPayload & { updatedBy?: string | null }): MasterCriterionExport {
  return {
    id: m.id,
    labelTh: m.labelTh,
    ...(m.answerType ? { answerType: m.answerType } : {}),
    ...(m.measurements && m.measurements.length > 0 ? { measurements: m.measurements } : {}),
    ...(m.guidance ? { guidance: m.guidance } : {}),
    ...(m.imageKeys.length > 0 ? { imageKeys: m.imageKeys } : {}),
    ...(m.lawRefs.length > 0 ? { lawRefs: m.lawRefs } : {}),
    ...(m.cabinetResolution ? { cabinetResolution: true as const } : {}),
    ...(m.beyondLaw ? { beyondLaw: true as const } : {}),
    ...(m.facilityCode !== null && m.facilityCode !== undefined ? { facilityCode: m.facilityCode } : {}),
    ...(m.updatedBy ? { updatedBy: m.updatedBy } : {}),
  }
}

// Validates the raw `masterCriteria` sibling key of an imported *_v3.json file. Shallow but firm
// on identity fields (id/labelTh) — measurement/guidance shape is re-validated for real the moment
// a master is pushed onto a node (apps/api's pushMasterToInstance re-validates through
// parseTemplateDefinition), so this only needs to guarantee the block is well-formed enough to
// index and store, not re-implement parseMeasurement's full rules a second time.
export function parseMasterCriteriaBlock(raw: unknown): MasterCriterionExport[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new ChecklistTemplateValidationError('masterCriteria must be an array when present', '$.masterCriteria')
  return raw.map((entry, i) => {
    const path = `$.masterCriteria[${i}]`
    if (typeof entry !== 'object' || entry === null) throw new ChecklistTemplateValidationError('must be an object', path)
    const o = entry as Record<string, unknown>
    if (typeof o.id !== 'string' || o.id.length === 0) throw new ChecklistTemplateValidationError('id must be a non-empty string', `${path}.id`)
    if (typeof o.labelTh !== 'string' || o.labelTh.length === 0) {
      throw new ChecklistTemplateValidationError('labelTh must be a non-empty string', `${path}.labelTh`)
    }
    return {
      id: o.id,
      labelTh: o.labelTh,
      answerType: typeof o.answerType === 'string' ? (o.answerType as TemplateAnswerType) : undefined,
      measurements: Array.isArray(o.measurements) ? (o.measurements as TemplateMeasurement[]) : undefined,
      guidance: o.guidance && typeof o.guidance === 'object' ? (o.guidance as TemplateGuidance) : undefined,
      imageKeys: Array.isArray(o.imageKeys) ? (o.imageKeys as string[]) : undefined,
      lawRefs: Array.isArray(o.lawRefs) ? (o.lawRefs as string[]) : undefined,
      cabinetResolution: typeof o.cabinetResolution === 'boolean' ? o.cabinetResolution : undefined,
      beyondLaw: typeof o.beyondLaw === 'boolean' ? o.beyondLaw : undefined,
      facilityCode: typeof o.facilityCode === 'number' ? o.facilityCode : undefined,
      updatedBy: typeof o.updatedBy === 'string' ? o.updatedBy : undefined,
    }
  })
}
