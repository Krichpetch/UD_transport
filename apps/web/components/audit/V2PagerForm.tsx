'use client'

import * as React from 'react'
import type { TemplateNode } from '@repo/types'
import { useAuditFormStore } from '@/stores/audit-form.store'
import { computeContainerStatus, collectLeafCodes } from '@/lib/audit-form'
import { LeafAnswerRow } from '@/components/audit/LeafAnswerRow'

// E-form redesign (Session E2 follow-up) — replaces the earlier accordion-of-groups with an
// item-level pager matching the v1 pager's pattern one level deeper: (A1) ที่จอดรถ paginates to
// A1.1, then A1.2, and so on (see page.tsx, which owns the group/item index and page chrome).
// This file renders the CONTENT of one item's page: its own answer (if it's a hybrid node — own
// answerType AND subItems) or a real มี/ไม่มี control (if it's a pure container), then every
// criterion beneath it, recursively.

const INACTIVE = 'border-border bg-white text-muted-foreground'

// Which of the 3 container-level options was last clicked THIS session. Deliberately LOCAL, not
// derived from descendant answers: มี/ไม่มี/ไม่เกี่ยวข้อง all need to highlight the instant they're
// clicked (a UX requirement — "มี" clicked with nothing yet answered below it must still look
// selected, not wait for the auditor's next action to light up), and ไม่มี/ไม่เกี่ยวข้อง both
// cascade to the exact same underlying state (every descendant N/A — see markAbsent/markNA), so
// there is no data-derived way to tell them apart after the fact anyway. Trade-off: on a cold
// reload, a container previously marked ไม่มี or ไม่เกี่ยวข้อง both show as neutral (no button
// highlighted) until re-clicked, since local state doesn't persist — only which OUTCOME (children
// hidden + descendants N/A) survives, not which of the two reasons produced it.
type ContainerChoice = 'มี' | 'ไม่มี' | 'ไม่เกี่ยวข้อง' | null

// A pure container (no own answerType, e.g. ทางลาด holding A1.1-1/-2/-3) — a real 3-way มี/ไม่มี/
// ไม่เกี่ยวข้อง choice:
//   - มี: reveals the children so the auditor answers the applicable one individually.
//   - ไม่มี: the facility is required but genuinely absent here.
//   - ไม่เกี่ยวข้อง: this whole item doesn't apply to this station at all.
// ไม่มี and ไม่เกี่ยวข้อง both cascade N/A onto EVERY descendant leaf (see collectLeafCodes) and
// hide the children — the auditor never has to open A1.1-1/-2/-3 individually just to mark them
// ไม่เกี่ยวข้อง one at a time. (Scoring note: this means a genuinely-missing required facility and
// a not-applicable one are currently scored identically — both fully excluded via N/A, since the
// container itself is never an independent scored leaf, only its children are. Distinguishing
// "missing, should count against the score" from "N/A, excluded entirely" at the container level
// would need a real template-level answer, which was explicitly deferred earlier this session.)
function ContainerNode({ node, breadcrumb, disabled }: { node: TemplateNode; breadcrumb: string[]; disabled: boolean }) {
  const answers = useAuditFormStore((s) => s.answers)
  const setAnswersBulk = useAuditFormStore((s) => s.setAnswersBulk)
  const status = computeContainerStatus(node, answers)
  const [choice, setChoice] = React.useState<ContainerChoice>(() => (status === 'มี' || status === 'บางส่วน') ? 'มี' : null)
  const childrenVisible = choice === 'มี' || status === 'มี' || status === 'บางส่วน'
  const childBreadcrumb = [...breadcrumb, node.labelTh]

  function cascade(value: 'N/A' | null) {
    const codes = collectLeafCodes(node)
    setAnswersBulk(Object.fromEntries(codes.map((c) => [c, { value, present: null, meetsStandard: false, values: {} }])))
  }

  function selectPresent() {
    if (choice !== 'มี') cascade(null) // undo a previous ไม่มี/ไม่เกี่ยวข้อง cascade — fillable again
    setChoice('มี')
  }
  function selectAbsent() {
    cascade('N/A')
    setChoice('ไม่มี')
  }
  function selectNA() {
    cascade('N/A')
    setChoice('ไม่เกี่ยวข้อง')
  }

  return (
    <div className={disabled ? 'pointer-events-none opacity-40' : ''}>
      <p className="px-4 pt-2.5 text-xs font-semibold text-gray-600">{node.num ? `${node.num}. ` : ''}{node.labelTh}</p>
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
      {childrenVisible && node.subItems && (
        <div className="ml-3 border-l border-border pl-1">
          {node.subItems.map((c) => <CriterionNode key={c.code} node={c} breadcrumb={childBreadcrumb} disabled={disabled} />)}
        </div>
      )}
    </div>
  )
}

// An answerable criterion. Children are HIDDEN (not merely disabled) until this node's own
// answer is มี (Part C.5 "answerable containers"); toggling back to ไม่มี/unanswered hides them
// again without wiping their already-entered answers (still in the store, just not rendered).
function LeafNode({ node, breadcrumb, disabled }: { node: TemplateNode; breadcrumb: string[]; disabled: boolean }) {
  const answer = useAuditFormStore((s) => s.answers[node.code])
  const isPresent =
    node.answerType === 'choice' ? answer?.value === 'มี' : answer?.present === true
  const childBreadcrumb = [...breadcrumb, node.labelTh]

  return (
    <div className={node.subItems ? 'border-b border-border last:border-0' : ''}>
      <LeafAnswerRow node={node} disabled={disabled} breadcrumb={breadcrumb} />
      {node.subItems && isPresent && (
        <div className="ml-4 border-l border-border pl-2">
          {node.subItems.map((c) => <CriterionNode key={c.code} node={c} breadcrumb={childBreadcrumb} disabled={disabled} />)}
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
