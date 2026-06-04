'use client'

import * as React from 'react'
import { mockStations, mockChecklistItems, type ChecklistItem } from '@/lib/mock-data'
import { ChevronLeft, Download, Send, Save } from 'lucide-react'
import Link from 'next/link'

type ChecklistValue = 'มี' | 'ไม่มี' | 'ได้มาตรฐาน'

const VALUE_OPTIONS: ChecklistValue[] = ['มี', 'ไม่มี', 'ได้มาตรฐาน']

const VALUE_STYLES: Record<string, string> = {
  มี: 'bg-blue-50 text-blue-700 border-blue-200',
  ไม่มี: 'bg-red-50 text-red-600 border-red-200',
  ได้มาตรฐาน: 'bg-green-50 text-green-700 border-green-200',
}

function ScoreCircle({ score }: { score: number }) {
  const radius = 36
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - score / 100)
  const color = score >= 75 ? '#52aa4e' : score >= 50 ? '#ffc107' : '#f44336'

  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="90" height="90" viewBox="0 0 90 90">
        <circle cx="45" cy="45" r={radius} fill="none" stroke="var(--secondary)" strokeWidth="7" />
        <circle
          cx="45"
          cy="45"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          transform="rotate(-90 45 45)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text x="45" y="50" textAnchor="middle" fontSize="18" fontWeight="bold" fill={color}>
          {score}
        </text>
      </svg>
      <p className="text-muted-foreground text-xs">คะแนน UD</p>
    </div>
  )
}

export default function StationChecklistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = React.use(params)
  const station = mockStations.find((s) => s.id === id) ?? mockStations[0]!

  const [items, setItems] = React.useState<ChecklistItem[]>(mockChecklistItems)

  const answered = items.filter((i) => i.value !== null).length
  const score = Math.round(
    (items.filter((i) => i.value === 'มี' || i.value === 'ได้มาตรฐาน').length / items.length) * 100
  )

  const categories = Array.from(new Set(items.map((i) => i.category)))

  function setItemValue(id: string, value: ChecklistValue) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, value } : item)))
  }

  return (
    <div className="space-y-6">
      {/* Back + Title */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/stations"
            className="text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1 text-xs"
          >
            <ChevronLeft size={13} /> กลับรายการสถานี
          </Link>
          <h1 className="text-foreground text-xl font-bold">{station.nameTh}</h1>
          <p className="text-muted-foreground text-sm">
            {station.province} · {station.type}
          </p>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          <button className="border-border text-muted-foreground hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors">
            <Save size={13} /> บันทึกร่าง
          </button>
          <button className="border-border text-muted-foreground hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors">
            <Download size={13} /> ส่งออก
          </button>
          <button className="bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-opacity">
            <Send size={13} /> ส่งรายงาน
          </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        {/* Checklist — takes 3 cols */}
        <div className="space-y-4 lg:col-span-3">
          {categories.map((category) => (
            <div key={category} className="bg-card border-border overflow-hidden rounded-xl border">
              <div className="bg-secondary/40 border-border border-b px-5 py-3">
                <h2 className="text-foreground text-sm font-semibold">{category}</h2>
              </div>
              <div className="divide-border divide-y">
                {items
                  .filter((item) => item.category === category)
                  .map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-4 px-5 py-3.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground bg-secondary rounded px-1.5 py-0.5 font-mono text-[10px]">
                            {item.code}
                          </span>
                          <p className="text-foreground text-sm font-medium">{item.labelTh}</p>
                        </div>
                        <p className="text-muted-foreground text-xs">{item.label}</p>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        {VALUE_OPTIONS.map((opt) => (
                          <button
                            key={opt}
                            onClick={() => setItemValue(item.id, opt)}
                            className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-all ${
                              item.value === opt
                                ? VALUE_STYLES[opt]
                                : 'border-border text-muted-foreground hover:bg-secondary'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>

        {/* Score summary — 1 col */}
        <div className="space-y-4 lg:col-span-1">
          <div className="bg-card border-border rounded-xl border p-5">
            <h2 className="text-foreground mb-4 text-sm font-semibold">สรุปคะแนน</h2>
            <div className="flex flex-col items-center gap-4">
              <ScoreCircle score={score} />
              <div className="w-full space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ตอบแล้ว</span>
                  <span className="text-foreground font-medium">
                    {answered}/{items.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ผ่านมาตรฐาน</span>
                  <span className="font-medium text-[#52aa4e]">
                    {items.filter((i) => i.value === 'มี' || i.value === 'ได้มาตรฐาน').length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ไม่ผ่าน</span>
                  <span className="font-medium text-[#f44336]">
                    {items.filter((i) => i.value === 'ไม่มี').length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ยังไม่ตอบ</span>
                  <span className="text-muted-foreground font-medium">
                    {items.filter((i) => i.value === null).length}
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full">
                <div className="mb-1 flex justify-between text-[10px]">
                  <span className="text-muted-foreground">ความคืบหน้า</span>
                  <span className="text-foreground">
                    {Math.round((answered / items.length) * 100)}%
                  </span>
                </div>
                <div className="bg-secondary h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-accent h-full rounded-full transition-all"
                    style={{ width: `${(answered / items.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Station info */}
          <div className="bg-card border-border rounded-xl border p-5 text-xs">
            <h2 className="text-foreground mb-3 text-sm font-semibold">ข้อมูลสถานี</h2>
            <div className="space-y-2">
              {[
                { label: 'ประเภท', value: station.type },
                { label: 'จังหวัด', value: station.province },
                { label: 'ภาค', value: station.region },
                { label: 'ตรวจล่าสุด', value: station.lastInspected ?? '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-foreground font-medium">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
