// Session S4b-fix, Fix 5 — ship "ถังขยะแบบยกเคลื่อนที่ได้" (facility catalog code 27, presence-only)
// into the passenger-hall container of every v3 mode, positioned before that container's TTRS
// item — dogfooding Fix 3's addPositionedChildNode against the REAL committed v3 template JSONs.
// Deliberately does NOT write to any database (see feedback-db-write-caution): this proves the
// placement is correct and reports the resulting code + position per mode, exactly what a real
// admin session through the AddAndPlaceDialog UI would produce, without touching local/Railway
// Postgres. The TTRS anchor is located by walking the tree and matching facilityCode 33 (assigned
// by the same tagContainers() pass seed-templates.ts runs) OR its label text — never by a
// hardcoded container name, since the container's own labelTh genuinely differs per mode (see the
// per-mode results below).
import * as fs from 'fs'
import * as path from 'path'
import { applyEraOverrides, parseTemplateDefinition, tagContainers, type TemplateNode, type TransportMode } from '@repo/types'
import { addPositionedChildNode } from '../templates.core'

const JSON_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'tools', 'checklist_json')

interface VariantFile {
  mode: TransportMode
  variantKey: string
  file: string
  overridesFile: string
}

const V3_VARIANTS: VariantFile[] = [
  { mode: 'ทางบก', variantKey: 'standard', file: 'template_land_v3.json', overridesFile: 'era_overrides_land_v3.json' },
  { mode: 'ทางราง', variantKey: 'rail_train', file: 'template_rail_rail_train_v3.json', overridesFile: 'era_overrides_rail_rail_train_v3.json' },
  { mode: 'ทางราง', variantKey: 'rail_metro', file: 'template_rail_rail_metro_v3.json', overridesFile: 'era_overrides_rail_rail_metro_v3.json' },
  { mode: 'ทางน้ำ', variantKey: 'standard', file: 'template_water_v3.json', overridesFile: 'era_overrides_water_v3.json' },
  { mode: 'ทางอากาศ', variantKey: 'standard', file: 'template_air_v3.json', overridesFile: 'era_overrides_air_v3.json' },
]

const allFilesPresent = V3_VARIANTS.every((v) => fs.existsSync(path.join(JSON_DIR, v.file)))
const describeIfPresent = allFilesPresent ? describe : describe.skip

function loadTemplate(v: VariantFile) {
  const raw = JSON.parse(fs.readFileSync(path.join(JSON_DIR, v.file), 'utf-8'))
  let def = parseTemplateDefinition(raw)
  const overridesPath = path.join(JSON_DIR, v.overridesFile)
  if (fs.existsSync(overridesPath)) {
    const overridesRaw = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'))
    def = applyEraOverrides(def, overridesRaw)
  }
  tagContainers(def, v.mode, v.variantKey)
  return def
}

// Finds the node whose OWN label names TTRS and returns the (containerCode, anchorCode) pair
// addPositionedChildNode needs — either a GROUP code (if TTRS is itself a top-level item, which is
// what every real v3 template actually does: "เครื่องบริการถ่ายทอดการสื่อสารสาธารณะ (TTRS)" sits
// directly under its group as a peer of other top-level items, e.g. land's B1.18 under group B1,
// whose OWN labelTh happens to be "พื้นที่โถง ผู้โดยสาร และ ที่จำหน่ายตั๋ว" — confirmed by reading
// template_land_v3.json directly, not assumed) or a NODE code (if it were ever nested inside
// another item — checked as a fallback for robustness, not because any current file needs it).
// Matching on facilityCode 33 was tried first and was WRONG: tagContainers() stamps that code onto
// every LEAF under a matched TTRS container, including its own sub-criteria — matching on those
// would insert ถังขยะ INSIDE TTRS as a sibling of its sub-criteria, not beside TTRS as asked.
function findTtrsAnchor(def: ReturnType<typeof loadTemplate>): { containerCode: string; anchorCode: string } | null {
  for (const g of def.groups) {
    const topLevelMatch = g.items.find((it) => it.labelTh.includes('TTRS'))
    if (topLevelMatch) return { containerCode: g.code, anchorCode: topLevelMatch.code }
    for (const item of g.items) {
      const found = searchNested(item)
      if (found) return found
    }
  }
  return null

  function searchNested(node: TemplateNode): { containerCode: string; anchorCode: string } | null {
    for (const child of node.subItems ?? []) {
      if (child.labelTh.includes('TTRS')) return { containerCode: node.code, anchorCode: child.code }
      const deeper = searchNested(child)
      if (deeper) return deeper
    }
    return null
  }
}

describeIfPresent('addPositionedChildNode — Fix 5 dogfood: ถังขยะแบบยกเคลื่อนที่ได้ before TTRS, all v3 modes', () => {
  const perModeResults: { mode: string; variantKey: string; container: string | null; newCode: string | null; skipped: string | null }[] = []

  for (const variant of V3_VARIANTS) {
    const label = `${variant.mode} / ${variant.variantKey}`

    it(`${label} — places or reports a real skip, never guesses`, () => {
      const def = loadTemplate(variant)
      const anchor = findTtrsAnchor(def)

      if (!anchor) {
        // สนข.'s water checklist genuinely has no TTRS item (verified: no "TTRS" text anywhere in
        // template_water_v3.json) — a real data gap, not a bug in this search. Every OTHER mode
        // must resolve; only water may hit this branch.
        expect(variant.variantKey === 'standard' && variant.mode === 'ทางน้ำ').toBe(true)
        perModeResults.push({ mode: variant.mode, variantKey: variant.variantKey, container: null, newCode: null, skipped: 'ไม่พบรายการ TTRS ในแบบประเมินนี้ (ไม่มีจุดอ้างอิง)' })
        return
      }

      const containingGroup = def.groups.find((g) => g.code === anchor.containerCode)
      const beforeSiblings = containingGroup ? containingGroup.items : findNodeByCode(def.groups, anchor.containerCode)!.subItems!
      const before = beforeSiblings.map((n) => n.code)
      const containerLabel = containingGroup ? containingGroup.labelTh : findNodeByCode(def.groups, anchor.containerCode)!.labelTh

      const result = addPositionedChildNode(def, anchor.containerCode, anchor.anchorCode, 'before', {
        labelTh: 'ถังขยะแบบยกเคลื่อนที่ได้',
        type: 'presence',
        facilityCode: 27,
        lawRefs: ['PSD_2555'],
      })

      // Append-only: the new code is never the TTRS code, and never collides with an existing sibling.
      expect(result.code).not.toBe(anchor.anchorCode)
      expect(before).not.toContain(result.code)

      // Position: new node sits immediately before TTRS among the container's (group's or node's) children.
      const afterGroup = result.definition.groups.find((g) => g.code === anchor.containerCode)
      const siblings = afterGroup ? afterGroup.items : findNodeByCode(result.definition.groups, anchor.containerCode)!.subItems!
      const codes = siblings.map((n) => n.code)
      const ttrsIndex = codes.indexOf(anchor.anchorCode)
      expect(codes[ttrsIndex - 1]).toBe(result.code)

      const inserted = siblings.find((n) => n.code === result.code)!
      expect(inserted.facilityCode).toBe(27)
      expect(inserted.lawRefs).toEqual(['PSD_2555'])

      perModeResults.push({ mode: variant.mode, variantKey: variant.variantKey, container: containerLabel, newCode: result.code, skipped: null })
    })
  }

  it('reports the full per-mode placement (see console output — this is the session report source)', () => {
    // eslint-disable-next-line no-console
    console.log('\nFix 5 — ถังขยะแบบยกเคลื่อนที่ได้ placement (before TTRS), per v3 mode:')
    for (const r of perModeResults) {
      // eslint-disable-next-line no-console
      console.log(r.skipped ? `  ${r.mode}/${r.variantKey}: SKIPPED — ${r.skipped}` : `  ${r.mode}/${r.variantKey}: container "${r.container}" -> new code ${r.newCode}`)
    }
    expect(perModeResults.length).toBe(V3_VARIANTS.length)
  })
})

function findNodeByCode(groups: ReturnType<typeof loadTemplate>['groups'], code: string): TemplateNode | undefined {
  for (const g of groups) {
    for (const item of g.items) {
      const found = search(item)
      if (found) return found
    }
  }
  return undefined
  function search(node: TemplateNode): TemplateNode | undefined {
    if (node.code === code) return node
    for (const child of node.subItems ?? []) {
      const found = search(child)
      if (found) return found
    }
    return undefined
  }
}
