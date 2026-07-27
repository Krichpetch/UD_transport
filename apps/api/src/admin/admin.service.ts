import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const RETURNED_WORK_LIST_CAP = 50

// Same "latest checklist per (stationId, auditorId)" selection StationsService.computeMetrics
// and ChecklistsService's rejection-return-loop helpers already use — any of these three
// statuses, most recent submittedAt wins per pair.
const LATEST_CHECKLIST_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED'] as const

interface RawOverviewData {
  submittedChecklists: {
    id: string
    stationId: string
    submittedAt: Date | null
    station: { nameTh: string }
    auditor: { username: string }
  }[]
  latestPerStationAuditor: {
    stationId: string
    status: string
    submittedAt: Date | null
    reviewedAt: Date | null
    reviewNotes: string | null
    station: { nameTh: string }
    auditor: { username: string }
  }[]
  submissionsLast7DaysCount: number
  neverAuditedInScopeCount: number
  approximateOrPendingCoordsCount: number
  activeAuditorIds: string[]
}

interface OverviewMetric {
  key: string
  label: string
  value: (raw: RawOverviewData) => number
}

// Typed config array — adding the next metric that doesn't need new source data is one entry
// here, not a new endpoint. A metric needing genuinely new source data still needs one more
// query in getOverview()'s Promise.all below, same as any of the six already do.
const OVERVIEW_METRICS: OverviewMetric[] = [
  {
    key: 'pendingReviews',
    label: 'รอการอนุมัติ',
    value: (raw) => raw.submittedChecklists.length,
  },
  {
    key: 'submissionsLast7Days',
    label: 'ส่งรายงานใน 7 วันที่ผ่านมา',
    value: (raw) => raw.submissionsLast7DaysCount,
  },
  {
    key: 'rejectedAwaitingResubmission',
    label: 'ถูกปฏิเสธ รอส่งใหม่',
    value: (raw) => raw.latestPerStationAuditor.filter((r) => r.status === 'REJECTED').length,
  },
  {
    key: 'neverAuditedInScope',
    label: 'สถานีในขอบเขตที่ยังไม่เคยตรวจ',
    value: (raw) => raw.neverAuditedInScopeCount,
  },
  {
    key: 'approximateOrPendingCoords',
    label: 'สถานีพิกัดยังไม่ยืนยัน',
    value: (raw) => raw.approximateOrPendingCoordsCount,
  },
  {
    key: 'activeAuditors7d',
    label: 'ผู้ตรวจที่ Active ใน 7 วัน',
    value: (raw) => raw.activeAuditorIds.length,
  },
]

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // Every number here comes from one of exactly 6 bounded queries below (Promise.all'd
  // together) — no per-station loops, no N+1. The two actionable lists are sliced from the
  // same two result sets the metrics already derive from (submittedChecklists /
  // latestPerStationAuditor), not separate queries.
  async getOverview() {
    const since7d = new Date(Date.now() - SEVEN_DAYS_MS)

    const [
      submittedChecklists,
      latestPerStationAuditor,
      submissionsLast7DaysCount,
      neverAuditedInScopeCount,
      approximateOrPendingCoordsCount,
      activeAuditorRows,
    ] = await Promise.all([
      this.prisma.checklist.findMany({
        where: { status: 'SUBMITTED' },
        select: {
          id: true,
          stationId: true,
          submittedAt: true,
          station: { select: { nameTh: true } },
          auditor: { select: { username: true } },
        },
      }),
      this.prisma.checklist.findMany({
        where: { status: { in: [...LATEST_CHECKLIST_STATUSES] } },
        select: {
          stationId: true,
          status: true,
          submittedAt: true,
          reviewedAt: true,
          reviewNotes: true,
          station: { select: { nameTh: true } },
          auditor: { select: { username: true } },
        },
        distinct: ['stationId', 'auditorId'],
        orderBy: [{ stationId: 'asc' }, { auditorId: 'asc' }, { submittedAt: 'desc' }],
      }),
      this.prisma.checklist.count({ where: { submittedAt: { gte: since7d } } }),
      this.prisma.station.count({ where: { scope: 'IN_SCOPE', checklists: { none: {} } } }),
      this.prisma.station.count({ where: { coordStatus: { in: ['APPROXIMATE', 'PENDING'] } } }),
      this.prisma.checklist.findMany({
        where: { updatedAt: { gte: since7d } },
        select: { auditorId: true },
        distinct: ['auditorId'],
      }),
    ])

    const raw: RawOverviewData = {
      submittedChecklists,
      latestPerStationAuditor,
      submissionsLast7DaysCount,
      neverAuditedInScopeCount,
      approximateOrPendingCoordsCount,
      activeAuditorIds: activeAuditorRows.map((r) => r.auditorId),
    }

    return {
      metrics: OVERVIEW_METRICS.map((m) => ({ key: m.key, label: m.label, value: m.value(raw) })),
      pendingReviewsList: submittedChecklists
        .slice()
        .sort((a, b) => (b.submittedAt?.getTime() ?? 0) - (a.submittedAt?.getTime() ?? 0))
        .map((c) => ({
          checklistId: c.id,
          stationId: c.stationId,
          stationNameTh: c.station.nameTh,
          auditorUsername: c.auditor.username,
          submittedAt: c.submittedAt,
        })),
      returnedWorkList: latestPerStationAuditor
        .filter((r) => r.status === 'REJECTED')
        .sort((a, b) => (b.reviewedAt?.getTime() ?? 0) - (a.reviewedAt?.getTime() ?? 0))
        .slice(0, RETURNED_WORK_LIST_CAP)
        .map((r) => ({
          stationId: r.stationId,
          stationNameTh: r.station.nameTh,
          auditorUsername: r.auditor.username,
          reviewedAt: r.reviewedAt,
          reviewNotes: r.reviewNotes,
        })),
    }
  }
}
