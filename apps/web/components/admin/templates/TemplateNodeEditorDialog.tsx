'use client'

import * as React from 'react'
import Link from 'next/link'
import type { TemplateNode } from '@repo/types'
import { Layers, Loader2, Unlink } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DIALOG_HEADER_CLS, DIALOG_TITLE_CLS } from '@/lib/ui-classes'
import { useEditStandalone } from '@/hooks/use-templates-admin'
import type { GroupNodeRow } from '@/lib/api/facility-groups'
import { MeasurementEditor } from './MeasurementEditor'
import { TemplateNodeImages } from './TemplateNodeImages'
import { GuidanceEditor } from './GuidanceEditor'
import { LawRefsEditor } from './LawRefsEditor'
import { HiddenToggle } from './HiddenToggle'
import { StructuralEditor } from './StructuralEditor'
import { MasterAttachedBanner } from './MasterAttachedBanner'
import { LabelByLawEditor } from './LabelByLawEditor'
import { MoveToGroupPicker } from './MoveToGroupPicker'

// Session S4b-fix, Fix 4 — provenance banner: tells the admin this node's text is shared with
// other templates via the grouped editor BEFORE they edit it here in isolation, and offers the
// detach/re-attach action. Two distinct cases since a detached node is invisible to the grouping
// engine by design (see TemplateNode.standalone's doc) — `groupMembership` can never resolve for
// an already-standalone node, so "is it detached" is read straight off the node itself, not off
// the membership lookup.
function GroupProvenanceBanner({
  templateId,
  node,
  groupMembership,
  readOnly,
}: {
  templateId: string
  node: TemplateNode
  groupMembership: GroupNodeRow | null
  readOnly: boolean
}) {
  const editStandalone = useEditStandalone(templateId)
  const isStandalone = node.standalone === true

  if (readOnly) return null
  if (!isStandalone && !groupMembership) return null

  if (isStandalone) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        <span className="flex items-center gap-1.5">
          <Unlink size={14} /> แยกออกจากกลุ่มแล้ว — แก้ไขแยกจากรายการอื่นโดยเฉพาะ
        </span>
        <button
          type="button"
          onClick={() => editStandalone.mutate({ nodeCode: node.code, standalone: false })}
          disabled={editStandalone.isPending}
          className="flex items-center gap-1 rounded-lg bg-amber-800/10 px-2.5 py-1 text-xs font-medium hover:bg-amber-800/20 disabled:opacity-50"
        >
          {editStandalone.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
          ผูกกลับเข้ากลุ่ม
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <Layers size={14} />
          ส่วนหนึ่งของกลุ่ม &ldquo;{groupMembership!.labelTh}&rdquo; — ใช้ร่วมกัน {groupMembership!.instanceCount} ที่{' '}
          <Link href="/admin/templates/groups" className="underline">
            ดูกลุ่ม
          </Link>
        </span>
        <button
          type="button"
          onClick={() => editStandalone.mutate({ nodeCode: node.code, standalone: true })}
          disabled={editStandalone.isPending}
          className="flex items-center gap-1 rounded-lg bg-blue-800/10 px-2.5 py-1 text-xs font-medium hover:bg-blue-800/20 disabled:opacity-50"
        >
          {editStandalone.isPending ? <Loader2 size={12} className="animate-spin" /> : null}
          แก้เป็นรายการเดี่ยว
        </button>
      </div>
      {/* Era-editor safety session, Part E — the never-linked fuzzy-pool case (e.g. a mis-worded
          item stuck in its own wrong-text pool): offered only while this node isn't explicitly
          master-attached — an attached node's grouping is owned by its master link, not this
          fuzzy cluster, and editing it directly is already blocked server-side either way. */}
      {!node.masterId && (
        <div className="border-t border-blue-200 pt-1.5">
          <MoveToGroupPicker templateId={templateId} sourceNodeCode={node.code} excludeGroupId={groupMembership!.id} />
        </div>
      )}
    </div>
  )
}

// Centered modal (same Dialog + fixed header/footer, scrollable middle pattern as
// EditStationModal / the stations bulk-import dialog in stations/page.tsx) rather than a
// side-panel Sheet — matches the rest of the admin UI's edit-modal convention.
export function TemplateNodeEditorDialog({
  templateId,
  templateStatus,
  stampedChecklistCount,
  node,
  breadcrumb,
  groupMembership,
  onClose,
  onNodeMoved,
}: {
  templateId: string
  templateStatus: 'DRAFT' | 'ACTIVE' | 'RETIRED' | string
  stampedChecklistCount: number
  node: TemplateNode | null
  breadcrumb: string[]
  groupMembership?: GroupNodeRow | null
  onClose: () => void
  // reorderNode pins codes to their slot — this keeps the dialog pointed at the moved content
  // instead of snapping to whatever now sits under the code it was opened with.
  onNodeMoved?: (newCode: string) => void
}) {
  // Part B.4 — "no silent re-grades": editing a measurement on an ACTIVE template requires an
  // explicit ack of the consequence (re-scoring on next recompute) before the edit form even
  // renders. Reset per node so re-opening the dialog on a different leaf shows the warning again.
  // Guidance text and images never affect scoring, so they're only gated by RETIRED, not by this.
  const [activeAckd, setActiveAckd] = React.useState(false)
  React.useEffect(() => setActiveAckd(false), [node?.code])

  const retired = templateStatus === 'RETIRED'
  const measurementsLocked = retired || (templateStatus === 'ACTIVE' && !activeAckd)

  return (
    <Dialog open={!!node} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col overflow-hidden p-0 sm:max-w-2xl">
        {node && (
          <>
            <div className={DIALOG_HEADER_CLS}>
              {breadcrumb.length > 0 && <p className="text-muted-foreground mb-1 text-3xs">{breadcrumb.join(' › ')}</p>}
              <DialogTitle className={`flex items-center gap-2 ${DIALOG_TITLE_CLS}`}>
                <span className="bg-secondary text-muted-foreground rounded px-1.5 py-0.5 font-mono text-xs">{node.code}</span>
                {node.labelTh}
              </DialogTitle>
            </div>

            <div className="themed-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
              {retired && (
                <div className="bg-secondary text-muted-foreground rounded-lg p-2.5 text-sm">
                  แบบประเมินนี้เลิกใช้แล้ว — ดูได้อย่างเดียว ไม่สามารถแก้ไขได้
                </div>
              )}

              <MasterAttachedBanner templateId={templateId} node={node} readOnly={retired} />
              <GroupProvenanceBanner templateId={templateId} node={node} groupMembership={groupMembership ?? null} readOnly={retired} />

              {!node.answerType && (
                <>
                  <div className="bg-secondary/60 text-muted-foreground rounded-lg p-2.5 text-sm">
                    รายการนี้เป็นหมวดหมู่ (ไม่มีคำตอบของตัวเอง) — แนบได้เฉพาะรูปภาพประกอบเท่านั้น
                  </div>
                  <LabelByLawEditor templateId={templateId} node={node} readOnly={retired} />
                </>
              )}
              {/* guidance is a leaf-only field in the validator (packages/types/checklist-template.ts
                  parseNode only reads/preserves it inside the answerType branch) — showing this
                  editor for a container would silently lose whatever was typed the next time the
                  definition round-trips through parseTemplateDefinition. imageKeys has no such
                  restriction (parsed unconditionally at every level), so it stays available below
                  regardless of node type. */}
              {node.answerType && (
                <GuidanceEditor templateId={templateId} nodeCode={node.code} guidance={node.guidance} readOnly={retired} />
              )}
              <TemplateNodeImages templateId={templateId} node={node} readOnly={retired} />

              {(node.measurements ?? []).length > 0 && (
                <div className="space-y-2">
                  <p className="text-foreground text-sm font-semibold">เกณฑ์ตัวเลข</p>

                  {templateStatus === 'ACTIVE' && !activeAckd && (
                    <div className="space-y-2 rounded-lg bg-[#ffc107]/10 p-3 text-sm text-[#8a6d00]">
                      <p className="font-semibold">แบบประเมินนี้ &ldquo;ใช้งานอยู่&rdquo; — จะมีผลเมื่อคำนวณคะแนนใหม่</p>
                      <p>
                        มีรายการตรวจสอบที่ผูกกับแบบประเมินนี้อยู่ {stampedChecklistCount.toLocaleString()} รายการ
                        การแก้ไขเกณฑ์นี้ไม่แก้ไขคะแนนที่ตรวจไปแล้วทันที แต่จะมีผลกับการคำนวณคะแนนครั้งถัดไป
                      </p>
                      <button
                        type="button"
                        onClick={() => setActiveAckd(true)}
                        className="rounded-lg bg-[#b38600] px-3 py-1.5 text-xs font-medium text-white"
                      >
                        เข้าใจแล้ว ดำเนินการแก้ไขต่อ
                      </button>
                    </div>
                  )}

                  {(node.measurements ?? []).map((m, i, arr) => (
                    <MeasurementEditor
                      key={m.key}
                      templateId={templateId}
                      nodeCode={node.code}
                      measurement={m}
                      readOnly={measurementsLocked}
                      reorder={templateStatus === 'DRAFT' ? { isFirst: i === 0, isLast: i === arr.length - 1 } : undefined}
                    />
                  ))}
                </div>
              )}

              {/* Session S3b, Part D — editable on items AND leaves, DRAFT and ACTIVE both. */}
              <LawRefsEditor templateId={templateId} node={node} readOnly={retired} />

              {/* Session S4a, Part C — editable on items AND leaves, any status (RETIRED-only gate). */}
              <HiddenToggle templateId={templateId} node={node} readOnly={retired} />

              {/* Session S3b, Part C.1 — structural editing is DRAFT-only; the server enforces
                  this independently (STRUCTURE_EDIT_REQUIRES_DRAFT), this is just the UI gate. */}
              {templateStatus === 'DRAFT' ? (
                <StructuralEditor
                  templateId={templateId}
                  node={node}
                  onNodeDeleted={onClose}
                  onChildAdded={() => {}}
                  onNodeMoved={onNodeMoved}
                />
              ) : !retired && (
                <div className="bg-secondary/60 text-muted-foreground rounded-lg p-2.5 text-sm">
                  โครงสร้างแก้ไขได้ในเวอร์ชันร่างเท่านั้น — สร้างเวอร์ชันร่างใหม่จากหน้ารายละเอียดแบบประเมินเพื่อแก้ไขโครงสร้าง
                </div>
              )}
            </div>

            <div className="border-border shrink-0 border-t px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                className="bg-primary text-primary-foreground w-full rounded-lg py-2 text-sm font-medium"
              >
                ยืนยัน
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
