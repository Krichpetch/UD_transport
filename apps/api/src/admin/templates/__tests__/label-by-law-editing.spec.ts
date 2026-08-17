// Era-editor safety session, Part C — editLabelByLawOverride: the container-only sibling of
// editEraOverride. Covers add/edit/remove, the same merge-preserves-untouched-field discipline
// (A.2's fix, applied here too), and — the invariant that matters most — proves node.lawRefs is
// NEVER touched by this function, the opposite of editEraOverride's own deliberate union (see
// era-overrides.ts's applyEraOverrides doc and era-container-label.spec.ts's inertness tests,
// which this function must not break).
import type { ChecklistTemplateDefinition } from '@repo/types'
import { ChecklistTemplateValidationError } from '@repo/types'
import { TemplateEditError, editLabelByLawOverride } from '../templates.core'

// Synthetic fixture (not real สนข. data) — a pure container (no answerType, no measurements)
// carrying a case-condition heading, mirroring the real ทางลาด shape era-container-label.spec.ts
// tests at the resolution layer. This file tests the ADMIN WRITE PATH onto that same field.
function fixture(): ChecklistTemplateDefinition {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      {
        code: 'A2',
        labelTh: 'ทางลาด',
        items: [
          {
            code: 'A2.2-1',
            labelTh: 'กรณีทางลาดที่ความยาวไม่เกิน 2,500 มิลลิเมตร',
            labelByLaw: {
              MHT_2548: { labelTh: 'กรณีทางลาดที่ความยาวไม่เกิน 2,500 มิลลิเมตร', sourceText: 'ข้อ 5 กฎกระทรวง 2548' },
            },
            subItems: [{ code: 'A2.2-1.1', labelTh: 'leaf', answerType: 'presence' }],
          },
        ],
      },
    ],
  }
}

describe('editLabelByLawOverride', () => {
  it('adds a new law entry', () => {
    const { before, after, definition } = editLabelByLawOverride(fixture(), 'A2.2-1', 'MHT_2564', {
      labelTh: 'กรณีทางลาดที่ความยาวไม่เกิน 1,800 มิลลิเมตร',
      sourceText: 'ข้อ 5 กฎกระทรวง 2564',
    })
    expect(before).toBeNull()
    expect(after).toEqual({ labelTh: 'กรณีทางลาดที่ความยาวไม่เกิน 1,800 มิลลิเมตร', sourceText: 'ข้อ 5 กฎกระทรวง 2564' })
    const node = definition.groups[0]!.items[0]!
    expect(node.labelByLaw?.MHT_2564).toEqual({ labelTh: 'กรณีทางลาดที่ความยาวไม่เกิน 1,800 มิลลิเมตร', sourceText: 'ข้อ 5 กฎกระทรวง 2564' })
  })

  it('edits an existing law entry', () => {
    const { before, after } = editLabelByLawOverride(fixture(), 'A2.2-1', 'MHT_2548', {
      labelTh: 'ข้อความใหม่',
      sourceText: 'อ้างอิงใหม่',
    })
    expect(before).toEqual({ labelTh: 'กรณีทางลาดที่ความยาวไม่เกิน 2,500 มิลลิเมตร', sourceText: 'ข้อ 5 กฎกระทรวง 2548' })
    expect(after).toEqual({ labelTh: 'ข้อความใหม่', sourceText: 'อ้างอิงใหม่' })
  })

  it('removes a law entry (entry: null)', () => {
    const { after, definition } = editLabelByLawOverride(fixture(), 'A2.2-1', 'MHT_2548', null)
    expect(after).toBeNull()
    expect(definition.groups[0]!.items[0]!.labelByLaw).toBeUndefined()
  })

  it('removing the only entry does not require a fallback (unlike editEraOverride) — node.labelTh always remains valid', () => {
    expect(() => editLabelByLawOverride(fixture(), 'A2.2-1', 'MHT_2548', null)).not.toThrow()
  })

  // The merge fix (A.2), applied to this sibling function too — a patch that supplies labelTh but
  // OMITS sourceText entirely (the key itself absent, not explicit null/undefined-in-JSON) must
  // preserve whatever sourceText was already stored, not silently clear it. Two chained partial
  // edits prove the merge is stable under repeated writes, not a one-time accident (mirrors A.7c).
  it('a labelTh-only patch (sourceText key entirely absent) preserves the existing sourceText — stable across two chained partial edits', () => {
    const first = editLabelByLawOverride(fixture(), 'A2.2-1', 'MHT_2548', { labelTh: 'รอบ 1' })
    let entry = first.definition.groups[0]!.items[0]!.labelByLaw!.MHT_2548!
    expect(entry.labelTh).toBe('รอบ 1')
    expect(entry.sourceText).toBe('ข้อ 5 กฎกระทรวง 2548') // preserved — the patch never mentioned sourceText

    const second = editLabelByLawOverride(first.definition, 'A2.2-1', 'MHT_2548', { labelTh: 'รอบ 2' })
    entry = second.definition.groups[0]!.items[0]!.labelByLaw!.MHT_2548!
    expect(entry.labelTh).toBe('รอบ 2')
    expect(entry.sourceText).toBe('ข้อ 5 กฎกระทรวง 2548') // still preserved after a second partial write

    // An explicit sourceText DOES overwrite, proving this isn't just "sourceText is ignored".
    const third = editLabelByLawOverride(second.definition, 'A2.2-1', 'MHT_2548', { labelTh: 'รอบ 3', sourceText: 'เปลี่ยนแล้ว' })
    entry = third.definition.groups[0]!.items[0]!.labelByLaw!.MHT_2548!
    expect(entry).toEqual({ labelTh: 'รอบ 3', sourceText: 'เปลี่ยนแล้ว' })
  })

  it('throws TemplateEditError for an unknown node code', () => {
    expect(() => editLabelByLawOverride(fixture(), 'NOPE', 'MHT_2548', { labelTh: 'x' })).toThrow(TemplateEditError)
  })

  it('never touches node.lawRefs — the opposite invariant from editEraOverride (mirrors era-container-label.spec.ts)', () => {
    const untaggedBefore = editLabelByLawOverride(fixture(), 'A2.2-1', 'MHT_2564', { labelTh: 'x' })
    const node = untaggedBefore.definition.groups[0]!.items[0]!
    expect(node.lawRefs).toBeUndefined()

    const removed = editLabelByLawOverride(untaggedBefore.definition, 'A2.2-1', 'MHT_2548', null)
    expect(removed.definition.groups[0]!.items[0]!.lawRefs).toBeUndefined()
  })

  it('re-validates the merged tree — a structurally invalid patch throws ChecklistTemplateValidationError', () => {
    expect(() =>
      // @ts-expect-error — deliberately violating the shape to exercise the revalidation path.
      editLabelByLawOverride(fixture(), 'A2.2-1', 'MHT_2564', { labelTh: 123 }),
    ).toThrow(ChecklistTemplateValidationError)
  })
})
