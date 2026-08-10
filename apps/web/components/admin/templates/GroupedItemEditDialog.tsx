'use client'

import * as React from 'react'
import { Check, Loader2, Send, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { DIALOG_HEADER_CLS, DIALOG_TITLE_CLS, INPUT_CLS, SELECT_CLS } from '@/lib/ui-classes'
import { TransportBadge } from '@/components/shared/badges'
import { usePropagateItemEdit } from '@/hooks/use-facility-groups'
import { useTemplateImageUrls } from '@/hooks/use-template-image-urls'
import { uploadTemplateImage } from '@/lib/api/facility-groups'
import type { CanonicalItemRow, GroupedEditBody, InstanceMeasurement, ItemInstanceRow } from '@/lib/api/facility-groups'
import type { ThresholdOperator } from '@repo/types'
import { LAW_REFERENCE_SEED, isNeverEraGated } from '@repo/types'

type Field = GroupedEditBody['field']

const FIELD_LABEL: Record<Field, string> = {
  measurement: 'เกณฑ์ตัวเลข',
  guidance: 'คำอธิบาย (คู่มือ)',
  lawRefs: 'ข้อยกเว้นทางกฎหมาย',
  hidden: 'ซ่อน/แสดงรายการ',
  label: 'ข้อความคำถาม',
  era: 'ค่าตามยุคกฎหมาย (byLaw)',
  image: 'รูปภาพประกอบ',
}
const ALL_FIELDS: Field[] = ['measurement', 'guidance', 'lawRefs', 'era', 'hidden', 'label', 'image']

// Session S4b — edit a canonical item ONCE, see exactly which (template, node) rows will be
// written, confirm, then propagate. Font sizes bumped to match (and exceed) the by-item S3a
// editor's own components (LawRefsEditor/MeasurementEditor/GuidanceEditor etc all sit at text-xs
// or smaller) — body text here floors at text-sm, headers at text-base, the item's own question
// text is the dialog title at DIALOG_TITLE_CLS (text-lg), same prominence TemplateNodeEditorDialog
// gives it, rather than a small muted subtitle.
export function GroupedItemEditDialog({
  version,
  item,
  onClose,
}: {
  version: number
  item: CanonicalItemRow | null
  onClose: () => void
}) {
  const propagate = usePropagateItemEdit(version)
  const [field, setField] = React.useState<Field>('measurement')
  const [confirming, setConfirming] = React.useState(false)

  const representative: ItemInstanceRow | undefined = item?.instances[0]

  // measurement form state
  const [measurementKey, setMeasurementKey] = React.useState<string>('')
  const [operator, setOperator] = React.useState<ThresholdOperator>('gte')
  const [value, setValue] = React.useState<number | ''>('')
  const [value2, setValue2] = React.useState<number | ''>('')
  const [unit, setUnit] = React.useState('mm')
  const [sourceText, setSourceText] = React.useState('')

  // guidance / label / hidden
  const [guidanceText, setGuidanceText] = React.useState('')
  const [hidden, setHidden] = React.useState(false)
  const [labelTh, setLabelTh] = React.useState('')

  // lawRefs
  const [lawRefs, setLawRefs] = React.useState<string[]>([])
  const [beyondLaw, setBeyondLaw] = React.useState(false)

  // era
  const [eraLawCode, setEraLawCode] = React.useState('')
  const [eraValue, setEraValue] = React.useState<number | ''>('')
  const [eraValue2, setEraValue2] = React.useState<number | ''>('')

  function currentMeasurement(): InstanceMeasurement | undefined {
    return representative?.measurements.find((m) => m.key === measurementKey)
  }

  React.useEffect(() => {
    if (!item || !representative) return
    setConfirming(false)
    propagate.reset()
    setLabelTh(item.labelTh)
    setHidden(representative.hidden)
    setLawRefs(representative.lawRefs)
    setBeyondLaw(representative.beyondLaw)
    const firstKey = representative.measurements[0]?.key ?? ''
    setMeasurementKey(firstKey)
    const m = representative.measurements.find((mm) => mm.key === firstKey)
    if (m) {
      setOperator(m.operator)
      setValue(m.value ?? '')
      setValue2(m.value2 ?? '')
      setUnit(m.unit)
      setSourceText(m.sourceText ?? '')
    }
    setGuidanceText('')
    setEraLawCode('')
    setEraValue('')
    setEraValue2('')
    setField(representative.measurements.length > 0 ? 'measurement' : 'guidance')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id])

  React.useEffect(() => {
    const m = currentMeasurement()
    if (m) {
      setOperator(m.operator)
      setValue(m.value ?? '')
      setValue2(m.value2 ?? '')
      setUnit(m.unit)
      setSourceText(m.sourceText ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measurementKey])

  if (!item || !representative) return null

  function buildBody(): GroupedEditBody {
    switch (field) {
      case 'measurement':
        return { field, measurementKey, measurement: { operator, value: value === '' ? null : value, value2: operator === 'range' ? (value2 === '' ? null : value2) : undefined, unit, autoGrade: true, sourceText: sourceText || undefined } }
      case 'guidance':
        return { field, guidance: { text: guidanceText } }
      case 'hidden':
        return { field, hidden: { hidden } }
      case 'label':
        return { field, label: { labelTh } }
      case 'lawRefs':
        return { field, lawRefs: { lawRefs, beyondLaw } }
      case 'era':
        return {
          field,
          measurementKey,
          era: { lawCode: eraLawCode, entry: operator === 'tiered' ? undefined : { value: eraValue === '' ? null : eraValue, value2: operator === 'range' ? (eraValue2 === '' ? null : eraValue2) : null } },
        }
      default:
        return { field: 'guidance', guidance: { text: guidanceText } }
    }
  }

  function handlePropagate() {
    propagate.mutate({ itemId: item!.id, body: buildBody() }, { onSuccess: () => setConfirming(false) })
  }

  const canSubmit =
    field !== 'image' &&
    (field !== 'measurement' || !!measurementKey) &&
    (field !== 'era' || (!!measurementKey && !!eraLawCode)) &&
    (field !== 'guidance' || !!guidanceText)

  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-full flex-col overflow-hidden p-0 sm:max-w-3xl">
        <div className={DIALOG_HEADER_CLS}>
          <DialogTitle className={DIALOG_TITLE_CLS}>{item.labelTh}</DialogTitle>
          <p className="text-muted-foreground mt-1 text-sm">แก้ไขรายการที่ใช้ร่วมกันครั้งเดียว แล้วเผยแพร่ไปยังทุกจุด</p>
        </div>

        <div className="themed-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm">
          <div>
            <p className="text-foreground mb-1.5 text-sm font-semibold">จะเขียนไปยัง {item.instanceCount} จุด (ทุกแบบประเมินที่มีรายการนี้)</p>
            <div className="border-border max-h-32 space-y-1 overflow-y-auto rounded-lg border p-2">
              {item.instances.map((inst) => (
                <div key={`${inst.templateId}-${inst.nodeCode}`} className="flex items-center gap-1.5 text-sm">
                  <TransportBadge type={inst.mode} />
                  <span className="text-muted-foreground">{inst.variantKey === 'standard' ? '' : inst.variantKey}</span>
                  <span className="text-foreground font-mono text-xs">{inst.nodeCode}</span>
                  {inst.status !== 'ACTIVE' && <span className="text-muted-foreground text-xs">({inst.status === 'DRAFT' ? 'ร่าง' : 'เลิกใช้'})</span>}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-muted-foreground mb-1 block text-sm">ฟิลด์ที่จะแก้ไข</label>
            <select className={`${SELECT_CLS} text-sm`} value={field} onChange={(e) => setField(e.target.value as Field)}>
              {ALL_FIELDS.map((f) => (
                <option key={f} value={f} disabled={f === 'measurement' && representative.measurements.length === 0}>
                  {FIELD_LABEL[f]}
                </option>
              ))}
            </select>
          </div>

          {field === 'measurement' && (
            <div className="space-y-2.5">
              {representative.measurements.length > 1 && (
                <select className={`${SELECT_CLS} text-sm`} value={measurementKey} onChange={(e) => setMeasurementKey(e.target.value)}>
                  {representative.measurements.map((m) => (
                    <option key={m.key} value={m.key}>
                      {m.key} — {m.operator} {m.value ?? ''}
                    </option>
                  ))}
                </select>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                <select className={`${SELECT_CLS} text-sm`} value={operator} onChange={(e) => setOperator(e.target.value as ThresholdOperator)}>
                  <option value="gte">ไม่น้อยกว่า (gte)</option>
                  <option value="lte">ไม่เกิน (lte)</option>
                  <option value="range">ช่วง (range)</option>
                </select>
                <input className={`${INPUT_CLS} text-sm`} placeholder="หน่วย (mm)" value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <input type="number" className={`${INPUT_CLS} text-sm`} placeholder="ค่า" value={value} onChange={(e) => setValue(e.target.value === '' ? '' : Number(e.target.value))} />
                {operator === 'range' && (
                  <input type="number" className={`${INPUT_CLS} text-sm`} placeholder="ค่าสูงสุด (value2)" value={value2} onChange={(e) => setValue2(e.target.value === '' ? '' : Number(e.target.value))} />
                )}
              </div>
              <input className={`${INPUT_CLS} text-sm`} placeholder="ข้อความอ้างอิงจากเอกสารต้นฉบับ (sourceText)" value={sourceText} onChange={(e) => setSourceText(e.target.value)} />
            </div>
          )}

          {field === 'guidance' && (
            <textarea
              className={`${INPUT_CLS} min-h-28 text-sm`}
              placeholder="คำอธิบาย/คู่มือการตรวจประเมิน"
              value={guidanceText}
              onChange={(e) => setGuidanceText(e.target.value)}
            />
          )}

          {field === 'hidden' && (
            <label className="text-foreground flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
              ซ่อนรายการนี้จากฟอร์มผู้ตรวจทุกแบบประเมินข้างต้น
            </label>
          )}

          {field === 'label' && <input className={`${INPUT_CLS} text-sm`} value={labelTh} onChange={(e) => setLabelTh(e.target.value)} />}

          {field === 'lawRefs' && (
            <div className="space-y-2.5">
              <p className="text-muted-foreground text-sm">กฎหมายที่กำหนดให้ต้องมีรายการนี้ — มีผลกับการตรวจครั้งต่อไปเท่านั้น</p>
              {isNeverEraGated(representative.facilityCode) && (
                <div className="flex items-start gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-sm text-emerald-800">
                  <ShieldCheck size={14} className="mt-0.5 shrink-0" />
                  <span>รายการนี้ไม่ผูกกับปีที่ก่อสร้าง — จะไม่ถูกซ่อนตามปีแม้ระบุกฎหมายไว้ก็ตาม</span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {LAW_REFERENCE_SEED.map((law) => (
                  <label key={law.code} className="text-foreground flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      checked={lawRefs.includes(law.code)}
                      onChange={() => setLawRefs((cur) => (cur.includes(law.code) ? cur.filter((c) => c !== law.code) : [...cur, law.code]))}
                    />
                    <span>{law.nameTh}</span>
                  </label>
                ))}
              </div>
              <label className="text-foreground flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={beyondLaw} onChange={(e) => setBeyondLaw(e.target.checked)} />
                โครงการเพิ่มเติมนอกเหนือกฎหมาย (beyondLaw)
              </label>
            </div>
          )}

          {field === 'era' && (
            <div className="space-y-2.5">
              {representative.measurements.length === 0 ? (
                <p className="text-muted-foreground text-sm">รายการนี้ไม่มีเกณฑ์ตัวเลข จึงไม่มีค่าตามยุคกฎหมายให้แก้ไข</p>
              ) : (
                <>
                  {representative.measurements.length > 1 && (
                    <select className={`${SELECT_CLS} text-sm`} value={measurementKey} onChange={(e) => setMeasurementKey(e.target.value)}>
                      {representative.measurements.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.key}
                        </option>
                      ))}
                    </select>
                  )}
                  {currentMeasurement()?.byLaw && Object.keys(currentMeasurement()!.byLaw!).length > 0 && (
                    <div className="space-y-1">
                      <p className="text-muted-foreground text-sm">ค่าปัจจุบันตามกฎหมาย (จากแบบประเมิน {representative.mode}):</p>
                      {Object.entries(currentMeasurement()!.byLaw!).map(([code, entry]) => (
                        <p key={code} className="text-foreground text-sm">
                          {LAW_REFERENCE_SEED.find((l) => l.code === code)?.nameTh ?? code}: {entry.value ?? '-'}
                          {entry.value2 != null ? `–${entry.value2}` : ''}
                        </p>
                      ))}
                    </div>
                  )}
                  <select className={`${SELECT_CLS} text-sm`} value={eraLawCode} onChange={(e) => setEraLawCode(e.target.value)}>
                    <option value="">เลือกกฎหมายที่จะกำหนดค่า…</option>
                    {LAW_REFERENCE_SEED.map((l) => (
                      <option key={l.code} value={l.code}>
                        {l.nameTh}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2.5">
                    <input type="number" className={`${INPUT_CLS} text-sm`} placeholder="ค่า" value={eraValue} onChange={(e) => setEraValue(e.target.value === '' ? '' : Number(e.target.value))} />
                    {operator === 'range' && (
                      <input type="number" className={`${INPUT_CLS} text-sm`} placeholder="ค่าสูงสุด" value={eraValue2} onChange={(e) => setEraValue2(e.target.value === '' ? '' : Number(e.target.value))} />
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">เว้นค่าไว้แล้วกดเผยแพร่เพื่อลบข้อยกเว้นตามกฎหมายนี้ออกจากทุกจุด</p>
                </>
              )}
            </div>
          )}

          {field === 'image' && (
            <GroupedImageEditor version={version} item={item} representative={representative} />
          )}

          {field !== 'image' && (
            <>
              {propagate.isError && <p className="text-sm text-red-500">{(propagate.error as Error).message}</p>}
              {propagate.isSuccess && (
                <p className="text-sm text-[#52aa4e]">
                  เขียนสำเร็จ {propagate.data.wroteCount} รายการ (correlation: {propagate.data.correlationId.slice(0, 8)}…)
                </p>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={onClose} className="border-border rounded-lg border px-4 py-2 text-sm font-medium">
                  ปิด
                </button>
                {!confirming ? (
                  <button
                    type="button"
                    disabled={!canSubmit}
                    onClick={() => setConfirming(true)}
                    className="bg-primary text-primary-foreground rounded-lg px-4 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-40"
                  >
                    ดูตัวอย่างก่อนเผยแพร่
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handlePropagate}
                    disabled={propagate.isPending}
                    className="flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {propagate.isPending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                    ยืนยันเผยแพร่ไปยัง {item.instanceCount} จุด
                  </button>
                )}
              </div>
              {confirming && !propagate.isPending && (
                <p className="text-right text-sm text-red-500">
                  จะเขียนทับข้อมูลใน {item.instanceCount} แบบประเมินพร้อมกัน — ตรวจสอบรายการด้านบนอีกครั้งก่อนยืนยัน
                </p>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// Session S4b — image is upload-once/remove-anywhere, not the "edit form -> preview -> confirm"
// flow the other fields use: uploading already commits to one instance, and addImageKey is
// idempotent, so propagating immediately afterward is a safe single action (same "no extra
// confirm dialog" precedent as the per-item TemplateNodeImages.tsx).
function GroupedImageEditor({
  version,
  item,
  representative,
}: {
  version: number
  item: CanonicalItemRow
  representative: ItemInstanceRow
}) {
  const propagate = usePropagateItemEdit(version)
  const [uploading, setUploading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const { data: urls } = useTemplateImageUrls(representative.imageKeys)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const uploaded = await uploadTemplateImage(representative.templateId, representative.nodeCode, file)
      await propagate.mutateAsync({ itemId: item.id, body: { field: 'image', imageKey: uploaded.key, imageOp: 'add' } })
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
    <div className="space-y-2.5">
      <p className="text-muted-foreground text-sm">
        อัปโหลดครั้งเดียว ระบบจะคัดลอกรูปเดียวกันไปยังทุกจุดที่ใช้รายการนี้ร่วมกันโดยอัตโนมัติ (ไม่ต้องอัปโหลดซ้ำ)
      </p>
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
        {representative.imageKeys.length < 3 && (
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
        <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void handleFile(e)} />
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
