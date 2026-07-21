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
  type ChecklistTemplateDefinition,
  type ChecklistTemplateGroupDef,
  type TemplateNode,
  FACILITY_CATALOG,
  LAW_REFERENCE_SEED,
} from '@repo/types'
import { V1_TEMPLATE_GROUPS } from './v1-template-groups'

const prisma = new PrismaClient()

const MODES = ['ทางบก', 'ทางราง', 'ทางเรือ', 'ทางอากาศ'] as const
type Mode = typeof MODES[number]

const V2_FILES: Record<Mode, string> = {
  ทางบก: 'template_land_v2.json',
  ทางราง: 'template_rail_v2.json',
  ทางเรือ: 'template_water_v2.json',
  ทางอากาศ: 'template_air_v2.json',
}
// Session E2, Part A.4 — per-mode era-override files, merged onto the base v2 seed before
// validation/upsert. A mode with no file here yet (only rail exists at authoring time) is a
// no-op, not an error — see apps/docs/Checklist_Utils/era_overrides_rail.json's `_readme`.
const ERA_OVERRIDE_FILES: Record<Mode, string> = {
  ทางบก: 'era_overrides_land.json',
  ทางราง: 'era_overrides_rail.json',
  ทางเรือ: 'era_overrides_water.json',
  ทางอากาศ: 'era_overrides_air.json',
}
const V2_DIR = path.resolve(__dirname, '..', '..', 'docs', 'Checklist_Utils')

// ---- facility-catalog name matching (Part A2.4) --------------------------------------------

function normalize(s: string): string {
  return s.replace(/[（(][^)）]*[)）]/g, '').replace(/\s+/g, ' ').trim()
}

interface FacilityMatch { code: number; matchedText: string }

function matchFacility(labelTh: string): FacilityMatch | null {
  const normLabel = normalize(labelTh)
  let best: (FacilityMatch & { length: number }) | null = null
  for (const entry of FACILITY_CATALOG) {
    const alternatives = normalize(entry.nameTh).split('/').map(s => s.trim()).filter(s => s.length >= 4)
    for (const alt of alternatives) {
      const isMatch = normLabel === alt || normLabel.includes(alt) || alt.includes(normLabel)
      if (isMatch && (!best || alt.length > best.length)) {
        best = { code: entry.code, matchedText: alt, length: alt.length }
      }
    }
  }
  return best ? { code: best.code, matchedText: best.matchedText } : null
}

interface TagStats { total: number; tagged: number; unmatched: string[] }

function tagLeaves(def: ChecklistTemplateDefinition): TagStats {
  const stats: TagStats = { total: 0, tagged: 0, unmatched: [] }
  const visit = (node: TemplateNode) => {
    if (node.subItems && node.subItems.length > 0) {
      for (const child of node.subItems) visit(child)
      return
    }
    stats.total++
    const match = matchFacility(node.labelTh)
    if (!match) { stats.unmatched.push(node.labelTh); return }
    stats.tagged++
    const catalogEntry = FACILITY_CATALOG.find(e => e.code === match.code)!
    node.facilityCode = catalogEntry.code
    node.lawRefs = [...catalogEntry.lawRefs]
    if (catalogEntry.cabinetResolution) node.cabinetResolution = true
    if (catalogEntry.beyondLaw) node.beyondLaw = true
  }
  for (const g of def.groups) for (const item of g.items) visit(item)
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

async function upsertTemplate(mode: Mode, version: number, status: 'ACTIVE' | 'DRAFT', def: ChecklistTemplateDefinition, notes: string) {
  await prisma.checklistTemplate.upsert({
    where: { mode_variantKey_version: { mode, variantKey: 'standard', version } },
    update: { definition: def as unknown as Prisma.InputJsonValue, status, notes },
    create: { mode, variantKey: 'standard', version, status, definition: def as unknown as Prisma.InputJsonValue, notes },
  })
}

async function main() {
  const report: string[] = []

  // ---- 1. LawReference ----
  for (const law of LAW_REFERENCE_SEED) {
    await prisma.lawReference.upsert({
      where: { code: law.code },
      update: { nameTh: law.nameTh, ministry: law.ministry, buddhistYear: law.buddhistYear, effectiveYear: law.effectiveYear ?? null, notes: law.notes ?? null },
      create: { code: law.code, nameTh: law.nameTh, ministry: law.ministry, buddhistYear: law.buddhistYear, effectiveYear: law.effectiveYear ?? null, notes: law.notes ?? null },
    })
  }
  report.push(`LawReference: seeded ${LAW_REFERENCE_SEED.length} rows`)

  // ---- 2/3/4. Templates ----
  for (const mode of MODES) {
    const v1def = parseTemplateDefinition(buildV1Definition(mode)) // round-trip through the validator as a sanity check
    const v1stats = tagLeaves(v1def)
    await upsertTemplate(mode, 1, 'ACTIVE', v1def, 'v1 parity anchor — item-for-item, code-for-code with the pre-E1 in-code form (apps/web/lib/constants.ts)')
    report.push(`v1 ${mode}: ${v1stats.total} items, ${v1stats.tagged}/${v1stats.total} facility-tagged`)
    if (v1stats.unmatched.length) report.push(`  v1 ${mode} unmatched: ${v1stats.unmatched.join(' | ')}`)

    const rawPath = path.join(V2_DIR, V2_FILES[mode])
    const raw = JSON.parse(fs.readFileSync(rawPath, 'utf-8'))
    // Data-quality fix, not a restructure: template_water_v2.json's `mode` field says "ทางน้ำ" —
    // the source workbook's own term — instead of this project's canonical TransportMode
    // "ทางเรือ" (CLAUDE.md taxonomy). Every group/item code and label is untouched; only this one
    // top-level field is normalized before validation so it maps to the right ChecklistTemplate
    // row. Flagged here rather than loosened in the shared validator, which should stay strict
    // about canonical TransportMode values for every other caller.
    if (raw.mode === 'ทางน้ำ') raw.mode = 'ทางเรือ'
    let v2def = parseTemplateDefinition(raw) // throws loudly on any mismatch — v2 files are loaded verbatim, never coerced

    const overridesPath = path.join(V2_DIR, ERA_OVERRIDE_FILES[mode])
    if (fs.existsSync(overridesPath)) {
      const overridesRaw = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'))
      v2def = applyEraOverrides(v2def, overridesRaw)
      report.push(`v2 ${mode}: applied era overrides from ${ERA_OVERRIDE_FILES[mode]} (${Object.keys(overridesRaw.overrides ?? {}).length} leaf(ves))`)
    }

    const v2stats = tagLeaves(v2def)
    await upsertTemplate(mode, 2, 'DRAFT', v2def, 'PROVISIONAL — see apps/docs/Checklist_Utils/DATA_DICTIONARY_v2.md; NOT activated in Session E1')
    report.push(`v2 ${mode}: ${v2stats.total} leaves, ${v2stats.tagged}/${v2stats.total} facility-tagged`)
    if (v2stats.unmatched.length) {
      report.push(`  v2 ${mode} unmatched (${v2stats.unmatched.length}): ${v2stats.unmatched.slice(0, 30).join(' | ')}${v2stats.unmatched.length > 30 ? ' ...' : ''}`)
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
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
