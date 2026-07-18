/**
 * E-form redesign (Session E1, Part C) — SubmitChecklistDto / ChecklistsService validation.
 * Covers both a v1 (flat, no subItems) template and a synthetic v2 (nested + measured) template,
 * per the Part C requirement that validation must pass templates with and without subItems.
 */
import { BadRequestException } from '@nestjs/common'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { SubmitChecklistDto } from '../dto/submit-checklist.dto'
import type { ChecklistTemplateDefinition } from '@repo/types'

const V1_TEMPLATE: ChecklistTemplateDefinition = {
  schemaVersion: 1,
  mode: 'ทางบก',
  groups: [{ code: 'A1', labelTh: 'ที่จอดรถ', items: [
    { code: 'A1.1', labelTh: 'ที่จอดรถสำหรับคนพิการ', answerType: 'choice' },
  ] }],
}

const V2_TEMPLATE: ChecklistTemplateDefinition = {
  schemaVersion: 2,
  mode: 'ทางเรือ',
  groups: [{ code: 'A1', labelTh: 'test', items: [
    { code: 'A1.1', labelTh: 'ramp', subItems: [
      { code: 'A1.1-1', labelTh: 'width', answerType: 'presence_standard', measurements: [{ key: 'm1', operator: 'gte', value: 90, unit: 'cm', autoGrade: true }] },
    ] },
  ] }],
}

describe('ChecklistsService — Part C item validation (via saveDraft)', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  const checklistFindFirst = jest.fn()
  const findOne = jest.fn()
  const templateFindFirst = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    checklistFindFirst.mockResolvedValue(null)
    checklistCreate.mockResolvedValue({ id: 'cl1' })

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
      ],
    }).compile()

    service = moduleRef.get(ChecklistsService)
  })

  it('accepts a v1 flat payload matching a v1 (no subItems) template', async () => {
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก' })
    templateFindFirst.mockResolvedValue({ id: 't1', version: 1, definition: V1_TEMPLATE })

    const items = [{ groupId: 'A1', groupName: 'A1', items: [
      { id: 'A1.1', labelTh: 'ที่จอดรถสำหรับคนพิการ', value: 'มี', meetsStandard: true, flagged: false },
    ] }]

    await expect(service.saveDraft('s1', 'u1', items)).resolves.toBeDefined()
  })

  it('rejects a v1 payload with an unknown item code, naming the offending code', async () => {
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก' })
    templateFindFirst.mockResolvedValue({ id: 't1', version: 1, definition: V1_TEMPLATE })

    const items = [{ groupId: 'A1', groupName: 'A1', items: [
      { id: 'A1.99-does-not-exist', labelTh: 'bogus', value: 'มี', meetsStandard: true, flagged: false },
    ] }]

    let caught: BadRequestException | undefined
    try {
      await service.saveDraft('s1', 'u1', items)
    } catch (err) {
      caught = err as BadRequestException
    }
    expect(caught).toBeInstanceOf(BadRequestException)
    const response = caught!.getResponse() as { code: string; message: string }
    expect(response.code).toBe('INVALID_ITEMS')
    expect(response.message).toContain('A1.99-does-not-exist')
  })

  it('accepts a synthetic v2 nested+measured payload matching a v2 (with subItems) template', async () => {
    findOne.mockResolvedValue({ id: 's2', mode: 'ทางเรือ' })
    templateFindFirst.mockResolvedValue({ id: 't2', version: 2, definition: V2_TEMPLATE })

    const items = [{ groupId: 'A1', groupName: 'test', items: [
      { id: 'A1.1', labelTh: 'ramp', subItems: [
        { id: 'A1.1-1', labelTh: 'width', answerType: 'presence_standard', present: true, values: { m1: 95 } },
      ] },
    ] }]

    await expect(service.saveDraft('s2', 'u1', items)).resolves.toBeDefined()
  })

  it('rejects a v2 payload whose leaf has an invalid answerType', async () => {
    findOne.mockResolvedValue({ id: 's2', mode: 'ทางเรือ' })
    templateFindFirst.mockResolvedValue({ id: 't2', version: 2, definition: V2_TEMPLATE })

    const items = [{ groupId: 'A1', groupName: 'test', items: [
      { id: 'A1.1', labelTh: 'ramp', subItems: [
        { id: 'A1.1-1', labelTh: 'width', answerType: 'not-a-real-type', present: true },
      ] },
    ] }]

    await expect(service.saveDraft('s2', 'u1', items)).rejects.toBeInstanceOf(BadRequestException)
  })

  it('rejects an oversized items payload before structural validation runs', async () => {
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก' })
    templateFindFirst.mockResolvedValue(null)

    const huge = [{ groupId: 'A', groupName: 'A', items: [
      { id: 'x', labelTh: 'x'.repeat(600 * 1024), value: null, meetsStandard: false },
    ] }]

    await expect(service.saveDraft('s1', 'u1', huge)).rejects.toBeInstanceOf(BadRequestException)
  })
})

describe('SubmitChecklistDto — class-validator shape', () => {
  it('caps finalThoughts at 4000 characters', async () => {
    const dto = plainToInstance(SubmitChecklistDto, { items: [], finalThoughts: 'a'.repeat(4001) })
    const errors = await validate(dto)
    expect(errors.some(e => e.property === 'finalThoughts')).toBe(true)
  })

  it('accepts finalThoughts at exactly the cap', async () => {
    const dto = plainToInstance(SubmitChecklistDto, { items: [], finalThoughts: 'a'.repeat(4000) })
    const errors = await validate(dto)
    expect(errors.some(e => e.property === 'finalThoughts')).toBe(false)
  })

  it('rejects gps lat/lng out of range', async () => {
    const dto = plainToInstance(SubmitChecklistDto, { items: [], gps: { lat: 999, lng: 999 } })
    const errors = await validate(dto)
    const gpsError = errors.find(e => e.property === 'gps')
    expect(gpsError).toBeDefined()
  })
})
