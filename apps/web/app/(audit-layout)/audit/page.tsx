'use client'

import * as React from 'react'
import {
  mockStations,
  getChecklistTemplate,
  type ChecklistGroup,
  type ChecklistValue,
} from '@/lib/mock-data'
import { Camera, MapPin, Save, Send, ChevronDown, ChevronUp } from 'lucide-react'

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
              items: g.items.map((item) => (item.id === itemId ? { ...item, value } : item)),
            }
      )
    )
  }

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
                    <div className="mb-2 flex items-start gap-2">
                      <span className="text-muted-foreground bg-secondary mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">
                        {item.id}
                      </span>
                      <p className="text-foreground text-sm leading-snug">{item.labelTh}</p>
                    </div>

                    {/* Value buttons */}
                    <div className="flex gap-2">
                      {(['มี', 'ไม่มี', 'ได้มาตรฐาน'] as ChecklistValue[]).map((opt) => (
                        <button
                          key={opt!}
                          onClick={() => setItemValue(group.groupId, item.id, opt)}
                          className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${
                            item.value === opt
                              ? opt === 'มี'
                                ? 'border-blue-200 bg-blue-50 text-blue-700'
                                : opt === 'ไม่มี'
                                  ? 'border-red-200 bg-red-50 text-red-600'
                                  : 'border-green-200 bg-green-50 text-green-700'
                              : 'border-border text-muted-foreground'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Photo upload */}
      <div className="rounded-xl bg-white shadow-sm">
        <div className="px-4 py-3.5">
          <p className="text-foreground mb-3 text-sm font-semibold">📸 หลักฐานภาพถ่าย</p>
          <button className="border-border text-muted-foreground hover:bg-secondary flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed py-6 transition-colors">
            <Camera size={24} className="text-muted-foreground" />
            <p className="text-sm font-medium">แตะเพื่อถ่ายภาพ / เลือกไฟล์</p>
            <p className="text-xs">รองรับ JPG, PNG ขนาดสูงสุด 10MB</p>
          </button>
        </div>
      </div>

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
