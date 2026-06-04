'use client'

import * as React from 'react'
import { mockStations, mockChecklistItems, type ChecklistItem } from '@/lib/mock-data'
import { Camera, MapPin, Save, Send, ChevronDown, ChevronUp } from 'lucide-react'

type ChecklistValue = 'มี' | 'ไม่มี' | 'ได้มาตรฐาน' | null

const CATEGORY_ICONS: Record<string, string> = {
  'การเข้าถึง': '♿',
  'การสัญจร': '🚶',
  'สิ่งอำนวยความสะดวก': '🏢',
  'ความปลอดภัย': '🛡️',
}

export default function AuditPage() {
  const station = mockStations[1]! // Mo Chit as example
  const [items, setItems] = React.useState<ChecklistItem[]>(mockChecklistItems)
  const [openCategories, setOpenCategories] = React.useState<Record<string, boolean>>({
    'การเข้าถึง': true,
  })

  const answered = items.filter((i) => i.value !== null).length
  const total = items.length
  const progress = Math.round((answered / total) * 100)

  const categories = Array.from(new Set(items.map((i) => i.category)))

  function toggleCategory(cat: string) {
    setOpenCategories((prev) => ({ ...prev, [cat]: !prev[cat] }))
  }

  function setItemValue(id: string, value: ChecklistValue) {
    setItems((prev) => prev.map((item) => item.id === id ? { ...item, value } : item))
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-white/10 rounded-xl p-4 backdrop-blur">
        <div className="mb-1 flex items-start justify-between">
          <div>
            <h1 className="text-sm font-bold text-white">{station.nameTh}</h1>
            <div className="mt-0.5 flex items-center gap-1">
              <MapPin size={10} className="text-white/60" />
              <p className="text-white/60 text-xs">{station.province}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-white">{progress}%</p>
            <p className="text-white/60 text-[10px]">{answered}/{total} ข้อ</p>
          </div>
        </div>

        {/* Progress */}
        <div className="bg-white/20 mt-3 h-1.5 w-full overflow-hidden rounded-full">
          <div
            className="bg-white h-full rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Checklist categories */}
      {categories.map((category) => {
        const catItems = items.filter((i) => i.category === category)
        const catAnswered = catItems.filter((i) => i.value !== null).length
        const isOpen = openCategories[category] ?? false

        return (
          <div key={category} className="overflow-hidden rounded-xl bg-white shadow-sm">
            {/* Category header */}
            <button
              onClick={() => toggleCategory(category)}
              className="flex w-full items-center justify-between px-4 py-3.5"
            >
              <div className="flex items-center gap-2">
                <span className="text-base">{CATEGORY_ICONS[category] ?? '📋'}</span>
                <span className="text-foreground text-sm font-semibold">{category}</span>
                <span className="bg-secondary text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px]">
                  {catAnswered}/{catItems.length}
                </span>
              </div>
              {isOpen ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
            </button>

            {/* Items */}
            {isOpen && (
              <div className="divide-border divide-y border-t">
                {catItems.map((item) => (
                  <div key={item.id} className="px-4 py-3.5">
                    <div className="mb-2 flex items-start gap-2">
                      <span className="text-muted-foreground bg-secondary mt-0.5 shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px]">
                        {item.code}
                      </span>
                      <p className="text-foreground text-sm leading-snug">{item.labelTh}</p>
                    </div>

                    {/* Value buttons */}
                    <div className="flex gap-2">
                      {(['มี', 'ไม่มี', 'ได้มาตรฐาน'] as ChecklistValue[]).map((opt) => (
                        <button
                          key={opt!}
                          onClick={() => setItemValue(item.id, opt)}
                          className={`flex-1 rounded-lg border py-2 text-xs font-medium transition-all ${
                            item.value === opt
                              ? opt === 'มี' ? 'border-blue-200 bg-blue-50 text-blue-700'
                              : opt === 'ไม่มี' ? 'border-red-200 bg-red-50 text-red-600'
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
        <button className="border-white/30 flex flex-1 items-center justify-center gap-2 rounded-xl border bg-white/10 py-3 text-sm font-medium text-white backdrop-blur">
          <Save size={15} /> บันทึกร่าง
        </button>
        <button className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-bold text-[#1a3557]">
          <Send size={15} /> ส่งรายงาน
        </button>
      </div>
    </div>
  )
}