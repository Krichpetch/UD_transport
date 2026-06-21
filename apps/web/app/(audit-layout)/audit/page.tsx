'use client'

import * as React from 'react'
import { getChecklistTemplate } from '@/lib/mock-data'
import { useStations, useStation } from '@/hooks/use-stations'
import { useSaveDraft, useSubmitChecklist } from '@/hooks/use-checklists'
import type { ChecklistGroup, ChecklistValue } from '@repo/types'
import { Camera, Loader2, MapPin, Save, Send, CheckSquare, Square } from 'lucide-react'
import { useUploadPhoto } from '@/hooks/use-uploads'

export default function AuditPage() {
  const { data: allStations = [] } = useStations()
  const [selectedId, setSelectedId] = React.useState('')
  const { data: station } = useStation(selectedId)
  const saveDraftMutation = useSaveDraft(selectedId)
  const submitMutation = useSubmitChecklist(selectedId)
  const { mutateAsync: doUpload, isPending: photoUploading } = useUploadPhoto()
  const [submitted, setSubmitted] = React.useState(false)

  const [groups, setGroups] = React.useState<ChecklistGroup[]>([])
  const [currentPage, setCurrentPage] = React.useState(0)

  React.useEffect(() => {
    if (!station) return
    const template = getChecklistTemplate(station.mode)
    setGroups(template)
    setCurrentPage(0)
    setSubmitted(false)
  }, [station?.id])

  const allItems = groups.flatMap((g) => g.items)
  const answered = allItems.filter((i) => i.value !== null).length
  const total = allItems.length
  const progress = total > 0 ? Math.round((answered / total) * 100) : 0

  const eligibleCount = allItems.filter((i) => i.value !== 'N/A').length
  const standardCount = allItems.filter((i) => i.value === 'มี' && i.meetsStandard).length
  const score = eligibleCount > 0 ? Math.round((standardCount / eligibleCount) * 100) : 0

  function setItemValue(groupId: string, itemId: string, value: ChecklistValue) {
    setGroups((prev) =>
      prev.map((g) =>
        g.groupId !== groupId
          ? g
          : {
              ...g,
              items: g.items.map((item) =>
                item.id !== itemId
                  ? item
                  : {
                      ...item,
                      value: item.value === value ? null : value,
                      meetsStandard: value === 'มี' ? item.meetsStandard : false,
                    }
              ),
            }
      )
    )
  }

  function setMeetsStandard(groupId: string, itemId: string, ms: boolean) {
    setGroups((prev) =>
      prev.map((g) =>
        g.groupId !== groupId
          ? g
          : {
              ...g,
              items: g.items.map((item) =>
                item.id === itemId ? { ...item, meetsStandard: ms } : item
              ),
            }
      )
    )
  }

  async function handlePhotoUpload(groupId: string, itemId: string, files: FileList | null) {
    if (!files || files.length === 0) return
    const uploaded = await Promise.all(Array.from(files).map((f) => doUpload(f)))
    setGroups((prev) =>
      prev.map((g) =>
        g.groupId !== groupId
          ? g
          : {
              ...g,
              items: g.items.map((item) =>
                item.id !== itemId
                  ? item
                  : { ...item, photos: [...item.photos, ...uploaded] }
              ),
            }
      )
    )
  }

  const VALUE_OPTIONS: { value: ChecklistValue; label: string; active: string; inactive: string }[] = [
    { value: 'มี',    label: 'มี',    active: 'border-blue-300 bg-blue-50 text-blue-700',   inactive: 'border-border text-muted-foreground' },
    { value: 'ไม่มี', label: 'ไม่มี', active: 'border-red-200 bg-red-50 text-red-600',      inactive: 'border-border text-muted-foreground' },
    { value: 'N/A',  label: 'N/A',  active: 'border-gray-300 bg-gray-100 text-gray-500', inactive: 'border-border text-muted-foreground' },
  ]

  const stationPicker = (
    <div className="rounded-xl bg-white/10 p-4 backdrop-blur">
      <label className="mb-1.5 block text-xs text-white/70">เลือกสถานีที่จะตรวจสอบ</label>
      <select
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
        className="w-full rounded-lg border border-white/20 bg-white/20 px-3 py-2.5 text-sm text-white focus:outline-none"
      >
        <option value="" className="text-gray-900">— เลือกสถานี —</option>
        {allStations.map((s) => (
          <option key={s.id} value={s.id} className="text-gray-900">
            {s.nameTh} ({s.province})
          </option>
        ))}
      </select>
    </div>
  )

  if (!selectedId || !station) {
    return (
      <div className="space-y-4">
        {stationPicker}
        <div className="rounded-xl bg-white/10 p-6 text-center text-sm text-white/60 backdrop-blur">
          {!selectedId ? 'กรุณาเลือกสถานีเพื่อเริ่มการตรวจสอบ' : 'กำลังโหลด…'}
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="space-y-4">
        {stationPicker}
        <div className="rounded-xl bg-white/10 p-6 text-center backdrop-blur">
          <p className="text-lg font-bold text-white">ส่งรายงานสำเร็จ ✓</p>
          <p className="mt-1 text-sm text-white/70">{station.nameTh}</p>
          <p className="mt-1 text-xs text-white/50">คะแนน UD: {score}%</p>
          <button
            onClick={() => { setSelectedId(''); setSubmitted(false) }}
            className="mt-4 rounded-lg bg-white/20 px-4 py-2 text-sm font-medium text-white"
          >
            ตรวจสถานีถัดไป
          </button>
        </div>
      </div>
    )
  }

  const isSummaryPage = currentPage === groups.length

  return (
    <div className="space-y-4">
      {stationPicker}

      {/* Header with overall progress — always visible */}
      <div className="rounded-xl bg-white/10 p-4 backdrop-blur">
        <div className="mb-1 flex items-start justify-between">
          <div>
            <h1 className="text-sm font-bold text-white">{station.nameTh}</h1>
            <div className="mt-0.5 flex items-center gap-1">
              <MapPin size={10} className="text-white/60" />
              <p className="text-xs text-white/60">{station.province}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-white">{progress}%</p>
            <p className="text-[10px] text-white/60">{answered}/{total} ข้อ</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-white transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Summary page */}
      {isSummaryPage ? (
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <p className="text-sm font-bold text-gray-900">สรุปผลการตรวจสอบ</p>
            <p className="mt-0.5 text-xs text-gray-500">ตรวจสอบความครบถ้วนก่อนส่งรายงาน</p>
          </div>
          <div className="divide-y">
            {groups.map((g) => {
              const ans = g.items.filter((i) => i.value !== null).length
              const done = ans === g.items.length
              return (
                <div key={g.groupId} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-gray-800">{g.groupName}</span>
                  <span className={`text-xs font-semibold ${done ? 'text-green-600' : 'text-amber-600'}`}>
                    {ans}/{g.items.length} {done ? '✓' : '⚠'}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="border-t px-4 py-4 space-y-3">
            <p className="text-sm text-gray-500">
              คะแนน UD (ประมาณ):{' '}
              <span className="font-bold text-gray-900">{score}%</span>
            </p>
            <button
              onClick={() =>
                submitMutation.mutate(
                  { items: groups, score },
                  { onSuccess: () => setSubmitted(true) }
                )
              }
              disabled={submitMutation.isPending || progress < 100}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#1a3557] py-3 text-sm font-bold text-white disabled:opacity-50"
            >
              <Send size={15} />
              {submitMutation.isPending ? 'กำลังส่ง…' : 'ส่งรายงาน'}
            </button>
            {progress < 100 && (
              <p className="text-center text-xs text-amber-600">
                ยังมีรายการที่ยังไม่ได้ตอบ ({total - answered} ข้อ)
              </p>
            )}
          </div>
        </div>
      ) : (
        /* Group checklist page */
        (() => {
          const group = groups[currentPage]!  // ponytail: safe — currentPage < groups.length guaranteed above
          return (
            <div className="overflow-hidden rounded-xl bg-white shadow-sm">
              {/* Step indicator */}
              <div className="flex items-center justify-between border-b px-4 py-3">
                <span className="text-sm font-semibold text-gray-700">{group.groupName}</span>
                <span className="text-xs text-gray-400">หน้า {currentPage + 1} / {groups.length}</span>
              </div>
              {/* Items */}
              <div className="divide-border divide-y">
                {group.items.map((item) => (
                  <div key={item.id} className="px-4 py-3.5">
                    <div className="mb-2.5 flex items-start gap-2">
                      <span className="text-muted-foreground bg-secondary mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">
                        {item.id}
                      </span>
                      <div className="flex-1">
                        <p className="text-foreground text-sm leading-snug">{item.labelTh}</p>
                        {item.cabinetPriority && (
                          <span className="mt-0.5 inline-flex items-center rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                            มติ ครม.
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {VALUE_OPTIONS.map((opt) => (
                        <button
                          key={opt.value!}
                          onClick={() => setItemValue(group.groupId, item.id, opt.value)}
                          className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${
                            item.value === opt.value ? opt.active : opt.inactive
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                    {item.value === 'มี' && (
                      <button
                        onClick={() => setMeetsStandard(group.groupId, item.id, !item.meetsStandard)}
                        className={`mt-2 flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                          item.meetsStandard
                            ? 'border-green-300 bg-green-50 text-green-700'
                            : 'border-border text-muted-foreground'
                        }`}
                      >
                        {item.meetsStandard ? (
                          <CheckSquare size={13} className="shrink-0" />
                        ) : (
                          <Square size={13} className="shrink-0" />
                        )}
                        ได้มาตรฐาน
                      </button>
                    )}
                    <div className="mt-2.5">
                      {item.photos.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {item.photos.map((p) => (
                            <img
                              key={p.id}
                              src={p.url}
                              alt={p.filename}
                              className="size-14 rounded-lg border border-border object-cover"
                            />
                          ))}
                        </div>
                      )}
                      <label className={`border-border text-muted-foreground flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${photoUploading ? 'cursor-not-allowed opacity-50' : 'hover:bg-secondary cursor-pointer'}`}>
                        {photoUploading ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
                        {photoUploading ? 'กำลังอัปโหลด…' : 'แนบรูปภาพ'}
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          disabled={photoUploading}
                          onChange={(e) => handlePhotoUpload(group.groupId, item.id, e.target.files)}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })()
      )}

      {/* Navigation */}
      <div className="flex gap-3 pb-6">
        {currentPage > 0 && (
          <button
            onClick={() => setCurrentPage((p) => p - 1)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-white/30 bg-white/10 px-4 py-3 text-sm font-medium text-white backdrop-blur"
          >
            ← ก่อนหน้า
          </button>
        )}
        <button
          onClick={() => saveDraftMutation.mutate(groups)}
          disabled={saveDraftMutation.isPending}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 py-3 text-sm font-medium text-white backdrop-blur disabled:opacity-50"
        >
          <Save size={15} />
          {saveDraftMutation.isPending ? 'กำลังบันทึก…' : 'บันทึกร่าง'}
        </button>
        {!isSummaryPage && (
          <button
            onClick={() => setCurrentPage((p) => p + 1)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white py-3 text-sm font-bold text-[#1a3557]"
          >
            ถัดไป →
          </button>
        )}
      </div>
    </div>
  )
}
