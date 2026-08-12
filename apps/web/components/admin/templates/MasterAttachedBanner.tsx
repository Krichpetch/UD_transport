'use client'

import * as React from 'react'
import Link from 'next/link'
import type { TemplateNode } from '@repo/types'
import { Link2, Loader2, Lock, Unlink } from 'lucide-react'
import { useAttachMasterNode, useDetachMasterNode } from '@/hooks/use-master-criteria'

// Session S5, Part F.4/F.5 — tells the admin THIS node's content is owned by a master criterion
// BEFORE they hit the server-side NODE_IS_ATTACHED block (Part C.1), and offers the one legitimate
// way past it. Distinct from GroupProvenanceBanner (S4b-fix): that one is about the FUZZY grouping
// engine's `standalone` opt-out; this one is about an EXPLICIT `masterId` link — the two coexist on
// the same node independently (see facility-grouping.core.ts's Part C composed-grouping doc), so
// both banners can render at once if a leaf is somehow both attached AND standalone.
//
// Session S5-fix, Part A — there is no longer a standalone browse/edit page for masters; every
// master is created and edited transparently from the facility-grouped editor
// (/admin/templates/groups), so "ดูต้นแบบ" below points there instead of the removed page.
export function MasterAttachedBanner({
  templateId,
  node,
  readOnly,
}: {
  templateId: string
  node: TemplateNode
  readOnly: boolean
}) {
  const detachMaster = useDetachMasterNode()
  const attachMaster = useAttachMasterNode()
  const [confirmingReattach, setConfirmingReattach] = React.useState(false)

  React.useEffect(() => setConfirmingReattach(false), [node.code])

  if (readOnly) return null
  if (!node.masterId && !node.detachedFromMasterId) return null

  if (node.masterId) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
        <span className="flex items-center gap-1.5">
          <Lock size={14} />
          รายการนี้เชื่อมโยงกับรายการต้นแบบ — แก้ไขที่นี่ไม่ได้ กรุณาแยกออกก่อนแก้ไข
        </span>
        <button
          type="button"
          onClick={() => detachMaster.mutate({ templateId, nodeCode: node.code })}
          disabled={detachMaster.isPending}
          className="flex items-center gap-1 rounded-lg bg-rose-800/10 px-2.5 py-1 text-xs font-medium hover:bg-rose-800/20 disabled:opacity-50"
        >
          {detachMaster.isPending ? <Loader2 size={12} className="animate-spin" /> : <Unlink size={12} />}
          แยกออกจากต้นแบบ
        </button>
        {detachMaster.isError && <span className="w-full text-[11px] text-red-600">{(detachMaster.error as Error).message}</span>}
      </div>
    )
  }

  // detachedFromMasterId set, masterId absent — Part D2's "แยกออกแล้ว" case, surfaced here too so
  // an admin editing the node directly (not via the master editor) can still re-attach it.
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Unlink size={14} />
          แยกออกจากต้นแบบแล้ว — แก้ไขแยกอิสระ (
          <Link href="/admin/templates/groups" className="underline">
            ดูต้นแบบ
          </Link>
          )
        </span>
        {!confirmingReattach && (
          <button
            type="button"
            onClick={() => setConfirmingReattach(true)}
            className="flex items-center gap-1 rounded-lg bg-amber-800/10 px-2.5 py-1 text-xs font-medium hover:bg-amber-800/20"
          >
            <Link2 size={12} />
            ผูกกลับเข้าต้นแบบ
          </button>
        )}
      </div>
      {confirmingReattach && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 pt-1.5">
          <span className="text-xs">จะเขียนทับค่าปัจจุบันของรายการนี้ด้วยค่าจากต้นแบบ ต้องการดำเนินการต่อหรือไม่?</span>
          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => setConfirmingReattach(false)} className="rounded-lg px-2.5 py-1 text-xs font-medium hover:bg-amber-800/10">
              ยกเลิก
            </button>
            <button
              type="button"
              onClick={() => attachMaster.mutate({ templateId, nodeCode: node.code, masterId: node.detachedFromMasterId! })}
              disabled={attachMaster.isPending}
              className="flex items-center gap-1 rounded-lg bg-amber-800 px-2.5 py-1 text-xs font-medium text-white hover:bg-amber-900 disabled:opacity-50"
            >
              {attachMaster.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
              ยืนยันเขียนทับ
            </button>
          </div>
        </div>
      )}
      {attachMaster.isError && <span className="text-[11px] text-red-600">{(attachMaster.error as Error).message}</span>}
    </div>
  )
}
