/**
 * One-off data migration (Session S4a follow-up, 2026-08-10) — converts already-stored slope
 * answers from the pre-redesign length/height (run/rise) capture convention to the new rise/
 * hypotenuse convention (see @repo/types#ratioRiseKey/ratioHypotenuseKey). Purely additive:
 * computes hypotenuse = sqrt(length² + height²) via Pythagoras — length WAS the horizontal run
 * and height WAS the vertical rise, so this is an EXACT geometric conversion of the same physical
 * triangle, not an approximation — and writes rise/hypotenuse alongside the untouched original
 * length/height keys. Nothing is deleted: deriveMeasuredStandard's legacy fallback still reads
 * length/height directly if this migration is ever skipped for a row.
 *
 * Scope: every Checklist row, not just rail_metro v3 — the `__length`/`__height` key-suffix
 * pattern is unique to the slope convention app-wide (ratioLengthKey/ratioHeightKey are its only
 * producers), so this is a safe blind pattern match on the stored JSON; no template lookup needed.
 *
 * Dry-run by default. Pass --confirm to write.
 *
 *   ts-node prisma/migrate-slope-rise-hypotenuse.ts [--confirm]
 */
import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()

interface StoredNode {
  id?: string
  values?: Record<string, number>
  subItems?: StoredNode[]
  [k: string]: unknown
}
interface StoredGroup {
  items: StoredNode[]
}

const LENGTH_SUFFIX = '__length'
const HEIGHT_SUFFIX = '__height'
const RISE_SUFFIX = '__rise'
const HYPOTENUSE_SUFFIX = '__hypotenuse'

interface ConversionResult {
  converted: number
  skippedAlreadyPresent: number
  skippedInvalid: number
}

function convertNode(node: StoredNode, checklistLabel: string, result: ConversionResult): void {
  if (node.values) {
    const values = node.values
    for (const key of Object.keys(values)) {
      if (!key.endsWith(LENGTH_SUFFIX)) continue
      const base = key.slice(0, -LENGTH_SUFFIX.length)
      const heightKey = `${base}${HEIGHT_SUFFIX}`
      const riseKey = `${base}${RISE_SUFFIX}`
      const hypotenuseKey = `${base}${HYPOTENUSE_SUFFIX}`
      if (values[heightKey] === undefined) continue // a __length key with no matching __height isn't a slope pair

      if (values[riseKey] !== undefined || values[hypotenuseKey] !== undefined) {
        result.skippedAlreadyPresent++
        continue
      }

      const length = values[key]
      const height = values[heightKey]
      if (typeof length !== 'number' || typeof height !== 'number' || length <= 0 || height < 0) {
        result.skippedInvalid++
        console.log(`  ⚠ ${checklistLabel} node=${node.id} — invalid length/height (${length}/${height}), skipped`)
        continue
      }

      const hypotenuse = Math.round(Math.sqrt(length * length + height * height))
      values[riseKey] = height
      values[hypotenuseKey] = hypotenuse
      result.converted++
      console.log(`  ${checklistLabel} node=${node.id} — length=${length} height=${height} -> rise=${height} hypotenuse=${hypotenuse}`)
    }
  }
  node.subItems?.forEach((c) => convertNode(c, checklistLabel, result))
}

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm')
  console.log(`TARGET -> ${(process.env.DATABASE_URL ?? '').replace(/(:\/\/[^:]+:)[^@]+@/, '$1***@')}`)
  console.log(confirm ? 'MODE   -> WRITE (--confirm given)\n' : 'MODE   -> DRY RUN (no writes; pass --confirm to apply)\n')

  const checklists = await prisma.checklist.findMany({
    include: { station: { select: { nameTh: true } } },
  })

  let totalConverted = 0
  let rowsAffected = 0
  for (const cl of checklists) {
    const groups = cl.items as unknown as StoredGroup[]
    if (!Array.isArray(groups)) continue
    const label = `[${cl.status}] ${cl.station.nameTh} (${cl.id})`
    const result: ConversionResult = { converted: 0, skippedAlreadyPresent: 0, skippedInvalid: 0 }
    for (const g of groups) g.items?.forEach((it) => convertNode(it, label, result))

    if (result.converted === 0) continue
    rowsAffected++
    totalConverted += result.converted
    console.log(
      `${label} — ${result.converted} slope value(s) converted` +
        (result.skippedAlreadyPresent ? `, ${result.skippedAlreadyPresent} already had rise/hypotenuse` : ''),
    )

    if (confirm) {
      await prisma.checklist.update({
        where: { id: cl.id },
        data: { items: groups as unknown as Prisma.InputJsonValue },
      })
    }
  }

  console.log(`\n${confirm ? 'Updated' : 'Would update'} ${rowsAffected} checklist(s), ${totalConverted} slope value(s) total.`)
  if (!confirm) console.log('Re-run with --confirm to apply.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
