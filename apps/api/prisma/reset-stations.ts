// Station masterlist cutover — guarded reset + reseed. Merged_Station_Coordinates_V2.xlsx (via
// tools/station-masterlist/convert_masterlist.py -> prisma/seed-data/stations_master_v2.json) is
// now the ONLY source of station master data. This command replaces every Station row with the
// masterlist's 823 rows, upserted by (mode, nameTh, line) so it's safe to re-run.
//
// Deleting stations cascades to (and here, explicitly precedes deleting) their Checklist rows —
// there is no ON DELETE CASCADE in the schema (Checklist.station has no onDelete override, so
// Prisma's default is Restrict), so Checklist rows are deleted first, inside the same
// transaction, in dependency order.
//
// Usage:
//   npx ts-node prisma/reset-stations.ts --confirm            # refuses if SUBMITTED/APPROVED checklists exist
//   npx ts-node prisma/reset-stations.ts --confirm --force     # deletes them anyway
//
// Every run (that gets past the guards) writes a timestamped JSON backup of the current
// stations + checklists to apps/api/backups/ (gitignored) BEFORE deleting anything.

import { PrismaClient, ChecklistStatus } from '@prisma/client'
import * as fs from 'fs'
import * as path from 'path'

export interface StationRecord {
  sourceRow: number
  mode: string
  name: string
  nameTh: string
  line: string
  stationType: string
  railSubtype: string | null
  province: string | null
  region: string | null
  responsibleAgency: string
  lat: number | null
  lng: number | null
  coordSource: string
  coordStatus: string
  coordMatchStatus: string | null
  matchedNameFile2: string | null
}

// Statuses that represent real completed work — never silently discarded by a masterlist reset.
const PROTECTED_CHECKLIST_STATUSES: ChecklistStatus[] = ['SUBMITTED', 'APPROVED']

export interface ResetSummary {
  stationCount: number
  checklistsByStatus: Record<string, number>
  auditLogCount: number
}

// Minimal shape of the Prisma client this module needs — lets tests pass a plain mock instead
// of a live PrismaClient (a real DB's transactional rollback isn't observable through a mock
// anyway; see apps/api/src/stations/__tests__/batch-otp-transaction.spec.ts for the same
// project-wide convention: verify every write goes through the tx-scoped client).
export interface ResetPrismaClient {
  station: {
    count(): Promise<number>
    findMany(args?: unknown): Promise<unknown[]>
    deleteMany(args?: unknown): Promise<unknown>
    upsert(args: unknown): Promise<unknown>
  }
  checklist: {
    count(args?: unknown): Promise<number>
    groupBy(args: unknown): Promise<Array<{ status: string; _count: { _all: number } }>>
    findMany(args?: unknown): Promise<unknown[]>
    deleteMany(args?: unknown): Promise<unknown>
  }
  auditLog: {
    count(args?: unknown): Promise<number>
  }
  $transaction<T>(fn: (tx: ResetPrismaClient) => Promise<T>): Promise<T>
}

export async function getResetSummary(prisma: ResetPrismaClient): Promise<ResetSummary> {
  const [stationCount, statusGroups, auditLogCount] = await Promise.all([
    prisma.station.count(),
    prisma.checklist.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.auditLog.count({ where: { entityType: 'Station' } }),
  ])
  const checklistsByStatus: Record<string, number> = {}
  for (const g of statusGroups) checklistsByStatus[g.status] = g._count._all
  return { stationCount, checklistsByStatus, auditLogCount }
}

export function hasProtectedChecklists(summary: ResetSummary): boolean {
  return PROTECTED_CHECKLIST_STATUSES.some((s) => (summary.checklistsByStatus[s] ?? 0) > 0)
}

export function formatSummary(summary: ResetSummary): string {
  const lines = [
    `Stations:   ${summary.stationCount}`,
    `AuditLog rows referencing a Station: ${summary.auditLogCount}`,
    `Checklists by status:`,
  ]
  const statuses = Object.keys(summary.checklistsByStatus)
  if (statuses.length === 0) lines.push('  (none)')
  for (const s of statuses) lines.push(`  ${s}: ${summary.checklistsByStatus[s]}`)
  return lines.join('\n')
}

export async function writeBackup(prisma: ResetPrismaClient, backupDir: string): Promise<string> {
  const [stations, checklists] = await Promise.all([
    prisma.station.findMany(),
    prisma.checklist.findMany(),
  ])
  fs.mkdirSync(backupDir, { recursive: true })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `reset-stations-${timestamp}.json`)
  fs.writeFileSync(backupPath, JSON.stringify({ stations, checklists }, null, 2))
  return backupPath
}

/**
 * Deletes every Checklist then every Station, then upserts the masterlist rows — all inside one
 * transaction, so a mid-run failure (e.g. a malformed masterlist row) leaves the DB exactly as
 * it was before this command ran, not half-deleted.
 */
export async function resetAndSeed(
  prisma: ResetPrismaClient,
  stations: StationRecord[],
): Promise<{ deletedChecklists: number; deletedStations: number; seeded: number }> {
  return prisma.$transaction(async (tx) => {
    const deletedChecklists = await tx.checklist.deleteMany({}) as { count: number }
    const deletedStations = await tx.station.deleteMany({}) as { count: number }

    let seeded = 0
    for (const s of stations) {
      await tx.station.upsert({
        where: { mode_nameTh_line: { mode: s.mode, nameTh: s.nameTh, line: s.line } },
        update: {
          name: s.name,
          stationType: s.stationType,
          railSubtype: s.railSubtype,
          province: s.province,
          region: s.region,
          responsibleAgency: s.responsibleAgency,
          lat: s.lat,
          lng: s.lng,
          coordSource: s.coordSource,
          coordStatus: s.coordStatus,
          coordMatchStatus: s.coordMatchStatus,
          matchedNameFile2: s.matchedNameFile2,
        },
        create: {
          mode: s.mode,
          name: s.name,
          nameTh: s.nameTh,
          line: s.line,
          stationType: s.stationType,
          railSubtype: s.railSubtype,
          province: s.province,
          region: s.region,
          responsibleAgency: s.responsibleAgency,
          lat: s.lat,
          lng: s.lng,
          coordSource: s.coordSource,
          coordStatus: s.coordStatus,
          coordMatchStatus: s.coordMatchStatus,
          matchedNameFile2: s.matchedNameFile2,
          urgentIssues: [],
        },
      })
      seeded++
    }

    return {
      deletedChecklists: deletedChecklists.count,
      deletedStations: deletedStations.count,
      seeded,
    }
  })
}

const BACKUP_DIR = path.resolve(__dirname, '..', 'backups')
const STATIONS_JSON_PATH = path.resolve(__dirname, 'seed-data', 'stations_master_v2.json')

export async function run(prisma: ResetPrismaClient, argv: string[]): Promise<void> {
  const confirm = argv.includes('--confirm')
  const force = argv.includes('--force')

  const summary = await getResetSummary(prisma)
  console.log(formatSummary(summary))

  if (!confirm) {
    console.error('\nRefusing to run without --confirm. Nothing was changed.')
    process.exitCode = 1
    return
  }

  if (hasProtectedChecklists(summary) && !force) {
    console.error(
      '\nRefusing: SUBMITTED/APPROVED checklists exist and would be deleted along with their ' +
      'stations. Pass --force to proceed anyway. Nothing was changed.',
    )
    process.exitCode = 1
    return
  }

  const backupPath = await writeBackup(prisma, BACKUP_DIR)
  console.log(`\nBackup written: ${backupPath}`)

  const stations: StationRecord[] = JSON.parse(fs.readFileSync(STATIONS_JSON_PATH, 'utf-8'))
  const result = await resetAndSeed(prisma, stations)
  console.log(
    `\nDeleted ${result.deletedChecklists} checklists, ${result.deletedStations} stations. ` +
    `Seeded ${result.seeded} stations from stations_master_v2.json.`,
  )
}

if (require.main === module) {
  const prisma = new PrismaClient()
  run(prisma as unknown as ResetPrismaClient, process.argv.slice(2))
    .catch((e) => { console.error(e); process.exitCode = 1 })
    .finally(() => prisma.$disconnect())
}
