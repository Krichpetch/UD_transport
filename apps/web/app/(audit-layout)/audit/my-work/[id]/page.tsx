'use client'

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Loader2, CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import { useMyChecklistDetail } from '@/hooks/use-checklists'
import { ChecklistPhotoGallery } from '@/components/checklist/ChecklistPhotoGallery'
import { scoreToStatus } from '@repo/types'

// Session F1, Part E.2 — read-only view of the auditor's own SUBMITTED/APPROVED submission
// (reached from the my-work list). Strictly read-only: no answer control, no delete/edit action
// anywhere on this page — see StoredChecklistNode's shape (checklist-answer.ts) for what each row
// below is reading. Photos come pre-signed fresh by the server (refreshPhotoUrls), same convention
// every other read path in this app already follows.

interface StoredNode {
  id: string
  labelTh: string
  value?: string | null
  meetsStandard?: boolean
  present?: boolean | null
  note?: string
  photos?: { id: string; url: string; filename: string; uploadedAt: string }[]
  applicable?: boolean
  subItems?: StoredNode[]
}
interface StoredGroup { groupId: string; groupName: string; items: StoredNode[] }

function Verdict({ node }: { node: StoredNode }) {
  if (node.applicable === false) return <span className="text-[10px] text-muted-foreground">ไม่เข้าข่ายตามกฎหมายที่ใช้บังคับ</span>
  if (node.value === 'N/A') return <span className="flex items-center gap-1 text-[11px] text-gray-500"><MinusCircle size={12} /> ไม่เกี่ยวข้อง</span>
  const has = node.value === 'มี' || node.present === true
  const none = node.value === 'ไม่มี' || node.present === false
  if (has) {
    return node.meetsStandard ? (
      <span className="flex items-center gap-1 text-[11px] text-green-700"><CheckCircle2 size={12} /> มี — ได้มาตรฐาน</span>
    ) : (
      <span className="flex items-center gap-1 text-[11px] text-amber-600"><CheckCircle2 size={12} /> มี — ไม่ได้มาตรฐาน</span>
    )
  }
  if (none) return <span className="flex items-center gap-1 text-[11px] text-red-600"><XCircle size={12} /> ไม่มี</span>
  return <span className="text-[11px] text-muted-foreground">ยังไม่ได้ตอบ</span>
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
          {node.note && <p className="mt-1 text-[11px] text-muted-foreground">บันทึก: {node.note}</p>}
          {node.photos && node.photos.length > 0 && (
            <div className="mt-1.5"><ChecklistPhotoGallery photos={node.photos} /></div>
          )}
        </div>
      )}
      {node.subItems?.map((c) => <NodeRow key={c.id} node={c} depth={depth + 1} />)}
    </div>
  )
}

export default function MyWorkDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { data, isLoading } = useMyChecklistDetail(params.id)

  if (isLoading || !data) {
    return (
      <div className="flex justify-center py-10">
        {isLoading ? <Loader2 size={20} className="animate-spin text-muted-foreground" /> : null}
      </div>
    )
  }

  const groups = Array.isArray(data.items) ? (data.items as unknown as StoredGroup[]) : []
  const score = data.score ?? 0
  const status = scoreToStatus(score)
  const color = score >= 75 ? '#52aa4e' : score >= 50 ? '#ffc107' : '#f44336'

  return (
    <div className="space-y-4">
      <button onClick={() => router.push('/audit/my-work')} className="flex items-center gap-1 text-xs text-muted-foreground">
        <ArrowLeft size={13} /> กลับไปที่งานของฉัน
      </button>

      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center gap-1.5">
          <h1 className="text-sm font-bold text-foreground">{data.station.nameTh}</h1>
          {data.isTraining && (
            <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">
              ฝึกหัด
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {data.station.mode}{data.station.railSubtype ? ` — ${data.station.railSubtype}` : ''} · {data.station.province ?? 'ไม่ระบุ'}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          ส่งเมื่อ {data.submittedAt ? new Date(data.submittedAt).toLocaleString('th-TH') : '-'}
        </p>
        <div className="mt-3 text-center">
          <span className="text-3xl font-bold" style={{ color }}>{score}%</span>
          <p className="mt-0.5 text-xs font-semibold" style={{ color }}>{status}</p>
        </div>
        {data.finalThoughts && (
          <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
            ความคิดเห็นเพิ่มเติม: {data.finalThoughts}
          </p>
        )}
      </div>

      {groups.map((g) => (
        <div key={g.groupId} className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="border-b border-border px-4 py-2.5">
            <p className="text-xs font-semibold text-foreground">{g.groupName}</p>
          </div>
          <div className="px-4">
            {g.items.map((it) => <NodeRow key={it.id} node={it} depth={0} />)}
          </div>
        </div>
      ))}
    </div>
  )
}
