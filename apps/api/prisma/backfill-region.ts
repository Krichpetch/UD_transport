// Session E4 — the station masterlist cutover (tools/station-masterlist/convert_masterlist.py)
// seeds every station with region: null ("derived downstream" per that script's own comment),
// and nothing ever ran that downstream step. This one-time backfill computes it for every
// station currently missing it, via the same @repo/types#deriveRegion priority order the
// create/update hooks use going forward (StationsService.create/update):
//   1. Coordinates present  → nearest province centroid → that province's region
//   2. No coordinates, but a recognisable province → PROVINCE_REGION lookup
//   3. Neither → left null (the region filter surfaces this as "ไม่ระบุ")
//
// Idempotent: only touches rows where region IS NULL, so re-running after fixing more
// province/coordinate data only fills in the newly-derivable rows — it never overwrites a
// region a human (or a later derivation) has already set.
//
// Usage: npx ts-node prisma/backfill-region.ts
import { PrismaClient } from '@prisma/client'
import { deriveRegion } from '@repo/types'

export interface BackfillResult {
  updated: number
  stillNull: number
  regionCounts: Record<string, number>
}

export interface BackfillClient {
  station: {
    findMany(args: unknown): Promise<Array<{ id: string; lat: number | null; lng: number | null; province: string | null }>>
    update(args: unknown): Promise<unknown>
  }
}

export async function backfillRegion(client: BackfillClient): Promise<BackfillResult> {
  const stations = await client.station.findMany({
    where: { region: null },
    select: { id: true, lat: true, lng: true, province: true },
  })

  const regionCounts: Record<string, number> = {}
  let updated = 0
  let stillNull = 0

  for (const station of stations) {
    const region = deriveRegion(station)
    if (region == null) {
      stillNull++
      continue
    }
    await client.station.update({ where: { id: station.id }, data: { region } })
    updated++
    regionCounts[region] = (regionCounts[region] ?? 0) + 1
  }

  return { updated, stillNull, regionCounts }
}

async function main() {
  const prisma = new PrismaClient()
  try {
    const result = await backfillRegion(prisma as unknown as BackfillClient)
    console.log(`Updated ${result.updated} station(s):`)
    for (const [region, count] of Object.entries(result.regionCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${region}: ${count}`)
    }
    console.log(`ไม่ระบุ (neither coordinates nor a recognisable province): ${result.stillNull}`)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exitCode = 1 })
}
