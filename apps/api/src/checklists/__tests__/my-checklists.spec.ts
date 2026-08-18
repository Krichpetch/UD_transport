/**
 * Session F1, Part E — "งานของฉัน" auditor history list.
 *   E.3 ownership: findMyChecklists is scoped ONLY by the auditorId argument the controller passes
 *       (always req.user.id, the JWT-authenticated caller — see checklists.controller.ts#mine) —
 *       an auditor can never see another auditor's rows.
 *   E.1 status filter + draft progress math (computeStoredProgress, no template fan-out).
 */
import { ForbiddenException, NotFoundException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { MyChecklistsController } from '../checklists.controller'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'

describe('MyChecklistsController.mine — Part E role guard', () => {
  it('rejects a non-AUDITOR caller before touching the service', () => {
    const findMyChecklists = jest.fn()
    const controller = new MyChecklistsController({ findMyChecklists } as unknown as ChecklistsService)
    const reqAdmin = { user: { id: 'u1', username: 'a', role: 'ADMIN' } } as never
    expect(() => controller.mine(undefined, undefined, undefined, reqAdmin)).toThrow(ForbiddenException)
    expect(findMyChecklists).not.toHaveBeenCalled()
  })

  it('rejects an invalid status query value', () => {
    const controller = new MyChecklistsController({ findMyChecklists: jest.fn() } as unknown as ChecklistsService)
    const req = { user: { id: 'u1', username: 'a', role: 'AUDITOR' } } as never
    expect(() => controller.mine(undefined, undefined, 'NOT_A_STATUS', req)).toThrow()
  })

  it('passes req.user.id (never a client-suppliable value) as the sole ownership scope', () => {
    const findMyChecklists = jest.fn().mockResolvedValue({ data: [], total: 0, page: 1, totalPages: 1 })
    const controller = new MyChecklistsController({ findMyChecklists } as unknown as ChecklistsService)
    const req = { user: { id: 'auditor-a', username: 'a', role: 'AUDITOR' } } as never
    controller.mine('1', '20', undefined, req)
    expect(findMyChecklists).toHaveBeenCalledWith('auditor-a', 1, 20, undefined)
  })
})

describe('ChecklistsService.findMyChecklists — Part E', () => {
  let service: ChecklistsService
  const checklistFindMany = jest.fn()
  const checklistCount = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: { checklist: { findMany: checklistFindMany, count: checklistCount } },
        },
        { provide: StationsService, useValue: {} },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(ChecklistsService)
  })

  it('scopes the query to auditorId ONLY — never accepts a caller-supplied filter that could widen it', async () => {
    checklistCount.mockResolvedValue(0)
    checklistFindMany.mockResolvedValue([])

    await service.findMyChecklists('auditor-a', 1, 20)

    expect(checklistFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { auditorId: 'auditor-a' },
    }))
    expect(checklistCount).toHaveBeenCalledWith({ where: { auditorId: 'auditor-a' } })
  })

  it('auditor B never sees auditor A\'s rows — the where clause is keyed to whichever id is passed, always the caller\'s own', async () => {
    checklistCount.mockResolvedValue(1)
    checklistFindMany.mockResolvedValue([
      { id: 'cl-a', stationId: 's1', status: 'DRAFT', items: [], station: { nameTh: 'A', line: '', mode: 'ทางบก', railSubtype: null, province: 'กท.' } },
    ])
    await service.findMyChecklists('auditor-a', 1, 20)
    expect(checklistFindMany.mock.calls[0]![0].where.auditorId).toBe('auditor-a')

    jest.clearAllMocks()
    checklistCount.mockResolvedValue(0)
    checklistFindMany.mockResolvedValue([])
    await service.findMyChecklists('auditor-b', 1, 20)
    expect(checklistFindMany.mock.calls[0]![0].where.auditorId).toBe('auditor-b')
  })

  it('an optional status filter narrows the where clause', async () => {
    checklistCount.mockResolvedValue(0)
    checklistFindMany.mockResolvedValue([])
    await service.findMyChecklists('auditor-a', 1, 20, 'REJECTED' as never)
    expect(checklistFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { auditorId: 'auditor-a', status: 'REJECTED' },
    }))
  })

  it('computes DRAFT progress from stored items (no template fan-out) and strips the raw items blob', async () => {
    checklistCount.mockResolvedValue(1)
    checklistFindMany.mockResolvedValue([{
      id: 'cl1', stationId: 's1', status: 'DRAFT',
      items: [{ groupId: 'A1', groupName: 'A1', items: [
        { id: 'A1.1', labelTh: 'x', value: 'มี', meetsStandard: true },
        { id: 'A1.2', labelTh: 'y', value: null },
      ] }],
      station: { nameTh: 'สถานี A', line: '', mode: 'ทางบก', railSubtype: null, province: 'กท.' },
    }])

    const result = await service.findMyChecklists('auditor-a', 1, 20)
    expect(result.data[0]).not.toHaveProperty('items')
    expect(result.data[0]!.progress).toEqual({ answered: 1, total: 2 })
  })

  it('a SUBMITTED/APPROVED/REJECTED row has progress: null — it is a complete record, not in-progress', async () => {
    checklistCount.mockResolvedValue(1)
    checklistFindMany.mockResolvedValue([{
      id: 'cl2', stationId: 's1', status: 'APPROVED',
      items: [{ groupId: 'A1', groupName: 'A1', items: [{ id: 'A1.1', labelTh: 'x', value: 'มี', meetsStandard: true }] }],
      station: { nameTh: 'สถานี A', line: '', mode: 'ทางบก', railSubtype: null, province: 'กท.' },
    }])
    const result = await service.findMyChecklists('auditor-a', 1, 20)
    expect(result.data[0]!.progress).toBeNull()
  })

  it('findMyChecklistDetail 404s (never 403) when the checklist belongs to a different auditor — BOLA-safe', async () => {
    const checklistFindFirst = jest.fn().mockResolvedValue(null) // scoped query found nothing
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        { provide: PrismaService, useValue: { checklist: { findFirst: checklistFindFirst } } },
        { provide: StationsService, useValue: {} },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    const detailService = moduleRef.get(ChecklistsService)

    await expect(detailService.findMyChecklistDetail('auditor-a', 'someone-elses-checklist')).rejects.toBeInstanceOf(NotFoundException)
    expect(checklistFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'someone-elses-checklist', auditorId: 'auditor-a' },
    }))
  })

  // Live feedback follow-up — the auditor "look back on my submitted work" review screen needs
  // the FROZEN template (templateId, stamped once at creation) to re-render real answer controls
  // and compute an accurate category summary, not the mode's current ACTIVE template.
  it('findMyChecklistDetail returns the checklist\'s own frozen template definition, not wrapped in the relation object', async () => {
    const definition = { schemaVersion: 1, mode: 'ทางบก', groups: [] }
    const checklistFindFirst = jest.fn().mockResolvedValue({
      id: 'cl1', auditorId: 'auditor-a', items: [],
      station: { nameTh: 'สถานี A' },
      template: { definition },
    })
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        { provide: PrismaService, useValue: { checklist: { findFirst: checklistFindFirst } } },
        { provide: StationsService, useValue: {} },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    const detailService = moduleRef.get(ChecklistsService)

    const result = await detailService.findMyChecklistDetail('auditor-a', 'cl1')
    expect(result.templateDef).toEqual(definition)
    expect((result as { template?: unknown }).template).toBeUndefined()
  })

  it('findMyChecklistDetail degrades to templateDef: null for a pre-E1 row with no templateId', async () => {
    const checklistFindFirst = jest.fn().mockResolvedValue({
      id: 'cl2', auditorId: 'auditor-a', items: [], station: { nameTh: 'สถานี B' }, template: null,
    })
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        { provide: PrismaService, useValue: { checklist: { findFirst: checklistFindFirst } } },
        { provide: StationsService, useValue: {} },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    const detailService = moduleRef.get(ChecklistsService)

    const result = await detailService.findMyChecklistDetail('auditor-a', 'cl2')
    expect(result.templateDef).toBeNull()
  })

  // Live feedback fix — an admin-hidden node (TemplateNode.hidden === true) never reached the
  // auditor's actual form and has no stored answer; the raw ChecklistTemplate.definition doesn't
  // know that (filterHiddenItems is what strips it, normally run by getTemplateForAudit for the
  // LIVE form) — findMyChecklistDetail must run the exact same filter, or a hidden item that was
  // never shown, never answerable, and never in `items` would resurface in the review screen.
  it('findMyChecklistDetail strips admin-hidden nodes from the returned templateDef, same as getTemplateForAudit already does for the live form', async () => {
    const definition = {
      schemaVersion: 2, mode: 'ทางบก',
      groups: [
        {
          code: 'A', labelTh: 'A', items: [
            { code: 'A1', labelTh: 'visible', answerType: 'choice' },
            { code: 'A2', labelTh: 'hidden by admin', answerType: 'choice', hidden: true },
          ],
        },
      ],
    }
    const checklistFindFirst = jest.fn().mockResolvedValue({
      id: 'cl3', auditorId: 'auditor-a', items: [],
      station: { nameTh: 'สถานี C' },
      template: { definition },
    })
    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        { provide: PrismaService, useValue: { checklist: { findFirst: checklistFindFirst } } },
        { provide: StationsService, useValue: {} },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    const detailService = moduleRef.get(ChecklistsService)

    const result = await detailService.findMyChecklistDetail('auditor-a', 'cl3')
    const codes = result.templateDef?.groups.flatMap((g) => g.items.map((i) => i.code))
    expect(codes).toEqual(['A1'])
  })

  it('paginates with total/page/totalPages, newest first', async () => {
    checklistCount.mockResolvedValue(45)
    checklistFindMany.mockResolvedValue([])
    const result = await service.findMyChecklists('auditor-a', 2, 20)
    expect(result).toMatchObject({ total: 45, page: 2, totalPages: 3 })
    expect(checklistFindMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20, take: 20, orderBy: [{ updatedAt: 'desc' }],
    }))
  })
})
