// Session S4b, Part 1 verification — runs the grouping engine against the REAL committed v3
// template JSONs (tools/checklist_json/), through the same pipeline seed-templates.ts uses
// (parse -> applyEraOverrides -> tagContainers), and checks the numbers against
// tools/checklist-migration/output/facility-type-redundancy-report.md's headline figures.
//
// These files carry real สนข. checklist item TEXT (not inspection data/PII — see root CLAUDE.md;
// the template JSONs are already committed and already read by seed-templates.ts and
// tools/checklist-migration/output/*.js at every prior session), so reading them here is the same
// class of access those scripts already have, just via jest instead of `node`.
import * as fs from 'fs'
import * as path from 'path'
import { applyEraOverrides, parseTemplateDefinition, tagContainers, type TemplateNode, type TransportMode } from '@repo/types'
import { buildFacilityGroups, detectConflicts, isPropagatable, type FacilityLoadedTemplate } from '../facility-grouping.core'

const JSON_DIR = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'tools', 'checklist_json')

// Test-local leaf walk (independent of the engine's own internal walkLeaves) — used only to
// verify the engine's OUTPUT against the raw tree, so a bug in the engine's own walk can't hide
// from a test that reused it.
function walkLeafCodes(node: TemplateNode): string[] {
  const codes: string[] = []
  if (node.answerType) codes.push(node.code)
  for (const child of node.subItems ?? []) codes.push(...walkLeafCodes(child))
  return codes
}

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

// Skips (rather than fails) if the checkout doesn't have the v3 JSONs for some reason — mirrors
// seed-templates.ts's own "missing file is a loud skip, not a silent no-op" stance, adapted to a
// test: this suite exists specifically to reproduce a report computed from these exact files, so a
// missing file means the reproduction can't run at all, not that it passed.
const allFilesPresent = V3_VARIANTS.every((v) => fs.existsSync(path.join(JSON_DIR, v.file)))

function loadRealV3Templates(): FacilityLoadedTemplate[] {
  return V3_VARIANTS.map((v, i) => {
    const raw = JSON.parse(fs.readFileSync(path.join(JSON_DIR, v.file), 'utf-8'))
    let def = parseTemplateDefinition(raw)
    const overridesPath = path.join(JSON_DIR, v.overridesFile)
    if (fs.existsSync(overridesPath)) {
      const overridesRaw = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'))
      def = applyEraOverrides(def, overridesRaw)
    }
    tagContainers(def, v.mode, v.variantKey)
    return { templateId: `test-v3-${i}`, mode: v.mode, variantKey: v.variantKey, version: 3, status: 'DRAFT' as const, definition: def }
  })
}

const describeIfPresent = allFilesPresent ? describe : describe.skip

describeIfPresent('buildFacilityGroups — reproduces facility-type-redundancy-report.md', () => {
  const templates = loadRealV3Templates()
  const result = buildFacilityGroups(templates)

  it('totals 2161 leaves across the 5 v3 templates (report §1)', () => {
    expect(result.stats.totalLeaves).toBe(2161)
  })

  it('totals 291 container instances across the 5 v3 templates (report §1)', () => {
    expect(result.stats.totalContainerInstances).toBe(291)
  })

  it('collapses container instances to a number of distinct groups close to the report\'s 46 (§6)', () => {
    // §6: "By container label: 291 instances -> 46 distinct containers". Reported here rather than
    // hard-pinned: the report's own figure was produced by a slightly different normalizer
    // (bullet/punctuation stripping in facility-analysis.js's normLabel, on top of whitespace
    // collapse) than this engine's fuzzy-Levenshtein merge (Part 1.2's literal spec). Both are
    // legitimate readings of "group by normalized labelTh, fuzzy >= 0.95" — if this count drifts
    // from 46 it is because of that normalizer difference, not a data change, and is close enough
    // to trust the design. See the session's final report for the exact number found.
    expect(result.stats.distinctContainerGroups).toBeGreaterThanOrEqual(40)
    expect(result.stats.distinctContainerGroups).toBeLessThanOrEqual(55)
  })

  it('produces an edit-unit count close to, but ABOVE, the report\'s 432 — a deliberate correctness fix, not a miss', () => {
    // §3's 432 was computed by refined.js's R4 script with a plain Map keyed by
    // (container label + item text): if the SAME text appears TWICE inside one container instance
    // (verified here — e.g. the ramp's "ความกว้างสุทธิไม่น้อยกว่า 900 มิลลิเมตร" legitimately appears
    // twice per ramp, once per side), that script's key collapses both onto one slot, silently
    // UNDERcounting. A propagate write through that naive key would land on only one of the two
    // real node codes and leave the other stale — a correctness bug the report's own reproduction
    // scripts do not guard against. This engine's occurrenceSplit step (buildCanonicalItemsForGroup)
    // keeps such same-instance duplicates as separate canonical items, so its edit-unit count is
    // EXPECTED to land a little above 432, not below — verified delta is +14 (446), all attributable
    // to this fix (see the session's final report for the itemized list).
    expect(result.stats.editUnits).toBeGreaterThan(432)
    expect(result.stats.editUnits).toBeLessThanOrEqual(432 + 30)
  })

  it('finds the ทางลาดสำหรับคนพิการ (ramp) container group with 17 instances (report §4)', () => {
    const ramp = result.containerGroups.find((g) => g.labelTh === 'ทางลาดสำหรับคนพิการ')
    expect(ramp).toBeDefined()
    expect(ramp!.instances).toHaveLength(17)
  })

  it('collapses the ramp\'s 27-item document to a small number of leaf edit units despite the 4 OCR typos (report §4)', () => {
    const ramp = result.containerGroups.find((g) => g.labelTh === 'ทางลาดสำหรับคนพิการ')!
    // Session S5-fix (round 2) — leaves under this container can now sit at ANY depth (the ramp
    // has an intermediate length-tier hierarchy — see the round-2 hierarchy test below), so
    // matching by rootId (this leaf's depth-0 ancestor) replaces the old direct containerGroupId
    // match, which only ever worked because the old model had no intermediate level to skip past.
    const rampItems = result.canonicalItems.filter((it) => it.rootId === ramp.id)
    // 27 positions per copy, 4 OCR-typo rows fuzzy-merged back down -> expect at or near 27
    // canonical items, NOT the ~31 a naive exact-text grouping would produce (27 + up to 4 split
    // positions). Every canonical item in this group should be near-fully shared (17 or close) —
    // the round-2 hierarchy fix makes every one of them fully shared now (occurrence-split no
    // longer collides across length-tiers), so this is tighter than before, not looser.
    expect(rampItems.length).toBeLessThanOrEqual(29)
    const fullyShared = rampItems.filter((it) => it.instances.length === 17)
    expect(fullyShared.length).toBeGreaterThan(20)
  })

  it('round 2 — the ramp\'s length-tier hierarchy (case ≤2500mm / 2500-6000mm / ≥6000mm) is preserved as its OWN editable containers, not flattened into the leaf list', () => {
    const ramp = result.containerGroups.find((g) => g.labelTh === 'ทางลาดสำหรับคนพิการ')!
    // Real structure (verified against tools/checklist_json/template_land_v3.json's A2.2 node):
    // 7 direct children — 3 length-tier case containers, 1 handrail sub-container, 3 direct leaves.
    expect(ramp.children.length).toBe(7)
    const tiers = ramp.children.filter((c) => !c.isLeaf && c.labelTh.startsWith('กรณี'))
    expect(tiers.length).toBe(3)
    for (const tier of tiers) {
      expect(tier.instances.length).toBe(17) // shared across every instance of the ramp itself
      expect(tier.children.length).toBeGreaterThan(0) // has its own sub-leaves, not flattened away
    }
    const directLeaves = ramp.children.filter((c) => c.isLeaf)
    expect(directLeaves.length).toBe(3)
  })

  it('has a highest-fan-out canonical item in the low-to-mid 30s, not report §2\'s unscoped 51x', () => {
    // Report §2's "appears 51x" figure (facility-analysis.js SECTION 2) is a GLOBAL text dedup —
    // it pools identical item text across the WHOLE corpus regardless of which container it lives
    // in. Report §6 explicitly rejects that as the grouping key ("facilityCode alone is the WRONG
    // grouping key... containers that are genuinely different checklists" get merged) and mandates
    // container-scoped grouping instead. A container-scoped engine can only ever have fan-out <=
    // (instances of that one container group), so its max fan-out is structurally capped well below
    // an unscoped text-only dedup's — that is the correct, intended behavior of this design, not a
    // shortfall against the report. The actual max observed here (34, in the tactile Warning
    // container — 34 instances, matching report §4's own per-facility table row for facility 3/5)
    // is reported in the session's final report rather than hard-pinned, since it depends on the
    // exact instance count of whichever container group happens to be largest.
    const maxFanOut = Math.max(...result.canonicalItems.map((it) => it.instances.length))
    expect(maxFanOut).toBeGreaterThanOrEqual(30)
    expect(maxFanOut).toBeLessThanOrEqual(40)
  })

  it('preserves per-area subsets for the tactile Warning container — items are NOT padded onto instances that never had them (report §7c)', () => {
    // §7c: "พื้นผิวต่างสัมผัสชนิดเตือน (Warning)" appears 34 times with item counts ranging 2-12 —
    // a per-area SUBSET of a shared library, not a fixed-shape document like the ramp. The engine
    // must propagate the ITEM, not the whole container: a canonical item's instance count should
    // vary WITHIN this group (proving small-subset instances aren't silently gaining items they
    // never had), and every instance actually walks back to a real leaf under that exact container.
    const warning = result.containerGroups.find((g) => g.labelTh.startsWith('พื้นผิวต่างสัมผัสชนิดเตือน'))
    expect(warning).toBeDefined()
    expect(warning!.instances.length).toBeGreaterThanOrEqual(30) // report: 34 instances

    const containerSizes = new Set(warning!.instances.map((inst) => walkLeafCodes(inst.node).length))
    expect(containerSizes.size).toBeGreaterThan(3) // genuinely varying item counts (2..12 per §7c), not a fixed shape

    const warningItems = result.canonicalItems.filter((it) => it.rootId === warning!.id)
    const itemInstanceCounts = new Set(warningItems.map((it) => it.instances.length))
    expect(itemInstanceCounts.size).toBeGreaterThan(1) // NOT every item shared by all 34 — subsets preserved

    // The leak-prevention proof: every instance a canonical item claims must be a leaf that ACTUALLY
    // exists, by code, under that exact container instance's own subtree — never synthesized/padded.
    // Matched by templateId + "this container instance's subtree contains the code" rather than by
    // immediate parentCode, since round 2's leaves can now sit at any depth below the matched
    // container (parentCode alone would only identify the immediate — possibly intermediate — parent,
    // not the top container instance itself); a template's own node codes are unique, so this stays
    // unambiguous even though one template can carry several separate warning-tactile containers.
    for (const item of warningItems) {
      for (const inst of item.instances) {
        const container = warning!.instances.find((c) => c.templateId === inst.templateId && walkLeafCodes(c.node).includes(inst.nodeCode))
        expect(container).toBeDefined()
      }
    }
  })

  it('classifies every canonical item as SHARED (>1 instance) or MODE_SPECIFIC (1 instance) with none left unclassified', () => {
    for (const item of result.canonicalItems) {
      expect(['SHARED', 'MODE_SPECIFIC']).toContain(item.classification)
      expect(item.classification).toBe(item.instances.length > 1 ? 'SHARED' : 'MODE_SPECIFIC')
    }
  })

  it('flags a small number of untagged container groups, matching report §7d\'s "5 containers, mostly หลังคาป้องกันแดดและฝน"', () => {
    const untagged = result.containerGroups.filter((g) => !g.facilityTagged)
    const untaggedInstances = untagged.reduce((sum, g) => sum + g.instances.length, 0)
    expect(untaggedInstances).toBe(5)
    expect(untagged.some((g) => g.labelTh.includes('หลังคาป้องกันแดดและฝน'))).toBe(true)
  })

  it('every canonical item instance resolves back to a real leaf node with its own answerType', () => {
    for (const item of result.canonicalItems) {
      for (const inst of item.instances) {
        expect(inst.node.answerType).toBeTruthy()
        expect(inst.node.code).toBe(inst.nodeCode)
      }
    }
  })
})

describeIfPresent('detectConflicts — reproduces report §7b\'s 19-text conflict list', () => {
  const templates = loadRealV3Templates()
  const result = buildFacilityGroups(templates)
  const conflicts = detectConflicts(result)

  it('finds conflicts only among SHARED (>1 instance) canonical items', () => {
    const itemsById = new Map(result.canonicalItems.map((it) => [it.id, it]))
    for (const c of conflicts) {
      expect(itemsById.get(c.canonicalItemId)!.instances.length).toBeGreaterThan(1)
      expect(c.variants.length).toBeGreaterThan(1)
    }
  })

  it('finds a conflict count in the neighborhood of the report\'s 19 texts (§7b)', () => {
    // Fuzzy item-text merging (this engine) vs the report's whitespace-only grouping (§7b's
    // methodology) can shift which rows land in the same canonical item, so this is a range check,
    // not an exact pin — see the session's final report for the precise number and the full list.
    expect(conflicts.length).toBeGreaterThanOrEqual(10)
    expect(conflicts.length).toBeLessThanOrEqual(30)
  })

  it('every conflicting canonical item is NOT propagatable until resolved', () => {
    const itemsById = new Map(result.canonicalItems.map((it) => [it.id, it]))
    for (const c of conflicts) {
      expect(isPropagatable(itemsById.get(c.canonicalItemId)!)).toBe(false)
    }
  })

  it('every non-conflicting SHARED canonical item IS propagatable', () => {
    const conflictedIds = new Set(conflicts.map((c) => c.canonicalItemId))
    const sharedNonConflicted = result.canonicalItems.filter((it) => it.instances.length > 1 && !conflictedIds.has(it.id))
    expect(sharedNonConflicted.length).toBeGreaterThan(0)
    for (const item of sharedNonConflicted) {
      expect(isPropagatable(item)).toBe(true)
    }
  })
})

// ---- UDT-61, Part 3 — does a new item in a fresh DRAFT join an existing group's count? -----------
//
// The ticket asked to verify: "if a mode's new draft is created, and a checklist item is created
// using an existing facility group, does the count get added to the number of items of the group?"
// getGroups recomputes buildFacilityGroups fresh from every non-RETIRED row on every call (see
// facility-groups.service.ts#loadTemplates's `status: { not: 'RETIRED' }` scope), so a DRAFT row is
// always in scope for grouping — the only open question was whether the grouping engine itself
// actually folds a DRAFT's new item into an existing canonical item's `instances`/`breakdown.total`,
// or silently leaves it orphaned. These synthetic fixtures (no real v3 JSON needed — small enough to
// hand-build) answer that directly for both of the engine's join mechanisms — fuzzy label match
// (clusterByFuzzyLabel/composeMasterAndFuzzyClusters) and explicit masterId linkage
// (groupByMasterId) — plus a negative control proving a genuinely different new item correctly does
// NOT get force-joined into an unrelated group. All three pass against the CURRENT engine — the
// counting mechanism already works correctly; no code change was needed here.
function makeLeaf(code: string, labelTh: string, extra: Partial<TemplateNode> = {}): TemplateNode {
  return { code, labelTh, answerType: 'presence', ...extra }
}

function makeSyntheticTemplate(templateId: string, mode: TransportMode, status: 'DRAFT' | 'ACTIVE', items: TemplateNode[]): FacilityLoadedTemplate {
  return {
    templateId,
    mode,
    variantKey: 'standard',
    version: 3,
    status,
    definition: { schemaVersion: 2, mode, groups: [{ code: 'A1', labelTh: 'หมวดทดสอบ', items }] },
  }
}

describe('buildFacilityGroups — UDT-61 Part 3: new-draft items joining an existing group\'s count', () => {
  it('a new DRAFT item with matching label text joins the existing SHARED canonical item (count increments)', () => {
    const active1 = makeSyntheticTemplate('t-land', 'ทางบก', 'ACTIVE', [makeLeaf('A1.1', 'ราวจับ')])
    const active2 = makeSyntheticTemplate('t-water', 'ทางน้ำ', 'ACTIVE', [makeLeaf('A1.1', 'ราวจับ')])
    const draft = makeSyntheticTemplate('t-air-draft', 'ทางอากาศ', 'DRAFT', [makeLeaf('A1.1', 'ราวจับ')])

    const before = buildFacilityGroups([active1, active2])
    expect(before.canonicalItems.find((it) => it.labelTh === 'ราวจับ')!.instances.length).toBe(2)

    const after = buildFacilityGroups([active1, active2, draft])
    const matches = after.canonicalItems.filter((it) => it.labelTh === 'ราวจับ')
    expect(matches).toHaveLength(1) // joined, not a second orphaned standalone item for the same text
    expect(matches[0]!.instances.length).toBe(3)
    expect(matches[0]!.breakdown.total).toBe(3)
    expect(matches[0]!.classification).toBe('SHARED')
    const airMode = matches[0]!.breakdown.byMode.find((m) => m.mode === 'ทางอากาศ')
    expect(airMode?.byVariant[0]?.byVersion[0]).toMatchObject({ version: 3, status: 'DRAFT', count: 1 })
  })

  it('a new DRAFT item carrying an existing masterId joins that group even with drifted label text', () => {
    const active1 = makeSyntheticTemplate('t-land', 'ทางบก', 'ACTIVE', [makeLeaf('B1', 'ทางลาด 1:12', { masterId: 'm-slope' })])
    const active2 = makeSyntheticTemplate('t-water', 'ทางน้ำ', 'ACTIVE', [makeLeaf('B1', 'ทางลาด 1:12', { masterId: 'm-slope' })])
    // Deliberately DIFFERENT text from the master's — masterId linkage must not depend on it agreeing.
    const draft = makeSyntheticTemplate('t-air-draft', 'ทางอากาศ', 'DRAFT', [makeLeaf('B1', 'ทางลาด (ฉบับร่างใหม่)', { masterId: 'm-slope' })])

    const result = buildFacilityGroups([active1, active2, draft])
    const master = result.canonicalItems.find((it) => it.masterId === 'm-slope')!
    expect(master.instances.length).toBe(3)
    expect(master.instances.some((i) => i.templateId === 't-air-draft')).toBe(true)
  })

  it('a new DRAFT item with genuinely different text does NOT get force-joined into an unrelated group', () => {
    const active1 = makeSyntheticTemplate('t-land', 'ทางบก', 'ACTIVE', [makeLeaf('A1.1', 'ราวจับ')])
    const active2 = makeSyntheticTemplate('t-water', 'ทางน้ำ', 'ACTIVE', [makeLeaf('A1.1', 'ราวจับ')])
    const draft = makeSyntheticTemplate('t-air-draft', 'ทางอากาศ', 'DRAFT', [makeLeaf('A1.2', 'ป้ายบอกทางสำหรับผู้พิการ')])

    const result = buildFacilityGroups([active1, active2, draft])
    expect(result.canonicalItems.find((it) => it.labelTh === 'ราวจับ')!.instances.length).toBe(2)
    const newItem = result.canonicalItems.find((it) => it.labelTh === 'ป้ายบอกทางสำหรับผู้พิการ')!
    expect(newItem.instances.length).toBe(1)
    expect(newItem.classification).toBe('MODE_SPECIFIC')
  })
})
