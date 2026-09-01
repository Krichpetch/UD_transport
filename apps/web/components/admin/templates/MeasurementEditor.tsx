'use client'

import * as React from 'react'
import type { TemplateMeasurement, TemplateTier, ThresholdOperator } from '@repo/types'
import { LAW_REFERENCE_SEED } from '@repo/types'
import { ArrowDown, ArrowUp, Check, Loader2, Plus, Trash2 } from 'lucide-react'
import { INPUT_CLS, SELECT_CLS } from '@/lib/ui-classes'
import { useConfirmMeasurement, useEditEra, useEditMeasurement, useReorderMeasurement } from '@/hooks/use-templates-admin'
import { buildEraEntryPatch, type EraEntryDraft } from '@/lib/api/templates'
import { OPERATOR_LABEL, OPERATORS } from '@/lib/template-format'

export function TierRowsEditor({ tiers, onChange }: { tiers: TemplateTier[]; onChange: (tiers: TemplateTier[]) => void }) {
  function update(i: number, patch: Partial<TemplateTier>) {
    onChange(tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)))
  }
  return (
    <div className="space-y-1.5">
      <div className="text-muted-foreground grid grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] gap-1 text-3xs">
        <span>min</span>
        <span>max</span>
        <span>required</span>
        <span>+ต่อ</span>
        <span>+จำนวน</span>
        <span />
      </div>
      {tiers.map((t, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] gap-1">
          <input type="number" className={`${INPUT_CLS} py-1`} value={t.min} onChange={(e) => update(i, { min: Number(e.target.value) })} />
          <input
            type="number"
            className={`${INPUT_CLS} py-1`}
            value={t.max ?? ''}
            placeholder="∞"
            onChange={(e) => update(i, { max: e.target.value === '' ? null : Number(e.target.value) })}
          />
          <input type="number" className={`${INPUT_CLS} py-1`} value={t.required} onChange={(e) => update(i, { required: Number(e.target.value) })} />
          <input
            type="number"
            className={`${INPUT_CLS} py-1`}
            value={t.incrementPer ?? ''}
            onChange={(e) => update(i, { incrementPer: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
          <input
            type="number"
            className={`${INPUT_CLS} py-1`}
            value={t.incrementBy ?? ''}
            onChange={(e) => update(i, { incrementBy: e.target.value === '' ? undefined : Number(e.target.value) })}
          />
          <button type="button" onClick={() => onChange(tiers.filter((_, idx) => idx !== i))} className="text-red-500 hover:text-red-600">
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...tiers, { min: 0, max: null, required: 0 }])}
        className="text-accent flex items-center gap-1 text-2xs hover:underline"
      >
        <Plus size={11} />
        เพิ่มขั้น
      </button>
    </div>
  )
}

// One law's override value block, in the same operator-driven shape as the flat measurement
// editor above it. `entry` may be a bare {} for a law just added client-side (not yet saved).
// Exported for GroupedItemEditDialog.tsx's era section, which mirrors this same per-lawCode,
// pre-filled-from-byLaw pattern rather than duplicating the input JSX.
//
// labelTh here matters as much as the value itself: editing ONLY value/tiers for a law changes
// what the auditor is GRADED against, but the question text they READ (this node's own labelTh)
// and the reference line under it (sourceText) stay on whatever the base/flat text says — often
// literally quoting the OLD number — until this law's own labelTh/sourceText are filled in too
// (era-resolution.ts#resolveMeasurement only swaps them when the resolved entry actually carries
// one). Leaving either blank isn't an error; it just means that law's stations keep reading the
// base text, which is wrong whenever this law's number differs from it.
export function EraEntryFields({
  operator,
  entry,
  onChange,
}: {
  operator: ThresholdOperator
  entry: EraEntryDraft
  onChange: (entry: EraEntryDraft) => void
}) {
  return (
    <div className="space-y-1.5">
      {operator === 'tiered' ? (
        <TierRowsEditor tiers={entry.tiers ?? []} onChange={(tiers) => onChange({ ...entry, tiers })} />
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="number"
            className={`${INPUT_CLS} py-1`}
            value={entry.value ?? ''}
            placeholder="value"
            onChange={(e) => onChange({ ...entry, value: e.target.value === '' ? null : Number(e.target.value) })}
          />
          {operator === 'range' && (
            <input
              type="number"
              className={`${INPUT_CLS} py-1`}
              value={entry.value2 ?? ''}
              placeholder="value2"
              onChange={(e) => onChange({ ...entry, value2: e.target.value === '' ? null : Number(e.target.value) })}
            />
          )}
        </div>
      )}
      <input
        className={`${INPUT_CLS} py-1 text-2xs`}
        value={entry.labelTh ?? ''}
        placeholder="ข้อความคำถามสำหรับกฎหมายนี้ (labelTh) — เว้นว่างถ้าใช้ข้อความเดิมของรายการ"
        onChange={(e) => onChange({ ...entry, labelTh: e.target.value })}
      />
      <input
        className={`${INPUT_CLS} py-1 text-2xs`}
        value={entry.sourceText ?? ''}
        placeholder="ข้อความอ้างอิงจากเอกสารต้นฉบับ (sourceText) สำหรับกฎหมายนี้"
        onChange={(e) => onChange({ ...entry, sourceText: e.target.value })}
      />
    </div>
  )
}

function EraOverridesSection({
  templateId,
  nodeCode,
  measurement,
}: {
  templateId: string
  nodeCode: string
  measurement: TemplateMeasurement
}) {
  const editEra = useEditEra(templateId)
  const [drafts, setDrafts] = React.useState<Record<string, EraEntryDraft>>({})
  const [addingLaw, setAddingLaw] = React.useState('')

  const existingCodes = Object.keys(measurement.byLaw ?? {})
  const availableToAdd = LAW_REFERENCE_SEED.filter((l) => !existingCodes.includes(l.code))

  function draftFor(lawCode: string) {
    return drafts[lawCode] ?? measurement.byLaw?.[lawCode] ?? {}
  }

  return (
    <div className="border-border mt-3 space-y-2 border-t pt-3">
      <p className="text-foreground text-xs font-semibold">ข้อยกเว้นตามยุคกฎหมาย (byLaw)</p>
      {existingCodes.length === 0 && <p className="text-muted-foreground text-2xs">ยังไม่มีข้อยกเว้นตามยุคกฎหมายสำหรับเกณฑ์นี้</p>}
      {existingCodes.map((lawCode) => {
        const law = LAW_REFERENCE_SEED.find((l) => l.code === lawCode)
        return (
          <div key={lawCode} className="bg-secondary/40 rounded-lg p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-foreground text-2xs font-medium">{law?.nameTh ?? lawCode}</p>
              <button
                type="button"
                disabled={editEra.isPending}
                onClick={() => editEra.mutate({ nodeCode, measurementKey: measurement.key, body: { lawCode, entry: null } })}
                className="flex items-center gap-1 text-3xs text-red-500 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 size={11} />
                ลบ
              </button>
            </div>
            <EraEntryFields
              operator={measurement.operator}
              entry={draftFor(lawCode)}
              onChange={(entry) => setDrafts((d) => ({ ...d, [lawCode]: entry }))}
            />
            <button
              type="button"
              disabled={editEra.isPending}
              onClick={() =>
                editEra.mutate({
                  nodeCode,
                  measurementKey: measurement.key,
                  body: { lawCode, entry: buildEraEntryPatch(measurement.operator, draftFor(lawCode)) },
                })
              }
              className="bg-primary text-primary-foreground mt-1.5 flex items-center gap-1 rounded px-2 py-1 text-3xs font-medium disabled:opacity-50"
            >
              {editEra.isPending ? <Loader2 size={10} className="animate-spin" /> : null}
              บันทึกค่าตามกฎหมายนี้
            </button>
          </div>
        )
      })}

      {availableToAdd.length > 0 && (
        <div className="flex items-center gap-1.5">
          <select className={`${SELECT_CLS} py-1 text-2xs`} value={addingLaw} onChange={(e) => setAddingLaw(e.target.value)}>
            <option value="">+ เพิ่มข้อยกเว้นตามกฎหมาย…</option>
            {availableToAdd.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nameTh}
              </option>
            ))}
          </select>
          {addingLaw && (
            <button
              type="button"
              onClick={() => {
                setDrafts((d) => ({ ...d, [addingLaw]: {} }))
                editEra.mutate(
                  { nodeCode, measurementKey: measurement.key, body: { lawCode: addingLaw, entry: measurement.operator === 'tiered' ? { tiers: [] } : { value: 0 } } },
                  { onSuccess: () => setAddingLaw('') },
                )
              }}
              className="border-border shrink-0 rounded border px-2 py-1 text-2xs"
            >
              เพิ่ม
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function MeasurementEditor({
  templateId,
  nodeCode,
  measurement,
  readOnly,
  reorder,
}: {
  templateId: string
  nodeCode: string
  measurement: TemplateMeasurement
  readOnly: boolean
  // Session S3b, Part C follow-up — display-order reorder (DRAFT-only; the caller only passes
  // this when templateStatus === 'DRAFT', same gate as everything else in StructuralEditor).
  // Safe regardless of position — scoring/era-resolution key by `measurement.key`, never index.
  reorder?: { isFirst: boolean; isLast: boolean }
}) {
  const editMeasurement = useEditMeasurement(templateId)
  const confirmMeasurement = useConfirmMeasurement(templateId)
  const reorderMeasurement = useReorderMeasurement(templateId)

  const [operator, setOperator] = React.useState<ThresholdOperator>(measurement.operator)
  const [value, setValue] = React.useState<number | ''>(measurement.value ?? '')
  const [value2, setValue2] = React.useState<number | ''>(measurement.value2 ?? '')
  const [tiers, setTiers] = React.useState<TemplateTier[]>(measurement.tiers ?? [])
  const [unit, setUnit] = React.useState(measurement.unit)
  const [autoGrade, setAutoGrade] = React.useState(measurement.autoGrade)
  const [sourceText, setSourceText] = React.useState(measurement.sourceText ?? '')

  function save() {
    editMeasurement.mutate({
      nodeCode,
      measurementKey: measurement.key,
      body: {
        operator,
        value: value === '' ? null : value,
        value2: value2 === '' ? null : value2,
        tiers: operator === 'tiered' ? tiers : undefined,
        unit,
        autoGrade,
        sourceText: sourceText || undefined,
      },
    })
  }

  return (
    <div className="border-border bg-card rounded-xl border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="text-foreground font-mono text-xs font-semibold">{measurement.key}</span>
          {reorder && (
            <>
              <button
                type="button"
                onClick={() => reorderMeasurement.mutate({ nodeCode, measurementKey: measurement.key, direction: 'up' })}
                disabled={reorderMeasurement.isPending || reorder.isFirst}
                title="เลื่อนขึ้น (ลำดับการแสดงผลในฟอร์มผู้ตรวจ)"
                className="border-border rounded border p-0.5 disabled:opacity-30"
              >
                <ArrowUp size={10} />
              </button>
              <button
                type="button"
                onClick={() => reorderMeasurement.mutate({ nodeCode, measurementKey: measurement.key, direction: 'down' })}
                disabled={reorderMeasurement.isPending || reorder.isLast}
                title="เลื่อนลง (ลำดับการแสดงผลในฟอร์มผู้ตรวจ)"
                className="border-border rounded border p-0.5 disabled:opacity-30"
              >
                <ArrowDown size={10} />
              </button>
            </>
          )}
        </div>
        <span
          className={`rounded px-1.5 py-0.5 text-3xs font-medium ${
            measurement.confirmed ? 'bg-[#52aa4e]/10 text-[#52aa4e]' : 'bg-[#ffc107]/10 text-[#b38600]'
          }`}
        >
          {measurement.confirmed ? 'ยืนยันแล้ว' : 'รอตรวจสอบ'}
          {measurement.extracted ? ' · สกัดอัตโนมัติ' : ''}
        </span>
      </div>

      {readOnly ? (
        <div className="text-muted-foreground space-y-1 text-xs">
          <p>ตัวดำเนินการ: {OPERATOR_LABEL[measurement.operator]}</p>
          {measurement.operator !== 'tiered' && (
            <p>
              ค่า: {measurement.value ?? '-'}
              {measurement.operator === 'range' ? ` – ${measurement.value2 ?? '-'}` : ''} {measurement.unit}
            </p>
          )}
          {measurement.sourceText && <p>ข้อความต้นฉบับ: {measurement.sourceText}</p>}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select className={`${SELECT_CLS} py-1.5 text-xs`} value={operator} onChange={(e) => setOperator(e.target.value as ThresholdOperator)}>
              {OPERATORS.map((op) => (
                <option key={op} value={op}>
                  {OPERATOR_LABEL[op]}
                </option>
              ))}
            </select>
            <input className={`${INPUT_CLS} py-1.5 text-xs`} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="หน่วย (mm, count, ratio_1_x)" />
          </div>

          {operator === 'tiered' ? (
            <TierRowsEditor tiers={tiers} onChange={setTiers} />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <input
                type="number"
                className={`${INPUT_CLS} py-1.5 text-xs`}
                value={value}
                onChange={(e) => setValue(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="ค่า"
              />
              {operator === 'range' && (
                <input
                  type="number"
                  className={`${INPUT_CLS} py-1.5 text-xs`}
                  value={value2}
                  onChange={(e) => setValue2(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="ค่าสูงสุด (value2)"
                />
              )}
            </div>
          )}

          <label className="text-foreground flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={autoGrade} onChange={(e) => setAutoGrade(e.target.checked)} />
            ตัดเกรดอัตโนมัติจากค่าที่กรอก (autoGrade)
          </label>

          <input
            className={`${INPUT_CLS} py-1.5 text-xs`}
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            placeholder="ข้อความอ้างอิงจากเอกสารต้นฉบับ (sourceText)"
          />

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={save}
              disabled={editMeasurement.isPending}
              className="bg-primary text-primary-foreground flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {editMeasurement.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              บันทึกเกณฑ์
            </button>
            {!measurement.confirmed && (
              <button
                type="button"
                onClick={() => confirmMeasurement.mutate({ nodeCode, measurementKey: measurement.key })}
                disabled={confirmMeasurement.isPending}
                className="border-border rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                ยืนยันเกณฑ์นี้
              </button>
            )}
            {editMeasurement.isError && <span className="text-2xs text-red-500">{(editMeasurement.error as Error).message}</span>}
          </div>

          <EraOverridesSection templateId={templateId} nodeCode={nodeCode} measurement={measurement} />
        </div>
      )}
    </div>
  )
}
