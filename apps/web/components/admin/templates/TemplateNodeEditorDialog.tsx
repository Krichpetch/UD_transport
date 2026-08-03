'use client'

import * as React from 'react'
import type { TemplateNode } from '@repo/types'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DIALOG_HEADER_CLS, DIALOG_TITLE_CLS } from '@/lib/ui-classes'
import { MeasurementEditor } from './MeasurementEditor'
import { TemplateNodeImages } from './TemplateNodeImages'
import { GuidanceEditor } from './GuidanceEditor'
import { LawRefsEditor } from './LawRefsEditor'
import { StructuralEditor } from './StructuralEditor'

// Centered modal (same Dialog + fixed header/footer, scrollable middle pattern as
// EditStationModal / the stations bulk-import dialog in stations/page.tsx) rather than a
// side-panel Sheet — matches the rest of the admin UI's edit-modal convention.
export function TemplateNodeEditorDialog({
  templateId,
  templateStatus,
  stampedChecklistCount,
  node,
  breadcrumb,
  onClose,
}: {
  templateId: string
  templateStatus: 'DRAFT' | 'ACTIVE' | 'RETIRED' | string
  stampedChecklistCount: number
  node: TemplateNode | null
  breadcrumb: string[]
  onClose: () => void
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
              {breadcrumb.length > 0 && <p className="text-muted-foreground mb-1 text-[10px]">{breadcrumb.join(' › ')}</p>}
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

              {!node.answerType && (
                <div className="bg-secondary/60 text-muted-foreground rounded-lg p-2.5 text-sm">
                  รายการนี้เป็นหมวดหมู่ (ไม่มีคำตอบของตัวเอง) — แนบได้เฉพาะรูปภาพประกอบเท่านั้น
                </div>
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

              {/* Session S3b, Part C.1 — structural editing is DRAFT-only; the server enforces
                  this independently (STRUCTURE_EDIT_REQUIRES_DRAFT), this is just the UI gate. */}
              {templateStatus === 'DRAFT' ? (
                <StructuralEditor
                  templateId={templateId}
                  node={node}
                  onNodeDeleted={onClose}
                  onChildAdded={() => {}}
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
