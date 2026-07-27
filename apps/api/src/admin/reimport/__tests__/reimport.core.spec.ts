/**
 * Part F (W2-S1) — runLegacyReimport is a plain function (not Nest-DI-bound), so it's exercised
 * directly against a mocked PrismaClient-shaped object, same jest.fn()-per-delegate convention
 * as batch-otp-transaction.spec.ts. Covers: fixture round-trip (every row matched+imported or
 * reported with the correct reason), unmatched-station reporting, idempotent re-run, and score
 * recompute matching a hand-computed value.
 */
import { runLegacyReimport } from '../reimport.core'
import type { LegacyChecklistExportRow } from '../legacy-checklist.types'
import fixtureRows from '../__fixtures__/legacy-sample.json'

const MASTERLIST = [
  { id: 's-a', mode: 'ทางบก', nameTh: 'สถานีทดสอบเอ', line: '', lastInspected: null },
  { id: 's-b1', mode: 'ทางบก', nameTh: 'สถานีทดสอบบี', line: 'สายเหนือ', lastInspected: null },
  { id: 's-b2', mode: 'ทางบก', nameTh: 'สถานีทดสอบบี', line: 'สายใต้', lastInspected: null },
  { id: 's-c', mode: 'ทางบก', nameTh: 'สถานีทดสอบซี', line: '', lastInspected: null },
]
const USERS = [
  { id: 'u-admin', username: 'admin' },
  { id: 'u-auditor1', username: 'auditor1' },
  { id: 'u-executive', username: 'executive' },
]

function makePrismaMock() {
  const auditLogFindMany = jest.fn().mockResolvedValue([])
  const auditLogCreate = jest.fn().mockResolvedValue(undefined)
  const userFindMany = jest.fn().mockResolvedValue(USERS)
  const checklistTemplateFindFirst = jest.fn().mockResolvedValue({ id: 'tpl-1', version: 2 })
  const stationFindMany = jest.fn().mockResolvedValue(MASTERLIST)
  const stationUpdate = jest.fn().mockResolvedValue(undefined)
  const checklistCreate = jest.fn().mockResolvedValue({ id: 'cl-imported' })

  return {
    prisma: {
      auditLog: { findMany: auditLogFindMany, create: auditLogCreate },
      user: { findMany: userFindMany },
      checklistTemplate: { findFirst: checklistTemplateFindFirst },
      station: { findMany: stationFindMany, update: stationUpdate },
      checklist: { create: checklistCreate },
    } as unknown as import('@prisma/client').PrismaClient,
    mocks: { auditLogFindMany, auditLogCreate, userFindMany, checklistTemplateFindFirst, stationFindMany, stationUpdate, checklistCreate },
  }
}

const rows = fixtureRows as unknown as LegacyChecklistExportRow[]

describe('runLegacyReimport — fixture round-trip', () => {
  it('matches/imports the clean row, reports ambiguous/unmatched/unresolvable-auditor rows with the right reason', async () => {
    const { prisma, mocks } = makePrismaMock()
    const report = await runLegacyReimport(prisma, rows, { adminId: 'u-admin', dryRun: false })

    expect(report.results[0]).toMatchObject({ sourceId: 'legacy-001', imported: { checklistId: 'cl-imported', stationId: 's-a' } })
    expect(report.results[1]).toMatchObject({ sourceId: 'legacy-002', skipped: { reason: 'REVIEW' } })
    expect(report.results[2]).toMatchObject({ sourceId: 'legacy-003', skipped: { reason: 'NOT_ON_MASTERLIST' } })
    expect(report.results[3]).toMatchObject({ sourceId: 'legacy-004', skipped: { reason: 'AUDITOR_NOT_FOUND', detail: 'ghost_user' } })

    // Never guessed, never created a station for the ambiguous/unmatched rows.
    expect(mocks.checklistCreate).toHaveBeenCalledTimes(1)
    expect(report.reconciliationCsvPath).toBeDefined()
  })

  it('recomputes the score server-side rather than trusting old data — matches a hand-computed value', async () => {
    const { prisma, mocks } = makePrismaMock()
    const report = await runLegacyReimport(prisma, [rows[0]!], { adminId: 'u-admin', dryRun: false })

    // Row 1's items: A1 (มี, meetsStandard) + A2 (มี, not standard) + A3 (ไม่มี) are eligible (3);
    // A4 (N/A) is excluded. Only A1 meets standard -> round(1/3 * 100) = 33.
    expect(report.results[0]).toMatchObject({ imported: expect.objectContaining({ stationId: 's-a' }) })
    expect(mocks.checklistCreate.mock.calls[0]![0].data.score).toBe(33)
  })

  it('is idempotent — re-running against the same export skips already-imported rows and writes nothing new', async () => {
    const { prisma, mocks } = makePrismaMock()
    const first = await runLegacyReimport(prisma, [rows[0]!], { adminId: 'u-admin', dryRun: false })
    expect(first.results[0]?.imported).toBeDefined()
    expect(mocks.checklistCreate).toHaveBeenCalledTimes(1)

    // Simulate the second run seeing the AuditLog row the first run just wrote.
    mocks.auditLogFindMany.mockResolvedValue([{ before: { sourceId: 'legacy-001' } }])

    const second = await runLegacyReimport(prisma, [rows[0]!], { adminId: 'u-admin', dryRun: false })
    expect(second.results[0]).toMatchObject({ skipped: { reason: 'ALREADY_IMPORTED' } })
    expect(mocks.checklistCreate).toHaveBeenCalledTimes(1) // still just the one from the first run
  })

  it('dry run reports the match outcome without writing anything', async () => {
    const { prisma, mocks } = makePrismaMock()
    const report = await runLegacyReimport(prisma, rows, { adminId: 'u-admin', dryRun: true })

    expect(report.results[0]).toMatchObject({ imported: { checklistId: '(dry-run)', stationId: 's-a' } })
    expect(mocks.checklistCreate).not.toHaveBeenCalled()
    expect(mocks.auditLogCreate).not.toHaveBeenCalled()
    expect(mocks.stationUpdate).not.toHaveBeenCalled()
  })
})
