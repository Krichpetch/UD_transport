/**
 * Session S4b, Part 5.2b — verifies a stamped-to-v1/v2 checklist keeps resolving/scoring/rendering
 * correctly after its template is RETIRED (a precondition for retire-templates.ts being safe to
 * ever run). Checklist.templateId is a plain, unfiltered Prisma FK (see prisma/schema.prisma) —
 * following it never applies a status filter, so this is largely a documentation-by-test of an
 * invariant the schema already guarantees. What's actually worth locking down: approveChecklist's
 * re-score (StationsService.approveChecklist) calls computeScoreFromItems(cl.items) with NO
 * templateDef argument at all — scoring an already-submitted checklist never touches the template
 * (its own row, RETIRED or not) in any way. The mocked PrismaService below deliberately has no
 * `checklistTemplate` provider at all: if a future change made approval consult the template,
 * this test would fail with "checklistTemplate is not a function" rather than silently passing.
 */
import { StationsService } from '../stations.service'
import { PrismaService } from '../../prisma/prisma.service'
import { AuditLogService } from '../../audit/audit.service'
import { Test } from '@nestjs/testing'

describe('StationsService.approveChecklist — historical checklists survive template retirement', () => {
  let service: StationsService
  const findFirst = jest.fn()
  const txFindFirst = jest.fn()
  const txChecklistUpdate = jest.fn()
  const txStationUpdate = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    const moduleRef = await Test.createTestingModule({
      providers: [
        StationsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { findFirst },
            // Deliberately NO `checklistTemplate` key — see file header. Any code path that tried
            // to read `prisma.checklistTemplate.*` here would throw "not a function", not silently
            // return undefined, so this test fails loudly if that invariant is ever broken.
            $transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
              cb({
                checklist: { findFirst: txFindFirst, update: txChecklistUpdate },
                station: { update: txStationUpdate },
              }),
          },
        },
        { provide: AuditLogService, useValue: { log: auditLog } },
      ],
    }).compile()
    service = moduleRef.get(StationsService)
  })

  it('re-scores and approves correctly from stored items alone, with templateId pointing at a RETIRED row', async () => {
    const submittedAt = new Date()
    // The stamp itself (Checklist.templateId/templateVersion) — frozen at creation, per the model's
    // own doc — points at a v1 template that is now RETIRED. Neither field is even read by
    // approveChecklist; included here only to make the scenario explicit.
    const checklist = {
      id: 'cl1',
      stationId: 's1',
      status: 'SUBMITTED',
      submittedAt,
      templateId: 'v1-land-retired',
      templateVersion: 1,
      items: [
        {
          code: 'A',
          items: [
            { id: 'A1', answerType: 'presence_standard', present: true, values: {}, standard: true },
            { id: 'A2', answerType: 'presence_standard', present: true, values: {}, standard: false },
          ],
        },
      ],
    }
    findFirst.mockResolvedValue(checklist)
    txFindFirst.mockResolvedValue(checklist)
    txChecklistUpdate.mockResolvedValueOnce({ ...checklist, status: 'APPROVED' }).mockResolvedValueOnce({})
    txStationUpdate.mockResolvedValue({})

    const result = await service.approveChecklist('s1', 'cl1')

    expect(result.status).toBe('APPROVED')
    // The score write happened — computed purely from `items`, no template lookup occurred (there
    // is no checklistTemplate mock to have called in the first place).
    expect(txChecklistUpdate).toHaveBeenCalledTimes(2)
    const scoreCall = txChecklistUpdate.mock.calls[1]![0] as { data: { score: number } }
    expect(typeof scoreCall.data.score).toBe('number')
    expect(txStationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ score: scoreCall.data.score }) }),
    )
  })
})
