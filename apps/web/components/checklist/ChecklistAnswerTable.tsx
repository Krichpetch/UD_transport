'use client'

import * as React from 'react'
import { ChevronRight, Flag } from 'lucide-react'
import type { TemplateNode } from '@repo/types'
import { deriveMeasuredStandard } from '@repo/types'
import { isNodeFullyRedacted, computeContainerStatus, type AnswerMap } from '@/lib/audit-form'
import { measurementSummary } from '@/components/audit/ThresholdModal'
import { MeasurementInput } from '@/components/audit/LeafAnswerRow'
import { useAuditFormStore } from '@/stores/audit-form.store'
import { ChecklistPhotoGallery } from '@/components/checklist/ChecklistPhotoGallery'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

// Admin checklist-review refresh (table request) — a table-shaped readOnly renderer for one
// page's worth of nodes (v1: a whole group's items; v2/v3: a single top-level item's subtree),
// used instead of the card-stacked LeafAnswerRow/V2ItemPage on the admin review screen. Mirrors
// CLAUDE.md's mandated column order (รหัส | รายการ | มี | ไม่มี | ได้มาตรฐาน | หลักฐาน | พบปัญหา,
// the actual live label for what CLAUDE.md still calls พลิกฉาก), except หลักฐาน and everything the
// v2/v3 measured-answer engine adds (มาตรฐาน/threshold, ค่าที่วัดได้, the auditor's note) live in a
// SECOND, full-width detail row directly beneath each item's main row — rendered only when there's
// actually something to show — rather than as their own always-visible columns: an earlier version
// tried a threshold column gated on the answer being 'present', which was blank for every ไม่มี/
// unanswered row (a threshold is a static template property, unrelated to the recorded answer);
// this version computes it unconditionally off node.measurements, so that mistake can't recur.
//
// The measured-value section reuses LeafAnswerRow's own MeasurementInput (readOnly) rather than
// a plain-text summary — live feedback was that plain text wasn't readable, and the live auditor
// form already has a well-worked-out presentation (labeled boxes, the blue threshold line,
// slope/tiered layouts) worth matching exactly rather than re-inventing.
//
// Deliberately a fresh component, not LeafAnswerRow reused via CSS: LeafAnswerRow is a card layout
// with editable-form plumbing (photo picker, note textarea) that has no table analogue here — this
// only ever renders, reusing the SAME scoring-critical helpers (deriveMeasuredStandard,
// measurementSummary) so the verdict/threshold text can never drift from what the live form and
// the server both compute.

const DOT_INACTIVE = 'border-border/40'
// MeasurementInput's setAnswer is only ever invoked by an onChange on its (disabled, in readOnly
// mode) inputs — never actually called here, but the prop is required.
const noopSetAnswer = () => {}

// มี/ไม่มี dot pair, shared shape between choice/presence/presence_standard rows — value is
// 'มี' | 'ไม่มี' | 'N/A' | 'redacted' | null (unanswered).
function PresenceCells({ state }: { state: 'มี' | 'ไม่มี' | 'N/A' | 'redacted' | null }) {
  if (state === 'redacted') {
    return (
      <>
        <td className="px-3 py-3 text-center" colSpan={2}>
          <span className="text-xs italic text-muted-foreground">ไม่เข้าข่ายตามกฎหมายที่ใช้บังคับ</span>
        </td>
      </>
    )
  }
  if (state === 'N/A') {
    return (
      <>
        <td className="px-3 py-3 text-center">
          <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-400">N/A</span>
        </td>
        <td className="px-3 py-3" />
      </>
    )
  }
  return (
    <>
      <td className="px-3 py-3 text-center">
        <div className={`mx-auto flex size-5 items-center justify-center rounded-full border-2 ${state === 'มี' ? 'border-blue-500 bg-blue-500' : DOT_INACTIVE}`}>
          {state === 'มี' && <div className="size-2 rounded-full bg-white" />}
        </div>
      </td>
      <td className="px-3 py-3 text-center">
        <div className={`mx-auto flex size-5 items-center justify-center rounded-full border-2 ${state === 'ไม่มี' ? 'border-red-500 bg-red-500' : DOT_INACTIVE}`}>
          {state === 'ไม่มี' && <div className="size-2 rounded-full bg-white" />}
        </div>
      </td>
    </>
  )
}

function StandardCell({ verdict }: { verdict: 'pass' | 'fail' | 'pending' | 'na' }) {
  if (verdict === 'na') return <td className="px-3 py-3 text-center text-muted-foreground/40">—</td>
  if (verdict === 'pending') return <td className="px-3 py-3 text-center"><span className="text-xs text-muted-foreground">ยังคำนวณไม่ได้</span></td>
  return (
    <td className="px-3 py-3 text-center">
      <div className={`mx-auto flex size-5 items-center justify-center rounded border-2 ${verdict === 'pass' ? 'border-green-500 bg-green-500' : 'border-border/40'}`}>
        {verdict === 'pass' && (
          <svg width="11" height="9" viewBox="0 0 10 8" fill="none">
            <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
    </td>
  )
}

function AnswerRow({
  node, depth, answers, getReviewFlag, onToggleFlag, isFlagPending, hasChildren, childCount, collapsed, onToggleCollapse,
}: {
  node: TemplateNode
  depth: number
  answers: AnswerMap
  getReviewFlag?: (code: string) => boolean
  onToggleFlag?: (code: string) => void
  isFlagPending?: (code: string) => boolean
  hasChildren: boolean
  childCount: number
  collapsed: boolean
  onToggleCollapse: () => void
}) {
  const answer = node.answerType ? answers[node.code] : undefined
  const isRedacted = node.applicable === false
  const reviewFlag = getReviewFlag?.(node.code)
  const flagPending = isFlagPending?.(node.code) ?? false

  // The resolved threshold — a static template property, so computed unconditionally off
  // node.measurements (never gated on the answer). Only presence_standard nodes carry
  // measurements at all, so this is naturally blank for choice/presence/container rows.
  const thresholdText = node.measurements && node.measurements.length > 0
    ? node.measurements.map((m) => measurementSummary(m)).join(' · ')
    : null

  // ── มี/ไม่มี state + ได้มาตรฐาน verdict, derived per answerType (or container, when there's no
  // answerType at all — status rolled up from every descendant leaf, same helper the live editable
  // form's ContainerNode buttons use). ──
  let presenceState: 'มี' | 'ไม่มี' | 'N/A' | 'redacted' | null = null
  let standardVerdict: 'pass' | 'fail' | 'pending' | 'na' = 'na'
  // True once the auditor actually entered measurements for this leaf — gates showing the
  // styled MeasurementInput boxes (which need real values to display), same as the live form's
  // PresenceStandardControl. When false but a threshold still exists (ไม่มี/unanswered on a
  // measured item), the plain thresholdText line below is shown instead — never both, never blank.
  let hasMeasuredValues = false

  if (isRedacted) {
    presenceState = 'redacted'
  } else if (!node.answerType) {
    const status = computeContainerStatus(node, answers)
    presenceState = status === 'มี' || status === 'บางส่วน' ? 'มี' : status === 'ไม่มี' ? 'ไม่มี' : status === 'ไม่เกี่ยวข้อง' ? 'N/A' : null
  } else if (node.answerType === 'choice') {
    presenceState = answer?.value === 'มี' ? 'มี' : answer?.value === 'ไม่มี' ? 'ไม่มี' : answer?.value === 'N/A' ? 'N/A' : null
    if (answer?.value === 'มี') standardVerdict = answer.meetsStandard ? 'pass' : 'fail'
  } else {
    // presence / presence_standard
    presenceState = answer?.value === 'N/A' ? 'N/A' : answer?.present === true ? 'มี' : answer?.present === false ? 'ไม่มี' : null
    if (node.answerType === 'presence_standard' && answer?.present === true) {
      const measured = node.measurements && node.measurements.length > 0
      if (measured) {
        hasMeasuredValues = true
        const derived = deriveMeasuredStandard(node.measurements, answer.values)
        standardVerdict = derived === null ? 'pending' : derived ? 'pass' : 'fail'
      } else {
        standardVerdict = answer.meetsStandard ? 'pass' : 'fail'
      }
    }
  }

  // Depth-based indent, applied to BOTH the code and label columns together so a nested row
  // visibly shifts as one block — plus a short border-l guide before the code badge, echoing the
  // SAME nesting treatment the individual checklist page uses (V2PagerForm's ContainerNode/
  // LeafNode wrap their subItems in `ml-* border-l border-border pl-*`; a table can't nest <tr>s
  // inside a <tr> the way that wraps nested <div>s, so the guide is redrawn per indented row
  // instead of being one continuous parent-owned line).
  const indentPx = `${12 + depth * 20}px`
  const photos = answer?.photos ?? []
  const hasDetail = hasMeasuredValues || !!thresholdText || !!answer?.note || photos.length > 0
  // Now that a detail row can carry sizeable content (styled measurement boxes, a bigger photo
  // grid), a leaf with no children still needs its OWN fold control — the chevron is no longer
  // gated on hasChildren alone. One state covers both: collapsing a container hides its child
  // rows, collapsing a leaf hides its detail row, and a hybrid node with both just hides both.
  const showToggle = hasChildren || hasDetail

  return (
    <>
      <tr
        data-code={node.code}
        className={`${hasDetail && !collapsed ? '' : 'border-b border-border last:border-0'} align-top transition-colors ${reviewFlag ? 'bg-orange-50/40' : ''}`}
      >
        <td className="px-3 py-3 whitespace-nowrap" style={{ paddingLeft: indentPx }}>
          <div className="flex items-center gap-1.5">
            {depth > 0 && <span className="h-4 w-0 shrink-0 border-l-2 border-border" />}
            {showToggle && (
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label={collapsed ? 'ขยายรายละเอียด' : 'ย่อรายละเอียด'}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
              >
                <ChevronRight size={14} className={`transition-transform ${collapsed ? '' : 'rotate-90'}`} />
              </button>
            )}
            <span className="font-mono text-xs text-muted-foreground bg-secondary rounded px-2 py-1">{node.code}</span>
          </div>
        </td>
        <td className="px-3 py-3" style={{ paddingLeft: indentPx }}>
          <div className="flex items-start gap-2">
            <p className="text-sm text-foreground leading-snug">{node.labelTh}</p>
            {node.cabinetResolution && (
              <span className="mt-0.5 shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                มติ ครม.
              </span>
            )}
            {hasChildren && collapsed && (
              <span className="mt-0.5 shrink-0 text-xs text-muted-foreground">({childCount})</span>
            )}
          </div>
        </td>
        <PresenceCells state={presenceState} />
        <StandardCell verdict={standardVerdict} />
        <td className="px-3 py-3 text-center">
          {onToggleFlag && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => onToggleFlag(node.code)}
                  disabled={flagPending}
                  aria-label={reviewFlag ? 'พบปัญหา — คลิกเพื่อยกเลิก' : 'ทำเครื่องหมายว่าพบปัญหา'}
                  className={`inline-flex items-center justify-center rounded-lg p-1.5 transition-colors hover:bg-orange-50/60 disabled:opacity-50 ${
                    reviewFlag ? 'text-orange-500' : 'text-muted-foreground/30'
                  }`}
                >
                  <Flag size={15} fill={reviewFlag ? 'currentColor' : 'none'} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{reviewFlag ? 'พบปัญหา — คลิกเพื่อยกเลิก' : 'ทำเครื่องหมายว่าพบปัญหา'}</TooltipContent>
            </Tooltip>
          )}
        </td>
      </tr>
      {hasDetail && !collapsed && (
        <tr className={`border-b border-border last:border-0 ${reviewFlag ? 'bg-orange-50/40' : 'bg-secondary/10'}`}>
          <td colSpan={HEADERS.length} className="px-3 pb-4 pt-1" style={{ paddingLeft: indentPx }}>
            {hasMeasuredValues ? (
              // Same styled boxes (labeled value + unit, the blue "มาตรฐาน: …" line, slope/tiered
              // layouts) the live auditor form uses — see MeasurementInput's export doc.
              <div className="max-w-md space-y-2 py-1.5">
                {node.measurements!.map((m) => (
                  <MeasurementInput key={m.key} code={node.code} measurement={m} values={answer!.values} setAnswer={noopSetAnswer} readOnly />
                ))}
              </div>
            ) : thresholdText && (
              // No measured value to show a styled box around (ไม่มี/unanswered on an item that
              // still has a defined threshold) — the threshold itself must still be visible.
              <p className="py-1.5 text-sm font-medium text-blue-700">มาตรฐาน: {thresholdText}</p>
            )}
            {answer?.note && (
              <div className="mt-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">บันทึกของผู้ตรวจ</p>
                <p className="border-l-4 border-blue-300 bg-blue-50/60 rounded-r-lg px-3 py-2.5 text-sm text-foreground">
                  {answer.note}
                </p>
              </div>
            )}
            {photos.length > 0 && (
              <div className="mt-3">
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">หลักฐาน ({photos.length} รูป)</p>
                {/* 'detail' variant — size-16 tiles, every photo shown, matching PhotoPicker's own
                    upload-preview size exactly (live feedback: 'reference''s full-width grid read
                    as too large here). */}
                <ChecklistPhotoGallery photos={photos} variant="detail" />
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

function AnswerRows(props: {
  node: TemplateNode
  depth: number
  answers: AnswerMap
  getReviewFlag?: (code: string) => boolean
  onToggleFlag?: (code: string) => void
  isFlagPending?: (code: string) => boolean
  collapsedCodes: Set<string>
  onToggleCollapse: (code: string) => void
}) {
  const children = props.node.subItems?.filter((c) => !isNodeFullyRedacted(c)) ?? []
  const hasChildren = children.length > 0
  // No longer gated on hasChildren — a leaf-only node can be collapsed too now (hides its own
  // detail row; see AnswerRow's showToggle doc). Harmless no-op for a node with neither children
  // nor a detail row: AnswerRow just never renders a chevron for it, so nothing can toggle this on.
  const isCollapsed = props.collapsedCodes.has(props.node.code)
  return (
    <>
      <AnswerRow
        node={props.node} depth={props.depth} answers={props.answers}
        getReviewFlag={props.getReviewFlag} onToggleFlag={props.onToggleFlag} isFlagPending={props.isFlagPending}
        hasChildren={hasChildren} childCount={children.length} collapsed={isCollapsed}
        onToggleCollapse={() => props.onToggleCollapse(props.node.code)}
      />
      {!isCollapsed && children.map((c) => (
        <AnswerRows key={c.code} {...props} node={c} depth={props.depth + 1} />
      ))}
    </>
  )
}

const HEADERS = ['รหัส', 'รายการ', 'มี', 'ไม่มี', 'ได้มาตรฐาน', 'พบปัญหา']

export function ChecklistAnswerTable({ nodes, getReviewFlag, onToggleFlag, isFlagPending }: {
  nodes: TemplateNode[]
  getReviewFlag?: (code: string) => boolean
  onToggleFlag?: (code: string) => void
  isFlagPending?: (code: string) => boolean
}) {
  const answers = useAuditFormStore((s) => s.answers)
  const visible = nodes.filter((n) => !isNodeFullyRedacted(n))
  // Per-node fold/unfold — defaults to fully expanded (matches the old page's group sections,
  // which also opened by default), keyed by node code so it's stable across re-renders and
  // independent between sibling subtrees.
  const [collapsedCodes, setCollapsedCodes] = React.useState<Set<string>>(() => new Set())
  const onToggleCollapse = React.useCallback((code: string) => {
    setCollapsedCodes((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }, [])

  return (
    <div className="themed-scrollbar overflow-x-auto rounded-xl border border-border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/20">
            {HEADERS.map((h) => (
              <th key={h} className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.length === 0 ? (
            <tr><td colSpan={HEADERS.length} className="py-8 text-center text-sm text-muted-foreground">ไม่มีรายการ</td></tr>
          ) : (
            visible.map((n) => (
              <AnswerRows
                key={n.code} node={n} depth={0} answers={answers}
                getReviewFlag={getReviewFlag} onToggleFlag={onToggleFlag} isFlagPending={isFlagPending}
                collapsedCodes={collapsedCodes} onToggleCollapse={onToggleCollapse}
              />
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
