/**
 * Session S3b, Part D — lawRefs (ข้อยกเว้นทางกฎหมาย) editing + the coverage indicator.
 */
import type { ChecklistTemplateDefinition } from '@repo/types'
import { editLawRefs, summarizeTemplate } from '../templates.core'

function fixture(): ChecklistTemplateDefinition {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    groups: [
      {
        code: 'A1',
        labelTh: 'ที่จอดรถ',
        items: [
          {
            code: 'A1.1',
            labelTh: 'ที่จอดรถสำหรับคนพิการ',
            lawRefs: ['MHT_2548'],
            subItems: [
              { code: 'A1.1-1', labelTh: 'ทางลาด', answerType: 'presence', lawRefs: ['MHT_2548'] },
              { code: 'A1.1-2', labelTh: 'ป้าย', answerType: 'presence' }, // untagged
            ],
          },
        ],
      },
    ],
  }
}

describe('editLawRefs — Part D.1', () => {
  it('sets lawRefs and beyondLaw on a top-level item (where most redaction lives)', () => {
    const def = fixture()
    const result = editLawRefs(def, 'A1.1', ['MHT_2548', 'MHT_2564'], true)
    expect(result.after).toEqual({ lawRefs: ['MHT_2548', 'MHT_2564'], beyondLaw: true })
    const node = result.definition.groups[0]!.items[0]!
    expect(node.lawRefs).toEqual(['MHT_2548', 'MHT_2564'])
    expect(node.beyondLaw).toBe(true)
  })

  it('editable on a leaf too, not just top-level items', () => {
    const def = fixture()
    const result = editLawRefs(def, 'A1.1-2', ['PSD_2555'], false)
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-2')!
    expect(node.lawRefs).toEqual(['PSD_2555'])
  })

  it('clearing lawRefs entirely removes the field rather than storing an empty array', () => {
    const def = fixture()
    const result = editLawRefs(def, 'A1.1', [], false)
    const node = result.definition.groups[0]!.items[0]!
    expect(node.lawRefs).toBeUndefined()
    expect(node.beyondLaw).toBeUndefined()
    expect(result.after).toEqual({ lawRefs: [], beyondLaw: false })
  })

  it('reports before/after for the audit log', () => {
    const def = fixture()
    const result = editLawRefs(def, 'A1.1', ['MHT_2564'], false)
    expect(result.before).toEqual({ lawRefs: ['MHT_2548'], beyondLaw: false })
    expect(result.after).toEqual({ lawRefs: ['MHT_2564'], beyondLaw: false })
  })
})

describe('summarizeTemplate — Part D.3 coverage indicator', () => {
  it('counts tagged vs untagged leaves by lawRefs presence', () => {
    const summary = summarizeTemplate(fixture())
    expect(summary.leafCount).toBe(2)
    expect(summary.lawRefsTaggedCount).toBe(1)
    expect(summary.lawRefsUntaggedCount).toBe(1)
  })

  it('reflects an editLawRefs change live', () => {
    const def = fixture()
    const tagged = editLawRefs(def, 'A1.1-2', ['MHT_2548'], false).definition
    const summary = summarizeTemplate(tagged)
    expect(summary.lawRefsTaggedCount).toBe(2)
    expect(summary.lawRefsUntaggedCount).toBe(0)
  })
})
