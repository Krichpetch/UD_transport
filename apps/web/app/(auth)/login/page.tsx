'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { login } from '@/lib/api/auth'
import { useAuthStore } from '@/stores/auth.store'

const ROLE_DESTINATIONS: Record<string, string> = {
  EXECUTIVE: '/dashboard',
  ADMIN: '/dashboard',
  AUDITOR: '/audit',
}

export default function LoginPage() {
  const router = useRouter()
  const storeLogin = useAuthStore((s) => s.login)

  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')

  const mutation = useMutation({
    mutationFn: () => login(username, password),
    onSuccess: (data) => {
      storeLogin(data.user, data.access_token)
      router.push(ROLE_DESTINATIONS[data.user.role] ?? '/dashboard')
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!username || !password) return
    mutation.mutate()
  }

  const errorMsg =
    mutation.error instanceof Error ? mutation.error.message : null

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="bg-card flex w-full max-w-md flex-col items-center gap-6 rounded-xl p-6 shadow-lg sm:p-8">
        {/* Logo / Branding */}
        <div className="flex flex-col items-center gap-2">
          <img src="/otplogo.svg" alt="สนข. logo" className="h-16 w-auto" />
          <div className="text-center">
            <h1 className="text-foreground text-xl font-bold tracking-tight">
              สำนักงานนโยบายและแผนการขนส่งและจราจร
            </h1>
            <p className="text-muted-foreground mt-1 text-xs leading-snug">
              ระบบฐานข้อมูลติดตามสิ่งอำนวยความสะดวก
              <br />
              ด้านคมนาคมขนส่งสำหรับคนทุกคน
            </p>
          </div>
        </div>

        <div className="border-border w-full border-t" />

        {/* Form */}
        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="space-y-1.5">
            <label className="text-foreground text-sm font-medium">ชื่อผู้ใช้งาน</label>
            <input
              type="text"
              placeholder="กรอกชื่อผู้ใช้งาน"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={mutation.isPending}
              className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2.5 text-sm focus:ring-2 focus:outline-none disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-foreground text-sm font-medium">รหัสผ่าน</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={mutation.isPending}
              className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2.5 text-sm focus:ring-2 focus:outline-none disabled:opacity-50"
            />
          </div>

          {errorMsg && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{errorMsg}</p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending || !username || !password}
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {mutation.isPending ? 'กำลังเข้าสู่ระบบ…' : 'ลงชื่อเข้าใช้'}
          </button>
        </form>

        <p className="text-muted-foreground text-center text-xs">
          ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบ
        </p>
      </div>
    </div>
  )
}
