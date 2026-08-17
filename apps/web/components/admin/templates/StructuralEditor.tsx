'use client'

import * as React from 'react'
import type { TemplateNode, ThresholdOperator } from '@repo/types'
import { AlertTriangle, ArrowDown, ArrowUp, Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { INPUT_CLS, SELECT_CLS } from '@/lib/ui-classes'
import type { QuestionTypeSelector } from '@/lib/api/templates'
import {
  useAddChildNode,
  useAddMeasurement,
  useDeleteNode,
  useEditLabel,
  useReorderNode,
  useSetQuestionType,
} from '@/hooks/use-templates-admin'
import { OPERATOR_LABEL, OPERATORS } from '@/lib/template-format'

// Session S3b, Part C follow-up (live feedback) — the question text itself. `code` stays locked
// (see templates.core.ts#editNodeLabel's doc) — only labelTh/num are editable here.
function LabelEditor({ templateId, node }: { templateId: string; node: TemplateNode }) {
  const editLabel = useEditLabel(templateId)
  const [labelTh, setLabelTh] = React.useState(node.labelTh)
  const [num, setNum] = React.useState(node.num ?? '')

  React.useEffect(() => {
    setLabelTh(node.labelTh)
    setNum(node.num ?? '')
  }, [node.code, node.labelTh, node.num])

  const dirty = labelTh !== node.labelTh || num !== (node.num ?? '')

  return (
    <div className="space-y-1.5">
      <p className="text-muted-foreground text-[11px]">ข้อความคำถาม (รหัสคงเดิม: <span className="font-mono">{node.code}</span>)</p>
      <div className="flex gap-2">
        <input className={`${INPUT_CLS} py-1.5 text-xs`} value={labelTh} onChange={(e) => setLabelTh(e.target.value)} placeholder="ข้อความคำถาม" />
        <input className={`${INPUT_CLS} w-16 py-1.5 text-xs`} value={num} onChange={(e) => setNum(e.target.value)} placeholder="เลข" />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => editLabel.mutate({ nodeCode: node.code, labelTh, num })}
          disabled={editLabel.isPending || !dirty || !labelTh.trim()}
          className="bg-primary text-primary-foreground flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {editLabel.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          บันทึกข้อความ
        </button>
        {editLabel.isError && <span className="text-[11px] text-red-500">{(editLabel.error as Error).message}</span>}
      </div>
    </div>
  )
}

const TYPE_OPTIONS: { value: QuestionTypeSelector; label: string }[] = [
  { value: 'presence', label: 'มี/ไม่มี' },
  { value: 'presence_standard', label: 'มี/ไม่มี + มาตรฐาน' },
  { value: 'measured', label: 'ต้องวัดค่า' },
]

function currentType(node: TemplateNode): QuestionTypeSelector {
  if (node.answerType !== 'presence_standard') return 'presence'
  return (node.measurements ?? []).length > 0 ? 'measured' : 'presence_standard'
}

function countLeaves(node: TemplateNode): number {
  const own = node.answerType ? 1 : 0
  return own + (node.subItems ?? []).reduce((sum, c) => sum + countLeaves(c), 0)
}

// Session S3b, Part C.3 — the new-measurement (threshold creation) form: anchor + operator +
// value(s)/tiers + unit. Simpler than MeasurementEditor's era-fork section since a brand-new
// measurement has no byLaw yet — add it flat first, then use the ordinary MeasurementEditor's
// era-fork section afterward (Part C.3.c reuses that S3a editor verbatim, no new UI for it here).
function NewMeasurementForm({ templateId, nodeCode, onDone }: { templateId: string; nodeCode: string; onDone: () => void }) {
  const addMeasurement = useAddMeasurement(templateId)
  const [operator, setOperator] = React.useState<ThresholdOperator>('gte')
  const [value, setValue] = React.useState<number | ''>('')
  const [value2, setValue2] = React.useState<number | ''>('')
  const [unit, setUnit] = React.useState('')
  const [autoGrade, setAutoGrade] = React.useState(true)
  const [sourceText, setSourceText] = React.useState('')

  function save() {
    addMeasurement.mutate(
      {
        nodeCode,
        body: {
          operator,
          value: operator === 'tiered' ? undefined : (value === '' ? null : value),
          value2: operator === 'range' ? (value2 === '' ? null : value2) : undefined,
          // Tiered creation from scratch needs an inputs pair; kept minimal (basis/provided) —
          // an admin refines labels afterward via the ordinary measurement editor if needed.
          tiers: operator === 'tiered' ? [{ min: 0, max: null, required: 0 }] : undefined,
          inputs: operator === 'tiered' ? [{ key: 'basis', labelTh: 'จำนวนทั้งหมด' }, { key: 'provided', labelTh: 'จำนวนที่มี' }] : undefined,
          unit,
          autoGrade,
          sourceText: sourceText || undefined,
        },
      },
      { onSuccess: onDone },
    )
  }

  return (
    <div className="border-border bg-secondary/30 space-y-2 rounded-lg border p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <select className={`${SELECT_CLS} py-1.5 text-xs`} value={operator} onChange={(e) => setOperator(e.target.value as ThresholdOperator)}>
          {OPERATORS.map((op) => <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>)}
        </select>
        <input className={`${INPUT_CLS} py-1.5 text-xs`} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="หน่วย (mm, count, ...)" />
      </div>
      {operator !== 'tiered' && (
        <div className="grid grid-cols-2 gap-2">
          <input type="number" className={`${INPUT_CLS} py-1.5 text-xs`} value={value} onChange={(e) => setValue(e.target.value === '' ? '' : Number(e.target.value))} placeholder="ค่า" />
          {operator === 'range' && (
            <input type="number" className={`${INPUT_CLS} py-1.5 text-xs`} value={value2} onChange={(e) => setValue2(e.target.value === '' ? '' : Number(e.target.value))} placeholder="ค่าสูงสุด" />
          )}
        </div>
      )}
      {operator === 'tiered' && (
        <p className="text-muted-foreground text-[11px]">จะสร้างตารางขั้นบันไดเปล่า 1 แถว — ปรับรายละเอียดได้จากตัวแก้ไขเกณฑ์หลังบันทึก</p>
      )}
      <label className="text-foreground flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={autoGrade} onChange={(e) => setAutoGrade(e.target.checked)} />
        ตัดเกรดอัตโนมัติ (autoGrade)
      </label>
      {/* Part C.3.a — the anchor: sourceText is the SAME field S3a's editor already uses. */}
      <input
        className={`${INPUT_CLS} py-1.5 text-xs`}
        value={sourceText}
        onChange={(e) => setSourceText(e.target.value)}
        placeholder="ข้อความอ้างอิง/จุดยึด (sourceText) — เช่น ส่วนของข้อความที่มีตัวเลขนี้"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={addMeasurement.isPending || !unit}
          className="bg-primary text-primary-foreground flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {addMeasurement.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          เพิ่มเกณฑ์
        </button>
        <button type="button" onClick={onDone} className="text-muted-foreground text-xs hover:underline">ยกเลิก</button>
      </div>
      {addMeasurement.isError && <p className="text-[11px] text-red-500">{(addMeasurement.error as Error).message}</p>}
    </div>
  )
}

function AddChildForm({ templateId, parentCode, onDone }: { templateId: string; parentCode: string; onDone: (code: string) => void }) {
  const addChild = useAddChildNode(templateId)
  const [labelTh, setLabelTh] = React.useState('')
  const [type, setType] = React.useState<QuestionTypeSelector>('presence')

  function save() {
    addChild.mutate(
      { parentCode, body: { labelTh, type } },
      { onSuccess: (result) => onDone(result.code) },
    )
  }

  return (
    <div className="border-border bg-secondary/30 space-y-2 rounded-lg border p-2.5">
      <input className={`${INPUT_CLS} py-1.5 text-xs`} value={labelTh} onChange={(e) => setLabelTh(e.target.value)} placeholder="ชื่อรายการย่อย" />
      <select className={`${SELECT_CLS} py-1.5 text-xs`} value={type} onChange={(e) => setType(e.target.value as QuestionTypeSelector)}>
        {TYPE_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
      </select>
      <p className="text-muted-foreground text-[11px]">รหัสจะถูกกำหนดโดยระบบอัตโนมัติ (ไม่ใช้ซ้ำแม้ลบไปแล้ว)</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={addChild.isPending || !labelTh.trim()}
          className="bg-primary text-primary-foreground flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
        >
          {addChild.isPending ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          เพิ่มข้อย่อย
        </button>
        <button type="button" onClick={() => onDone('')} className="text-muted-foreground text-xs hover:underline">ยกเลิก</button>
      </div>
      {addChild.isError && <p className="text-[11px] text-red-500">{(addChild.error as Error).message}</p>}
    </div>
  )
}

// Session S3b, Part C — everything here is DRAFT-only; the caller (TemplateNodeEditorDialog)
// only renders this when templateStatus === 'DRAFT', and the server enforces the same gate
// independently (STRUCTURE_EDIT_REQUIRES_DRAFT), so a stale client can never bypass it.
export function StructuralEditor({
  templateId,
  node,
  onNodeDeleted,
  onChildAdded,
  onNodeMoved,
}: {
  templateId: string
  node: TemplateNode
  onNodeDeleted: () => void
  onChildAdded: (code: string) => void
  // reorderNode now pins codes to their slot (Era-editor safety follow-up) — this node's own code
  // may change when it moves. Called with the new code so an open editor can follow the content.
  onNodeMoved?: (newCode: string) => void
}) {
  const setQuestionType = useSetQuestionType(templateId)
  const reorderNode = useReorderNode(templateId)
  const deleteNode = useDeleteNode(templateId)

  const [addingMeasurement, setAddingMeasurement] = React.useState(false)
  const [addingChild, setAddingChild] = React.useState(false)
  const [confirmingDowngradeTo, setConfirmingDowngradeTo] = React.useState<QuestionTypeSelector | null>(null)
  const [confirmingDelete, setConfirmingDelete] = React.useState(false)

  const type = currentType(node)
  const hasMeasurements = (node.measurements ?? []).length > 0

  function changeType(next: QuestionTypeSelector) {
    if (next === type) return
    setQuestionType.mutate(
      { nodeCode: node.code, type: next },
      {
        onError: (err) => {
          // The server's TemplateEditError message names exactly this — asking to confirm the
          // downgrade — rather than a generic failure; re-attempt with confirmDowngrade: true.
          if (hasMeasurements && next !== 'measured') setConfirmingDowngradeTo(next)
          void err
        },
      },
    )
  }

  function confirmDowngrade() {
    if (!confirmingDowngradeTo) return
    setQuestionType.mutate({ nodeCode: node.code, type: confirmingDowngradeTo, confirmDowngrade: true }, {
      onSuccess: () => setConfirmingDowngradeTo(null),
    })
  }

  return (
    <div className="border-border bg-card space-y-3 rounded-xl border p-3">
      <p className="text-foreground text-sm font-semibold">แก้ไขโครงสร้าง (เวอร์ชันร่าง)</p>

      <LabelEditor templateId={templateId} node={node} />

      {/* Part C.2 — question type selector */}
      <div>
        <p className="text-muted-foreground mb-1 text-[11px]">ประเภทคำถาม</p>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_OPTIONS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => changeType(t.value)}
              disabled={setQuestionType.isPending}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                type === t.value ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {confirmingDowngradeTo && (
          <div className="mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-700">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p>เปลี่ยนประเภทนี้จะลบเกณฑ์วัดค่าที่มีอยู่ ({node.measurements!.length} รายการ) ยืนยันหรือไม่?</p>
              <div className="mt-1 flex gap-2">
                <button type="button" onClick={confirmDowngrade} className="font-semibold underline">ยืนยัน ลบเกณฑ์</button>
                <button type="button" onClick={() => setConfirmingDowngradeTo(null)}>ยกเลิก</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Part C.3 — threshold creation, only offered when the type actually wants one */}
      {(type === 'measured' || type === 'presence_standard') && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <p className="text-muted-foreground text-[11px]">เกณฑ์วัดค่า</p>
            {!addingMeasurement && (
              <button type="button" onClick={() => setAddingMeasurement(true)} className="text-accent flex items-center gap-1 text-[11px] hover:underline">
                <Plus size={11} /> เพิ่มเกณฑ์วัดค่า
              </button>
            )}
          </div>
          {addingMeasurement && (
            <NewMeasurementForm templateId={templateId} nodeCode={node.code} onDone={() => setAddingMeasurement(false)} />
          )}
        </div>
      )}

      {/* Part C.4 — add sub-question, reorder, delete */}
      <div className="border-border space-y-2 border-t pt-2">
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-[11px]">รายการย่อย</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                reorderNode.mutate(
                  { nodeCode: node.code, direction: 'up' },
                  { onSuccess: (result) => onNodeMoved?.(result.code) },
                )
              }
              disabled={reorderNode.isPending}
              title="เลื่อนขึ้น (สลับรหัสกับรายการก่อนหน้า)"
              className="border-border rounded border p-1 text-xs disabled:opacity-40"
            >
              <ArrowUp size={12} />
            </button>
            <button
              type="button"
              onClick={() =>
                reorderNode.mutate(
                  { nodeCode: node.code, direction: 'down' },
                  { onSuccess: (result) => onNodeMoved?.(result.code) },
                )
              }
              disabled={reorderNode.isPending}
              title="เลื่อนลง (สลับรหัสกับรายการถัดไป)"
              className="border-border rounded border p-1 text-xs disabled:opacity-40"
            >
              <ArrowDown size={12} />
            </button>
            {!addingChild && (
              <button type="button" onClick={() => setAddingChild(true)} className="text-accent flex items-center gap-1 text-[11px] hover:underline">
                <Plus size={11} /> เพิ่มข้อย่อย
              </button>
            )}
          </div>
        </div>
        {addingChild && (
          <AddChildForm
            templateId={templateId}
            parentCode={node.code}
            onDone={(code) => { setAddingChild(false); if (code) onChildAdded(code) }}
          />
        )}
      </div>

      <div className="border-border border-t pt-2">
        {!confirmingDelete ? (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="flex items-center gap-1 text-xs font-medium text-red-500 hover:text-red-600"
          >
            <Trash2 size={13} /> ลบรายการนี้
          </button>
        ) : (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p>ลบ &ldquo;{node.labelTh}&rdquo; รวมรายการย่อยทั้งหมด ({countLeaves(node)} จุดตรวจ) ใช่หรือไม่? การลบนี้ย้อนกลับไม่ได้</p>
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  onClick={() => deleteNode.mutate({ nodeCode: node.code }, { onSuccess: onNodeDeleted })}
                  disabled={deleteNode.isPending}
                  className="font-semibold underline"
                >
                  ยืนยันลบ
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)}>ยกเลิก</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
