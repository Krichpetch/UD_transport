'use client'

import * as React from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { getChecklistTemplate, getStationTypeLabel } from '@/lib/constants'
import { useStation } from '@/hooks/use-stations'
import { useSaveDraft, useSubmitChecklist, useMyDraft } from '@/hooks/use-checklists'
import { saveDraft } from '@/lib/api/checklists'
import type { ChecklistGroup, ChecklistValue, ChecklistPhoto } from '@repo/types'
import { computeScoreFromItems, buildHistogram, scoreToStatus } from '@repo/types'
import {
  MapPin, Save, Send, CheckSquare, Square, Clock, User as UserIcon,
  StickyNote, AlertTriangle, Loader2,
} from 'lucide-react'
import { PhotoPicker } from '@/components/audit/PhotoPicker'
import { StationSearchPicker } from '@/components/audit/StationSearchPicker'
import { useAuthStore } from '@/stores/auth.store'
import { ApiError } from '@/lib/api'
import { getCurrentPosition, haversineMeters, PROXIMITY_BYPASS } from '@/lib/geolocation'
import type { SubmitGps } from '@/lib/geolocation'
import type { ChecklistRecord } from '@/lib/api/checklists'

const PROXIMITY_RADIUS_M = 1000

export default function AuditPage() {
  const qc = useQueryClient()
  const user = useAuthStore((s) => s.user)
  const [selectedId, setSelectedId] = React.useState('')
  const { data: station } = useStation(selectedId)
  const { data: draft, isLoading: draftLoading } = useMyDraft(selectedId)
  const saveDraftMutation = useSaveDraft(selectedId)
  const submitMutation = useSubmitChecklist(selectedId)
  const [submitResult, setSubmitResult] = React.useState<ChecklistRecord | null>(null)
  const [submitWarning, setSubmitWarning] = React.useState('')
  const [locating, setLocating] = React.useState(false)

  const [groups, setGroups] = React.useState<ChecklistGroup[]>([])
  const [currentPage, setCurrentPage] = React.useState(0)
  const [resumedFromDraft, setResumedFromDraft] = React.useState(false)
  const [autoSaveStatus, setAutoSaveStatus] = React.useState<'idle' | 'saving' | 'saved'>('idle')
  const [expandedNotes, setExpandedNotes] = React.useState<Set<string>>(new Set())

  // ── Check-in gate (Screen B) — confirm-to-start + GPS capture ──
  const [checkedIn, setCheckedIn] = React.useState(false)
  const [checkInStatus, setCheckInStatus] = React.useState<'idle' | 'checking' | 'blocked' | 'ok'>('idle')
  const [checkInMessage, setCheckInMessage] = React.useState('')
  const [locationUnverified, setLocationUnverified] = React.useState(false)

  // Tracks which stationId the form has been seeded for — prevents re-seeding on background refetches
  const seededForRef = React.useRef<string | null>(null)
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const savedBadgeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset all form + check-in state when the selected station changes
  React.useEffect(() => {
    seededForRef.current = null
    setCurrentPage(0)
    setSubmitResult(null)
    setSubmitWarning('')
    setResumedFromDraft(false)
    setGroups([])
    setAutoSaveStatus('idle')
    setExpandedNotes(new Set())
    setCheckedIn(false)
    setCheckInStatus('idle')
    setCheckInMessage('')
    setLocationUnverified(false)
  }, [station?.id])

  // Seed form exactly once per station — never overwrite the user's in-progress work
  React.useEffect(() => {
    if (!station || draftLoading) return
    if (seededForRef.current === station.id) return  // already seeded for this station
    seededForRef.current = station.id
    if (draft?.items && draft.items.length > 0) {
      setGroups(draft.items as ChecklistGroup[])
      setResumedFromDraft(true)
    } else {
      setGroups(getChecklistTemplate(station.mode))
      setResumedFromDraft(false)
    }
  }, [station?.id, draftLoading, draft, station])

  // Debounced autosave — fires 2s after the last edit, only once checked in and ≥1 item answered
  React.useEffect(() => {
    const answered = groups.flatMap((g) => g.items).some((i) => i.value !== null)
    if (!selectedId || !seededForRef.current || !answered || !checkedIn) return

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)

    autoSaveTimerRef.current = setTimeout(async () => {
      setAutoSaveStatus('saving')
      try {
        const saved = await saveDraft(selectedId, groups)
        // Update cache directly — no invalidation, no refetch, no risk of re-seeding
        qc.setQueryData(['checklist', selectedId, 'draft'], saved)
        setAutoSaveStatus('saved')
        if (savedBadgeTimerRef.current) clearTimeout(savedBadgeTimerRef.current)
        savedBadgeTimerRef.current = setTimeout(() => setAutoSaveStatus('idle'), 2500)
      } catch {
        setAutoSaveStatus('idle')
      }
    }, 2000)

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, selectedId, checkedIn])

  const allItems = groups.flatMap((g) => g.items)
  const answered = allItems.filter((i) => i.value !== null).length
  const total = allItems.length
  const progress = total > 0 ? Math.round((answered / total) * 100) : 0

  // Single source of truth for the score — same formula the server re-derives at submit time.
  const score = computeScoreFromItems(groups)

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

  function setItemNote(groupId: string, itemId: string, note: string) {
    setGroups((prev) =>
      prev.map((g) =>
        g.groupId !== groupId
          ? g
          : {
              ...g,
              items: g.items.map((item) => (item.id !== itemId ? item : { ...item, note })),
            }
      )
    )
  }

  function toggleNoteOpen(itemId: string) {
    setExpandedNotes((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  function attachPhotos(groupId: string, itemId: string, photos: ChecklistPhoto[]) {
    setGroups((prev) =>
      prev.map((g) =>
        g.groupId !== groupId
          ? g
          : {
              ...g,
              items: g.items.map((item) =>
                item.id !== itemId ? item : { ...item, photos: [...item.photos, ...photos] }
              ),
            }
      )
    )
  }

  // ── Check-in (Screen B "เริ่มการตรวจประเมิน") — client-side pre-check only. The
  // authoritative gate is always the server, re-checked again at submit time. ──
  async function handleCheckIn() {
    if (!station) return
    setCheckInStatus('checking')
    setCheckInMessage('')

    if (PROXIMITY_BYPASS) {
      setLocationUnverified(false)
      setCheckInStatus('ok')
      setCheckedIn(true)
      return
    }

    const pos = await getCurrentPosition()
    if (pos.status !== 'ok') {
      setCheckInStatus('blocked')
      setCheckInMessage(
        pos.status === 'denied'
          ? 'ไม่ได้รับอนุญาตให้เข้าถึงตำแหน่ง (GPS) กรุณาเปิดใช้งานแล้วลองใหม่'
          : 'ไม่สามารถระบุตำแหน่งได้ กรุณาลองใหม่อีกครั้ง'
      )
      return
    }

    if (station.coordStatus === 'OK' && station.lat != null && station.lng != null) {
      const distance = haversineMeters(pos.lat, pos.lng, station.lat, station.lng)
      if (distance > PROXIMITY_RADIUS_M) {
        setCheckInStatus('blocked')
        setCheckInMessage(
          `คุณอยู่นอกพื้นที่สถานี (ห่างประมาณ ${Math.round(distance).toLocaleString()} ม.) กรุณาเข้าใกล้สถานีแล้วลองใหม่`
        )
        return
      }
      setLocationUnverified(false)
    } else {
      setLocationUnverified(true)
    }

    setCheckInStatus('ok')
    setCheckedIn(true)
  }

  // ── Submit — server re-verifies distance; on a location rejection, save as draft ──
  async function handleSubmit() {
    if (!station) return
    setSubmitWarning('')

    let gps: SubmitGps | undefined
    if (!PROXIMITY_BYPASS) {
      setLocating(true)
      const pos = await getCurrentPosition()
      setLocating(false)
      if (pos.status === 'ok') gps = { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy }
      // else leave gps undefined — server hard-blocks coordStatus=OK stations with
      // LOCATION_REQUIRED, handled in the catch below exactly like an out-of-range reject.
    }

    try {
      const result = await submitMutation.mutateAsync({
        items: groups, score, gps, bypassRequested: PROXIMITY_BYPASS,
      })
      setSubmitResult(result)
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined
      if (code === 'OUT_OF_RANGE' || code === 'LOCATION_REQUIRED') {
        await saveDraftMutation.mutateAsync(groups)
        setSubmitWarning(
          (err instanceof ApiError ? err.message : null) ??
            'ไม่สามารถส่งรายงานได้ งานของคุณถูกบันทึกเป็นร่างแล้ว กรุณาลองส่งใหม่เมื่อถึงพื้นที่สถานี'
        )
      } else {
        setSubmitWarning(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการส่งรายงาน')
      }
    }
  }

  const VALUE_OPTIONS: { value: ChecklistValue; label: string; active: string; inactive: string }[] = [
    { value: 'มี',    label: 'มี',            active: 'border-blue-300 bg-blue-50 text-blue-700',   inactive: 'border-border bg-white text-muted-foreground' },
    { value: 'ไม่มี', label: 'ไม่มี',         active: 'border-red-200 bg-red-50 text-red-700',      inactive: 'border-border bg-white text-muted-foreground' },
    { value: 'N/A',  label: 'ไม่เกี่ยวข้อง', active: 'border-gray-200 bg-gray-50 text-gray-600',   inactive: 'border-border bg-white text-muted-foreground' },
  ]

  const stationPicker = (
    <StationSearchPicker
      value={selectedId}
      selectedStation={station}
      onSelect={setSelectedId}
    />
  )

  if (!selectedId || !station || draftLoading) {
    return (
      <div className="space-y-4">
        {stationPicker}
        <div className="rounded-xl bg-white p-6 text-center text-sm text-muted-foreground shadow-sm">
          {!selectedId ? 'กรุณาเลือกสถานีเพื่อเริ่มการตรวจสอบ' : 'กำลังโหลด…'}
        </div>
      </div>
    )
  }

  // ── Screen D: post-submit summary ──
  if (submitResult) {
    const histogram = buildHistogram(submitResult.items)
    const finalScore = submitResult.score ?? computeScoreFromItems(submitResult.items)
    const status = scoreToStatus(finalScore)
    const color = finalScore >= 75 ? '#52aa4e' : finalScore >= 50 ? '#ffc107' : '#f44336'
    return (
      <div className="space-y-4">
        {stationPicker}
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <p className="text-center text-lg font-bold text-foreground">ส่งรายงานสำเร็จ ✓</p>
          <p className="mt-1 text-center text-sm text-muted-foreground">{station.nameTh}</p>
          <p className="mt-1 text-center text-xs text-muted-foreground">
            ส่งเมื่อ {submitResult.submittedAt ? new Date(submitResult.submittedAt).toLocaleString('th-TH') : '-'}
          </p>

          {submitResult.locationVerified === false && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-center text-xs text-amber-700">
              ⚠ ไม่สามารถยืนยันตำแหน่งได้ – พิกัดสถานีเป็นค่าโดยประมาณ
            </p>
          )}

          <div className="mt-4 text-center">
            <span className="text-4xl font-bold" style={{ color }}>{finalScore}%</span>
            <p className="mt-1 text-xs font-semibold" style={{ color }}>{status}</p>
          </div>

          <div className="mt-4 divide-y divide-border border-t border-border text-sm">
            <div className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">มี ได้มาตรฐาน</span>
              <span className="font-semibold text-[#52aa4e]">{histogram.hasStandard}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">มี ไม่ได้มาตรฐาน</span>
              <span className="font-semibold text-amber-600">{histogram.hasSubstandard}</span>
            </div>
            {histogram.standardUnspecified > 0 && (
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">มี ไม่ระบุมาตรฐาน ⚑</span>
                <span className="font-semibold text-orange-500">{histogram.standardUnspecified}</span>
              </div>
            )}
            <div className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">ไม่มี</span>
              <span className="font-semibold text-[#f44336]">{histogram.none}</span>
            </div>
            <div className="flex items-center justify-between py-2">
              <span className="text-muted-foreground">ไม่เกี่ยวข้อง (N/A)</span>
              <span className="font-semibold text-gray-400">{histogram.na}</span>
            </div>
          </div>

          <button
            onClick={() => { setSelectedId(''); setSubmitResult(null) }}
            className="mt-5 w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
          >
            ตรวจสถานีถัดไป
          </button>
        </div>
      </div>
    )
  }

  // ── Screen B: pre-audit confirm-to-start ──
  if (!checkedIn) {
    return (
      <div className="space-y-4">
        {stationPicker}
        <div className="space-y-4 rounded-xl bg-white p-6 shadow-sm">
          <div>
            <h1 className="text-lg font-bold text-foreground">{station.nameTh}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {getStationTypeLabel(station)}
              {station.railSubtype ? ` — ${station.railSubtype}` : ''}
            </p>
          </div>

          <div className="space-y-2.5 border-t border-border pt-4 text-sm">
            <div className="flex items-center gap-2">
              <Clock size={14} className="shrink-0 text-muted-foreground" />
              <span className="text-foreground">{new Date().toLocaleString('th-TH')}</span>
            </div>
            <div className="flex items-center gap-2">
              <UserIcon size={14} className="shrink-0 text-muted-foreground" />
              <span className="text-foreground">{user?.username ?? '-'}</span>
            </div>
          </div>

          {checkInStatus === 'blocked' && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{checkInMessage}</span>
            </div>
          )}

          <button
            onClick={handleCheckIn}
            disabled={checkInStatus === 'checking'}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {checkInStatus === 'checking' && <Loader2 size={15} className="animate-spin" />}
            {checkInStatus === 'checking'
              ? 'กำลังตรวจสอบตำแหน่ง…'
              : checkInStatus === 'blocked'
                ? 'ลองอีกครั้ง'
                : 'เริ่มการตรวจประเมิน'}
          </button>

          {PROXIMITY_BYPASS && (
            <p className="text-center text-[10px] font-medium text-amber-600">
              โหมดทดสอบ: ข้ามการตรวจสอบตำแหน่ง (dev only)
            </p>
          )}
        </div>
      </div>
    )
  }

  const isSummaryPage = currentPage === groups.length

  return (
    <div className="space-y-4">
      {stationPicker}

      {/* Header with overall progress — always visible */}
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="mb-1 flex items-start justify-between">
          <div>
            <h1 className="text-sm font-bold text-foreground">{station.nameTh}</h1>
            <div className="mt-0.5 flex items-center gap-1">
              <MapPin size={10} className="text-accent" />
              <p className="text-xs text-muted-foreground">{station.province}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-primary">{progress}%</p>
            <p className="text-[10px] text-muted-foreground">{answered}/{total} ข้อ</p>
          </div>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-accent transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex items-center gap-3">
          {resumedFromDraft && (
            <p className="text-[10px] text-muted-foreground">↩ ดำเนินการต่อจากร่างที่บันทึกไว้</p>
          )}
          {autoSaveStatus === 'saving' && (
            <p className="text-[10px] text-muted-foreground">กำลังบันทึก…</p>
          )}
          {autoSaveStatus === 'saved' && (
            <p className="text-[10px] text-accent">✓ บันทึกอัตโนมัติแล้ว</p>
          )}
        </div>
        {locationUnverified && (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-700">
            <AlertTriangle size={11} className="shrink-0" />
            ไม่สามารถยืนยันตำแหน่งได้ – พิกัดสถานีเป็นค่าโดยประมาณ
          </p>
        )}
      </div>

      {submitWarning && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 shadow-sm">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{submitWarning}</span>
        </div>
      )}

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
              onClick={handleSubmit}
              disabled={submitMutation.isPending || locating || progress < 100}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {(submitMutation.isPending || locating) ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              {locating ? 'กำลังระบุตำแหน่ง…' : submitMutation.isPending ? 'กำลังส่ง…' : 'ส่งรายงาน'}
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
                    {item.photos.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
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
                    <PhotoPicker
                      onPhotosUploaded={(photos) => attachPhotos(group.groupId, item.id, photos)}
                    />
                    {item.note || expandedNotes.has(item.id) ? (
                      <textarea
                        value={item.note}
                        onChange={(e) => setItemNote(group.groupId, item.id, e.target.value)}
                        placeholder="บันทึกเพิ่มเติม (ถ้ามี)"
                        rows={2}
                        className="border-border placeholder:text-muted-foreground focus:ring-ring mt-2.5 w-full rounded-lg border bg-white px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1"
                      />
                    ) : (
                      <button
                        onClick={() => toggleNoteOpen(item.id)}
                        className="text-muted-foreground hover:text-foreground mt-2.5 flex items-center gap-1 text-[11px]"
                      >
                        <StickyNote size={11} /> เพิ่มบันทึก
                      </button>
                    )}
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
            className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-white px-4 py-3 text-sm font-medium text-foreground shadow-sm"
          >
            ← ก่อนหน้า
          </button>
        )}
        <button
          onClick={() => saveDraftMutation.mutate(groups)}
          disabled={saveDraftMutation.isPending}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-white py-3 text-sm font-medium text-foreground shadow-sm disabled:opacity-50"
        >
          <Save size={15} />
          {saveDraftMutation.isPending ? 'กำลังบันทึก…' : 'บันทึกร่าง'}
        </button>
        {!isSummaryPage && (
          <button
            onClick={() => setCurrentPage((p) => p + 1)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground"
          >
            ถัดไป →
          </button>
        )}
      </div>
    </div>
  )
}
