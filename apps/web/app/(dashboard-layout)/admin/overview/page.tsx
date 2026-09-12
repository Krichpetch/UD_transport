'use client'

import * as React from 'react'
import Link from 'next/link'
import { RequireRole } from '@/components/auth/require-role'
import { useAdminOverview } from '@/hooks/use-admin'
import { useStationSummary } from '@/hooks/use-stations'
import type { AdminOverviewMetric } from '@/lib/api/admin'
import {
  ClipboardCheck,
  TrendingUp,
  RotateCcw,
  MapPin,
  Users,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react'

// Semantic accent per metric — status tokens only, never the decorative accent palette.
type Accent = 'warn' | 'fail' | 'pass' | 'neutral'

const ACCENT_CHIP: Record<Accent, string> = {
  warn: 'bg-status-warn/10 text-status-warn-foreground',
  fail: 'bg-status-fail/10 text-status-fail',
  pass: 'bg-status-pass/10 text-status-pass',
  neutral: 'bg-primary/10 text-primary',
}

const METRIC_ICONS: Record<string, LucideIcon> = {
  pendingReviews: ClipboardCheck,
  submissionsLast7Days: TrendingUp,
  rejectedAwaitingResubmission: RotateCcw,
  neverAuditedInScope: MapPin,
  approximateOrPendingCoords: CheckCircle2,
  activeAuditors7d: Users,
}

// Server labels leak dev-speak ("ACTIVE") and awkward phrasing; override by key for the UI.
const METRIC_LABELS: Record<string, string> = {
  submissionsLast7Days: 'รายงานที่ส่งใน 7 วันที่ผ่านมา',
  approximateOrPendingCoords: 'สถานีรอยืนยันพิกัด',
  activeAuditors7d: 'ผู้ตรวจที่ใช้งานใน 7 วันที่ผ่านมา',
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function IconChip({ icon: Icon, accent }: { icon: LucideIcon; accent: Accent }) {
  return (
    <div className={`rounded-lg p-1.5 ${ACCENT_CHIP[accent]}`}>
      <Icon size={14} />
    </div>
  )
}

// Whole days a submission has been waiting; drives the queue's oldest-first sort + escalation pill.
function daysWaiting(iso: string | null): number | null {
  if (!iso) return null
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

function AgingPill({ iso }: { iso: string | null }) {
  const days = daysWaiting(iso)
  if (days === null) return <span className="text-muted-foreground text-xs">—</span>
  const tone =
    days >= 7
      ? 'bg-status-fail/10 text-status-fail'
      : days >= 3
        ? 'bg-status-warn/10 text-status-warn-foreground'
        : 'bg-secondary text-muted-foreground'
  return (
    <span
      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
      title={new Date(iso as string).toLocaleDateString('th-TH')}
    >
      {days === 0 ? 'วันนี้' : `รอมา ${days} วัน`}
    </span>
  )
}

// Header count pill; hidden at zero so a cleared queue reads as done, not "0".
function QueueCount({ count, tone }: { count: number; tone: string }) {
  if (count === 0) return null
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}>{count}</span>
}

function AllClear({ label }: { label: string }) {
  return (
    <div className="text-muted-foreground flex flex-col items-center gap-2 p-8 text-xs">
      <CheckCircle2 size={22} className="text-status-pass" />
      {label}
    </div>
  )
}

export default function AdminOverviewPage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <AdminOverviewContent />
    </RequireRole>
  )
}

function AdminOverviewContent() {
  const { data, isLoading, error } = useAdminOverview()
  const { data: summary } = useStationSummary()

  if (isLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center p-16 text-base">
        กำลังโหลด…
      </div>
    )
  }
  if (error || !data) {
    return (
      <div className="flex items-center justify-center p-16 text-base text-red-500">
        เกิดข้อผิดพลาด: {(error as Error)?.message ?? 'ไม่สามารถโหลดข้อมูลได้'}
      </div>
    )
  }

  const byKey: Record<string, AdminOverviewMetric> = Object.fromEntries(
    data.metrics.map((m) => [m.key, m]),
  )
  const valueOf = (key: string) => byKey[key]?.value ?? 0
  const labelOf = (key: string) => METRIC_LABELS[key] ?? byKey[key]?.label ?? ''

  // Denominator + status split derived on the frontend from the station summary (UDT-74).
  const summaryReady = summary !== undefined
  const total = summary?.totalStations ?? 0
  const neverAudited = valueOf('neverAuditedInScope')
  const inspected = Math.max(0, total - neverAudited)
  const progressPct = total > 0 ? round1((inspected / total) * 100) : 0
  const neverPct = total > 0 ? round1((neverAudited / total) * 100) : 0

  const dash = (n: number) => (summaryReady ? n.toLocaleString() : '…')
  const barPct = (n: number) => (total > 0 ? (n / total) * 100 : 0)

  const overviewKeys = ['submissionsLast7Days', 'approximateOrPendingCoords', 'activeAuditors7d']

  // Oldest-waiting first so the most overdue review sits at the top of the queue; nulls last.
  const pendingSorted = [...data.pendingReviewsList].sort(
    (a, b) =>
      (a.submittedAt ? new Date(a.submittedAt).getTime() : Infinity) -
      (b.submittedAt ? new Date(b.submittedAt).getTime() : Infinity),
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-foreground text-xl font-bold">ภาพรวมงานผู้ดูแลระบบ</h1>
        <p className="text-muted-foreground text-base">สรุปงานที่ต้องดำเนินการและสถานะข้อมูลสถานี</p>
      </div>

      {/* ต้องดำเนินการ — the actionable band, given the most visual weight. */}
      <section className="bg-card border-border rounded-xl border p-5">
        <div className="mb-4 flex items-center gap-2">
          <AlertTriangle size={16} className="text-status-warn-foreground" />
          <h2 className="text-foreground text-base font-semibold">ต้องดำเนินการ</h2>
        </div>
        <div className="divide-border grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="flex flex-col gap-1 py-4 first:pt-0 last:pb-0 sm:px-5 sm:py-0 sm:first:pl-0 sm:last:pr-0">
            <div className="flex items-center gap-2">
              <IconChip icon={ClipboardCheck} accent="warn" />
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                รอการอนุมัติ
              </p>
            </div>
            <p className="text-foreground text-3xl font-bold">
              {valueOf('pendingReviews').toLocaleString()}
            </p>
            {valueOf('pendingReviews') > 0 ? (
              <a
                href="#pending-queue"
                className="text-accent inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                ตรวจสอบ <ArrowRight size={13} />
              </a>
            ) : (
              <p className="text-muted-foreground text-xs">ไม่มีรายการ</p>
            )}
          </div>

          <div className="flex flex-col gap-1 py-4 first:pt-0 last:pb-0 sm:px-5 sm:py-0 sm:first:pl-0 sm:last:pr-0">
            <div className="flex items-center gap-2">
              <IconChip icon={RotateCcw} accent="fail" />
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                รายงานที่ถูกปฏิเสธ
              </p>
            </div>
            <p className="text-foreground text-3xl font-bold">
              {valueOf('rejectedAwaitingResubmission').toLocaleString()}
            </p>
            {valueOf('rejectedAwaitingResubmission') > 0 ? (
              <a
                href="#rejected-queue"
                className="text-accent inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                ดูรายการ <ArrowRight size={13} />
              </a>
            ) : (
              <p className="text-muted-foreground text-xs">ไม่มีรายการ</p>
            )}
          </div>

          <div className="flex flex-col gap-1 py-4 first:pt-0 last:pb-0 sm:px-5 sm:py-0 sm:first:pl-0 sm:last:pr-0">
            <div className="flex items-center gap-2">
              <IconChip icon={MapPin} accent="neutral" />
              <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                สถานีที่ยังไม่เคยตรวจ
              </p>
            </div>
            <p className="text-foreground text-3xl font-bold">{neverAudited.toLocaleString()}</p>
            <p className="text-muted-foreground text-xs">
              {summaryReady ? `${neverAudited.toLocaleString()} / ${total.toLocaleString()} · ${neverPct}% ของทั้งหมด` : '…'}
            </p>
          </div>
        </div>
      </section>

      {/* Progress + status breakdown, both derived from the station summary. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-card border-border rounded-xl border p-5">
          <h2 className="text-foreground mb-4 text-base font-semibold">ความคืบหน้าการตรวจประเมิน</h2>
          <p className="text-foreground text-3xl font-bold">
            {dash(inspected)} <span className="text-muted-foreground text-lg font-normal">/ {dash(total)}</span>
          </p>
          <p className="text-muted-foreground mb-3 text-xs">สถานีที่ตรวจแล้ว</p>
          <div className="bg-secondary h-2 w-full overflow-hidden rounded-full">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progressPct}%`, background: 'var(--accent)' }}
            />
          </div>
          <p className="text-muted-foreground mt-2 text-xs font-medium">{summaryReady ? `${progressPct}%` : '…'}</p>
        </div>

        <div className="bg-card border-border rounded-xl border p-5">
          <h2 className="text-foreground mb-4 text-base font-semibold">สถานะการตรวจสอบ</h2>
          <div className="space-y-3">
            <StatusRow label="ผ่านมาตรฐาน" count={summary?.passing ?? 0} pct={barPct(summary?.passing ?? 0)} color="var(--status-pass)" ready={summaryReady} />
            <StatusRow label="ต้องปรับปรุง" count={summary?.needsImprovement ?? 0} pct={barPct(summary?.needsImprovement ?? 0)} color="var(--status-warn)" ready={summaryReady} />
            <StatusRow label="ไม่ผ่าน" count={summary?.failing ?? 0} pct={barPct(summary?.failing ?? 0)} color="var(--status-fail)" ready={summaryReady} />
            <StatusRow label="ยังไม่ตรวจ" count={neverAudited} pct={barPct(neverAudited)} color="var(--muted-foreground)" ready={summaryReady} />
          </div>
        </div>
      </div>

      {/* ภาพรวมระบบ — ambient metrics, deliberately lighter than the action band. */}
      <section>
        <h2 className="text-muted-foreground mb-3 text-xs font-semibold uppercase tracking-wide">ภาพรวมระบบ</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {overviewKeys.map((key) => {
            const Icon = METRIC_ICONS[key] ?? TrendingUp
            return (
              <div key={key} className="bg-card border-border rounded-xl border p-5">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    {labelOf(key)}
                  </p>
                  <IconChip icon={Icon} accent="neutral" />
                </div>
                <p className="text-foreground text-2xl font-bold">{valueOf(key).toLocaleString()}</p>
              </div>
            )
          })}
        </div>
      </section>

      {/* Action queues — the work an admin resolves from this page. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div id="pending-queue" className="bg-card border-border rounded-xl border">
          <div className="border-border flex items-center justify-between border-b px-5 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-foreground text-base font-semibold">งานที่รอการอนุมัติ</h2>
              <QueueCount
                count={data.pendingReviewsList.length}
                tone="bg-status-warn/10 text-status-warn-foreground"
              />
            </div>
            <Link href="/stations" className="text-accent text-xs hover:underline">
              ดูทั้งหมด →
            </Link>
          </div>
          <div className="themed-scrollbar max-h-80 overflow-y-auto">
            {pendingSorted.length === 0 ? (
              <AllClear label="ไม่มีงานรอการอนุมัติในขณะนี้" />
            ) : (
              pendingSorted.map((row) => (
                <Link
                  key={row.checklistId}
                  href={`/stations/${row.stationId}`}
                  className="border-border hover:bg-secondary/30 flex items-center justify-between gap-3 border-b px-5 py-3 text-xs transition-colors last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-foreground truncate font-medium">{row.stationNameTh}</p>
                    <p className="text-muted-foreground truncate">ผู้ตรวจ: {row.auditorUsername}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <AgingPill iso={row.submittedAt} />
                    <ChevronRight size={14} className="text-muted-foreground" />
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        <div id="rejected-queue" className="bg-card border-border rounded-xl border">
          <div className="border-border flex items-center justify-between border-b px-5 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-foreground text-base font-semibold">รายงานที่ถูกปฏิเสธ รอส่งใหม่</h2>
              <QueueCount
                count={data.returnedWorkList.length}
                tone="bg-status-fail/10 text-status-fail"
              />
            </div>
            <Link href="/stations" className="text-accent text-xs hover:underline">
              ดูทั้งหมด →
            </Link>
          </div>
          <div className="themed-scrollbar max-h-80 overflow-y-auto">
            {data.returnedWorkList.length === 0 ? (
              <AllClear label="ไม่มีรายงานที่ถูกปฏิเสธ" />
            ) : (
              data.returnedWorkList.map((row) => (
                <Link
                  key={`${row.stationId}-${row.auditorUsername}`}
                  href={`/stations/${row.stationId}`}
                  className="border-border hover:bg-secondary/30 flex items-center justify-between gap-3 border-b px-5 py-3 text-xs transition-colors last:border-0"
                >
                  <div className="min-w-0">
                    <p className="text-foreground truncate font-medium">{row.stationNameTh}</p>
                    <p className="text-muted-foreground truncate">ผู้ตรวจ: {row.auditorUsername}</p>
                    {row.reviewNotes && (
                      <p className="text-status-fail truncate" title={row.reviewNotes}>
                        หมายเหตุ: {row.reviewNotes}
                      </p>
                    )}
                  </div>
                  <span className="text-muted-foreground shrink-0">
                    {row.reviewedAt ? new Date(row.reviewedAt).toLocaleDateString('th-TH') : '—'}
                  </span>
                </Link>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusRow({
  label,
  count,
  pct,
  color,
  ready,
}: {
  label: string
  count: number
  pct: number
  color: string
  ready: boolean
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-foreground font-medium">{label}</span>
        <span className="text-muted-foreground font-medium">{ready ? count.toLocaleString() : '…'}</span>
      </div>
      <div className="bg-secondary h-1.5 w-full overflow-hidden rounded-full">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}
