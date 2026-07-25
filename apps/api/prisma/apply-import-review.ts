// Station masterlist cutover, import hardening (Task B3) — consumes a human-filled-in
// import_reconciliation_{source}_{date}.csv (see src/stations/import-reconciliation.ts) and
// applies each decided row's ORIGINAL payload (from the sidecar import_pending_{source}_{date}.json
// batchOtpImport wrote alongside the CSV) to the station the human decided on. Never inserts a
// station — 'accept' confirms the CSV's own best-guess matchedStationId (a REVIEW row always has
// one; MATCHED_FUZZY rows are auto-applied already and never appear here); 'map_to:<id>'
// overrides it with an explicit station id.
//
// Usage:
//   npx ts-node prisma/apply-import-review.ts --review-csv <path> --payloads <path> --admin-id <id>
import { PrismaClient } from '@prisma/client'
import * as fs from 'fs'
import { parseReviewDecisions, readPendingPayloads, type ReviewDecision } from '../src/stations/import-reconciliation'
import { applyOtpRowToStation, type ImportOtpTxClient, type ResolvedStation } from '../src/stations/import-otp-row'
import type { OtpRowDto } from '../src/stations/dto/otp-row.dto'

export interface ApplyReviewClient {
  station: {
    findUnique(args: unknown): Promise<ResolvedStation | null>
  }
  checklist: {
    findFirst(args: unknown): Promise<{ id: string; stationId: string } | null>
  }
  $transaction<T>(fn: (tx: ImportOtpTxClient) => Promise<T>): Promise<T>
}

export interface ApplyReviewResult {
  index: number
  outcome: 'applied' | 'skipped_no_target' | 'error'
  detail?: string
}

function resolveTargetStationId(decision: ReviewDecision['decision'], csvMatchedStationId: string | null): string | null {
  if (decision === 'accept') return csvMatchedStationId
  return decision.mapToStationId
}

export async function applyReviewDecisions(
  client: ApplyReviewClient,
  reviewCsv: string,
  pendingPayloads: Array<{ index: number; row: OtpRowDto }>,
  csvMatchedStationIds: Map<number, string | null>,
  adminId: string,
): Promise<ApplyReviewResult[]> {
  const decisions = parseReviewDecisions(reviewCsv)
  const payloadByIndex = new Map(pendingPayloads.map((p) => [p.index, p.row]))
  const results: ApplyReviewResult[] = []

  for (const d of decisions) {
    const row = payloadByIndex.get(d.index)
    const targetId = resolveTargetStationId(d.decision, csvMatchedStationIds.get(d.index) ?? null)
    if (!row || !targetId) {
      results.push({ index: d.index, outcome: 'skipped_no_target', detail: !row ? 'no cached payload for this row' : 'no target station id' })
      continue
    }
    try {
      const station = await client.station.findUnique({ where: { id: targetId } })
      if (!station) {
        results.push({ index: d.index, outcome: 'skipped_no_target', detail: `station ${targetId} not found` })
        continue
      }
      const auditDate = new Date(row.lastInspected)
      const existing = await client.checklist.findFirst({
        where: { stationId: station.id, status: 'APPROVED' },
      })
      await client.$transaction((tx) => applyOtpRowToStation(tx, station, row, adminId, existing ?? undefined))
      results.push({ index: d.index, outcome: 'applied' })
    } catch (err) {
      results.push({ index: d.index, outcome: 'error', detail: err instanceof Error ? err.message : String(err) })
    }
  }
  return results
}

function parseCsvMatchedStationIds(csvContent: string): Map<number, string | null> {
  const lines = csvContent.split(/\r?\n/).filter((l) => l.length > 0)
  const map = new Map<number, string | null>()
  if (lines.length === 0) return map
  const header = lines[0]!.split(',')
  const indexCol = header.indexOf('index')
  const matchedCol = header.indexOf('matchedStationId')
  for (const line of lines.slice(1)) {
    const fields = line.split(',')
    const index = Number(fields[indexCol])
    const matched = fields[matchedCol] || null
    map.set(index, matched)
  }
  return map
}

async function main() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const i = args.indexOf(flag)
    return i >= 0 ? args[i + 1] : undefined
  }
  const reviewCsvPath = get('--review-csv')
  const payloadsPath = get('--payloads')
  const adminId = get('--admin-id')
  if (!reviewCsvPath || !payloadsPath || !adminId) {
    console.error('Usage: apply-import-review.ts --review-csv <path> --payloads <path> --admin-id <id>')
    process.exitCode = 1
    return
  }

  const reviewCsv = fs.readFileSync(reviewCsvPath, 'utf-8')
  const pendingPayloads = readPendingPayloads(payloadsPath) as Array<{ index: number; row: OtpRowDto }>
  const csvMatchedStationIds = parseCsvMatchedStationIds(reviewCsv)

  const prisma = new PrismaClient()
  try {
    const results = await applyReviewDecisions(
      prisma as unknown as ApplyReviewClient, reviewCsv, pendingPayloads, csvMatchedStationIds, adminId,
    )
    for (const r of results) console.log(`row ${r.index}: ${r.outcome}${r.detail ? ` (${r.detail})` : ''}`)
    console.log(`\n${results.filter((r) => r.outcome === 'applied').length}/${results.length} decisions applied`)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exitCode = 1 })
}
