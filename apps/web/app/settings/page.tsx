'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { changePassword, updateProfile } from '@/lib/api/auth'
import { useAuthStore, useAuthHasHydrated } from '@/stores/auth.store'
import { PasswordInput } from '@/components/ui/password-input'

export default function SettingsPage() {
  const router = useRouter()
  const hydrated = useAuthHasHydrated()
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const updateUser = useAuthStore((s) => s.updateUser)
  const logout = useAuthStore((s) => s.logout)

  React.useEffect(() => {
    if (hydrated && !token) router.replace('/login')
  }, [hydrated, token, router])

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
    onSuccess: () => {
      // Force re-login with the new password rather than leaving a stale
      // session sitting on the settings page with nowhere to go.
      logout()
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

  if (!hydrated || !token) return null

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="bg-card flex w-full max-w-md flex-col items-center gap-6 rounded-xl p-6 shadow-lg sm:p-8">
        <div className="text-center">
          <h1 className="text-foreground text-xl font-bold tracking-tight">ตั้งค่าบัญชี</h1>
          <p className="text-muted-foreground mt-1 text-xs leading-snug">
            {user?.username ?? ''}
          </p>
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
    </div>
  )
}
