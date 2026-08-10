/**
 * Session S4b-fix, Fix 4 — editStandalone: admin detaches/re-attaches a leaf from the facility-
 * grouped editor's canonical pooling. Mirrors hidden-editing.spec.ts's structure exactly (same
 * "any status, byte-parity when untouched" shape as editHidden).
 */
import type { ChecklistTemplateDefinition } from '@repo/types'
import { editStandalone } from '../templates.core'

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

describe('editStandalone — Fix 4', () => {
  it('sets standalone:true on a leaf', () => {
    const result = editStandalone(fixture(), 'A1.1-1', true)
    expect(result.after).toBe(true)
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.standalone).toBe(true)
  })

  it('re-attaching (false) drops the field entirely rather than storing an explicit false', () => {
    const detached = editStandalone(fixture(), 'A1.1-1', true).definition
    const result = editStandalone(detached, 'A1.1-1', false)
    expect(result.after).toBe(false)
    const node = result.definition.groups[0]!.items[0]!.subItems!.find((n) => n.code === 'A1.1-1')!
    expect(node.standalone).toBeUndefined()
  })

  it('reports before/after for the audit log', () => {
    const result = editStandalone(fixture(), 'A1.1-1', true)
    expect(result.before).toBe(false)
    expect(result.after).toBe(true)
  })

  it('an untouched sibling round-trips with no standalone field at all (byte-parity)', () => {
    const result = editStandalone(fixture(), 'A1.1-1', true)
    expect('standalone' in result.definition.groups[0]!.items[0]!).toBe(false)
  })
})
