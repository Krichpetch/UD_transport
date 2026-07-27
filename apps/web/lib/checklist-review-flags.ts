import type { ChecklistGroup } from '@repo/types'

// Single source of truth for "is this checklist blocked from approval" on the client —
// replaces two divergent ad hoc `.filter(i => i.reviewFlag)` implementations (one on the
// stations-list approve button, one on the station-detail approve button). The frontend
// ChecklistGroup/ChecklistSubItem type (@repo/types#checklist.ts) is flat — no `subItems` — so
// there's nothing to recurse into here; v2/v3 nested templates are out of scope this session.
// The server (StationsService.approveChecklist -> hasReviewFlag) is the final authority
// regardless — this only drives the client's disable/error-message UX.
export function countReviewFlags(groups: ChecklistGroup[]): number {
  return groups.reduce((count, g) => count + g.items.filter((i) => i.reviewFlag).length, 0)
}
