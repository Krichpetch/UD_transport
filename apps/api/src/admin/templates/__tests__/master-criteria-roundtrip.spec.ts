/**
 * Session S5, Part 1 + Verification #3/#6 — the export/import round-trip and byte-parity for the
 * two new TemplateNode fields (masterId/detachedFromMasterId).
 *
 * "Export -> fresh import -> re-export is byte-stable" is modeled exactly the way seed-templates.ts
 * and the export endpoint actually operate, without a live DB (prisma/ scripts have no jest harness
 * in this repo — see restore-template-approvals.ts's own doc): a raw *_v3.json file's shape is
 * `{...ChecklistTemplateDefinition fields, masterCriteria}` (Part 1's file format); "import" is
 * parseTemplateDefinition + parseMasterCriteriaBlock; "export" is the reverse composition via
 * toMasterCriterionExport. This test exercises that exact pipeline of pure functions.
 */
import type { ChecklistTemplateDefinition, MasterCriterionPayload } from '@repo/types'
import { collectReferencedMasterIds, parseMasterCriteriaBlock, parseTemplateDefinition, toMasterCriterionExport } from '@repo/types'
import { pushMasterToInstance } from '../master-criteria.core'

function fixture(): ChecklistTemplateDefinition {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      {
        code: 'A1',
        labelTh: 'ทางลาดสำหรับคนพิการ',
        items: [
          {
            code: 'A1.1',
            labelTh: 'ทางลาด',
            subItems: [
              { code: 'A1.1-1', labelTh: 'ความกว้าง', answerType: 'presence_standard', measurements: [{ key: 'm1', operator: 'gte', value: 900, unit: 'mm', autoGrade: true, confirmed: false }] },
              { code: 'A1.1-2', labelTh: 'พื้นผิว', answerType: 'presence' },
            ],
          },
        ],
      },
    ],
  }
}

const master: MasterCriterionPayload = {
  id: 'master-1',
  labelTh: 'ความกว้างทางลาดไม่น้อยกว่า 900 มิลลิเมตร',
  answerType: 'presence_standard',
  measurements: [{ key: 'm1', operator: 'gte', value: 900, unit: 'mm', autoGrade: true, confirmed: true }],
  guidance: { text: 'วัดจากขอบถึงขอบ' },
  imageKeys: ['template-images/master1.jpg'],
  lawRefs: ['MHT_2548'],
  cabinetResolution: true,
  beyondLaw: false,
  facilityCode: 2,
}

// Simulates the raw *_v3.json file shape a curator would save after downloading the export
// (definition fields spread at the top level + a `masterCriteria` sibling key — see
// templates.service.ts#exportTemplate's doc and packages/types/src/master-criterion.ts's doc for
// why this is a plain sibling key rather than part of ChecklistTemplateDefinition itself).
function toFileShape(def: ChecklistTemplateDefinition, masters: MasterCriterionPayload[]) {
  return { ...def, masterCriteria: masters.map((m) => toMasterCriterionExport(m)) }
}

describe('master-criteria export/import round-trip — Part 1 / Verification #3', () => {
  it('DB state -> export -> fresh import -> re-export is byte-stable', () => {
    const attached = pushMasterToInstance(fixture(), 'A1.1-1', master, { setMasterId: true, clearDetached: true }).definition

    // ---- export ----
    const masterIds = collectReferencedMasterIds(attached)
    expect(masterIds).toEqual(['master-1'])
    const fileA = toFileShape(attached, [master])
    const jsonA = JSON.stringify(fileA, null, 2)

    // ---- fresh import (a brand-new, empty DB: parseTemplateDefinition + parseMasterCriteriaBlock
    // are exactly what seed-templates.ts's V3_VARIANTS loop calls on the parsed file) ----
    const raw = JSON.parse(jsonA) as Record<string, unknown>
    const importedDef = parseTemplateDefinition(raw)
    const importedMasters = parseMasterCriteriaBlock(raw.masterCriteria)
    expect(importedMasters).toHaveLength(1)
    expect(importedMasters[0]!.id).toBe('master-1')

    // masterId survived the import as an ordinary TemplateNode field — no relinking step needed.
    const importedNode = importedDef.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(importedNode.masterId).toBe('master-1')

    // ---- re-export from the freshly-imported state ----
    const reExportedMasterPayload: MasterCriterionPayload = {
      id: importedMasters[0]!.id,
      labelTh: importedMasters[0]!.labelTh,
      answerType: importedMasters[0]!.answerType,
      measurements: importedMasters[0]!.measurements,
      guidance: importedMasters[0]!.guidance,
      imageKeys: importedMasters[0]!.imageKeys ?? [],
      lawRefs: importedMasters[0]!.lawRefs ?? [],
      cabinetResolution: importedMasters[0]!.cabinetResolution,
      beyondLaw: importedMasters[0]!.beyondLaw,
      facilityCode: importedMasters[0]!.facilityCode,
    }
    const fileB = toFileShape(importedDef, [reExportedMasterPayload])
    const jsonB = JSON.stringify(fileB, null, 2)

    expect(jsonB).toEqual(jsonA)
  })

  it('a detached instance still exports its masterId via detachedFromMasterId, so re-attach has something to link to', () => {
    const attached = pushMasterToInstance(fixture(), 'A1.1-1', master, { setMasterId: true, clearDetached: true }).definition
    const detachedNode = attached.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    detachedNode.masterId = undefined
    detachedNode.detachedFromMasterId = 'master-1'

    expect(collectReferencedMasterIds(attached)).toEqual(['master-1'])
  })

  it('a definition with no master links exports an empty masterCriteria block and imports cleanly', () => {
    const def = fixture()
    expect(collectReferencedMasterIds(def)).toEqual([])
    const file = toFileShape(def, [])
    const raw = JSON.parse(JSON.stringify(file)) as Record<string, unknown>
    expect(parseMasterCriteriaBlock(raw.masterCriteria)).toEqual([])
    expect(parseTemplateDefinition(raw)).toEqual(parseTemplateDefinition(def))
  })

  it('parseMasterCriteriaBlock rejects a malformed entry rather than silently dropping it', () => {
    expect(() => parseMasterCriteriaBlock([{ labelTh: 'no id' }])).toThrow()
    expect(() => parseMasterCriteriaBlock('not an array')).toThrow()
  })
})

describe('TemplateNode.masterId/detachedFromMasterId — Verification #6 (S4b byte-parity extended)', () => {
  it('an untouched node round-trips through parseTemplateDefinition with neither field present', () => {
    const def = fixture()
    const roundTripped = parseTemplateDefinition(parseTemplateDefinition(def))
    const node = roundTripped.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect('masterId' in node).toBe(false)
    expect('detachedFromMasterId' in node).toBe(false)
  })

  it('a node with masterId set survives a second parseTemplateDefinition pass unchanged', () => {
    const attached = pushMasterToInstance(fixture(), 'A1.1-1', master, { setMasterId: true, clearDetached: true }).definition
    const roundTripped = parseTemplateDefinition(parseTemplateDefinition(attached))
    const node = roundTripped.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.masterId).toBe('master-1')
  })
})
