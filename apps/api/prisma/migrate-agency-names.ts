// Session F2, Part D — renames Station.responsibleAgency / User.agency values from the old
// bare-abbreviation RESPONSIBLE_AGENCIES list to the new canonical "full name (abbreviation)"
// list (@repo/types#RESPONSIBLE_AGENCIES). The 11 old values map 1:1 onto the 11 new ones (see
// LEGACY_AGENCY_MAP below). Any OTHER value found in the data (an OTP-import free-text agency
// that never went through LEGACY_AGENCY_MAP, a typo, pre-validation legacy data, etc.) falls
// back to OTHER_AGENCY ('หน่วยงานอื่นที่เกี่ยวข้อง') — per instruction, those unmapped values
// must be reviewed (value + row count) before being absorbed, so this script is a DRY RUN by
// default and only writes when passed --apply.
//
// Usage:
//   npx ts-node prisma/migrate-agency-names.ts            (report only, no writes)
//   npx ts-node prisma/migrate-agency-names.ts --apply     (applies the renames)
//
// Idempotent: a second run after --apply finds nothing left to migrate (every row already
// equals its own target value, so buildPlan's oldValue !== newValue filter drops it).
import { PrismaClient } from '@prisma/client'
import { OTHER_AGENCY, RESPONSIBLE_AGENCIES } from '@repo/types'

const CANONICAL_VALUES: readonly string[] = RESPONSIBLE_AGENCIES

export const LEGACY_AGENCY_MAP: Record<string, string> = {
  'ขบ.':   'กรมการขนส่งทางบก (ขบ.)',
  'ขสมก.': 'องค์การขนส่งมวลชนกรุงเทพ (ขสมก.)',
  'บขส.':  'บริษัท ขนส่ง จำกัด (บขส.)',
  'รฟท.':  'การรถไฟแห่งประเทศไทย (รฟท.)',
  'รฟม.':  'การรถไฟฟ้าขนส่งมวลชนแห่งประเทศไทย (รฟม.)',
  'รฟฟท.': 'บริษัท รถไฟฟ้า ร.ฟ.ท. จำกัด (รฟฟท.)',
  'BEM':   'ผู้ให้บริการรถไฟฟ้า (เช่น BEM)',
  'จท.':   'กรมเจ้าท่า (จท.)',
  'ทย.':   'กรมท่าอากาศยาน (ทย.)',
  'ทอท.':  'บริษัท ท่าอากาศยานไทย จำกัด (มหาชน) (ทอท.)',
  // BEM's actual legal name, as it appears in the masterlist source (821-row seed data) — a
  // confident match to the "private rail operator" bucket, unlike the other masterlist-sourced
  // operator names (BTS, Northern/Eastern Bangkok Monorail, Asia Era One) which were reviewed
  // and confirmed to fall to OTHER_AGENCY instead (2026-08-01).
  'บริษัท ทางด่วนและรถไฟฟ้ากรุงเทพ จำกัด (มหาชน)': 'ผู้ให้บริการรถไฟฟ้า (เช่น BEM)',
  'อื่นๆ': OTHER_AGENCY,
}

export interface AgencyPlanRow {
  oldValue: string
  newValue: string
  count: number
  // false => oldValue wasn't one of the 11 known legacy values; fell back to OTHER_AGENCY.
  confident: boolean
}

export interface AgencyMigrationPlan {
  stationRows: AgencyPlanRow[]
  userRows: AgencyPlanRow[]
}

export interface MigrationClient {
  station: {
    findMany(args: { select: { responsibleAgency: true } }): Promise<{ responsibleAgency: string }[]>
    updateMany(args: { where: { responsibleAgency: string }; data: { responsibleAgency: string } }): Promise<{ count: number }>
  }
  user: {
    findMany(args: { select: { agency: true } }): Promise<{ agency: string | null }[]>
    updateMany(args: { where: { agency: string }; data: { agency: string } }): Promise<{ count: number }>
  }
}

function countByValue(values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return counts
}

function buildPlan(counts: Map<string, number>): AgencyPlanRow[] {
  return [...counts.entries()]
    // A value that's already one of the 11 canonical strings (e.g. a re-run after --apply)
    // needs no action — checked BEFORE the legacy-map lookup, since LEGACY_AGENCY_MAP only
    // has the OLD bare abbreviations as keys and would otherwise treat an already-migrated
    // value as "unmapped" and incorrectly route it to OTHER_AGENCY.
    .filter(([oldValue]) => !CANONICAL_VALUES.includes(oldValue))
    .map(([oldValue, count]) => {
      const mapped = LEGACY_AGENCY_MAP[oldValue]
      return { oldValue, newValue: mapped ?? OTHER_AGENCY, count, confident: mapped !== undefined }
    })
    .sort((a, b) => b.count - a.count)
}

export async function planAgencyMigration(client: MigrationClient): Promise<AgencyMigrationPlan> {
  const [stations, users] = await Promise.all([
    client.station.findMany({ select: { responsibleAgency: true } }),
    client.user.findMany({ select: { agency: true } }),
  ])
  const stationCounts = countByValue(stations.map((s) => s.responsibleAgency))
  const userCounts = countByValue(users.map((u) => u.agency).filter((a): a is string => a != null))
  return { stationRows: buildPlan(stationCounts), userRows: buildPlan(userCounts) }
}

export async function applyAgencyMigration(client: MigrationClient, plan: AgencyMigrationPlan): Promise<void> {
  for (const row of plan.stationRows) {
    await client.station.updateMany({ where: { responsibleAgency: row.oldValue }, data: { responsibleAgency: row.newValue } })
  }
  for (const row of plan.userRows) {
    await client.user.updateMany({ where: { agency: row.oldValue }, data: { agency: row.newValue } })
  }
}

function printRows(label: string, rows: AgencyPlanRow[]) {
  console.log(`=== ${label} ===`)
  if (rows.length === 0) {
    console.log('  (nothing to migrate)')
    return
  }
  for (const row of rows) {
    const flag = row.confident ? '' : '  [UNMAPPED -> falls back to OTHER_AGENCY, REVIEW]'
    console.log(`  ${String(row.count).padStart(5)}  "${row.oldValue}" -> "${row.newValue}"${flag}`)
  }
}

async function main() {
  const apply = process.argv.includes('--apply')
  const prisma = new PrismaClient()
  try {
    const plan = await planAgencyMigration(prisma as unknown as MigrationClient)
    printRows('Station.responsibleAgency', plan.stationRows)
    printRows('User.agency', plan.userRows)

    const hasUnmapped = [...plan.stationRows, ...plan.userRows].some((r) => !r.confident)
    if (hasUnmapped) {
      console.log('\nSome values above are UNMAPPED and will fall back to OTHER_AGENCY — review before --apply.')
    }

    if (!apply) {
      console.log('\nDry run only — no writes made. Re-run with --apply to write these changes.')
      return
    }
    await applyAgencyMigration(prisma as unknown as MigrationClient, plan)
    console.log('\nApplied.')
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exitCode = 1 })
}
