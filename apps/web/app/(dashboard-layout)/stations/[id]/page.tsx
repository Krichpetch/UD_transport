'use client'

import * as React from 'react'
import { getChecklistTemplate } from '@/lib/mock-data'
import { useStation } from '@/hooks/use-stations'
import { useChecklist } from '@/hooks/use-checklists'
import { useApproveChecklist } from '@/hooks/use-stations'
import { useQueryClient } from '@tanstack/react-query'
import type { ChecklistGroup, ChecklistSubItem, ChecklistPhoto } from '@repo/types'
import {
  ChevronLeft,
  Download,
  X,
  ZoomIn,
  Flag,
  ChevronDown,
  ChevronUp,
  CheckCircle,
  Loader2,
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
        <text x="64" y="78" textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">ร้อยละความสำเร็จ</text>
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
        <p className="mt-2 text-center text-xs text-white/70">{photo.filename}</p>
      </div>
    </div>
  )
}

// ─── Checklist Row ────────────────────────────────────────────
function ChecklistRow({ item, onToggleFlag }: { item: ChecklistSubItem; onToggleFlag: () => void }) {
  const [lightbox, setLightbox] = React.useState<ChecklistPhoto | null>(null)

  const isMi = item.value === 'มี'
  const isMaiMi = item.value === 'ไม่มี'
  const isNA = item.value === 'N/A'

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
          <div className="flex items-start gap-1.5">
            <p className="text-sm text-foreground leading-snug">{item.labelTh}</p>
            {item.cabinetPriority && (
              <span className="mt-0.5 shrink-0 rounded-full bg-amber-50 px-1.5 py-0.5 text-[9px] font-medium text-amber-700">
                มติ ครม.
              </span>
            )}
          </div>
          {item.note && (
            <p className="mt-1 text-xs text-muted-foreground italic bg-secondary/60 rounded px-2 py-1">
              📝 {item.note}
            </p>
          )}
        </div>

        {/* มี — or N/A badge spanning this cell */}
        <div className="flex items-center justify-center py-3">
          {isNA ? (
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">
              N/A
            </span>
          ) : (
            <div className={`size-5 rounded-full border-2 flex items-center justify-center cursor-default
              ${isMi ? 'border-blue-500 bg-blue-500' : 'border-border/40'}`}>
              {isMi && <div className="size-2 rounded-full bg-white" />}
            </div>
          )}
        </div>

        {/* ไม่มี */}
        <div className="flex items-center justify-center py-3">
          {isNA ? null : (
            <div className={`size-5 rounded-full border-2 flex items-center justify-center cursor-default
              ${isMaiMi ? 'border-red-500 bg-red-500' : 'border-border/40'}`}>
              {isMaiMi && <div className="size-2 rounded-full bg-white" />}
            </div>
          )}
        </div>

        {/* ได้มาตรฐาน (read-only checkbox) */}
        <div className="flex items-center justify-center py-3">
          {isNA ? (
            <div className="size-5 rounded border-2 border-border/10 bg-secondary/20" />
          ) : isMi ? (
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

        {/* พบปัญหา — interactive flag toggle */}
        <button
          onClick={onToggleFlag}
          className="flex w-full items-center justify-center py-3 pr-3 transition-colors hover:bg-orange-50/60"
        >
          {item.flagged ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-600">
              <Flag size={9} fill="currentColor" /> พบปัญหา
            </span>
          ) : (
            <span className="text-muted-foreground/30 text-[10px]">—</span>
          )}
        </button>

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
  const { data: station, isLoading: stationLoading, error: stationError } = useStation(id)
  const { data: checklist } = useChecklist(id)
  const qc = useQueryClient()
  const approveMutation = useApproveChecklist()

  const [groups, setGroups] = React.useState<ChecklistGroup[]>([])
  const [openGroups, setOpenGroups] = React.useState<Record<string, boolean>>({})

  React.useEffect(() => {
    if (!station) return
    setGroups(checklist?.items ?? getChecklistTemplate(station.mode))
  }, [station?.id, checklist?.id])

  function toggleFlag(groupId: string, itemId: string) {
    setGroups(prev =>
      prev.map(g =>
        g.groupId !== groupId ? g : {
          ...g,
          items: g.items.map(item =>
            item.id !== itemId ? item : { ...item, flagged: !item.flagged }
          ),
        }
      )
    )
  }

  // ── Derived stats — N/A items excluded from scoring denominator ──
  const allItems = groups.flatMap(g => g.items)
  const eligibleItems = allItems.filter(i => i.value !== 'N/A')
  const T = eligibleItems.length
  const miCount       = allItems.filter(i => i.value === 'มี').length
  const standardCount = allItems.filter(i => i.value === 'มี' && i.meetsStandard).length
  const maiMiCount    = allItems.filter(i => i.value === 'ไม่มี').length
  const naCount       = allItems.filter(i => i.value === 'N/A').length
  const flaggedCount  = allItems.filter(i => i.flagged).length

  // 6 metrics per CLAUDE.md
  const pctSuccess       = T > 0       ? Math.round((standardCount / T) * 100) : 0
  const pctHasFacility   = T > 0       ? Math.round((miCount / T) * 100) : 0
  const pctMeetsStandard = miCount > 0 ? Math.round((standardCount / miCount) * 100) : 0

  function toggleGroup(groupId: string) {
    setOpenGroups(prev => ({ ...prev, [groupId]: !prev[groupId] }))
  }

  if (stationLoading) return (
    <div className="flex items-center justify-center p-16 text-sm text-muted-foreground">กำลังโหลด…</div>
  )
  if (stationError || !station) return (
    <div className="flex items-center justify-center p-16 text-sm text-red-500">ไม่พบสถานี</div>
  )

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
            <span>·</span>
            <span>หน่วยงาน: <strong className="text-foreground">{station.responsibleAgency}</strong></span>
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
                        { label: 'พบปัญหา', cls: 'text-center py-2 pr-3' },
                      ].map(({ label, cls }) => (
                        <div key={label} className={`text-muted-foreground text-[10px] font-medium uppercase tracking-wide ${cls}`}>
                          {label}
                        </div>
                      ))}
                    </div>

                    {/* Rows */}
                    {group.items.map(item => (
                      <ChecklistRow
                        key={item.id}
                        item={item}
                        onToggleFlag={() => toggleFlag(group.groupId, item.id)}
                      />
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

            {/* Approve button — only when checklist is awaiting approval */}
            {checklist?.status === 'SUBMITTED' && (
              <button
                onClick={() =>
                  approveMutation.mutate(
                    { stationId: id, checklistId: checklist.id },
                    { onSuccess: () => qc.invalidateQueries({ queryKey: ['checklist', id] }) }
                  )
                }
                disabled={approveMutation.isPending}
                className="mb-4 flex w-full items-center justify-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-60"
              >
                {approveMutation.isPending
                  ? <Loader2 size={13} className="animate-spin" />
                  : <CheckCircle size={13} />}
                อนุมัติรายงานนี้
              </button>
            )}

            <div className="flex justify-center mb-4">
              <ScoreCircle score={pctSuccess} />
            </div>

            {/* 6 metrics per CLAUDE.md */}
            <div className="space-y-2.5 text-xs border-t border-border pt-4">
              {[
                { label: 'จำนวนรายการ (ไม่รวม N/A)', value: T,                   color: 'text-foreground' },
                { label: 'จำนวนรายการที่มีสิ่งอำนวยฯ', value: miCount,           color: 'text-blue-600' },
                { label: 'จำนวนรายการที่ได้มาตรฐาน',   value: standardCount,     color: 'text-[#52aa4e]' },
                { label: 'ร้อยละความสำเร็จ',             value: `${pctSuccess}%`,       color: 'text-[#52aa4e]' },
                { label: 'ร้อยละการจัดให้มีสิ่งอำนวยฯ', value: `${pctHasFacility}%`,   color: 'text-blue-600' },
                { label: 'ร้อยละการได้มาตรฐาน',          value: `${pctMeetsStandard}%`, color: 'text-[#52aa4e]' },
              ].map(({ label, value, color }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={`font-semibold ${color}`}>{value}</span>
                </div>
              ))}

              {/* Secondary counts */}
              <div className="border-t border-border pt-2.5 space-y-2">
                {[
                  { label: 'ไม่มี',            value: maiMiCount, color: 'text-[#f44336]' },
                  { label: 'ไม่เกี่ยวข้อง (N/A)', value: naCount,    color: 'text-gray-400' },
                  ...(flaggedCount > 0 ? [{ label: 'พบปัญหา', value: flaggedCount, color: 'text-orange-500' }] : []),
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex items-center justify-between">
                    <span className="text-muted-foreground">{label}</span>
                    <span className={`font-semibold ${color}`}>{value}</span>
                  </div>
                ))}
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
                  <Flag size={11} fill="currentColor" /> รายการพบปัญหา ({flaggedCount})
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
