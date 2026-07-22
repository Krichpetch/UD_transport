'use client'

import * as React from 'react'
import { CheckSquare, Square, StickyNote, Ruler } from 'lucide-react'
import type { TemplateNode, ChecklistValue, ChecklistPhoto } from '@repo/types'
import { deriveMeasuredStandard, ratioLengthKey, ratioHeightKey } from '@repo/types'
import { useAuditFormStore } from '@/stores/audit-form.store'
import { PhotoPicker } from '@/components/audit/PhotoPicker'
import { ThresholdModalTrigger } from '@/components/audit/ThresholdModal'
import { ChecklistPhotoGallery } from '@/components/checklist/ChecklistPhotoGallery'
import { useDeleteChecklistPhoto } from '@/hooks/use-checklists'

// E-form redesign (Session E2, Part C) — one answerable leaf's controls, shared by the v1 pager
// and the v2 pager so both stay driven by the exact same interaction code (no forked มี/ไม่มี
// button implementation to keep in sync). `disabled` is set by a parent container's own ไม่มี
// answer (Part C.5) — the child's answer is preserved in the store either way, only the controls
// stop responding.
const CHOICE_OPTIONS: { value: ChecklistValue; label: string; active: string }[] = [
  { value: 'มี',    label: 'มี',            active: 'border-blue-300 bg-blue-50 text-blue-700' },
  { value: 'ไม่มี', label: 'ไม่มี',         active: 'border-red-200 bg-red-50 text-red-700' },
  { value: 'N/A',  label: 'ไม่เกี่ยวข้อง', active: 'border-gray-200 bg-gray-50 text-gray-600' },
]
const INACTIVE = 'border-border bg-white text-muted-foreground'

function unitSuffix(unit: string): string {
  if (unit === 'ratio_1_x') return ''
  return ` (${unit})`
}

// Session E2 follow-up — distinguishes at a glance which leaves are a plain มี/ไม่มี question vs.
// one that needs an entered measurement vs. one the auditor judges manually against a standard.
function AnswerTypeBadge({ node }: { node: TemplateNode }) {
  if (node.answerType === 'presence') {
    return <span className="shrink-0 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">มี/ไม่มี</span>
  }
  if (node.answerType === 'presence_standard') {
    const measured = node.measurements && node.measurements.length > 0
    return measured ? (
      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-blue-50 px-1.5 py-0.5 text-[9px] font-medium text-blue-700">
        <Ruler size={9} /> ต้องวัดค่า
      </span>
    ) : (
      <span className="shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">ประเมินโดยผู้ตรวจ</span>
    )
  }
  return null // 'choice' (v1) — no badge, matches today's live form exactly
}

// Live, non-tappable derived indicator — DATA_DICTIONARY_v2.md §2 / Part C.3: the auditor enters
// numbers only, the server derives the verdict at submit; this is a preview, never the source of
// truth for scoring.
function DerivedIndicator({ node, values }: { node: TemplateNode; values: Record<string, number> }) {
  if (!node.measurements?.some((m) => m.autoGrade)) return null
  const verdict = deriveMeasuredStandard(node.measurements, values)
  if (verdict === null) return (
    <p className="mt-1.5 text-[10px] text-muted-foreground">ยังคำนวณไม่ได้ — กรอกค่าให้ครบ</p>
  )
  return (
    <p className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium ${verdict ? 'text-green-700' : 'text-red-600'}`}>
      {verdict ? 'ได้มาตรฐาน' : 'ไม่ได้มาตรฐาน'} <span className="text-[9px] font-normal text-muted-foreground">(คำนวณอัตโนมัติ)</span>
    </p>
  )
}

export function LeafAnswerRow({ node, disabled = false, breadcrumb }: {
  node: TemplateNode
  disabled?: boolean
  breadcrumb?: string[]  // ancestor labels, for the threshold modal's "which item is this" context
}) {
  const answer = useAuditFormStore((s) => s.answers[node.code])
  const setAnswer = useAuditFormStore((s) => s.setAnswer)
  const stationId = useAuditFormStore((s) => s.stationId)
  const checklistId = useAuditFormStore((s) => s.checklistId)
  const deletePhotoMutation = useDeleteChecklistPhoto(stationId ?? '')
  const [notesOpen, setNotesOpen] = React.useState(false)

  if (!answer || !node.answerType) return null

  // Session E3, Part C.3 — removes a photo the auditor just added (wrong-evidence case), while
  // the checklist is DRAFT/REJECTED-being-fixed, which is the only state this form ever renders
  // in. If autosave has already created a draft row, the server call also deletes the MinIO
  // object and audit-logs it; if not (photo added before the first autosave tick), there's
  // nothing persisted yet to delete server-side — the local removal is itself the fix, and the
  // next autosave simply never writes this photo out.
  async function handleDeletePhoto(photo: ChecklistPhoto) {
    if (checklistId) {
      await deletePhotoMutation.mutateAsync({ checklistId, itemId: node.code, photoId: photo.id })
    }
    setAnswer(node.code, { photos: answer!.photos.filter((p) => p.id !== photo.id) })
  }

  const rowDisabledCls = disabled ? 'opacity-40 pointer-events-none' : ''

  return (
    <div className={`px-4 py-3.5 ${rowDisabledCls}`}>
      <div className="mb-2.5 flex items-start gap-2">
        <span className="text-muted-foreground bg-secondary mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">
          {node.code}{node.num ? ` (${node.num})` : ''}
        </span>
        <div className="flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-foreground text-sm leading-snug">{node.labelTh}</p>
            <ThresholdModalTrigger node={node} breadcrumb={breadcrumb} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <AnswerTypeBadge node={node} />
            {node.cabinetResolution && (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                มติ ครม.
              </span>
            )}
          </div>
        </div>
      </div>

      {node.answerType === 'choice' && (
        <ChoiceControl node={node} value={answer.value} meetsStandard={answer.meetsStandard} setAnswer={setAnswer} />
      )}
      {node.answerType === 'presence' && (
        <PresenceControl code={node.code} present={answer.present} value={answer.value} setAnswer={setAnswer} />
      )}
      {node.answerType === 'presence_standard' && (
        <PresenceStandardControl node={node} answer={answer} setAnswer={setAnswer} />
      )}

      {answer.photos.length > 0 && (
        <div className="mt-2.5">
          <ChecklistPhotoGallery photos={answer.photos} onDelete={handleDeletePhoto} />
        </div>
      )}
      <PhotoPicker
        existingCount={answer.photos.length}
        onPhotosUploaded={(photos) => setAnswer(node.code, { photos: [...answer.photos, ...photos] })}
      />

      {answer.note || notesOpen ? (
        <textarea
          value={answer.note}
          onChange={(e) => setAnswer(node.code, { note: e.target.value })}
          placeholder="บันทึกเพิ่มเติม (ถ้ามี)"
          rows={1}
          className="border-border placeholder:text-muted-foreground focus:ring-ring mt-2.5 w-full resize-none rounded-lg border bg-white px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1"
        />
      ) : (
        <button
          onClick={() => setNotesOpen(true)}
          className="text-muted-foreground hover:text-foreground mt-2.5 flex items-center gap-1 text-[11px]"
        >
          <StickyNote size={11} /> เพิ่มบันทึก
        </button>
      )}
    </div>
  )
}

function ChoiceControl({ node, value, meetsStandard, setAnswer }: {
  node: TemplateNode
  value: ChecklistValue
  meetsStandard: boolean
  setAnswer: (code: string, patch: Record<string, unknown>) => void
}) {
  return (
    <>
      <div className="flex gap-2">
        {CHOICE_OPTIONS.map((opt) => (
          <button
            key={opt.value!}
            onClick={() => setAnswer(node.code, {
              value: value === opt.value ? null : opt.value,
              meetsStandard: opt.value === 'มี' ? meetsStandard : false,
            })}
            className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${value === opt.value ? opt.active : INACTIVE}`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {value === 'มี' && (
        <button
          onClick={() => setAnswer(node.code, { meetsStandard: !meetsStandard })}
          className={`mt-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
            meetsStandard ? 'border-green-300 bg-green-50 text-green-700' : 'border-border text-muted-foreground'
          }`}
        >
          {meetsStandard ? <CheckSquare size={13} className="shrink-0" /> : <Square size={13} className="shrink-0" />}
          ได้มาตรฐาน
        </button>
      )}
    </>
  )
}

// mี/ไม่มี/ไม่เกี่ยวข้อง — 3-way, mutually exclusive (Session E2 follow-up: some v2 criteria are
// mutually-exclusive alternatives, e.g. three ramp-length bands where only one applies; the other
// two get marked ไม่เกี่ยวข้อง). `present` and `value` ('N/A' or null) are kept mutually exclusive
// by construction here — selecting ไม่เกี่ยวข้อง clears `present`; selecting มี/ไม่มี clears `value`.
function PresenceControl({ code, present, value, setAnswer }: {
  code: string
  present: boolean | null
  value: ChecklistValue
  setAnswer: (code: string, patch: Record<string, unknown>) => void
}) {
  const isNa = value === 'N/A'
  return (
    <div className="flex gap-2">
      <button
        onClick={() => setAnswer(code, { present: present === true ? null : true, value: null })}
        className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${present === true && !isNa ? 'border-blue-300 bg-blue-50 text-blue-700' : INACTIVE}`}
      >
        มี
      </button>
      <button
        onClick={() => setAnswer(code, { present: present === false ? null : false, value: null })}
        className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${present === false && !isNa ? 'border-red-200 bg-red-50 text-red-700' : INACTIVE}`}
      >
        ไม่มี
      </button>
      <button
        onClick={() => setAnswer(code, { present: null, value: isNa ? null : 'N/A' })}
        className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${isNa ? 'border-gray-300 bg-gray-100 text-gray-600' : INACTIVE}`}
      >
        ไม่เกี่ยวข้อง
      </button>
    </div>
  )
}

function PresenceStandardControl({ node, answer, setAnswer }: {
  node: TemplateNode
  answer: { present: boolean | null; value: ChecklistValue; meetsStandard: boolean; values: Record<string, number> }
  setAnswer: (code: string, patch: Record<string, unknown>) => void
}) {
  const measured = node.measurements && node.measurements.length > 0
  return (
    <>
      <PresenceControl code={node.code} present={answer.present} value={answer.value} setAnswer={setAnswer} />
      {answer.present === true && (
        measured ? (
          <div className="mt-2.5 space-y-2">
            {node.measurements!.map((m) => (
              <MeasurementInput key={m.key} code={node.code} measurement={m} values={answer.values} setAnswer={setAnswer} />
            ))}
            <DerivedIndicator node={node} values={answer.values} />
          </div>
        ) : (
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => setAnswer(node.code, { meetsStandard: true })}
              className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${answer.meetsStandard ? 'border-green-300 bg-green-50 text-green-700' : INACTIVE}`}
            >
              ได้มาตรฐาน
            </button>
            <button
              onClick={() => setAnswer(node.code, { meetsStandard: false })}
              className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${!answer.meetsStandard ? 'border-red-200 bg-red-50 text-red-700' : INACTIVE}`}
            >
              ไม่ได้มาตรฐาน
            </button>
          </div>
        )
      )}
    </>
  )
}

function MeasurementInput({ code, measurement, values, setAnswer }: {
  code: string
  measurement: NonNullable<TemplateNode['measurements']>[number]
  values: Record<string, number>
  setAnswer: (code: string, patch: Record<string, unknown>) => void
}) {
  function setValue(key: string, raw: string) {
    const n = raw === '' ? undefined : Number(raw)
    const next = { ...values }
    if (n === undefined || Number.isNaN(n)) delete next[key]
    else next[key] = n
    setAnswer(code, { values: next })
  }

  if (measurement.operator === 'tiered' && measurement.inputs) {
    return (
      <div className="flex gap-2">
        {measurement.inputs.map((inp) => (
          <label key={inp.key} className="flex-1 text-[11px] text-muted-foreground">
            {inp.labelTh}
            <input
              type="number"
              inputMode="decimal"
              value={values[inp.key] ?? ''}
              onChange={(e) => setValue(inp.key, e.target.value)}
              className="border-border focus:ring-ring mt-1 w-full rounded-lg border bg-white px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1"
            />
          </label>
        ))}
      </div>
    )
  }

  // Slope convention (Session E2 follow-up) — ความชัน is entered as raw ความยาว/ความสูง (cm) for
  // BOTH slope encodings seeded today (ratio_1_x and percent — the same physical quantity, rise ÷
  // run, just formatted differently by the source form); deriveMeasuredStandard (scoring.ts)
  // computes and grades the derived value server-side against the SAME keys. The readout here is
  // a live, non-editable preview only. NOT used for unit:'degree' — those mix genuine slope
  // angles with door hinge-opening angles that have no length/height to derive from at all.
  if (measurement.unit === 'ratio_1_x' || measurement.unit === 'percent') {
    const lengthKey = ratioLengthKey(measurement.key)
    const heightKey = ratioHeightKey(measurement.key)
    const length = values[lengthKey]
    const height = values[heightKey]
    const hasBoth = typeof length === 'number' && typeof height === 'number' && length !== 0
    const preview = hasBoth
      ? measurement.unit === 'percent' ? `ร้อยละ ${((height! / length!) * 100).toFixed(1)}` : `1 : ${(length! / height!).toFixed(1)}`
      : '-'
    return (
      <div className="space-y-1.5">
        {measurement.sourceText && <p className="text-[11px] text-muted-foreground">{measurement.sourceText}</p>}
        <div className="flex gap-2">
          <label className="flex-1 text-[11px] text-muted-foreground">
            ความยาว (ซม.)
            <input
              type="number"
              inputMode="decimal"
              value={length ?? ''}
              onChange={(e) => setValue(lengthKey, e.target.value)}
              className="border-border focus:ring-ring mt-1 w-full rounded-lg border bg-white px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1"
            />
          </label>
          <label className="flex-1 text-[11px] text-muted-foreground">
            ความสูง (ซม.)
            <input
              type="number"
              inputMode="decimal"
              value={height ?? ''}
              onChange={(e) => setValue(heightKey, e.target.value)}
              className="border-border focus:ring-ring mt-1 w-full rounded-lg border bg-white px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1"
            />
          </label>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {measurement.unit === 'percent' ? 'ความลาดชัน' : 'อัตราส่วน'}: <span className="font-medium text-foreground">{preview}</span>
        </p>
      </div>
    )
  }

  return (
    <label className="block text-[11px] text-muted-foreground">
      {measurement.sourceText ?? measurement.key}
      <div className="mt-1 flex items-center gap-1.5">
        <input
          type="number"
          inputMode="decimal"
          value={values[measurement.key] ?? ''}
          onChange={(e) => setValue(measurement.key, e.target.value)}
          className="border-border focus:ring-ring w-full rounded-lg border bg-white px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1"
        />
        <span className="text-xs text-muted-foreground">{unitSuffix(measurement.unit).replace(/[()]/g, '')}</span>
      </div>
    </label>
  )
}
