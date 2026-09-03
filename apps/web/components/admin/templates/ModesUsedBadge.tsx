'use client'

import { RAIL_METRO_VARIANT_KEY, RAIL_TRAIN_VARIANT_KEY, STANDARD_VARIANT_KEY } from '@repo/types'
import { TransportBadge } from '@/components/shared/badges'
import type { InstanceBreakdown } from '@/lib/api/facility-groups'

// UDT-61, Part 1 — before this, the grouped-editor table's "ใช้ร่วมกัน" column and "สถานะ" column
// both rendered the SAME data: node.instances.length, once as "N จุด" (InstanceBreakdownChips) and
// once as "ใช้ร่วมกัน N จุด" (ClassificationBadge). The genuinely different fact — WHICH modes carry
// this item — already existed in breakdown.byMode but was buried in InstanceBreakdownChips' hover
// tooltip. This component surfaces it as its own always-visible column instead, reusing the same
// TransportBadge chips used everywhere else in the app for mode identity.
function variantLabel(mode: string, variantKey: string): string {
  if (mode !== 'ทางราง' || variantKey === STANDARD_VARIANT_KEY) return mode
  if (variantKey === RAIL_METRO_VARIANT_KEY) return 'รถไฟฟ้า'
  if (variantKey === RAIL_TRAIN_VARIANT_KEY) return 'รถไฟ'
  return mode
}

export function ModesUsedBadge({ breakdown, compact }: { breakdown: InstanceBreakdown; compact?: boolean }) {
  if (breakdown.byMode.length === 0) return null
  // De-duped across version/status — a mode counted in both a DRAFT and an ACTIVE row still shows
  // as one chip here; that version/status detail stays in InstanceBreakdownChips' tooltip.
  const labels = Array.from(new Set(breakdown.byMode.flatMap((m) => m.byVariant.map((v) => variantLabel(m.mode, v.variantKey)))))
  return (
    <div className={`flex flex-wrap items-center ${compact ? 'gap-1' : 'gap-1.5'}`}>
      {labels.map((label) => (
        <TransportBadge key={label} type={label} />
      ))}
    </div>
  )
}
