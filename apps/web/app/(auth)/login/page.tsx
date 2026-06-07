'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const ROLE_DESTINATIONS: Record<string, string> = {
  EXECUTIVE: '/dashboard',
  ADMIN: '/dashboard',
  AUDITOR: '/audit',
}

export default function LoginPage() {
  const router = useRouter()
  const [role, setRole] = React.useState('')
  const [error, setError] = React.useState('')

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!role) {
      setError('กรุณาเลือกระดับผู้ใช้งาน')
      return
    }
    // Phase 2: validate username + password against API here
    router.push(ROLE_DESTINATIONS[role] ?? '/dashboard')
  }

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="bg-card flex w-full max-w-md flex-col items-center gap-6 rounded-xl p-8 shadow-lg">
        {/* Logo / Branding */}
        <div className="flex flex-col items-center gap-2">
          <div className="bg-primary flex size-16 items-center justify-center rounded-2xl shadow-md">
            <svg
              width="32"
              height="32"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M6 24 C6 24, 4 20, 4 14 C4 8, 9 4, 16 4 C23 4, 28 8, 28 14 C28 20, 26 24, 26 24"
                stroke="white"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <circle cx="16" cy="18" r="5" fill="white" fillOpacity="0.9" />
              <path d="M12 26 L20 26" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
              <path
                d="M14 22 L14 26 M18 22 L18 26"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </div>
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
              className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2.5 text-sm focus:ring-2 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-foreground text-sm font-medium">รหัสผ่าน</label>
            <input
              type="password"
              placeholder="••••••••"
              className="border-input bg-background placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2.5 text-sm focus:ring-2 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-foreground text-sm font-medium">ระดับผู้ใช้งาน</label>
            <select
              value={role}
              onChange={(e) => {
                setRole(e.target.value)
                setError('')
              }}
              className="border-input bg-background text-foreground focus:ring-ring w-full rounded-lg border px-3 py-2.5 text-sm focus:ring-2 focus:outline-none"
            >
              <option value="">เลือกระดับผู้ใช้งาน</option>
              <option value="EXECUTIVE">ผู้บริหาร (Executive)</option>
              <option value="ADMIN">ผู้ดูแลระบบ (Admin)</option>
              <option value="AUDITOR">ผู้ตรวจสอบ (Auditor)</option>
            </select>
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          <button
            type="submit"
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors"
          >
            ลงชื่อเข้าใช้
          </button>
        </form>

        <p className="text-muted-foreground text-center text-xs">
          ลืมรหัสผ่าน?{' '}
          <Link href="/forgot-password" className="text-accent hover:underline">
            ติดต่อผู้ดูแลระบบ
          </Link>
        </p>
      </div>
    </div>
  )
}
