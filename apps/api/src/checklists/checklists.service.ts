import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common'
import { ChecklistStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { StationsService } from '../stations/stations.service'
import { AuditLogService } from '../audit/audit.service'
import { isProximityBypassActive } from '../config/validate-env'
import { computeScoreFromItems } from './scoring'

const PROXIMITY_RADIUS_M = 1000

export interface SubmitGps {
  lat: number
  lng: number
  accuracy?: number
}

@Injectable()
export class ChecklistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stations: StationsService,
    private readonly auditLog: AuditLogService,
  ) {}

  findDraft(stationId: string, auditorId: string) {
    return this.prisma.checklist.findFirst({
      where: { stationId, auditorId, status: ChecklistStatus.DRAFT },
    })
  }

  async findLatest(stationId: string) {
    const cl = await this.prisma.checklist.findFirst({
      where: { stationId, status: { in: [ChecklistStatus.SUBMITTED, ChecklistStatus.APPROVED, ChecklistStatus.REJECTED] } },
      orderBy: { submittedAt: 'desc' },
      include: { auditor: { select: { username: true } } },
    })
    if (!cl) return null
    const { auditor, ...rest } = cl
    return { ...rest, auditorUsername: auditor?.username ?? null }
  }

  findAll(stationId: string) {
    return this.prisma.checklist.findMany({
      where: { stationId },
      orderBy: { createdAt: 'desc' },
      include: { auditor: { select: { id: true, username: true } } },
    })
  }

  async saveDraft(stationId: string, auditorId: string, items: unknown) {
    const existing = await this.prisma.checklist.findFirst({
      where: { stationId, auditorId, status: 'DRAFT' },
    })

    const checklist = existing
      ? await this.prisma.checklist.update({
          where: { id: existing.id },
          data: { items: items as object, updatedAt: new Date() },
        })
      : await this.prisma.checklist.create({
          data: { stationId, auditorId, items: items as object, status: 'DRAFT' },
        })

    await this.auditLog.log({
      userId: auditorId,
      action: 'SAVE_DRAFT',
      entityType: 'Checklist',
      entityId: checklist.id,
      after: { stationId, status: 'DRAFT' },
    })
    return checklist
  }

  // Proximity gate — recomputes distance server-side; a client "isNear" flag is never trusted.
  //   - coordStatus=OK station: GPS required, must be within PROXIMITY_RADIUS_M or the submit
  //     is rejected (frontend is expected to save the work as a draft on this error).
  //   - coordStatus!=OK station (APPROXIMATE/PENDING): can't be distance-gated (coords may be
  //     tens of km off) — allowed through, but locationVerified=false so the app can still show
  //     an "unverified location" warning.
  //   - Dev/staging bypass: a server-side env switch (APP_ENV + PROXIMITY_BYPASS), never a
  //     client-supplied flag — isProximityBypassActive() is the sole authority and is itself
  //     fail-closed in production (see validateEnv). Any bypassRequested the client sends is
  //     ignored outright.
  async submit(
    stationId: string,
    auditorId: string,
    items: unknown,
    _clientScore?: number,
    gps?: SubmitGps,
  ) {
    const station = await this.stations.findOne(stationId)
    const bypassAllowed = isProximityBypassActive()

    let distanceM: number | null = null
    let locationVerified = false

    if (bypassAllowed) {
      // Genuinely unverified — bypass skips the check, it doesn't fake a passing one.
      locationVerified = false
    } else if (station.coordStatus !== 'OK') {
      locationVerified = false
    } else {
      if (gps?.lat == null || gps?.lng == null) {
        throw new ForbiddenException({
          code: 'LOCATION_REQUIRED',
          message: 'ต้องเปิดใช้งาน GPS เพื่อส่งรายงาน',
        })
      }
      distanceM = await this.stations.distanceToStationMeters(stationId, gps.lat, gps.lng)
      if (distanceM === null || distanceM > PROXIMITY_RADIUS_M) {
        throw new BadRequestException({
          code: 'OUT_OF_RANGE',
          message: 'คุณอยู่นอกพื้นที่สถานี ไม่สามารถส่งรายงานได้',
          distanceM,
        })
      }
      locationVerified = true
    }

    // Re-derive score server-side; never trust the client-supplied value.
    const score = computeScoreFromItems(items)
    const checklist = await this.prisma.checklist.create({
      data: {
        stationId,
        auditorId,
        items: items as object,
        score,
        status: 'SUBMITTED',
        submittedAt: new Date(),
        gpsLat:      gps?.lat ?? null,
        gpsLng:      gps?.lng ?? null,
        gpsAccuracy: gps?.accuracy ?? null,
        gpsDistanceM: distanceM,
        locationVerified,
        proximityBypassed: bypassAllowed,
      },
    })

    await this.auditLog.log({
      userId: auditorId,
      action: 'SUBMIT_CHECKLIST',
      entityType: 'Checklist',
      entityId: checklist.id,
      after: { stationId, status: 'SUBMITTED', score },
    })
    return checklist
  }
}
