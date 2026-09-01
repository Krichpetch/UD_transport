'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, CheckCircle2, XCircle, MinusCircle, RotateCcw, ClipboardList } from 'lucide-react'
import { useMyChecklistDetail, useUnsubmitChecklist } from '@/hooks/use-checklists'
import { ChecklistPhotoGallery } from '@/components/checklist/ChecklistPhotoGallery'
import { ChecklistSummaryPanel } from '@/components/checklist/ChecklistSummaryPanel'
import { LeafAnswerRow } from '@/components/audit/LeafAnswerRow'
import { V2ItemPage } from '@/components/audit/V2PagerForm'
import { PageNavigatorTrigger, type NavigatorPage } from '@/components/audit/PageNavigator'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useAuditFormStore } from '@/stores/audit-form.store'
import { groupDisplayName, buildNavPages, buildV2Pages } from '@/lib/audit-form'
import { computeScoreFromItems } from '@repo/types'
import type { TemplateNode, ChecklistTemplateGroupDef } from '@repo/types'

// Session F1, Part E.2 — read-only view of the auditor's own SUBMITTED/APPROVED submission
// (reached from the my-work list). Live feedback follow-up ("look back on my submitted work"):
// lands on the SAME grouped summary the post-submit screen shows (ChecklistSummaryPanel), then
// "ดูคำตอบทั้งหมด" opens the answer review — the REAL E-form controls, PAGINATED exactly like
// /audit's own editable pager (same buildNavPages/buildV2Pages, same PageNavigatorTrigger — a
// continuous scroll-everything list was tried first and was the wrong call for a form that can
// run to dozens of pages; nobody actually scrolls that), just locked via readOnly and with no
// save/submit affordance. Cannot change an answer here — the only way to edit again is the
// unsubmit button below (SUBMITTED only), which hands off to the real editable /audit flow.

// Self-unsubmit — pulls this SUBMITTED checklist back to DRAFT so the auditor can keep editing
// it. Confirm-gated (irreversible from the admin's side until resubmitted): warns explicitly that
// an admin can no longer review it until then. On success, navigates into /audit — the EXISTING
// findDraft/hydrate path there picks the now-DRAFT row up like any other in-progress draft, no
// second resume mechanism needed.
function UnsubmitButton({ stationId, checklistId }: { stationId: string; checklistId: string }) {
  const router = useRouter()
  const unsubmit = useUnsubmitChecklist(stationId)
  const [confirming, setConfirming] = React.useState(false)

  function confirm() {
    unsubmit.mutate(checklistId, {
      onSuccess: () => router.push(`/audit?station=${stationId}`),
    })
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2.5 text-xs font-medium text-foreground"
      >
        <RotateCcw size={13} /> เรียกคืนเพื่อแก้ไข
      </button>

      <Dialog open={confirming} onOpenChange={(o) => !unsubmit.isPending && setConfirming(o)}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-xl p-5">
          <DialogTitle className="text-sm font-bold text-foreground">เรียกคืนรายงานเป็นฉบับร่าง?</DialogTitle>
          <p className="mt-2 text-xs text-muted-foreground">
            รายงานนี้จะกลับไปเป็นฉบับร่าง และผู้ดูแลระบบจะไม่สามารถตรวจสอบได้จนกว่าคุณจะส่งใหม่อีกครั้ง
          </p>
          {unsubmit.isError && (
            <p className="mt-2 text-xs text-red-600">
              {unsubmit.error.message || 'เกิดข้อผิดพลาด กรุณาลองใหม่'}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => setConfirming(false)}
              disabled={unsubmit.isPending}
              className="flex-1 rounded-lg border border-border py-2.5 text-xs font-medium text-foreground disabled:opacity-60"
            >
              ยกเลิก
            </button>
            <button
              onClick={confirm}
              disabled={unsubmit.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-2.5 text-xs font-bold text-primary-foreground disabled:opacity-60"
            >
              {unsubmit.isPending && <Loader2 size={13} className="animate-spin" />}
              ยืนยันเรียกคืน
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ── Fallback flat renderer — pre-E1 pilot rows with no templateId (so no frozen template to
// review against) are the ONLY case this still applies to; every checklist submitted since the
// E-form redesign has one, and gets the real answer-review screen below instead. ──
interface StoredNode {
  id: string
  labelTh: string
  value?: string | null
  meetsStandard?: boolean
  present?: boolean | null
  note?: string
  photos?: { id: string; url: string; filename: string; uploadedAt: string; caption?: string }[]
  applicable?: boolean
  subItems?: StoredNode[]
}
interface StoredGroup { groupId: string; groupName: string; items: StoredNode[] }

function Verdict({ node }: { node: StoredNode }) {
  if (node.applicable === false) return <span className="text-3xs text-muted-foreground">ไม่เข้าข่ายตามกฎหมายที่ใช้บังคับ</span>
  if (node.value === 'N/A') return <span className="flex items-center gap-1 text-2xs text-gray-500"><MinusCircle size={12} /> ไม่เกี่ยวข้อง</span>
  const has = node.value === 'มี' || node.present === true
  const none = node.value === 'ไม่มี' || node.present === false
  if (has) {
    return node.meetsStandard ? (
      <span className="flex items-center gap-1 text-2xs text-green-700"><CheckCircle2 size={12} /> มี — ได้มาตรฐาน</span>
    ) : (
      <span className="flex items-center gap-1 text-2xs text-amber-600"><CheckCircle2 size={12} /> มี — ไม่ได้มาตรฐาน</span>
    )
  }
  if (none) return <span className="flex items-center gap-1 text-2xs text-red-600"><XCircle size={12} /> ไม่มี</span>
  return <span className="text-2xs text-muted-foreground">ยังไม่ได้ตอบ</span>
}

function NodeRow({ node, depth }: { node: StoredNode; depth: number }) {
  const isLeaf = node.value !== undefined || node.present !== undefined
  return (
    <div className={depth > 0 ? 'ml-3 border-l border-border pl-3' : ''}>
      {isLeaf && (
        <div className="border-b border-border py-2.5 last:border-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs text-foreground">{node.labelTh}</p>
          </div>
          <div className="mt-1"><Verdict node={node} /></div>
          {node.note && <p className="mt-1 text-2xs text-muted-foreground">บันทึก: {node.note}</p>}
          {node.photos && node.photos.length > 0 && (
            <div className="mt-1.5"><ChecklistPhotoGallery photos={node.photos} /></div>
          )}
        </div>
      )}
      {node.subItems?.map((c) => <NodeRow key={c.id} node={c} depth={depth + 1} />)}
    </div>
  )
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
function withStoredApplicability(templateNodes: TemplateNode[], storedNodes: StoredNode[]): TemplateNode[] {
  const byId = new Map(storedNodes.map((n) => [n.id, n]))
  return templateNodes.map((t) => {
    const s = byId.get(t.code)
    return {
      ...t,
      applicable: s?.applicable ?? true,
      subItems: t.subItems ? withStoredApplicability(t.subItems, s?.subItems ?? []) : undefined,
    }
  })
}

export default function MyWorkDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { data, isLoading } = useMyChecklistDetail(params.id)
  const [viewingAnswers, setViewingAnswers] = React.useState(false)
  const [currentPage, setCurrentPage] = React.useState(0)

  // Hydrates the SAME shared audit-form store /audit's editable pager reads from — safe because
  // /audit fully re-hydrates on its own fresh mount every time it's navigated to (its own
  // seededForRef guard resets to null on remount, a different route from this page), so nothing
  // this page writes here can leak into a LATER real editing session. Reset on unmount anyway, for
  // hygiene, matching /audit's own station-change cleanup.
  const hydrate = useAuditFormStore((s) => s.hydrate)
  const resetForm = useAuditFormStore((s) => s.reset)
  const answers = useAuditFormStore((s) => s.answers)
  const hydratedForRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!data?.templateDef || hydratedForRef.current === data.id) return
    hydratedForRef.current = data.id
    hydrate({
      stationId: data.stationId,
      templateDef: data.templateDef,
      storedItems: data.items,
      finalThoughts: data.finalThoughts ?? '',
      yearBuilt: data.appliedYearBuilt ?? null,
      eraUnresolved: false,
      resumedFromDraft: false,
      checklistId: data.id,
    })
  }, [data, hydrate])
  React.useEffect(() => () => resetForm(), [resetForm])

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-10">
        {isLoading ? <Loader2 size={20} className="animate-spin text-muted-foreground" /> : null}
      </div>
    )
  }

  const score = data.score ?? computeScoreFromItems(data.items)
  const legacyGroups = Array.isArray(data.items) ? (data.items as unknown as StoredGroup[]) : []

  // ── Answer review — the real E-form controls, PAGINATED like /audit's own pager, locked ──
  if (viewingAnswers && data.templateDef) {
    const isV1 = data.templateDef.schemaVersion === 1
    const storedGroups = Array.isArray(data.items) ? (data.items as unknown as StoredGroup[]) : []
    const storedByGroup = new Map(storedGroups.map((g) => [g.groupId, g.items]))
    // Redaction merged in ONCE here (see withStoredApplicability's doc), so buildV2Pages/
    // buildNavPages — which both filter/read TemplateNode.applicable — see the correct, frozen
    // picture without needing their own special case for "this template came from a review page".
    const resolvedGroups: ChecklistTemplateGroupDef[] = data.templateDef.groups.map((g) => ({
      ...g, items: withStoredApplicability(g.items, storedByGroup.get(g.code) ?? []),
    }))
    const v2Pages = isV1 ? [] : buildV2Pages(resolvedGroups)
    const totalPages = isV1 ? resolvedGroups.length : v2Pages.length
    const navPages: NavigatorPage[] = buildNavPages(resolvedGroups, isV1, v2Pages, answers)
    const page = isV1 ? null : v2Pages[currentPage]
    const group = isV1 ? resolvedGroups[currentPage] : null

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <button onClick={() => setViewingAnswers(false)} className="flex items-center gap-1 text-xs text-muted-foreground">
            <ArrowLeft size={13} /> กลับไปที่สรุปผล
          </button>
          <PageNavigatorTrigger pages={navPages} currentPage={currentPage} onJump={setCurrentPage} />
        </div>

        {isV1 && group && (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="text-sm font-semibold text-gray-700">{groupDisplayName(group)}</span>
              <span className="text-xs text-gray-400">หน้า {currentPage + 1} / {totalPages}</span>
            </div>
            <div className="divide-border divide-y">
              {group.items.map((item) => <LeafAnswerRow key={item.code} node={item} readOnly />)}
            </div>
          </div>
        )}
        {!isV1 && page && (
          <div className="overflow-hidden rounded-xl bg-white shadow-sm">
            <div className="border-b px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-gray-700">{groupDisplayName(page.group)}</span>
                <span className="text-xs text-gray-400">รายการ {currentPage + 1} / {totalPages}</span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {page.item.num ? `${page.item.num}. ` : ''}{page.item.labelTh}
              </p>
            </div>
            <V2ItemPage item={page.item} groupLabel={groupDisplayName(page.group)} readOnly />
          </div>
        )}

        <div className="flex gap-3 pb-6">
          {currentPage > 0 && (
            <button
              onClick={() => { setCurrentPage((p) => p - 1); window.scrollTo({ top: 0 }) }}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-white px-4 py-3 text-sm font-medium text-foreground shadow-sm"
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
    )
  }

  // ── Summary (default landing) ──
  return (
    <div className="space-y-4">
      <button onClick={() => router.push('/audit/my-work')} className="flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowLeft size={13} /> กลับไปที่งานของฉัน
      </button>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center gap-1.5">
          <h1 className="text-sm font-bold text-foreground">{data.station.nameTh}</h1>
          {data.isTraining && (
            <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-3xs font-semibold text-accent">
              ฝึกหัด
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {data.station.mode}{data.station.railSubtype ? ` — ${data.station.railSubtype}` : ''} · {data.station.province ?? 'ไม่ระบุ'}
        </p>
        <p className="mt-1 text-2xs text-muted-foreground">
          ส่งเมื่อ {data.submittedAt ? new Date(data.submittedAt).toLocaleString('th-TH') : '-'}
        </p>

        <div className="mt-3">
          <ChecklistSummaryPanel items={data.items} templateDef={data.templateDef} score={score} />
        </div>

        {data.finalThoughts && (
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            ความคิดเห็นเพิ่มเติม: {data.finalThoughts}
          </p>
        )}

        {data.templateDef ? (
          <button
            onClick={() => { setCurrentPage(0); setViewingAnswers(true) }}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2.5 text-xs font-medium text-foreground"
          >
            <ClipboardList size={13} /> ดูคำตอบทั้งหมด
          </button>
        ) : (
          // Pre-E1 pilot row — no frozen template to drive the real answer controls against; the
          // old flat rendering is the only thing that ever worked for these and still does.
          <div className="mt-3 space-y-4 border-t border-border pt-3">
            {legacyGroups.map((g) => (
              <div key={g.groupId}>
                <p className="mb-1 text-xs font-semibold text-foreground">{g.groupName}</p>
                {g.items.map((it) => <NodeRow key={it.id} node={it} depth={0} />)}
              </div>
            ))}
          </div>
        )}

        {data.status === 'SUBMITTED' && <UnsubmitButton stationId={data.stationId} checklistId={data.id} />}
      </div>
    </div>
  )
}
