// Station masterlist cutover, import hardening (Task B3) — the write-side core of applying one
// already-resolved OTP row to an EXISTING station. Never creates a station: the masterlist is
// closed, callers (StationsService.batchOtpImport for the live path, prisma/apply-import-review.ts
// for the CSV decision-replay path) are responsible for resolving a row to a masterlist station
// id via resolveStationMatch() BEFORE calling this. Extracted out of StationsService so both
// callers share one write path instead of two copies drifting apart.
import { computeScoreFromItems, scoreToStatus } from '../checklists/scoring'

export interface ImportableChecklistRow {
  items: object[]
  score: number
  lastInspected: string
  responsibleAgency?: string
}

export interface ResolvedStation {
  id: string
  nameTh: string
  responsibleAgency: string
  lastInspected: Date | null
}

// Structural subset of a Prisma transaction client this needs — lets tests pass a plain mock.
export interface ImportOtpTxClient {
  station: {
    update(args: unknown): Promise<{ responsibleAgency: string }>
  }
  checklist: {
    update(args: unknown): Promise<unknown>
    create(args: unknown): Promise<{ id: string }>
  }
}

function toJson(value: unknown) {
  return value as never
}

/**
 * Applies one row's checklist data to an already-resolved station: creates or updates the
 * (station, year) checklist, re-derives score/status from items (never trusts a client-supplied
 * score), and refreshes the station's cached score/status/lastInspected only if this row is the
 * most recent inspection seen so far. Prefers a real agency over a stale 'อื่นๆ' fallback.
 */
export async function applyOtpRowToStation(
  tx: ImportOtpTxClient,
  station: ResolvedStation,
  row: ImportableChecklistRow,
  auditorId: string,
  existingChecklist: { id: string; stationId: string } | undefined,
): Promise<{ id: string; nameTh: string }> {
  const auditDate = new Date(row.lastInspected)
  const importedScore = computeScoreFromItems(row.items)
  const importedStatus = scoreToStatus(importedScore)

  if (
    row.responsibleAgency &&
    station.responsibleAgency === 'อื่นๆ' &&
    row.responsibleAgency !== 'อื่นๆ'
  ) {
    await tx.station.update({
      where: { id: station.id },
      data: { responsibleAgency: row.responsibleAgency },
    })
  }

  if (existingChecklist) {
    await tx.checklist.update({
      where: { id: existingChecklist.id },
      data: { items: toJson(row.items), score: importedScore },
    })
  } else {
    await tx.checklist.create({
      data: {
        stationId: station.id,
        auditorId,
        items: toJson(row.items),
        score: importedScore,
        status: 'APPROVED',
        submittedAt: auditDate,
      },
    })
  }

  if (!station.lastInspected || auditDate > station.lastInspected) {
    await tx.station.update({
      where: { id: station.id },
      data: { score: importedScore, status: importedStatus, lastInspected: auditDate },
    })
  }

  return { id: station.id, nameTh: station.nameTh }
}
