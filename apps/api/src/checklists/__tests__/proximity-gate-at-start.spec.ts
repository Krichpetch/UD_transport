/**
 * Session F3, Part H — the proximity gate moved from SUBMIT to START.
 *
 * สนข. 2026-08-03 (Dr.Aliz): "อยากให้การส่งงานเป็นแบบที่ กดเข้าไปทำได้แค่ตอนอยู่ใกล้สถานี แต่ถ้าเริ่มทำ
 * ไปแล้วจะอยู่ใน Draft แล้วสามารถส่งจากที่ไหนก็ได้ (ในกรณีที่เน้นวัดๆไปก่อนแล้วค่อยมาเพิ่มรูปทีหลังได้)."
 *
 * The two paths that can CREATE a checklist row are gated:
 *   1. saveDraft() with no existing DRAFT  — starting an inspection
 *   2. submit()    with no existing DRAFT  — a direct submit that starts one from nothing
 * Everything else — updating a draft, submitting a resumed one — is deliberately ungated.
 *
 * Every rung of the original ladder is preserved: training skip, env bypass, coordStatus != 'OK'
 * pass-through, GPS-required, radius. Those are re-asserted here against the NEW location so a
 * future refactor can't quietly drop one while moving code around.
 */
import { Test } from '@nestjs/testing'
import { ChecklistsService } from '../checklists.service'
import { PrismaService } from '../../prisma/prisma.service'
import { StationsService } from '../../stations/stations.service'
import { AuditLogService } from '../../audit/audit.service'
import { MinioService } from '../../minio/minio.service'

const NEAR = { lat: 13.7, lng: 100.5, accuracy: 5 }
const OK_STATION = { id: 's1', mode: 'ทางบก', railSubtype: null, coordStatus: 'OK', yearBuilt: 2560, isTraining: false }

describe('Part H — proximity gates the START, not the submit', () => {
  let service: ChecklistsService
  const checklistCreate = jest.fn()
  const checklistUpdate = jest.fn()
  const checklistFindFirst = jest.fn()
  const findOne = jest.fn()
  const distanceToStationMeters = jest.fn()
  const auditLog = jest.fn()

  beforeEach(async () => {
    jest.clearAllMocks()
    delete process.env.PROXIMITY_BYPASS
    checklistFindFirst.mockResolvedValue(null)
    checklistCreate.mockResolvedValue({ id: 'cl1' })
    checklistUpdate.mockResolvedValue({ id: 'cl1' })
    findOne.mockResolvedValue(OK_STATION)
    distanceToStationMeters.mockResolvedValue(50)

    const moduleRef = await Test.createTestingModule({
      providers: [
        ChecklistsService,
        {
          provide: PrismaService,
          useValue: {
            checklist: { create: checklistCreate, findFirst: checklistFindFirst, update: checklistUpdate },
            checklistTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
            // Consulted by submit()'s resubmit-after-unsubmit linkage check whenever an existing
            // draft is consumed — resolving to null keeps that path a no-op for these
            // proximity-focused tests (see unsubmit-return-loop.spec.ts for that behavior itself).
            auditLog: { findFirst: jest.fn().mockResolvedValue(null) },
          },
        },
        { provide: StationsService, useValue: { findOne, distanceToStationMeters } },
        { provide: AuditLogService, useValue: { log: auditLog } },
        { provide: MinioService, useValue: { getPresignedUrl: jest.fn(), remove: jest.fn() } },
      ],
    }).compile()
    service = moduleRef.get(ChecklistsService)
  })

  // ── Draft CREATION is gated ──────────────────────────────────────────────────────────────────

  describe('saveDraft — creating a draft', () => {
    it('rejects creation outside the radius', async () => {
      distanceToStationMeters.mockResolvedValue(5000)
      await expect(service.saveDraft('s1', 'u1', [], undefined, NEAR)).rejects.toMatchObject({
        response: { code: 'OUT_OF_RANGE', distanceM: 5000 },
      })
      expect(checklistCreate).not.toHaveBeenCalled()
    })

    it('rejects creation with no GPS at all on a coordStatus=OK station', async () => {
      await expect(service.saveDraft('s1', 'u1', [], undefined, undefined)).rejects.toMatchObject({
        response: { code: 'LOCATION_REQUIRED' },
      })
      expect(checklistCreate).not.toHaveBeenCalled()
    })

    it('creates the draft when inside the radius', async () => {
      await expect(service.saveDraft('s1', 'u1', [], undefined, NEAR)).resolves.toBeDefined()
      expect(checklistCreate).toHaveBeenCalled()
    })

    it('stamps the start-time GPS trail on creation', async () => {
      await service.saveDraft('s1', 'u1', [], undefined, NEAR)
      expect(checklistCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          startGpsLat: NEAR.lat,
          startGpsLng: NEAR.lng,
          startGpsAccuracy: NEAR.accuracy,
          startGpsDistanceM: 50,
          startLocationVerified: true,
          startProximityBypassed: false,
        }),
      }))
    })

    it('writes a START_CHECKLIST audit entry carrying the distance (Part H.5)', async () => {
      await service.saveDraft('s1', 'u1', [], undefined, NEAR)
      expect(auditLog).toHaveBeenCalledWith(expect.objectContaining({
        action: 'START_CHECKLIST',
        after: expect.objectContaining({ distanceM: 50, locationVerified: true }),
      }))
    })
  })

  // ── Draft UPDATE is NOT gated ────────────────────────────────────────────────────────────────

  describe('saveDraft — updating an existing draft', () => {
    beforeEach(() => {
      checklistFindFirst.mockResolvedValue({ id: 'existing-draft', appliedYearBuilt: 2560 })
    })

    it('is allowed far outside the radius', async () => {
      distanceToStationMeters.mockResolvedValue(500000)
      await expect(service.saveDraft('s1', 'u1', [], undefined, NEAR)).resolves.toBeDefined()
      expect(checklistUpdate).toHaveBeenCalled()
    })

    it('is allowed with no GPS at all — autosave must never depend on a location fix', async () => {
      await expect(service.saveDraft('s1', 'u1', [], undefined, undefined)).resolves.toBeDefined()
      expect(distanceToStationMeters).not.toHaveBeenCalled()
    })

    it('writes no START_CHECKLIST entry — the inspection was already started', async () => {
      await service.saveDraft('s1', 'u1', [], undefined, NEAR)
      const actions = auditLog.mock.calls.map((c) => c[0].action)
      expect(actions).not.toContain('START_CHECKLIST')
      expect(actions).toContain('SAVE_DRAFT')
    })
  })

  // ── Submitting a RESUMED draft is NOT gated — the whole point ────────────────────────────────

  describe('submit — with an existing draft', () => {
    beforeEach(() => {
      checklistFindFirst.mockResolvedValue({ id: 'existing-draft', appliedYearBuilt: 2560, reviewNotes: null })
    })

    it('is allowed far outside the radius', async () => {
      distanceToStationMeters.mockResolvedValue(500000)
      await expect(service.submit('s1', 'u1', [], undefined, NEAR)).resolves.toBeDefined()
      expect(checklistCreate).toHaveBeenCalled()
    })

    it('is allowed with no GPS at all', async () => {
      await expect(service.submit('s1', 'u1', [], undefined, undefined)).resolves.toBeDefined()
    })

    it('leaves the start-GPS columns untouched — presence lives on the gated DRAFT row', async () => {
      await service.submit('s1', 'u1', [], undefined, NEAR)
      const data = checklistCreate.mock.calls[0][0].data
      expect(data.startLocationVerified).toBeUndefined()
      expect(data.startGpsDistanceM).toBeUndefined()
    })

    it('still records the submit-time reading for the audit trail', async () => {
      distanceToStationMeters.mockResolvedValue(500000)
      await service.submit('s1', 'u1', [], undefined, NEAR)
      expect(checklistCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          gpsLat: NEAR.lat,
          gpsDistanceM: 500000,
          // Nothing was verified at submit time, and the column says so honestly.
          locationVerified: false,
        }),
      }))
    })
  })

  // ── A fresh submit with NO prior draft IS a start, so it IS gated ────────────────────────────

  describe('submit — with no prior draft (a start in disguise)', () => {
    it('is rejected outside the radius', async () => {
      distanceToStationMeters.mockResolvedValue(5000)
      await expect(service.submit('s1', 'u1', [], undefined, NEAR)).rejects.toMatchObject({
        response: { code: 'OUT_OF_RANGE' },
      })
    })

    it('is rejected with no GPS on a coordStatus=OK station', async () => {
      await expect(service.submit('s1', 'u1', [], undefined, undefined)).rejects.toMatchObject({
        response: { code: 'LOCATION_REQUIRED' },
      })
    })

    it('succeeds inside the radius and stamps the start trail', async () => {
      await expect(service.submit('s1', 'u1', [], undefined, NEAR)).resolves.toBeDefined()
      expect(checklistCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ startLocationVerified: true, startGpsDistanceM: 50 }),
      }))
    })
  })

  // ── Preserved rungs ──────────────────────────────────────────────────────────────────────────

  describe('the ladder is preserved rung for rung at its new location', () => {
    it('training stations skip the start gate entirely', async () => {
      findOne.mockResolvedValue({ ...OK_STATION, isTraining: true })
      await expect(service.saveDraft('s1', 'u1', [], undefined, undefined)).resolves.toBeDefined()
      expect(distanceToStationMeters).not.toHaveBeenCalled()
      expect(checklistCreate).toHaveBeenCalledWith(expect.objectContaining({
        // null, not false — a training row stays distinguishable from "gate ran, unverified".
        data: expect.objectContaining({ startLocationVerified: null }),
      }))
    })

    it.each(['APPROXIMATE', 'PENDING', 'INVALID'] as const)(
      'coordStatus=%s passes the start gate without a distance check',
      async (coordStatus) => {
        findOne.mockResolvedValue({ ...OK_STATION, coordStatus })
        await expect(service.saveDraft('s1', 'u1', [], undefined, undefined)).resolves.toBeDefined()
        expect(distanceToStationMeters).not.toHaveBeenCalled()
        expect(checklistCreate).toHaveBeenCalledWith(expect.objectContaining({
          data: expect.objectContaining({ startLocationVerified: false }),
        }))
      },
    )

    it('env bypass skips the check but never fakes a passing one', async () => {
      process.env.APP_ENV = 'development'
      process.env.PROXIMITY_BYPASS = 'true'
      await expect(service.saveDraft('s1', 'u1', [], undefined, undefined)).resolves.toBeDefined()
      expect(distanceToStationMeters).not.toHaveBeenCalled()
      expect(checklistCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          startLocationVerified: false,   // genuinely unverified
          startProximityBypassed: true,
        }),
      }))
    })

    it('env bypass stays fail-closed in production', async () => {
      process.env.APP_ENV = 'production'
      process.env.PROXIMITY_BYPASS = 'true'
      // Bypass is refused, so the real gate runs and rejects the missing GPS.
      await expect(service.saveDraft('s1', 'u1', [], undefined, undefined)).rejects.toMatchObject({
        response: { code: 'LOCATION_REQUIRED' },
      })
    })

    it('never trusts a client-supplied "near" claim — distance is recomputed server-side', async () => {
      distanceToStationMeters.mockResolvedValue(9999)
      await expect(
        service.saveDraft('s1', 'u1', [], undefined, { ...NEAR, accuracy: 0 }),
      ).rejects.toMatchObject({ response: { code: 'OUT_OF_RANGE' } })
      expect(distanceToStationMeters).toHaveBeenCalledWith('s1', NEAR.lat, NEAR.lng)
    })
  })
})
