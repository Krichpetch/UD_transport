'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Settings, LogOut, RotateCcw, ClipboardList, ClipboardCheck } from 'lucide-react'
import { RequireRole } from '@/components/auth/require-role'
import { useAuthStore } from '@/stores/auth.store'
import { signOut } from '@/lib/sign-out'
import { useMyRejectedCount } from '@/hooks/use-checklists'

export default function AuditLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const ready = useAuthStore((s) => s.ready)
  const user = useAuthStore((s) => s.user)
  // Session E3, Part B.1 — persistent header badge, one cheap dedicated query, never the full
  // rejected-checklist list (see ChecklistsService.countMyRejected's doc). AUDITOR/REVIEWER-only
  // endpoint; an ADMIN using this layout for the v2 preview flag simply never sees a nonzero count.
  const { data: rejectedCount } = useMyRejectedCount(user?.role === 'AUDITOR' || user?.role === 'REVIEWER')

  React.useEffect(() => {
    if (ready && !user) router.replace('/login')
  }, [ready, user, router])

  async function handleLogout() {
    await signOut()
    router.push('/login')
  }

  if (!ready || !user) return null

  return (
    // E-form redesign (Session E2, Part B.2) — ADMIN is let through this route-level gate too,
    // solely so the v2-preview query flag (?preview=v2) has somewhere to land; the checklist
    // template endpoint already 403s a non-admin caller for that flag (checklists.controller.ts),
    // and admin/dev accounts using this route for anything other than that preview is not a new
    // exposure (they already have every other permission in the system).
    // Admin checklist-review refresh — REVIEWER admitted here too: it's a real auditor capability
    // for that role, not a preview-only carve-out like ADMIN's.
    <RequireRole roles={['AUDITOR', 'ADMIN', 'REVIEWER']} redirectTo="/dashboard">
      <div className="min-h-screen overflow-x-hidden bg-background">
        <header className="border-border bg-card/80 supports-[backdrop-filter]:bg-card/60 sticky top-0 z-30 flex items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur">
          <div className="min-w-0">
            <p className="text-foreground truncate text-sm font-semibold">{user?.displayName || user?.username || '-'}</p>
            <p className="text-muted-foreground text-xs">ผู้ตรวจสอบ</p>
          </div>
          <div className="flex items-center gap-1.5">
            {/* Session F1, Part E — "งานของฉัน" supersedes the old inline returned-work list as
                the one place to browse all of an auditor's work; the badge count stays, it just
                now links here (filtered to REJECTED) instead of the auditor home. */}
            {!!rejectedCount && (
              <Link
                href="/audit/my-work?status=REJECTED"
                title="งานที่ถูกตีกลับ"
                className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-semibold text-red-600"
              >
                <RotateCcw size={13} />
                {rejectedCount}
              </Link>
            )}
            {/* Admin checklist-review refresh — cross-link back into the review queue for anyone
                who can act on it from here (REVIEWER's fieldwork home, or ADMIN using this layout
                for the v2-preview flag). */}
            {(user?.role === 'REVIEWER' || user?.role === 'ADMIN') && (
              <Link
                href="/stations"
                title="ตรวจ/อนุมัติงาน"
                className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded-lg border p-1.5 transition-colors"
              >
                <ClipboardCheck size={15} />
              </Link>
            )}
            <Link
              href="/audit/my-work"
              title="งานของฉัน"
              className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded-lg border p-1.5 transition-colors"
            >
              <ClipboardList size={15} />
            </Link>
            <Link
              href="/settings"
              title="บัญชีของฉัน"
              className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded-lg border p-1.5 transition-colors"
            >
              <Settings size={15} />
            </Link>
            <button
              onClick={handleLogout}
              title="ออกจากระบบ"
              className="border-border text-muted-foreground hover:bg-secondary hover:text-foreground rounded-lg border p-1.5 transition-colors"
            >
              <LogOut size={15} />
            </button>
          </div>
        </header>
        <div className="mx-auto max-w-2xl px-4 py-6">{children}</div>
      </div>
    </RequireRole>
  )
}
