'use client'

import * as React from 'react'
import { AlertTriangle, Check, Link2, Loader2 } from 'lucide-react'
import type { ChecklistTemplateDefinition, TemplateTier, ThresholdOperator } from '@repo/types'
import { FACILITY_CATALOG } from '@repo/types'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DIALOG_HEADER_CLS, DIALOG_TITLE_CLS, INPUT_CLS, SELECT_CLS } from '@/lib/ui-classes'
import { useAddTopLevelItem } from '@/hooks/use-templates-admin'
import { useFacilityGroups } from '@/hooks/use-facility-groups'
import { GROUPED_EDITOR_VERSION } from '@/lib/api/facility-groups'
import { OPERATOR_LABEL, OPERATORS } from '@/lib/template-format'
import { bestFuzzyMatch } from '@/lib/fuzzy-match'
import { TierRowsEditor } from './MeasurementEditor'
import type { QuestionTypeSelector } from '@/lib/api/templates'

const TYPE_OPTIONS: { value: QuestionTypeSelector; label: string }[] = [
  { value: 'presence', label: 'มี/ไม่มี' },
  { value: 'presence_standard', label: 'มี/ไม่มี + มาตรฐาน' },
  { value: 'measured', label: 'ต้องวัดค่า' },
]

// Individual-editor sibling of AddAndPlaceDialog.tsx (the grouped editor's "เพิ่มรายการ /
// เพิ่มกลุ่มข้อย่อย") — closes the gap where the individual editor could only ever add a CHILD under
// an already-selected existing node (StructuralEditor.tsx's AddChildForm), never a brand-new
// TOP-LEVEL item (a sibling directly under a GROUP, e.g. inserted before TTRS). Scoped to
// group-level insertion only — the anchor is always one of the chosen group's own top-level items
// (templates.core.ts#addPositionedChildNode's group branch only ever searches `group.items`, never
// deeper); inserting a positioned child at a DEEPER level under an existing node is a smaller,
// separate extension of AddChildForm this dialog doesn't attempt.
//
// "Create new" vs "choose from a facility template": picking a facilityCode pre-fills labelTh from
// FACILITY_CATALOG's own nameTh (freely editable afterward) and lets the server derive
// lawRefs/cabinetResolution/beyondLaw from the catalog, the same "choose from a facility template"
// pattern add-and-place already offers. "Create new" leaves labelTh blank and skips facilityCode
// entirely — lawRefs can still be added afterward via the created node's own LawRefsEditor.
export function AddTopLevelItemDialog({
  templateId,
  templateVersion,
  definition,
  onClose,
  onAdded,
}: {
  templateId: string
  // Era-editor safety follow-up — only used for the live "will this link to an existing facility
  // group?" hint below; the grouping engine is v3-only (GROUPED_EDITOR_VERSION), same gate the
  // template detail page already applies to its own provenance-banner lookup.
  templateVersion: number
  definition: ChecklistTemplateDefinition
  onClose: () => void
  onAdded?: (code: string) => void
}) {
  const addTopLevelItem = useAddTopLevelItem(templateId)
  const groupsQuery = useFacilityGroups(GROUPED_EDITOR_VERSION, { enabled: templateVersion === GROUPED_EDITOR_VERSION })

  const [mode, setMode] = React.useState<'blank' | 'catalog'>('blank')
  const [groupCode, setGroupCode] = React.useState('')
  const [anchorCode, setAnchorCode] = React.useState('')
  const [side, setSide] = React.useState<'before' | 'after'>('before')

  const [labelTh, setLabelTh] = React.useState('')
  const [facilityCode, setFacilityCode] = React.useState<number | ''>('')
  const [type, setType] = React.useState<QuestionTypeSelector>('presence')
  const [operator, setOperator] = React.useState<ThresholdOperator>('gte')
  const [value, setValue] = React.useState<number | ''>('')
  const [value2, setValue2] = React.useState<number | ''>('')
  const [tiers, setTiers] = React.useState<TemplateTier[]>([])
  const [unit, setUnit] = React.useState('')
  const [sourceText, setSourceText] = React.useState('')

  const group = definition.groups.find((g) => g.code === groupCode)
  const anchorLabel = group?.items.find((n) => n.code === anchorCode)?.labelTh
  const facilityEntry = facilityCode === '' ? undefined : FACILITY_CATALOG.find((f) => f.code === facilityCode)

  // Era-editor safety follow-up — a real bug found live: a hand-typed label one syllable off from
  // an existing cross-template group's text (0.917 similarity, below the engine's 0.95 cutoff)
  // silently failed to join that group, with zero indication anywhere that it hadn't. This warns
  // BEFORE saving instead of leaving the admin to discover it later on the groups page. Compared
  // against containerGroups (depth-0 roots) since addTopLevelItem only ever inserts at that depth.
  const labelMatch = React.useMemo(() => {
    const roots = groupsQuery.data?.containerGroups
    if (!roots || !labelTh.trim()) return null
    return bestFuzzyMatch(labelTh, roots, (g) => g.labelTh)
  }, [groupsQuery.data, labelTh])

  function onModeChange(next: 'blank' | 'catalog') {
    setMode(next)
    if (next === 'blank') {
      setFacilityCode('')
    }
  }

  function onFacilityCodeChange(code: number | '') {
    setFacilityCode(code)
    if (code !== '') {
      const entry = FACILITY_CATALOG.find((f) => f.code === code)
      if (entry) setLabelTh(entry.nameTh)
    }
  }

  function save() {
    addTopLevelItem.mutate(
      {
        containerCode: groupCode,
        anchorCode,
        side,
        labelTh,
        type,
        threshold:
          type === 'measured'
            ? {
                operator,
                value: operator === 'tiered' ? undefined : (value === '' ? null : value),
                value2: operator === 'range' ? (value2 === '' ? null : value2) : undefined,
                tiers: operator === 'tiered' ? (tiers.length > 0 ? tiers : [{ min: 0, max: null, required: 0 }]) : undefined,
                inputs: operator === 'tiered' ? [{ key: 'basis', labelTh: 'จำนวนทั้งหมด' }, { key: 'provided', labelTh: 'จำนวนที่มี' }] : undefined,
                unit,
                autoGrade: true,
                sourceText: sourceText || undefined,
              }
            : undefined,
        facilityCode: mode === 'catalog' && facilityCode !== '' ? facilityCode : undefined,
      },
      { onSuccess: (result) => { onAdded?.(result.code); onClose() } },
    )
  }

  const canSave = !!groupCode && !!anchorCode && !!labelTh.trim() && (type !== 'measured' || !!unit)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col overflow-hidden p-0 sm:max-w-xl">
        <div className={DIALOG_HEADER_CLS}>
          <DialogTitle className={DIALOG_TITLE_CLS}>เพิ่มรายการใหม่ (ระดับบนสุดของกลุ่ม)</DialogTitle>
          <p className="text-muted-foreground mt-1 text-sm">เพิ่มรายการใหม่ในแบบประเมินนี้เท่านั้น วางในตำแหน่งที่เลือกภายในกลุ่ม</p>
        </div>

        <div className="themed-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm">
          <div>
            <label className="text-muted-foreground mb-1 block text-sm">กลุ่ม</label>
            <select
              className={`${SELECT_CLS} text-sm`}
              value={groupCode}
              onChange={(e) => { setGroupCode(e.target.value); setAnchorCode('') }}
            >
              <option value="">เลือกกลุ่ม…</option>
              {definition.groups.map((g) => (
                <option key={g.code} value={g.code}>
                  {g.code} — {g.labelTh}
                </option>
              ))}
            </select>
          </div>

          {group && (
            <>
              <div>
                <label className="text-muted-foreground mb-1 block text-sm">ตำแหน่งอ้างอิง (anchor) — รายการที่จะวางไว้ก่อน/หลัง</label>
                <select className={`${SELECT_CLS} text-sm`} value={anchorCode} onChange={(e) => setAnchorCode(e.target.value)}>
                  <option value="">เลือกรายการอ้างอิง…</option>
                  {group.items.map((n) => (
                    <option key={n.code} value={n.code}>
                      {n.code} — {n.labelTh}
                    </option>
                  ))}
                </select>
              </div>

              {anchorCode && (
                <div className="flex items-center gap-4">
                  {(['before', 'after'] as const).map((s) => (
                    <label key={s} className="text-foreground flex items-center gap-1.5 text-sm">
                      <input type="radio" checked={side === s} onChange={() => setSide(s)} />
                      {s === 'before' ? `ก่อน "${anchorLabel}"` : `หลัง "${anchorLabel}"`}
                    </label>
                  ))}
                </div>
              )}

              <div className="border-border space-y-2.5 border-t pt-3">
                <div className="flex items-center gap-4">
                  <label className="text-foreground flex items-center gap-1.5 text-sm">
                    <input type="radio" checked={mode === 'blank'} onChange={() => onModeChange('blank')} />
                    สร้างรายการใหม่ทั้งหมด
                  </label>
                  <label className="text-foreground flex items-center gap-1.5 text-sm">
                    <input type="radio" checked={mode === 'catalog'} onChange={() => onModeChange('catalog')} />
                    เลือกจากหมวดหมู่สิ่งอำนวยความสะดวก
                  </label>
                </div>

                {mode === 'catalog' && (
                  <select
                    className={`${SELECT_CLS} text-sm`}
                    value={facilityCode}
                    onChange={(e) => onFacilityCodeChange(e.target.value === '' ? '' : Number(e.target.value))}
                  >
                    <option value="">เลือกหมวดหมู่…</option>
                    {FACILITY_CATALOG.map((f) => (
                      <option key={f.code} value={f.code}>
                        {f.code}. {f.nameTh}
                      </option>
                    ))}
                  </select>
                )}
                {facilityEntry && (
                  <p className="text-muted-foreground text-xs">
                    จะกำหนดข้อยกเว้นทางกฎหมายอัตโนมัติ: {facilityEntry.lawRefs.join(', ')}
                    {facilityEntry.beyondLaw ? ' (นอกเหนือกฎหมาย)' : ''}
                  </p>
                )}

                <input
                  className={`${INPUT_CLS} text-sm`}
                  value={labelTh}
                  onChange={(e) => setLabelTh(e.target.value)}
                  placeholder="ข้อความคำถาม เช่น ถังขยะแบบยกเคลื่อนที่ได้"
                />
                {labelMatch?.willGroup && (
                  <p className="flex items-center gap-1.5 text-xs text-[#52aa4e]">
                    <Link2 size={12} />
                    จะรวมกับกลุ่มที่มีอยู่แล้ว &ldquo;{labelMatch.item.labelTh}&rdquo; ({labelMatch.item.instanceCount} ที่)
                  </p>
                )}
                {labelMatch && !labelMatch.willGroup && labelMatch.ratio >= 0.75 && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-600">
                    <AlertTriangle size={12} />
                    ข้อความใกล้เคียงกลุ่ม &ldquo;{labelMatch.item.labelTh}&rdquo; แต่ตรงกันแค่ {Math.round(labelMatch.ratio * 100)}% — ไม่พอที่จะรวมกลุ่ม
                    (ต้อง ≥95%) พิมพ์ให้ตรงกันเป๊ะๆ ถ้าต้องการให้รวมกับกลุ่มนี้
                  </p>
                )}

                <select className={`${SELECT_CLS} text-sm`} value={type} onChange={(e) => setType(e.target.value as QuestionTypeSelector)}>
                  {TYPE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>

                {type === 'measured' && (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2.5">
                      <select className={`${SELECT_CLS} text-sm`} value={operator} onChange={(e) => setOperator(e.target.value as ThresholdOperator)}>
                        {OPERATORS.map((op) => (
                          <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>
                        ))}
                      </select>
                      <input className={`${INPUT_CLS} text-sm`} placeholder="หน่วย (mm, count, ...)" value={unit} onChange={(e) => setUnit(e.target.value)} />
                    </div>
                    {operator === 'tiered' ? (
                      <TierRowsEditor tiers={tiers} onChange={setTiers} />
                    ) : (
                      <div className="grid grid-cols-2 gap-2.5">
                        <input type="number" className={`${INPUT_CLS} text-sm`} placeholder="ค่า" value={value} onChange={(e) => setValue(e.target.value === '' ? '' : Number(e.target.value))} />
                        {operator === 'range' && (
                          <input type="number" className={`${INPUT_CLS} text-sm`} placeholder="ค่าสูงสุด" value={value2} onChange={(e) => setValue2(e.target.value === '' ? '' : Number(e.target.value))} />
                        )}
                      </div>
                    )}
                    <input
                      className={`${INPUT_CLS} text-sm`}
                      placeholder="ข้อความอ้างอิงจากเอกสารต้นฉบับ (sourceText)"
                      value={sourceText}
                      onChange={(e) => setSourceText(e.target.value)}
                    />
                  </div>
                )}
              </div>
            </>
          )}

          {addTopLevelItem.isError && <p className="text-sm text-red-500">{(addTopLevelItem.error as Error).message}</p>}
        </div>

        <div className="border-border flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4">
          <button type="button" onClick={onClose} className="border-border rounded-lg border px-4 py-2 text-sm font-medium">
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={!canSave || addTopLevelItem.isPending}
            onClick={save}
            className="bg-primary text-primary-foreground flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
          >
            {addTopLevelItem.isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            เพิ่มรายการ
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
