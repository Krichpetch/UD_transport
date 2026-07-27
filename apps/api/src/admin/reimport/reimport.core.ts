// Part F (W2-S1) — pure matching/import logic, independent of NestJS DI so it can run both
// through ReimportService (the ADMIN-only dry-run-gated endpoint) and the standalone script
// (prisma/reimport-legacy-checklists.ts, ts-node, same style as prisma/seed.ts's plain
// PrismaClient usage) without duplicating the logic between them.
import * as path from 'path'
import type { PrismaClient } from '@prisma/client'
import { computeScoreFromItems, scoreToStatus } from '../../checklists/scoring'
import { STANDARD_VARIANT_KEY } from '@repo/types'
import { resolveStationMatch, type MasterlistStation } from '../../stations/masterlist-match'
import { writeReconciliationCsv, type ReconciliationRow } from '../../stations/import-reconciliation'
import nameCorrections from './name-corrections.json'
import type { LegacyChecklistExportRow, ReimportRowResult, ReimportReport } from './legacy-checklist.types'

const CHUNK_SIZE = 50
const IMPORT_ACTION = 'IMPORT_HISTORICAL'
const IMPORT_REPORTS_DIR = path.resolve(__dirname, '..', '..', '..', 'import-reports')

function toJson(value: unknown) {
  return value as never
}

function normalizeName(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ')
  return (nameCorrections as Record<string, string>)[trimmed] ?? trimmed
}

export interface ReimportOptions {
  adminId: string
  dryRun: boolean
}

// Chunked (fixed CHUNK_SIZE, same shape as StationsService.batchOtpImport): one candidate-
// station findMany per chunk, per-row $transaction so one bad row never poisons the batch.
// Idempotent via a single upfront AuditLog scan (IMPORT_HISTORICAL rows' `before.sourceId`) —
// re-running against the same export skips every already-imported row. Never creates a
// Station (masterlist is closed, same rule as batchOtpImport) — REVIEW/NOT_ON_MASTERLIST rows
// are reported in a reconciliation CSV, never guessed.
export async function runLegacyReimport(
  prisma: PrismaClient,
  rows: LegacyChecklistExportRow[],
  opts: ReimportOptions,
): Promise<ReimportReport> {
  const results: ReimportRowResult[] = new Array(rows.length)
  const reconciliation: ReconciliationRow[] = []

  const priorImports = await prisma.auditLog.findMany({
    where: { action: IMPORT_ACTION, entityType: 'Checklist' },
    select: { before: true },
  })
  const alreadyImported = new Set<string>()
  for (const log of priorImports) {
    const before = log.before as { sourceId?: string } | null
    if (before?.sourceId) alreadyImported.add(before.sourceId)
  }

  // Only 3 users exist (per seed.ts) — resolved once, not per chunk.
  const users = await prisma.user.findMany({ select: { id: true, username: true } })
  const userByUsername = new Map(users.map((u) => [u.username, u.id]))

  // ACTIVE template per mode, cached — legacy rows are all flat/v1 (variantKey 'standard'), so
  // at most one lookup per TransportMode present in the export, regardless of row count.
  const templateCache = new Map<string, { id: string; version: number } | null>()
  async function getActiveTemplate(mode: string) {
    if (templateCache.has(mode)) return templateCache.get(mode) ?? null
    const tpl = await prisma.checklistTemplate.findFirst({
      where: { mode, variantKey: STANDARD_VARIANT_KEY, status: 'ACTIVE' },
      select: { id: true, version: true },
    })
    templateCache.set(mode, tpl)
    return tpl
  }

  // Accumulated in-memory (not read-then-write per row against a stale per-chunk snapshot) so
  // multiple historical rows for the same station — possibly spanning several chunks — always
  // settle on the single truly-latest APPROVED inspection, then written once per station at the
  // end. Seeded lazily from each station's current DB lastInspected the first time it's seen.
  const stationCacheUpdate = new Map<string, { score: number; status: string; lastInspected: Date }>()
  const stationSeeded = new Map<string, Date | null>()

  for (let chunkStart = 0; chunkStart < rows.length; chunkStart += CHUNK_SIZE) {
    const chunk = rows.slice(chunkStart, chunkStart + CHUNK_SIZE)
    const modesInChunk = [...new Set(chunk.map((r) => r.station.mode))]
    const masterlistStations = await prisma.station.findMany({
      where: { mode: { in: modesInChunk } },
      select: { id: true, mode: true, nameTh: true, line: true, lastInspected: true },
    })
    for (const s of masterlistStations) {
      if (!stationSeeded.has(s.id)) stationSeeded.set(s.id, s.lastInspected)
    }
    const candidates: MasterlistStation[] = masterlistStations.map((s) => ({
      id: s.id, mode: s.mode, nameTh: s.nameTh, line: s.line,
    }))

    for (let i = 0; i < chunk.length; i++) {
      const row = chunk[i]!
      const rowIndex = chunkStart + i
      const nameTh = normalizeName(row.station.nameTh)

      if (alreadyImported.has(row.sourceId)) {
        results[rowIndex] = { sourceId: row.sourceId, nameTh, index: rowIndex, skipped: { reason: 'ALREADY_IMPORTED' } }
        continue
      }

      const match = resolveStationMatch({ mode: row.station.mode, nameTh }, candidates)
      if (match.status === 'REVIEW' || match.status === 'NOT_ON_MASTERLIST') {
        results[rowIndex] = { sourceId: row.sourceId, nameTh, index: rowIndex, skipped: { reason: match.status } }
        reconciliation.push({
          index: rowIndex, nameTh, mode: row.station.mode, line: '',
          tier: match.tier, status: match.status,
          matchedStationId: match.matchedStation?.id ?? null, score: match.score,
        })
        continue
      }

      const auditorId = userByUsername.get(row.auditorUsername)
      if (!auditorId) {
        results[rowIndex] = {
          sourceId: row.sourceId, nameTh, index: rowIndex,
          skipped: { reason: 'AUDITOR_NOT_FOUND', detail: row.auditorUsername },
        }
        continue
      }

      const template = await getActiveTemplate(row.station.mode)
      if (!template) {
        results[rowIndex] = { sourceId: row.sourceId, nameTh, index: rowIndex, skipped: { reason: 'NO_ACTIVE_TEMPLATE' } }
        continue
      }

      const stationId = match.matchedStation!.id
      const score = computeScoreFromItems(row.items)
      const status = scoreToStatus(score)
      const submittedAt = row.submittedAt ? new Date(row.submittedAt) : null

      if (opts.dryRun) {
        results[rowIndex] = { sourceId: row.sourceId, nameTh, index: rowIndex, imported: { checklistId: '(dry-run)', stationId } }
        continue
      }

      try {
        const checklist = await prisma.checklist.create({
          data: {
            stationId,
            auditorId,
            items: toJson(row.items),
            score,
            status: row.status,
            submittedAt,
            createdAt: new Date(row.createdAt),
            reviewedAt: row.reviewedAt ? new Date(row.reviewedAt) : null,
            reviewNotes: row.reviewNotes ?? null,
            templateId: template.id,
            templateVersion: template.version,
          },
        })
        await prisma.auditLog.create({
          data: {
            userId: opts.adminId,
            action: IMPORT_ACTION,
            entityType: 'Checklist',
            entityId: checklist.id,
            before: { sourceId: row.sourceId },
          },
        })

        if (row.status === 'APPROVED' && submittedAt) {
          const currentBest = stationCacheUpdate.get(stationId)?.lastInspected ?? stationSeeded.get(stationId) ?? null
          if (!currentBest || submittedAt > currentBest) {
            stationCacheUpdate.set(stationId, { score, status, lastInspected: submittedAt })
          }
        }

        results[rowIndex] = { sourceId: row.sourceId, nameTh, index: rowIndex, imported: { checklistId: checklist.id, stationId } }
      } catch (err) {
        results[rowIndex] = { sourceId: row.sourceId, nameTh, index: rowIndex, error: err instanceof Error ? err.message : 'unknown error' }
      }
    }
  }

  if (!opts.dryRun) {
    for (const [stationId, update] of stationCacheUpdate) {
      await prisma.station.update({ where: { id: stationId }, data: update })
    }
  }

  let reconciliationCsvPath: string | undefined
  if (!opts.dryRun && reconciliation.length > 0) {
    reconciliationCsvPath = writeReconciliationCsv('legacy-reimport', reconciliation, IMPORT_REPORTS_DIR)
  }

  return { dryRun: opts.dryRun, results, reconciliationCsvPath }
}
