// ONE-OFF, throwaway script — NOT part of the normal seed pipeline, not referenced from
// package.json. Purpose: push the container-era-text session's already-committed data
// (commit 2a6df8c) into an EXISTING local DB's v3 ChecklistTemplate rows WITHOUT a --force
// reseed, so nothing admin-authored since last seed gets discarded.
//
// Why this exists: seed-templates.ts's upsertTemplate is skip-if-exists unless --force, and
// --force rebuilds `definition` wholesale from tools/checklist_json/, which would blow away
// any admin edit not captured by restore-template-approvals.ts. The new data here is only two
// kinds of narrow, well-known field additions:
//   1. `labelByLaw` on 34 container/item nodes (the ramp case-condition text fix)
//   2. `measurements[key].byLaw.MHT_2564.{tiers,sourceText}` on the A1.1-1-style parking item,
//      per mode
// Both already exist, tested, in tools/checklist_json/era_overrides_{mode}_v3.json (merged
// into a scratch copy of the base template here via the same tested applyEraOverrides()) — this
// script does NOT reimplement that merge logic, it only lifts the two specific field paths back
// out of the merge result and copies them onto the live DB tree, node-by-node, matched by `code`
// (and by measurement `key` for the nested case). Every other field on every other node is left
// byte-identical to whatever is live right now.
//
// Usage:
//   npx ts-node prisma/push-container-era-text-live.ts           (dry run — prints the diff only)
//   npx ts-node prisma/push-container-era-text-live.ts --apply   (writes to DB)

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
  type TemplateNode,
} from '@repo/types'

const prisma = new PrismaClient()

const TEMPLATE_JSON_DIR = path.resolve(__dirname, '..', '..', '..', 'tools', 'checklist_json')

const TARGETS: { mode: string; variantKey: string; templateFile: string; overridesFile: string }[] = [
  { mode: 'ทางบก', variantKey: STANDARD_VARIANT_KEY, templateFile: 'template_land_v3.json', overridesFile: 'era_overrides_land_v3.json' },
  { mode: 'ทางราง', variantKey: RAIL_TRAIN_VARIANT_KEY, templateFile: 'template_rail_rail_train_v3.json', overridesFile: 'era_overrides_rail_rail_train_v3.json' },
  { mode: 'ทางราง', variantKey: RAIL_METRO_VARIANT_KEY, templateFile: 'template_rail_rail_metro_v3.json', overridesFile: 'era_overrides_rail_rail_metro_v3.json' },
  { mode: 'ทางน้ำ', variantKey: STANDARD_VARIANT_KEY, templateFile: 'template_water_v3.json', overridesFile: 'era_overrides_water_v3.json' },
  { mode: 'ทางอากาศ', variantKey: STANDARD_VARIANT_KEY, templateFile: 'template_air_v3.json', overridesFile: 'era_overrides_air_v3.json' },
]

// Stable stringify: JSON.stringify's key order follows insertion order, which differs between a
// value that came back from Postgres (its own on-disk key order) and one freshly built by
// applyEraOverrides() in this process — same data, different insertion order, false-positive diff.
// Sorting keys recursively before stringifying makes the comparison content-only.
// parseTemplateDefinition's validator (checklist-template.ts) normalizes every byLaw entry to a
// fixed field set, explicitly setting absent optional fields to `undefined` rather than omitting
// the key — so the "ideal" side (which goes through that parser) has real keys like `labelTh`
// that are *present but undefined*, while the live DB's raw JSON (fetched straight off Postgres,
// never re-parsed) simply never had that key. JSON.stringify treats both as equivalent (it drops
// undefined-valued keys), so this must too — Object.keys() alone does not, which is what produced
// the first round of false-positive diffs here.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function indexByCode(def: ChecklistTemplateDefinition): Map<string, TemplateNode> {
  const map = new Map<string, TemplateNode>()
  function walk(node: TemplateNode) {
    if (node.code) map.set(node.code, node)
    const kids = (node as any).subItems || (node as any).items || []
    for (const k of kids) walk(k)
  }
  for (const group of (def as any).groups || []) walk(group)
  return map
}

async function main() {
  const apply = process.argv.includes('--apply')
  console.log(apply ? 'APPLY mode — writing to DB' : 'DRY RUN — no writes (pass --apply to write)')

  let totalLabelByLaw = 0
  let totalTierPatches = 0
  let totalRowsTouched = 0

  for (const t of TARGETS) {
    const label = `${t.mode}/${t.variantKey}`
    const overridesPath = path.join(TEMPLATE_JSON_DIR, t.overridesFile)
    const overridesRaw = JSON.parse(fs.readFileSync(overridesPath, 'utf-8'))
    const codesWithLabelByLaw = new Set<string>()
    const codesWithMeasurementByLaw = new Set<string>()
    for (const [code, entry] of Object.entries<any>(overridesRaw.overrides ?? {})) {
      if (entry.labelByLaw) codesWithLabelByLaw.add(code)
      if (entry.measurements) codesWithMeasurementByLaw.add(code)
    }

    const baseRaw = JSON.parse(fs.readFileSync(path.join(TEMPLATE_JSON_DIR, t.templateFile), 'utf-8'))
    const base = parseTemplateDefinition(baseRaw)
    const idealMerged = applyEraOverrides(base, overridesRaw)
    const idealIndex = indexByCode(idealMerged)

    const row = await prisma.checklistTemplate.findUnique({
      where: { mode_variantKey_version: { mode: t.mode, variantKey: t.variantKey, version: 3 } },
    })
    if (!row) {
      console.log(`  ⚠ ${label} v3: no DB row found — skipping (nothing to patch live)`)
      continue
    }

    const liveDef = row.definition as unknown as ChecklistTemplateDefinition
    const liveIndex = indexByCode(liveDef)
    let rowChanges = 0

    for (const code of codesWithLabelByLaw) {
      const idealNode = idealIndex.get(code)
      const liveNode = liveIndex.get(code)
      if (!idealNode || !liveNode) {
        console.log(`  ⚠ ${label} ${code}: node not found in ${!idealNode ? 'merged' : 'live DB'} tree — SKIPPED`)
        continue
      }
      const before = (liveNode as any).labelByLaw ?? null
      const after = (idealNode as any).labelByLaw ?? null
      if (stableStringify(before) !== stableStringify(after)) {
        console.log(`  ${label} ${code}.labelByLaw:\n    before: ${JSON.stringify(before)}\n    after:  ${JSON.stringify(after)}`)
        ;(liveNode as any).labelByLaw = (idealNode as any).labelByLaw
        rowChanges++
        totalLabelByLaw++
      }
    }

    for (const code of codesWithMeasurementByLaw) {
      const idealNode = idealIndex.get(code)
      const liveNode = liveIndex.get(code)
      if (!idealNode || !liveNode) {
        console.log(`  ⚠ ${label} ${code}: node not found in ${!idealNode ? 'merged' : 'live DB'} tree — SKIPPED`)
        continue
      }
      const idealMeasurements = (idealNode as any).measurements || []
      const liveMeasurements = (liveNode as any).measurements || []
      for (const im of idealMeasurements) {
        const lm = liveMeasurements.find((m: any) => m.key === im.key)
        if (!lm) {
          console.log(`  ⚠ ${label} ${code}.measurements[${im.key}]: not found live — SKIPPED`)
          continue
        }
        const before = lm.byLaw ?? null
        const after = { ...(lm.byLaw ?? {}), ...(im.byLaw ?? {}) }
        if (stableStringify(before) !== stableStringify(after)) {
          console.log(`  ${label} ${code}.measurements[${im.key}].byLaw:\n    before: ${JSON.stringify(before)}\n    after:  ${JSON.stringify(after)}`)
          lm.byLaw = { ...(lm.byLaw ?? {}), ...(im.byLaw ?? {}) }
          rowChanges++
          totalTierPatches++
        }
      }
    }

    if (rowChanges > 0) {
      totalRowsTouched++
      if (apply) {
        await prisma.checklistTemplate.update({
          where: { id: row.id },
          data: { definition: liveDef as unknown as Prisma.InputJsonValue },
        })
        console.log(`  ✔ ${label} v3 (row ${row.id}, status ${row.status}): ${rowChanges} field(s) written`)
      } else {
        console.log(`  (dry run) ${label} v3 (row ${row.id}, status ${row.status}): ${rowChanges} field(s) would change`)
      }
    } else {
      console.log(`  ${label} v3: already up to date, no changes`)
    }
  }

  console.log(
    `\nSummary: ${totalLabelByLaw} labelByLaw field(s), ${totalTierPatches} measurement-byLaw field(s), ` +
      `${totalRowsTouched} row(s) ${apply ? 'updated' : 'would be updated'}.`,
  )
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
