/**
 * Session F1 follow-up — admin preview build-year override: lets an admin substitute any build
 * year against GET .../checklist/template so era redaction/value resolution can be exercised
 * interactively (e.g. a v3 DRAFT template) without touching the real station's yearBuilt or
 * writing anything anywhere. Preview-only (rejected outside preview/version mode), ADMIN-only
 * (the existing preview gate already covers this — see checklists.controller.ts).
 */
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { ChecklistsController } from '../checklists.controller'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'
import type { ChecklistTemplateDefinition } from '@repo/types'

const REGISTRY_TEMPLATE: ChecklistTemplateDefinition = {
  schemaVersion: 2, mode: 'ทางบก',
  groups: [{ code: 'A1', labelTh: 'g', items: [
    { code: 'A1.1', labelTh: 'requires new law', answerType: 'presence', lawRefs: ['MHT_2564'] },
    { code: 'A1.2', labelTh: 'untagged', answerType: 'presence' },
  ] }],
}

describe('ChecklistsService.getTemplateForAudit — preview year override', () => {
  let service: ChecklistsService
  const findOne = jest.fn()
  const checklistFindFirst = jest.fn()
  const templateFindFirst = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    findOne.mockResolvedValue({ id: 's1', mode: 'ทางบก', railSubtype: null, yearBuilt: 2560 })
    templateFindFirst.mockResolvedValue({ id: 't1', version: 1, definition: REGISTRY_TEMPLATE })

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: { checklist: { findFirst: checklistFindFirst }, checklistTemplate: { findFirst: templateFindFirst } },
        },
        { provide: StationsService, useValue: { findOne } },
        { provide: AuditLogService, useValue: { log: jest.fn() } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(ChecklistsService)
  })

  it('preview + yearBuiltOverride resolves against the OVERRIDE year, never the station\'s real yearBuilt', async () => {
    // Station's real yearBuilt (2560) predates MHT_2564 (2564) — A1.1 would be redacted if
    // resolved against the real year. The override (2570) postdates it — A1.1 must be applicable.
    const result = await service.getTemplateForAudit('s1', 'admin1', true, undefined, 2570)
    expect(result.appliedYearBuilt).toBe(2570)
    const leaf = result.template!.groups[0]!.items.find((n) => n.code === 'A1.1')!
    expect(leaf.applicable).not.toBe(false)
    // The real station lookup was still used for mode/variant resolution, but its yearBuilt value
    // itself never leaks into the resolution — confirmed via appliedYearBuilt above.
    expect(findOne).toHaveBeenCalledWith('s1')
  })

  it('an override year that predates the law redacts the item, proving the override actually drives resolution', async () => {
    const result = await service.getTemplateForAudit('s1', 'admin1', true, undefined, 2550)
    expect(result.appliedYearBuilt).toBe(2550)
    const leaf = result.template!.groups[0]!.items.find((n) => n.code === 'A1.1')!
    expect(leaf.applicable).toBe(false)
  })

  it('without an override, preview resolves against the station\'s real yearBuilt as before', async () => {
    const result = await service.getTemplateForAudit('s1', 'admin1', true)
    expect(result.appliedYearBuilt).toBe(2560)
  })

  it('the override is IGNORED outside preview mode — never a live, non-preview resolution vector', async () => {
    const result = await service.getTemplateForAudit('s1', 'auditor1', false, undefined, 2570)
    expect(result.appliedYearBuilt).toBe(2560) // real station yearBuilt, override had no effect
  })

  it('never persists anything — no checklist/station write call exists in this method at all', async () => {
    await service.getTemplateForAudit('s1', 'admin1', true, undefined, 2570)
    expect(checklistFindFirst).not.toHaveBeenCalled() // preview:true also skips the draft lookup
  })
})

describe('ChecklistsController.findTemplateForAudit — preview year override guards', () => {
  const getTemplateForAudit = jest.fn()
  const controller = new ChecklistsController({ getTemplateForAudit } as unknown as ChecklistsService)

  beforeEach(() => jest.clearAllMocks())

  it('rejects yearBuilt for a non-ADMIN caller even in preview mode', () => {
    const req = { user: { id: 'u1', username: 'a', role: 'AUDITOR' } } as never
    expect(() => controller.findTemplateForAudit('s1', '1', undefined, '2560', undefined, req)).toThrow(ForbiddenException)
    expect(getTemplateForAudit).not.toHaveBeenCalled()
  })

  it('rejects yearBuilt supplied without preview/version — has no meaning against a real audit', () => {
    const req = { user: { id: 'u1', username: 'a', role: 'ADMIN' } } as never
    expect(() => controller.findTemplateForAudit('s1', undefined, undefined, '2560', undefined, req)).toThrow(BadRequestException)
    expect(getTemplateForAudit).not.toHaveBeenCalled()
  })

  it('rejects an out-of-range yearBuilt', () => {
    const req = { user: { id: 'u1', username: 'a', role: 'ADMIN' } } as never
    expect(() => controller.findTemplateForAudit('s1', '1', undefined, '99', undefined, req)).toThrow(BadRequestException)
  })

  it('accepts a valid yearBuilt for an ADMIN in preview mode and passes it through', () => {
    getTemplateForAudit.mockResolvedValue({})
    const req = { user: { id: 'u1', username: 'a', role: 'ADMIN' } } as never
    controller.findTemplateForAudit('s1', '1', undefined, '2560', undefined, req)
    expect(getTemplateForAudit).toHaveBeenCalledWith('s1', 'u1', true, undefined, 2560, undefined)
  })

  it('rejects a buildDate override without a yearBuilt override — refines a year, not a standalone input', () => {
    const req = { user: { id: 'u1', username: 'a', role: 'ADMIN' } } as never
    expect(() => controller.findTemplateForAudit('s1', '1', undefined, undefined, '2013-01-16', req)).toThrow(BadRequestException)
    expect(getTemplateForAudit).not.toHaveBeenCalled()
  })

  it('rejects a malformed buildDate', () => {
    const req = { user: { id: 'u1', username: 'a', role: 'ADMIN' } } as never
    expect(() => controller.findTemplateForAudit('s1', '1', undefined, '2556', 'not-a-date', req)).toThrow(BadRequestException)
  })

  it('accepts a valid buildDate alongside yearBuilt and passes both through', () => {
    getTemplateForAudit.mockResolvedValue({})
    const req = { user: { id: 'u1', username: 'a', role: 'ADMIN' } } as never
    controller.findTemplateForAudit('s1', '1', undefined, '2556', '2013-01-16', req)
    expect(getTemplateForAudit).toHaveBeenCalledWith('s1', 'u1', true, undefined, 2556, '2013-01-16')
  })
})
