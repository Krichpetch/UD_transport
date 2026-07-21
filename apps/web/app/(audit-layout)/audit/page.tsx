'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { getStationTypeLabel } from '@/lib/constants'
import { useStation } from '@/hooks/use-stations'
import { useSaveDraft, useSubmitChecklist, useMyDraft, useTemplateForAudit } from '@/hooks/use-checklists'
import { useUpdateYearBuilt } from '@/hooks/use-stations'
import { computeScoreFromItems, buildHistogram, scoreToStatus } from '@repo/types'
import {
  MapPin, Save, Send, Clock, User as UserIcon,
  AlertTriangle, Loader2, X, FlaskConical,
} from 'lucide-react'
import { StationSearchPicker } from '@/components/audit/StationSearchPicker'
import { LeafAnswerRow } from '@/components/audit/LeafAnswerRow'
import { V2ItemPage } from '@/components/audit/V2PagerForm'
import { useAuthStore } from '@/stores/auth.store'
import { useAuditFormStore } from '@/stores/audit-form.store'
import { buildStoredGroups, countProgressForNodes, groupDisplayName } from '@/lib/audit-form'
import { ApiError } from '@/lib/api'
import { getCurrentPosition, haversineMeters, PROXIMITY_BYPASS } from '@/lib/geolocation'
import type { SubmitGps } from '@/lib/geolocation'
import type { ChecklistRecord } from '@/lib/api/checklists'
import { YEAR_BUILT_MIN, yearBuiltMax } from '@repo/types'

const PROXIMITY_RADIUS_M = 1000
const AUTOSAVE_DEBOUNCE_MS = 4000
const FINAL_THOUGHTS_MAX = 4000

export default function AuditPage() {
  const user = useAuthStore((s) => s.user)
  const searchParams = useSearchParams()
  // Part B.2 — v2 preview is admin-only and gated behind an explicit query flag; the server
  // additionally 403s a non-admin caller, so this client-side check is UX only, not the guard.
  // Same flag name/value ("preview=v2") as the underlying API call (lib/api/checklists.ts) —
  // deliberately kept identical end-to-end so there is only one spelling to remember or type.
  const v2PreviewRequested = searchParams.get('preview') === 'v2'
  const v2PreviewAllowed = v2PreviewRequested && user?.role === 'ADMIN'

  const [selectedId, setSelectedId] = React.useState('')
  const { data: station } = useStation(selectedId)
  // v2 preview never reads or writes a real draft (getTemplateForAudit skips the draft lookup
  // server-side too when previewing — see checklists.service.ts) — and the /draft endpoint is
  // AUDITOR-only, so an ADMIN previewing v2 would otherwise get a needless 403 on every station
  // pick. Passing '' disables the query via its existing `enabled: !!stationId` guard.
  const { data: draft, isLoading: draftLoading } = useMyDraft(v2PreviewAllowed ? '' : selectedId)
  const { data: templateResp, isLoading: templateLoading } = useTemplateForAudit(selectedId, v2PreviewAllowed)
  const saveDraftMutation = useSaveDraft(selectedId)
  const submitMutation = useSubmitChecklist(selectedId)
  const updateYearBuiltMutation = useUpdateYearBuilt()

  const [submitResult, setSubmitResult] = React.useState<ChecklistRecord | null>(null)
  const [submitWarning, setSubmitWarning] = React.useState('')
  const [locating, setLocating] = React.useState(false)
  const [currentPage, setCurrentPage] = React.useState(0)

  // ── Check-in gate (Screen B) — confirm-to-start + GPS capture + year-built capture ──
  const [checkedIn, setCheckedIn] = React.useState(false)
  const [checkInStatus, setCheckInStatus] = React.useState<'idle' | 'checking' | 'blocked' | 'ok'>('idle')
  const [checkInMessage, setCheckInMessage] = React.useState('')
  const [locationUnverified, setLocationUnverified] = React.useState(false)
  const [rejectionBannerDismissed, setRejectionBannerDismissed] = React.useState(false)
  const [yearBuiltInput, setYearBuiltInput] = React.useState('')

  // Part D — Zustand audit-form store: single source of truth for answers/finalThoughts once
  // hydrated. Server data hydrates it ONCE per (station, preview-mode) via the guard below;
  // background refetches of the queries above never re-hydrate (both are refetchOnWindowFocus:
  // false, staleTime: Infinity — see hooks/use-checklists.ts).
  const templateDef = useAuditFormStore((s) => s.templateDef)
  const answers = useAuditFormStore((s) => s.answers)
  const finalThoughts = useAuditFormStore((s) => s.finalThoughts)
  const dirty = useAuditFormStore((s) => s.dirty)
  const hydrated = useAuditFormStore((s) => s.hydrated)
  const resumedFromDraft = useAuditFormStore((s) => s.resumedFromDraft)
  const eraUnresolved = useAuditFormStore((s) => s.eraUnresolved)
  const saveStatus = useAuditFormStore((s) => s.saveStatus)
  const hydrate = useAuditFormStore((s) => s.hydrate)
  const setFinalThoughts = useAuditFormStore((s) => s.setFinalThoughts)
  const setSaveStatus = useAuditFormStore((s) => s.setSaveStatus)
  const markSaved = useAuditFormStore((s) => s.markSaved)
  const resetForm = useAuditFormStore((s) => s.reset)

  const seededForRef = React.useRef<string | null>(null)
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset all form + check-in state when the selected station changes
  React.useEffect(() => {
    seededForRef.current = null
    setCurrentPage(0)
    setSubmitResult(null)
    setSubmitWarning('')
    setCheckedIn(false)
    setCheckInStatus('idle')
    setCheckInMessage('')
    setLocationUnverified(false)
    setRejectionBannerDismissed(false)
    setYearBuiltInput('')
    resetForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station?.id])

  // Hydrate the store exactly once per (station, template-mode load) — never on a background
  // refetch of the same data (Part D P0 fix #1: tab-switch reset).
  React.useEffect(() => {
    if (!station || draftLoading || templateLoading || !templateResp?.template) return
    const key = `${station.id}:${v2PreviewAllowed}`
    if (seededForRef.current === key) return
    seededForRef.current = key
    hydrate({
      stationId: station.id,
      templateDef: templateResp.template,
      storedItems: draft?.items ?? null,
      finalThoughts: draft?.finalThoughts ?? '',
      yearBuilt: templateResp.appliedYearBuilt,
      eraUnresolved: templateResp.eraUnresolved,
      resumedFromDraft: !!(draft?.items && (draft.items as unknown[]).length > 0),
    })
    setYearBuiltInput(station.yearBuilt != null ? String(station.yearBuilt) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station, draftLoading, templateLoading, draft, templateResp, v2PreviewAllowed])

  // Debounced autosave — fires AUTOSAVE_DEBOUNCE_MS after the last edit, once checked in and
  // dirty. Skipped entirely in v2 preview (v2 is not activated — nothing to persist for real).
  React.useEffect(() => {
    if (!selectedId || !hydrated || !dirty || !checkedIn || v2PreviewAllowed || !templateDef) return

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        await saveDraftMutation.mutateAsync({ items: buildStoredGroups(templateDef, answers), finalThoughts })
        markSaved()
      } catch {
        setSaveStatus('error')
      }
    }, AUTOSAVE_DEBOUNCE_MS)

    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answers, finalThoughts, dirty, selectedId, checkedIn, hydrated, v2PreviewAllowed])

  const score = templateDef ? computeScoreFromItems(buildStoredGroups(templateDef, answers), templateDef) : 0
  const { answered, total } = templateDef ? countProgressForNodes(templateDef.groups.flatMap((g) => g.items), answers) : { answered: 0, total: 0 }
  const progress = total > 0 ? Math.round((answered / total) * 100) : 0
  const isV1 = templateDef?.schemaVersion === 1

  async function saveYearBuilt(): Promise<void> {
    if (!station || v2PreviewAllowed) return
    const n = Number(yearBuiltInput)
    if (!yearBuiltInput || Number.isNaN(n) || n < YEAR_BUILT_MIN || n > yearBuiltMax()) return
    if (station.yearBuilt === n) return
    await updateYearBuiltMutation.mutateAsync({ id: station.id, yearBuilt: n })
  }

  // ── Check-in (Screen B "เริ่มการตรวจประเมิน") — client-side pre-check only. The
  // authoritative gate is always the server, re-checked again at submit time. ──
  async function handleCheckIn() {
    if (!station) return
    setCheckInStatus('checking')
    setCheckInMessage('')
    await saveYearBuilt()

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
    if (!station || !templateDef) return
    setSubmitWarning('')
    const items = buildStoredGroups(templateDef, answers)

    let gps: SubmitGps | undefined
    if (!PROXIMITY_BYPASS) {
      setLocating(true)
      const pos = await getCurrentPosition()
      setLocating(false)
      if (pos.status === 'ok') gps = { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy }
    }

    try {
      const result = await submitMutation.mutateAsync({ items, score, gps, finalThoughts })
      setSubmitResult(result)
    } catch (err) {
      const code = err instanceof ApiError ? err.code : undefined
      if (code === 'OUT_OF_RANGE' || code === 'LOCATION_REQUIRED') {
        await saveDraftMutation.mutateAsync({ items, finalThoughts })
        setSubmitWarning(
          (err instanceof ApiError ? err.message : null) ??
            'ไม่สามารถส่งรายงานได้ งานของคุณถูกบันทึกเป็นร่างแล้ว กรุณาลองส่งใหม่เมื่อถึงพื้นที่สถานี'
        )
      } else {
        setSubmitWarning(err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการส่งรายงาน')
      }
    }
  }

  const stationPicker = (
    <StationSearchPicker
      value={selectedId}
      selectedStation={station}
      onSelect={setSelectedId}
    />
  )

  if (!selectedId || !station || draftLoading || templateLoading) {
    return (
      <div className="space-y-4">
        {stationPicker}
        <div className="rounded-xl bg-white p-6 text-center text-sm text-muted-foreground shadow-sm">
          {!selectedId ? 'กรุณาเลือกสถานีเพื่อเริ่มการตรวจสอบ' : 'กำลังโหลด…'}
        </div>
      </div>
    )
  }

  if (!templateDef) {
    return (
      <div className="space-y-4">
        {stationPicker}
        <div className="rounded-xl bg-white p-6 text-center text-sm text-muted-foreground shadow-sm">
          ยังไม่มีแบบฟอร์มตรวจสอบสำหรับประเภทสถานีนี้ กรุณาติดต่อผู้ดูแลระบบ
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
    const rejectionNote = !rejectionBannerDismissed && draft?.reviewNotes ? draft.reviewNotes : null
    return (
      <div className="space-y-4">
        {stationPicker}

        {v2PreviewAllowed && (
          <div className="flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 p-3 text-xs text-purple-700 shadow-sm">
            <FlaskConical size={14} className="shrink-0" />
            <span>โหมดตัวอย่าง v2 (DRAFT) — สำหรับผู้ดูแลระบบเท่านั้น ไม่มีการบันทึกจริง</span>
          </div>
        )}

        {rejectionNote && (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3.5 text-xs text-red-700 shadow-sm">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold">รายงานถูกปฏิเสธ — กรุณาแก้ไขแล้วส่งใหม่</p>
              <p className="mt-1">{rejectionNote}</p>
            </div>
            <button
              onClick={() => setRejectionBannerDismissed(true)}
              className="shrink-0 text-red-400 hover:text-red-600"
            >
              <X size={14} />
            </button>
          </div>
        )}

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

          {/* Part C.6 — year-built capture, required at confirm-to-start */}
          <div className="border-t border-border pt-4">
            <label className="text-xs font-medium text-foreground">
              ปีที่ก่อสร้าง (พ.ศ.)
              <input
                type="number"
                inputMode="numeric"
                value={yearBuiltInput}
                onChange={(e) => setYearBuiltInput(e.target.value)}
                onBlur={saveYearBuilt}
                disabled={v2PreviewAllowed}
                placeholder="เช่น 2555"
                className="border-border focus:ring-ring mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 disabled:opacity-50"
              />
            </label>
            {eraUnresolved && (
              <p className="mt-1.5 text-[10px] text-amber-600">
                ⚠ ยังไม่สามารถระบุปีก่อสร้างที่แน่ชัดได้ — ระบบใช้เกณฑ์ตามกฎหมายฉบับล่าสุดเป็นการชั่วคราว
              </p>
            )}
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

  const groups = templateDef.groups
  // v2's pager is one level deeper than v1's: v1 paginates group-by-group; v2 paginates
  // item-by-item within a group (A1 → A1.1, A1.2, …), continuing seamlessly into the next
  // group's first item — see V2PagerForm.tsx for what renders inside one item's page.
  const v2Pages = isV1 ? [] : groups.flatMap((g) => g.items.map((item) => ({ group: g, item })))
  const totalPages = isV1 ? groups.length : v2Pages.length
  const isSummaryPage = currentPage === totalPages

  return (
    <div className="space-y-4">
      {stationPicker}

      {v2PreviewAllowed && (
        <div className="flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 p-3 text-xs text-purple-700 shadow-sm">
          <FlaskConical size={14} className="shrink-0" />
          <span>โหมดตัวอย่าง v2 (DRAFT) — สำหรับผู้ดูแลระบบเท่านั้น ไม่มีการบันทึกจริง</span>
        </div>
      )}

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
          <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-2 flex items-center gap-3">
          {resumedFromDraft && (
            <p className="text-[10px] text-muted-foreground">↩ ดำเนินการต่อจากร่างที่บันทึกไว้</p>
          )}
          {saveStatus === 'saving' && <p className="text-[10px] text-muted-foreground">กำลังบันทึก…</p>}
          {saveStatus === 'saved' && <p className="text-[10px] text-accent">✓ บันทึกอัตโนมัติแล้ว</p>}
          {saveStatus === 'error' && <p className="text-[10px] text-red-500">บันทึกอัตโนมัติไม่สำเร็จ</p>}
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

      {isSummaryPage ? (
        /* Summary page — shared between v1 and v2 (per-group progress list is mode-agnostic) */
        <div className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <p className="text-sm font-bold text-gray-900">สรุปผลการตรวจสอบ</p>
            <p className="mt-0.5 text-xs text-gray-500">ตรวจสอบความครบถ้วนก่อนส่งรายงาน</p>
          </div>
          <div className="divide-y">
            {groups.map((g) => {
              const p = countProgressForNodes(g.items, answers)
              const done = p.answered === p.total
              return (
                <div key={g.code} className="flex items-center justify-between px-4 py-3">
                  <span className="text-sm text-gray-800">{groupDisplayName(g)}</span>
                  <span className={`text-xs font-semibold ${done ? 'text-green-600' : 'text-amber-600'}`}>
                    {p.answered}/{p.total} {done ? '✓' : '⚠'}
                  </span>
                </div>
              )
            })}
          </div>
          {isV1 && (
            <>
              {/* Part C.7 — final thoughts, before the submit action */}
              <div className="border-t px-4 py-4">
                <label className="text-xs font-semibold text-gray-700">
                  ความคิดเห็นเพิ่มเติม
                  <textarea
                    value={finalThoughts}
                    onChange={(e) => setFinalThoughts(e.target.value.slice(0, FINAL_THOUGHTS_MAX))}
                    rows={3}
                    placeholder="สรุปข้อสังเกตหรือข้อเสนอแนะเพิ่มเติม (ถ้ามี)"
                    className="border-border placeholder:text-muted-foreground focus:ring-ring mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1"
                  />
                </label>
                <p className="mt-1 text-right text-[10px] text-muted-foreground">{finalThoughts.length}/{FINAL_THOUGHTS_MAX}</p>
              </div>
              <div className="border-t px-4 py-4 space-y-3">
                <p className="text-sm text-gray-500">
                  คะแนน UD (ประมาณ): <span className="font-bold text-gray-900">{score}%</span>
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
                  <p className="text-center text-xs text-amber-600">ยังมีรายการที่ยังไม่ได้ตอบ ({total - answered} ข้อ)</p>
                )}
              </div>
            </>
          )}
          {!isV1 && (
            <p className="px-4 py-4 text-center text-xs text-purple-600">
              โหมดตัวอย่าง v2 — ไม่สามารถส่งรายงานจริงได้ในขั้นตอนนี้
            </p>
          )}
        </div>
      ) : isV1 ? (
        /* v1 — Group checklist page (flat pager, byte-for-byte the same interaction as before —
           see LeafAnswerRow for the shared control implementation) */
        (() => {
          const group = groups[currentPage]!  // ponytail: safe — currentPage < groups.length guaranteed above
          return (
            <div className="overflow-hidden rounded-xl bg-white shadow-sm">
              <div className="flex items-center justify-between border-b px-4 py-3">
                <span className="text-sm font-semibold text-gray-700">{groupDisplayName(group)}</span>
                <span className="text-xs text-gray-400">หน้า {currentPage + 1} / {groups.length}</span>
              </div>
              <div className="divide-border divide-y">
                {group.items.map((item) => <LeafAnswerRow key={item.code} node={item} />)}
              </div>
            </div>
          )
        })()
      ) : (
        /* v2 — item-level pager: (A1) ที่จอดรถ paginates to A1.1, then A1.2, and so on */
        (() => {
          const page = v2Pages[currentPage]!  // ponytail: safe — currentPage < v2Pages.length guaranteed above
          const p = countProgressForNodes([page.item], answers)
          return (
            <div className="overflow-hidden rounded-xl bg-white shadow-sm">
              <div className="border-b px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-700">{groupDisplayName(page.group)}</span>
                  <span className="text-xs text-gray-400">รายการ {currentPage + 1} / {v2Pages.length}</span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {page.item.num ? `${page.item.num}. ` : ''}{page.item.labelTh}
                  <span className="ml-1.5">({p.answered}/{p.total})</span>
                </p>
              </div>
              <V2ItemPage item={page.item} groupLabel={groupDisplayName(page.group)} />
            </div>
          )
        })()
      )}

      {/* Navigation — prev/next apply to both v1 and v2's pager; save-draft is v1-only (v2
          preview never persists — see the autosave effect's v2PreviewAllowed guard above). */}
      <div className="flex gap-3 pb-6">
        {currentPage > 0 && (
          <button
            onClick={() => setCurrentPage((p) => p - 1)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-white px-4 py-3 text-sm font-medium text-foreground shadow-sm"
          >
            ← ก่อนหน้า
          </button>
        )}
        {isV1 && (
          <button
            onClick={() => saveDraftMutation.mutate({ items: buildStoredGroups(templateDef, answers), finalThoughts })}
            disabled={saveDraftMutation.isPending}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-border bg-white py-3 text-sm font-medium text-foreground shadow-sm disabled:opacity-50"
          >
            <Save size={15} />
            {saveDraftMutation.isPending ? 'กำลังบันทึก…' : 'บันทึกร่าง'}
          </button>
        )}
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
