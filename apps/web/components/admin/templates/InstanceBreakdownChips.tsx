'use client'

import type { InstanceBreakdown } from '@/lib/api/facility-groups'

const STATUS_LABEL: Record<string, string> = { DRAFT: 'ร่าง', ACTIVE: 'ใช้งานอยู่', RETIRED: 'เลิกใช้' }

// Session S4b, Part 1 addition — "blast radius" breakdown, shown on the browse cards/rows
// themselves (not only in the write-time fan-out preview), so an admin sees impact before
// deciding to edit.
//
// Session S5-fix (round 6) — used to render one badge PER MODE (icon + count), which in a
// table cell (round 5's column layout) wrapped awkwardly for anything shared across several
// modes. Now a single "N จุด" badge with the full mode/variant/version/status breakdown moved
// into its hover tooltip — same information, just not fighting the row for horizontal space.
export function InstanceBreakdownChips({ breakdown, compact }: { breakdown: InstanceBreakdown; compact?: boolean }) {
  const tooltip = breakdown.byMode
    .flatMap((m) =>
      m.byVariant.flatMap((v) =>
        v.byVersion.map(
          (ver) => `${m.mode}${v.variantKey === 'standard' ? '' : ' ' + v.variantKey} v${ver.version} (${STATUS_LABEL[ver.status] ?? ver.status}): ${ver.count}`,
        ),
      ),
    )
    .join('\n')

  return (
    <span
      title={tooltip}
      className={`bg-secondary/60 text-foreground inline-flex items-center gap-1 rounded-full font-semibold ${compact ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm'}`}
    >
      {breakdown.total}
      <span className="text-muted-foreground font-normal">จุด</span>
    </span>
  )
}
