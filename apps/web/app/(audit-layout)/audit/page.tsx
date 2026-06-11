'use client'

import * as React from 'react'
import {
  mockStations,
  getChecklistTemplate,
} from '@/lib/mock-data'
import type { ChecklistGroup, ChecklistValue, ChecklistPhoto } from '@repo/types'
import { Camera, MapPin, Save, Send, ChevronDown, ChevronUp, CheckSquare, Square } from 'lucide-react'

export default function AuditPage() {
  const station = mockStations[1]! // Mo Chit as example
  const [groups, setGroups] = React.useState<ChecklistGroup[]>(() =>
    getChecklistTemplate(station.mode)
  )
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({
    [getChecklistTemplate(station.mode)[0]?.groupId ?? '']: true,
  })

  const allItems = groups.flatMap((g) => g.items)
  const answered = allItems.filter((i) => i.value !== null).length
  const total = allItems.length
  const progress = Math.round((answered / total) * 100)

  function toggleGroup(groupId: string) {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }))
  }

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

  function handlePhotoUpload(
    groupId: string,
    itemId: string,
    files: FileList | null
  ) {
    if (!files || files.length === 0) return
    const newPhotos: ChecklistPhoto[] = Array.from(files).map((file) => ({
      id: `${itemId}-${file.name}-${file.size}`,
      url: URL.createObjectURL(file),
      filename: file.name,
      uploadedAt: new Date().toISOString(),
    }))
    setGroups((prev) =>
      prev.map((g) =>
        g.groupId !== groupId
          ? g
          : {
              ...g,
              items: g.items.map((item) =>
                item.id !== itemId
                  ? item
                  : { ...item, photos: [...item.photos, ...newPhotos] }
              ),
            }
      )
    )
  }

  const VALUE_OPTIONS: { value: ChecklistValue; label: string; active: string; inactive: string }[] = [
    {
      value: 'มี',
      label: 'มี',
      active: 'border-blue-300 bg-blue-50 text-blue-700',
      inactive: 'border-border text-muted-foreground',
    },
    {
      value: 'ไม่มี',
      label: 'ไม่มี',
      active: 'border-red-200 bg-red-50 text-red-600',
      inactive: 'border-border text-muted-foreground',
    },
    {
      value: 'N/A',
      label: 'N/A',
      active: 'border-gray-300 bg-gray-100 text-gray-500',
      inactive: 'border-border text-muted-foreground',
    },
  ]

  return (
    <div className="space-y-4">
      {/* Header */}
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
            <p className="text-[10px] text-white/60">
              {answered}/{total} ข้อ
            </p>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/20">
          <div
            className="h-full rounded-full bg-white transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Checklist groups */}
      {groups.map((group) => {
        const groupAnswered = group.items.filter((i) => i.value !== null).length
        const isOpen = openGroups[group.groupId] ?? false

        return (
          <div key={group.groupId} className="overflow-hidden rounded-xl bg-white shadow-sm">
            {/* Group header */}
            <button
              onClick={() => toggleGroup(group.groupId)}
              className="flex w-full items-center justify-between px-4 py-3.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-foreground text-sm font-semibold">{group.groupName}</span>
                <span className="bg-secondary text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px]">
                  {groupAnswered}/{group.items.length}
                </span>
              </div>
              {isOpen ? (
                <ChevronUp size={14} className="text-muted-foreground" />
              ) : (
                <ChevronDown size={14} className="text-muted-foreground" />
              )}
            </button>

            {/* Items */}
            {isOpen && (
              <div className="divide-border divide-y border-t">
                {group.items.map((item) => (
                  <div key={item.id} className="px-4 py-3.5">
                    {/* Label row */}
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

                    {/* Value buttons: มี / ไม่มี / N/A */}
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

                    {/* ได้มาตรฐาน toggle — only when value === 'มี' */}
                    {item.value === 'มี' && (
                      <button
                        onClick={() =>
                          setMeetsStandard(group.groupId, item.id, !item.meetsStandard)
                        }
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

                    {/* Per-item photo upload */}
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
                      <label className="border-border text-muted-foreground hover:bg-secondary flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors">
                        <Camera size={12} />
                        แนบรูปภาพ
                        <input
                          type="file"
                          accept="image/*"
                          multiple
                          className="hidden"
                          onChange={(e) =>
                            handlePhotoUpload(group.groupId, item.id, e.target.files)
                          }
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Actions */}
      <div className="flex gap-3 pb-6">
        <button className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/10 py-3 text-sm font-medium text-white backdrop-blur">
          <Save size={15} /> บันทึกร่าง
        </button>
        <button className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-bold text-[#1a3557]">
          <Send size={15} /> ส่งรายงาน
        </button>
      </div>
    </div>
  )
}
