'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { changePassword } from '@/lib/api/auth'
import { useAuthStore, useAuthHasHydrated } from '@/stores/auth.store'

export default function SettingsPage() {
  const router = useRouter()
  const hydrated = useAuthHasHydrated()
  const token = useAuthStore((s) => s.token)

  const [currentPassword, setCurrentPassword] = React.useState('')
  const [newPassword, setNewPassword] = React.useState('')

  React.useEffect(() => {
    if (hydrated && !token) router.replace('/login')
  }, [hydrated, token, router])

  const mutation = useMutation({
    mutationFn: () => changePassword(currentPassword, newPassword),
    onSuccess: () => {
      setCurrentPassword('')
      setNewPassword('')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!currentPassword || !newPassword) return
    mutation.mutate()
  }

  const errorMsg =
    mutation.error instanceof Error ? mutation.error.message : null

  if (!hydrated || !token) return null

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="bg-card flex w-full max-w-md flex-col items-center gap-6 rounded-xl p-6 shadow-lg sm:p-8">
        <div className="text-center">
          <h1 className="text-foreground text-xl font-bold tracking-tight">ตั้งค่าบัญชี</h1>
          <p className="text-muted-foreground mt-1 text-xs leading-snug">เปลี่ยนรหัสผ่านของคุณ</p>
        </div>

        <div className="border-border w-full border-t" />

        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="space-y-1.5">
            <label className="text-foreground text-sm font-medium">รหัสผ่านปัจจุบัน</label>
            <input
              type="password"
              placeholder="••••••••"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={mutation.isPending}
              className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2.5 text-sm focus:ring-2 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-foreground text-sm font-medium">รหัสผ่านใหม่</label>
            <input
              type="password"
              placeholder="อย่างน้อย 8 ตัวอักษร"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={mutation.isPending}
              className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2.5 text-sm focus:ring-2 focus:outline-none disabled:opacity-50"
            />
          </div>

          {errorMsg && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{errorMsg}</p>
          )}

          {mutation.isSuccess && (
            <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
              เปลี่ยนรหัสผ่านสำเร็จ
            </p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending || !currentPassword || !newPassword}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {mutation.isPending ? 'กำลังบันทึก…' : 'เปลี่ยนรหัสผ่าน'}
          </button>
        </form>
      </div>
    </div>
  )
}
