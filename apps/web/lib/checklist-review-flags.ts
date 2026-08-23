// Single source of truth for "is this checklist blocked from approval" on the client —
// replaces two divergent ad hoc `.filter(i => i.reviewFlag)` implementations (one on the
// stations-list approve button, one on the station-detail approve button).
//
// Admin checklist-review refresh — widened to recurse into `subItems`, matching how the server's
// own hasReviewFlag/setItemFlag (StationsService) already walk a v2/v3 StoredChecklistNode tree.
// The old flat-only version silently undercounted any flag set on a nested leaf, which meant the
// approve button's disable-gate could be bypassed for exactly the checklists (v2/v3) this review
// screen now renders in full. Flat v1 ChecklistGroup[]/ChecklistSubItem[] still works unchanged —
// it just never has a `subItems` array to recurse into. The server is still the final authority
// regardless — this only drives the client's disable/error-message UX.
interface FlaggableNode {
  reviewFlag?: boolean
  subItems?: FlaggableNode[]
}
interface FlaggableGroup {
  items: FlaggableNode[]
}

function countNodeFlags(nodes: FlaggableNode[]): number {
  return nodes.reduce(
    (count, n) => count + (n.reviewFlag ? 1 : 0) + (n.subItems ? countNodeFlags(n.subItems) : 0),
    0,
  )
}

export function countReviewFlags(groups: FlaggableGroup[]): number {
  return groups.reduce((count, g) => count + countNodeFlags(g.items), 0)
}
