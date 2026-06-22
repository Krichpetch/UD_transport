/**
 * BOLA regression test — approveChecklist cross-station authorization
 *
 * Bug (stations.service.ts:78):
 *   prisma.checklist.update({ where: { id: checklistId } })
 *   has no stationId filter, so any checklistId from any station is accepted.
 *
 * Expected (correct): approveChecklist(stationA.id, checklistB.id) → throws
 * Current  (buggy):   approveChecklist(stationA.id, checklistB.id) → resolves  ← BUG
 *
 * Tests 1 and 3 FAIL with current code and PASS after the fix.
 * Test 2 is a sanity baseline that passes in both states.
 */

import { Test, TestingModule } from '@nestjs/testing'
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'

// ── Simulated Prisma P2025 ────────────────────────────────────────────────────

class RecordNotFoundError extends Error {
  readonly code = 'P2025'
  constructor() {
    super(
      'An operation failed because it depends on one or more records that were required but not found.',
    )
    this.name = 'PrismaClientKnownRequestError'
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

const STATION_A = 'station-a-id'
const STATION_B = 'station-b-id'
const CHECKLIST_A = 'checklist-a-id'
const CHECKLIST_B = 'checklist-b-id'

const checklistA = {
  id: CHECKLIST_A,
  stationId: STATION_A,
  score: 80,
  status: 'SUBMITTED' as const,
  submittedAt: new Date('2024-01-01'),
}

const checklistB = {
  id: CHECKLIST_B,
  stationId: STATION_B, // belongs to STATION_B, not STATION_A
  score: 20,
  status: 'SUBMITTED' as const,
  submittedAt: new Date('2024-06-01'),
}

const CHECKLIST_DB: Record<string, typeof checklistA> = {
  [CHECKLIST_A]: checklistA,
  [CHECKLIST_B]: checklistB,
}

// ── Prisma mock ───────────────────────────────────────────────────────────────

/**
 * Simulates Prisma checklist.update behavior:
 *   where.stationId present → validates ownership; throws P2025 on mismatch
 *   where.stationId absent  → looks up by id only  ← the current bug path
 *
 * After the fix (adding stationId to the where clause in approveChecklist),
 * the cross-station call hits the ownership branch and throws, making tests
 * 1 and 3 pass.
 */
function simulateChecklistUpdate({
  where,
  data,
}: {
  where: { id: string; stationId?: string }
  data: Record<string, unknown>
}) {
  const record = CHECKLIST_DB[where.id]
  if (!record) throw new RecordNotFoundError()
  // Only enforce stationId when it is explicitly included in the where clause.
  if (where.stationId !== undefined && record.stationId !== where.stationId) {
    throw new RecordNotFoundError()
  }
  return Promise.resolve({ ...record, ...data })
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('StationsService › BOLA: approveChecklist cross-station authorization', () => {
  let service: StationsService
  let checklistUpdate: jest.Mock
  let stationUpdate: jest.Mock

  beforeEach(async () => {
    checklistUpdate = jest.fn().mockImplementation(simulateChecklistUpdate)
    stationUpdate = jest.fn().mockResolvedValue({ id: STATION_A })

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StationsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { update: checklistUpdate },
            station: { update: stationUpdate },
          },
        },
        {
          provide: AuditLogService,
          useValue: { log: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    }).compile()

    service = module.get<StationsService>(StationsService)
  })

  // ✗ FAILS with current code — service resolves instead of throwing
  it('rejects when checklistId belongs to a different station', async () => {
    await expect(
      service.approveChecklist(STATION_A, CHECKLIST_B), // stationA route, stationB's checklist
    ).rejects.toThrow()
  })

  // ✓ Passes in both current and fixed code — baseline
  it('resolves when checklistId belongs to the correct station', async () => {
    await expect(
      service.approveChecklist(STATION_A, CHECKLIST_A),
    ).resolves.toBeDefined()
  })

  // ✗ FAILS with current code — stationA.score overwritten with checklistB.score (20)
  it('does not overwrite stationA score with data from checklistB', async () => {
    // Buggy code: resolves and calls station.update({ score: 20 }) against STATION_A.
    // Fixed code: throws before station.update is ever called.
    await service.approveChecklist(STATION_A, CHECKLIST_B).catch(() => { /* expected after fix */ })

    for (const [args] of stationUpdate.mock.calls) {
      if ((args as { where?: { id?: string } }).where?.id === STATION_A) {
        expect((args as { data?: { score?: unknown } }).data?.score).not.toBe(checklistB.score)
      }
    }
  })
})
