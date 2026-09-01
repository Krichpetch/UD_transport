'use client'

import * as React from 'react'
import { useStation } from '@/hooks/use-stations'
import { useChecklist, useChecklistHistory, useChecklistHistoryPaginated } from '@/hooks/use-checklists'
import { useApproveChecklist, useRejectChecklist, useSetItemFlag, useRevertApproval } from '@/hooks/use-stations'
import { useQueryClient } from '@tanstack/react-query'
import type { ChecklistGroup, ChecklistSubItem, ChecklistTemplateGroupDef, TemplateNode } from '@repo/types'
import { buildHistogram, computeFacilityMetrics, computeScoreFromItems } from '@repo/types'
import {
  ChevronLeft,
  Flag,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  XCircle,
  Loader2,
  FileSpreadsheet,
  RotateCcw,
  StickyNote,
  Eye,
} from 'lucide-react'
import { ChecklistPhotoGallery } from '@/components/checklist/ChecklistPhotoGallery'
import { ChecklistSummaryPanel } from '@/components/checklist/ChecklistSummaryPanel'
import { ChecklistAnswerTable } from '@/components/checklist/ChecklistAnswerTable'
import { PageNavigatorTrigger, type NavigatorPage } from '@/components/audit/PageNavigator'
import { useAuditFormStore } from '@/stores/audit-form.store'
import { groupDisplayName, buildNavPages, buildV2Pages } from '@/lib/audit-form'
import { useAuthStore } from '@/stores/auth.store'
import { RequireRole } from '@/components/auth/require-role'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { countReviewFlags } from '@/lib/checklist-review-flags'
import Link from 'next/link'

// ─── Resubmission marker (Session E3, Part B.4; generalized for self-unsubmit) ─────────────────
// Fetches this station's checklist history (already used elsewhere for the approve quick-action)
// only when expanded, and resolves the specific prior checklist by id — no dedicated per-checklist
// route exists in this app, so the prior checklist's own notes/date are shown inline instead of a
// navigable link.
//
// findResubmitSource (checklists.service.ts) now links back for TWO different reasons — an admin
// rejection, or the auditor pulling the report back themselves (self-unsubmit) — and only the
// rejection case has reviewNotes/reviewedAt to show (self-unsubmit flips the SAME row back to
// DRAFT in place, so `prior` here is that row, status DRAFT, not a separate REJECTED record).
// Branching on `prior.status` distinguishes the two without needing a new field on the response.
function ResubmissionMarker({ stationId, respondsToChecklistId }: { stationId: string; respondsToChecklistId: string }) {
  const [expanded, setExpanded] = React.useState(false)
  const { data: history } = useChecklistHistory(stationId)
  const prior = history?.find((c) => c.id === respondsToChecklistId)
  const wasRejection = prior?.status === 'REJECTED'

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left font-medium text-amber-700"
      >
        <RotateCcw size={11} className="shrink-0" />
        {wasRejection ? 'การส่งซ้ำ — เป็นการแก้ไขจากรายงานที่ถูกปฏิเสธก่อนหน้า' : 'การส่งซ้ำ — ผู้ตรวจเรียกคืนรายงานก่อนหน้าเพื่อแก้ไขก่อนส่งใหม่'}
        {expanded ? <ChevronUp size={11} className="ml-auto shrink-0" /> : <ChevronDown size={11} className="ml-auto shrink-0" />}
      </button>
      {expanded && (
        <div className="mt-1.5 border-t border-amber-200 pt-1.5 text-amber-700">
          {!history ? 'กำลังโหลด…' : !prior ? 'ไม่พบข้อมูลรายงานก่อนหน้า' : wasRejection ? (
            <>
              {prior.reviewedAt && <p>ถูกปฏิเสธเมื่อ: {new Date(prior.reviewedAt).toLocaleString('th-TH')}</p>}
              {prior.reviewNotes && <p className="mt-0.5">หมายเหตุ: {prior.reviewNotes}</p>}
            </>
          ) : (
            <p>ผู้ตรวจเรียกคืนรายงานนี้ด้วยตนเองก่อนส่งใหม่ ไม่ใช่การปฏิเสธจากผู้ดูแลระบบ</p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Score Circle ─────────────────────────────────────────────
function ScoreCircle({ score }: { score: number }) {
  const r = 52
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - score / 100)
  const color = score >= 75 ? '#52aa4e' : score >= 50 ? '#ffc107' : '#f44336'
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--secondary)" strokeWidth="10" />
        <circle cx="64" cy="64" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 64 64)" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        <text x="64" y="60" textAnchor="middle" fontSize="26" fontWeight="bold" fill={color}>{score}%</text>
        <text x="64" y="78" textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">ร้อยละความสำเร็จ</text>
      </svg>
    </div>
  )
}

// ─── Legacy flat row (Checklist Row) — ONLY used for pre-E1 pilot rows with no frozen template
// (checklist.templateDef === null). Every checklist submitted since the E-form redesign has one,
// and gets the real paginated answer-review screen below instead. Kept byte-for-byte as the
// pre-refresh admin grid so old pilot data keeps rendering exactly as it always has. ───
function ChecklistRow({ item, onToggleFlag, flagPending }: {
  item: ChecklistSubItem; onToggleFlag: () => void; flagPending: boolean
}) {

  const isMi = item.value === 'มี'
  const isMaiMi = item.value === 'ไม่มี'
  const isNA = item.value === 'N/A'

  return (
    <div className={`border-b border-border last:border-0 transition-colors ${item.reviewFlag ? 'bg-orange-50/40' : ''}`}>
      <div className="grid grid-cols-[3rem_1fr_3.5rem_3.5rem_5rem_7rem_4rem] items-center gap-0 px-0">

        {/* Code */}
        <div className="px-3 py-3">
          <span className="font-mono text-2xs text-muted-foreground bg-secondary rounded px-1.5 py-0.5">
            {item.id}
          </span>
        </div>

        {/* Label + note (read-only) */}
        <div className="px-3 py-3">
          <div className="flex items-start gap-1.5">
            <p className="text-sm text-foreground leading-snug">{item.labelTh}</p>
            {item.cabinetPriority && (
              <span className="mt-0.5 shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-3xs font-medium text-amber-700">
                มติ ครม.
              </span>
            )}
          </div>
          {item.note && (
            <p className="mt-1 border-l-2 border-blue-300 bg-blue-50/60 rounded-r px-2 py-1 text-xs italic text-muted-foreground">
              📝 {item.note}
            </p>
          )}
        </div>

        {/* มี — or N/A badge spanning this cell */}
        <div className="flex items-center justify-center py-3">
          {isNA ? (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-3xs font-medium text-gray-400">
              N/A
            </span>
          ) : (
            <div className={`size-5 rounded-full border-2 flex items-center justify-center cursor-default
              ${isMi ? 'border-blue-500 bg-blue-500' : 'border-border/40'}`}>
              {isMi && <div className="size-2 rounded-full bg-white" />}
            </div>
          )}
        </div>

        {/* ไม่มี */}
        <div className="flex items-center justify-center py-3">
          {isNA ? null : (
            <div className={`size-5 rounded-full border-2 flex items-center justify-center cursor-default
              ${isMaiMi ? 'border-red-500 bg-red-500' : 'border-border/40'}`}>
              {isMaiMi && <div className="size-2 rounded-full bg-white" />}
            </div>
          )}
        </div>

        {/* ได้มาตรฐาน (read-only checkbox) */}
        <div className="flex items-center justify-center py-3">
          {isNA ? (
            <div className="size-5 rounded border-2 border-border/10 bg-secondary/20" />
          ) : isMi ? (
            <div className={`size-5 rounded border-2 flex items-center justify-center cursor-default
              ${item.meetsStandard ? 'border-green-500 bg-green-500' : 'border-border/40'}`}>
              {item.meetsStandard && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
          ) : (
            <div className="size-5 rounded border-2 border-border/20 bg-secondary/30" />
          )}
        </div>

        {/* หลักฐาน — photo thumbnails + lightbox */}
        <div className="flex items-center justify-center py-3">
          <ChecklistPhotoGallery photos={item.photos} />
        </div>

        {/* พบปัญหา — interactive flag toggle (admin review flag, distinct from scoring's flagged) */}
        <button
          onClick={onToggleFlag}
          disabled={flagPending}
          className="flex w-full items-center justify-center py-3 pr-3 transition-colors hover:bg-orange-50/60 disabled:opacity-50"
        >
          {item.reviewFlag ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-3xs font-medium text-orange-600">
              <Flag size={9} fill="currentColor" /> พบปัญหา
            </span>
          ) : (
            <span className="text-muted-foreground/30 text-3xs">—</span>
          )}
        </button>

      </div>
    </div>
  )
}

// ─── Checklist status badge (Checklist.status, distinct domain from Station's StatusBadge) ───
function ChecklistStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-500',
    SUBMITTED: 'bg-amber-100 text-amber-700',
    APPROVED: 'bg-green-100 text-green-700',
    REJECTED: 'bg-red-100 text-red-700',
  }
  const label: Record<string, string> = {
    DRAFT: 'แบบร่าง',
    SUBMITTED: 'รอการอนุมัติ',
    APPROVED: 'อนุมัติแล้ว',
    REJECTED: 'ถูกปฏิเสธ',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${map[status] ?? 'bg-secondary text-muted-foreground'}`}>
      {label[status] ?? status}
    </span>
  )
}

// ─── History tab (Part E, W2-S1) — every checklist for this station, any status, newest
// first. Read-only; no schema changes. The current/latest checklist row links back to the
// Checklist tab (already open on it); older rows expand inline (same click-to-expand pattern
// as ResubmissionMarker above) since there's no dedicated per-checklist route in this app. ───
function HistoryTab({ stationId, onViewCurrent }: { stationId: string; onViewCurrent: () => void }) {
  const [page, setPage] = React.useState(1)
  const LIMIT = 10
  const { data: current } = useChecklist(stationId)
  const { data, isLoading } = useChecklistHistoryPaginated(stationId, page, LIMIT)
  const [expandedId, setExpandedId] = React.useState<string | null>(null)

  return (
    <div className="bg-card border-border overflow-hidden rounded-xl border">
      {isLoading ? (
        <p className="text-muted-foreground p-8 text-center text-sm">กำลังโหลด…</p>
      ) : !data || data.data.length === 0 ? (
        <p className="text-muted-foreground p-8 text-center text-sm">ไม่มีประวัติการตรวจสอบ</p>
      ) : (
        <>
          <div className="themed-scrollbar overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border bg-secondary/30 border-b">
                  <th className="text-muted-foreground px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">ผู้ตรวจ</th>
                  <th className="text-muted-foreground px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide">สถานะ</th>
                  <th className="text-muted-foreground px-3 py-2.5 text-right text-xs font-medium uppercase tracking-wide">คะแนน</th>
                  <th className="text-muted-foreground px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide">ส่งเมื่อ</th>
                  <th className="text-muted-foreground px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide">พิจารณาเมื่อ</th>
                  <th className="text-muted-foreground px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide">แบบฟอร์ม</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((cl) => {
                  const isCurrent = cl.id === current?.id
                  const isExpanded = expandedId === cl.id
                  return (
                    <React.Fragment key={cl.id}>
                      <tr
                        className="border-border hover:bg-secondary/30 cursor-pointer border-b transition-colors last:border-0"
                        onClick={() => (isCurrent ? onViewCurrent() : setExpandedId(isExpanded ? null : cl.id))}
                        title={isCurrent ? 'ดูในแท็บรายการตรวจสอบ' : undefined}
                      >
                        <td className="px-4 py-3 font-medium text-foreground">
                          {cl.auditorUsername ?? '—'}
                          {isCurrent && (
                            <span className="ml-1.5 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                              ล่าสุด
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3"><ChecklistStatusBadge status={cl.status} /></td>
                        <td className="px-3 py-3 text-right font-semibold">{cl.score ?? '—'}</td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {cl.submittedAt ? new Date(cl.submittedAt).toLocaleString('th-TH') : '—'}
                        </td>
                        <td className="px-3 py-3 text-muted-foreground">
                          {cl.reviewedAt ? new Date(cl.reviewedAt).toLocaleString('th-TH') : '—'}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {cl.templateVersion ? `v${cl.templateVersion}` : '—'}
                          {cl.template?.variantKey ? ` · ${cl.template.variantKey}` : ''}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="border-border bg-secondary/20 border-b last:border-0">
                          <td colSpan={6} className="px-4 py-3 text-muted-foreground">
                            {cl.reviewNotes && <p className="mb-1">หมายเหตุ: {cl.reviewNotes}</p>}
                            <p>สร้างเมื่อ: {new Date(cl.createdAt).toLocaleString('th-TH')}</p>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {data.totalPages > 1 && (
            <div className="border-border flex items-center justify-between border-t px-4 py-3">
              <span className="text-muted-foreground text-xs">หน้า {data.page} / {data.totalPages}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => p - 1)}
                  disabled={page === 1}
                  className="border-border rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
                >
                  ก่อนหน้า
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= data.totalPages}
                  className="border-border rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
                >
                  ถัดไป
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Admin checklist-review refresh (post-launch, live-data fix) ──────────────────────────────
// Generic, nesting-aware shapes for the stored `items` JSON — a checklist's real answer tree is
// either flat v1 (ChecklistGroup[]/ChecklistSubItem[], structurally a subset of these) or a nested
// v2/v3 StoredChecklistNode tree. Kept loose/local (mirrors my-work/[id]/page.tsx's own StoredNode/
// StoredGroup) rather than importing the canonical StoredChecklistNode type, since this file only
// needs the handful of fields the flag-lookup/legacy-render paths actually touch.
interface StoredNode {
  id: string
  labelTh: string
  reviewFlag?: boolean
  subItems?: StoredNode[]
}
interface StoredGroup {
  groupId: string
  groupName: string
  items: StoredNode[]
}

function findFlagNode(groups: StoredGroup[], code: string): StoredNode | undefined {
  function visit(nodes: StoredNode[]): StoredNode | undefined {
    for (const n of nodes) {
      if (n.id === code) return n
      if (n.subItems) {
        const hit = visit(n.subItems)
        if (hit) return hit
      }
    }
    return undefined
  }
  for (const g of groups) {
    const hit = visit(g.items)
    if (hit) return hit
  }
  return undefined
}

function collectFlaggedLeaves(groups: StoredGroup[]): { id: string; labelTh: string }[] {
  const out: { id: string; labelTh: string }[] = []
  function visit(nodes: StoredNode[]) {
    for (const n of nodes) {
      if (n.reviewFlag) out.push({ id: n.id, labelTh: n.labelTh })
      if (n.subItems) visit(n.subItems)
    }
  }
  for (const g of groups) visit(g.items)
  return out
}

// Live feedback follow-up — the RAW template fetched for review carries no per-audit redaction
// (that only happens server-side, at submit time, keyed to THIS checklist's own frozen
// appliedYearBuilt/appliedLawRefs — see StoredChecklistNode.applicable's doc). Rather than
// re-deriving redaction from scratch client-side (risking a mismatch if law-reference data has
// changed since this checklist was actually submitted), this copies the ALREADY-CORRECT, FROZEN
// `applicable` flag from the stored answer nodes onto the matching template nodes by code —
// exactly what was true when the auditor actually saw this form, guaranteed to match, never
// re-derived. Unmatched nodes (shouldn't happen for a fully-submitted checklist) default to
// applicable, the safe/visible default every other read path in this app already uses.
// Mirrors my-work/[id]/page.tsx's identically-named helper — kept as a local copy rather than a
// shared export, since the two pages' surrounding StoredNode shapes are independently local too.
function withStoredApplicability(templateNodes: TemplateNode[], storedNodes: StoredNode[]): TemplateNode[] {
  const byId = new Map(storedNodes.map((n) => [n.id, n]))
  return templateNodes.map((t) => {
    const s = byId.get(t.code)
    return {
      ...t,
      applicable: (s as { applicable?: boolean } | undefined)?.applicable ?? true,
      subItems: t.subItems ? withStoredApplicability(t.subItems, s?.subItems ?? []) : undefined,
    }
  })
}

function gpsTrailLabel(distanceM?: number | null, verified?: boolean | null, bypassed?: boolean | null): string | null {
  if (bypassed) return 'ข้ามการตรวจสอบตำแหน่ง'
  if (distanceM == null && verified == null) return null
  return `${verified ? 'ยืนยันแล้ว' : 'ไม่ยืนยัน'}${distanceM != null ? ` (${Math.round(distanceM)} ม.)` : ''}`
}

// "จับไปที่รายการที่พบปัญหา" — whether `node` itself or any descendant carries `code`, used to
// find which page (group, for v1; top-level item, for v2/v3) a flagged leaf lives on. Codes are
// globally unique per template, so a single match is unambiguous.
function nodeContainsCode(node: TemplateNode, code: string): boolean {
  if (node.code === code) return true
  return node.subItems?.some((c) => nodeContainsCode(c, code)) ?? false
}

// ─── Main Page ────────────────────────────────────────────────
// Mutating controls on this page (approve/reject/flag) are all reviewer-appropriate — ADMIN and
// REVIEWER both admitted; no control-hiding needed here the way stations/page.tsx needs one for
// its ADMIN-only add/edit/import affordances.
export default function StationChecklistPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  return (
    <RequireRole roles={['ADMIN', 'REVIEWER']}>
      <StationChecklistPageContent params={params} />
    </RequireRole>
  )
}

function StationChecklistPageContent({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = React.use(params)
  const { data: station, isLoading: stationLoading, error: stationError } = useStation(id)
  const { data: checklist } = useChecklist(id)
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'ADMIN'
  const qc = useQueryClient()
  const approveMutation = useApproveChecklist()
  const rejectMutation = useRejectChecklist()
  const revertMutation = useRevertApproval()
  const flagMutation = useSetItemFlag()

  const [items, setItems] = React.useState<StoredGroup[]>([])
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({})
  const [showNotesOnly, setShowNotesOnly] = React.useState(false)
  const [excelExporting, setExcelExporting] = React.useState(false)
  const [flaggingCode, setFlaggingCode] = React.useState<string | null>(null)
  const [rejectOpen, setRejectOpen] = React.useState(false)
  const [rejectNotes, setRejectNotes] = React.useState('')
  // UDT-55 — confirm guards for the one-and-done approve button and the new revert action.
  const [approveConfirm, setApproveConfirm] = React.useState(false)
  const [revertConfirm, setRevertConfirm] = React.useState(false)
  const [pageTab, setPageTab] = React.useState<'checklist' | 'history'>('checklist')
  // Admin checklist-review refresh — the summary is now page -1 of the SAME sequence as the item
  // pages (0..totalPages-1), not a separate screen behind a "ดูคำตอบทั้งหมด" button. Lands here by
  // default; ก่อนหน้า/ถัดไป and the navigator's pinned summary row all move through one continuous
  // range instead of toggling a distinct view state.
  const [currentPage, setCurrentPage] = React.useState(-1)
  // Set by jumpToFlagged (sidebar's "รายการพบปัญหา" list) right after it changes currentPage —
  // the scroll/highlight effect below picks it up once the target page's table has actually
  // rendered into the DOM, then clears it so a later, unrelated page change never re-fires it.
  const [scrollTargetCode, setScrollTargetCode] = React.useState<string | null>(null)

  // Deliberately keyed on checklist?.id only — React Query hands back a new `checklist` object
  // reference on every background refetch even when the data is unchanged, and re-seeding on
  // every such reference change would clobber any flag-toggle update just written into local
  // `items` state (see toggleFlag below) with the (possibly stale) refetched copy.
  React.useEffect(() => {
    if (!checklist) { setItems([]); return }
    setItems((checklist.items as unknown as StoredGroup[]) ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checklist?.id])

  // Hydrates the SAME shared audit-form store /audit's editable pager reads from, exactly like
  // the auditor's own my-work/[id] review does (see its doc) — safe for the identical reason: this
  // is a read-only, one-shot snapshot, and /audit fully re-hydrates its own store on every mount.
  //
  // The "have I hydrated this checklist" guard reads the STORE'S OWN checklistId, not a local
  // useRef (an earlier version used a ref here, and a ref survives React StrictMode's dev-mode
  // double-invoke of effects while the store does not — the unmount-cleanup effect below calls
  // resetForm() as part of that synthetic replay, wiping the store, but a ref-based guard would
  // then wrongly think hydration already happened and skip re-hydrating, leaving the store
  // permanently empty for that mount. Deriving the guard from the store's own state instead means
  // it can never disagree with reality: if resetForm() wipes checklistId back to null, the guard
  // correctly sees "not hydrated" and re-hydrates on the very next effect pass, regardless of what
  // triggered the reset. This is what made the checklist review silently blank out on returning to
  // an already-visited station's page.
  const hydrate = useAuditFormStore((s) => s.hydrate)
  const resetForm = useAuditFormStore((s) => s.reset)
  const answers = useAuditFormStore((s) => s.answers)
  const storeChecklistId = useAuditFormStore((s) => s.checklistId)
  React.useEffect(() => {
    if (!checklist?.templateDef || storeChecklistId === checklist.id) return
    hydrate({
      stationId: id,
      templateDef: checklist.templateDef,
      storedItems: checklist.items,
      finalThoughts: checklist.finalThoughts ?? '',
      yearBuilt: checklist.appliedYearBuilt ?? null,
      eraUnresolved: false,
      resumedFromDraft: false,
      checklistId: checklist.id,
    })
  }, [checklist, id, hydrate, storeChecklistId])
  React.useEffect(() => () => resetForm(), [resetForm])

  // Fires once the target page's ChecklistAnswerTable has actually painted its rows (this effect
  // runs after the SAME render that changed currentPage commits, so the child's new `nodes` are
  // already in the DOM) — scrolls the flagged row into view and briefly rings it, then clears
  // itself so an unrelated later page change never re-triggers on a stale target.
  React.useEffect(() => {
    if (!scrollTargetCode) return
    const el = document.querySelector<HTMLElement>(`[data-code="${scrollTargetCode}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.add('ring-2', 'ring-orange-400')
      const t = setTimeout(() => el.classList.remove('ring-2', 'ring-orange-400'), 2000)
      setScrollTargetCode(null)
      return () => clearTimeout(t)
    }
    setScrollTargetCode(null)
  }, [scrollTargetCode, currentPage])

  // Persists to the server (there is no local-only flag state — a refresh must not lose it),
  // then syncs the returned items back into local state so the UI updates immediately. Keyed by
  // node code (StoredChecklistNode.id === TemplateNode.code) — setItemFlag recurses subItems
  // server-side, so this reaches a flag at any depth, not just top-level items.
  async function toggleFlag(code: string) {
    if (!checklist?.id || flaggingCode) return
    const node = findFlagNode(items, code)
    if (!node) return
    setFlaggingCode(code)
    try {
      const updated = await flagMutation.mutateAsync({
        stationId: id, checklistId: checklist.id, itemId: code, reviewFlag: !node.reviewFlag,
      })
      setItems((updated.items as unknown as StoredGroup[]) ?? [])
    } finally {
      setFlaggingCode(null)
    }
  }
  const getReviewFlag = React.useCallback((code: string) => !!findFlagNode(items, code)?.reviewFlag, [items])
  const isFlagPending = React.useCallback((code: string) => flaggingCode === code, [flaggingCode])

  async function handleReject() {
    if (!checklist?.id || !rejectNotes.trim() || rejectMutation.isPending) return
    await rejectMutation.mutateAsync({ stationId: id, checklistId: checklist.id, notes: rejectNotes.trim() })
    setRejectOpen(false)
    setRejectNotes('')
    void qc.invalidateQueries({ queryKey: ['checklist', id] })
  }

  async function handleExcelExport() {
    if (!station || excelExporting) return
    setExcelExporting(true)
    try {
      // Same-origin — the httpOnly session cookie is sent automatically and the
      // export route forwards it upstream as a Bearer token.
      const res = await fetch(`/api/export/station/${id}`)
      if (!res.ok) return
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${station.nameTh}_${new Date().toISOString().slice(0, 10)}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExcelExporting(false)
    }
  }

  // ── Derived stats — same computeFacilityMetrics/buildHistogram used server-side (now passed the
  // checklist's own frozen templateDef too, for accurate presence_standard/era-redaction handling
  // on real v2/v3 data), so this page always matches the stored station.score exactly (Phase 0
  // fix), and countReviewFlags/collectFlaggedLeaves recurse into subItems so a flag set on a
  // nested leaf still blocks approval (see checklist-review-flags.ts's doc). ──
  const templateDef = checklist?.templateDef ?? undefined
  const histogram = buildHistogram(items, templateDef)
  const facility  = computeFacilityMetrics(items, templateDef)
  const maiMiCount    = histogram.none
  const naCount       = histogram.na
  const flaggedCount  = countReviewFlags(items)
  const flaggedLeaves = collectFlaggedLeaves(items)

  // 6 metrics per CLAUDE.md
  const pctSuccess       = Math.round(facility.pctSuccess)
  const pctHasFacility   = Math.round(facility.pctHasFacility)
  const pctMeetsStandard = Math.round(facility.pctMeetsStandard)
  const summaryScore = checklist?.score ?? (checklist ? computeScoreFromItems(checklist.items, templateDef) : 0)

  function toggleGroup(groupId: string) {
    setOpenGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  if (stationLoading) return (
    <div className="flex items-center justify-center p-16 text-sm text-muted-foreground">กำลังโหลด…</div>
  )
  if (stationError || !station) return (
    <div className="flex items-center justify-center p-16 text-sm text-red-500">ไม่พบสถานี</div>
  )

  const isV1 = checklist?.templateDef?.schemaVersion === 1
  const resolvedGroups: ChecklistTemplateGroupDef[] | null = checklist?.templateDef
    ? checklist.templateDef.groups.map((g) => {
        const storedGroup = items.find((sg) => sg.groupId === g.code)
        return { ...g, items: withStoredApplicability(g.items, storedGroup?.items ?? []) }
      })
    : null
  const v2Pages = resolvedGroups && !isV1 ? buildV2Pages(resolvedGroups) : []
  const totalPages = resolvedGroups ? (isV1 ? resolvedGroups.length : v2Pages.length) : 0
  const flaggedCodeSet = new Set(flaggedLeaves.map((f) => f.id))
  const navPages: NavigatorPage[] = resolvedGroups ? buildNavPages(resolvedGroups, isV1, v2Pages, answers, flaggedCodeSet) : []
  const pagerGroup = resolvedGroups && isV1 ? resolvedGroups[currentPage] : null
  const pagerV2 = !isV1 ? v2Pages[currentPage] : undefined

  // Sidebar's "รายการพบปัญหา" list — jump straight to the page a flagged item lives on (v1: the
  // group containing it; v2/v3: the top-level item whose subtree contains it), switching off the
  // history tab first if that's where the admin happened to be. Silently no-ops if the code can't
  // be found on any page (shouldn't happen — flaggedLeaves is derived from the same `items` tree).
  function jumpToFlagged(code: string) {
    const idx = isV1
      ? (resolvedGroups?.findIndex((g) => g.items.some((it) => nodeContainsCode(it, code))) ?? -1)
      : v2Pages.findIndex(({ item }) => nodeContainsCode(item, code))
    if (idx === -1) return
    setPageTab('checklist')
    setCurrentPage(idx)
    setScrollTargetCode(code)
  }

  const startGpsLabel = gpsTrailLabel(checklist?.startGpsDistanceM, checklist?.startLocationVerified, checklist?.startProximityBypassed)
  const submitGpsLabel = gpsTrailLabel(checklist?.gpsDistanceM, checklist?.locationVerified, checklist?.proximityBypassed)
  const appliedYearBuiltDateLabel = checklist?.appliedYearBuiltDate
    ? new Date(checklist.appliedYearBuiltDate).toLocaleDateString('th-TH', { year: 'numeric', month: 'long' })
    : null

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/stations"
            className="text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1 text-xs"
          >
            <ChevronLeft size={13} /> กลับรายการสถานี
          </Link>
          <h1 className="text-foreground text-xl font-bold">{station.nameTh}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>ประเภท: <strong className="text-foreground">{station.mode}</strong>
              {station.railSubtype && <> — <strong className="text-foreground">{station.railSubtype}</strong></>}
            </span>
            <span>·</span>
            <span>จังหวัด: <strong className="text-foreground">{station.province}</strong></span>
            <span>·</span>
            <span>หน่วยงาน: <strong className="text-foreground">{station.responsibleAgency}</strong></span>
            {station.lastInspected && <>
              <span>·</span>
              <span>ตรวจล่าสุด: <strong className="text-foreground">{station.lastInspected}</strong></span>
            </>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Moved here from the stations list row menu — belongs next to the real submitted
              answers it's being compared against. version=3 pins the latest
              checklist-migration-pipeline draft template (nested sub-items, item-level pager);
              server-gated ADMIN-only (checklists.controller.ts's preview/version query flags),
              so hidden from REVIEWER rather than shown-then-403. */}
          {isAdmin && (
            <Link
              href={`/audit?preview=1&version=3&station=${id}`}
              className="border-border text-muted-foreground hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors"
            >
              <Eye size={13} />
              ดูตัวอย่างแบบประเมิน
            </Link>
          )}
          <button
            onClick={handleExcelExport}
            disabled={excelExporting}
            className="border-border text-muted-foreground hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors disabled:opacity-60"
          >
            {excelExporting
              ? <Loader2 size={13} className="animate-spin" />
              : <FileSpreadsheet size={13} />
            }
            Export Excel
          </button>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1.5 border-b border-border">
        {(
          [
            { value: 'checklist', label: 'รายการตรวจสอบ' },
            { value: 'history', label: 'ประวัติการตรวจสอบ' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.value}
            onClick={() => setPageTab(tab.value)}
            className={`border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              pageTab === tab.value
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {pageTab === 'history' && <HistoryTab stationId={id} onViewCurrent={() => setPageTab('checklist')} />}

      {/* ── Body: table + sidebar ── */}
      {pageTab === 'checklist' && !checklist && (
        <div className="bg-card border-border flex items-center justify-center rounded-xl border p-16 text-sm text-muted-foreground">
          ยังไม่มีรายงานที่ส่งเข้ามาสำหรับสถานีนี้ (อาจยังไม่มีการตรวจ หรือกำลังกรอกฉบับร่างอยู่)
        </div>
      )}

      {pageTab === 'checklist' && checklist && (
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">

        {/* ── Left: checklist review ── */}
        <div className="space-y-4">
          {(checklist.auditorUsername || checklist.submittedAt || checklist.appliedYearBuilt || startGpsLabel || submitGpsLabel) && (
            <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-secondary/60 px-3 py-2 text-xs text-muted-foreground">
              {checklist.auditorUsername && (
                <span>ผู้ตรวจ: <strong className="text-foreground">{checklist.auditorUsername}</strong></span>
              )}
              {checklist.submittedAt && (
                <span>ส่งเมื่อ: <strong className="text-foreground">{new Date(checklist.submittedAt).toLocaleString('th-TH')}</strong></span>
              )}
              {checklist.appliedYearBuilt && (
                <span>
                  ปีที่ใช้ตรวจ (พ.ศ.): <strong className="text-foreground">
                    {checklist.appliedYearBuilt}{appliedYearBuiltDateLabel ? ` (${appliedYearBuiltDateLabel})` : ''}
                  </strong>
                </span>
              )}
              {startGpsLabel && (
                <span>ตำแหน่งเริ่มตรวจ: <strong className="text-foreground">{startGpsLabel}</strong></span>
              )}
              {submitGpsLabel && (
                <span>ตำแหน่งตอนส่ง: <strong className="text-foreground">{submitGpsLabel}</strong></span>
              )}
            </div>
          )}

          {/* Session E3, Part B.4 — "resubmission of <link>" marker: expands to the prior
              rejection's own notes/date, resolved from this station's history by id. */}
          {checklist.respondsToChecklistId && (
            <ResubmissionMarker stationId={id} respondsToChecklistId={checklist.respondsToChecklistId} />
          )}

          {!checklist.templateDef ? (
            // ── Pre-E1 pilot row — no frozen template to drive the real answer controls against;
            // the original flat grid is the only thing that ever worked for these and still does. ──
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-foreground font-semibold">
                    รายการตรวจสอบสิ่งอำนวยความสะดวก ({station.mode})
                  </h2>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    ตามพจนานุกรมข้อมูล OTP (อัปเดต 17 เม.ย. 2566)
                  </p>
                </div>
                <button
                  onClick={() => setShowNotesOnly((v) => !v)}
                  className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                    showNotesOnly
                      ? 'border-transparent bg-primary text-primary-foreground'
                      : 'border-border text-muted-foreground hover:bg-secondary'
                  }`}
                >
                  <StickyNote size={12} />
                  แสดงเฉพาะรายการที่มีบันทึก
                </button>
              </div>

              {(items as unknown as ChecklistGroup[]).map(group => {
                const isOpen = openGroups[group.groupId] ?? true
                const groupAnswered = group.items.filter(i => i.value !== null).length
                const visibleItems = showNotesOnly ? group.items.filter(i => !!i.note) : group.items
                if (showNotesOnly && visibleItems.length === 0) return null
                return (
                  <div key={group.groupId} className="bg-card border-border overflow-hidden rounded-xl border">
                    <button
                      onClick={() => toggleGroup(group.groupId)}
                      className="flex w-full items-center justify-between bg-secondary/40 px-4 py-3 hover:bg-secondary/60 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-foreground">{group.groupId}</span>
                        <span className="text-sm font-semibold text-foreground">
                          {group.groupName.replace(/^\([^)]+\)\s*-?\s*/, '')}
                        </span>
                        <span className="text-muted-foreground text-xs">
                          ({groupAnswered}/{group.items.length})
                        </span>
                      </div>
                      {isOpen
                        ? <ChevronUp size={14} className="text-muted-foreground" />
                        : <ChevronDown size={14} className="text-muted-foreground" />
                      }
                    </button>

                    {isOpen && (
                      <>
                        <div className="grid grid-cols-[3rem_1fr_3.5rem_3.5rem_5rem_7rem_4rem] border-b border-border bg-secondary/20 px-0">
                          {[
                            { label: 'รหัส', cls: 'px-3 py-2' },
                            { label: 'รายการ', cls: 'px-3 py-2' },
                            { label: 'มี', cls: 'text-center py-2' },
                            { label: 'ไม่มี', cls: 'text-center py-2' },
                            { label: 'ได้มาตรฐาน', cls: 'text-center py-2' },
                            { label: 'หลักฐาน', cls: 'text-center py-2' },
                            { label: 'พบปัญหา', cls: 'text-center py-2 pr-3' },
                          ].map(({ label, cls }) => (
                            <div key={label} className={`text-muted-foreground text-3xs font-medium uppercase tracking-wide ${cls}`}>
                              {label}
                            </div>
                          ))}
                        </div>

                        {visibleItems.map(item => (
                          <ChecklistRow
                            key={item.id}
                            item={item}
                            onToggleFlag={() => toggleFlag(item.id)}
                            flagPending={isFlagPending(item.id)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )
              })}
            </>
          ) : (
            // ── Answer review — the summary is page -1 of ONE continuous sequence (see
            // currentPage's doc above), not a separate screen behind a button. Real item pages
            // (0..totalPages-1) render TABLE-shaped, readOnly, with the "พบปัญหา" flag toggle
            // still live on every row — see ChecklistAnswerTable's doc for why a table, not the
            // stacked-card LeafAnswerRow/V2ItemPage the auditor's own read-only review still uses.
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">หน้า {currentPage + 2} / {totalPages + 1}</span>
                <PageNavigatorTrigger
                  pages={navPages}
                  currentPage={currentPage}
                  onJump={setCurrentPage}
                  summaryLabel="สรุปผลการตรวจสอบ"
                  onSummaryClick={() => setCurrentPage(-1)}
                  isSummaryActive={currentPage === -1}
                />
              </div>

              {currentPage === -1 && (
                <div className="bg-card border-border rounded-xl border p-5">
                  <h2 className="text-foreground mb-1 text-sm font-semibold">
                    สรุปผลการตรวจสอบ ({station.mode})
                  </h2>
                  <ChecklistSummaryPanel items={items} templateDef={checklist.templateDef} score={summaryScore} size="comfortable" />
                  {checklist.finalThoughts && (
                    <p className="mt-4 border-l-2 border-blue-300 bg-blue-50/60 rounded-r px-3 py-2 text-xs italic text-muted-foreground">
                      📝 ความคิดเห็นเพิ่มเติมจากผู้ตรวจ: {checklist.finalThoughts}
                    </p>
                  )}
                </div>
              )}
              {isV1 && pagerGroup && (
                <div className="space-y-2">
                  <span className="block px-1 text-sm font-semibold text-foreground">{groupDisplayName(pagerGroup)}</span>
                  <ChecklistAnswerTable
                    nodes={pagerGroup.items}
                    getReviewFlag={getReviewFlag}
                    onToggleFlag={toggleFlag}
                    isFlagPending={isFlagPending}
                  />
                </div>
              )}
              {!isV1 && pagerV2 && (
                <div className="space-y-2">
                  <div className="px-1">
                    <span className="text-sm font-semibold text-foreground">{groupDisplayName(pagerV2.group)}</span>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {pagerV2.item.num ? `${pagerV2.item.num}. ` : ''}{pagerV2.item.labelTh}
                    </p>
                  </div>
                  <ChecklistAnswerTable
                    nodes={[pagerV2.item]}
                    getReviewFlag={getReviewFlag}
                    onToggleFlag={toggleFlag}
                    isFlagPending={isFlagPending}
                  />
                </div>
              )}

              <div className="flex gap-3 pb-2">
                {currentPage > -1 && (
                  <button
                    onClick={() => { setCurrentPage((p) => p - 1); window.scrollTo({ top: 0 }) }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-sm"
                  >
                    ← ก่อนหน้า
                  </button>
                )}
                {currentPage < totalPages - 1 && (
                  <button
                    onClick={() => { setCurrentPage((p) => p + 1); window.scrollTo({ top: 0 }) }}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground"
                  >
                    ถัดไป →
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ── Right: score summary ── */}
        <div className="space-y-4">
          <div className="bg-card border-border sticky top-20 rounded-xl border p-5">
            <h2 className="text-foreground mb-4 text-sm font-semibold">สรุปผลการตรวจสอบ</h2>

            {/* Rejected banner — shows admin feedback so it's visible while the auditor's
                resubmission is still in progress */}
            {checklist.status === 'REJECTED' && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-red-700">
                  <XCircle size={12} /> ถูกปฏิเสธ — รอการแก้ไขจากผู้ตรวจ
                </p>
                {checklist.reviewNotes && (
                  <p className="text-xs text-red-600">{checklist.reviewNotes}</p>
                )}
              </div>
            )}

            {/* Approve / reject — only when checklist is awaiting approval */}
            {checklist.status === 'SUBMITTED' && (
              <div className="mb-4 space-y-2">
                {flaggedCount > 0 && (
                  <p className="text-xs text-orange-600">
                    ไม่สามารถอนุมัติได้ขณะมีรายการที่พบปัญหา ({flaggedCount}) — กรุณาแก้ไขหรือปฏิเสธพร้อมหมายเหตุ
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setApproveConfirm(true)}
                    disabled={approveMutation.isPending || flaggedCount > 0}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-60"
                  >
                    {approveMutation.isPending
                      ? <Loader2 size={13} className="animate-spin" />
                      : <CheckCircle size={13} />}
                    อนุมัติ
                  </button>
                  <button
                    onClick={() => setRejectOpen(v => !v)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100"
                  >
                    <XCircle size={13} /> ปฏิเสธ
                  </button>
                </div>
                {rejectOpen && (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <textarea
                      value={rejectNotes}
                      onChange={e => setRejectNotes(e.target.value)}
                      placeholder="ระบุเหตุผลที่ปฏิเสธ เพื่อให้ผู้ตรวจแก้ไข"
                      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                      rows={3}
                    />
                    <button
                      onClick={handleReject}
                      disabled={!rejectNotes.trim() || rejectMutation.isPending}
                      className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                    >
                      {rejectMutation.isPending && <Loader2 size={12} className="animate-spin" />}
                      ยืนยันการปฏิเสธ
                    </button>
                  </div>
                )}

                <ConfirmDialog
                  open={approveConfirm}
                  onOpenChange={setApproveConfirm}
                  title="ยืนยันการอนุมัติรายงาน?"
                  body="เมื่ออนุมัติแล้ว คะแนนของสถานีจะถูกปรับปรุงตามผลการตรวจนี้ หากอนุมัติผิด สามารถยกเลิกการอนุมัติได้จากหน้านี้ภายหลัง"
                  confirmLabel="ยืนยันอนุมัติ"
                  pending={approveMutation.isPending}
                  error={approveMutation.isError ? (approveMutation.error?.message || 'เกิดข้อผิดพลาดในการอนุมัติ') : null}
                  onConfirm={() =>
                    approveMutation.mutate(
                      { stationId: id, checklistId: checklist.id },
                      { onSuccess: () => setApproveConfirm(false) },
                    )
                  }
                />
              </div>
            )}

            {/* UDT-55 — revert an accidental approval; returns the report to the review queue. */}
            {checklist.status === 'APPROVED' && (
              <div className="mb-4 space-y-2">
                <button
                  onClick={() => setRevertConfirm(true)}
                  disabled={revertMutation.isPending}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-700 transition-colors hover:bg-red-100 disabled:opacity-60"
                >
                  {revertMutation.isPending
                    ? <Loader2 size={13} className="animate-spin" />
                    : <RotateCcw size={13} />}
                  ยกเลิกการอนุมัติ
                </button>
                <ConfirmDialog
                  open={revertConfirm}
                  onOpenChange={setRevertConfirm}
                  title="ยกเลิกการอนุมัติรายงานนี้?"
                  body="รายงานจะกลับไปอยู่ในสถานะรอการอนุมัติเพื่อให้ตรวจสอบใหม่ และคะแนนของสถานีจะถูกคำนวณใหม่จากรายงานที่อนุมัติก่อนหน้า (หากมี)"
                  confirmLabel="ยืนยันยกเลิกการอนุมัติ"
                  destructive
                  pending={revertMutation.isPending}
                  error={revertMutation.isError ? (revertMutation.error?.message || 'เกิดข้อผิดพลาดในการยกเลิกการอนุมัติ') : null}
                  onConfirm={() =>
                    revertMutation.mutate(
                      { stationId: id, checklistId: checklist.id },
                      { onSuccess: () => setRevertConfirm(false) },
                    )
                  }
                />
              </div>
            )}

            <div className="flex justify-center mb-4">
              <ScoreCircle score={pctSuccess} />
            </div>

            {/* 6 metrics per CLAUDE.md */}
            <div className="space-y-2.5 text-xs border-t border-border pt-4">
              {[
                { label: 'จำนวนรายการ (ไม่รวม N/A)', value: facility.total,          color: 'text-foreground' },
                { label: 'จำนวนรายการที่มีสิ่งอำนวยฯ', value: facility.hasItem,        color: 'text-blue-600' },
                { label: 'จำนวนรายการที่ได้มาตรฐาน',   value: facility.meetsStandard,  color: 'text-[#52aa4e]' },
                { label: 'ร้อยละความสำเร็จ',             value: `${pctSuccess}%`,       color: 'text-[#52aa4e]' },
                { label: 'ร้อยละการจัดให้มีสิ่งอำนวยฯ', value: `${pctHasFacility}%`,   color: 'text-blue-600' },
                { label: 'ร้อยละการได้มาตรฐาน',          value: `${pctMeetsStandard}%`, color: 'text-[#52aa4e]' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={`font-semibold ${color}`}>{value}</span>
                </div>
              ))}

              {/* Secondary counts */}
              <div className="border-t border-border pt-2.5 space-y-2">
                {[
                  { label: 'ไม่มี',            value: maiMiCount, color: 'text-[#f44336]' },
                  { label: 'ไม่เกี่ยวข้อง (N/A)', value: naCount,    color: 'text-gray-400' },
                  ...(flaggedCount > 0 ? [{ label: 'พบปัญหา', value: flaggedCount, color: 'text-orange-500' }] : []),
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`font-semibold ${color}`}>{value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Export buttons */}
            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <button
                onClick={handleExcelExport}
                disabled={excelExporting}
                className="border-border hover:bg-secondary flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground transition-colors disabled:opacity-60"
              >
                {excelExporting
                  ? <Loader2 size={12} className="animate-spin" />
                  : <FileSpreadsheet size={12} />
                }
                Export เป็น Excel
              </button>
            </div>

            {/* Flagged items summary */}
            {flaggedCount > 0 && (
              <div className="mt-4 rounded-lg bg-orange-50 border border-orange-200 p-3">
                <p className="text-orange-700 text-xs font-semibold mb-1.5 flex items-center gap-1.5">
                  <Flag size={11} fill="currentColor" /> รายการพบปัญหา ({flaggedCount})
                </p>
                {flaggedLeaves.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => jumpToFlagged(i.id)}
                    title="ไปที่รายการนี้"
                    className="flex w-full items-start gap-1 rounded px-1 py-0.5 -mx-1 mt-0.5 text-left text-orange-600 text-xs hover:bg-orange-100"
                  >
                    <span className="font-mono shrink-0">{i.id}</span>
                    <span className="truncate">{i.labelTh}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      )}
    </div>
  )
}
