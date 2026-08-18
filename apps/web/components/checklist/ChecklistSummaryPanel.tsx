import type { ChecklistTemplateDefinition } from '@repo/types'
import { buildHistogram, scoreToStatus } from '@repo/types'
import { groupSummaryByCategory } from '@/lib/audit-form'

// Part B (auditor self-unsubmit/summary session), generalized for the "look back on my submitted
// work" review screen — the score/histogram/category-mini-dashboard/grouped-list block, shared
// between the audit page's post-submit Screen D and my-work/[id]'s review screen so there is one
// summary UI, not two independently-styled ones. Every number is re-derived from `items` via the
// exact same computeFacilityMetrics/buildHistogram/computeScoreFromItems @repo/types already uses
// everywhere else — never a second pass-counting path, so this can never drift from `score`
// (which callers pass in from the checklist's own stored/server-computed value, never recomputed
// here) — see groupSummaryByCategory's own doc for the redacted/N/A/optional handling.
export function statusColor(score: number): string {
  return score >= 75 ? 'var(--status-pass)' : score >= 50 ? 'var(--status-warn)' : 'var(--status-fail)'
}

export function ChecklistSummaryPanel({ items, templateDef, score }: {
  items: unknown
  templateDef: ChecklistTemplateDefinition | null
  score: number
}) {
  const histogram = buildHistogram(items, templateDef ?? undefined)
  const status = scoreToStatus(score)
  const color = statusColor(score)
  const categoryBuckets = groupSummaryByCategory(
    Array.isArray(items) ? (items as { groupId?: string; groupName?: string }[]) : [],
    templateDef ?? undefined,
  )

  return (
    <>
      <div className="text-center">
        <span className="text-4xl font-bold" style={{ color }}>{score}%</span>
        <p className="mt-1 text-xs font-semibold" style={{ color }}>{status}</p>
      </div>

      <div className="mt-4 divide-y divide-border border-t border-border text-sm">
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">มี ได้มาตรฐาน</span>
          <span className="font-semibold" style={{ color: 'var(--status-pass)' }}>{histogram.hasStandard}</span>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">มี ไม่ได้มาตรฐาน</span>
          <span className="font-semibold" style={{ color: 'var(--status-warn)' }}>{histogram.hasSubstandard}</span>
        </div>
        {histogram.standardUnspecified > 0 && (
          <div className="flex items-center justify-between py-2">
            <span className="text-muted-foreground">มี ไม่ระบุมาตรฐาน ⚑</span>
            <span className="font-semibold text-orange-500">{histogram.standardUnspecified}</span>
          </div>
        )}
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">ไม่มี</span>
          <span className="font-semibold" style={{ color: 'var(--status-fail)' }}>{histogram.none}</span>
        </div>
        <div className="flex items-center justify-between py-2">
          <span className="text-muted-foreground">ไม่เกี่ยวข้อง (N/A)</span>
          <span className="font-semibold text-gray-400">{histogram.na}</span>
        </div>
      </div>

      {/* Category mini-dashboard — same 3-card KPI layout the executive /dashboard uses for its
          passing/needs-improvement/failing tiles, scaled down for this mobile shell;
          ร้อยละความสำเร็จ per category (pctSuccess, the exact CLAUDE.md formula the overall score
          above already uses) is the headline where it's meaningful.
          Live feedback fix — a category made up entirely of 'presence'-only leaves (มี/ไม่มี, no
          ได้มาตรฐาน concept — group C's staffing/training items are exactly this, per
          optional-group-c.spec.ts's own fixture) has total===0 and meetsStandard===0 BY
          CONSTRUCTION (computeFacilityMetrics excludes presence-only leaves from both, see its
          own doc) even when every item was actually answered — pctSuccess would show a
          misleading 0% for a category with real, fully-answered content. Every card still shows a
          PERCENTAGE (not a bare count, so the three cards stay visually consistent) — it's the
          FORMULA that switches: pctHasFacility (ร้อยละการจัดให้มีสิ่งอำนวยความสะดวก, CLAUDE.md's
          other headline metric) counts presence-only items in both its numerator AND denominator,
          so it's the one that's actually meaningful whenever nothing is eligible for a standard. */}
      {categoryBuckets.length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <p className="mb-2 text-xs font-semibold text-foreground">สรุปผลตามหมวดหมู่</p>
          <div className="grid grid-cols-3 gap-2">
            {categoryBuckets.map((cat) => {
              const { total, hasItem, meetsStandard, facilityEligible } = cat.metrics
              const hasStandardConcept = total > 0
              const pct = Math.round(hasStandardConcept ? cat.metrics.pctSuccess : cat.metrics.pctHasFacility)
              return (
                <div key={cat.value} className="rounded-lg bg-secondary/40 p-2.5 text-center">
                  <p className="text-[10px] font-semibold text-muted-foreground">{cat.value}</p>
                  <p className="text-lg font-bold" style={{ color: statusColor(pct) }}>{pct}%</p>
                  <p className="text-[9px] text-muted-foreground">
                    {hasStandardConcept ? `${meetsStandard}/${total}` : `${hasItem}/${facilityEligible}`}
                  </p>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Grouped list — each group's มี (hasItem, includes presence-only) and ได้มาตรฐาน
          (meetsStandard/total, only where the standard concept applies) shown together, not
          collapsed into one number — see the mini-dashboard comment above for why. */}
      {categoryBuckets.length > 0 && (
        <div className="mt-4 border-t border-border pt-4 text-left">
          <p className="mb-2 text-xs font-semibold text-foreground">รายการตามหมวดหมู่</p>
          <div className="space-y-3">
            {categoryBuckets.map((cat) => (
              <div key={cat.value}>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-foreground">{cat.label}</p>
                  <p className="text-xs font-semibold text-muted-foreground">
                    มี {cat.metrics.hasItem}{cat.metrics.total > 0 && <> · ได้มาตรฐาน {cat.metrics.meetsStandard}/{cat.metrics.total}</>}
                  </p>
                </div>
                {cat.groups.length > 1 && (
                  <div className="mt-1 space-y-1 pl-2">
                    {cat.groups.map((g) => (
                      <div key={g.groupId} className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">{g.groupName}</span>
                        <span className="font-medium text-foreground">
                          มี {g.metrics.hasItem}{g.metrics.total > 0 && <> · ได้มาตรฐาน {g.metrics.meetsStandard}/{g.metrics.total}</>}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
