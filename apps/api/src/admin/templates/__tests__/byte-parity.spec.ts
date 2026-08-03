/**
 * Session S3b, Verification #3 — S3a byte-parity re-run: an UNTOUCHED template must load and
 * save identically through the editor extended this session. No such test existed before S3b
 * (confirmed by research at session start); this closes that gap.
 *
 * "Load -> save with no edits" is modeled here as parseTemplateDefinition run twice in a row
 * (once simulating the initial DB read, once simulating a re-validation on save) with zero
 * mutations in between — every admin editor mutator in templates.core.ts follows exactly this
 * clone -> mutate -> parseTemplateDefinition(clone) shape, so a no-op is the degenerate case of
 * that pipeline. Deep-equality (not JSON.stringify byte-equality) is the right bar here: the
 * validator legitimately reconstructs fresh objects field-by-field rather than passing the
 * original JSON through untouched (see templates.core.spec.ts's clone-discipline tests), so key
 * ORDER isn't guaranteed — but every field's VALUE must survive untouched.
 */
import type { ChecklistTemplateDefinition } from '@repo/types'
import { parseTemplateDefinition } from '@repo/types'

function realisticFixture(): ChecklistTemplateDefinition {
  return {
    schemaVersion: 2,
    mode: 'ทางบก',
    source: 'template_land_v2.json',
    provisional: true,
    groups: [
      {
        code: 'A1',
        labelTh: 'ที่จอดรถ',
        items: [
          {
            code: 'A1.1',
            labelTh: 'ที่จอดรถสำหรับคนพิการ',
            facilityCode: 3,
            lawRefs: ['MHT_2548', 'MHT_2564'],
            cabinetResolution: true,
            imageKeys: ['template-images/abc123.jpg'],
            subItems: [
              {
                code: 'A1.1-1',
                num: '1',
                labelTh: 'ความกว้าง',
                answerType: 'presence_standard',
                guidance: { text: 'วัดจากขอบเสาถึงขอบเสา', reference: 'คู่มือหน้า 12' },
                measurements: [
                  {
                    key: 'm1',
                    operator: 'gte',
                    value: 900,
                    value2: null,
                    unit: 'mm',
                    sourceText: 'ความกว้างไม่น้อยกว่า',
                    note: 'วัดที่จุดแคบที่สุด',
                    autoGrade: true,
                    extracted: true,
                    confirmed: true,
                    byLaw: { MHT_2548: { value: 800, value2: null } },
                  },
                ],
              },
              {
                code: 'A1.1-2',
                num: '2',
                labelTh: 'จำนวน',
                answerType: 'presence_standard',
                beyondLaw: true,
                measurements: [
                  {
                    key: 'm1',
                    operator: 'tiered',
                    unit: 'count',
                    autoGrade: true,
                    confirmed: false,
                    inputs: [
                      { key: 'basis', labelTh: 'จำนวนที่จอดรถทั้งหมด' },
                      { key: 'provided', labelTh: 'จำนวนที่จอดรถสำหรับคนพิการ' },
                    ],
                    tiers: [{ min: 1, max: 100, required: 1, incrementPer: 100, incrementBy: 1 }],
                  },
                ],
              },
            ],
          },
          { code: 'A1.2', labelTh: 'ห้องน้ำ', answerType: 'choice', choices: ['มี', 'ไม่มี', 'N/A'] },
        ],
      },
    ],
  }
}

describe('byte-parity — untouched template survives load->save unchanged', () => {
  it('a full round trip through parseTemplateDefinition is a structural no-op', () => {
    const original = realisticFixture()
    const loaded = parseTemplateDefinition(original) // simulates the initial DB read
    const resaved = parseTemplateDefinition(loaded)   // simulates re-validation on an untouched save

    expect(resaved).toEqual(loaded)
    expect(resaved).toEqual(parseTemplateDefinition(original))
  })

  it('every field on a fully-populated leaf survives, not just the ones this session touched', () => {
    const def = realisticFixture()
    const roundTripped = parseTemplateDefinition(parseTemplateDefinition(def))
    const leaf = roundTripped.groups[0]!.items[0]!.subItems![0]!

    expect(leaf.guidance).toEqual({ text: 'วัดจากขอบเสาถึงขอบเสา', reference: 'คู่มือหน้า 12' })
    expect(leaf.measurements![0]).toMatchObject({
      key: 'm1', operator: 'gte', value: 900, sourceText: 'ความกว้างไม่น้อยกว่า',
      note: 'วัดที่จุดแคบที่สุด', extracted: true, confirmed: true,
      byLaw: { MHT_2548: { value: 800, value2: null } },
    })

    const item = roundTripped.groups[0]!.items[0]!
    expect(item.facilityCode).toBe(3)
    expect(item.lawRefs).toEqual(['MHT_2548', 'MHT_2564'])
    expect(item.cabinetResolution).toBe(true)
    expect(item.imageKeys).toEqual(['template-images/abc123.jpg'])

    const tieredLeaf = roundTripped.groups[0]!.items[0]!.subItems![1]!
    expect(tieredLeaf.beyondLaw).toBe(true)
    expect(tieredLeaf.measurements![0]!.tiers).toEqual([{ min: 1, max: 100, required: 1, incrementPer: 100, incrementBy: 1 }])
  })

  it('a template that predates Part C.4 (no childSeq anywhere) round-trips with childSeq still absent', () => {
    const def = realisticFixture()
    const roundTripped = parseTemplateDefinition(parseTemplateDefinition(def))
    const item = roundTripped.groups[0]!.items[0]!
    expect(item.childSeq).toBeUndefined()
    expect('childSeq' in item).toBe(false)
  })
})
