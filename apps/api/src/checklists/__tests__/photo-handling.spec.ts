/**
 * Session E3, Part C — photo handling:
 *   C.1 server-side 5-photos-per-item cap (validateItemsPayload -> assertPhotoLimits)
 *   C.3 deletePhoto: ownership/status guard, MinIO removal, AuditLog entry
 *   C.4 refreshPhotoUrls: every read path re-presigns from the stored object key, never trusts
 *       the persisted `url`
 */
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'

function photo(id: string, url = `https://stale.example/${id}`) {
  return { id, url, filename: `${id}.jpg`, uploadedAt: '2026-07-01T00:00:00.000Z' }
}

describe('ChecklistsService — Part C.1 photo limit', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  const checklistFindFirst = jest.fn()
  const findOne = jest.fn()
  const templateFindFirst = jest.fn()
  const auditLog = jest.fn()
  const getPresignedUrl = jest.fn().mockResolvedValue('https://fresh.example/photo')

  beforeEach(async () => {
    jest.clearAllMocks()
    checklistFindFirst.mockResolvedValue(null)
    checklistCreate.mockResolvedValue({ id: 'cl1' })
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก', railSubtype: null })
    templateFindFirst.mockResolvedValue(null)

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { create: checklistCreate, findFirst: checklistFindFirst },
            checklistTemplate: { findFirst: templateFindFirst },
          },
        },
        { provide: StationsService, useValue: { findOne } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { getPresignedUrl, remove: jest.fn() } },
      ],
    }).compile()

    service = moduleRef.get(ChecklistsService)
  })

  it('accepts exactly 5 photos on one item', async () => {
    const items = [{ groupId: 'A1', groupName: 'A1', items: [
      { id: 'A1.1', labelTh: 'x', value: 'มี', meetsStandard: true, photos: [1, 2, 3, 4, 5].map((n) => photo(`p${n}`)) },
    ] }]
    await expect(service.saveDraft('s1', 'u1', items)).resolves.toBeDefined()
  })

  it('rejects 6 photos on one item, naming the item', async () => {
    const items = [{ groupId: 'A1', groupName: 'A1', items: [
      { id: 'A1.1', labelTh: 'x', value: 'มี', meetsStandard: true, photos: [1, 2, 3, 4, 5, 6].map((n) => photo(`p${n}`)) },
    ] }]
    let caught: BadRequestException | undefined
    try {
      await service.saveDraft('s1', 'u1', items)
    } catch (err) {
      caught = err as BadRequestException
    }
    expect(caught).toBeInstanceOf(BadRequestException)
    const response = caught!.getResponse() as { code: string; itemId: string }
    expect(response.code).toBe('PHOTOS_LIMIT_EXCEEDED')
    expect(response.itemId).toBe('A1.1')
  })

  it('enforces the cap on a nested v2 subItem too', async () => {
    const items = [{ groupId: 'A1', groupName: 'A1', items: [
      { id: 'A1.1', labelTh: 'container', subItems: [
        { id: 'A1.1-1', labelTh: 'leaf', answerType: 'presence', present: true, photos: [1, 2, 3, 4, 5, 6].map((n) => photo(`q${n}`)) },
      ] },
    ] }]
    await expect(service.saveDraft('s1', 'u1', items)).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('ChecklistsService — Part C.4 refreshPhotoUrls on read paths', () => {
  let service: ChecklistsService
  const checklistFindFirst = jest.fn()
  const checklistFindMany = jest.fn()
  const findOne = jest.fn()
  const auditLog = jest.fn()
  const getPresignedUrl = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    getPresignedUrl.mockImplementation((key: string) => Promise.resolve(`https://fresh.example/${key}`))

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { findFirst: checklistFindFirst, findMany: checklistFindMany },
            auditLog: { findFirst: jest.fn().mockResolvedValue(null) },
          },
        },
        { provide: StationsService, useValue: { findOne } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { getPresignedUrl, remove: jest.fn() } },
      ],
    }).compile()

    service = moduleRef.get(ChecklistsService)
  })

  const storedItems = [{ groupId: 'A1', groupName: 'A1', items: [
    { id: 'A1.1', labelTh: 'x', value: 'มี', photos: [photo('checklist-photos/abc.jpg', 'https://stale.example/one-hour-ago')] },
  ] }]

  it('findDraft re-presigns every photo url from its stored key, discarding the stale stored url', async () => {
    checklistFindFirst.mockResolvedValue({ id: 'd1', items: storedItems })
    const result = await service.findDraft('s1', 'u1')
    expect(getPresignedUrl).toHaveBeenCalledWith('checklist-photos/abc.jpg')
    expect(result!.items).toEqual([{ groupId: 'A1', groupName: 'A1', items: [
      { id: 'A1.1', labelTh: 'x', value: 'มี', photos: [{ ...photo('checklist-photos/abc.jpg'), url: 'https://fresh.example/checklist-photos/abc.jpg' }] },
    ] }])
  })

  it('findLatest re-presigns photos on the returned checklist', async () => {
    checklistFindFirst.mockResolvedValue({ id: 'cl1', items: storedItems, auditor: { username: 'a1' } })
    const result = await service.findLatest('s1')
    expect(getPresignedUrl).toHaveBeenCalledWith('checklist-photos/abc.jpg')
    const returnedUrl = (result!.items as { items: { photos: { url: string }[] }[] }[])[0]!.items[0]!.photos[0]!.url
    expect(returnedUrl).toBe('https://fresh.example/checklist-photos/abc.jpg')
  })

  it('a checklist with no photos never calls MinIO', async () => {
    checklistFindFirst.mockResolvedValue({ id: 'd2', items: [{ groupId: 'A1', groupName: 'A1', items: [{ id: 'A1.1', labelTh: 'x', value: null }] }] })
    await service.findDraft('s1', 'u1')
    expect(getPresignedUrl).not.toHaveBeenCalled()
  })

  it('gracefully leaves a photo with a failed re-presign untouched rather than throwing', async () => {
    getPresignedUrl.mockRejectedValueOnce(new Error('minio down'))
    checklistFindFirst.mockResolvedValue({ id: 'd3', items: storedItems })
    await expect(service.findDraft('s1', 'u1')).resolves.toBeDefined()
  })
})

describe('ChecklistsService.deletePhoto — Part C.3', () => {
  let service: ChecklistsService
  const checklistFindFirst = jest.fn()
  const checklistUpdate = jest.fn()
  const findOne = jest.fn()
  const auditLog = jest.fn()
  const minioRemove = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { findFirst: checklistFindFirst, update: checklistUpdate },
          },
        },
        { provide: StationsService, useValue: { findOne } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn().mockResolvedValue('https://fresh.example/x'), remove: minioRemove } },
      ],
    }).compile()
    service = moduleRef.get(ChecklistsService)
  })

  const draftWithPhoto = {
    id: 'cl1', stationId: 's1', auditorId: 'u1', status: 'DRAFT',
    items: [{ groupId: 'A1', groupName: 'A1', items: [
      { id: 'A1.1', labelTh: 'x', value: 'มี', photos: [photo('checklist-photos/target.jpg')] },
    ] }],
  }

  it('404s when the checklist does not belong to this auditor/station (BOLA-safe: same as not found)', async () => {
    checklistFindFirst.mockResolvedValue(null)
    await expect(service.deletePhoto('s1', 'cl1', 'u1', 'A1.1', 'checklist-photos/target.jpg')).rejects.toBeInstanceOf(NotFoundException)
    expect(checklistUpdate).not.toHaveBeenCalled()
  })

  it('400s when the checklist is SUBMITTED (not editable)', async () => {
    checklistFindFirst.mockResolvedValue({ ...draftWithPhoto, status: 'SUBMITTED' })
    await expect(service.deletePhoto('s1', 'cl1', 'u1', 'A1.1', 'checklist-photos/target.jpg')).rejects.toBeInstanceOf(BadRequestException)
    expect(checklistUpdate).not.toHaveBeenCalled()
    expect(minioRemove).not.toHaveBeenCalled()
  })

  it('allows deletion while REJECTED (returned for fixes)', async () => {
    checklistFindFirst.mockResolvedValue({ ...draftWithPhoto, status: 'REJECTED' })
    checklistUpdate.mockResolvedValue({ id: 'cl1', items: [] })
    await service.deletePhoto('s1', 'cl1', 'u1', 'A1.1', 'checklist-photos/target.jpg')
    expect(checklistUpdate).toHaveBeenCalledTimes(1)
  })

  it('404s when the item does not exist on this checklist', async () => {
    checklistFindFirst.mockResolvedValue(draftWithPhoto)
    await expect(service.deletePhoto('s1', 'cl1', 'u1', 'A1.99', 'checklist-photos/target.jpg')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('404s when the photo does not belong to that item', async () => {
    checklistFindFirst.mockResolvedValue(draftWithPhoto)
    await expect(service.deletePhoto('s1', 'cl1', 'u1', 'A1.1', 'checklist-photos/not-there.jpg')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('removes the object from MinIO by its key and audit-logs the deletion — never constructs the URL itself', async () => {
    checklistFindFirst.mockResolvedValue(draftWithPhoto)
    checklistUpdate.mockResolvedValue({ id: 'cl1', items: [] })

    await service.deletePhoto('s1', 'cl1', 'u1', 'A1.1', 'checklist-photos/target.jpg')

    expect(minioRemove).toHaveBeenCalledWith('checklist-photos/target.jpg')
    expect(checklistUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cl1' } }))
    const updatedItems = checklistUpdate.mock.calls[0]![0].data.items
    expect(JSON.stringify(updatedItems)).not.toContain('checklist-photos/target.jpg')
    expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'DELETE_PHOTO',
      entityType: 'Checklist',
      entityId: 'cl1',
      before: { itemId: 'A1.1', photoId: 'checklist-photos/target.jpg' },
    }))
  })

  it('still updates the checklist (removes the reference) even if the MinIO delete itself fails', async () => {
    checklistFindFirst.mockResolvedValue(draftWithPhoto)
    checklistUpdate.mockResolvedValue({ id: 'cl1', items: [] })
    minioRemove.mockRejectedValueOnce(new Error('minio unreachable'))

    await expect(service.deletePhoto('s1', 'cl1', 'u1', 'A1.1', 'checklist-photos/target.jpg')).resolves.toBeDefined()
    expect(checklistUpdate).toHaveBeenCalledTimes(1)
  })
})
