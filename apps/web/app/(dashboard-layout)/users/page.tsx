'use client'

import * as React from 'react'
import { useAuthStore } from '@/stores/auth.store'
import { RequireRole } from '@/components/auth/require-role'
import { useUsers, useCreateUser, useUpdateUser, useSetUserActive } from '@/hooks/use-users'
import type { UserRecord, CreatedUserRecord } from '@/lib/api/users'
import type { UserRole } from '@repo/types'
import { USER_ROLES } from '@repo/types'
import { INPUT_CLS, SELECT_CLS } from '@/lib/ui-classes'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { UserPlus, Loader2, Pencil, Ban, CheckCircle2, Copy, Check } from 'lucide-react'

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'ผู้ดูแลระบบ',
  AUDITOR: 'ผู้ตรวจสอบ',
  EXECUTIVE: 'ผู้บริหาร',
}

function RoleBadge({ role }: { role: UserRole }) {
  const map: Record<UserRole, string> = {
    ADMIN: 'bg-violet-50 text-violet-700',
    AUDITOR: 'bg-blue-50 text-blue-700',
    EXECUTIVE: 'bg-amber-50 text-amber-700',
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${map[role]}`}>
      {ROLE_LABEL[role]}
    </span>
  )
}

function ActiveBadge({ isActive }: { isActive: boolean }) {
  return isActive ? (
    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
      ใช้งานอยู่
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
      ปิดใช้งาน
    </span>
  )
}

// Shown once, right after creating an account — the only place the password is ever visible.
function GeneratedPasswordNotice({ user, onClose }: { user: CreatedUserRecord; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false)

  async function copy() {
    if (!user.generatedPassword) return
    await navigator.clipboard.writeText(user.generatedPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    // Displays a one-time generated password — must NOT close on backdrop click or Escape,
    // so an accidental click can't destroy the only chance to read it. Explicit close button
    // (or the dialog's own X) only.
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent
        className="max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogTitle className="mb-2 text-lg">สร้างบัญชีสำเร็จ</DialogTitle>
        <p className="text-muted-foreground mb-4 text-sm">
          บัญชี <span className="font-medium">{user.username}</span> ถูกสร้างแล้ว รหัสผ่านชั่วคราวจะแสดงเพียงครั้งเดียวเท่านั้น
          กรุณาคัดลอกและส่งให้ผู้ใช้งานอย่างปลอดภัย
        </p>
        {user.generatedPassword && (
          <div className="bg-secondary mb-4 flex items-center justify-between gap-2 rounded-lg px-3 py-2">
            <code className="text-foreground text-sm">{user.generatedPassword}</code>
            <button onClick={copy} className="text-muted-foreground hover:text-foreground transition-colors">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </div>
        )}
        <button
          onClick={onClose}
          className="bg-primary text-primary-foreground w-full rounded-lg py-2 text-sm font-medium"
        >
          ปิด
        </button>
      </DialogContent>
    </Dialog>
  )
}

interface UserFormState {
  username: string
  email: string
  role: UserRole
  password: string
}

const EMPTY_FORM: UserFormState = { username: '', email: '', role: 'AUDITOR', password: '' }

function UserFormModal({
  mode,
  initial,
  onClose,
  onCreated,
}: {
  mode: 'create' | 'edit'
  initial: UserRecord | null
  onClose: () => void
  onCreated: (user: CreatedUserRecord) => void
}) {
  const createUser = useCreateUser()
  const updateUser = useUpdateUser()
  const [form, setForm] = React.useState<UserFormState>(
    initial ? { username: initial.username, email: initial.email, role: initial.role, password: '' } : EMPTY_FORM,
  )
  const [error, setError] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  function patch(p: Partial<UserFormState>) {
    setForm((f) => ({ ...f, ...p }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.username || !form.email) {
      setError('กรุณากรอกข้อมูลที่จำเป็นให้ครบถ้วน')
      return
    }
    if (mode === 'create' && form.password && form.password.length < 8) {
      setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร')
      return
    }
    setError('')
    setSaving(true)
    try {
      if (mode === 'create') {
        const user = await createUser.mutateAsync({
          username: form.username,
          email: form.email,
          role: form.role,
          password: form.password || undefined,
        })
        onCreated(user)
      } else if (initial) {
        await updateUser.mutateAsync({
          id: initial.id,
          data: { username: form.username, email: form.email, role: form.role },
        })
        onClose()
      }
    } catch (err) {
      setError((err as Error).message ?? 'เกิดข้อผิดพลาด')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-md" onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogTitle className="mb-6 text-lg">
          {mode === 'create' ? 'เพิ่มผู้ใช้งาน' : 'แก้ไขผู้ใช้งาน'}
        </DialogTitle>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">ชื่อผู้ใช้ *</label>
            <input
              className={INPUT_CLS}
              value={form.username}
              onChange={(e) => patch({ username: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">อีเมล *</label>
            <input
              type="email"
              className={INPUT_CLS}
              value={form.email}
              onChange={(e) => patch({ email: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">บทบาท *</label>
            <select className={SELECT_CLS} value={form.role} onChange={(e) => patch({ role: e.target.value as UserRole })}>
              {USER_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
          </div>
          {mode === 'create' && (
            <div>
              <label className="text-foreground mb-1 block text-xs font-medium">
                รหัสผ่านเริ่มต้น (เว้นว่างเพื่อให้ระบบสร้างให้อัตโนมัติ)
              </label>
              <input
                type="text"
                className={INPUT_CLS}
                value={form.password}
                onChange={(e) => patch({ password: e.target.value })}
                placeholder="อย่างน้อย 8 ตัวอักษร"
              />
            </div>
          )}

          {error && <p className="text-destructive text-xs">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="bg-primary text-primary-foreground flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-sm font-medium disabled:opacity-60"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : null}
              {saving ? 'กำลังบันทึก...' : mode === 'create' ? 'สร้างบัญชี' : 'บันทึกการแก้ไข'}
            </button>
            <button type="button" onClick={onClose} className="border-border rounded-lg border px-4 py-2 text-sm">
              ยกเลิก
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default function UsersPage() {
  return (
    <RequireRole roles={['ADMIN']}>
      <UsersPageContent />
    </RequireRole>
  )
}

function UsersPageContent() {
  const { user: currentUser } = useAuthStore()
  const { data: users = [], isLoading, error } = useUsers()
  const setUserActive = useSetUserActive()

  const [formModal, setFormModal] = React.useState<{ mode: 'create' | 'edit'; initial: UserRecord | null } | null>(null)
  const [createdUser, setCreatedUser] = React.useState<CreatedUserRecord | null>(null)
  const [pendingToggleId, setPendingToggleId] = React.useState<string | null>(null)

  async function handleToggleActive(u: UserRecord) {
    setPendingToggleId(u.id)
    try {
      await setUserActive.mutateAsync({ id: u.id, isActive: !u.isActive })
    } finally {
      setPendingToggleId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-xl font-bold">จัดการผู้ใช้งาน</h1>
          <p className="text-muted-foreground text-sm">พบ {users.length} บัญชี</p>
        </div>
        <button
          onClick={() => setFormModal({ mode: 'create', initial: null })}
          className="bg-primary text-primary-foreground flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
        >
          <UserPlus size={14} />
          เพิ่มผู้ใช้งาน
        </button>
      </div>

      {isLoading && (
        <div className="text-muted-foreground flex items-center justify-center p-16 text-sm">กำลังโหลด…</div>
      )}
      {error && (
        <div className="flex items-center justify-center p-16 text-sm text-red-500">
          เกิดข้อผิดพลาด: {(error as Error).message}
        </div>
      )}

      {!isLoading && !error && (
        <div className="bg-card border-border overflow-hidden rounded-xl border">
          <div className="themed-scrollbar overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border bg-secondary/30 border-b">
                  <th className="text-muted-foreground px-5 py-3 text-left text-xs font-medium tracking-wide uppercase">
                    ชื่อผู้ใช้
                  </th>
                  <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium tracking-wide uppercase">
                    อีเมล
                  </th>
                  <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium tracking-wide uppercase">
                    บทบาท
                  </th>
                  <th className="text-muted-foreground px-3 py-3 text-left text-xs font-medium tracking-wide uppercase">
                    สถานะ
                  </th>
                  <th className="text-muted-foreground px-5 py-3 text-right text-xs font-medium tracking-wide uppercase">
                    ดำเนินการ
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-muted-foreground py-12 text-center text-sm">
                      ไม่พบผู้ใช้งาน
                    </td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="border-border hover:bg-secondary/30 border-b transition-colors last:border-0">
                      <td className="text-foreground px-5 py-3.5 font-medium">{u.username}</td>
                      <td className="text-muted-foreground px-3 py-3.5">{u.email}</td>
                      <td className="px-3 py-3.5">
                        <RoleBadge role={u.role} />
                      </td>
                      <td className="px-3 py-3.5">
                        <ActiveBadge isActive={u.isActive} />
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setFormModal({ mode: 'edit', initial: u })}
                            className="border-border text-foreground hover:bg-secondary flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors"
                          >
                            <Pencil size={12} />
                            แก้ไข
                          </button>
                          <button
                            onClick={() => handleToggleActive(u)}
                            disabled={pendingToggleId === u.id || u.id === currentUser?.id}
                            title={u.id === currentUser?.id ? 'ไม่สามารถปิดใช้งานบัญชีของตนเองได้' : undefined}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
                              u.isActive
                                ? 'border-border text-destructive hover:bg-destructive/5'
                                : 'border-border text-green-700 hover:bg-green-50'
                            }`}
                          >
                            {pendingToggleId === u.id ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : u.isActive ? (
                              <Ban size={12} />
                            ) : (
                              <CheckCircle2 size={12} />
                            )}
                            {u.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {formModal && (
        <UserFormModal
          mode={formModal.mode}
          initial={formModal.initial}
          onClose={() => setFormModal(null)}
          onCreated={(user) => {
            setFormModal(null)
            setCreatedUser(user)
          }}
        />
      )}

      {createdUser && <GeneratedPasswordNotice user={createdUser} onClose={() => setCreatedUser(null)} />}
    </div>
  )
}
