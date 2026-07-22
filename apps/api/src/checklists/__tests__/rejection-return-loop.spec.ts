/**
 * Session E3, Part B — rejection return loop (auditor side):
 *   B.1 countMyRejected / findMyRejected: "latest checklist per station for this auditor" so a
 *       resubmitted (no-longer-REJECTED) station drops off the list automatically.
 *   B.3 submit() records a RESUBMIT_AFTER_REJECTION AuditLog entry when the consumed DRAFT
 *       carries a rejection's reviewNotes, then clears that draft's reviewNotes so a later,
 *       unrelated resubmit against the same lingering draft doesn't re-link to the same rejection.
 *   B.4 findResubmitSource resolves the link the admin review page shows.
 */
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'

describe('ChecklistsService — Part B.1 returned-work list/count', () => {
  let service: ChecklistsService
  const checklistFindMany = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        { provide: PrismaService, useValue: { checklist: { findMany: checklistFindMany } } },
        { provide: StationsService, useValue: {} },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(ChecklistsService)
  })

  it('countMyRejected counts only stations whose LATEST checklist is REJECTED', async () => {
    // distinct:['stationId'] + orderBy submittedAt desc already gives one row per station, most
    // recent first — the mock reproduces that contract directly rather than re-implementing it.
    checklistFindMany.mockResolvedValue([
      { stationId: 's1', status: 'REJECTED' },   // still needs fixing
      { stationId: 's2', status: 'SUBMITTED' },  // resubmitted, no longer pending
      { stationId: 's3', status: 'APPROVED' },
    ])
    await expect(service.countMyRejected('u1')).resolves.toBe(1)
    expect(checklistFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { auditorId: 'u1', status: { in: ['SUBMITTED', 'APPROVED', 'REJECTED'] } },
      distinct: ['stationId'],
    }))
  })

  it('findMyRejected returns station/notes detail for still-pending rejections only', async () => {
    checklistFindMany.mockResolvedValue([
      {
        id: 'cl1', stationId: 's1', status: 'REJECTED', reviewNotes: 'แก้ไขป้าย', reviewedAt: new Date('2026-07-20'),
        station: { nameTh: 'สถานี A', province: 'กรุงเทพฯ', mode: 'ทางบก' },
      },
      {
        id: 'cl2', stationId: 's2', status: 'APPROVED', reviewNotes: null, reviewedAt: null,
        station: { nameTh: 'สถานี B', province: 'ชลบุรี', mode: 'ทางบก' },
      },
    ])
    const rows = await service.findMyRejected('u1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'cl1', stationId: 's1', reviewNotes: 'แก้ไขป้าย' })
    expect(rows[0]).not.toHaveProperty('status')
  })

  it('an auditor with nothing rejected gets an empty list and a zero count', async () => {
    checklistFindMany.mockResolvedValue([{ stationId: 's1', status: 'APPROVED' }])
    await expect(service.countMyRejected('u1')).resolves.toBe(0)
  })
})

describe('ChecklistsService.submit — Part B.3 resubmit-after-rejection linkage', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  const checklistFindFirst = jest.fn()
  const checklistUpdate = jest.fn()
  const findOne = jest.fn()
  const distanceToStationMeters = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก', railSubtype: null, coordStatus: 'APPROXIMATE', yearBuilt: null })
    checklistCreate.mockResolvedValue({ id: 'new-cl' })

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { create: checklistCreate, findFirst: checklistFindFirst, update: checklistUpdate },
            checklistTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
          },
        },
        { provide: StationsService, useValue: { findOne, distanceToStationMeters } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(ChecklistsService)
  })

  it('an ordinary submit with no prior draft never writes a RESUBMIT_AFTER_REJECTION entry', async () => {
    checklistFindFirst.mockResolvedValueOnce(null) // no existing draft
    await service.submit('s1', 'u1', [])
    expect(auditLog).toHaveBeenCalledTimes(1) // only SUBMIT_CHECKLIST
    expect(auditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'RESUBMIT_AFTER_REJECTION' }))
  })

  it('a submit consuming a draft with no reviewNotes (never rejected) is not treated as a resubmission', async () => {
    checklistFindFirst.mockResolvedValueOnce({ id: 'draft1', reviewNotes: null, appliedYearBuilt: null })
    await service.submit('s1', 'u1', [])
    expect(auditLog).toHaveBeenCalledTimes(1)
    expect(checklistUpdate).not.toHaveBeenCalled()
  })

  it('a submit consuming a draft that carries rejection notes links back to the prior REJECTED checklist and clears the draft note', async () => {
    checklistFindFirst
      .mockResolvedValueOnce({ id: 'draft1', reviewNotes: 'แก้ไขป้าย', appliedYearBuilt: null }) // existingDraft lookup
      .mockResolvedValueOnce({ id: 'old-rejected', status: 'REJECTED' })                          // priorRejected lookup

    await service.submit('s1', 'u1', [])

    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'RESUBMIT_AFTER_REJECTION',
      entityId: 'new-cl',
      before: { checklistId: 'old-rejected' },
      after: { checklistId: 'new-cl' },
    }))
    expect(checklistUpdate).toHaveBeenCalledWith({ where: { id: 'draft1' }, data: { reviewNotes: null } })
  })

  it('degrades gracefully (no crash, no link) if the prior REJECTED row is somehow gone — but still clears the dangling draft note', async () => {
    checklistFindFirst
      .mockResolvedValueOnce({ id: 'draft1', reviewNotes: 'แก้ไขป้าย', appliedYearBuilt: null })
      .mockResolvedValueOnce(null) // priorRejected lookup finds nothing

    await service.submit('s1', 'u1', [])

    expect(auditLog).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'RESUBMIT_AFTER_REJECTION' }))
    expect(checklistUpdate).toHaveBeenCalledWith({ where: { id: 'draft1' }, data: { reviewNotes: null } })
  })
})

describe('ChecklistsService.findResubmitSource — Part B.4', () => {
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

  it('returns null for an ordinary checklist', async () => {
    auditLogFindFirst.mockResolvedValue(null)
    await expect(service.findResubmitSource('cl-ordinary')).resolves.toBeNull()
  })

  it('returns the linked prior checklist id for a resubmission', async () => {
    auditLogFindFirst.mockResolvedValue({ before: { checklistId: 'old-rejected' } })
    await expect(service.findResubmitSource('cl-new')).resolves.toBe('old-rejected')
    expect(auditLogFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { action: 'RESUBMIT_AFTER_REJECTION', entityType: 'Checklist', entityId: 'cl-new' },
    }))
  })
})
