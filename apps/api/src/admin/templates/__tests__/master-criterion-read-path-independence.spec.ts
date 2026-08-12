/**
 * Session S5, Part B.2 — proves the auditor read path (scoring, era-resolution, the E-form) has
 * ZERO new dependency on the MasterCriterion table. An attached node's masterId/write-through
 * fields are plain data on the same ChecklistTemplateDefinition JSON these modules already read
 * (Part B's write-through invariant) — nothing about scoring or era-resolution needed to change,
 * and this test is the regression guard that keeps it that way.
 *
 * Two levels of proof, both cheap and durable:
 *  1. Source-level — these files never reference "masterCriterion" or `@prisma/client` at all. If
 *     a future change ever adds a live join to the MasterCriterion table from the read path, this
 *     is the test that breaks.
 *  2. Behavior-level — scoring/era-resolution run correctly against an attached node's definition,
 *     using ONLY the definition object (no second argument, no DB handle of any kind exists to
 *     pass one even if a caller wanted to).
 */
import * as fs from 'fs'
import * as path from 'path'
import type { ChecklistTemplateDefinition } from '@repo/types'
import { computeScoreFromItems } from '@repo/types'
import { filterHiddenItems, markApplicability } from '@repo/types'

const TYPES_SRC = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'packages', 'types', 'src')

function readSource(file: string): string {
  return fs.readFileSync(path.join(TYPES_SRC, file), 'utf-8')
}

describe('read-path independence — source-level (Part B.2)', () => {
  it.each(['scoring.ts', 'era-resolution.ts'])('%s never mentions MasterCriterion or Prisma', (file) => {
    const source = readSource(file)
    expect(source.toLowerCase()).not.toContain('mastercriterion')
    expect(source).not.toContain('@prisma/client')
  })
})

describe('read-path independence — behavioral (Part B.2)', () => {
  function attachedDef(): ChecklistTemplateDefinition {
    return {
      schemaVersion: 2,
      mode: 'ทางบก',
      groups: [
        {
          code: 'A1',
          labelTh: 'กลุ่มทดสอบ',
          items: [
            {
              code: 'A1.1',
              labelTh: 'ทางลาด',
              subItems: [
                {
                  code: 'A1.1-1',
                  labelTh: 'ความกว้างไม่น้อยกว่า 900 มิลลิเมตร',
                  answerType: 'presence_standard',
                  masterId: 'master-1', // an attached node — no MasterCriterion row exists anywhere near this test
                  measurements: [{ key: 'm1', operator: 'gte', value: 900, unit: 'mm', autoGrade: true, confirmed: true }],
                },
              ],
            },
          ],
        },
      ],
    }
  }

  it('era-resolution reads an attached node using only the definition object', () => {
    const def = attachedDef()
    const withApplicability = markApplicability(def, 2560)
    const filtered = filterHiddenItems(withApplicability)
    const leaf = filtered.groups[0]!.items[0]!.subItems![0]!
    expect(leaf.masterId).toBe('master-1')
    expect(leaf.applicable).not.toBe(false)
  })

  it('scoring reads a submitted-items snapshot of an attached node using only the items array', () => {
    const items = [
      {
        items: [
          {
            id: 'A1.1',
            labelTh: 'ทางลาด',
            subItems: [
              {
                id: 'A1.1-1',
                labelTh: 'ความกว้างไม่น้อยกว่า 900 มิลลิเมตร',
                answerType: 'presence_standard',
                masterId: 'master-1',
                present: true,
                meetsStandard: true,
              },
            ],
          },
        ],
      },
    ]
    const result = computeScoreFromItems(items)
    expect(result).toBe(100)
  })
})
