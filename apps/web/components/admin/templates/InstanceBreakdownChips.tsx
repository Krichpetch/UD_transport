'use client'

import { TransportBadge } from '@/components/shared/badges'
import type { InstanceBreakdown } from '@/lib/api/facility-groups'

const STATUS_LABEL: Record<string, string> = { DRAFT: 'ร่าง', ACTIVE: 'ใช้งานอยู่', RETIRED: 'เลิกใช้' }

// Session S4b, Part 1 addition — "blast radius" breakdown, shown on the browse cards/rows
// themselves (not only in the write-time fan-out preview), so an admin sees impact before
// deciding to edit. version+status both surface (via the title tooltip) so pre/post v1/v2
// retirement state stays legible when a mixed-scope view is ever used (Part 5).
export function InstanceBreakdownChips({ breakdown, compact }: { breakdown: InstanceBreakdown; compact?: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {breakdown.byMode.map((m) => {
        const tooltip = m.byVariant
          .flatMap((v) => v.byVersion.map((ver) => `${v.variantKey === 'standard' ? '' : v.variantKey + ' '}v${ver.version} (${STATUS_LABEL[ver.status] ?? ver.status}): ${ver.count}`))
          .join('\n')
        return (
          <span
            key={m.mode}
            title={tooltip}
            className={`inline-flex items-center gap-1 rounded-full ${compact ? 'px-1.5 py-0.5' : 'px-2 py-1'}`}
          >
            <TransportBadge type={m.mode} />
            <span className="text-foreground text-xs font-semibold">{m.total}</span>
          </span>
        )
      })}
    </div>
  )
}
