'use client'

import * as React from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { RequireRole } from '@/components/auth/require-role'
import { useGroupConflicts, useResolveConflict } from '@/hooks/use-facility-groups'
import { TransportBadge } from '@/components/shared/badges'

const VERSION = 3

export default function ConflictQueuePage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <ConflictQueueContent />
    </RequireRole>
  )
}

// Session S4b, Part 2.2 — the conflict-resolution GATE. report §7b: 19 (as of the last analysis)
// item texts share wording but diverge in answerType/measurements across templates — pre-existing
// migration artifacts, not policy decisions. Nothing propagates for these items until an admin
// explicitly picks a winner (copies its exact data onto every divergent instance) or says the
// divergence is real ("leave split"). Either action is audit-logged as TEMPLATE_CONFLICT_RESOLVE.
function ConflictQueueContent() {
  const { data, isLoading, error } = useGroupConflicts(VERSION)
  const resolve = useResolveConflict(VERSION)
  const [notesById, setNotesById] = React.useState<Record<string, string>>({})
  const [pendingId, setPendingId] = React.useState<string | null>(null)

  if (isLoading) return <div className="text-muted-foreground flex items-center justify-center p-16 text-sm">กำลังโหลด…</div>
  if (error || !data) {
    return (
      <div className="flex items-center justify-center p-16 text-sm text-red-500">
        เกิดข้อผิดพลาด: {(error as Error)?.message ?? 'ไม่สามารถโหลดข้อมูลได้'}
      </div>
    )
  }

  const unresolved = data.filter((c) => !c.acknowledged)

  function pickWinner(itemId: string, signature: string) {
    setPendingId(itemId)
    resolve.mutate({ itemId, body: { resolution: 'winner', winnerSignature: signature } }, { onSettled: () => setPendingId(null) })
  }

  function leaveSplit(itemId: string) {
    setPendingId(itemId)
    resolve.mutate({ itemId, body: { resolution: 'split', notes: notesById[itemId] } }, { onSettled: () => setPendingId(null) })
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/admin/templates/groups" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-foreground text-xl font-bold">แก้ไขข้อมูลที่ขัดแย้งกัน</h1>
          <p className="text-muted-foreground text-sm">
            รายการคำถามเดียวกันแต่มีประเภทคำตอบหรือเกณฑ์ตัวเลขไม่ตรงกันระหว่างแบบประเมิน — เลือกค่าที่ถูกต้อง หรือระบุว่าแตกต่างกันจริงโดยเจตนา
          </p>
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        ทั้งหมด {data.length} รายการ — รอดำเนินการ {unresolved.length} รายการ
      </p>

      {data.length === 0 && <div className="text-muted-foreground p-8 text-center text-sm">ไม่พบข้อมูลที่ขัดแย้งกัน ✓</div>}

      <div className="space-y-3">
        {data.map((conflict) => (
          <div key={conflict.canonicalItemId} className="bg-card border-border rounded-xl border p-4">
            <div className="mb-3 flex items-start justify-between gap-3">
              <p className="text-foreground text-base font-semibold">{conflict.labelTh}</p>
              {conflict.acknowledged && (
                <span className="bg-secondary text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-xs">รับทราบแล้ว — แตกต่างกันจริง</span>
              )}
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {conflict.variants.map((v) => (
                <div key={v.signature} className="border-border rounded-lg border p-3">
                  <p className="text-muted-foreground mb-1.5 font-mono text-xs break-all">{v.signature}</p>
                  <p className="text-foreground mb-2 text-sm">{v.instances.length} จุด</p>
                  <div className="mb-2 flex flex-wrap gap-1">
                    {v.instances.slice(0, 8).map((i) => (
                      <span key={`${i.templateId}-${i.nodeCode}`} className="bg-secondary/60 flex items-center gap-1 rounded px-1.5 py-0.5 text-xs">
                        <TransportBadge type={i.mode} />
                        <span className="font-mono">{i.nodeCode}</span>
                      </span>
                    ))}
                    {v.instances.length > 8 && <span className="text-muted-foreground text-xs">+{v.instances.length - 8} อีก</span>}
                  </div>
                  <button
                    type="button"
                    disabled={resolve.isPending && pendingId === conflict.canonicalItemId}
                    onClick={() => pickWinner(conflict.canonicalItemId, v.signature)}
                    className="bg-primary text-primary-foreground flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  >
                    {resolve.isPending && pendingId === conflict.canonicalItemId ? <Loader2 size={13} className="animate-spin" /> : null}
                    เลือกเป็นค่าที่ถูกต้อง ({v.instances.length}x)
                  </button>
                </div>
              ))}
            </div>

            {!conflict.acknowledged && (
              <div className="border-border mt-3 flex items-center gap-2 border-t pt-3">
                <input
                  className="border-input bg-background flex-1 rounded-lg border px-2.5 py-2 text-sm"
                  placeholder="หมายเหตุ (ไม่บังคับ) — เหตุผลที่แตกต่างกันจริง"
                  value={notesById[conflict.canonicalItemId] ?? ''}
                  onChange={(e) => setNotesById((n) => ({ ...n, [conflict.canonicalItemId]: e.target.value }))}
                />
                <button
                  type="button"
                  disabled={resolve.isPending && pendingId === conflict.canonicalItemId}
                  onClick={() => leaveSplit(conflict.canonicalItemId)}
                  className="border-border shrink-0 rounded-lg border px-3 py-2 text-sm font-medium disabled:opacity-50"
                >
                  แตกต่างกันจริง — ไม่ต้องแก้
                </button>
              </div>
            )}

            {resolve.isError && pendingId === null && <p className="mt-2 text-sm text-red-500">{(resolve.error as Error).message}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}
