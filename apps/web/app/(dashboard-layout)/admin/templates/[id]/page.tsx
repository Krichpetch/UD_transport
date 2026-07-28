'use client'

import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { TemplateNode } from '@repo/types'
import { indexTemplateNodesByCode } from '@repo/types'
import { ArrowLeft, Download, Loader2 } from 'lucide-react'
import { RequireRole } from '@/components/auth/require-role'
import { useTemplateDetail } from '@/hooks/use-templates-admin'
import { exportTemplate } from '@/lib/api/templates'
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

  const [selected, setSelected] = React.useState<{ node: TemplateNode; breadcrumb: string[] } | null>(null)
  const [exporting, setExporting] = React.useState(false)

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
            </div>
            {data.notes && <p className="text-muted-foreground mt-1 truncate text-sm">{data.notes}</p>}
          </div>
        </div>
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

      <div className="grid gap-3 sm:grid-cols-4">
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
        onClose={() => setSelected(null)}
      />
    </div>
  )
}
