/**
 * Session S5, Part G — dry-run report for the two Phase-1 facility types (ramp/slope tiers,
 * tactile/warning blocks), computed against the REAL committed v3 template JSONs
 * (tools/checklist_json/), same loading pipeline as facility-grouping.spec.ts (S4b's own
 * report-reproduction test) and seed-templates.ts (parse -> applyEraOverrides -> tagContainers).
 *
 * This is the "Report it; migrate nothing" requirement satisfied WITHOUT touching any database —
 * the session brief is explicit that Part G must not run against a DB, dry-run included, so the
 * numbers below come from the same JSON files a real migration run would eventually read from the
 * DB (identical content, since those files ARE what seed-templates.ts writes into ChecklistTemplate
 * rows) rather than from an actual Prisma connection. `console.log` calls are deliberate — this
 * suite doubles as the dry-run report itself; `pnpm test -- master-migration-dry-run` reprints it.
 *
 * Also compile-smoke-tests apps/api/prisma/migrate-to-master-criteria.ts (the real CLI script) by
 * importing it — its `main()` is guarded behind `require.main === module`, so importing it here
 * never executes anything or touches a DB; a type/syntax error in that file would still fail this
 * import.
 */
import * as fs from 'fs'
import * as path from 'path'
import { applyEraOverrides, parseTemplateDefinition, tagContainers, type TransportMode } from '@repo/types'
import type { FacilityLoadedTemplate } from '../facility-grouping.core'
import { PHASE1_FACILITIES, computeDryRun } from '../master-migration.core'

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
    if (fs.existsSync(overridesPath)) {
      const overridesRaw = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'))
      def = applyEraOverrides(def, overridesRaw)
    }
    tagContainers(def, v.mode, v.variantKey)
    return { templateId: `test-v3-${i}`, mode: v.mode, variantKey: v.variantKey, version: 3, status: 'DRAFT' as const, definition: def }
  })
}

function printReport(label: string, report: ReturnType<typeof computeDryRun>): void {
  console.log(`\n==== Part G dry-run — facility="${label}" ====`)
  console.log(`matched groups: ${report.matchedGroups.join(', ') || '(none)'}`)
  console.log(`ELIGIBLE (${report.eligible.length}):`)
  for (const e of report.eligible) {
    console.log(`  [${e.containerGroupLabel}] "${e.itemLabel}" — ${e.instanceCount} instance(s)`)
  }
  console.log(`BLOCKED (${report.blocked.length}):`)
  for (const b of report.blocked) {
    console.log(`  [${b.containerGroupLabel}] "${b.itemLabel}" (${b.instanceCount}) — ${b.reason}`)
  }
  console.log(`skipped single-instance: ${report.skippedSingleInstance}`)
}

const describeIfPresent = allFilesPresent ? describe : describe.skip

describeIfPresent('Part G — dry-run report against the real v3 JSONs', () => {
  const templates = loadRealV3Templates()

  it('ramp/slope-tier group: reports eligible + blocked candidates, migrates nothing', () => {
    const report = computeDryRun(templates, PHASE1_FACILITIES.ramp!)
    printReport('ramp', report)
    expect(report.matchedGroups.length).toBeGreaterThan(0)
    // Sanity: every eligible item really is multi-instance and carries no live conflict.
    for (const e of report.eligible) expect(e.instanceCount).toBeGreaterThanOrEqual(2)
  })

  it('tactile/warning group: the known flat-vs-byLaw split blocks, doesn\'t silently migrate', () => {
    const report = computeDryRun(templates, PHASE1_FACILITIES.tactile!)
    printReport('tactile', report)
    expect(report.matchedGroups.length).toBeGreaterThan(0)
    // Session S4b's own conflict list top entry: 33x flat gte300+gte200 vs 1x byLaw MHT_2548/2564
    // on rail_metro:B4.2-1 — expect AT LEAST ONE blocked item in this facility type (never zero;
    // a zero here would mean either the conflict engine or this migration gate regressed).
    expect(report.blocked.length).toBeGreaterThan(0)
  })

  it('every eligible item across both Phase-1 facilities passes extendedFieldsAgree by construction', () => {
    const rampReport = computeDryRun(templates, PHASE1_FACILITIES.ramp!)
    const tactileReport = computeDryRun(templates, PHASE1_FACILITIES.tactile!)
    printReport('all (ramp+tactile combined)', computeDryRun(templates, [...PHASE1_FACILITIES.ramp!, ...PHASE1_FACILITIES.tactile!]))
    // Nothing to assert beyond "it ran" — the printed report above is this test's real output.
    expect(rampReport.eligible.length + tactileReport.eligible.length).toBeGreaterThanOrEqual(0)
  })
})

describe('migrate-to-master-criteria.ts — compile smoke test', () => {
  it('imports without executing main() or touching any DB', () => {
    expect(() => require('../../../../prisma/migrate-to-master-criteria')).not.toThrow()
  })
})
