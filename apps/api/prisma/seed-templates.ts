// E-form redesign (Session E1, Parts A.3 / A2.4 / A.4) — seeds:
//   1. LawReference rows (Part A2.1)
//   2. 4 v1 ACTIVE ChecklistTemplate rows — converted from V1_TEMPLATE_GROUPS (today's in-code
//      form, see that file's header), item-for-item / code-for-code identical to the live form.
//   3. 4 v2 DRAFT ChecklistTemplate rows — apps/docs/Checklist_Utils/template_*_v2.json loaded
//      VERBATIM (not restructured/renumbered), validated against @repo/types' runtime validator.
//   4. Best-effort facility-catalog tagging (facilityCode/lawRefs/cabinetResolution/beyondLaw) on
//      every leaf of both v1 and v2 templates, by name-matching against FACILITY_CATALOG. Items
//      with no confident match are left untagged (facilityCode absent) — never force-matched.
//   5. Backfill: every pre-existing Checklist row with templateId IS NULL is stamped to its
//      station's mode's v1 ACTIVE template (id + version). New checklists created after this
//      script has run stamp the ACTIVE template themselves at creation time (see
//      ChecklistsService.submit/saveDraft) — this script only fixes up rows that predate that.
//
// Idempotent: safe to re-run (upserts by the (mode, variantKey, version) unique key and by
// LawReference.code; the backfill only touches rows where templateId IS NULL).
//
// Run after `prisma migrate deploy` has created the ChecklistTemplate/LawReference tables:
//   npx ts-node prisma/seed-templates.ts

import { PrismaClient, Prisma } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'
import {
  parseTemplateDefinition,
  applyEraOverrides,
  RAIL_TRAIN_VARIANT_KEY,
  RAIL_METRO_VARIANT_KEY,
  STANDARD_VARIANT_KEY,
  type ChecklistTemplateDefinition,
  type ChecklistTemplateGroupDef,
  type TemplateNode,
  LAW_REFERENCE_SEED,
  OPTIONAL_GROUP_CODES,
  tagLeaves,
  tagContainers,
  parseMasterCriteriaBlock,
  type MasterCriterionExport,
} from '@repo/types'
import { V1_TEMPLATE_GROUPS } from './v1-template-groups'

const prisma = new PrismaClient()

const MODES = ['ทางบก', 'ทางราง', 'ทางน้ำ', 'ทางอากาศ'] as const
type Mode = typeof MODES[number]

// Session E3, Part A — per-mode v2 DRAFT variant(s). Every mode but rail has exactly one variant
// ('standard'), keeping its pre-existing filename unchanged. Rail now has two: `rail_train`'s file
// is the same template_rail_v2.json seeded since Session E1/E2 (DECISION: that workbook IS the
// รถไฟ checklist) — no rename, so re-running this script against the migrated DB row still matches
// by (mode, variantKey, version). `rail_metro`'s workbook has not been delivered yet; its entry
// follows the template_{mode}_{variant}_v2.json / era_overrides_{mode}_{variant}.json convention
// for whenever it arrives — a missing file is a logged no-op, not an error (see the main loop).
interface VariantFiles { variantKey: string; file: string; overridesFile?: string }
const V2_VARIANTS: Record<Mode, VariantFiles[]> = {
  ทางบก:    [{ variantKey: STANDARD_VARIANT_KEY, file: 'template_land_v2.json',  overridesFile: 'era_overrides_land.json' }],
  ทางราง:   [
    { variantKey: RAIL_TRAIN_VARIANT_KEY, file: 'template_rail_v2.json', overridesFile: 'era_overrides_rail.json' },
    { variantKey: RAIL_METRO_VARIANT_KEY, file: 'template_rail_rail_metro_v2.json', overridesFile: 'era_overrides_rail_rail_metro.json' },
  ],
  ทางน้ำ:   [{ variantKey: STANDARD_VARIANT_KEY, file: 'template_water_v2.json', overridesFile: 'era_overrides_water.json' }],
  ทางอากาศ: [{ variantKey: STANDARD_VARIANT_KEY, file: 'template_air_v2.json',   overridesFile: 'era_overrides_air.json' }],
}

// v3-migration-cutover — candidate templates from the checklist-migration pipeline
// (tools/checklist-migration/).
//
// Session F3, Part G — era overrides ARE applied here now, exactly as in the v2 loop above. They
// previously were not, because applyEraOverrides() cannot read the migration pipeline's CANDIDATE
// file shape (per-law raw numbers keyed by leaf code) — that gap is now closed by an explicit
// converter, tools/checklist-migration/era_overrides_convert.py, which turns a candidate file
// into the `{ overrides: { code: { measurements: [...] } } }` shape this loop merges. Regenerate
// the files named below with that script; never hand-edit them.
const V3_VARIANTS: Record<Mode, VariantFiles[]> = {
  ทางบก:    [{ variantKey: STANDARD_VARIANT_KEY, file: 'template_land_v3.json', overridesFile: 'era_overrides_land_v3.json' }],
  ทางราง:   [
    { variantKey: RAIL_TRAIN_VARIANT_KEY, file: 'template_rail_rail_train_v3.json', overridesFile: 'era_overrides_rail_rail_train_v3.json' },
    { variantKey: RAIL_METRO_VARIANT_KEY, file: 'template_rail_rail_metro_v3.json', overridesFile: 'era_overrides_rail_rail_metro_v3.json' },
  ],
  ทางน้ำ:   [{ variantKey: STANDARD_VARIANT_KEY, file: 'template_water_v3.json', overridesFile: 'era_overrides_water_v3.json' }],
  ทางอากาศ: [{ variantKey: STANDARD_VARIANT_KEY, file: 'template_air_v3.json', overridesFile: 'era_overrides_air_v3.json' }],
}

// tools/checklist_json/ is the real current home for these seed JSONs — moved here (from the
// original apps/docs/Checklist_Utils) by two prior refactors (commits c86e0c6, 66e3339). This
// path previously still pointed at apps/docs/Checklist_Utils, which no longer exists — every
// v2 file lookup was silently hitting the "missing file, skip" branch below. Fixed here.
const TEMPLATE_JSON_DIR = path.resolve(__dirname, '..', '..', '..', 'tools', 'checklist_json')

// ---- facility-catalog tagging (Part A2.4) ----------------------------------------------------
//
// matchFacility/tagLeaves (per-leaf) and tagContainers (container-level, all v3 modes — see that
// function's doc in @repo/types for why container-level tagging replaced per-leaf tagging for v3)
// now live in @repo/types (Session S4b) so the facility-grouped editor's grouping engine can reuse
// the exact same tagging pipeline this seed script runs. Behavior unchanged; this is an import,
// not a rewrite.

// ---- Session F3, Part G.1 — era-override application, loudly ---------------------------------
//
// A DECLARED-but-missing overrides file used to be a silent no-op: `if (fs.existsSync(path))`
// with no else. Four of the five v2 files named in V2_VARIANTS have never existed, so four modes
// were seeded with no era overrides at all while the seed report said nothing — which is the
// entire reason "era overrides don't work" went unnoticed for three sessions.
//
// Now a missing declared file is reported as a WARNING line, collected and re-printed as a block
// at the end of the run so it cannot scroll past unnoticed. Deliberately a warning, not a hard
// failure: `pnpm db:seed` must stay runnable on a fresh checkout where the (gitignored, สนข.-
// derived) override files have not been generated yet — see era_overrides_convert.py. Making it
// fatal would block every developer from seeding at all over data they may not be allowed to hold.
// The one thing it must never do again is pass silently.
function applyOverridesFile(
  def: ChecklistTemplateDefinition,
  variant: VariantFiles,
  label: string,
  report: string[],
  warnings: string[],
): ChecklistTemplateDefinition {
  if (!variant.overridesFile) return def

  const overridesPath = path.join(TEMPLATE_JSON_DIR, variant.overridesFile)
  if (!fs.existsSync(overridesPath)) {
    const warning = `${label}: era overrides DECLARED but MISSING — ${variant.overridesFile} not found in ${TEMPLATE_JSON_DIR}. This template was seeded with NO era overrides.`
    warnings.push(warning)
    report.push(`  ⚠ ${warning}`)
    return def
  }

  const overridesRaw = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'))
  const merged = applyEraOverrides(def, overridesRaw)
  const count = Object.keys(overridesRaw.overrides ?? {}).length
  if (count === 0) {
    const warning = `${label}: ${variant.overridesFile} exists but declares ZERO overrides — nothing was applied.`
    warnings.push(warning)
    report.push(`  ⚠ ${warning}`)
    return merged
  }
  report.push(`${label}: applied era overrides from ${variant.overridesFile} (${count} leaf(ves))`)
  return merged
}

// Part G.5 — honest byLaw coverage, counted on the template as it will actually be stored.
function countByLawLeaves(def: ChecklistTemplateDefinition): number {
  let n = 0
  const visit = (node: TemplateNode) => {
    if (node.measurements?.some((m) => m.byLaw && Object.keys(m.byLaw).length > 0)) n++
    for (const child of node.subItems ?? []) visit(child)
  }
  for (const g of def.groups) for (const item of g.items) visit(item)
  return n
}

// ---- Session F3, Part C.1 — optional-group stamping ----------------------------------------
//
// Marks every group whose code is in OPTIONAL_GROUP_CODES (C1/C2) as `optional: true`, on EVERY
// version this script seeds — v1, v2 and v3 alike. The auditor submit gate reads that per-group
// flag, never a `/^C/` test, so which groups are optional stays a property of the checklist
// definition rather than a hardcoded rule in the form.
//
// Purely additive: a template with no matching group codes is returned unchanged, and the flag is
// only ever set to `true` (never written as `false`), so untouched templates still round-trip
// byte-identically through the admin editor.
//
// Coverage note (verified 2026-08-04): v2 and v3 carry C1+C2 for every mode/variant. v1 does NOT
// — only ทางบก has C groups at all; v1 ทางราง/ทางน้ำ/ทางอากาศ have none, so this is a no-op there.
function markOptionalGroups(def: ChecklistTemplateDefinition): number {
  let marked = 0
  for (const g of def.groups) {
    if (OPTIONAL_GROUP_CODES.includes(g.code)) {
      g.optional = true
      marked++
    }
  }
  return marked
}

// ---- Session S4a, Part C — initial hidden-node seeding (v3 only) ---------------------------
//
// Three admin-decided absolute hides, identified by exact (whitespace-normalized) label text —
// stable across a reseed the same way facility-catalog matching is, and self-verifying: if a
// label ever changes, the matcher reports fewer hits instead of silently hiding the wrong node.
// Applied AFTER tagContainers (facility tagging doesn't need to see these nodes) and BEFORE
// markOptionalGroups (independent flags, order doesn't matter between them, but keeping seed
// passes in a consistent read-once-report-once order).
const POSITIONING_TACTILE_LABEL = 'พื้นผิวต่างสัมผัสชนิดเปลี่ยนทิศทาง (Positioning Tactile/Block)*'
const WARNING_TACTILE_600_LABEL = 'ติดตั้งพื้นผิวต่างสัมผัสเตือนที่ริมขอบจุดพักทางข้ามความกว้าง 600 มิลลิเมตร'
const HIDDEN_GROUP_CODES: readonly string[] = ['C1', 'C2']

interface HiddenStats { positioningContainers: number; warningLeaves: number; groupCContainers: number; groupCLeaves: number }

function countLeaves(node: TemplateNode): number {
  if (!node.subItems || node.subItems.length === 0) return 1
  return node.subItems.reduce((sum, c) => sum + countLeaves(c), 0)
}

function markInitialHidden(def: ChecklistTemplateDefinition): HiddenStats {
  const stats: HiddenStats = { positioningContainers: 0, warningLeaves: 0, groupCContainers: 0, groupCLeaves: 0 }
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  for (const g of def.groups) {
    const hideWholeGroup = HIDDEN_GROUP_CODES.includes(g.code)
    for (const container of g.items) {
      if (hideWholeGroup) {
        container.hidden = true
        stats.groupCContainers++
        stats.groupCLeaves += countLeaves(container)
        continue
      }
      if (norm(container.labelTh) === POSITIONING_TACTILE_LABEL) {
        container.hidden = true
        stats.positioningContainers++
        continue
      }
      const visit = (node: TemplateNode): void => {
        if (node.subItems && node.subItems.length > 0) { node.subItems.forEach(visit); return }
        if (norm(node.labelTh) === WARNING_TACTILE_600_LABEL) { node.hidden = true; stats.warningLeaves++ }
      }
      visit(container)
    }
  }
  return stats
}

// ---- v1 definition construction ------------------------------------------------------------

function buildV1Definition(mode: Mode): ChecklistTemplateDefinition {
  const groups: ChecklistTemplateGroupDef[] = V1_TEMPLATE_GROUPS[mode].map(g => ({
    code: g.code,
    labelTh: g.labelTh,
    items: g.items.map(it => ({ code: it.code, labelTh: it.labelTh, answerType: 'choice' as const })),
  }))
  return { schemaVersion: 1, mode, provisional: false, groups }
}

// Session S5, Part 0 — SOURCE-OF-TRUTH INVERSION. During this pilot the DATABASE is canonical, not
// the tools/checklist_json/ files: this function used to REBUILD `definition` unconditionally on
// every run (the `update` branch below wrote `definition`+`notes` no matter what), discarding any
// admin-authored state not captured by restore-template-approvals.ts's narrow allowlist — the
// entire reason that script and dump-template-backup.ts exist. That model is now local-dev-only.
//
// A populated row (mode, variantKey, version already exists) is left COMPLETELY untouched —
// definition, notes, status, and every admin edit/confirmation/masterId link inside it — unless
// `force` is explicitly passed, in which case it's overwritten with a printed warning naming
// exactly what's being replaced. Result: running this on a populated DB (including a real deploy
// target) is a safe no-op; a fresh/empty DB still seeds fully, since every row is a first-time
// create there. `status` stays create-only even under `force` — reactivating/retiring is always an
// admin decision (2026-08-06 fix above), never something a forced reseed should touch either.
async function upsertTemplate(
  mode: Mode,
  variantKey: string,
  version: number,
  status: 'ACTIVE' | 'DRAFT',
  def: ChecklistTemplateDefinition,
  notes: string,
  force: boolean,
): Promise<'created' | 'skipped' | 'forced'> {
  const existing = await prisma.checklistTemplate.findUnique({
    where: { mode_variantKey_version: { mode, variantKey, version } },
  })

  if (existing && !force) return 'skipped'

  if (existing && force) {
    console.warn(
      `⚠ --force: overwriting ${mode} ${variantKey} v${version} (row ${existing.id}, currently ${existing.status}) — ` +
        `definition/notes will be replaced from tools/checklist_json/; any admin edit not captured by ` +
        `restore-template-approvals.ts (or a masterId link not present in this file's masterCriteria block) will be lost.`,
    )
    await prisma.checklistTemplate.update({
      where: { id: existing.id },
      data: { definition: def as unknown as Prisma.InputJsonValue, notes },
    })
    return 'forced'
  }

  await prisma.checklistTemplate.create({
    data: { mode, variantKey, version, status, definition: def as unknown as Prisma.InputJsonValue, notes },
  })
  return 'created'
}

// Session S5, Part 1 — the import side of the export/import round-trip: recreates MasterCriterion
// rows from a template file's `masterCriteria` sibling block. Same idempotent-unless-force policy
// as upsertTemplate, applied per master row (keyed by its own `id`, independent of which template
// file it was read from) — two v3 files that both reference the SAME master (the whole point of a
// shared criterion) each try to create it; the second becomes a no-op skip rather than a conflict.
async function upsertMasterCriteria(entries: MasterCriterionExport[], force: boolean, report: string[]): Promise<void> {
  if (entries.length === 0) return
  let created = 0
  let skipped = 0
  let forced = 0
  for (const m of entries) {
    const existing = await prisma.masterCriterion.findUnique({ where: { id: m.id } })
    if (existing && !force) {
      skipped++
      continue
    }
    const data = {
      labelTh: m.labelTh,
      answerType: m.answerType ?? null,
      measurements: (m.measurements as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      guidance: (m.guidance as unknown as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      imageKeys: m.imageKeys ?? [],
      lawRefs: m.lawRefs ?? [],
      cabinetResolution: m.cabinetResolution ?? null,
      beyondLaw: m.beyondLaw ?? null,
      facilityCode: m.facilityCode ?? null,
      updatedBy: m.updatedBy ?? null,
    }
    if (existing) {
      console.warn(`⚠ --force: overwriting existing MasterCriterion ${m.id} ("${m.labelTh}")`)
      await prisma.masterCriterion.update({ where: { id: m.id }, data })
      forced++
    } else {
      await prisma.masterCriterion.create({ data: { id: m.id, ...data } })
      created++
    }
  }
  report.push(`  masterCriteria: ${created} created, ${forced} forced, ${skipped} skipped (of ${entries.length} referenced)`)
}

async function main() {
  // Session S5, Part 0 — the ONLY way to overwrite a row that already exists. Absent, every
  // upsertTemplate/upsertMasterCriteria call is a pure create-if-absent no-op against a populated
  // DB (the deploy-safety guarantee); passed, every existing row this run touches is replaced,
  // loudly, one warning line per row (see upsertTemplate's doc).
  const FORCE = process.argv.includes('--force')

  const report: string[] = []
  // Session F3, Part G.1 — collected separately from `report` so declared-but-missing override
  // files are re-printed as a block at the very end. Inline warnings scroll past in a seed run
  // that prints a line per mode per version; that is exactly how this went unnoticed before.
  const warnings: string[] = []

  // ---- 1. LawReference ----
  for (const law of LAW_REFERENCE_SEED) {
    // effectiveDate is ISO yyyy-mm-dd (Gregorian) in the seed source, DateTime in the DB.
    const effectiveDate = law.effectiveDate ? new Date(law.effectiveDate) : null
    await prisma.lawReference.upsert({
      where: { code: law.code },
      update: { nameTh: law.nameTh, ministry: law.ministry, buddhistYear: law.buddhistYear, effectiveYear: law.effectiveYear ?? null, effectiveDate, notes: law.notes ?? null },
      create: { code: law.code, nameTh: law.nameTh, ministry: law.ministry, buddhistYear: law.buddhistYear, effectiveYear: law.effectiveYear ?? null, effectiveDate, notes: law.notes ?? null },
    })
  }
  report.push(`LawReference: seeded ${LAW_REFERENCE_SEED.length} rows`)

  // ---- 2/3/4. Templates ----
  for (const mode of MODES) {
    const v1def = parseTemplateDefinition(buildV1Definition(mode)) // round-trip through the validator as a sanity check
    const v1stats = tagLeaves(v1def)
    const v1optional = markOptionalGroups(v1def)
    // v1 is NOT split by variant (Session E3, Part A decision) — the live parity anchor stays at
    // variantKey='standard' for every mode, rail included, until v2 activation.
    const v1Outcome = await upsertTemplate(
      mode, STANDARD_VARIANT_KEY, 1, 'ACTIVE', v1def,
      'v1 parity anchor — item-for-item, code-for-code with the pre-E1 in-code form (apps/web/lib/constants.ts)',
      FORCE,
    )
    report.push(`v1 ${mode} [${v1Outcome}]: ${v1stats.total} items, ${v1stats.tagged}/${v1stats.total} facility-tagged, ${v1optional} optional group(s)`)
    if (v1stats.unmatched.length) report.push(`  v1 ${mode} unmatched: ${v1stats.unmatched.join(' | ')}`)

    // v2 DRAFT(s) — one per declared variant; a missing source file is a logged no-op (Session
    // E3, Part A: the pipeline must be ready for a variant's workbook without being blocked by
    // its absence).
    for (const variant of V2_VARIANTS[mode]) {
      const rawPath = path.join(TEMPLATE_JSON_DIR, variant.file)
      if (!fs.existsSync(rawPath)) {
        report.push(`v2 ${mode} [${variant.variantKey}]: SKIPPED — ${variant.file} not found (workbook not authored yet)`)
        continue
      }
      const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8'))
      // template_water_v2.json's `mode` field already says "ทางน้ำ", the source workbook's own
      // term, which is also this project's canonical TransportMode value — no fixup needed here
      // (there used to be one, when the canonical value was "ทางเรือ").
      let v2def = parseTemplateDefinition(raw) // throws loudly on any mismatch — v2 files are loaded verbatim, never coerced

      v2def = applyOverridesFile(v2def, variant, `v2 ${mode} [${variant.variantKey}]`, report, warnings)

      const v2stats = tagLeaves(v2def)
      const v2optional = markOptionalGroups(v2def)
      const v2Outcome = await upsertTemplate(
        mode, variant.variantKey, 2, 'DRAFT', v2def,
        'PROVISIONAL — see apps/docs/Checklist_Utils/DATA_DICTIONARY_v2.md; NOT activated in Session E1',
        FORCE,
      )
      report.push(`v2 ${mode} [${variant.variantKey}] [${v2Outcome}]: ${v2stats.total} leaves, ${v2stats.tagged}/${v2stats.total} facility-tagged, ${v2optional} optional group(s), ${countByLawLeaves(v2def)} byLaw leaf(ves)`)
      if (v2stats.unmatched.length) {
        report.push(`  v2 ${mode} [${variant.variantKey}] unmatched (${v2stats.unmatched.length}): ${v2stats.unmatched.slice(0, 30).join(' | ')}${v2stats.unmatched.length > 30 ? ' ...' : ''}`)
      }
    }

    // v3 DRAFT(s) — candidates from the checklist-migration pipeline. Mirrors the v2 loop
    // exactly, era-override application included (Session F3, Part G.3).
    for (const variant of V3_VARIANTS[mode]) {
      const rawPath = path.join(TEMPLATE_JSON_DIR, variant.file)
      if (!fs.existsSync(rawPath)) {
        report.push(`v3 ${mode} [${variant.variantKey}]: SKIPPED — ${variant.file} not found`)
        continue
      }
      const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8'))
      let v3def = parseTemplateDefinition(raw) // throws loudly on any mismatch — v3 files are loaded verbatim, never coerced

      v3def = applyOverridesFile(v3def, variant, `v3 ${mode} [${variant.variantKey}]`, report, warnings)

      // 2026-08-05 — every v3 mode/variant now uses container-level tagging (see tagContainers'
      // doc). v1/v2 still use the original per-leaf tagLeaves() — out of scope, both superseded.
      const v3stats = tagContainers(v3def, mode, variant.variantKey)
      const v3optional = markOptionalGroups(v3def)
      const v3hidden = markInitialHidden(v3def)
      const v3Outcome = await upsertTemplate(
        mode, variant.variantKey, 3, 'DRAFT', v3def,
        'PROVISIONAL — checklist-migration pipeline candidate; NOT activated',
        FORCE,
      )
      report.push(`v3 ${mode} [${variant.variantKey}] [${v3Outcome}]: ${v3stats.total} leaves, ${v3stats.tagged}/${v3stats.total} facility-tagged, ${v3optional} optional group(s), ${countByLawLeaves(v3def)} byLaw leaf(ves)`)
      // Session S5, Part 1 — the masterCriteria sibling block (see MasterCriterionExport's doc in
      // @repo/types). Imported independent of v3Outcome: a template row can be SKIPPED while its
      // master rows still need creating on a fresh DB (they're a separate resource keyed by their
      // own id, not owned by any one template row).
      const masterCriteriaRaw = parseMasterCriteriaBlock((raw as { masterCriteria?: unknown }).masterCriteria)
      await upsertMasterCriteria(masterCriteriaRaw, FORCE, report)
      report.push(`  v3 ${mode} [${variant.variantKey}] container-level: ${v3stats.containersOverridden} overridden, ${v3stats.containersAutoMatched} auto-matched, ${v3stats.containersFallenBackToLeaf} fell back to per-leaf matching`)
      report.push(`  v3 ${mode} [${variant.variantKey}] hidden (S4a): ${v3hidden.positioningContainers} Positioning container(s), ${v3hidden.warningLeaves} Warning-600 leaf(ves), ${v3hidden.groupCContainers} group-C container(s)/${v3hidden.groupCLeaves} leaves`)
      if (v3stats.unmatched.length) {
        report.push(`  v3 ${mode} [${variant.variantKey}] unmatched (${v3stats.unmatched.length}): ${v3stats.unmatched.slice(0, 30).join(' | ')}${v3stats.unmatched.length > 30 ? ' ...' : ''}`)
      }
    }
  }

  // ---- 5. Backfill existing Checklist rows ----
  const v1Templates = await prisma.checklistTemplate.findMany({ where: { variantKey: 'standard', version: 1, status: 'ACTIVE' } })
  const templateByMode = new Map(v1Templates.map(t => [t.mode, t]))

  const unbackfilled = await prisma.checklist.findMany({
    where: { templateId: null },
    select: { id: true, station: { select: { mode: true } } },
  })
  let backfilled = 0
  for (const cl of unbackfilled) {
    const t = templateByMode.get(cl.station.mode)
    if (!t) continue
    await prisma.checklist.update({ where: { id: cl.id }, data: { templateId: t.id, templateVersion: t.version } })
    backfilled++
  }
  report.push(`Backfill: ${backfilled}/${unbackfilled.length} pre-existing Checklist rows stamped to their mode's v1 ACTIVE template`)

  console.log(report.join('\n'))

  // Part G.1 — the block that makes a silent no-op impossible to miss.
  if (warnings.length > 0) {
    console.warn(
      `\n${'='.repeat(78)}\n` +
      `⚠  ERA OVERRIDES: ${warnings.length} declared file(s) were NOT applied\n` +
      `${'='.repeat(78)}\n` +
      warnings.map((w) => `  • ${w}`).join('\n') +
      `\n\nGenerate the missing file(s) with:\n` +
      `  python tools/checklist-migration/era_overrides_convert.py \\\n` +
      `      <candidates.json> <template.json> tools/checklist_json/<overrides.json>\n` +
      `${'='.repeat(78)}\n`
    )
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
