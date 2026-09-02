'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { changePassword, updateProfile } from '@/lib/api/auth'
import { useAuthStore } from '@/stores/auth.store'
import { signOut } from '@/lib/sign-out'
import { PasswordInput } from '@/components/ui/password-input'
import { cn } from '@/lib/utils'
import {
  applyFontScale,
  DEFAULT_FONT_SCALE,
  FONT_SCALE_LABELS,
  FONT_SCALES,
  readFontScale,
  type FontScale,
} from '@/lib/font-scale'

/**
 * Shared settings form body. Renders a self-contained centered card with no
 * full-screen chrome of its own, so it can be embedded inside either shell:
 * the (dashboard-layout) sidebar+navbar (admin/executive/reviewer at /settings)
 * or the (audit-layout) mobile header (auditor at /audit/settings). The route
 * page's layout owns the auth guard (RequireRole); this component only renders.
 */
export function SettingsPanel() {
  const router = useRouter()
  const ready = useAuthStore((s) => s.ready)
  const user = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)

  // ── Font size ─────────────────────────────────────────────────
  // Initialized from the SSR-set <html data-font-scale> / cookie on mount.
  const [fontScale, setFontScale] = React.useState<FontScale>(DEFAULT_FONT_SCALE)

  React.useEffect(() => {
    setFontScale(readFontScale())
  }, [])

  function handleFontScale(scale: FontScale) {
    setFontScale(scale)
    applyFontScale(scale) // live, no reload; persists to cookie
  }

  // ── Display name ──────────────────────────────────────────────
  const [displayName, setDisplayName] = React.useState('')

  React.useEffect(() => {
    setDisplayName(user?.displayName ?? '')
  }, [user?.displayName])

  const nameMutation = useMutation({
    mutationFn: () => updateProfile(displayName.trim()),
    onSuccess: (updated) => updateUser({ displayName: updated.displayName }),
  })

  function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!displayName.trim()) return
    nameMutation.mutate()
  }

  const nameErrorMsg =
    nameMutation.error instanceof Error ? nameMutation.error.message : null

  // ── Password ──────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')

  const passwordMutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: async () => {
      // Force re-login with the new password rather than leaving a stale
      // session sitting on the settings page with nowhere to go.
      await signOut()
      router.push('/login?passwordChanged=1')
    },
  })

  const passwordsMismatch =
    newPassword.length > 0 && confirmPassword.length > 0 && newPassword !== confirmPassword

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentPassword || !newPassword || !confirmPassword) return
    if (newPassword !== confirmPassword) return
    passwordMutation.mutate()
  }

  const passwordErrorMsg =
    passwordMutation.error instanceof Error ? passwordMutation.error.message : null

  if (!ready || !user) return null

  return (
    <div className="bg-card mx-auto flex w-full max-w-md flex-col items-center gap-6 rounded-xl p-6 shadow-lg sm:p-8">
      <div className="text-center">
        <h1 className="text-foreground text-xl font-bold tracking-tight">ตั้งค่าบัญชี</h1>
        <p className="text-muted-foreground mt-1 text-xs leading-snug">
          {user?.username ?? ''}
        </p>
      </div>

      <div className="border-border w-full border-t" />

      {/* ── Font size ── */}
      <div className="w-full space-y-3">
        <h2 className="text-foreground text-sm font-semibold">ขนาดตัวอักษร</h2>
        <p className="text-muted-foreground text-xs">
          ปรับขนาดตัวอักษรทั้งระบบให้อ่านง่ายขึ้น
        </p>
        <div className="grid grid-cols-3 gap-2">
          {FONT_SCALES.map((scale) => {
            const active = fontScale === scale
            return (
              <button
                key={scale}
                type="button"
                onClick={() => handleFontScale(scale)}
                aria-pressed={active}
                className={cn(
                  'flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2.5 transition-colors',
                  active
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input bg-background text-foreground hover:bg-secondary',
                )}
              >
                <span className="text-sm font-medium">{FONT_SCALE_LABELS[scale]}</span>
                <span className={cn('text-2xs', active ? 'opacity-80' : 'text-muted-foreground')}>
                  {scale}%
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="border-border w-full border-t" />

      {/* ── Display name ── */}
      <form onSubmit={handleNameSubmit} className="w-full space-y-4">
        <h2 className="text-foreground text-sm font-semibold">ชื่อที่แสดง</h2>

        <div className="space-y-1.5">
          <label className="text-foreground text-sm font-medium">ชื่อ-นามสกุล</label>
          <input
            type="text"
            placeholder="กรอกชื่อที่ต้องการแสดง"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            disabled={nameMutation.isPending}
            className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2.5 text-sm focus:ring-2 focus:outline-none disabled:opacity-50"
          />
        </div>

        {nameErrorMsg && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{nameErrorMsg}</p>
        )}

        {nameMutation.isSuccess && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
            บันทึกชื่อสำเร็จ
          </p>
        )}

        <button
          type="submit"
          disabled={nameMutation.isPending || !displayName.trim()}
          className="bg-primary text-primary-foreground hover:bg-primary/90 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {nameMutation.isPending ? 'กำลังบันทึก…' : 'บันทึกชื่อ'}
        </button>
      </form>

      <div className="border-border w-full border-t" />

      {/* ── Password ── */}
      <form onSubmit={handlePasswordSubmit} className="w-full space-y-4">
        <h2 className="text-foreground text-sm font-semibold">เปลี่ยนรหัสผ่าน</h2>

        <div className="space-y-1.5">
          <label className="text-foreground text-sm font-medium">รหัสผ่านปัจจุบัน</label>
          <PasswordInput
            placeholder="••••••••"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={passwordMutation.isPending}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-foreground text-sm font-medium">รหัสผ่านใหม่</label>
          <PasswordInput
            placeholder="อย่างน้อย 8 ตัวอักษร"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={passwordMutation.isPending}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-foreground text-sm font-medium">ยืนยันรหัสผ่านใหม่</label>
          <PasswordInput
            placeholder="กรอกรหัสผ่านใหม่อีกครั้ง"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            disabled={passwordMutation.isPending}
          />
          {passwordsMismatch && (
            <p className="text-xs text-red-600">รหัสผ่านใหม่ไม่ตรงกัน</p>
          )}
        </div>

        {passwordErrorMsg && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{passwordErrorMsg}</p>
        )}

        <button
          type="submit"
          disabled={
            passwordMutation.isPending ||
            !currentPassword ||
            !newPassword ||
            !confirmPassword ||
            newPassword !== confirmPassword
          }
          className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
        >
          {passwordMutation.isPending ? 'กำลังบันทึก…' : 'เปลี่ยนรหัสผ่าน'}
        </button>
      </form>
    </div>
  )
}
