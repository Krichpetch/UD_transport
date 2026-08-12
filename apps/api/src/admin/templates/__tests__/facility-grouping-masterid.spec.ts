// Session S5-fix, Part C — the fuzzy matcher is discovery-only: a leaf carrying `masterId` no
// longer drops out of the canonical item (S4b/S5's Part E behavior) — it composes into the SAME
// card as any remaining fuzzy-matched siblings, grouped by the stable masterId instead of by text.
// `standalone` still excludes a leaf entirely (see facility-grouping-standalone.spec.ts) — the two
// mechanisms diverge now, which is exactly the point (masterId is meant to survive text drift).
import type { TemplateNode } from '@repo/types'
import { buildFacilityGroups, type FacilityLoadedTemplate } from '../facility-grouping.core'

function leaf(code: string, labelTh: string, extra: Partial<TemplateNode> = {}): TemplateNode {
  return { code, labelTh, answerType: 'presence', ...extra }
}

function threeIdenticalTemplates(thirdLeafExtra: Partial<TemplateNode> = {}): FacilityLoadedTemplate[] {
  const modes = ['ทางบก', 'ทางน้ำ', 'ทางอากาศ'] as const
  return modes.map((mode, i) => ({
    templateId: `t${i}`,
    mode,
    variantKey: 'standard',
    version: 3,
    status: 'DRAFT' as const,
    definition: {
      schemaVersion: 2,
      mode,
      groups: [
        {
          code: 'A1',
          labelTh: 'กลุ่มทดสอบ',
          items: [
            {
              code: 'A1.1',
              labelTh: 'ที่จอดรถสำหรับคนพิการ',
              subItems: [leaf('A1.1-1', 'ป้ายสัญลักษณ์คนพิการ', i === 2 ? thirdLeafExtra : {})],
            },
          ],
        },
      ],
    },
  }))
}

describe('buildFacilityGroups — Part C composed grouping (masterId ∪ fuzzy text)', () => {
  it('an attached (masterId-bearing) leaf STAYS in the canonical item, composed with its fuzzy-matched siblings', () => {
    const result = buildFacilityGroups(threeIdenticalTemplates({ masterId: 'master-1' }))
    const item = result.canonicalItems.find((it) => it.labelTh === 'ป้ายสัญลักษณ์คนพิการ')
    expect(item).toBeDefined()
    expect(item!.instances).toHaveLength(3)
    expect(item!.instances.some((inst) => inst.templateId === 't2')).toBe(true)
    expect(item!.masterId).toBe('master-1')
  })

  it('all three leaves already attached to the SAME masterId compose into one item, no masterId given for an unattached run', () => {
    const modes = ['ทางบก', 'ทางน้ำ', 'ทางอากาศ'] as const
    const templates: FacilityLoadedTemplate[] = modes.map((mode, i) => ({
      templateId: `t${i}`,
      mode,
      variantKey: 'standard',
      version: 3,
      status: 'DRAFT' as const,
      definition: {
        schemaVersion: 2,
        mode,
        groups: [
          {
            code: 'A1',
            labelTh: 'กลุ่มทดสอบ',
            items: [
              {
                code: 'A1.1',
                labelTh: 'ที่จอดรถสำหรับคนพิการ',
                subItems: [leaf('A1.1-1', 'ป้ายสัญลักษณ์คนพิการ', { masterId: 'master-1' })],
              },
            ],
          },
        ],
      },
    }))
    const result = buildFacilityGroups(templates)
    const item = result.canonicalItems.find((it) => it.labelTh === 'ป้ายสัญลักษณ์คนพิการ')
    expect(item).toBeDefined()
    expect(item!.instances).toHaveLength(3)
    expect(item!.masterId).toBe('master-1')

    const untouched = buildFacilityGroups(threeIdenticalTemplates())
    expect(untouched.canonicalItems.find((it) => it.labelTh === 'ป้ายสัญลักษณ์คนพิการ')!.masterId).toBeUndefined()
  })

  it('the container group itself still carries all 3 instances — only leaf-level pooling ever excluded anything', () => {
    const result = buildFacilityGroups(threeIdenticalTemplates({ masterId: 'master-1' }))
    const group = result.containerGroups.find((g) => g.labelTh === 'ที่จอดรถสำหรับคนพิการ')
    expect(group).toBeDefined()
    expect(group!.instances).toHaveLength(3)
  })

  it('a detachedFromMasterId-only leaf (no live masterId) is NOT excluded and carries no masterId on its item — it re-pools like any ordinary node', () => {
    const result = buildFacilityGroups(threeIdenticalTemplates({ detachedFromMasterId: 'master-1' }))
    const item = result.canonicalItems.find((it) => it.labelTh === 'ป้ายสัญลักษณ์คนพิการ')
    expect(item).toBeDefined()
    expect(item!.instances).toHaveLength(3)
    expect(item!.masterId).toBeUndefined()
  })

  it('standalone still excludes a leaf entirely; masterId no longer does — the two diverge by design', () => {
    const standaloneResult = buildFacilityGroups(threeIdenticalTemplates({ standalone: true }))
    const masterResult = buildFacilityGroups(threeIdenticalTemplates({ masterId: 'master-1' }))
    expect(standaloneResult.canonicalItems.find((it) => it.labelTh === 'ป้ายสัญลักษณ์คนพิการ')!.instances).toHaveLength(2)
    expect(masterResult.canonicalItems.find((it) => it.labelTh === 'ป้ายสัญลักษณ์คนพิการ')!.instances).toHaveLength(3)
  })

  it('an ambiguous occurrence-duplicated match (two master clusters sharing identical text) is never guessed — the leftover unlinked cluster stays standalone', () => {
    // One container instance carries the SAME item text twice (occurrence-duplicated, like the
    // ramp width's two-sides case) — leaf A gets promoted to master-A, leaf B to a DIFFERENT
    // master-B on ANOTHER instance's occurrence-0 slot, and a third instance's occurrence-1 leaf is
    // still unlinked. There are now two same-text master clusters; the unlinked leftover must not
    // be silently folded into either.
    const def = (subItems: TemplateNode[]) => ({
      schemaVersion: 2 as const,
      mode: 'ทางบก' as const,
      groups: [{ code: 'A1', labelTh: 'g', items: [{ code: 'A1.1', labelTh: 'container', subItems }] }],
    })
    const templates: FacilityLoadedTemplate[] = [
      {
        templateId: 't0',
        mode: 'ทางบก',
        variantKey: 'standard',
        version: 3,
        status: 'DRAFT',
        definition: def([
          leaf('A1.1-1', 'ข้อความซ้ำ', { masterId: 'master-A' }),
          leaf('A1.1-2', 'ข้อความซ้ำ', { masterId: 'master-B' }),
        ]),
      },
      {
        templateId: 't1',
        mode: 'ทางน้ำ',
        variantKey: 'standard',
        version: 3,
        status: 'DRAFT',
        definition: def([leaf('A1.1-1', 'ข้อความซ้ำ')]),
      },
    ]
    const result = buildFacilityGroups(templates)
    const items = result.canonicalItems.filter((it) => it.labelTh === 'ข้อความซ้ำ')
    expect(items).toHaveLength(3) // master-A (1), master-B (1), and the leftover unlinked one (1) — never merged
    const masterIds = items.map((it) => it.masterId).sort()
    expect(masterIds).toEqual([undefined, 'master-A', 'master-B'].sort())
    const leftover = items.find((it) => it.masterId === undefined)!
    expect(leftover.instances).toHaveLength(1)
  })
})
