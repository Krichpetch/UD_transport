// One-off, throwaway — reports which FACILITY_CATALOG type(s) the container-era-text session's
// committed changes (34 ramp labelByLaw entries + the parking tiered-measurement fix) landed on,
// by looking up each modified node's `facilityCode` directly off the LIVE DB definition (facility
// tagging happens at seed time via tagContainers/tagLeaves, not stored in the raw
// tools/checklist_json/template_*.json source — those come back untagged if read directly).
import { PrismaClient } from '@prisma/client'
import { FACILITY_CATALOG, STANDARD_VARIANT_KEY, RAIL_TRAIN_VARIANT_KEY, RAIL_METRO_VARIANT_KEY, type TemplateNode, type ChecklistTemplateDefinition } from '@repo/types'

const prisma = new PrismaClient()
const CATALOG_NAME = new Map(FACILITY_CATALOG.map((f) => [f.code, f.nameTh]))

const RAMP_CODES: Record<string, string[]> = {
  'ทางบก/standard': ['A2.2-1', 'B1.8-1', 'B6.10-1', 'A2.2-2', 'B1.8-2', 'B6.10-2'],
  'ทางน้ำ/standard': ['A1.1-1', 'B1.1-1', 'B4.1-1', 'A1.1-2', 'B1.1-2', 'B4.1-2'],
  'ทางอากาศ/standard': ['A2.1-1', 'B1.2-1', 'B2.10-1', 'B8.1-1', 'A2.1-2', 'B1.2-2', 'B2.10-2', 'B8.1-2'],
  'ทางราง/rail_train': ['A2.2-1', 'B2.7-1', 'B7.10-1', 'A2.2-2', 'B2.7-2', 'B7.10-2'],
  'ทางราง/rail_metro': ['A2.2-1', 'B1.1-1', 'B2.8-1', 'B7.10-1', 'A2.2-2', 'B1.1-2', 'B2.8-2', 'B7.10-2'],
}
const PARKING_CODES: Record<string, string> = {
  'ทางบก/standard': 'A1.1-1',
  'ทางอากาศ/standard': 'A1.1-1',
  'ทางราง/rail_train': 'A1.1-1',
  'ทางราง/rail_metro': 'A1.1-1',
}

const TARGETS = [
  { key: 'ทางบก/standard', mode: 'ทางบก', variantKey: STANDARD_VARIANT_KEY },
  { key: 'ทางน้ำ/standard', mode: 'ทางน้ำ', variantKey: STANDARD_VARIANT_KEY },
  { key: 'ทางอากาศ/standard', mode: 'ทางอากาศ', variantKey: STANDARD_VARIANT_KEY },
  { key: 'ทางราง/rail_train', mode: 'ทางราง', variantKey: RAIL_TRAIN_VARIANT_KEY },
  { key: 'ทางราง/rail_metro', mode: 'ทางราง', variantKey: RAIL_METRO_VARIANT_KEY },
]

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
  const tally = new Map<string, { count: number; codes: string[] }>()

  for (const t of TARGETS) {
    const row = await prisma.checklistTemplate.findUnique({
      where: { mode_variantKey_version: { mode: t.mode, variantKey: t.variantKey, version: 3 } },
    })
    if (!row) {
      console.log(`⚠ ${t.key}: no v3 row found`)
      continue
    }
    const idx = indexByCode(row.definition as unknown as ChecklistTemplateDefinition)

    for (const code of RAMP_CODES[t.key] ?? []) {
      const node = idx.get(code)
      const fc = (node as any)?.facilityCode
      console.log(`${t.key} ${code} (ramp text): facilityCode=${fc ?? 'NONE'} ${fc ? `(${CATALOG_NAME.get(fc)})` : ''} — "${node?.labelTh?.slice(0, 40)}"`)
      const label = fc ? `${fc} — ${CATALOG_NAME.get(fc)}` : 'UNTAGGED'
      if (!tally.has(label)) tally.set(label, { count: 0, codes: [] })
      tally.get(label)!.count++
      tally.get(label)!.codes.push(`${t.key}/${code}`)
    }

    const parkingCode = PARKING_CODES[t.key]
    if (parkingCode) {
      const node = idx.get(parkingCode)
      const fc = (node as any)?.facilityCode
      console.log(`${t.key} ${parkingCode} (parking tiers): facilityCode=${fc ?? 'NONE'} ${fc ? `(${CATALOG_NAME.get(fc)})` : ''} — "${node?.labelTh?.slice(0, 40)}"`)
      const label = fc ? `${fc} — ${CATALOG_NAME.get(fc)}` : 'UNTAGGED'
      if (!tally.has(label)) tally.set(label, { count: 0, codes: [] })
      tally.get(label)!.count++
      tally.get(label)!.codes.push(`${t.key}/${parkingCode} (parking)`)
    }
  }

  console.log('\n=== TALLY BY FACILITY TYPE ===')
  for (const [label, { count }] of tally) {
    console.log(`  ${label}: ${count}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
