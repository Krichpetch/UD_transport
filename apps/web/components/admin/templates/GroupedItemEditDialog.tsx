'use client'

import * as React from 'react'
import { Check, Loader2, Send, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DIALOG_HEADER_CLS, DIALOG_TITLE_CLS, INPUT_CLS, SELECT_CLS } from '@/lib/ui-classes'
import { TransportBadge } from '@/components/shared/badges'
import { usePropagateItemEdit } from '@/hooks/use-facility-groups'
import { useTemplateImageUrls } from '@/hooks/use-template-image-urls'
import { MAX_TEMPLATE_IMAGES_PER_NODE, uploadGroupedImage } from '@/lib/api/facility-groups'
import { sortByNodeCode } from '@/lib/template-code-order'
import { OPERATOR_LABEL, OPERATORS } from '@/lib/template-format'
import { EraEntryFields, TierRowsEditor } from '@/components/admin/templates/MeasurementEditor'
import { buildEraEntryPatch, buildMeasurementPatch, type EraEntryDraft, type MeasurementDraft } from '@/lib/api/templates'
import type { GroupNodeRow, GroupedEditBody, InstanceMeasurement, ItemInstanceRow } from '@/lib/api/facility-groups'
import type { TemplateTier, ThresholdOperator } from '@repo/types'
import { LAW_REFERENCE_SEED, isNeverEraGated } from '@repo/types'

// Session S4b-fix, Fix 1 — this dialog used to gate every field behind a "ฟิลด์ที่จะแก้ไข" picker,
// showing ONE section at a time plus a raw encoded answer-spec string. That diverged badly from
// the individual per-item editor (TemplateNodeEditorDialog), which stacks every editable section
// in one scrollable modal. This version matches that: same modal chrome (DIALOG_HEADER_CLS/
// DIALOG_TITLE_CLS, scrollable middle, single footer close button), every section always visible,
// structured measurement fields instead of any encoded string. The one deliberate difference from
// the individual editor: every section here keeps its own two-step "preview -> confirm" gate
// (propagate writes N rows at once, not one) — each section manages that independently so editing
// several fields in one visit never forces re-picking a field and losing place, which was the
// actual complaint.
export function GroupedItemEditDialog({
  version,
  item,
  onClose,
}: {
  version: number
  item: GroupNodeRow | null
  onClose: () => void
}) {
  if (!item) return null
  return <GroupedItemEditDialogContent version={version} item={item} onClose={onClose} />
}

function GroupedItemEditDialogContent({ version, item, onClose }: { version: number; item: GroupNodeRow; onClose: () => void }) {
  const sortedInstances = React.useMemo(() => sortByNodeCode(item.instances, (i) => i.nodeCode), [item.instances])
  const representative: ItemInstanceRow = sortedInstances[0]!

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col overflow-hidden p-0 sm:max-w-2xl">
        <div className={DIALOG_HEADER_CLS}>
          {/* UDT-61, Part 2 — a single-instance item isn't "shared" with anything; saying so here
              (and "publish" below) would misdescribe what's actually a plain single-template edit. */}
          <p className="text-muted-foreground mb-1 text-3xs">
            {item.instanceCount > 1 ? `แก้ไขตามกลุ่ม · ใช้ร่วมกัน ${item.instanceCount} จุด` : 'แก้ไขรายการนี้ · มีเฉพาะแบบประเมินนี้'}
          </p>
          <DialogTitle className={DIALOG_TITLE_CLS}>{item.labelTh}</DialogTitle>
        </div>

        <div className="themed-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <InstanceListPanel instances={sortedInstances} />

          {/* Session S5-fix (round 4) — facilityCode/lawRefs are a LEAF-ONLY concept throughout
              this codebase (facility-tagging.ts's own doc: "preserving the facilityCode/lawRefs
              live on leaves only invariant every other reader — era-resolution.ts, the admin
              lawRefs editor, summarizeTemplate — already assumes"). isItemApplicable
              (era-resolution.ts) only ever reads lawRefs off a node WITH answerType, so a
              container's own lawRefs field has ZERO effect on scoring/redaction even if set. A
              container was never seed-tagged with lawRefs in the first place (tagContainers only
              stamps facilityCode there, tagLeaves stamps lawRefs onto leaves) — showing an
              editable, always-empty lawRefs section on a container was misleading (looked like
              "no law enforced" when really "not applicable at this level") and, worse, would
              wholesale-push that empty value over sibling instances the moment ANY other field on
              that container got edited. Measurements/guidance/lawRefs are ALL leaf-only here now. */}
          {!item.isLeaf && (
            <div className="bg-secondary/60 text-muted-foreground rounded-lg p-2.5 text-sm">
              รายการนี้เป็นหมวดหมู่ (ไม่มีคำตอบของตัวเอง) — แก้ไขได้เฉพาะข้อความ รูปภาพ และการซ่อน/แสดง
              ข้อยกเว้นทางกฎหมายกำหนดที่รายการย่อย (leaf) เท่านั้น
            </div>
          )}

          {item.isLeaf && representative.measurements.length > 0 && (
            <div className="space-y-2">
              <p className="text-foreground text-sm font-semibold">เกณฑ์ตัวเลข</p>
              {representative.measurements.map((m) => (
                <GroupedMeasurementCard key={m.key} version={version} item={item} measurementKey={m.key} initial={m} facilityCode={representative.facilityCode} />
              ))}
            </div>
          )}

          {item.isLeaf && <GroupedGuidanceSection version={version} item={item} />}
          {item.isLeaf && <GroupedLawRefsSection version={version} item={item} representative={representative} />}
          <GroupedHiddenSection version={version} item={item} representative={representative} />
          <GroupedLabelSection version={version} item={item} initialLabel={item.labelTh} />
          <GroupedImageEditor version={version} item={item} representative={representative} />
        </div>

        <div className="border-border shrink-0 border-t px-6 py-4">
          <button type="button" onClick={onClose} className="bg-primary text-primary-foreground w-full rounded-lg py-2 text-sm font-medium">
            ปิด
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function InstanceListPanel({ instances }: { instances: ItemInstanceRow[] }) {
  return (
    <div>
      <p className="text-foreground mb-1.5 text-sm font-semibold">
        {instances.length > 1 ? `จะเขียนไปยัง ${instances.length} จุด (ทุกแบบประเมินที่มีรายการนี้)` : 'มีอยู่ในแบบประเมินนี้แบบเดียว'}
      </p>
      <div className="border-border max-h-28 space-y-1 overflow-y-auto rounded-lg border p-2">
        {instances.map((inst) => (
          <div key={`${inst.templateId}-${inst.nodeCode}`} className="flex items-center gap-1.5 text-xs">
            <TransportBadge type={inst.mode} />
            <span className="text-muted-foreground">{inst.variantKey === 'standard' ? '' : inst.variantKey}</span>
            <span className="text-foreground font-mono">{inst.nodeCode}</span>
            {inst.status !== 'ACTIVE' && <span className="text-muted-foreground">({inst.status === 'DRAFT' ? 'ร่าง' : 'เลิกใช้'})</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// Shared preview -> confirm -> propagate footer, one per section. Kept local (not exported) since
// every section here needs its own independent confirming/error/success state — sharing one across
// sections would let confirming one field silently arm another's confirm button.
function PropagateAction({
  instanceCount,
  canSubmit,
  isPending,
  isError,
  errorMessage,
  isSuccess,
  wroteCount,
  onConfirm,
}: {
  instanceCount: number
  canSubmit: boolean
  isPending: boolean
  isError: boolean
  errorMessage?: string
  isSuccess: boolean
  wroteCount?: number
  onConfirm: () => void
}) {
  const [confirming, setConfirming] = React.useState(false)
  // UDT-61, Part 2 — a single-instance item isn't being "published" to anywhere else; it's a plain
  // save to its one template. Same action, different, non-misleading wording.
  const single = instanceCount <= 1
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {!confirming ? (
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => setConfirming(true)}
            className="border-border rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          >
            {single ? 'บันทึก' : `เผยแพร่ไปยัง ${instanceCount} จุด`}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                onConfirm()
                setConfirming(false)
              }}
              disabled={isPending}
              className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {isPending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              {single ? 'ยืนยันบันทึก' : `ยืนยันเผยแพร่ไปยัง ${instanceCount} จุด`}
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="text-muted-foreground text-xs hover:underline">
              ยกเลิก
            </button>
          </>
        )}
        {isSuccess && (
          <span className="flex items-center gap-1 text-xs text-[#52aa4e]">
            <Check size={12} /> {single ? 'บันทึกแล้ว' : `เผยแพร่แล้ว ${wroteCount ?? instanceCount} จุด`}
          </span>
        )}
      </div>
      {isError && <p className="text-2xs text-red-500">{errorMessage}</p>}
    </div>
  )
}

// ---- Measurement (+ nested era overrides) ------------------------------------------------------

function GroupedMeasurementCard({
  version,
  item,
  measurementKey,
  initial,
  facilityCode,
}: {
  version: number
  item: GroupNodeRow
  measurementKey: string
  initial: InstanceMeasurement
  facilityCode?: number
}) {
  const propagate = usePropagateItemEdit(version)
  const [operator, setOperator] = React.useState<ThresholdOperator>(initial.operator)
  const [value, setValue] = React.useState<number | ''>(initial.value ?? '')
  const [value2, setValue2] = React.useState<number | ''>(initial.value2 ?? '')
  const [tiers, setTiers] = React.useState<TemplateTier[]>(initial.tiers ?? [])
  const [unit, setUnit] = React.useState(initial.unit)
  const [sourceText, setSourceText] = React.useState(initial.sourceText ?? '')

  function save() {
    const draft: MeasurementDraft = { value, value2, tiers, unit, sourceText }
    const body: GroupedEditBody = {
      field: 'measurement',
      measurementKey,
      measurement: buildMeasurementPatch(operator, draft),
    }
    propagate.mutate({ itemId: item.id, body })
  }

  return (
    <div className="border-border bg-card rounded-xl border p-3">
      <p className="text-foreground mb-2 font-mono text-xs font-semibold">{measurementKey}</p>
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <select className={`${SELECT_CLS} py-1.5 text-xs`} value={operator} onChange={(e) => setOperator(e.target.value as ThresholdOperator)}>
            {OPERATORS.map((op) => (
              <option key={op} value={op}>
                {OPERATOR_LABEL[op]}
              </option>
            ))}
          </select>
          <input className={`${INPUT_CLS} py-1.5 text-xs`} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="หน่วย (mm)" />
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
        <input
          className={`${INPUT_CLS} py-1.5 text-xs`}
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="ข้อความอ้างอิงจากเอกสารต้นฉบับ (sourceText)"
        />
        <PropagateAction
          instanceCount={item.instanceCount}
          canSubmit={!!measurementKey}
          isPending={propagate.isPending}
          isError={propagate.isError}
          errorMessage={propagate.isError ? (propagate.error as Error).message : undefined}
          isSuccess={propagate.isSuccess}
          wroteCount={propagate.data?.wroteCount}
          onConfirm={save}
        />
        <GroupedEraSection version={version} item={item} measurementKey={measurementKey} operator={operator} byLaw={initial.byLaw} facilityCode={facilityCode} />
      </div>
    </div>
  )
}

// Mirrors MeasurementEditor.tsx's EraOverridesSection (the individual per-node editor) — one row
// per EXISTING lawCode, pre-filled from `byLaw[lawCode]` via draftFor, editable and deletable in
// place, plus a separate "add a law not yet present" picker. The previous version here showed a
// read-only summary list and a single always-blank input regardless of which law was picked from
// the dropdown, so opening an already-overridden item never showed its stored value in the
// editable field — it just prompted for a brand new number. This makes the grouped editor match
// the individual editor's already-correct UX instead of a second, worse implementation of the
// same feature.
function GroupedEraSection({
  version,
  item,
  measurementKey,
  operator,
  byLaw,
  facilityCode,
}: {
  version: number
  item: GroupNodeRow
  measurementKey: string
  operator: ThresholdOperator
  byLaw: InstanceMeasurement['byLaw']
  facilityCode?: number
}) {
  const propagate = usePropagateItemEdit(version)
  const [drafts, setDrafts] = React.useState<Record<string, EraEntryDraft>>({})
  const [addingLaw, setAddingLaw] = React.useState('')

  const existingCodes = Object.keys(byLaw ?? {})
  const availableToAdd = LAW_REFERENCE_SEED.filter((l) => !existingCodes.includes(l.code))

  function draftFor(lawCode: string) {
    return drafts[lawCode] ?? byLaw?.[lawCode] ?? {}
  }

  function save(lawCode: string, entry: EraEntryDraft | null) {
    const body: GroupedEditBody = {
      field: 'era',
      measurementKey,
      era: { lawCode, entry: entry === null ? null : buildEraEntryPatch(operator, entry) },
    }
    propagate.mutate({ itemId: item.id, body })
  }

  return (
    <div className="border-border mt-1 space-y-1.5 border-t pt-2">
      <p className="text-muted-foreground text-2xs font-semibold">ข้อยกเว้นตามยุคกฎหมาย (byLaw)</p>
      {isNeverEraGated(facilityCode) && (
        <div className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-2xs text-emerald-800">
          <ShieldCheck size={12} className="mt-0.5 shrink-0" />
          <span>รายการนี้ไม่ผูกกับปีที่ก่อสร้าง — จะไม่ถูกซ่อนตามปีแม้ระบุกฎหมายไว้ก็ตาม</span>
        </div>
      )}
      {existingCodes.length === 0 && <p className="text-muted-foreground text-2xs">ยังไม่มีข้อยกเว้นตามยุคกฎหมายสำหรับเกณฑ์นี้</p>}
      {existingCodes.map((lawCode) => {
        const law = LAW_REFERENCE_SEED.find((l) => l.code === lawCode)
        return (
          <div key={lawCode} className="bg-secondary/40 rounded-lg p-2">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-foreground text-2xs font-medium">{law?.nameTh ?? lawCode}</p>
              <button
                type="button"
                disabled={propagate.isPending}
                onClick={() => save(lawCode, null)}
                className="flex items-center gap-1 text-3xs text-red-500 hover:text-red-600 disabled:opacity-50"
              >
                <Trash2 size={11} />
                ลบ
              </button>
            </div>
            <EraEntryFields operator={operator} entry={draftFor(lawCode)} onChange={(entry) => setDrafts((d) => ({ ...d, [lawCode]: entry }))} />
            <div className="mt-1.5">
              <PropagateAction
                instanceCount={item.instanceCount}
                canSubmit={true}
                isPending={propagate.isPending}
                isError={propagate.isError}
                errorMessage={propagate.isError ? (propagate.error as Error).message : undefined}
                isSuccess={propagate.isSuccess}
                wroteCount={propagate.data?.wroteCount}
                onConfirm={() => save(lawCode, draftFor(lawCode))}
              />
            </div>
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
              disabled={propagate.isPending}
              onClick={() => {
                const seed: EraEntryDraft = operator === 'tiered' ? { tiers: [] } : { value: 0 }
                setDrafts((d) => ({ ...d, [addingLaw]: seed }))
                save(addingLaw, seed)
                setAddingLaw('')
              }}
              className="border-border shrink-0 rounded border px-2 py-1 text-2xs disabled:opacity-50"
            >
              เพิ่ม
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---- Guidance / LawRefs / Hidden / Label --------------------------------------------------------

function GroupedGuidanceSection({ version, item }: { version: number; item: GroupNodeRow }) {
  const propagate = usePropagateItemEdit(version)
  const [text, setText] = React.useState('')

  return (
    <div className="border-border bg-card space-y-2 rounded-xl border p-3">
      <p className="text-foreground text-sm font-semibold">คำแนะนำในการตรวจ (คู่มือการตรวจประเมิน)</p>
      <textarea
        className={`${INPUT_CLS} min-h-[64px] resize-y text-xs`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="ข้อความคำแนะนำที่ผู้ตรวจจะเห็นในหน้าตรวจ — เขียนใหม่ที่นี่แล้วเผยแพร่ไปยังทุกจุด"
      />
      <PropagateAction
        instanceCount={item.instanceCount}
        canSubmit={!!text}
        isPending={propagate.isPending}
        isError={propagate.isError}
        errorMessage={propagate.isError ? (propagate.error as Error).message : undefined}
        isSuccess={propagate.isSuccess}
        wroteCount={propagate.data?.wroteCount}
        onConfirm={() => propagate.mutate({ itemId: item.id, body: { field: 'guidance', guidance: { text } } })}
      />
    </div>
  )
}

function GroupedLawRefsSection({ version, item, representative }: { version: number; item: GroupNodeRow; representative: ItemInstanceRow }) {
  const propagate = usePropagateItemEdit(version)
  const [lawRefs, setLawRefs] = React.useState<string[]>(representative.lawRefs)
  const [beyondLaw, setBeyondLaw] = React.useState(representative.beyondLaw)

  return (
    <div className="border-border bg-card space-y-2 rounded-xl border p-3">
      <p className="text-foreground text-sm font-semibold">ข้อยกเว้นทางกฎหมาย (lawRefs)</p>
      {isNeverEraGated(representative.facilityCode) && (
        <div className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">
          <ShieldCheck size={13} className="mt-0.5 shrink-0" />
          <span>รายการนี้ไม่ผูกกับปีที่ก่อสร้าง — จะไม่ถูกซ่อนตามปีแม้ระบุกฎหมายไว้ก็ตาม</span>
        </div>
      )}
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {LAW_REFERENCE_SEED.map((law) => (
          <label key={law.code} className="text-foreground flex items-start gap-1.5 text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={lawRefs.includes(law.code)}
              onChange={() => setLawRefs((cur) => (cur.includes(law.code) ? cur.filter((c) => c !== law.code) : [...cur, law.code]))}
            />
            <span>{law.nameTh}</span>
          </label>
        ))}
      </div>
      <label className="text-foreground flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={beyondLaw} onChange={(e) => setBeyondLaw(e.target.checked)} />
        โครงการเพิ่มเติมนอกเหนือกฎหมาย (beyondLaw)
      </label>
      <PropagateAction
        instanceCount={item.instanceCount}
        canSubmit
        isPending={propagate.isPending}
        isError={propagate.isError}
        errorMessage={propagate.isError ? (propagate.error as Error).message : undefined}
        isSuccess={propagate.isSuccess}
        wroteCount={propagate.data?.wroteCount}
        onConfirm={() => propagate.mutate({ itemId: item.id, body: { field: 'lawRefs', lawRefs: { lawRefs, beyondLaw } } })}
      />
    </div>
  )
}

function GroupedHiddenSection({ version, item, representative }: { version: number; item: GroupNodeRow; representative: ItemInstanceRow }) {
  const propagate = usePropagateItemEdit(version)
  const [hidden, setHidden] = React.useState(representative.hidden)

  return (
    <div className="border-border bg-card space-y-2 rounded-xl border p-3">
      <p className="text-foreground text-sm font-semibold">ซ่อน/แสดงรายการ</p>
      <label className="text-foreground flex items-center gap-2 text-xs">
        <input type="checkbox" className="h-4 w-4" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
        ซ่อนรายการนี้จากฟอร์มผู้ตรวจทุกแบบประเมินที่ใช้ร่วมกัน
      </label>
      <PropagateAction
        instanceCount={item.instanceCount}
        canSubmit
        isPending={propagate.isPending}
        isError={propagate.isError}
        errorMessage={propagate.isError ? (propagate.error as Error).message : undefined}
        isSuccess={propagate.isSuccess}
        wroteCount={propagate.data?.wroteCount}
        onConfirm={() => propagate.mutate({ itemId: item.id, body: { field: 'hidden', hidden: { hidden } } })}
      />
    </div>
  )
}

function GroupedLabelSection({ version, item, initialLabel }: { version: number; item: GroupNodeRow; initialLabel: string }) {
  const propagate = usePropagateItemEdit(version)
  const [labelTh, setLabelTh] = React.useState(initialLabel)

  return (
    <div className="border-border bg-card space-y-2 rounded-xl border p-3">
      <p className="text-foreground text-sm font-semibold">ข้อความคำถาม</p>
      <input className={`${INPUT_CLS} text-xs`} value={labelTh} onChange={(e) => setLabelTh(e.target.value)} />
      <PropagateAction
        instanceCount={item.instanceCount}
        canSubmit={!!labelTh.trim()}
        isPending={propagate.isPending}
        isError={propagate.isError}
        errorMessage={propagate.isError ? (propagate.error as Error).message : undefined}
        isSuccess={propagate.isSuccess}
        wroteCount={propagate.data?.wroteCount}
        onConfirm={() => propagate.mutate({ itemId: item.id, body: { field: 'label', label: { labelTh } } })}
      />
    </div>
  )
}

// ---- Image (unchanged from before — already an always-visible, no-select-needed section) --------

function GroupedImageEditor({
  version,
  item,
  representative,
}: {
  version: number
  item: GroupNodeRow
  representative: ItemInstanceRow
}) {
  const propagate = usePropagateItemEdit(version)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const { data: urls } = useTemplateImageUrls(representative.imageKeys)

  async function handleFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return
    const toUpload = files.slice(0, MAX_TEMPLATE_IMAGES_PER_NODE - representative.imageKeys.length)
    setUploading(true)
    setError(null)
    try {
      // Sequential, not Promise.all — each upload is followed by a propagate write that's a
      // read-modify-write across every instance sharing this item, so parallel calls would race.
      for (const file of toUpload) {
        const uploaded = await uploadGroupedImage(file)
        await propagate.mutateAsync({ itemId: item.id, body: { field: 'image', imageKey: uploaded.key, imageOp: 'add' } })
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  function handleRemove(key: string) {
    setError(null)
    propagate.mutate(
      { itemId: item.id, body: { field: 'image', imageKey: key, imageOp: 'remove' } },
      { onError: (err) => setError((err as Error).message) },
    )
  }

  return (
    <div className="border-border bg-card space-y-2.5 rounded-xl border p-3">
      <p className="text-foreground text-sm font-semibold">รูปภาพประกอบ</p>
      <p className="text-muted-foreground text-xs">อัปโหลดครั้งเดียว ระบบจะคัดลอกรูปเดียวกันไปยังทุกจุดที่ใช้รายการนี้ร่วมกันโดยอัตโนมัติ (ไม่ต้องอัปโหลดซ้ำ)</p>
      <div className="flex flex-wrap gap-3">
        {representative.imageKeys.map((key) => (
          <div key={key} className="relative">
            {urls?.[key] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={urls[key]} alt="" className="h-24 w-24 rounded-lg border object-cover" />
            ) : (
              <div className="bg-secondary h-24 w-24 animate-pulse rounded-lg" />
            )}
            <button
              type="button"
              onClick={() => handleRemove(key)}
              disabled={propagate.isPending}
              title="ลบออกจากทุกจุด"
              className="absolute -top-2 -right-2 rounded-full bg-red-600 p-1 text-white shadow disabled:opacity-50"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        {representative.imageKeys.length < MAX_TEMPLATE_IMAGES_PER_NODE && (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || propagate.isPending}
            className="border-border text-muted-foreground hover:text-foreground flex h-24 w-24 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-sm disabled:opacity-50"
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            เพิ่มรูป
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={(e) => void handleFiles(e)}
        />
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {propagate.isSuccess && !error && (
        <p className="flex items-center gap-1 text-sm text-[#52aa4e]">
          <Check size={14} /> อัปเดตแล้ว {propagate.data.wroteCount} จุด
        </p>
      )}
    </div>
  )
}
