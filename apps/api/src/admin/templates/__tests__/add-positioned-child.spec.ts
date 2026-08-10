/**
 * Session S4b-fix, Fix 3 — addPositionedChildNode: inserts a sibling before/after a named anchor.
 * Two things must hold: (1) codes stay append-only and never collide with/reuse the anchor's own
 * code, sharing the SAME counter as the ordinary end-of-list addChildNode; (2) the requested
 * before/after POSITION is honored independently of the code assigned.
 */
import type { ChecklistTemplateDefinition } from '@repo/types'
import { TemplateEditError, addChildNode, addPositionedChildNode } from '../templates.core'

function fixture(): ChecklistTemplateDefinition {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      {
        code: 'A1',
        labelTh: 'พื้นที่โถงผู้โดยสาร',
        items: [
          {
            code: 'A1.1',
            labelTh: 'โถงผู้โดยสาร',
            subItems: [
              { code: 'A1.1-1', labelTh: 'ทางลาด', answerType: 'presence' },
              { code: 'A1.1-2', labelTh: 'ตู้โทรศัพท์ล่ามภาษามือ (TTRS)', answerType: 'presence', facilityCode: 33, beyondLaw: true },
              { code: 'A1.1-3', labelTh: 'ป้ายสัญลักษณ์', answerType: 'presence' },
            ],
          },
        ],
      },
    ],
  }
}

function siblingCodes(def: ChecklistTemplateDefinition): string[] {
  return def.groups[0]!.items[0]!.subItems!.map((n) => n.code)
}

describe('addPositionedChildNode — Fix 3 append-only-code proof', () => {
  it('inserted BEFORE the anchor gets a NEW code, never the anchor\'s own code', () => {
    const result = addPositionedChildNode(fixture(), 'A1.1', 'A1.1-2', 'before', { labelTh: 'ถังขยะแบบยกเคลื่อนที่ได้', type: 'presence', facilityCode: 27 })
    expect(result.code).not.toBe('A1.1-2')
    expect(result.code).toBe('A1.1-4') // next free seq (3 existing children -> seq 4)
  })

  it('position is honored: the new node sits immediately BEFORE the anchor in subItems, regardless of its code', () => {
    const result = addPositionedChildNode(fixture(), 'A1.1', 'A1.1-2', 'before', { labelTh: 'ถังขยะแบบยกเคลื่อนที่ได้', type: 'presence' })
    const codes = siblingCodes(result.definition)
    expect(codes).toEqual(['A1.1-1', 'A1.1-4', 'A1.1-2', 'A1.1-3'])
  })

  it('position AFTER places the new node immediately after the anchor', () => {
    const result = addPositionedChildNode(fixture(), 'A1.1', 'A1.1-2', 'after', { labelTh: 'ถังขยะแบบยกเคลื่อนที่ได้', type: 'presence' })
    const codes = siblingCodes(result.definition)
    expect(codes).toEqual(['A1.1-1', 'A1.1-2', 'A1.1-4', 'A1.1-3'])
  })

  it('shares the SAME append-only counter as the ordinary end-of-list addChildNode — two inserts never collide', () => {
    const afterFirst = addPositionedChildNode(fixture(), 'A1.1', 'A1.1-2', 'before', { labelTh: 'รายการที่ 1', type: 'presence' })
    const afterSecond = addChildNode(afterFirst.definition, 'A1.1', { labelTh: 'รายการที่ 2', type: 'presence' })
    expect(afterFirst.code).toBe('A1.1-4')
    expect(afterSecond.code).toBe('A1.1-5')
    // Deleting neither: both codes remain present and distinct.
    const codes = siblingCodes(afterSecond.definition)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('a missing anchor code is reported, never silently guessed — the target template must be skipped by the caller', () => {
    expect(() =>
      addPositionedChildNode(fixture(), 'A1.1', 'A1.1-999', 'before', { labelTh: 'x', type: 'presence' }),
    ).toThrow(TemplateEditError)
  })

  it('carries facilityCode/lawRefs/beyondLaw through onto the new node when supplied', () => {
    const result = addPositionedChildNode(fixture(), 'A1.1', 'A1.1-2', 'before', {
      labelTh: 'ถังขยะแบบยกเคลื่อนที่ได้',
      type: 'presence',
      facilityCode: 27,
      lawRefs: ['PSD_2555'],
    })
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === result.code)!
    expect(node.facilityCode).toBe(27)
    expect(node.lawRefs).toEqual(['PSD_2555'])
  })
})
