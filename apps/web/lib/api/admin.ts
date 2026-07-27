import { api } from '@/lib/api'

export interface AdminOverviewMetric {
  key: string
  label: string
  value: number
}

export interface AdminPendingReviewRow {
  checklistId: string
  stationId: string
  stationNameTh: string
  auditorUsername: string
  submittedAt: string | null
}

export interface AdminReturnedWorkRow {
  stationId: string
  stationNameTh: string
  auditorUsername: string
  reviewedAt: string | null
  reviewNotes: string | null
}

export interface AdminOverview {
  metrics: AdminOverviewMetric[]
  pendingReviewsList: AdminPendingReviewRow[]
  returnedWorkList: AdminReturnedWorkRow[]
}

export function getAdminOverview() {
  return api.get<AdminOverview>('/admin/overview')
}
