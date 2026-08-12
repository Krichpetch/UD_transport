/**
 * Session S5, Part B/C — pure write-through/detach/attach mechanics. Same "no Prisma/DI" testing
 * convention as templates.core.spec.ts/facility-grouping.spec.ts: these run directly against
 * ChecklistTemplateDefinition fixtures, no NestJS TestingModule needed.
 */
import type { ChecklistTemplateDefinition, MasterCriterionPayload } from '@repo/types'
import {
  detachFromMaster,
  findAttachedNodes,
  findDetachedNodes,
  isNodeAttached,
  pushMasterToInstance,
} from '../master-criteria.core'

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

describe('pushMasterToInstance — Part B write-through invariant', () => {
  it('physically populates every write-through field onto the node', () => {
    const result = pushMasterToInstance(fixture(), 'A1.1-1', master, { setMasterId: true, clearDetached: true })
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!

    expect(node.labelTh).toBe(master.labelTh)
    expect(node.answerType).toBe('presence_standard')
    expect(node.measurements).toEqual([{ key: 'm1', operator: 'gte', value: 900, value2: null, tiers: undefined, inputs: undefined, unit: 'mm', byLaw: undefined, sourceText: undefined, note: undefined, autoGrade: true, extracted: undefined, confirmed: true }])
    expect(node.guidance).toEqual({ text: 'วัดจากขอบถึงขอบ', reference: undefined })
    expect(node.imageKeys).toEqual(['template-images/master1.jpg'])
    expect(node.lawRefs).toEqual(['MHT_2548'])
    expect(node.cabinetResolution).toBe(true)
    expect(node.facilityCode).toBe(2)
    expect(node.masterId).toBe('master-1')
  })

  it('marks every pushed measurement confirmed:true regardless of the master\'s own flag', () => {
    const unconfirmedMaster: MasterCriterionPayload = { ...master, measurements: [{ ...master.measurements![0]!, confirmed: false }] }
    const result = pushMasterToInstance(fixture(), 'A1.1-1', unconfirmedMaster, { setMasterId: true, clearDetached: true })
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.measurements![0]!.confirmed).toBe(true)
  })

  it('deep-clones measurements — the pushed node never shares object references with the master payload', () => {
    const result = pushMasterToInstance(fixture(), 'A1.1-1', master, { setMasterId: true, clearDetached: true })
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.measurements).not.toBe(master.measurements)
    node.measurements![0]!.value = 12345
    expect(master.measurements![0]!.value).toBe(900)
  })

  it('setMasterId:false leaves an already-set masterId untouched (the ordinary master-edit push path)', () => {
    const attached = pushMasterToInstance(fixture(), 'A1.1-1', master, { setMasterId: true, clearDetached: true }).definition
    const edited = { ...master, labelTh: 'label changed by the master' }
    const result = pushMasterToInstance(attached, 'A1.1-1', edited, { setMasterId: false, clearDetached: false })
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.masterId).toBe('master-1')
    expect(node.labelTh).toBe('label changed by the master')
  })

  it('re-validates through parseTemplateDefinition — a master with no answerType on a leaf with no subItems throws', () => {
    const badMaster: MasterCriterionPayload = { ...master, answerType: undefined, measurements: undefined }
    expect(() => pushMasterToInstance(fixture(), 'A1.1-1', badMaster, { setMasterId: true, clearDetached: true })).toThrow()
  })
})

describe('detachFromMaster — Part C.2', () => {
  it('clears masterId and sets detachedFromMasterId, keeping every write-through value exactly as it was', () => {
    const attached = pushMasterToInstance(fixture(), 'A1.1-1', master, { setMasterId: true, clearDetached: true }).definition
    const result = detachFromMaster(attached, 'A1.1-1')
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!

    expect(result.masterId).toBe('master-1')
    expect(node.masterId).toBeUndefined()
    expect(node.detachedFromMasterId).toBe('master-1')
    // Values survive untouched — no re-derivation, no reset.
    expect(node.labelTh).toBe(master.labelTh)
    expect(node.measurements![0]!.value).toBe(900)
  })

  it('throws when the node is not attached', () => {
    expect(() => detachFromMaster(fixture(), 'A1.1-1')).toThrow()
  })
})

describe('isNodeAttached — Part C.1 guard primitive', () => {
  it('is false for an ordinary node and true once attached', () => {
    expect(isNodeAttached(fixture(), 'A1.1-1')).toBe(false)
    const attached = pushMasterToInstance(fixture(), 'A1.1-1', master, { setMasterId: true, clearDetached: true }).definition
    expect(isNodeAttached(attached, 'A1.1-1')).toBe(true)
  })
})

describe('findAttachedNodes / findDetachedNodes', () => {
  it('finds every node linked to a master, attached or detached-with-breadcrumb', () => {
    const attached = pushMasterToInstance(fixture(), 'A1.1-1', master, { setMasterId: true, clearDetached: true }).definition
    expect(findAttachedNodes(attached, 'master-1').map((n) => n.nodeCode)).toEqual(['A1.1-1'])
    expect(findDetachedNodes(attached, 'master-1')).toHaveLength(0)

    const detached = detachFromMaster(attached, 'A1.1-1').definition
    expect(findAttachedNodes(detached, 'master-1')).toHaveLength(0)
    expect(findDetachedNodes(detached, 'master-1').map((n) => n.nodeCode)).toEqual(['A1.1-1'])
  })

  it('an untouched node never carries masterId/detachedFromMasterId at all (byte-parity)', () => {
    const def = fixture()
    const node = def.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-2')!
    expect('masterId' in node).toBe(false)
    expect('detachedFromMasterId' in node).toBe(false)
  })
})
