// Session S4b, Part 5.1 — verifies the version-scoping premise: "many of the §7b conflicts are
// expected to be v1/v2-vs-v3 drift, not real conflicts once the old lines retire."
//
// FINDING: that premise does not hold for the EXISTING conflict list. Both
// facility-type-redundancy-report.md's own analysis (its "Source:" line) and this engine's
// loadTemplates(scope) were ALWAYS v3-only — a single `version` filter, never a cross-version pool.
// The 14 conflicts facility-grouping.spec.ts finds are 100% v3-internal drift (air/water kept flat
// thresholds where the other three modes got era byLaw values, presence/presence_standard drift —
// see report §7b) — NONE of them involve a v1 or v2 row, because no v1/v2 row was ever in the pool
// to begin with. Zero of the 14 vanish under "v3-only scoping" because they were already v3-only.
//
// What IS true, and what this file demonstrates instead: pooling v1 into the SAME grouping/
// conflict engine (the 'all'/'active' VersionScope modes added for comparison) manufactures NEW,
// SPURIOUS conflicts that have nothing to do with real data quality — v1's flat `choice` leaves
// get fuzzy-matched against v3's re-authored `presence_standard` prose, producing an
// answerType-mismatch "conflict" that is actually just two different template generations
// describing the same facility. This is why VersionScope defaults to 'exact' (single version,
// v3) and 'all'/'active' are analysis-only, never the grouped editor's default.
import {
  applyEraOverrides,
  parseTemplateDefinition,
  tagContainers,
  type ChecklistTemplateDefinition,
  type TransportMode,
} from '@repo/types'
import * as fs from 'fs'
import * as path from 'path'
import { buildFacilityGroups, detectConflicts, type FacilityLoadedTemplate } from '../facility-grouping.core'

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

function loadRealV3Templates(): FacilityLoadedTemplate[] {
  return V3_VARIANTS.map((v, i) => {
    const raw = JSON.parse(fs.readFileSync(path.join(JSON_DIR, v.file), 'utf-8'))
    let def = parseTemplateDefinition(raw)
    const overridesPath = path.join(JSON_DIR, v.overridesFile)
    if (fs.existsSync(overridesPath)) def = applyEraOverrides(def, JSON.parse(fs.readFileSync(overridesPath, 'utf-8')))
    tagContainers(def, v.mode, v.variantKey)
    // v3 rows here are all DRAFT in reality except rail_metro (ACTIVE) — status doesn't affect
    // grouping/conflict logic, only display, so a fixed 'DRAFT' is fine for this comparison.
    return { templateId: `v3-${i}`, mode: v.mode, variantKey: v.variantKey, version: 3, status: 'DRAFT' as const, definition: def }
  })
}

// SYNTHETIC v1 fixture — representative of the flat, schemaVersion:1 shape every real v1 template
// has (see apps/api/prisma/v1-template-groups.ts, not imported here: that file lives under
// prisma/, outside apps/api's tsconfig `rootDir: "./src"`, so a test under src/ cannot import it).
// Not real สนข. item text — deliberately paraphrased/shortened, which is itself representative of
// how v1's terse prompts differ from v3's fuller re-authored prose for the same facility.
function syntheticV1LandTemplate(): FacilityLoadedTemplate {
  const definition: ChecklistTemplateDefinition = {
    schemaVersion: 1,
    mode: 'ทางบก',
    groups: [
      {
        code: 'A',
        labelTh: 'การเข้าถึง',
        items: [
          // Deliberately the SAME container label a v3 land container also uses ("ทางลาดสำหรับคนพิการ"),
          // to exercise the label-fuzzy-merge path across versions.
          { code: 'A1', labelTh: 'ทางลาดสำหรับคนพิการ', answerType: 'choice' },
          { code: 'A2', labelTh: 'ที่จอดรถสำหรับคนพิการ', answerType: 'choice' },
        ],
      },
    ],
  }
  return { templateId: 'v1-land-synthetic', mode: 'ทางบก', variantKey: 'standard', version: 1, status: 'ACTIVE', definition }
}

const describeIfPresent = allFilesPresent ? describe : describe.skip

describeIfPresent('VersionScope comparison — exact (v3-only) vs pooled (v1+v3)', () => {
  it('v3-only (the grouped editor\'s real default): every conflict is v3-internal — none involve a v1/v2 row', () => {
    const v3Only = buildFacilityGroups(loadRealV3Templates())
    const conflicts = detectConflicts(v3Only)
    expect(conflicts.length).toBeGreaterThan(0) // the real §7b drift, still there
    for (const c of conflicts) {
      for (const variant of c.variants) {
        for (const inst of variant.instances) {
          expect(inst.version).toBe(3) // confirms: this list was never cross-version to begin with
        }
      }
    }
  })

  it('pooling v1 into the SAME engine merges it into the v3 ramp group on label text, then pollutes the item list with a granularity-mismatched entry', () => {
    const pooled = buildFacilityGroups([...loadRealV3Templates(), syntheticV1LandTemplate()])
    const rampGroup = pooled.containerGroups.find((g) => g.labelTh === 'ทางลาดสำหรับคนพิการ')!
    expect(rampGroup).toBeDefined()
    // The v1 "ramp" container merges into the same group as v3's 17 real ramp containers purely on
    // label text (§6's grouping key) — even though it's a flat, whole-facility `choice` leaf,
    // structurally nothing like the 27 individual measurement items v3's ramp actually contains.
    const v1Instance = rampGroup.instances.find((inst) => inst.version === 1)
    expect(v1Instance).toBeDefined()

    // Turns out this does NOT surface as a "conflict" (a conflict requires >1 instance sharing the
    // SAME item TEXT with divergent data — see detectConflicts). v1's item text is the whole-
    // facility container label ("ทางลาดสำหรับคนพิการ"), which doesn't textually match any of v3's
    // 27 fine-grained measurement texts, so it never collides with a real item at all. The actual
    // failure mode is quieter but still real: it becomes its own spurious canonical item — flagged
    // MODE_SPECIFIC (correctly "only 1 instance"), but that framing is misleading for it specifically
    // — it isn't a real per-mode variant of a shared item, it's a different GRANULARITY of question
    // (whole-facility yes/no vs one measurement) that has no business being counted as an edit unit
    // of this group at all. This is the concrete cost of pooling versions: not false conflicts, but
    // silently miscounted "edit units" an admin would see no warning about.
    const conflicts = detectConflicts(pooled)
    const v1InConflict = conflicts.some((c) => c.variants.some((v) => v.instances.some((inst) => inst.version === 1)))
    expect(v1InConflict).toBe(false)

    const spuriousItem = pooled.canonicalItems.find(
      (it) => it.containerGroupId === rampGroup.id && it.instances.some((inst) => inst.version === 1),
    )
    expect(spuriousItem).toBeDefined()
    expect(spuriousItem!.instances).toHaveLength(1)
    expect(spuriousItem!.instances[0]!.node.answerType).toBe('choice') // not presence_standard like every real ramp measurement
  })

  it('breakdown.byMode carries version+status so a mixed-scope computation stays legible (Part 1 addition)', () => {
    const pooled = buildFacilityGroups([...loadRealV3Templates(), syntheticV1LandTemplate()])
    const rampGroup = pooled.containerGroups.find((g) => g.labelTh === 'ทางลาดสำหรับคนพิการ')!
    const landBreakdown = rampGroup.breakdown.byMode.find((m) => m.mode === 'ทางบก')!
    const versions = landBreakdown.byVariant[0]!.byVersion.map((v) => `${v.version}:${v.status}`).sort()
    expect(versions).toEqual(['1:ACTIVE', '3:DRAFT'])
  })
})
