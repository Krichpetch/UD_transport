/**
 * Session S4a, Part C — filterHiddenItems: admin-authored ABSOLUTE hide, distinct from both
 * markApplicability (era/year-dependent, marks rather than deletes) and a group's `optional`
 * (still shown, just non-blocking at submit). Deletes a `hidden: true` node and its whole
 * subtree wholesale — see era-item-mark-applicability.spec.ts for the sibling MARK-based function
 * this is deliberately NOT modelled after.
 */
import { filterHiddenItems, type ChecklistTemplateDefinition } from '@repo/types'

function def(): ChecklistTemplateDefinition {
  return {
    schemaVersion: 2,
    mode: 'ทางราง',
    groups: [
      {
        code: 'A1', labelTh: 'group A1', items: [
          {
            code: 'A1.1', labelTh: 'container, not hidden', subItems: [
              { code: 'A1.1-1', labelTh: 'plain leaf', answerType: 'presence' },
              { code: 'A1.1-2', labelTh: 'hidden leaf', answerType: 'presence', hidden: true },
            ],
          },
          {
            code: 'A1.2', labelTh: 'hidden container', hidden: true, subItems: [
              { code: 'A1.2-1', labelTh: 'child of a hidden container', answerType: 'presence' },
            ],
          },
          {
            code: 'A1.3', labelTh: 'every child hidden, container itself is not', subItems: [
              { code: 'A1.3-1', labelTh: 'hidden', answerType: 'presence', hidden: true },
              { code: 'A1.3-2', labelTh: 'also hidden', answerType: 'presence', hidden: true },
            ],
          },
          {
            code: 'A1.4', labelTh: 'hybrid node, hidden, own answerType AND subItems', hidden: true, answerType: 'presence',
            subItems: [{ code: 'A1.4-1', labelTh: 'child', answerType: 'presence' }],
          },
        ],
      },
      {
        code: 'C1', labelTh: 'entirely hidden group', items: [
          { code: 'C1.1', labelTh: 'hidden', hidden: true, answerType: 'presence' },
        ],
      },
    ],
  }
}

function leaves(result: ChecklistTemplateDefinition): string[] {
  const out: string[] = []
  const visit = (n: { code: string; subItems?: unknown[] }): void => {
    out.push(n.code)
    ;(n.subItems as typeof n[] | undefined)?.forEach(visit)
  }
  for (const g of result.groups) for (const it of g.items) visit(it)
  return out
}

describe('filterHiddenItems', () => {
  it('removes a hidden leaf but keeps its non-hidden siblings and parent container', () => {
    const result = filterHiddenItems(def())
    const a11 = result.groups[0]!.items.find((n) => n.code === 'A1.1')!
    expect(a11.subItems!.map((n) => n.code)).toEqual(['A1.1-1'])
  })

  it('removes a hidden container and its whole subtree wholesale', () => {
    const result = filterHiddenItems(def())
    expect(leaves(result)).not.toContain('A1.2')
    expect(leaves(result)).not.toContain('A1.2-1')
  })

  it('prunes a container as empty once every child is hidden, even though the container itself was never marked', () => {
    const result = filterHiddenItems(def())
    expect(leaves(result)).not.toContain('A1.3')
    expect(leaves(result)).not.toContain('A1.3-1')
  })

  it('removes a hybrid node (own answerType + subItems) wholesale when it is itself hidden', () => {
    const result = filterHiddenItems(def())
    expect(leaves(result)).not.toContain('A1.4')
    expect(leaves(result)).not.toContain('A1.4-1')
  })

  it('drops a group left with zero items after filtering', () => {
    const result = filterHiddenItems(def())
    expect(result.groups.find((g) => g.code === 'C1')).toBeUndefined()
  })

  it('keeps every non-hidden node untouched', () => {
    const result = filterHiddenItems(def())
    expect(leaves(result)).toContain('A1.1')
    expect(leaves(result)).toContain('A1.1-1')
  })

  it('is a no-op on a definition with no hidden flags at all', () => {
    const clean: ChecklistTemplateDefinition = {
      schemaVersion: 1,
      mode: 'ทางบก',
      groups: [{ code: 'A1', labelTh: 'g', items: [{ code: 'A1.1', labelTh: 'leaf', answerType: 'choice' }] }],
    }
    expect(filterHiddenItems(clean)).toEqual(clean)
  })
})
