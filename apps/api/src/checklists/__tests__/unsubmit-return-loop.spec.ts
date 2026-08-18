/**
 * Self-unsubmit — an auditor pulling back their OWN SUBMITTED checklist (not yet acted on by an
 * admin) to keep editing it. Generalizes rejectChecklist's status-transition + AuditLog shape
 * (see checklists.service.ts#unsubmitChecklist's doc) rather than a parallel "reopen" system:
 *   - BOLA: ownership (auditorId) is part of the SAME findFirst as the id/station scoping.
 *   - Race guard: status is re-checked INSIDE the transaction (mirrors approve/rejectChecklist).
 *   - No second row: flips the SAME row SUBMITTED -> DRAFT in place, after clearing any stale
 *     lingering "slot" DRAFT for the same (station, auditor) pair (submit()/saveDraft() never
 *     delete the draft they consume — see the service doc).
 *   - submit() generalizes the reviewNotes-driven resubmit-after-rejection linkage to also detect
 *     an unresolved self-unsubmit via AuditLog, writing RESUBMIT_AFTER_UNSUBMIT the same way.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'

describe('ChecklistsService.unsubmitChecklist — transaction atomicity + BOLA + race guard', () => {
  let service: ChecklistsService
  const findFirst = jest.fn()        // outer prisma.checklist.findFirst
  const checklistUpdate = jest.fn()  // root client — must NEVER be called
  const txFindFirst = jest.fn()
  const txDeleteMany = jest.fn()
  const txUpdate = jest.fn()
  const auditLog = jest.fn()
  const transactionMock = jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ checklist: { findFirst: txFindFirst, deleteMany: txDeleteMany, update: txUpdate } }),
  )

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { findFirst, update: checklistUpdate },
            $transaction: transactionMock,
          },
        },
        { provide: StationsService, useValue: {} },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(ChecklistsService)
  })

  const submitted = { id: 'cl1', stationId: 's1', auditorId: 'auditor-1', status: 'SUBMITTED' }

  it('404s when the checklist does not belong to this station+auditor (BOLA) — no transaction opened', async () => {
    findFirst.mockResolvedValue(null)
    await expect(service.unsubmitChecklist('s1', 'cl1', 'someone-else')).rejects.toThrow(NotFoundException)
    expect(findFirst).toHaveBeenCalledWith({ where: { id: 'cl1', stationId: 's1', auditorId: 'someone-else' } })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('400s with the current status when the checklist is not SUBMITTED — no transaction opened', async () => {
    findFirst.mockResolvedValue({ ...submitted, status: 'APPROVED' })
    await expect(service.unsubmitChecklist('s1', 'cl1', 'auditor-1')).rejects.toThrow(BadRequestException)
    await expect(service.unsubmitChecklist('s1', 'cl1', 'auditor-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'NOT_SUBMITTED', status: 'APPROVED' }),
    })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('mirrors the SUBMITTED precondition inside the transaction — refuses a concurrent admin approve/reject', async () => {
    findFirst.mockResolvedValue(submitted)
    txFindFirst.mockResolvedValueOnce({ ...submitted, status: 'REJECTED' })

    await expect(service.unsubmitChecklist('s1', 'cl1', 'auditor-1')).rejects.toThrow(BadRequestException)
    expect(txDeleteMany).not.toHaveBeenCalled()
    expect(txUpdate).not.toHaveBeenCalled()
    expect(auditLog).not.toHaveBeenCalled()
  })

  it('clears a stale lingering DRAFT slot before flipping this row, all inside the tx client', async () => {
    findFirst.mockResolvedValue(submitted)
    txFindFirst.mockResolvedValueOnce(submitted)
    txDeleteMany.mockResolvedValue({ count: 1 })
    txUpdate.mockResolvedValue({ ...submitted, status: 'DRAFT', submittedAt: null, score: null })

    const result = await service.unsubmitChecklist('s1', 'cl1', 'auditor-1')

    expect(txDeleteMany).toHaveBeenCalledWith({
      where: { stationId: 's1', auditorId: 'auditor-1', status: 'DRAFT', id: { not: 'cl1' } },
    })
    expect(txUpdate).toHaveBeenCalledWith({
      where: { id: 'cl1' },
      data: { status: 'DRAFT', submittedAt: null, score: null },
    })
    expect(result.status).toBe('DRAFT')
    expect(checklistUpdate).not.toHaveBeenCalled() // never the root client
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'UNSUBMIT_CHECKLIST',
      entityType: 'Checklist',
      entityId: 'cl1',
      before: { status: 'SUBMITTED' },
      after: { status: 'DRAFT' },
    }))
  })
})

describe('ChecklistsService.submit — resubmit-after-unsubmit linkage', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  const checklistFindFirst = jest.fn()
  const auditLogFindFirst = jest.fn()
  const findOne = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก', railSubtype: null, coordStatus: 'APPROXIMATE', yearBuilt: 2560 })
    checklistCreate.mockResolvedValue({ id: 'new-cl' })

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { create: checklistCreate, findFirst: checklistFindFirst, update: jest.fn() },
            checklistTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
            auditLog: { findFirst: auditLogFindFirst },
          },
        },
        { provide: StationsService, useValue: { findOne, distanceToStationMeters: jest.fn() } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(ChecklistsService)
  })

  it('a submit consuming a draft whose latest lifecycle marker is an unresolved UNSUBMIT_CHECKLIST links back to it', async () => {
    checklistFindFirst.mockResolvedValueOnce({ id: 'draft1', reviewNotes: null, appliedYearBuilt: null })
    auditLogFindFirst.mockResolvedValueOnce({ action: 'UNSUBMIT_CHECKLIST' })

    await service.submit('s1', 'u1', [])

    expect(auditLogFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { entityType: 'Checklist', entityId: 'draft1', action: { in: ['UNSUBMIT_CHECKLIST', 'RESUBMIT_AFTER_UNSUBMIT'] } },
    }))
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RESUBMIT_AFTER_UNSUBMIT',
      entityId: 'new-cl',
      before: { checklistId: 'draft1' },
      after: { checklistId: 'new-cl' },
    }))
  })

  it('a LATER unrelated submit reusing the same slot does not re-link once already resolved', async () => {
    checklistFindFirst.mockResolvedValueOnce({ id: 'draft1', reviewNotes: null, appliedYearBuilt: null })
    auditLogFindFirst.mockResolvedValueOnce({ action: 'RESUBMIT_AFTER_UNSUBMIT' }) // already resolved

    await service.submit('s1', 'u1', [])

    expect(auditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'RESUBMIT_AFTER_UNSUBMIT' }))
  })

  it('an ordinary submit consuming a plain draft (never unsubmitted) never queries AuditLog for nothing useful', async () => {
    checklistFindFirst.mockResolvedValueOnce({ id: 'draft1', reviewNotes: null, appliedYearBuilt: null })
    auditLogFindFirst.mockResolvedValueOnce(null)

    await service.submit('s1', 'u1', [])

    expect(auditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'RESUBMIT_AFTER_UNSUBMIT' }))
  })
})

describe('ChecklistsService.findResubmitSource — generalized to both link types', () => {
  let service: ChecklistsService
  const auditLogFindFirst = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        { provide: PrismaService, useValue: { auditLog: { findFirst: auditLogFindFirst } } },
        { provide: StationsService, useValue: {} },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(ChecklistsService)
  })

  it('resolves a RESUBMIT_AFTER_UNSUBMIT link the same way it resolves a rejection link', async () => {
    auditLogFindFirst.mockResolvedValue({ before: { checklistId: 'old-draft' } })
    await expect(service.findResubmitSource('cl-new')).resolves.toBe('old-draft')
    expect(auditLogFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { action: { in: ['RESUBMIT_AFTER_REJECTION', 'RESUBMIT_AFTER_UNSUBMIT'] }, entityType: 'Checklist', entityId: 'cl-new' },
    }))
  })
})
