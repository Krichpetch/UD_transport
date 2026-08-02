'use client'

import * as React from 'react'
import type { TemplateNode } from '@repo/types'
import { useAuditFormStore } from '@/stores/audit-form.store'
import { computeContainerStatus, collectLeafCodes, collectLeaves, absentPatchFor, NA_CASCADE_PATCH, isNodeFullyRedacted } from '@/lib/audit-form'
import { LeafAnswerRow } from '@/components/audit/LeafAnswerRow'
import { NodeReferenceImages } from '@/components/audit/NodeReferenceImages'

// E-form redesign (Session E2 follow-up) — replaces the earlier accordion-of-groups with an
// item-level pager matching the v1 pager's pattern one level deeper: (A1) ที่จอดรถ paginates to
// A1.1, then A1.2, and so on (see page.tsx, which owns the group/item index and page chrome).
// This file renders the CONTENT of one item's page: its own answer (if it's a hybrid node — own
// answerType AND subItems) or a real มี/ไม่มี control (if it's a pure container), then every
// criterion beneath it, recursively.

const INACTIVE = 'border-border bg-white text-muted-foreground'

// Session F1, Part A — replaces the older disable/collapse cascade. Fully DERIVED from
// computeContainerStatus, not local click-only state: unlike the pre-F1 version, ไม่มี is now a
// REAL per-leaf answer (Part A.3), and ไม่เกี่ยวข้อง was already independently derivable (every
// descendant N/A) — so a cold-reloaded container's buttons correctly reflect which of the three
// states it's actually in, with no "which reason produced this" ambiguity left for either case.
type ContainerChoice = 'มี' | 'ไม่มี' | 'ไม่เกี่ยวข้อง' | null

function deriveChoice(status: ReturnType<typeof computeContainerStatus>): ContainerChoice {
  if (status === 'มี' || status === 'บางส่วน') return 'มี'
  if (status === 'ไม่มี') return 'ไม่มี'
  if (status === 'ไม่เกี่ยวข้อง') return 'ไม่เกี่ยวข้อง'
  return null
}

// A pure container (no own answerType, e.g. ทางลาด holding A1.1-1/-2/-3) — a real 3-way มี/ไม่มี/
// ไม่เกี่ยวข้อง choice. Part A default: every descendant is VISIBLE from the start (nothing hidden
// behind an unanswered parent) — only ไม่เกี่ยวข้อง collapses the subtree; ไม่มี keeps children
// visible showing the auto-filled ไม่มี answer, inputs disabled.
//   - มี: children enabled for normal filling.
//   - ไม่มี: every descendant leaf auto-fills as a REAL ไม่มี answer (Part A.3 — counts against
//     การจัดให้มีฯ, not excluded like N/A); visible, disabled.
//   - ไม่เกี่ยวข้อง: the whole subtree collapses; every descendant becomes N/A (excluded from every
//     denominator — unchanged from the E2-era behavior).
// Toggling back to มี restores each descendant's pre-cascade answer from the store's stash (Part
// A.5) — never the auto-filled/N/A value overwriting a real prior manual answer.
function ContainerNode({ node, breadcrumb, disabled }: { node: TemplateNode; breadcrumb: string[]; disabled: boolean }) {
  const answers = useAuditFormStore((s) => s.answers)
  const stashAndCascade = useAuditFormStore((s) => s.stashAndCascade)
  const restoreStash = useAuditFormStore((s) => s.restoreStash)
  const status = computeContainerStatus(node, answers)
  const choice = deriveChoice(status)
  const childrenCollapsed = choice === 'ไม่เกี่ยวข้อง'
  const childrenDisabledByParent = choice === 'ไม่มี'
  const childBreadcrumb = [...breadcrumb, node.labelTh]

  function selectPresent() {
    // Only a real transition out of ไม่มี/ไม่เกี่ยวข้อง needs restoring — clicking มี while already
    // มี/บางส่วน/unanswered has nothing cascaded to undo.
    if (choice === 'ไม่มี' || choice === 'ไม่เกี่ยวข้อง') restoreStash(collectLeafCodes(node))
  }
  function selectAbsent() {
    const leaves = collectLeaves(node)
    stashAndCascade(Object.fromEntries(leaves.map((l) => [l.code, absentPatchFor(l)])))
  }
  function selectNA() {
    const codes = collectLeafCodes(node)
    stashAndCascade(Object.fromEntries(codes.map((c) => [c, NA_CASCADE_PATCH])))
  }

  return (
    <div className={disabled ? 'pointer-events-none opacity-40' : ''}>
      <p className="px-4 pt-2.5 text-xs font-semibold text-gray-600">{node.num ? `${node.num}. ` : ''}{node.labelTh}</p>
      {/* Reference images (W2-S3a Part D) — after the category name, before the มี/ไม่มี/
          ไม่เกี่ยวข้อง choices. This is the common case: most admin-attached images live at this
          AX.X container level, not drilled down into individual sub-criteria. */}
      <NodeReferenceImages node={node} className="px-4 pb-2" />
      <div className="flex gap-2 px-4 pb-2.5 pt-1.5">
        <button
          onClick={selectPresent}
          className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition-all ${choice === 'มี' ? 'border-blue-300 bg-blue-50 text-blue-700' : INACTIVE}`}
        >
          มี
        </button>
        <button
          onClick={selectAbsent}
          className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition-all ${choice === 'ไม่มี' ? 'border-red-200 bg-red-50 text-red-700' : INACTIVE}`}
        >
          ไม่มี
        </button>
        <button
          onClick={selectNA}
          className={`flex-1 rounded-lg border py-1.5 text-xs font-medium transition-all ${choice === 'ไม่เกี่ยวข้อง' ? 'border-gray-300 bg-gray-100 text-gray-600' : INACTIVE}`}
        >
          ไม่เกี่ยวข้อง
        </button>
      </div>
      {!childrenCollapsed && node.subItems && (
        <div className="ml-3 border-l border-border pl-1">
          {/* Part C.3 — a fully era-redacted child is never rendered as an answerable row (it's
              surfaced only in the per-group collapsed footer note, see the summary page). */}
          {node.subItems.filter((c) => !isNodeFullyRedacted(c)).map((c) => (
            <CriterionNode key={c.code} node={c} breadcrumb={childBreadcrumb} disabled={disabled || childrenDisabledByParent} />
          ))}
        </div>
      )}
    </div>
  )
}

// An answerable criterion that ALSO carries its own finer subItems (a "hybrid" node — its own
// มี/ไม่มี/ไม่เกี่ยวข้อง answer lives in LeafAnswerRow, which cascades onto these children exactly
// like ContainerNode's buttons do — see LeafAnswerRow's handleSetAnswer). Part A default: children
// always visible; only ไม่เกี่ยวข้อง (N/A) collapses them, ไม่มี keeps them visible+disabled.
function LeafNode({ node, breadcrumb, disabled }: { node: TemplateNode; breadcrumb: string[]; disabled: boolean }) {
  const answer = useAuditFormStore((s) => s.answers[node.code])
  const isAbsent = node.answerType === 'choice' ? answer?.value === 'ไม่มี' : answer?.present === false
  const isNA = answer?.value === 'N/A'
  const childBreadcrumb = [...breadcrumb, node.labelTh]

  return (
    <div className={node.subItems ? 'border-b border-border last:border-0' : ''}>
      <LeafAnswerRow node={node} disabled={disabled} breadcrumb={breadcrumb} />
      {!isNA && node.subItems && (
        <div className="ml-4 border-l border-border pl-2">
          {node.subItems.filter((c) => !isNodeFullyRedacted(c)).map((c) => (
            <CriterionNode key={c.code} node={c} breadcrumb={childBreadcrumb} disabled={disabled || isAbsent} />
          ))}
        </div>
      )}
    </div>
  )
}

function CriterionNode({ node, breadcrumb, disabled }: { node: TemplateNode; breadcrumb: string[]; disabled: boolean }) {
  if (node.answerType) return <LeafNode node={node} breadcrumb={breadcrumb} disabled={disabled} />
  return <ContainerNode node={node} breadcrumb={breadcrumb} disabled={disabled} />
}

export function V2ItemPage({ item, groupLabel }: { item: TemplateNode; groupLabel: string }) {
  return (
    <div className="divide-y divide-border">
      <CriterionNode node={item} breadcrumb={[groupLabel]} disabled={false} />
    </div>
  )
}
