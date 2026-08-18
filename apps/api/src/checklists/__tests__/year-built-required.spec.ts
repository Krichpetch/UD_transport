/**
 * Session F1, Part B.2 — server-side guarantee behind the auditor's client-side confirm-to-start
 * lock (Part B.1): a checklist is never CREATED (fresh DRAFT, or a direct submit with no prior
 * draft) without a resolvable build year. Never checked when reusing an EXISTING draft/stamp —
 * that checklist was already created under this same gate.
 */
import { BadRequestException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'

describe('ChecklistsService — Part B.2 yearBuilt required at checklist creation', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  const checklistUpdate = jest.fn()
  const checklistFindFirst = jest.fn()
  const findOne = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    checklistCreate.mockResolvedValue({ id: 'cl1' })

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { create: checklistCreate, update: checklistUpdate, findFirst: checklistFindFirst },
            checklistTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
            // Consulted by submit()'s resubmit-after-unsubmit linkage check whenever an existing
            // draft is consumed — resolving to null keeps that path a no-op here (see
            // unsubmit-return-loop.spec.ts for that behavior itself).
            auditLog: { findFirst: jest.fn().mockResolvedValue(null) },
          },
        },
        { provide: StationsService, useValue: { findOne } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(ChecklistsService)
  })

  it('saveDraft rejects creating a fresh draft when the station has no yearBuilt', async () => {
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก', yearBuilt: null })
    checklistFindFirst.mockResolvedValue(null) // no existing draft

    let caught: BadRequestException | undefined
    try {
      await service.saveDraft('s1', 'u1', [])
    } catch (err) {
      caught = err as BadRequestException
    }
    expect(caught).toBeInstanceOf(BadRequestException)
    expect((caught!.getResponse() as { code: string }).code).toBe('YEAR_BUILT_REQUIRED')
    expect(checklistCreate).not.toHaveBeenCalled()
  })

  it('saveDraft succeeds creating a fresh draft when the station has a yearBuilt', async () => {
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก', yearBuilt: 2560 })
    checklistFindFirst.mockResolvedValue(null)

    await expect(service.saveDraft('s1', 'u1', [])).resolves.toBeDefined()
  })

  it('saveDraft never re-checks yearBuilt when an existing DRAFT is just being updated', async () => {
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก', yearBuilt: null }) // station year since cleared, hypothetically
    checklistFindFirst.mockResolvedValue({ id: 'existing-draft', stationId: 's1', auditorId: 'u1', status: 'DRAFT' })
    checklistUpdate.mockResolvedValue({ id: 'existing-draft' })

    await expect(service.saveDraft('s1', 'u1', [])).resolves.toBeDefined()
  })

  it('submit rejects a fresh checklist (no prior draft) when the station has no yearBuilt', async () => {
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก', coordStatus: 'APPROXIMATE', yearBuilt: null })
    checklistFindFirst.mockResolvedValue(null) // no existing draft

    let caught: BadRequestException | undefined
    try {
      await service.submit('s1', 'u1', [])
    } catch (err) {
      caught = err as BadRequestException
    }
    expect(caught).toBeInstanceOf(BadRequestException)
    expect((caught!.getResponse() as { code: string }).code).toBe('YEAR_BUILT_REQUIRED')
    expect(checklistCreate).not.toHaveBeenCalled()
  })

  it('submit succeeds reusing an existing draft\'s frozen stamp even if the station\'s live yearBuilt is null', async () => {
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก', coordStatus: 'APPROXIMATE', yearBuilt: null })
    checklistFindFirst.mockResolvedValue({ id: 'draft1', reviewNotes: null, appliedYearBuilt: 2555 })

    await expect(service.submit('s1', 'u1', [])).resolves.toBeDefined()
  })
})
