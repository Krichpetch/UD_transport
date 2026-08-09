/**
 * Session S4a, Part C — editHidden: admin toggles the absolute hide flag on any node, any status.
 */
import type { ChecklistTemplateDefinition } from '@repo/types'
import { editHidden } from '../templates.core'

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
            subItems: [{ code: 'A1.1-1', labelTh: 'ทางลาด', answerType: 'presence' }],
          },
        ],
      },
    ],
  }
}

describe('editHidden — Part C', () => {
  it('sets hidden:true on a top-level item', () => {
    const result = editHidden(fixture(), 'A1.1', true)
    expect(result.after).toBe(true)
    expect(result.definition.groups[0]!.items[0]!.hidden).toBe(true)
  })

  it('editable on a leaf too, not just top-level items', () => {
    const result = editHidden(fixture(), 'A1.1-1', true)
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.hidden).toBe(true)
  })

  it('un-hiding drops the field entirely rather than storing an explicit false', () => {
    const hidden = editHidden(fixture(), 'A1.1', true).definition
    const result = editHidden(hidden, 'A1.1', false)
    expect(result.after).toBe(false)
    expect(result.definition.groups[0]!.items[0]!.hidden).toBeUndefined()
  })

  it('reports before/after for the audit log', () => {
    const result = editHidden(fixture(), 'A1.1', true)
    expect(result.before).toBe(false)
    expect(result.after).toBe(true)
  })

  it('an untouched node round-trips with no hidden field at all (byte-parity)', () => {
    const result = editHidden(fixture(), 'A1.1-1', true)
    // A1.1 itself was never touched — its own `hidden` key must never appear.
    expect('hidden' in result.definition.groups[0]!.items[0]!).toBe(false)
  })
})
