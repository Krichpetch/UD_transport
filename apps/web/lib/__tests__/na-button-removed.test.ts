/**
 * Session F3, Part B — the ไม่เกี่ยวข้อง BUTTON is gone; the 'N/A' VALUE is not.
 *
 * สนข. meeting 2026-08-03 (Dr.Aliz), confirmed by the audit team: "เอาปุ่ม ไม่เกี่ยวข้อง ออก" —
 * auditors record ไม่มี instead. This suite pins down both halves of that, because they are easy
 * to conflate and the second one is the dangerous one:
 *
 *   1. No auditor code path can WRITE 'N/A' any more (enforced structurally, by scanning the
 *      actual form sources — a convention nobody can re-break by re-adding a button).
 *   2. Everything that READS 'N/A' still works untouched, because thousands of stored checklists
 *      contain it and must keep rendering and scoring exactly as they always have.
 *
 * The scoring half of (2) is covered server-side in
 * apps/api/src/checklists/__tests__/stored-na-scoring-parity.spec.ts.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TemplateNode } from '@repo/types'
import * as auditForm from '@/lib/audit-form'
import {
  isLeafAnswered,
  computeContainerStatus,
  buildStoredGroups,
  hydrateAnswers,
  defaultAnswer,
  collectLeafCodes,
  collectLeaves,
  absentPatchFor,
} from '@/lib/audit-form'

const WEB_ROOT = join(__dirname, '..', '..')

// Every source file that renders auditor-facing answer controls.
const AUDITOR_FORM_SOURCES = [
  'components/audit/LeafAnswerRow.tsx',
  'components/audit/V2PagerForm.tsx',
  'lib/audit-form.ts',
]

function read(rel: string): string {
  return readFileSync(join(WEB_ROOT, rel), 'utf-8')
}

// Strips // line comments and /* */ blocks, so the many explanatory comments about N/A in these
// files (which are the point of the change, not a violation of it) don't produce false failures.
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/.*$/gm, (line) => {
    const idx = line.indexOf('//')
    return line.slice(0, idx)
  })
}

describe('Part B.1 — no auditor code path can write N/A', () => {
  it.each(AUDITOR_FORM_SOURCES)('%s contains no N/A assignment in executable code', (rel) => {
    const code = stripComments(read(rel))
    // Any executable occurrence of the literal would be a write path: these files have no
    // legitimate reason to mention it except the READ comparisons asserted separately below.
    const writes = [...code.matchAll(/value\s*:\s*'N\/A'/g)]
    expect(writes).toHaveLength(0)
  })

  it('the NA cascade patch constant no longer exists at all', () => {
    // Removing the export is what makes "no write path" structural rather than conventional.
    expect('NA_CASCADE_PATCH' in auditForm).toBe(false)
  })

  it('the leaf choice control offers exactly มี and ไม่มี', () => {
    const code = read('components/audit/LeafAnswerRow.tsx')
    const options = code.slice(code.indexOf('CHOICE_OPTIONS'), code.indexOf('const INACTIVE'))
    expect(options).toContain("value: 'มี'")
    expect(options).toContain("value: 'ไม่มี'")
    expect(options).not.toContain("value: 'N/A'")
  })

  it('no auditor-facing control renders a ไม่เกี่ยวข้อง button', () => {
    for (const rel of ['components/audit/LeafAnswerRow.tsx', 'components/audit/V2PagerForm.tsx']) {
      const code = stripComments(read(rel))
      // The label only ever appeared as a button's text node.
      expect(code).not.toMatch(/>\s*ไม่เกี่ยวข้อง\s*</)
    }
  })
})

describe('Part B.2 — stored N/A still reads correctly (untouched)', () => {
  const node: TemplateNode = { code: 'A1.1-1', labelTh: 'leaf', answerType: 'presence_standard' }

  it('an N/A leaf still counts as ANSWERED', () => {
    expect(isLeafAnswered(node, { ...defaultAnswer(), value: 'N/A' })).toBe(true)
  })

  it('a container whose descendants are all N/A still derives ไม่เกี่ยวข้อง', () => {
    const container: TemplateNode = {
      code: 'A1.1',
      labelTh: 'container',
      subItems: [
        { code: 'A1.1-1', labelTh: 'a', answerType: 'presence' },
        { code: 'A1.1-2', labelTh: 'b', answerType: 'presence' },
      ],
    }
    const answers = {
      'A1.1-1': { ...defaultAnswer(), value: 'N/A' as const },
      'A1.1-2': { ...defaultAnswer(), value: 'N/A' as const },
    }
    expect(computeContainerStatus(container, answers)).toBe('ไม่เกี่ยวข้อง')
  })

  it('a stored N/A survives a buildStoredGroups -> hydrateAnswers round-trip byte-for-byte', () => {
    const def = {
      schemaVersion: 2 as const,
      mode: 'ทางบก' as const,
      groups: [{ code: 'A1', labelTh: 'g', items: [{ code: 'A1.1-1', labelTh: 'leaf', answerType: 'presence' as const }] }],
    }
    const answers = { 'A1.1-1': { ...defaultAnswer(), value: 'N/A' as const } }

    const stored = buildStoredGroups(def, answers)
    const rehydrated = hydrateAnswers(def, stored)

    expect(rehydrated['A1.1-1']!.value).toBe('N/A')
    // Re-storing the rehydrated answers reproduces the identical payload — no silent coercion of
    // legacy N/A into ไม่มี anywhere in the round-trip.
    expect(buildStoredGroups(def, rehydrated)).toEqual(stored)
  })
})

describe('Part B.3 — the 2-way cascade round-trips', () => {
  const container: TemplateNode = {
    code: 'A1.1',
    labelTh: 'container',
    subItems: [
      { code: 'A1.1-1', labelTh: 'a', answerType: 'choice' },
      { code: 'A1.1-2', labelTh: 'b', answerType: 'presence_standard' },
    ],
  }

  it('absentPatchFor still produces a REAL ไม่มี per answerType, never N/A', () => {
    const patches = collectLeaves(container).map((l) => absentPatchFor(l))
    expect(patches[0]).toEqual({ value: 'ไม่มี', meetsStandard: false, flagged: false })
    expect(patches[1]).toEqual({ present: false, value: null, meetsStandard: false, values: {} })
    for (const p of patches) expect(p.value).not.toBe('N/A')
  })

  it('collects both leaves for the cascade', () => {
    expect(collectLeafCodes(container)).toEqual(['A1.1-1', 'A1.1-2'])
  })
})
