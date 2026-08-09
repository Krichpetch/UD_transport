'use client'

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import { getStationTypeLabel, CHECKLIST_CATEGORIES } from '@/lib/constants'
import { useStation } from '@/hooks/use-stations'
import { useSaveDraft, useSubmitChecklist, useMyDraft, useTemplateForAudit } from '@/hooks/use-checklists'
import { restampDraftEra } from '@/lib/api/checklists'
import { useUpdateYearBuilt } from '@/hooks/use-stations'
import { computeScoreFromItems, buildHistogram, scoreToStatus } from '@repo/types'
import {
  MapPin, Save, Send, Clock, User as UserIcon,
  AlertTriangle, Loader2, X, FlaskConical, ChevronDown, ClipboardList, GraduationCap,
} from 'lucide-react'
import Link from 'next/link'
import { MonthYearBuiltInput } from '@/components/shared/MonthYearBuiltInput'
import { StationSearchPicker } from '@/components/audit/StationSearchPicker'
import { TutorialSection } from '@/components/audit/TutorialSection'
import { LeafAnswerRow } from '@/components/audit/LeafAnswerRow'
import { V2ItemPage } from '@/components/audit/V2PagerForm'
import { PageNavigatorTrigger, type NavigatorPage } from '@/components/audit/PageNavigator'
import { useAuthStore } from '@/stores/auth.store'
import { useAuditFormStore } from '@/stores/audit-form.store'
import { buildStoredGroups, countProgress, countProgressForNodes, groupDisplayName, collectRedactedLeaves, isNodeFullyRedacted } from '@/lib/audit-form'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { ApiError } from '@/lib/api'
import { getCurrentPosition, haversineMeters, PROXIMITY_BYPASS } from '@/lib/geolocation'
import type { SubmitGps } from '@/lib/geolocation'
import type { ChecklistRecord } from '@/lib/api/checklists'
import { YEAR_BUILT_MIN, yearBuiltMax, eraYearBrackets, buddhistYearOfIsoDate, type TemplateNode, type ChecklistTemplateGroupDef } from '@repo/types'

const PROXIMITY_RADIUS_M = 1000
const AUTOSAVE_DEBOUNCE_MS = 4000
const FINAL_THOUGHTS_MAX = 4000

// Session F1, Part E — a compact link banner, superseding the old inline "งานที่ถูกตีกลับ" list
// (E3, Part B.1) on the auditor home: /audit/my-work now covers the full picture (all statuses),
// so this just points there instead of duplicating the same rejected-work data in a second place.
function MyWorkLink() {
  return (
    <Link
      href="/audit/my-work"
      className="flex items-center justify-between gap-2 rounded-xl border border-border bg-white px-4 py-3 shadow-sm transition-colors hover:bg-secondary/60"
    >
      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
        <ClipboardList size={15} className="text-accent" /> งานของฉัน
      </span>
      <span className="text-xs text-muted-foreground">ดูทั้งหมด →</span>
    </Link>
  )
}

// Session F1 follow-up — admin preview-only build-ERA picker: a free-text year box made it too
// easy to type a year that lands in the wrong bracket without realizing it (the four real
// กฎกระทรวง boundaries — 2548/2555/2556/2564 — aren't obvious numbers to remember). This selects
// by NAMED era bracket instead (eraYearBrackets, derived once from the real law registry, never
// hand-maintained here), so the admin picks "ก่อน พ.ศ. 2548" or "พ.ศ. 2564 เป็นต้นไป" directly and
// sees exactly which items redact for that era — the underlying mechanism (yearBuiltOverride to
// getTemplateForAudit) is unchanged, this only changes how the admin supplies the year.
const ERA_BRACKETS = eraYearBrackets()

// 2026-08-05 — `value`/`onChange` operate on the bracket's INDEX, not its representativeYear:
// PSD_2555 and MOT_2556 are now two distinct brackets sharing the same พ.ศ. 2556 (only their exact
// effectiveDate tells them apart, see eraYearBrackets), so representativeYear alone can no longer
// uniquely identify a <select> option.
function PreviewYearControl({ value, onChange, appliedYearBuilt }: {
  value: number | undefined
  onChange: (index: number) => void
  appliedYearBuilt: number | null
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 p-3 text-xs text-purple-700 shadow-sm">
      <FlaskConical size={14} className="shrink-0" />
      <label className="flex flex-1 items-center gap-2">
        <span className="shrink-0">ยุคกฎหมาย (ทดสอบ):</span>
        <select
          value={value ?? ''}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 rounded-lg border border-purple-200 bg-white px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-purple-300"
        >
          {ERA_BRACKETS.map((b, i) => (
            <option key={`${b.representativeYear}-${b.representativeDate ?? ''}`} value={i}>{b.label}</option>
          ))}
        </select>
      </label>
      {appliedYearBuilt != null && (
        <span className="shrink-0 text-[10px] text-purple-600">ใช้จริง: พ.ศ. {appliedYearBuilt}</span>
      )}
    </div>
  )
}

// Session F1 follow-up — an always-visible redaction summary for the admin preview, next to the
// year picker itself. Without this, the ONLY place a redacted item ever showed up was
// RedactedFooter on the summary page (the LAST page of the pager) — real, but easy to miss
// entirely if an admin is just paging through item screens without reaching the end, which is
// exactly the case that prompted this. Same data as RedactedFooter (collectRedactedLeaves), just
// surfaced immediately whenever the year picker changes, not gated behind reaching the summary.
function PreviewRedactionSummary({ groups }: { groups: ChecklistTemplateGroupDef[] }) {
  const [open, setOpen] = React.useState(false)
  const byGroup = groups
    .map((g) => ({ group: g, redacted: collectRedactedLeaves(g.items) }))
    .filter((g) => g.redacted.length > 0)
  const total = byGroup.reduce((sum, g) => sum + g.redacted.length, 0)

  if (total === 0) {
    return (
      <div className="rounded-xl border border-purple-200 bg-purple-50 px-3 py-2 text-[11px] text-purple-700 shadow-sm">
        ไม่มีรายการที่ถูกซ่อนสำหรับปีที่เลือกนี้ — ทุกรายการเข้าข่ายตามกฎหมาย
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-purple-200 bg-purple-50 shadow-sm">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-[11px] font-semibold text-purple-700"
      >
        <span>รายการที่ถูกซ่อนตามปีที่เลือก ({total} รายการ)</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="divide-y divide-purple-100 border-t border-purple-100">
          {byGroup.map(({ group, redacted }) => (
            <div key={group.code} className="px-3 py-2">
              <p className="text-[10px] font-semibold text-purple-600">{group.labelTh} ({redacted.length})</p>
              <ul className="mt-1 space-y-0.5">
                {redacted.map((it) => (
                  <li key={it.code} className="text-[11px] text-purple-700">
                    <span className="font-mono">{it.code}</span> {it.labelTh}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Session F1, Part C.3 — collapsed, read-only footer note for a group's era-redacted items
// ("รายการที่ไม่เข้าข่ายตามกฎหมายที่ใช้บังคับ (N รายการ)"). Expandable to see which items, never
// answerable from here — this is the ONLY place a redacted leaf is ever shown to the auditor.
function RedactedFooter({ items }: { items: TemplateNode[] }) {
  const [open, setOpen] = React.useState(false)
  return (
    <div className="border-t border-border bg-secondary/30 px-4 py-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-[11px] text-muted-foreground"
      >
        <span>รายการที่ไม่เข้าข่ายตามกฎหมายที่ใช้บังคับ ({items.length} รายการ)</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul className="mt-1.5 space-y-1">
          {items.map((it) => (
            <li key={it.code} className="text-[11px] text-muted-foreground">
              <span className="font-mono">{it.code}</span> {it.labelTh}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Session S3b, Part A.5 — informational-only banner while working a tutorial station; the
// E-form/answering flow underneath is completely unchanged. Server-side, this is
// Station.isTraining (never trust a client flag) — see ChecklistsService.submit's isTraining
// branch for the actual proximity-skip/auto-finalize behavior this banner is just describing.
function TrainingBanner() {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/10 p-3 text-xs text-accent shadow-sm">
      <GraduationCap size={14} className="shrink-0" />
      <span>โหมดฝึกหัด — ไม่นับรวมในผลการตรวจสอบจริง ทำซ้ำได้ไม่จำกัด</span>
    </div>
  )
}

export default function AuditPage() {
  const user = useAuthStore((s) => s.user)
  const searchParams = useSearchParams()
  // Part B.2 / Session E4 — preview is admin-only and gated behind an explicit query flag; the
  // server additionally 403s a non-admin caller, so this client-side check is UX only, not the
  // guard. Same flag name/value ("preview=1") as the underlying API call (lib/api/checklists.ts)
  // — deliberately kept identical end-to-end so there is only one spelling to remember or type.
  // `version=<n>` (the admin station-list "preview" button) pins a specific template version
  // (e.g. an un-activated DRAFT) instead of whatever is currently ACTIVE; either param implies
  // preview mode.
  const versionParam = searchParams.get('version')
  const previewVersion = versionParam != null && /^\d+$/.test(versionParam) ? Number(versionParam) : undefined
  const previewRequested = searchParams.get('preview') === '1' || previewVersion != null
  const v2PreviewAllowed = previewRequested && user?.role === 'ADMIN'
  // Deep-link support for the admin station-list preview button (`/audit?preview=1&station=<id>`)
  // — pre-selects the station so the admin never has to re-pick it via StationSearchPicker.
  const stationParam = searchParams.get('station')
  const [selectedId, setSelectedId] = React.useState(stationParam ?? '')
  const { data: station } = useStation(selectedId)
  // Session F1 follow-up — admin preview-only build-ERA override, so an admin can pick a named
  // era bracket (see ERA_BRACKETS/PreviewYearControl above) and see era redaction/value resolution
  // react live, without touching the real station's yearBuilt. Seeded to whichever bracket the
  // station's own real yearBuilt falls into (see the seed effect below), never persisted anywhere.
  //
  // 2026-08-05 — tracks the bracket INDEX (not representativeYear directly): two brackets can now
  // share a พ.ศ. year (PSD_2555 vs MOT_2556, both 2556), distinguished only by representativeDate.
  const [previewBracketIndex, setPreviewBracketIndex] = React.useState<number | undefined>(undefined)
  const previewYearSeededForRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!v2PreviewAllowed || !station || previewYearSeededForRef.current === station.id) return
    previewYearSeededForRef.current = station.id
    // Same "latest bracket whose year <= yearBuilt" rule resolveEra itself uses — picks the
    // bracket the station's real year would actually resolve into, not just the nearest one.
    const yb = station.yearBuilt
    const matchedIndex = yb != null
      ? [...ERA_BRACKETS].map((b, i) => ({ b, i })).reverse().find(({ b }) => b.representativeYear <= yb)?.i
      : undefined
    setPreviewBracketIndex(matchedIndex ?? ERA_BRACKETS.length - 1)
  }, [v2PreviewAllowed, station])
  const previewBracket = previewBracketIndex != null ? ERA_BRACKETS[previewBracketIndex] : undefined
  const previewYearBuiltOverride = v2PreviewAllowed ? previewBracket?.representativeYear : undefined
  const previewBuildDateOverride = v2PreviewAllowed ? previewBracket?.representativeDate : undefined
  // v2 preview never reads or writes a real draft (getTemplateForAudit skips the draft lookup
  // server-side too when previewing — see checklists.service.ts) — and the /draft endpoint is
  // AUDITOR-only, so an ADMIN previewing v2 would otherwise get a needless 403 on every station
  // pick. Passing '' disables the query via its existing `enabled: !!stationId` guard.
  const { data: draft, isLoading: draftLoading } = useMyDraft(v2PreviewAllowed ? '' : selectedId)
  const { data: templateResp, isLoading: templateLoading } = useTemplateForAudit(selectedId, v2PreviewAllowed, previewVersion, previewYearBuiltOverride, previewBuildDateOverride)
  const saveDraftMutation = useSaveDraft(selectedId)
  const submitMutation = useSubmitChecklist(selectedId)
  const updateYearBuiltMutation = useUpdateYearBuilt()

  const [submitResult, setSubmitResult] = React.useState<ChecklistRecord | null>(null)
  const [submitWarning, setSubmitWarning] = React.useState('')
  const [locating, setLocating] = React.useState(false)
  const [currentPage, setCurrentPage] = React.useState(0)

  // ── Check-in gate (Screen B) — confirm-to-start + GPS capture + year-built capture ──
  const [checkedIn, setCheckedIn] = React.useState(false)
  // Session F3, Part H.1/H.4 — the GPS reading that PASSED check-in, held so the first draft save
  // (the call that actually creates the checklist row, and therefore the one the server gates)
  // carries it. A ref, not state: it must not re-trigger the autosave effect, and it is read
  // inside a timeout callback where a stale closure over state would be wrong.
  const checkInGpsRef = React.useRef<SubmitGps | undefined>(undefined)
  const [checkInStatus, setCheckInStatus] = React.useState<'idle' | 'checking' | 'blocked' | 'ok'>('idle')
  const [checkInMessage, setCheckInMessage] = React.useState('')
  // Session E3, Part E — holds the specific reason, not just a boolean: an APPROXIMATE station
  // gets "พิกัดสถานีอยู่ระหว่างการยืนยัน" (the STATION's coordinate isn't confirmed yet) rather
  // than a message implying the AUDITOR's own GPS reading is what's in doubt.
  const [locationUnverifiedMessage, setLocationUnverifiedMessage] = React.useState('')
  const [rejectionBannerDismissed, setRejectionBannerDismissed] = React.useState(false)
  // 2026-08-06 — the ONLY year-built capture control now (a separate year-only field used to sit
  // alongside this and derive/disable against it — confusing, since both looked editable at a
  // glance; removed). MonthYearBuiltInput ("YYYY-MM", Gregorian) is the sole source of truth;
  // yearBuilt itself is always derived from it, never typed separately — see saveYearBuilt below.
  const [yearBuiltDateInput, setYearBuiltDateInput] = React.useState('')

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
  const setChecklistId = useAuditFormStore((s) => s.setChecklistId)
  const setFinalThoughts = useAuditFormStore((s) => s.setFinalThoughts)
  const setSaveStatus = useAuditFormStore((s) => s.setSaveStatus)
  const markSaved = useAuditFormStore((s) => s.markSaved)
  const resetForm = useAuditFormStore((s) => s.reset)

  const seededForRef = React.useRef<string | null>(null)
  const autoSaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  // 2026-08-06 — changing the construction month/year on a station with existing progress now
  // reloads the era-resolved template instead of silently keeping the one resolved for the OLD
  // year (the actual bug behind the "only pre-2556 items showing" report). `carryOverRef` stashes
  // the CURRENT in-session answers right before the reload, keyed for hydrateAnswers to re-project
  // onto the newly-resolved tree by leaf code — an item whose code no longer exists there (redacted
  // under the new year) silently loses its answer, exactly the "not completely transported"
  // behavior the confirm dialog below warns about. Consumed once by the hydrate effect, then
  // cleared, so a later NORMAL reload (e.g. switching stations) falls back to the real draft.
  const carryOverRef = React.useRef<{ items: ReturnType<typeof buildStoredGroups>; finalThoughts: string } | null>(null)
  const [pendingYearChange, setPendingYearChange] = React.useState<{ next: string; previous: string } | null>(null)

  // Reset all form + check-in state when the selected station changes
  React.useEffect(() => {
    seededForRef.current = null
    setCurrentPage(0)
    setSubmitResult(null)
    setSubmitWarning('')
    setCheckedIn(false)
    setCheckInStatus('idle')
    setCheckInMessage('')
    // Part H — a reading only ever proves presence at the station it was taken for.
    checkInGpsRef.current = undefined
    setLocationUnverifiedMessage('')
    setRejectionBannerDismissed(false)
    setYearBuiltDateInput('')
    resetForm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station?.id])

  // Hydrate the store exactly once per (station, template-mode load) — never on a background
  // refetch of the same data (Part D P0 fix #1: tab-switch reset). The preview-year override is
  // included in the seed key so changing it in preview mode re-hydrates with the newly resolved
  // template (redaction/applicable flags) instead of reusing the previous year's render.
  React.useEffect(() => {
    if (!station || draftLoading || templateLoading || !templateResp?.template) return
    const key = `${station.id}:${v2PreviewAllowed}:${previewVersion ?? ''}:${previewYearBuiltOverride ?? ''}:${previewBuildDateOverride ?? ''}`
    if (seededForRef.current === key) return
    seededForRef.current = key
    // A pending carry-over (set by confirmYearChange below) wins over the real draft — it IS the
    // real draft's answers, just re-projected through buildStoredGroups so hydrateAnswers can match
    // them against the freshly-resolved tree instead of the stale one they were entered under.
    const carryOver = carryOverRef.current
    carryOverRef.current = null
    hydrate({
      stationId: station.id,
      templateDef: templateResp.template,
      storedItems: carryOver ? carryOver.items : (draft?.items ?? null),
      finalThoughts: carryOver ? carryOver.finalThoughts : (draft?.finalThoughts ?? ''),
      yearBuilt: templateResp.appliedYearBuilt,
      eraUnresolved: templateResp.eraUnresolved,
      resumedFromDraft: carryOver ? true : !!(draft?.items && (draft.items as unknown[]).length > 0),
      checklistId: draft?.id ?? null,
    })
    // yearBuiltDate arrives as a full ISO datetime (Prisma DateTime -> JSON), truncate to the
    // "YYYY-MM" value MonthYearBuiltInput expects (month/year precision only). Skipped during a
    // carry-over reload: yearBuiltDateInput already shows the auditor's just-picked value, and
    // `station` may not have finished refetching its own invalidated query yet — overwriting it
    // here risks a one-render flash back to the pre-change value.
    if (!carryOver) setYearBuiltDateInput(station.yearBuiltDate ? station.yearBuiltDate.slice(0, 7) : '')
    // A changed preview year can change v2Pages' length/order (redacted pages drop out) —
    // reset paging so currentPage never points past the end of the freshly-hydrated page set.
    setCurrentPage(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [station, draftLoading, templateLoading, draft, templateResp, v2PreviewAllowed, previewVersion, previewYearBuiltOverride, previewBuildDateOverride])

  // Debounced autosave — fires AUTOSAVE_DEBOUNCE_MS after the last edit, once checked in and
  // dirty. Skipped entirely in v2 preview (v2 is not activated — nothing to persist for real).
  React.useEffect(() => {
    if (!selectedId || !hydrated || !dirty || !checkedIn || v2PreviewAllowed || !templateDef) return

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(async () => {
      setSaveStatus('saving')
      try {
        // Part H.1 — the check-in reading rides along. On the call that CREATES the draft the
        // server uses it to run the proximity gate; on later autosaves it is ignored (updating
        // an existing draft is deliberately ungated).
        const saved = await saveDraftMutation.mutateAsync({
          items: buildStoredGroups(templateDef, answers),
          finalThoughts,
          gps: checkInGpsRef.current,
        })
        // Session E3, Part C.3 — the first autosave of a brand-new checklist is what creates its
        // DRAFT row; photo-delete needs that id to scope its request to, so the store learns it
        // here rather than staying null for the rest of this session.
        setChecklistId(saved.id)
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

  // Session F3, Part C.2 — the SUBMIT gate counts only groups the template does NOT mark
  // `optional` (สนข.: group C may be submitted incomplete). The header progress bar above still
  // reports the whole form, so an auditor always sees the true overall figure; this second tally
  // exists solely to decide whether submitting is allowed. Driven by the per-group flag stamped
  // on the template (see @repo/types#ChecklistTemplateGroupDef.optional) — never a `/^C/` test.
  const requiredProgress = templateDef
    ? countProgressForNodes(templateDef.groups.filter((g) => !g.optional).flatMap((g) => g.items), answers)
    : { answered: 0, total: 0 }
  const requiredComplete = requiredProgress.answered >= requiredProgress.total
  const requiredRemaining = requiredProgress.total - requiredProgress.answered
  const isV1 = templateDef?.schemaVersion === 1
  const previewLabel = templateResp?.templateVersion != null
    ? `โหมดตัวอย่าง — เทมเพลตเวอร์ชัน ${templateResp.templateVersion}`
    : 'โหมดตัวอย่าง'

  // 2026-08-06 — yearBuilt (Buddhist year) is always DERIVED from the month/year input now, never
  // typed separately (see the yearBuiltDateInput state doc above).
  const effectiveYearBuiltInput = yearBuiltDateInput ? String(buddhistYearOfIsoDate(yearBuiltDateInput)) : ''

  // Session F1, Part B.1 — the client-side lock: this is what actually gates the "เริ่มการตรวจ
  // ประเมิน" button (see the disabled prop below), not just a save-side no-op. The server check
  // (ChecklistsService.assertYearBuiltPresent) is the real guarantee; this is UX only.
  const yearBuiltNum = Number(effectiveYearBuiltInput)
  const yearBuiltValid = v2PreviewAllowed
    || (effectiveYearBuiltInput !== '' && !Number.isNaN(yearBuiltNum) && yearBuiltNum >= YEAR_BUILT_MIN && yearBuiltNum <= yearBuiltMax())

  // Takes the month/year value directly as a parameter rather than reading yearBuiltDateInput from
  // closure — MonthYearBuiltInput's onCommit fires in the same tick as its onChange (the state
  // update it triggers hasn't been applied by React yet), so reading state here would see the
  // PREVIOUS value, one commit behind. handleCheckIn (below) calls this with no argument once the
  // button is clicked well after any pending state update has already settled, where reading
  // current state is fine.
  async function saveYearBuilt(dateInput: string = yearBuiltDateInput): Promise<void> {
    if (!station || v2PreviewAllowed || !dateInput) return
    const n = buddhistYearOfIsoDate(dateInput)
    if (n < YEAR_BUILT_MIN || n > yearBuiltMax()) return
    // dateInput is "YYYY-MM" (month/year precision only, per the PM's 2026-08-05 ruling —
    // day-of-month was never asked for; the server ignores it anyway, see isLawInForce). Sent as
    // the 1st of the month so the existing full-date column/validation need no schema change.
    const currentMonth = station.yearBuiltDate ? station.yearBuiltDate.slice(0, 7) : ''
    if (station.yearBuilt === n && currentMonth === dateInput) return
    await updateYearBuiltMutation.mutateAsync({
      id: station.id,
      yearBuilt: n,
      yearBuiltDate: `${dateInput}-01`,
    })
  }

  // Whether there's anything a year-driven reload could actually lose. `resumedFromDraft` covers
  // the case where the template hasn't hydrated with a live answer count yet; countProgress covers
  // in-session edits since hydrate. Either being true is reason enough to ask first.
  function hasExistingProgress(): boolean {
    if (resumedFromDraft) return true
    if (!templateDef) return false
    return countProgress(templateDef, answers).answered > 0
  }

  // 2026-08-06 — MonthYearBuiltInput's onCommit target. A station with no progress yet can save
  // and reload freely (nothing to lose); one with progress prompts first, since the newly-resolved
  // template may drop items the auditor already answered (see carryOverRef's doc above).
  function handleYearBuiltCommit(dateInput: string): void {
    if (!hasExistingProgress()) {
      void saveYearBuilt(dateInput)
      return
    }
    // yearBuiltDateInput hasn't picked up onChange's update yet in this closure (same same-tick
    // staleness saveYearBuilt's own doc explains) — it's still the value from BEFORE this pick,
    // exactly what cancelYearChange needs to revert the display to.
    setPendingYearChange({ next: dateInput, previous: yearBuiltDateInput })
  }

  async function confirmYearChange(): Promise<void> {
    if (!pendingYearChange || !templateDef || !station) return
    const { next } = pendingYearChange
    carryOverRef.current = { items: buildStoredGroups(templateDef, answers), finalThoughts }
    setPendingYearChange(null)
    // Lets the hydrate effect re-run once the invalidated template query (useUpdateYearBuilt's
    // onSuccess already invalidates it) resolves with the new era's resolution — the effect's own
    // `key` never changes on a real yearBuilt edit (it's not part of the key), so without this the
    // fresh data would arrive and sit there unused, which is the actual bug this whole feature
    // exists to fix.
    seededForRef.current = null
    await saveYearBuilt(next)
    // Re-stamps an EXISTING draft's frozen appliedYearBuilt too — the reload above only changes
    // what's shown on screen; without this, submit() would still score against whichever era the
    // draft was originally created under (see restampDraftEra's doc in checklists.service.ts). A
    // no-op when there's no draft yet, since a fresh saveDraft() stamps correctly at creation.
    await restampDraftEra(station.id).catch(() => {
      // Best-effort: the reload/merge above already succeeded and is the visible, important part.
      // A failure here just means submit() would (rarely) still need a subsequent autosave tick to
      // catch up the stamp — not worth failing the whole confirm over.
    })
  }

  function cancelYearChange(): void {
    if (!pendingYearChange) return
    setYearBuiltDateInput(pendingYearChange.previous)
    setPendingYearChange(null)
  }

  // ── Check-in (Screen B "เริ่มการตรวจประเมิน") — client-side pre-check only. The
  // authoritative gate is always the server, re-checked again at submit time. ──
  async function handleCheckIn() {
    if (!station || !yearBuiltValid) return
    setCheckInStatus('checking')
    setCheckInMessage('')
    await saveYearBuilt()

    // Preview never persists anything real (see the autosave/submit guards elsewhere on this
    // page) and the admin previewing it is essentially never standing at the actual station —
    // gating check-in on GPS proximity would just strand them on this screen with no way to see
    // the form at all. Session S3b, Part A.2 — training stations skip the same way: the server
    // ignores proximity entirely for isTraining (ChecklistsService.submit), so requiring a real
    // GPS permission grant here would just block the tutorial on an unrelated device permission.
    if (PROXIMITY_BYPASS || v2PreviewAllowed || station.isTraining) {
      // No reading to carry: the server skips the gate for these cases on its own authority
      // (Station.isTraining / isProximityBypassActive()), never on anything sent from here.
      checkInGpsRef.current = undefined
      setLocationUnverifiedMessage('')
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
          `คุณอยู่นอกพื้นที่สถานี ${station.nameTh} (ห่างประมาณ ${Math.round(distance).toLocaleString()} ม.) กรุณาเข้าใกล้สถานีแล้วลองใหม่`
        )
        return
      }
      setLocationUnverifiedMessage('')
    } else {
      // Session E3, Part E.2 — APPROXIMATE means the STATION's own coordinate isn't confirmed
      // yet (centroid fallback), not that the auditor's GPS reading failed — a different message
      // than the generic "can't verify" wording, which reads as a false gate on the auditor.
      setLocationUnverifiedMessage(
        station.coordStatus === 'APPROXIMATE'
          ? 'พิกัดสถานีอยู่ระหว่างการยืนยัน'
          : 'ไม่สามารถยืนยันตำแหน่งได้ – พิกัดสถานีเป็นค่าโดยประมาณ'
      )
    }

    // Part H.1 — check-in passed, so this is the reading that proves presence at the station.
    // The server re-verifies the distance from these coordinates before creating the draft; this
    // is evidence to be checked, never a "client says it's fine" flag.
    checkInGpsRef.current = { lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy }

    setCheckInStatus('ok')
    setCheckedIn(true)
  }

  // ── Submit — no longer proximity-gated (Session F3, Part H): the gate ran at check-in/draft
  //    creation, and work started on-site may be finished and submitted from anywhere. ──
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
      // Session F3, Part H.4 — the OUT_OF_RANGE/LOCATION_REQUIRED → auto-save-as-draft branch is
      // gone: submit can no longer fail on location, so that recovery path is unreachable by
      // construction. The generic handling below is deliberately kept (and is now the only path),
      // so a network/validation/duplicate-submit failure still surfaces its real message.
      setSubmitWarning(
        (err instanceof ApiError ? err.message : null) ??
        (err instanceof Error ? err.message : null) ??
        'เกิดข้อผิดพลาดในการส่งรายงาน'
      )
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
        {!selectedId && user?.role === 'AUDITOR' && <MyWorkLink />}
        {!selectedId && user?.role === 'AUDITOR' && <TutorialSection onSelect={setSelectedId} />}
        {selectedId && (
          <div className="rounded-xl bg-white p-6 text-center text-sm text-muted-foreground shadow-sm">
            กำลังโหลด…
          </div>
        )}
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
        {station.isTraining && <TrainingBanner />}
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

        {station.isTraining && <TrainingBanner />}

        {v2PreviewAllowed && (
          <>
            <div className="flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 p-3 text-xs text-purple-700 shadow-sm">
              <FlaskConical size={14} className="shrink-0" />
              <span>{previewLabel} — สำหรับผู้ดูแลระบบเท่านั้น ไม่มีการบันทึกจริง</span>
            </div>
            <PreviewYearControl
              value={previewBracketIndex}
              onChange={setPreviewBracketIndex}
              appliedYearBuilt={templateResp?.appliedYearBuilt ?? null}
            />
            {!isV1 && templateDef && <PreviewRedactionSummary groups={templateDef.groups} />}
          </>
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
              <span className="text-foreground">{user?.displayName || user?.username || '-'}</span>
            </div>
          </div>

          {/* Part C.6 — year-built capture, required at confirm-to-start. 2026-08-06 — a separate
              year-only field used to sit here alongside this one, deriving/disabling against
              whichever was filled — confusing, since both looked editable. This is now the ONLY
              capture control; yearBuilt itself is always derived from it (see saveYearBuilt). */}
          <div className="border-t border-border pt-4">
            {/* Not a <label>: MonthYearBuiltInput renders two Select triggers (buttons, not native
                inputs), so a wrapping <label> wouldn't associate correctly with either one. */}
            <p className="text-xs font-medium text-foreground">เดือน/ปีที่ก่อสร้าง (พ.ศ.)</p>
            <MonthYearBuiltInput
              key={station.id}
              value={yearBuiltDateInput}
              onChange={setYearBuiltDateInput}
              onCommit={handleYearBuiltCommit}
              disabled={v2PreviewAllowed}
              minBuddhistYear={YEAR_BUILT_MIN}
              className="mt-1.5"
            />
            {yearBuiltDateInput && (
              <p className="mt-1 text-[10px] text-muted-foreground">= พ.ศ. {buddhistYearOfIsoDate(yearBuiltDateInput)}</p>
            )}
            {eraUnresolved && (
              <p className="mt-1.5 text-[10px] text-amber-600">
                ⚠ ยังไม่สามารถระบุปีก่อสร้างที่แน่ชัดได้ — ระบบใช้เกณฑ์ตามกฎหมายฉบับล่าสุดเป็นการชั่วคราว
              </p>
            )}
            {/* Part B.1 — inline, always-visible reason the continue action is disabled, not a
                toast fired after the fact. */}
            {!yearBuiltValid && (
              <p className="mt-1.5 text-[10px] text-red-600">
                กรุณาระบุปีที่ก่อสร้าง (พ.ศ. {YEAR_BUILT_MIN}–{yearBuiltMax()}) ก่อนเริ่มการตรวจประเมิน
              </p>
            )}
          </div>

          {/* 2026-08-06 — changing the year on a station with existing progress reloads the
              era-resolved template (see carryOverRef's doc); warn first, since some already-
              entered answers may not exist in the new form. */}
          <Dialog open={!!pendingYearChange} onOpenChange={(o) => { if (!o) cancelYearChange() }}>
            <DialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-xl p-5">
              <DialogTitle className="text-sm font-bold text-foreground">เปลี่ยนปีที่ก่อสร้าง?</DialogTitle>
              <p className="mt-2 text-xs text-muted-foreground">
                การเปลี่ยนเดือน/ปีที่ก่อสร้างจะโหลดแบบฟอร์มใหม่ตามเกณฑ์กฎหมายที่ใช้บังคับในปีนั้น
                คำตอบที่กรอกไว้แล้วจะถูกโอนมาเฉพาะรายการที่ยังคงมีอยู่ในแบบฟอร์มใหม่ —
                รายการที่ไม่มีอยู่แล้วจะไม่ถูกโอนมาและต้องตอบใหม่
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={cancelYearChange}
                  className="flex-1 rounded-lg border border-border py-2.5 text-xs font-medium text-foreground"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={() => { void confirmYearChange() }}
                  className="flex-1 rounded-lg bg-primary py-2.5 text-xs font-bold text-primary-foreground"
                >
                  ยืนยันและโหลดใหม่
                </button>
              </div>
            </DialogContent>
          </Dialog>

          {checkInStatus === 'blocked' && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{checkInMessage}</span>
            </div>
          )}

          <button
            onClick={handleCheckIn}
            disabled={checkInStatus === 'checking' || !yearBuiltValid}
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
  // Part C.3 — a top-level group item that's fully era-redacted (itself, or every descendant when
  // it's a pure container) never gets its own page; it's only visible read-only in the summary
  // page's per-group footer note below.
  const v2Pages = isV1 ? [] : groups.flatMap((g) => g.items.filter((item) => !isNodeFullyRedacted(item)).map((item) => ({ group: g, item })))
  const totalPages = isV1 ? groups.length : v2Pages.length
  const isSummaryPage = currentPage === totalPages

  // Navigator (jump-to) — one entry per page, v1 = group-level, v2 = item-level, matching each
  // pager's own granularity. Progress figures reuse the exact same countProgressForNodes tally
  // the header/summary page already use, so the navigator can never disagree with them.
  // Session S4a, Part D.2 (live-tested follow-up) — v1 groups use the exact same A1/A2/B1.../C1
  // code scheme as v3's containers (see apps/api/prisma/v1-template-groups.ts), so the same
  // leading-letter grouping applies here too — v1 is what a real auditor sees for every mode
  // except rail_metro today, so this is the navigator most auditors actually use.
  function categoryLabel(code: string): { groupKey: string; groupLabel: string } {
    const letter = code[0] ?? code
    return { groupKey: letter, groupLabel: CHECKLIST_CATEGORIES.find((c) => c.value === letter)?.label ?? letter }
  }

  const navPages: NavigatorPage[] = isV1
    ? groups.map((g) => {
        const p = countProgressForNodes(g.items, answers)
        return { code: g.code, label: groupDisplayName(g), answered: p.answered, total: p.total, ...categoryLabel(g.code) }
      })
    : v2Pages.map(({ group, item }) => {
        const p = countProgressForNodes([item], answers)
        return {
          code: item.code,
          label: item.num ? `${item.num}. ${item.labelTh}` : item.labelTh,
          sublabel: groupDisplayName(group),
          answered: p.answered,
          total: p.total,
          ...categoryLabel(group.code),
        }
      })

  return (
    <div className="space-y-4">
      {stationPicker}

      {station.isTraining && <TrainingBanner />}

      {v2PreviewAllowed && (
        <>
          <div className="flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 p-3 text-xs text-purple-700 shadow-sm">
            <FlaskConical size={14} className="shrink-0" />
            <span>{previewLabel} (DRAFT) — สำหรับผู้ดูแลระบบเท่านั้น ไม่มีการบันทึกจริง</span>
          </div>
          <PreviewYearControl
            value={previewBracketIndex}
            onChange={setPreviewBracketIndex}
            appliedYearBuilt={templateResp?.appliedYearBuilt ?? null}
          />
          {/* Always visible, unlike RedactedFooter (summary-page-only) — this is what actually
              answers "what got redacted for this year" without paging to the end. */}
          {!isV1 && <PreviewRedactionSummary groups={groups} />}
        </>
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
        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {resumedFromDraft && (
              <p className="text-[10px] text-muted-foreground">↩ ดำเนินการต่อจากร่างที่บันทึกไว้</p>
            )}
            {saveStatus === 'saving' && <p className="text-[10px] text-muted-foreground">กำลังบันทึก…</p>}
            {saveStatus === 'saved' && <p className="text-[10px] text-accent">✓ บันทึกอัตโนมัติแล้ว</p>}
            {saveStatus === 'error' && <p className="text-[10px] text-red-500">บันทึกอัตโนมัติไม่สำเร็จ</p>}
          </div>
          <PageNavigatorTrigger pages={navPages} currentPage={currentPage} onJump={setCurrentPage} />
        </div>
        {locationUnverifiedMessage && (
          <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[10px] text-amber-700">
            <AlertTriangle size={11} className="shrink-0" />
            {locationUnverifiedMessage}
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
              const redacted = isV1 ? [] : collectRedactedLeaves(g.items)
              // Part C.2 — an optional group still shows its real answered/total (the auditor
              // should see the gap), but an incomplete one is labelled "ไม่บังคับ" in a neutral
              // colour rather than the amber ⚠ that means "this is blocking your submit".
              const optional = g.optional === true
              return (
                <div key={g.code}>
                  <div className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-gray-800">{groupDisplayName(g)}</span>
                    <span
                      className={`text-xs font-semibold ${
                        done ? 'text-green-600' : optional ? 'text-gray-400' : 'text-amber-600'
                      }`}
                    >
                      {p.answered}/{p.total} {done ? '✓' : optional ? '· ไม่บังคับ' : '⚠'}
                    </span>
                  </div>
                  {/* Part C.3 — collapsed, read-only footer note; auditors cannot answer these. */}
                  {redacted.length > 0 && <RedactedFooter items={redacted} />}
                </div>
              )
            })}
          </div>
          {/* 2026-08-06 — was `isV1 && !v2PreviewAllowed`: conflated "this is v1" with "this is a
              real, submittable audit" back when v2/v3 were ALWAYS DRAFT/preview-only, so the two
              happened to mean the same thing. Once a v2/v3 template gets ACTIVATED (this session),
              they stop being the same thing — a real auditor on a real, non-preview v3 audit has
              isV1===false, so the old condition silently hid the submit button and showed the
              "preview mode, can't submit" banner below for a REAL audit. The only thing that
              should ever gate real submission is whether this genuinely IS a preview. */}
          {!v2PreviewAllowed && (
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
                  disabled={submitMutation.isPending || locating || !requiredComplete}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  {(submitMutation.isPending || locating) ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                  {locating ? 'กำลังระบุตำแหน่ง…' : submitMutation.isPending ? 'กำลังส่ง…' : 'ส่งรายงาน'}
                </button>
                {/* Part C.2 — blocks only on the REQUIRED groups. An incomplete optional group is
                    still surfaced (in the per-group list above, as "ไม่บังคับ"), just never fatal. */}
                {!requiredComplete && (
                  <p className="text-center text-xs text-amber-600">ยังมีรายการที่ยังไม่ได้ตอบ ({requiredRemaining} ข้อ)</p>
                )}
              </div>
            </>
          )}
          {v2PreviewAllowed && (
            <p className="px-4 py-4 text-center text-xs text-purple-600">
              {previewLabel} — ไม่สามารถส่งรายงานจริงได้ในขั้นตอนนี้
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

      {/* Navigation — prev/next apply to both v1 and v2's pager. 2026-08-06 — save-draft used to
          be gated `isV1` too, on the same stale "v2 is always preview, preview never persists"
          assumption the submit-button gate below had (see that fix's comment) — a real, non-preview
          v2/v3 audit had no manual save-draft button at all (autosave still ran; only the manual
          button was missing). Now gated the same correct way: only a genuine preview skips it. */}
      <div className="flex gap-3 pb-6">
        {currentPage > 0 && (
          <button
            onClick={() => setCurrentPage((p) => p - 1)}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-white px-4 py-3 text-sm font-medium text-foreground shadow-sm"
          >
            ← ก่อนหน้า
          </button>
        )}
        {!v2PreviewAllowed && (
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
            onClick={() => {
              setCurrentPage((p) => p + 1)
              // Session S4a, Part D.1 — live feedback: the pager used to stay scrolled wherever
              // the auditor left off on the PREVIOUS page, so ถัดไป could land them mid-page on
              // the next item with its first rows off-screen above the fold.
              window.scrollTo({ top: 0 })
            }}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary py-3 text-sm font-bold text-primary-foreground"
          >
            ถัดไป →
          </button>
        )}
      </div>
    </div>
  )
}
