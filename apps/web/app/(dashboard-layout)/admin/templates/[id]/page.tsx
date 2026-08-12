'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { TemplateNode } from '@repo/types'
import { indexTemplateNodesByCode } from '@repo/types'
import { ArrowLeft, Copy, Download, Loader2, Rocket } from 'lucide-react'
import { RequireRole } from '@/components/auth/require-role'
import { useActivateTemplate, useCloneToDraft, useTemplateDetail } from '@/hooks/use-templates-admin'
import { useFacilityGroups } from '@/hooks/use-facility-groups'
import { GROUPED_EDITOR_VERSION, flattenLeafNodes } from '@/lib/api/facility-groups'
import { exportTemplate } from '@/lib/api/templates'
import { ApiError } from '@/lib/api'
import { DIALOG_HEADER_CLS, DIALOG_TITLE_CLS } from '@/lib/ui-classes'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { TransportBadge } from '@/components/shared/badges'
import { TemplateStatusBadge } from '@/components/admin/templates/TemplateStatusBadge'
import { TemplateTree } from '@/components/admin/templates/TemplateTree'
import { TemplateNodeEditorDialog } from '@/components/admin/templates/TemplateNodeEditorDialog'

export default function TemplateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <RequireRole roles={['ADMIN']}>
      <TemplateDetailContent params={params} />
    </RequireRole>
  )
}

function TemplateDetailContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const { data, isLoading, error } = useTemplateDetail(id)
  const searchParams = useSearchParams()
  const router = useRouter()
  const cloneToDraft = useCloneToDraft()
  const activateTemplate = useActivateTemplate(id)

  const [selected, setSelected] = React.useState<{ node: TemplateNode; breadcrumb: string[] } | null>(null)
  const [exporting, setExporting] = React.useState(false)
  const [activateOpen, setActivateOpen] = React.useState(false)
  const [atRisk, setAtRisk] = React.useState<{ stations: string[]; count: number } | null>(null)

  // Session S4b-fix, Fix 4 — the grouped editor is v3-only, so this lookup is only meaningful (and
  // only fired) when the open template actually IS v3; the provenance banner simply doesn't show
  // otherwise. Reuses the same react-query cache the /admin/templates/groups pages populate.
  const groupsQuery = useFacilityGroups(GROUPED_EDITOR_VERSION, { enabled: data?.version === GROUPED_EDITOR_VERSION })
  const groupMembership = React.useMemo(() => {
    if (!groupsQuery.data || !selected || !data) return null
    return (
      flattenLeafNodes(groupsQuery.data.containerGroups).find(
        (it) => it.classification === 'SHARED' && it.instances.some((i) => i.templateId === data.id && i.nodeCode === selected.node.code),
      ) ?? null
    )
  }, [groupsQuery.data, selected, data])

  // 2026-08-05 — activation was previously CLI-only (apps/api/prisma/activate-template.ts,
  // Notion "Feedback after first meeting" Open decision #19). This mirrors the script's own
  // in-progress-draft guardrail: the first call goes unforced; a 409 DRAFTS_AT_RISK response means
  // an auditor elsewhere is mid-audit on a different template for this mode/variant, so the dialog
  // shows who and requires an explicit second click (force=true) to proceed anyway.
  function handleActivate(force: boolean) {
    activateTemplate.mutate(force, {
      onSuccess: () => {
        setActivateOpen(false)
        setAtRisk(null)
      },
      onError: (err) => {
        if (err instanceof ApiError && err.code === 'DRAFTS_AT_RISK') {
          setAtRisk({
            stations: Array.isArray(err.data.stations) ? (err.data.stations as string[]) : [],
            count: typeof err.data.count === 'number' ? err.data.count : 0,
          })
        }
      },
    })
  }

  // Session S3b, Part C.1 — "สร้างเวอร์ชันร่างใหม่": clones this ACTIVE template into a new
  // (mode, variantKey, version+1) DRAFT row, then jumps straight there so the admin lands where
  // structural editing is actually unlocked.
  function handleCloneToDraft() {
    cloneToDraft.mutate(id, {
      onSuccess: (created) => router.push(`/admin/templates/${created.id}`),
    })
  }

  // Part B.3 review-queue "jump into the editor at that leaf" — ?node=<code> from the review
  // queue's row links auto-opens that node's editor sheet once the definition has loaded.
  const jumpNodeCode = searchParams.get('node')
  React.useEffect(() => {
    if (!data || !jumpNodeCode || selected) return
    const index = indexTemplateNodesByCode(data.definition)
    const node = index.get(jumpNodeCode)
    if (node) setSelected({ node, breadcrumb: [] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, jumpNodeCode])

  // The sheet holds a snapshot of the selected TemplateNode object taken at click time. After a
  // save, useTemplateDetail refetches and `data.definition` becomes a brand-new object tree —
  // without this, the open sheet would keep showing pre-edit values (stale confirmed flag, old
  // threshold) even though the save succeeded. Re-point `selected.node` at the fresh node with
  // the same code whenever the definition changes underneath it.
  React.useEffect(() => {
    if (!data || !selected) return
    const fresh = indexTemplateNodesByCode(data.definition).get(selected.node.code)
    if (fresh && fresh !== selected.node) setSelected((s) => (s ? { ...s, node: fresh } : s))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  async function handleExport() {
    if (!data) return
    setExporting(true)
    try {
      const result = await exportTemplate(data.id)
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `template_${result.mode}_${result.variantKey}_v${result.version}.json`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  if (isLoading) {
    return <div className="text-muted-foreground flex items-center justify-center p-16 text-sm">กำลังโหลด…</div>
  }
  if (error || !data) {
    return (
      <div className="flex items-center justify-center p-16 text-sm text-red-500">
        เกิดข้อผิดพลาด: {(error as Error)?.message ?? 'ไม่สามารถโหลดข้อมูลได้'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/admin/templates" className="text-muted-foreground hover:text-foreground shrink-0">
            <ArrowLeft size={16} />
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TransportBadge type={data.mode} />
              <span className="text-muted-foreground text-sm">{data.variantKey === 'standard' ? 'มาตรฐาน' : data.variantKey}</span>
              <span className="text-foreground text-base font-semibold">เวอร์ชัน {data.version}</span>
              <TemplateStatusBadge status={data.status} />
              {/* 2026-08-05 — same clause as the ฉบับร่าง badge: the activation-gate reason, not a
                  link, since the review queue is one click away already (below) and this is just
                  a status readout. */}
              {data.status === 'DRAFT' && data.summary.unconfirmedCount > 0 && (
                <span className="text-muted-foreground text-xs">
                  เหลือยืนยันเกณฑ์ตัวเลขอีก {data.summary.unconfirmedCount} รายการก่อนเปิดใช้งาน
                </span>
              )}
            </div>
            {data.notes && <p className="text-muted-foreground mt-1 truncate text-sm">{data.notes}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 2026-08-05 — only a DRAFT can be activated; ACTIVE already is, RETIRED is retired
              on purpose (clone it back to a new draft first via the button below). Also gated on
              the review queue being clear — server-enforced too (see activateTemplate's
              UNCONFIRMED_THRESHOLDS check), this is just the client-side reflection of it so the
              button reads as unavailable rather than failing after a click; the reason is shown as
              a status readout next to the ฉบับร่าง badge above, not here. */}
          {data.status === 'DRAFT' && (
            <button
              type="button"
              onClick={() => setActivateOpen(true)}
              disabled={data.summary.unconfirmedCount > 0}
              title={
                data.summary.unconfirmedCount > 0
                  ? `ยืนยันเกณฑ์ตัวเลขที่เหลืออีก ${data.summary.unconfirmedCount} รายการก่อนเปิดใช้งาน`
                  : undefined
              }
              className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:opacity-40"
            >
              <Rocket size={15} />
              เปิดใช้งาน
            </button>
          )}
          {/* Session S3b, Part C.1 — the versioning gate's clone action; only ACTIVE templates
              offer it (a DRAFT is already editable, RETIRED isn't part of this flow). */}
          {data.status === 'ACTIVE' && (
            <button
              type="button"
              onClick={handleCloneToDraft}
              disabled={cloneToDraft.isPending}
              className="border-border bg-card hover:bg-secondary/60 flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium disabled:opacity-50"
              title="โครงสร้างแก้ไขได้ในเวอร์ชันร่างเท่านั้น"
            >
              {cloneToDraft.isPending ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
              สร้างเวอร์ชันร่างใหม่
            </button>
          )}
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting}
            className="border-border bg-card hover:bg-secondary/60 flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-sm font-medium disabled:opacity-50"
          >
            {exporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
            ส่งออก JSON
          </button>
        </div>
      </div>

      {cloneToDraft.isError && (
        <p className="text-xs text-red-500">{(cloneToDraft.error as Error).message}</p>
      )}

      <div className="grid gap-3 sm:grid-cols-5">
        <div className="bg-card border-border rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase">รายการ</p>
          <p className="text-foreground text-2xl font-bold">{data.summary.itemCount}</p>
        </div>
        <div className="bg-card border-border rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase">จุดตรวจ (leaves)</p>
          <p className="text-foreground text-2xl font-bold">{data.summary.leafCount}</p>
        </div>
        <div className="bg-card border-border rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase">เกณฑ์ตัวเลข ยืนยันแล้ว</p>
          <p className="text-foreground text-2xl font-bold">
            {data.summary.confirmedCount}/{data.summary.measurementCount}
          </p>
        </div>
        <div className="bg-card border-border rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase">รายการตรวจที่ผูกกับแบบประเมินนี้</p>
          <p className="text-foreground text-2xl font-bold">{data.stampedChecklistCount}</p>
        </div>
        {/* Session S3b, Part D.3 — coverage indicator: tagged vs untagged lawRefs, live. */}
        <div className="bg-card border-border rounded-lg border p-4">
          <p className="text-muted-foreground text-xs uppercase">ระบุข้อยกเว้นทางกฎหมายแล้ว</p>
          <p className="text-foreground text-2xl font-bold">
            {data.summary.lawRefsTaggedCount}/{data.summary.lawRefsTaggedCount + data.summary.lawRefsUntaggedCount}
          </p>
        </div>
      </div>

      {data.status === 'RETIRED' && (
        <div className="bg-secondary text-muted-foreground rounded-lg p-3 text-sm">
          แบบประเมินนี้เลิกใช้แล้ว — แสดงผลได้อย่างเดียว ไม่มีปุ่มแก้ไข
        </div>
      )}

      <div className="bg-card border-border rounded-xl border p-3">
        <TemplateTree
          templateId={data.id}
          definition={data.definition}
          selectedCode={selected?.node.code ?? null}
          onSelect={(node, breadcrumb) => setSelected({ node, breadcrumb })}
        />
      </div>

      <TemplateNodeEditorDialog
        templateId={data.id}
        templateStatus={data.status}
        stampedChecklistCount={data.stampedChecklistCount}
        node={selected?.node ?? null}
        breadcrumb={selected?.breadcrumb ?? []}
        groupMembership={groupMembership}
        onClose={() => setSelected(null)}
      />

      <Dialog
        open={activateOpen}
        onOpenChange={(open) => {
          setActivateOpen(open)
          if (!open) setAtRisk(null)
        }}
      >
        <DialogContent>
          <div className={`${DIALOG_HEADER_CLS} -mx-6 -mt-6 mb-4`}>
            <DialogTitle className={DIALOG_TITLE_CLS}>เปิดใช้งานเวอร์ชัน {data.version}?</DialogTitle>
          </div>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              การเปิดใช้งานจะเปลี่ยนแบบฟอร์มที่ผู้ตรวจทุกคนของ <TransportBadge type={data.mode} /> (
              {data.variantKey === 'standard' ? 'มาตรฐาน' : data.variantKey}) เห็นในการตรวจครั้งถัดไปทันที
              เวอร์ชันที่ใช้งานอยู่ปัจจุบัน (ถ้ามี) จะถูกเปลี่ยนสถานะเป็นเลิกใช้โดยอัตโนมัติ
            </p>

            {atRisk && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-red-600">
                <p className="font-medium">⚠ มีแบบตรวจค้างอยู่ {atRisk.count} รายการที่ใช้แบบประเมินเวอร์ชันอื่นของสถานีประเภทนี้</p>
                {atRisk.stations.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4">
                    {atRisk.stations.map((name, i) => (
                      <li key={i}>{name}</li>
                    ))}
                  </ul>
                )}
                {atRisk.count > atRisk.stations.length && (
                  <p className="mt-1">…และอีก {atRisk.count - atRisk.stations.length} รายการ</p>
                )}
                <p className="mt-2">
                  ผู้ตรวจเหล่านี้จะเห็นแบบใหม่โดยคำตอบเดิมไม่ถูกโหลด แนะนำให้รอจนกว่าจะส่งงานหรือยกเลิกแบบร่างก่อน
                  หรือกดยืนยันอีกครั้งเพื่อเปิดใช้งานทันที
                </p>
              </div>
            )}

            {activateTemplate.isError && !atRisk && (
              <p className="text-xs text-red-500">{(activateTemplate.error as Error).message}</p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActivateOpen(false)}
                className="border-border bg-card hover:bg-secondary/60 rounded-lg border px-3.5 py-2 text-sm font-medium"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                onClick={() => handleActivate(!!atRisk)}
                disabled={activateTemplate.isPending}
                className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-50"
              >
                {activateTemplate.isPending ? <Loader2 size={15} className="animate-spin" /> : <Rocket size={15} />}
                {atRisk ? 'เปิดใช้งานต่อไป (บังคับ)' : 'ยืนยันเปิดใช้งาน'}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
