/**
 * Session S4b-fix, Fix 3 — addPositionedChildNode: inserts a sibling before/after a named anchor.
 *
 * Era-editor safety follow-up (live feedback, 2026-08-17) — code assignment REVERSED from the
 * original "always append-only" design: the requested before/after POSITION is honored, and the
 * whole level's codes renumber to match that new order (renumberLevelByPosition), so a "before N"
 * insert takes over N's own code and N shifts up by one, rather than the new item always getting
 * the next free number regardless of where it visually lands.
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

describe('addPositionedChildNode — Fix 3, renumber-on-insert (Era-editor safety follow-up)', () => {
  it('inserted BEFORE the anchor takes over the anchor\'s OLD code; the anchor itself shifts up by one', () => {
    const result = addPositionedChildNode(fixture(), 'A1.1', 'A1.1-2', 'before', { labelTh: 'ถังขยะแบบยกเคลื่อนที่ได้', type: 'presence', facilityCode: 27 })
    expect(result.code).toBe('A1.1-2')
    const labels = result.definition.groups[0]!.items[0]!.subItems!.map((n) => n.labelTh)
    expect(labels).toEqual(['ทางลาด', 'ถังขยะแบบยกเคลื่อนที่ได้', 'ตู้โทรศัพท์ล่ามภาษามือ (TTRS)', 'ป้ายสัญลักษณ์'])
  })

  it('position is honored, and the whole level renumbers sequentially to match display order', () => {
    const result = addPositionedChildNode(fixture(), 'A1.1', 'A1.1-2', 'before', { labelTh: 'ถังขยะแบบยกเคลื่อนที่ได้', type: 'presence' })
    const codes = siblingCodes(result.definition)
    expect(codes).toEqual(['A1.1-1', 'A1.1-2', 'A1.1-3', 'A1.1-4'])
  })

  it('position AFTER places the new node immediately after the anchor, shifting only what comes later', () => {
    const result = addPositionedChildNode(fixture(), 'A1.1', 'A1.1-2', 'after', { labelTh: 'ถังขยะแบบยกเคลื่อนที่ได้', type: 'presence' })
    expect(result.code).toBe('A1.1-3')
    const labels = result.definition.groups[0]!.items[0]!.subItems!.map((n) => n.labelTh)
    expect(labels).toEqual(['ทางลาด', 'ตู้โทรศัพท์ล่ามภาษามือ (TTRS)', 'ถังขยะแบบยกเคลื่อนที่ได้', 'ป้ายสัญลักษณ์'])
    const codes = siblingCodes(result.definition)
    expect(codes).toEqual(['A1.1-1', 'A1.1-2', 'A1.1-3', 'A1.1-4'])
  })

  it('a plain append-to-end after a positioned insert continues the sequence correctly (childSeq stays in sync with the renumbered level)', () => {
    const afterFirst = addPositionedChildNode(fixture(), 'A1.1', 'A1.1-2', 'before', { labelTh: 'รายการที่ 1', type: 'presence' })
    const afterSecond = addChildNode(afterFirst.definition, 'A1.1', { labelTh: 'รายการที่ 2', type: 'presence' })
    expect(afterFirst.code).toBe('A1.1-2')
    expect(afterSecond.code).toBe('A1.1-5') // level had 4 items after the positioned insert
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
