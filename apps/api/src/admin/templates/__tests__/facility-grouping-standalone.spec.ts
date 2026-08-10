// Session S4b-fix, Fix 4 — a leaf marked `standalone` must never join a canonical item (so it can
// never be a propagate/confirm target) even though its text matches other instances exactly.
// Synthetic fixtures (unlike facility-grouping.spec.ts, which reproduces report numbers against
// the real v3 JSONs) — this only needs to prove the exclusion mechanism itself.
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

describe('buildFacilityGroups — Fix 4 standalone exclusion', () => {
  it('pools an identical leaf across 3 templates into one SHARED canonical item by default', () => {
    const result = buildFacilityGroups(threeIdenticalTemplates())
    const item = result.canonicalItems.find((it) => it.labelTh === 'ป้ายสัญลักษณ์คนพิการ')
    expect(item).toBeDefined()
    expect(item!.classification).toBe('SHARED')
    expect(item!.instances).toHaveLength(3)
  })

  it('a standalone:true leaf drops out of the canonical item — pool shrinks from 3 to 2', () => {
    const result = buildFacilityGroups(threeIdenticalTemplates({ standalone: true }))
    const item = result.canonicalItems.find((it) => it.labelTh === 'ป้ายสัญลักษณ์คนพิการ')
    expect(item).toBeDefined()
    expect(item!.instances).toHaveLength(2)
    expect(item!.instances.some((inst) => inst.templateId === 't2')).toBe(false)
  })

  it('the container group itself still carries all 3 instances — only leaf-level pooling excludes it', () => {
    const result = buildFacilityGroups(threeIdenticalTemplates({ standalone: true }))
    const group = result.containerGroups.find((g) => g.labelTh === 'ที่จอดรถสำหรับคนพิการ')
    expect(group).toBeDefined()
    expect(group!.instances).toHaveLength(3)
  })

  it('detaching down to a single remaining real instance demotes the canonical item to MODE_SPECIFIC, not deleted', () => {
    // 3 templates, but 2 of the 3 leaves marked standalone (only the LAST template's extras are
    // controlled by threeIdenticalTemplates' param, so drop the un-controllable third entirely and
    // build the 2-instance case directly instead).
    const twoOfThree = threeIdenticalTemplates({ standalone: true }) // t2 excluded, t0+t1 remain pooled (2 instances)
    const onlyOneRealLeft = [
      twoOfThree[0]!,
      { ...twoOfThree[1]!, definition: { ...twoOfThree[1]!.definition, groups: [{ ...twoOfThree[1]!.definition.groups[0]!, items: [{ ...twoOfThree[1]!.definition.groups[0]!.items[0]!, subItems: [leaf('A1.1-1', 'ป้ายสัญลักษณ์คนพิการ', { standalone: true })] }] }] } },
    ]
    const result = buildFacilityGroups(onlyOneRealLeft)
    const item = result.canonicalItems.find((it) => it.labelTh === 'ป้ายสัญลักษณ์คนพิการ')
    expect(item).toBeDefined()
    expect(item!.classification).toBe('MODE_SPECIFIC')
    expect(item!.instances).toHaveLength(1)
    expect(item!.instances[0]!.templateId).toBe('t0')
  })
})
