'use client'

import * as React from 'react'
import {
  mockStations,
  getChecklistTemplate,
  type ChecklistGroup,
  type ChecklistSubItem,
  type ChecklistPhoto,
} from '@/lib/mock-data'
import {
  ChevronLeft,
  Download,
  X,
  ZoomIn,
  Flag,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import Link from 'next/link'

// ─── Score Circle ─────────────────────────────────────────────
function ScoreCircle({ score }: { score: number }) {
  const r = 52
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - score / 100)
  const color = score >= 75 ? '#52aa4e' : score >= 50 ? '#ffc107' : '#f44336'
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="128" height="128" viewBox="0 0 128 128">
        <circle cx="64" cy="64" r={r} fill="none" stroke="var(--secondary)" strokeWidth="10" />
        <circle cx="64" cy="64" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
          transform="rotate(-90 64 64)" style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        <text x="64" y="60" textAnchor="middle" fontSize="26" fontWeight="bold" fill={color}>{score}%</text>
        <text x="64" y="78" textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">คะแนนรวม</text>
      </svg>
    </div>
  )
}

// ─── Photo Lightbox ───────────────────────────────────────────
function Lightbox({ photo, onClose }: { photo: ChecklistPhoto; onClose: () => void }) {
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm" onClick={onClose}>
      <div className="relative max-h-[90vh] max-w-[90vw]" onClick={e => e.stopPropagation()}>
        <img src={photo.url} alt={photo.filename} className="max-h-[85vh] max-w-[85vw] rounded-xl object-contain shadow-2xl" />
        <button onClick={onClose}
          className="absolute -top-3 -right-3 flex size-8 items-center justify-center rounded-full bg-white shadow-lg">
          <X size={14} className="text-gray-700" />
        </button>
        <p className="text-center mt-2 text-white/70 text-xs">{photo.filename}</p>
      </div>
    </div>
  )
}

// ─── Checklist Row ────────────────────────────────────────────
function ChecklistRow({ item }: { item: ChecklistSubItem }) {
  const [lightbox, setLightbox] = React.useState<ChecklistPhoto | null>(null)

  const isMi = item.value === 'มี'
  const isMaiMi = item.value === 'ไม่มี'

  return (
    <div className={`border-b border-border last:border-0 transition-colors ${item.flagged ? 'bg-orange-50/40' : ''}`}>
      {lightbox && <Lightbox photo={lightbox} onClose={() => setLightbox(null)} />}

      <div className="grid grid-cols-[3rem_1fr_3.5rem_3.5rem_5rem_4rem_4rem] items-center gap-0 px-0">

        {/* Code */}
        <div className="px-3 py-3">
          <span className="font-mono text-[11px] text-muted-foreground bg-secondary rounded px-1.5 py-0.5">
            {item.id}
          </span>
        </div>

        {/* Label + note (read-only) */}
        <div className="px-3 py-3">
          <p className="text-sm text-foreground leading-snug">{item.labelTh}</p>
          {item.note && (
            <p className="mt-1 text-xs text-muted-foreground italic bg-secondary/60 rounded px-2 py-1">
              📝 {item.note}
            </p>
          )}
        </div>

        {/* มี */}
        <div className="flex items-center justify-center py-3">
          <div className={`size-5 rounded-full border-2 flex items-center justify-center cursor-default
            ${isMi ? 'border-blue-500 bg-blue-500' : 'border-border/40'}`}>
            {isMi && <div className="size-2 rounded-full bg-white" />}
          </div>
        </div>

        {/* ไม่มี */}
        <div className="flex items-center justify-center py-3">
          <div className={`size-5 rounded-full border-2 flex items-center justify-center cursor-default
            ${isMaiMi ? 'border-red-500 bg-red-500' : 'border-border/40'}`}>
            {isMaiMi && <div className="size-2 rounded-full bg-white" />}
          </div>
        </div>

        {/* ได้มาตรฐาน (read-only checkbox) */}
        <div className="flex items-center justify-center py-3">
          {isMi ? (
            <div className={`size-5 rounded border-2 flex items-center justify-center cursor-default
              ${item.meetsStandard ? 'border-green-500 bg-green-500' : 'border-border/40'}`}>
              {item.meetsStandard && (
                <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
                  <path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
          ) : (
            <div className="size-5 rounded border-2 border-border/20 bg-secondary/30" />
          )}
        </div>

        {/* หลักฐาน — read-only photo thumbnails */}
        <div className="flex items-center justify-center py-3">
          {item.photos.length > 0 ? (
            <div className="flex flex-wrap gap-1 justify-center">
              {item.photos.map(p => (
                <button key={p.id} onClick={() => setLightbox(p)}
                  className="group relative block size-9 overflow-hidden rounded border border-border shadow-sm">
                  <img src={p.url} alt={p.filename} className="size-full object-cover" />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/30">
                    <ZoomIn size={10} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <span className="text-muted-foreground/40 text-[10px]">—</span>
          )}
        </div>

        {/* พลิกฉาก — read-only flag indicator */}
        <div className="flex items-center justify-center py-3 pr-3">
          {item.flagged ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-600">
              <Flag size={9} fill="currentColor" /> รอตรวจ
            </span>
          ) : (
            <span className="text-muted-foreground/40 text-[10px]">—</span>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────
export default function StationChecklistPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = React.use(params)
  const station = mockStations.find(s => s.id === id) ?? mockStations[0]!

  const [groups] = React.useState<ChecklistGroup[]>(() =>
    getChecklistTemplate(station.mode)
  )
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>(
    () => Object.fromEntries(getChecklistTemplate(station.mode).map(g => [g.groupId, true]))
  )

  // ── Derived stats ──────────────────────────────────────────
  const allItems = groups.flatMap(g => g.items)
  const miCount = allItems.filter(i => i.value === 'มี').length
  const maiMiCount = allItems.filter(i => i.value === 'ไม่มี').length
  const standardCount = allItems.filter(i => i.value === 'มี' && i.meetsStandard).length
  const answered = allItems.filter(i => i.value !== null).length
  const flaggedCount = allItems.filter(i => i.flagged).length
  const score = allItems.length > 0
    ? Math.round(((miCount + standardCount) / allItems.length) * 100)
    : 0

  function toggleGroup(groupId: string) {
    setOpenGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  // ── Render ─────────────────────────────────────────────────
  return (
    <div className="space-y-5">
      {/* ── Header ── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/stations"
            className="text-muted-foreground hover:text-foreground mb-2 flex items-center gap-1 text-xs"
          >
            <ChevronLeft size={13} /> กลับรายการสถานี
          </Link>
          <h1 className="text-foreground text-xl font-bold">{station.nameTh}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <span>ประเภท: <strong className="text-foreground">{station.mode}</strong>
              {station.railSubtype && <> — <strong className="text-foreground">{station.railSubtype}</strong></>}
            </span>
            <span>·</span>
            <span>จังหวัด: <strong className="text-foreground">{station.province}</strong></span>
            {station.lastInspected && <>
              <span>·</span>
              <span>ตรวจล่าสุด: <strong className="text-foreground">{station.lastInspected}</strong></span>
            </>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="border-border text-muted-foreground hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors">
            <Download size={13} /> Export PDF
          </button>
          <button className="border-border text-muted-foreground hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-colors">
            <Download size={13} /> Export Excel
          </button>
        </div>
      </div>

      {/* ── Body: table + sidebar ── */}
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">

        {/* ── Left: checklist table ── */}
        <div className="space-y-4">
          <div>
            <h2 className="text-foreground font-semibold">
              รายการตรวจสอบสิ่งอำนวยความสะดวก ({station.mode})
            </h2>
            <p className="text-muted-foreground text-xs mt-0.5">
              ตามพจนานุกรมข้อมูล OTP (อัปเดต 17 เม.ย. 2566)
            </p>
          </div>

          {groups.map(group => {
            const isOpen = openGroups[group.groupId] ?? true
            const groupAnswered = group.items.filter(i => i.value !== null).length
            return (
              <div key={group.groupId} className="bg-card border-border overflow-hidden rounded-xl border">
                {/* Group header */}
                <button
                  onClick={() => toggleGroup(group.groupId)}
                  className="flex w-full items-center justify-between bg-secondary/40 px-4 py-3 hover:bg-secondary/60 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-foreground">{group.groupId}</span>
                    <span className="text-sm font-semibold text-foreground">
                      {group.groupName.replace(/^\([^)]+\)\s*-?\s*/, '')}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      ({groupAnswered}/{group.items.length})
                    </span>
                  </div>
                  {isOpen
                    ? <ChevronUp size={14} className="text-muted-foreground" />
                    : <ChevronDown size={14} className="text-muted-foreground" />
                  }
                </button>

                {isOpen && (
                  <>
                    {/* Column headers */}
                    <div className="grid grid-cols-[3rem_1fr_3.5rem_3.5rem_5rem_4rem_4rem] border-b border-border bg-secondary/20 px-0">
                      {[
                        { label: 'รหัส', cls: 'px-3 py-2' },
                        { label: 'รายการ', cls: 'px-3 py-2' },
                        { label: 'มี', cls: 'text-center py-2' },
                        { label: 'ไม่มี', cls: 'text-center py-2' },
                        { label: 'ได้มาตรฐาน', cls: 'text-center py-2' },
                        { label: 'หลักฐาน', cls: 'text-center py-2' },
                        { label: 'พลิกฉาก', cls: 'text-center py-2 pr-3' },
                      ].map(({ label, cls }) => (
                        <div key={label} className={`text-muted-foreground text-[10px] font-medium uppercase tracking-wide ${cls}`}>
                          {label}
                        </div>
                      ))}
                    </div>

                    {/* Rows */}
                    {group.items.map(item => (
                      <ChecklistRow key={item.id} item={item} />
                    ))}
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Right: score summary ── */}
        <div className="space-y-4">
          <div className="bg-card border-border sticky top-20 rounded-xl border p-5">
            <h2 className="text-foreground mb-4 text-sm font-semibold">สรุปผลการตรวจสอบ</h2>

            <div className="flex justify-center mb-4">
              <ScoreCircle score={score} />
            </div>

            <div className="space-y-2.5 text-xs border-t border-border pt-4">
              {[
                { label: 'รายการทั้งหมด', value: allItems.length, color: 'text-foreground' },
                { label: 'ได้มาตรฐาน', value: standardCount, color: 'text-[#52aa4e]' },
                { label: 'ยังไม่ได้มาตรฐาน', value: miCount - standardCount, color: 'text-[#ffc107]' },
                { label: 'ไม่มี', value: maiMiCount, color: 'text-[#f44336]' },
                { label: 'ยังไม่ตอบ', value: allItems.length - answered, color: 'text-muted-foreground' },
                ...(flaggedCount > 0 ? [{ label: 'รอตรวจสอบ', value: flaggedCount, color: 'text-orange-500' }] : []),
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={`font-semibold ${color}`}>{value}</span>
                </div>
              ))}
            </div>

            {/* Progress */}
            <div className="mt-4">
              <div className="mb-1 flex justify-between text-[10px] text-muted-foreground">
                <span>ความคืบหน้า</span>
                <span>{allItems.length > 0 ? Math.round((answered / allItems.length) * 100) : 0}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div className="bg-accent h-full rounded-full transition-all"
                  style={{ width: `${allItems.length > 0 ? (answered / allItems.length) * 100 : 0}%` }} />
              </div>
            </div>

            {/* Export buttons */}
            <div className="mt-4 space-y-2 border-t border-border pt-4">
              <button className="border-border hover:bg-secondary flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground transition-colors">
                <Download size={12} /> Export เป็น PDF
              </button>
              <button className="border-border hover:bg-secondary flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground transition-colors">
                <Download size={12} /> Export เป็น Excel
              </button>
            </div>

            {/* Flagged items summary */}
            {flaggedCount > 0 && (
              <div className="mt-4 rounded-lg bg-orange-50 border border-orange-200 p-3">
                <p className="text-orange-700 text-xs font-semibold mb-1.5 flex items-center gap-1.5">
                  <Flag size={11} fill="currentColor" /> รายการรอตรวจสอบ ({flaggedCount})
                </p>
                {allItems.filter(i => i.flagged).map(i => (
                  <p key={i.id} className="text-orange-600 text-[10px] flex items-start gap-1 mt-0.5">
                    <span className="font-mono shrink-0">{i.id}</span>
                    <span className="truncate">{i.labelTh}</span>
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}